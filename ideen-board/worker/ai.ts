import Anthropic from "@anthropic-ai/sdk";
import type { Context } from "hono";
import { columnTitle, userName } from "../shared/types";
import type { AiAnalysis, AiAnalysisData, BrainstormAi, Card, Source } from "../shared/types";
import { addHistory, bumpRev, getSetting, loadCard, loadCards, nowIso } from "./db";
import { loadImagesForAi } from "./attachments";
import type { AppEnv, Env } from "./env";

export const DEFAULT_MODEL = "claude-opus-5-5";
const MAX_ATTEMPTS = 5;

/** Preise in US-Dollar pro 1 Mio. Token (Stand 2026-09) – für die Kostenbremse */
const PRICES: Record<string, { in: number; out: number }> = {
  "claude-opus-5-5": { in: 4, out: 20 },
  "claude-sonnet-5-5": { in: 2, out: 10 },
  "claude-haiku-4-5": { in: 1, out: 5 },
};
const USD_PER_SEARCH = 0.01;
const EUR_PER_USD = 0.92; // grobe Umrechnung für die Monatsgrenze

export type AiJob = { type: "card"; id: number; by: string | null } | { type: "brainstorm"; id: number };

// ---------------------------------------------------------------------------
// Auslösen

/** Stellt eine Analyse in die Warteschlange. Schlägt das fehl, holt der Zeitplan sie später nach. */
export function kickAnalysis(c: Context<AppEnv>, cardId: number, requestedBy: string | null): void {
  if (!c.env.ANTHROPIC_API_KEY) return;
  const job: AiJob = { type: "card", id: cardId, by: requestedBy };
  c.executionCtx.waitUntil(enqueue(c.env, [job]).catch((e) => console.error("Queue", e)));
}

/** Mit Warteschlange: dort einreihen. Ohne: direkt im Hintergrund (Abbruch fängt der Zeitplan ab). */
async function enqueue(env: Env, jobs: AiJob[]): Promise<void> {
  if (env.AI_QUEUE) {
    await env.AI_QUEUE.sendBatch(jobs.map((body) => ({ body })));
    return;
  }
  for (const j of jobs) await (j.type === "card" ? analyzeCard(env, j.id, j.by) : analyzeBrainstorm(env, j.id)).catch((e) => console.error(e));
}

export function kickBrainstorm(c: Context<AppEnv>, brainstormId: number): void {
  if (!c.env.ANTHROPIC_API_KEY) return;
  c.executionCtx.waitUntil(
    (async () => {
      const ids = await c.env.DB.prepare("SELECT id FROM cards WHERE brainstorm_id = ? AND ai_status = 'pending' AND merged_into IS NULL AND deleted_at IS NULL")
        .bind(brainstormId)
        .all<{ id: number }>();
      await enqueue(c.env, [{ type: "brainstorm", id: brainstormId }, ...ids.results.map((r): AiJob => ({ type: "card", id: r.id, by: null }))]);
    })().catch((e) => console.error("Queue", e)),
  );
}

/** Warteschlangen-Verarbeitung (bis zu 15 Minuten Laufzeit je Aufruf) */
export async function handleQueue(batch: MessageBatch<AiJob>, env: Env): Promise<void> {
  for (const msg of batch.messages) {
    try {
      if (msg.body.type === "card") await analyzeCard(env, msg.body.id, msg.body.by);
      else await analyzeBrainstorm(env, msg.body.id);
      msg.ack();
    } catch (e) {
      console.error("KI-Job fehlgeschlagen", e);
      msg.ack(); // Status steht auf „error“, der Zeitplan versucht es später erneut
    }
  }
}

/** Zeitplan (alle 10 Min.): liegengebliebene oder fehlgeschlagene Analysen nachholen */
export async function retryPending(env: Env): Promise<void> {
  if (!env.ANTHROPIC_API_KEY) return;
  const db = env.DB;
  const stale = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const recent = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  // „running“ seit über 10 Min. gilt als abgebrochen
  await db.prepare("UPDATE cards SET ai_status = 'error', ai_error = 'Abgebrochen' WHERE ai_status = 'running' AND updated_at < ?").bind(stale).run();
  const cards = await db
    .prepare(
      `SELECT id FROM cards WHERE merged_into IS NULL AND deleted_at IS NULL AND ai_status IN ('pending', 'error') AND ai_attempts < ? AND updated_at < ?
       ORDER BY updated_at LIMIT 4`,
    )
    .bind(MAX_ATTEMPTS, recent)
    .all<{ id: number }>();
  for (const r of cards.results) {
    try {
      await analyzeCard(env, r.id, null);
    } catch (e) {
      console.error(e);
    }
  }
  const bs = await db.prepare("SELECT id FROM brainstorms WHERE ai_status IN ('pending', 'error') LIMIT 2").all<{ id: number }>();
  for (const r of bs.results) {
    try {
      await analyzeBrainstorm(env, r.id);
    } catch (e) {
      console.error(e);
    }
  }
}

// ---------------------------------------------------------------------------
// Gemeinsames

function client(env: Env) {
  return new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, baseURL: env.ANTHROPIC_BASE_URL || undefined, maxRetries: 2, timeout: 5 * 60 * 1000 });
}

function modelOf(env: Env) {
  return env.AI_MODEL || DEFAULT_MODEL;
}

function costUsd(model: string, usage: Anthropic.Beta.BetaUsage): number {
  const p = PRICES[model] ?? PRICES[DEFAULT_MODEL];
  const input = (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) * 1.25 + (usage.cache_read_input_tokens ?? 0) * 0.1;
  const searches = usage.server_tool_use?.web_search_requests ?? 0;
  return (input * p.in + (usage.output_tokens ?? 0) * p.out) / 1e6 + searches * USD_PER_SEARCH;
}

/** Bucht KI-Kosten auf den laufenden Monat */
async function addCost(db: D1Database, usd: number): Promise<void> {
  await db
    .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = CAST(value AS REAL) + CAST(excluded.value AS REAL)")
    .bind("ai_cost:" + nowIso().slice(0, 7), String(usd))
    .run();
}

/** KI-Kosten des laufenden Monats in Euro (grob umgerechnet) */
export async function monthCostEur(db: D1Database): Promise<number> {
  return Number((await getSetting(db, "ai_cost:" + nowIso().slice(0, 7))) ?? 0) * EUR_PER_USD;
}

/** Prüft die Monatsgrenze. Gibt eine Fehlermeldung zurück, wenn sie erreicht ist. */
export async function budgetExceeded(db: D1Database): Promise<string | null> {
  const limitEur = Number((await getSetting(db, "ai_monthly_limit_eur")) ?? "10");
  const eur = await monthCostEur(db);
  return eur >= limitEur ? `Monatsgrenze für KI-Kosten erreicht (${limitEur} €). In den Einstellungen anheben oder bis nächsten Monat warten.` : null;
}

export const SYSTEM_RULES = `Du bist ein nüchterner, praxisnaher Berater für einen kleinen deutschen Handwerksbetrieb.
Du analysierst Ideen, die das Team (Felix, Tim und Kerstin) auf seinem Ideen-Board festhält.

Regeln:
- Schreibe auf Deutsch, klar, konkret und kurz. Keine Floskeln, kein Marketing-Sprech.
- Alles, was du lieferst, ist ein Vorschlag. Die Entscheidung trifft das Team.
- Trenne Fakten von Annahmen. Jede Schätzung (Kosten, Zeit, Marktgröße, Wirkung) markierst du als Schätzung (ist_schaetzung = true) und nennst die Annahme dahinter.
- Gib nichts als Tatsache aus, was du nicht belegen kannst. Wenn du etwas nicht weißt, sag es.
- Nutze die Websuche nur, wenn aktuelle oder überprüfbare Informationen wirklich nötig sind (z. B. Förderprogramme, Preise, rechtliche Vorgaben, Anbieter). Höchstens 3 Suchen.
- Gib Quellen nur an, wenn du sie in der Websuche tatsächlich gefunden hast – mit exakter URL. Erfinde keine Quellen.
- Nächste Schritte: 3 bis 5 konkrete, sofort machbare Schritte in sinnvoller Reihenfolge, jeweils ein Satz, beginnend mit einem Verb.
- Ergänzende Maßnahmen: 2 bis 5 Punkte, was zusätzlich sinnvoll wäre (z. B. Marketing, Abläufe, Partner, Werkzeuge).
- Nutzen und Aufwand bewertest du jeweils von 1 (gering) bis 5 (sehr hoch), bezogen auf einen kleinen Handwerksbetrieb.
- Ähnliche Karten: Nenne nur Karten aus der mitgelieferten Board-Liste, die inhaltlich wirklich verwandt sind (gleiches Ziel oder starke Überschneidung). Wenn keine passt, leere Liste.
- Schließe die Arbeit immer ab, indem du das Werkzeug „analyse_speichern“ genau einmal aufrufst.`;

const ANALYSIS_TOOL = (categoryNames: string[]): Anthropic.Beta.BetaTool => ({
  name: "analyse_speichern",
  description: "Speichert die fertige Analyse der Idee auf der Karte. Am Ende genau einmal aufrufen.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["kurzfassung", "kategorie", "nutzen", "aufwand", "naechste_schritte", "massnahmen", "infos", "kosten_zeit", "risiken", "offene_fragen", "aehnliche_karten"],
    properties: {
      kurzfassung: { type: "string", description: "Die Idee in 1–2 klaren, sauber formulierten Sätzen." },
      kategorie: {
        type: "object",
        additionalProperties: false,
        required: ["vorschlag", "begruendung"],
        properties: {
          vorschlag: { type: "string", description: `Eine der vorhandenen Kategorien (${categoryNames.join(", ")}) oder, nur wenn keine passt, ein kurzer neuer Name.` },
          begruendung: { type: "string" },
        },
      },
      nutzen: {
        type: "object",
        additionalProperties: false,
        required: ["wert", "begruendung"],
        properties: { wert: { type: "integer", description: "1 bis 5" }, begruendung: { type: "string" } },
      },
      aufwand: {
        type: "object",
        additionalProperties: false,
        required: ["wert", "begruendung"],
        properties: { wert: { type: "integer", description: "1 bis 5" }, begruendung: { type: "string" } },
      },
      naechste_schritte: { type: "array", items: { type: "string" }, description: "3–5 konkrete Schritte in Reihenfolge" },
      massnahmen: { type: "array", items: { type: "string" }, description: "Ergänzende Maßnahmen" },
      infos: {
        type: "array",
        description: "Wissenswertes und Hintergrund",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["text", "ist_schaetzung", "quellen"],
          properties: {
            text: { type: "string" },
            ist_schaetzung: { type: "boolean" },
            quellen: {
              type: "array",
              items: { type: "object", additionalProperties: false, required: ["titel", "url"], properties: { titel: { type: "string" }, url: { type: "string" } } },
            },
          },
        },
      },
      kosten_zeit: {
        type: "object",
        additionalProperties: false,
        required: ["text", "ist_schaetzung"],
        properties: { text: { type: "string", description: "Grobe Kosten- und Zeiteinschätzung mit Annahmen" }, ist_schaetzung: { type: "boolean" } },
      },
      risiken: { type: "array", items: { type: "string" } },
      offene_fragen: { type: "array", items: { type: "string" }, description: "Was vor einer Entscheidung geklärt sein muss" },
      aehnliche_karten: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["karte_id", "grund", "zusammenfuehren_empfohlen"],
          properties: { karte_id: { type: "integer" }, grund: { type: "string" }, zusammenfuehren_empfohlen: { type: "boolean" } },
        },
      },
    },
  },
});

/** Sammelt die URLs, die die Websuche tatsächlich geliefert hat */
function searchedSources(content: Anthropic.Beta.BetaContentBlock[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const block of content) {
    if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
      for (const r of block.content) if (r.type === "web_search_result") map.set(r.url, r.title);
    }
  }
  return map;
}

/**
 * Führt eine Anfrage aus, bis das Modell das Werkzeug aufgerufen hat.
 * Behandelt pause_turn (lange Websuche) und erinnert einmal, falls das Werkzeug fehlt.
 */
export async function runUntilTool(
  env: Env,
  params: { system: string; user: string | Anthropic.Beta.BetaContentBlockParam[]; tools: Anthropic.Beta.BetaToolUnion[]; toolName: string; maxTokens: number },
): Promise<{ input: unknown; content: Anthropic.Beta.BetaContentBlock[]; cost: number; model: string }> {
  const api = client(env);
  const model = modelOf(env);
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: params.user }];
  const allContent: Anthropic.Beta.BetaContentBlock[] = [];
  let cost = 0;
  let reminded = false;
  for (let i = 0; i < 6; i++) {
    const res = await api.beta.messages.create({
      model,
      max_tokens: params.maxTokens,
      system: [{ type: "text", text: params.system, cache_control: { type: "ephemeral" } }],
      messages,
      tools: params.tools,
      tool_choice: { type: "auto" },
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
    const stepCost = costUsd(res.model in PRICES ? res.model : model, res.usage);
    cost += stepCost;
    await addCost(env.DB, stepCost);
    allContent.push(...res.content);
    if (res.stop_reason === "refusal") throw new Error("Die KI hat die Anfrage abgelehnt.");
    const call = res.content.find((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use" && b.name === params.toolName);
    if (call) return { input: call.input, content: allContent, cost, model: res.model };
    messages.push({ role: "assistant", content: res.content as Anthropic.Beta.BetaContentBlockParam[] });
    if (res.stop_reason === "pause_turn") continue; // Server setzt die Suche fort
    if (res.stop_reason === "max_tokens") throw new Error("Antwort zu lang (max_tokens)");
    if (reminded) break;
    reminded = true;
    messages.push({ role: "user", content: `Bitte schließe jetzt ab und rufe das Werkzeug „${params.toolName}“ auf.` });
  }
  throw new Error("Die KI hat kein Ergebnis gespeichert.");
}

const clampScore = (n: unknown) => Math.min(5, Math.max(1, Math.round(Number(n) || 3)));

// ---------------------------------------------------------------------------
// Karten-Analyse

function boardOverview(cards: Card[], selfId: number): string {
  const others = cards.filter((c) => c.id !== selfId && !c.merged_into);
  if (!others.length) return "(keine weiteren Karten)";
  return others
    .slice(0, 150)
    .map((c) => `#${c.id} [${columnTitle(c.column_key)}] ${c.title}${c.description ? " – " + c.description.replace(/\s+/g, " ").slice(0, 140) : ""}`)
    .join("\n");
}

export async function analyzeCard(env: Env, cardId: number, requestedBy: string | null): Promise<void> {
  const db = env.DB;
  const card = await loadCard(db, cardId);
  if (!card || card.merged_into || card.deleted_at || card.ai_status === "deferred") return;

  const over = await budgetExceeded(db);
  if (over) {
    await db.prepare("UPDATE cards SET ai_status = 'error', ai_error = ? WHERE id = ?").bind(over, cardId).run();
    await bumpRev(db);
    return;
  }

  await db.prepare("UPDATE cards SET ai_status = 'running', ai_attempts = ai_attempts + 1, ai_error = NULL, updated_at = ? WHERE id = ?").bind(nowIso(), cardId).run();
  await bumpRev(db);

  try {
    const [context, cats, comments, all, prev] = await Promise.all([
      getSetting(db, "company_context"),
      db.prepare("SELECT id, name FROM categories ORDER BY sort").all<{ id: number; name: string }>(),
      db.prepare("SELECT user_id, text, created_at FROM comments WHERE card_id = ? ORDER BY created_at").bind(cardId).all<{ user_id: string; text: string; created_at: string }>(),
      loadCards(db),
      db.prepare("SELECT data FROM ai_analyses WHERE card_id = ? ORDER BY version DESC LIMIT 1").bind(cardId).first<{ data: string }>(),
    ]);
    const catNames = cats.results.map((c) => c.name);
    const catName = card.category_id ? cats.results.find((c) => c.id === card.category_id)?.name : null;

    const user = `FIRMENKONTEXT
${context || "(nicht angegeben)"}

HEUTIGES DATUM: ${nowIso().slice(0, 10)}

VORHANDENE KATEGORIEN: ${catNames.join(", ")}

DIE IDEE (Karte #${card.id}, Spalte „${columnTitle(card.column_key)}“, erfasst von ${userName(card.created_by)})
Titel: ${card.title}
Beschreibung: ${card.description || "(keine)"}
${catName ? `Von uns gesetzte Kategorie: ${catName}\n` : ""}${card.benefit ? `Von uns bewerteter Nutzen: ${card.benefit}\n` : ""}${card.effort ? `Von uns bewerteter Aufwand: ${card.effort}\n` : ""}${card.next_step ? `Unser nächster Schritt: ${card.next_step}\n` : ""}${card.checklist.length ? `Unsere Checkliste:\n${card.checklist.map((i) => `- [${i.done ? "x" : " "}] ${i.text}`).join("\n")}\n` : ""}
KOMMENTARE
${comments.results.length ? comments.results.map((c) => `${userName(c.user_id)} (${c.created_at.slice(0, 10)}): ${c.text}`).join("\n") : "(keine)"}
${prev ? `\nFRÜHERE KI-KURZFASSUNG (zur Orientierung; berücksichtige neue Kommentare und Infos):\n${JSON.parse(prev.data).kurzfassung}\n` : ""}
ANDERE KARTEN AUF DEM BOARD (für „ähnliche Karten“)
${boardOverview(all, card.id)}

Analysiere die Idee und speichere das Ergebnis mit „analyse_speichern“.`;

    const images = await loadImagesForAi(env, cardId);
    const out = await runUntilTool(env, {
      system: SYSTEM_RULES,
      user: images.length
        ? [
            ...images.map((im): Anthropic.Beta.BetaContentBlockParam => ({ type: "image", source: { type: "base64", media_type: im.mime, data: im.base64 } })),
            { type: "text", text: user + `\n\nOben ${images.length === 1 ? "ist ein Foto" : `sind ${images.length} Fotos`} zur Karte angehängt – beziehe sie in die Analyse ein.` },
          ]
        : user,
      tools: [
        { type: "web_search_20260209", name: "web_search", max_uses: 3, user_location: { type: "approximate", country: "DE", timezone: "Europe/Berlin" } },
        ANALYSIS_TOOL(catNames),
      ],
      toolName: "analyse_speichern",
      maxTokens: 16000,
    });

    const raw = out.input as Omit<AiAnalysisData, "naechste_schritte" | "massnahmen" | "risiken" | "offene_fragen" | "infos" | "aehnliche_karten" | "quellen"> & {
      naechste_schritte: string[];
      massnahmen: string[];
      risiken: string[];
      offene_fragen: string[];
      infos: { text: string; ist_schaetzung: boolean; quellen: Source[] }[];
      aehnliche_karten: { karte_id: number; grund: string; zusammenfuehren_empfohlen: boolean }[];
    };
    // Nur Quellen behalten, die die Websuche tatsächlich geliefert hat
    const found = searchedSources(out.content);
    const keepSources = (list: Source[]) => list.filter((s) => found.has(s.url)).map((s) => ({ titel: s.titel || found.get(s.url) || s.url, url: s.url }));
    const byId = new Map(all.map((c) => [c.id, c]));
    const items = (list: string[], prefix: string) => list.filter((t) => t?.trim()).map((text, i) => ({ id: `${prefix}:${i + 1}`, text: text.trim() }));
    const infos = raw.infos.map((x, i) => ({ id: `info:${i + 1}`, text: x.text, ist_schaetzung: !!x.ist_schaetzung, quellen: keepSources(x.quellen ?? []) }));
    const data: AiAnalysisData = {
      kurzfassung: raw.kurzfassung.trim(),
      kategorie: raw.kategorie,
      nutzen: { wert: clampScore(raw.nutzen.wert), begruendung: raw.nutzen.begruendung },
      aufwand: { wert: clampScore(raw.aufwand.wert), begruendung: raw.aufwand.begruendung },
      naechste_schritte: items(raw.naechste_schritte, "schritt"),
      massnahmen: items(raw.massnahmen, "massnahme"),
      infos,
      kosten_zeit: raw.kosten_zeit,
      risiken: items(raw.risiken, "risiko"),
      offene_fragen: items(raw.offene_fragen, "frage"),
      aehnliche_karten: raw.aehnliche_karten
        .filter((a) => a.karte_id !== card.id && byId.has(a.karte_id))
        .map((a) => ({ ...a, titel: byId.get(a.karte_id)!.title })),
      quellen: [...new Map(infos.flatMap((x) => x.quellen).map((s) => [s.url, s])).values()],
    };

    const version = ((await db.prepare("SELECT MAX(version) AS v FROM ai_analyses WHERE card_id = ?").bind(cardId).first<{ v: number | null }>())?.v ?? 0) + 1;
    await db
      .prepare("INSERT INTO ai_analyses (card_id, version, created_at, requested_by, model, data, cost_usd) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(cardId, version, nowIso(), requestedBy, out.model, JSON.stringify(data), out.cost)
      .run();
    await db.prepare("UPDATE cards SET ai_status = 'done', ai_error = NULL, ai_attempts = 0, updated_at = ? WHERE id = ?").bind(nowIso(), cardId).run();
    await addHistory(db, cardId, null, "ki-analyse", `Fassung ${version} erstellt`);
  } catch (e) {
    const msg = e instanceof Anthropic.APIError ? `KI-Dienst: ${e.status ?? ""} ${e.message}` : (e as Error).message;
    await db.prepare("UPDATE cards SET ai_status = 'error', ai_error = ?, updated_at = ? WHERE id = ?").bind(msg.slice(0, 300), nowIso(), cardId).run();
    throw e;
  } finally {
    await bumpRev(db);
  }
}

// ---------------------------------------------------------------------------
// Brainstorming: Themen bündeln + 3 fehlende Ideen

const BRAINSTORM_TOOL: Anthropic.Beta.BetaTool = {
  name: "buendelung_speichern",
  description: "Speichert die Bündelung der Brainstorming-Ideen. Am Ende genau einmal aufrufen.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["themen", "zusatz_ideen"],
    properties: {
      themen: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["titel", "karten_ids", "hinweis"],
          properties: {
            titel: { type: "string" },
            karten_ids: { type: "array", items: { type: "integer" } },
            hinweis: { type: "string", description: "Kurz: was die Ideen verbindet, ggf. welche sich zum Zusammenführen eignen" },
          },
        },
      },
      zusatz_ideen: {
        type: "array",
        description: "Genau 3 Ideen, die zum Thema noch fehlen",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["titel", "beschreibung"],
          properties: { titel: { type: "string" }, beschreibung: { type: "string" } },
        },
      },
    },
  },
};

export async function analyzeBrainstorm(env: Env, id: number): Promise<void> {
  const db = env.DB;
  const b = await db.prepare("SELECT * FROM brainstorms WHERE id = ?").bind(id).first<{ topic: string; ai_data: string | null }>();
  if (!b) return;
  const over = await budgetExceeded(db);
  if (over) {
    await db.prepare("UPDATE brainstorms SET ai_status = 'error', ai_error = ? WHERE id = ?").bind(over, id).run();
    await bumpRev(db);
    return;
  }
  await db.prepare("UPDATE brainstorms SET ai_status = 'running' WHERE id = ?").bind(id).run();
  await bumpRev(db);
  try {
    const ideas = await loadCards(db, "c.brainstorm_id = ? AND c.merged_into IS NULL AND c.deleted_at IS NULL", [id]);
    const context = await getSetting(db, "company_context");
    const out = await runUntilTool(env, {
      system: SYSTEM_RULES.replace(/- Schließe die Arbeit immer ab.*$/m, "- Schließe die Arbeit immer ab, indem du das Werkzeug „buendelung_speichern“ genau einmal aufrufst."),
      user: `FIRMENKONTEXT
${context || "(nicht angegeben)"}

BRAINSTORMING-THEMA: ${b.topic}

GESAMMELTE IDEEN
${ideas.map((c) => `#${c.id}: ${c.title}${c.description ? " – " + c.description : ""}`).join("\n")}

Bündele die Ideen zu sinnvollen Themen (jede Idee genau einem Thema zuordnen, über die Nummer). Weise im Hinweis darauf hin, welche Ideen sich so stark überschneiden, dass man sie zusammenführen sollte. Schlage dann genau 3 weitere Ideen vor, die zum Thema noch fehlen. Speichere mit „buendelung_speichern“.`,
      tools: [BRAINSTORM_TOOL],
      toolName: "buendelung_speichern",
      maxTokens: 12000,
    });
    const raw = out.input as { themen: { titel: string; karten_ids: number[]; hinweis: string }[]; zusatz_ideen: { titel: string; beschreibung: string }[] };
    const valid = new Set(ideas.map((c) => c.id));
    const data: BrainstormAi = {
      themen: raw.themen.map((t) => ({ ...t, karten_ids: t.karten_ids.filter((x) => valid.has(x)) })).filter((t) => t.karten_ids.length),
      zusatz_ideen: raw.zusatz_ideen.slice(0, 3).map((z, i) => ({ id: `z${Date.now()}-${i}`, ...z, status: "offen" as const })),
    };
    await db.prepare("UPDATE brainstorms SET ai_status = 'done', ai_error = NULL, ai_data = ? WHERE id = ?").bind(JSON.stringify(data), id).run();
  } catch (e) {
    await db.prepare("UPDATE brainstorms SET ai_status = 'error', ai_error = ? WHERE id = ?").bind((e as Error).message.slice(0, 300), id).run();
    throw e;
  } finally {
    await bumpRev(db);
  }
}

// ---------------------------------------------------------------------------
// Vorschlag übernehmen

function findItem(a: AiAnalysis, itemId: string): string | null {
  const d = a.data;
  const lists = [...d.naechste_schritte, ...d.massnahmen, ...d.risiken, ...d.offene_fragen];
  const hit = lists.find((x) => x.id === itemId) ?? d.infos.find((x) => x.id === itemId);
  if (hit) return hit.text;
  const m = itemId.match(/^naechster:(.+)$/);
  if (m) return d.naechste_schritte.find((x) => x.id === m[1])?.text ?? null;
  return null;
}

export async function applyAiItem(c: Context<AppEnv>, a: AiAnalysis, itemId: string, edited?: string): Promise<void> {
  const db = c.env.DB;
  const me = c.get("user");
  const d = a.data;
  const now = nowIso();
  const touch = () => db.prepare("UPDATE cards SET updated_at = ? WHERE id = ?").bind(now, a.card_id).run();
  const log = (detail: string) => addHistory(db, a.card_id, me, "ki-übernommen", detail);
  const addCheck = async (text: string) => {
    const max = await db.prepare("SELECT MAX(position) AS p FROM checklist_items WHERE card_id = ?").bind(a.card_id).first<{ p: number | null }>();
    await db
      .prepare("INSERT INTO checklist_items (card_id, text, position, source, created_at) VALUES (?, ?, ?, 'ai', ?)")
      .bind(a.card_id, text, (max?.p ?? 0) + 1, now)
      .run();
  };

  if (itemId === "kurzfassung") {
    const text = edited ?? d.kurzfassung;
    const card = await db.prepare("SELECT description FROM cards WHERE id = ?").bind(a.card_id).first<{ description: string }>();
    const desc = card?.description?.trim() ? `${card.description}\n\nKurzfassung: ${text}` : text;
    await db.prepare("UPDATE cards SET description = ? WHERE id = ?").bind(desc, a.card_id).run();
    await log("Kurzfassung in die Beschreibung übernommen");
  } else if (itemId === "kategorie") {
    const name = (edited ?? d.kategorie.vorschlag).trim();
    let cat = await db.prepare("SELECT id FROM categories WHERE lower(name) = lower(?)").bind(name).first<{ id: number }>();
    if (!cat) {
      const max = await db.prepare("SELECT MAX(sort) AS s FROM categories").first<{ s: number | null }>();
      const r = await db.prepare("INSERT INTO categories (name, color, sort) VALUES (?, '#64748b', ?)").bind(name, (max?.s ?? 0) + 1).run();
      cat = { id: Number(r.meta.last_row_id) };
    }
    await db.prepare("UPDATE cards SET category_id = ? WHERE id = ?").bind(cat.id, a.card_id).run();
    await log(`Kategorie „${name}“ übernommen`);
  } else if (itemId === "nutzen" || itemId === "aufwand") {
    const v = clampScore(edited ?? d[itemId].wert);
    await db.prepare(`UPDATE cards SET ${itemId === "nutzen" ? "benefit" : "effort"} = ? WHERE id = ?`).bind(v, a.card_id).run();
    await log(`${itemId === "nutzen" ? "Nutzen" : "Aufwand"} ${v} übernommen`);
  } else if (itemId.startsWith("naechster:")) {
    const text = edited ?? findItem(a, itemId) ?? "";
    await db.prepare("UPDATE cards SET next_step = ? WHERE id = ?").bind(text, a.card_id).run();
    await log(`Als nächster Schritt gesetzt: ${text.slice(0, 60)}`);
  } else if (/^(schritt|massnahme):/.test(itemId)) {
    const text = edited ?? findItem(a, itemId) ?? "";
    await addCheck(text);
    await log(`In Checkliste übernommen: ${text.slice(0, 60)}`);
  } else if (/^(risiko|frage):/.test(itemId)) {
    const text = edited ?? findItem(a, itemId) ?? "";
    await addCheck(`Klären: ${text}`);
    await log(`Als Klärungspunkt übernommen: ${text.slice(0, 60)}`);
  } else if (itemId.startsWith("info:") || itemId === "kosten_zeit") {
    const info = d.infos.find((x) => x.id === itemId);
    let text = edited ?? (itemId === "kosten_zeit" ? d.kosten_zeit.text : info?.text ?? "");
    if (info?.quellen.length) text += "\nQuellen: " + info.quellen.map((q) => q.url).join(", ");
    const label = (itemId === "kosten_zeit" ? d.kosten_zeit.ist_schaetzung : info?.ist_schaetzung) ? " (Schätzung)" : "";
    await db
      .prepare("INSERT INTO comments (card_id, user_id, text, created_at) VALUES (?, ?, ?, ?)")
      .bind(a.card_id, me, `Aus KI-Analyse übernommen${label}:\n${text}`, now)
      .run();
    await log("Info als Kommentar übernommen");
  }
  await touch();
}
