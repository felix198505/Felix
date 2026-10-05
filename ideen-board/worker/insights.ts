import { Hono } from "hono";
import type Anthropic from "@anthropic-ai/sdk";
import { COLUMNS, columnTitle, priorityOf, PRIORITY_LABEL, userName, USERS } from "../shared/types";
import type { Review, ReviewData, Stats, TranscriptIdea } from "../shared/types";
import { budgetExceeded, runUntilTool, SYSTEM_RULES } from "./ai";
import { bumpRev, getSetting, loadCards, nowIso } from "./db";
import type { AppEnv, Env } from "./env";

export const insightsApi = new Hono<AppEnv>();

const days = (iso: string | null) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : 0);

// ---------------------------------------------------------------------------
// KI-Wochenrückblick

const REVIEW_TOOL: Anthropic.Beta.BetaTool = {
  name: "rueckblick_speichern",
  description: "Speichert den Wochenrückblick über das Board. Am Ende genau einmal aufrufen.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["zusammenfassung", "fokus", "quick_wins", "haengt_fest", "doppelungen", "kombinationen"],
    properties: {
      zusammenfassung: { type: "string", description: "2–4 Sätze: Wo steht das Board, was ist diese Woche wichtig?" },
      fokus: { type: "string", description: "Eine klare Empfehlung, worauf sich das Team diese Woche konzentrieren sollte." },
      quick_wins: {
        type: "array",
        description: "Liegengebliebene Ideen mit hohem Nutzen und geringem Aufwand",
        items: { type: "object", additionalProperties: false, required: ["karte_id", "grund"], properties: { karte_id: { type: "integer" }, grund: { type: "string" } } },
      },
      haengt_fest: {
        type: "array",
        description: "Karten, die lange ohne Bewegung sind oder auf Entscheidung warten",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["karte_id", "grund", "vorschlag"],
          properties: { karte_id: { type: "integer" }, grund: { type: "string" }, vorschlag: { type: "string" } },
        },
      },
      doppelungen: {
        type: "array",
        description: "Karten, die inhaltlich dasselbe meinen und zusammengeführt werden sollten",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["karten_ids", "grund"],
          properties: { karten_ids: { type: "array", items: { type: "integer" } }, grund: { type: "string" } },
        },
      },
      kombinationen: {
        type: "array",
        description: "Verwandte Ideen, die gemeinsam umgesetzt mehr bringen",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["karten_ids", "idee"],
          properties: { karten_ids: { type: "array", items: { type: "integer" } }, idee: { type: "string" } },
        },
      },
    },
  },
};

export async function createReview(env: Env, requestedBy: string | null): Promise<Review> {
  const db = env.DB;
  const over = await budgetExceeded(db);
  if (over) throw new Error(over);
  const cards = (await loadCards(db)).filter((c) => c.column_key !== "verworfen");
  const context = await getSetting(db, "company_context");
  const lines = cards.map((c) => {
    const p = PRIORITY_LABEL[priorityOf(c.benefit, c.effort)];
    const done = c.checklist.filter((i) => i.done).length;
    return `#${c.id} [${columnTitle(c.column_key)}, seit ${days(c.column_since ?? c.updated_at)} Tagen, zuletzt geändert vor ${days(c.updated_at)} Tagen] ${c.title} | Priorität ${p} (Nutzen ${c.benefit ?? "–"}, Aufwand ${c.effort ?? "–"}) | Checkliste ${done}/${c.checklist.length} | Kommentare ${c.comment_count}${c.follow_up ? ` | Wiedervorlage ${c.follow_up}` : ""}${c.votes.length ? ` | Stimmen: ${c.votes.map((v) => `${userName(v.user_id)} ${v.vote}`).join(", ")}` : ""}${c.ai_summary ? ` | ${c.ai_summary}` : ""}`;
  });
  const out = await runUntilTool(env, {
    system: SYSTEM_RULES.replace(/- Schließe die Arbeit immer ab.*$/m, "- Schließe die Arbeit immer ab, indem du das Werkzeug „rueckblick_speichern“ genau einmal aufrufst."),
    user: `FIRMENKONTEXT
${context || "(nicht angegeben)"}

HEUTE: ${nowIso().slice(0, 10)}

ALLE AKTIVEN KARTEN AUF DEM BOARD
${lines.join("\n") || "(keine)"}

Erstelle einen kurzen Wochenrückblick für das Team. Nenne nur Karten-Nummern, die oben vorkommen. Lieber wenige, treffende Punkte als viele. Leere Listen sind in Ordnung.`,
    tier: "main",
    tools: [REVIEW_TOOL],
    toolName: "rueckblick_speichern",
    maxTokens: 12000,
  });
  const valid = new Set(cards.map((c) => c.id));
  const raw = out.input as ReviewData;
  const data: ReviewData = {
    zusammenfassung: raw.zusammenfassung,
    fokus: raw.fokus,
    quick_wins: raw.quick_wins.filter((x) => valid.has(x.karte_id)),
    haengt_fest: raw.haengt_fest.filter((x) => valid.has(x.karte_id)),
    doppelungen: raw.doppelungen.map((x) => ({ ...x, karten_ids: x.karten_ids.filter((i) => valid.has(i)) })).filter((x) => x.karten_ids.length > 1),
    kombinationen: raw.kombinationen.map((x) => ({ ...x, karten_ids: x.karten_ids.filter((i) => valid.has(i)) })).filter((x) => x.karten_ids.length > 1),
  };
  const r = await db.prepare("INSERT INTO reviews (created_at, requested_by, data) VALUES (?, ?, ?)").bind(nowIso(), requestedBy, JSON.stringify(data)).run();
  await bumpRev(db);
  return { id: Number(r.meta.last_row_id), created_at: nowIso(), requested_by: requestedBy, data };
}

export async function latestReview(db: D1Database): Promise<Review | null> {
  const r = await db.prepare("SELECT * FROM reviews ORDER BY id DESC LIMIT 1").first<{ id: number; created_at: string; requested_by: string | null; data: string }>();
  return r ? { ...r, data: JSON.parse(r.data) } : null;
}

insightsApi.get("/reviews/latest", async (c) => c.json(await latestReview(c.env.DB)));

insightsApi.post("/reviews", async (c) => {
  try {
    return c.json(await createReview(c.env, c.get("user")));
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
});

// ---------------------------------------------------------------------------
// Ideen aus Transkript (z. B. Plaud) herausziehen

const TRANSCRIPT_TOOL: Anthropic.Beta.BetaTool = {
  name: "ideen_speichern",
  description: "Speichert die im Gespräch gefundenen Ideen. Am Ende genau einmal aufrufen.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["ideen"],
    properties: {
      ideen: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["titel", "beschreibung", "zitat", "aehnlich_karte_id"],
          properties: {
            titel: { type: "string", description: "Kurzer, klarer Titel (max. 8 Wörter)" },
            beschreibung: { type: "string", description: "1–3 Sätze, was gemeint ist und warum" },
            zitat: { type: "string", description: "Die Stelle im Gespräch, wörtlich und kurz" },
            aehnlich_karte_id: { type: "integer", description: "Nummer einer bereits vorhandenen, sehr ähnlichen Karte, sonst 0" },
          },
        },
      },
    },
  },
};

insightsApi.post("/import/transcript", async (c) => {
  const { text } = await c.req.json<{ text: string }>();
  const t = (text ?? "").trim();
  if (t.length < 30) return c.json({ error: "Bitte ein Transkript oder längere Notizen einfügen" }, 400);
  if (!c.env.ANTHROPIC_API_KEY) return c.json({ error: "Kein API-Schlüssel hinterlegt" }, 400);
  const over = await budgetExceeded(c.env.DB);
  if (over) return c.json({ error: over }, 400);
  const cards = await loadCards(c.env.DB);
  const context = await getSetting(c.env.DB, "company_context");
  const out = await runUntilTool(c.env, {
    system: SYSTEM_RULES.replace(/- Schließe die Arbeit immer ab.*$/m, "- Schließe die Arbeit immer ab, indem du das Werkzeug „ideen_speichern“ genau einmal aufrufst."),
    user: `FIRMENKONTEXT
${context || "(nicht angegeben)"}

VORHANDENE KARTEN (Nummer: Titel)
${cards.map((k) => `#${k.id}: ${k.title}`).join("\n") || "(keine)"}

TRANSKRIPT / NOTIZEN
"""
${t.slice(0, 120000)}
"""

Finde alle konkreten Ideen, Vorschläge und Verbesserungen, die im Gespräch genannt werden – auch beiläufige. Keine Aufgaben aus dem Tagesgeschäft (z. B. „Herrn Meier zurückrufen“), nur Ideen, die das Unternehmen weiterbringen. Wenn eine Idee schon als Karte existiert, trage deren Nummer bei aehnlich_karte_id ein.`,
    tier: "fast",
    tools: [TRANSCRIPT_TOOL],
    toolName: "ideen_speichern",
    maxTokens: 12000,
  });
  const valid = new Set(cards.map((k) => k.id));
  const ideas = (out.input as { ideen: TranscriptIdea[] }).ideen.map((i) => ({ ...i, aehnlich_karte_id: valid.has(i.aehnlich_karte_id) ? i.aehnlich_karte_id : 0 }));
  return c.json({ ideen: ideas, cost_usd: out.cost });
});

// ---------------------------------------------------------------------------
// Kennzahlen für das Dashboard

insightsApi.get("/stats", async (c) => {
  const db = c.env.DB;
  const cards = await loadCards(db);
  const months: string[] = [];
  const d = new Date();
  for (let i = 5; i >= 0; i--) months.push(new Date(d.getFullYear(), d.getMonth() - i, 1).toISOString().slice(0, 7));
  const created = await db.prepare("SELECT substr(created_at, 1, 7) AS m, COUNT(*) AS n FROM cards GROUP BY m").all<{ m: string; n: number }>();
  const moves = await db
    .prepare("SELECT substr(created_at, 1, 7) AS m, detail FROM history WHERE action = 'verschoben' AND created_at >= ?")
    .bind(months[0] + "-01")
    .all<{ m: string; detail: string }>();
  const countMoves = (target: string) => {
    const map = new Map<string, number>();
    for (const r of moves.results) if (r.detail.includes(`→ ${target}`)) map.set(r.m, (map.get(r.m) ?? 0) + 1);
    return map;
  };
  const decided = countMoves("Umsetzen");
  const done = countMoves("Erledigt");
  const createdMap = new Map(created.results.map((r) => [r.m, r.n]));

  const decisionTimes = await db
    .prepare(
      `SELECT c.created_at AS a, MIN(h.created_at) AS b FROM cards c JOIN history h ON h.card_id = c.id
       WHERE h.action = 'verschoben' AND h.detail LIKE '%→ Umsetzen%' GROUP BY c.id`,
    )
    .all<{ a: string; b: string }>();
  const avgDays = decisionTimes.results.length
    ? Math.round(decisionTimes.results.reduce((s, r) => s + (new Date(r.b).getTime() - new Date(r.a).getTime()) / 86400000, 0) / decisionTimes.results.length)
    : null;

  const stats: Stats = {
    months: months.map((m) => ({ month: m, created: createdMap.get(m) ?? 0, decided: decided.get(m) ?? 0, done: done.get(m) ?? 0 })),
    columns: COLUMNS.map((col) => ({ key: col.key, title: col.title, count: cards.filter((k) => k.column_key === col.key).length })),
    people: USERS.map((u) => ({
      id: u.id,
      created: cards.filter((k) => k.created_by === u.id).length,
      assigned_open: cards.filter((k) => k.assignee === u.id && ["ausarbeiten", "entscheiden", "umsetzen"].includes(k.column_key)).length,
      comments: 0,
    })),
    quick_wins_open: cards.filter((k) => priorityOf(k.benefit, k.effort) === "quickwin" && ["eingang", "ausarbeiten", "entscheiden"].includes(k.column_key)).length,
    stuck: cards.filter((k) => k.column_key === "entscheiden" && days(k.column_since) >= 7).length,
    avg_days_to_decision: avgDays,
    total: cards.length,
  };
  const comments = await db.prepare("SELECT user_id, COUNT(*) AS n FROM comments GROUP BY user_id").all<{ user_id: string; n: number }>();
  for (const p of stats.people) p.comments = comments.results.find((r) => r.user_id === p.id)?.n ?? 0;
  return c.json(stats);
});
