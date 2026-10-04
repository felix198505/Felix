import { Hono } from "hono";
import type { Context } from "hono";
import { assigneeLabel, ASSIGNEE_GROUPS, COLUMNS, columnTitle, priorityOf, PRIORITY_LABEL, userName, USERS, VOTERS } from "../shared/types";
import type { AiItemState, Card, ColumnKey } from "../shared/types";
import { addHistory, getRev, loadBoard, loadCard, loadCardDetail, loadCards, nowIso, parseAnalysis, setSetting } from "./db";
import type { AppEnv } from "./env";
import { applyAiItem, kickAnalysis, kickBrainstorm } from "./ai";
import { seedExamples } from "./examples";
import { buildExport, getBackup, listBackups, nightlyBackup } from "./backup";

export const api = new Hono<AppEnv>();

type C = Context<AppEnv>;
const COLUMN_KEYS = COLUMNS.map((c) => c.key) as string[];
const USER_IDS = USERS.map((u) => u.id) as string[];

const FIELD_LABELS: Record<string, string> = {
  title: "Titel",
  description: "Beschreibung",
  category_id: "Kategorie",
  benefit: "Nutzen",
  effort: "Aufwand",
  assignee: "Zuständig",
  next_step: "Nächster Schritt",
  follow_up: "Wiedervorlage",
  reject_reason: "Verwerfungsgrund",
};

function bad(c: C, msg: string, status: 400 | 404 = 400) {
  return c.json({ error: msg }, status);
}

function idParam(c: C, name = "id"): number {
  return Number(c.req.param(name));
}

function clampScore(v: unknown): number | null {
  if (v === null || v === "" || v === undefined) return null;
  const n = Math.round(Number(v));
  return n >= 1 && n <= 5 ? n : null;
}

function short(v: unknown, max = 60): string {
  if (v === null || v === undefined || v === "") return "–";
  const s = String(v).replace(/\s+/g, " ");
  return s.length > max ? s.slice(0, max) + "…" : s;
}

async function categoryName(db: D1Database, id: number | null): Promise<string> {
  if (!id) return "–";
  const r = await db.prepare("SELECT name FROM categories WHERE id = ?").bind(id).first<{ name: string }>();
  return r?.name ?? "–";
}

async function displayValue(db: D1Database, field: string, v: unknown): Promise<string> {
  if (field === "category_id") return categoryName(db, (v as number) ?? null);
  if (field === "assignee") return v ? assigneeLabel(String(v)) : "–";
  return short(v);
}

// ---------- Board ----------

api.get("/board", async (c) => {
  const since = Number(c.req.query("rev") ?? "-1");
  const rev = await getRev(c.env.DB);
  if (since === rev) return c.json({ unchanged: true, rev });
  return c.json(await loadBoard(c.env, c.get("user")));
});

api.get("/me", (c) => c.json({ user: c.get("user"), name: userName(c.get("user")) }));

// ---------- Karten ----------

export async function createCard(
  c: C,
  input: { title: string; description?: string; column_key?: string; brainstorm_id?: number | null; deferred?: boolean },
): Promise<number> {
  const db = c.env.DB;
  const col = COLUMN_KEYS.includes(input.column_key ?? "") ? input.column_key! : "eingang";
  const min = await db
    .prepare("SELECT MIN(position) AS p FROM cards WHERE column_key = ?")
    .bind(col)
    .first<{ p: number | null }>();
  const now = nowIso();
  const res = await db
    .prepare(
      `INSERT INTO cards (title, description, column_key, position, created_by, created_at, updated_at, brainstorm_id, ai_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.title.trim().slice(0, 300),
      (input.description ?? "").trim(),
      col,
      (min?.p ?? 1) - 1,
      c.get("user"),
      now,
      now,
      input.brainstorm_id ?? null,
      input.deferred ? "deferred" : "pending",
    )
    .run();
  const id = Number(res.meta.last_row_id);
  await addHistory(db, id, c.get("user"), "erstellt", `in „${columnTitle(col)}“`);
  return id;
}

api.post("/cards", async (c) => {
  const body = await c.req.json<{ title?: string; description?: string; column_key?: string }>();
  if (!body.title?.trim()) return bad(c, "Titel fehlt");
  const id = await createCard(c, { title: body.title, description: body.description, column_key: body.column_key });
  kickAnalysis(c, id, c.get("user"));
  return c.json(await loadCard(c.env.DB, id));
});

api.get("/cards/:id", async (c) => {
  const d = await loadCardDetail(c.env.DB, idParam(c));
  return d ? c.json(d) : bad(c, "Karte nicht gefunden", 404);
});

api.patch("/cards/:id", async (c) => {
  const db = c.env.DB;
  const id = idParam(c);
  const card = await loadCard(db, id);
  if (!card) return bad(c, "Karte nicht gefunden", 404);
  const body = await c.req.json<Record<string, unknown>>();
  const updates: Record<string, unknown> = {};
  for (const field of Object.keys(FIELD_LABELS)) {
    if (!(field in body)) continue;
    let v = body[field];
    if (field === "benefit" || field === "effort") v = clampScore(v);
    else if (field === "category_id") v = v ? Number(v) : null;
    else if (field === "assignee") v = v && USER_IDS.concat(ASSIGNEE_GROUPS.map((g) => g.id)).includes(String(v)) ? String(v) : null;
    else if (field === "follow_up") v = typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
    else v = String(v ?? "");
    if (field === "title" && !(v as string).trim()) continue;
    if ((card as unknown as Record<string, unknown>)[field] !== v) updates[field] = v;
  }
  const fields = Object.keys(updates);
  if (fields.length === 0) return c.json(card);
  await db
    .prepare(`UPDATE cards SET ${fields.map((f) => `${f} = ?`).join(", ")}, updated_at = ? WHERE id = ?`)
    .bind(...fields.map((f) => updates[f]), nowIso(), id)
    .run();
  for (const f of fields) {
    const before = await displayValue(db, f, (card as unknown as Record<string, unknown>)[f]);
    const after = await displayValue(db, f, updates[f]);
    const detail = f === "description" ? "Beschreibung bearbeitet" : `${FIELD_LABELS[f]}: ${before} → ${after}`;
    await addHistory(db, id, c.get("user"), "geändert", detail);
  }
  return c.json(await loadCard(db, id));
});

async function moveCard(c: C, card: Card, column: ColumnKey, position: number | null, rejectReason?: string) {
  const db = c.env.DB;
  let pos = position;
  if (pos === null || !Number.isFinite(pos)) {
    const min = await db
      .prepare("SELECT MIN(position) AS p FROM cards WHERE column_key = ?")
      .bind(column)
      .first<{ p: number | null }>();
    pos = (min?.p ?? 1) - 1;
  }
  const sets = ["column_key = ?", "position = ?", "updated_at = ?"];
  const binds: unknown[] = [column, pos, nowIso()];
  if (rejectReason !== undefined) {
    sets.push("reject_reason = ?");
    binds.push(rejectReason);
  }
  await db.prepare(`UPDATE cards SET ${sets.join(", ")} WHERE id = ?`).bind(...binds, card.id).run();
  if (card.column_key !== column) {
    let detail = `${columnTitle(card.column_key)} → ${columnTitle(column)}`;
    if (column === "verworfen" && rejectReason) detail += ` (Grund: ${rejectReason})`;
    await addHistory(db, card.id, c.get("user"), "verschoben", detail);
    if (card.column_key === "entscheiden") await db.prepare("DELETE FROM votes WHERE card_id = ?").bind(card.id).run();
  }
}

api.post("/cards/:id/move", async (c) => {
  const db = c.env.DB;
  const card = await loadCard(db, idParam(c));
  if (!card) return bad(c, "Karte nicht gefunden", 404);
  const body = await c.req.json<{ column_key: string; position?: number | null; reject_reason?: string }>();
  if (!COLUMN_KEYS.includes(body.column_key)) return bad(c, "Unbekannte Spalte");
  await moveCard(c, card, body.column_key as ColumnKey, body.position ?? null, body.reject_reason);
  return c.json(await loadCard(db, card.id));
});

api.post("/cards/:id/favorite", async (c) => {
  const db = c.env.DB;
  const id = idParam(c);
  const me = c.get("user");
  const exists = await db.prepare("SELECT 1 FROM favorites WHERE card_id = ? AND user_id = ?").bind(id, me).first();
  if (exists) await db.prepare("DELETE FROM favorites WHERE card_id = ? AND user_id = ?").bind(id, me).run();
  else await db.prepare("INSERT INTO favorites (card_id, user_id) VALUES (?, ?)").bind(id, me).run();
  return c.json(await loadCard(db, id));
});

// ---------- Kommentare ----------

api.post("/cards/:id/comments", async (c) => {
  const db = c.env.DB;
  const id = idParam(c);
  const { text } = await c.req.json<{ text: string }>();
  if (!text?.trim()) return bad(c, "Kommentar ist leer");
  await db
    .prepare("INSERT INTO comments (card_id, user_id, text, created_at) VALUES (?, ?, ?, ?)")
    .bind(id, c.get("user"), text.trim(), nowIso())
    .run();
  await addHistory(db, id, c.get("user"), "kommentiert", short(text, 80));
  return c.json(await loadCardDetail(db, id));
});

// ---------- Checkliste ----------

export async function addChecklistItem(c: C, cardId: number, text: string, source: "user" | "ai") {
  const db = c.env.DB;
  const max = await db
    .prepare("SELECT MAX(position) AS p FROM checklist_items WHERE card_id = ?")
    .bind(cardId)
    .first<{ p: number | null }>();
  await db
    .prepare("INSERT INTO checklist_items (card_id, text, position, source, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(cardId, text.trim(), (max?.p ?? 0) + 1, source, nowIso())
    .run();
}

api.post("/cards/:id/checklist", async (c) => {
  const id = idParam(c);
  const { text } = await c.req.json<{ text: string }>();
  if (!text?.trim()) return bad(c, "Text fehlt");
  await addChecklistItem(c, id, text, "user");
  await addHistory(c.env.DB, id, c.get("user"), "checkliste", `Punkt hinzugefügt: ${short(text)}`);
  return c.json(await loadCard(c.env.DB, id));
});

api.patch("/checklist/:id", async (c) => {
  const db = c.env.DB;
  const item = await db.prepare("SELECT * FROM checklist_items WHERE id = ?").bind(idParam(c)).first<{ card_id: number; text: string; done: number }>();
  if (!item) return bad(c, "Punkt nicht gefunden", 404);
  const body = await c.req.json<{ text?: string; done?: boolean }>();
  if (body.done !== undefined) {
    await db.prepare("UPDATE checklist_items SET done = ? WHERE id = ?").bind(body.done ? 1 : 0, idParam(c)).run();
    await addHistory(db, item.card_id, c.get("user"), "checkliste", `${body.done ? "Erledigt" : "Wieder offen"}: ${short(item.text)}`);
  }
  if (body.text?.trim()) {
    await db.prepare("UPDATE checklist_items SET text = ? WHERE id = ?").bind(body.text.trim(), idParam(c)).run();
  }
  return c.json(await loadCard(db, item.card_id));
});

api.delete("/checklist/:id", async (c) => {
  const db = c.env.DB;
  const item = await db.prepare("SELECT * FROM checklist_items WHERE id = ?").bind(idParam(c)).first<{ card_id: number; text: string }>();
  if (!item) return bad(c, "Punkt nicht gefunden", 404);
  await db.prepare("DELETE FROM checklist_items WHERE id = ?").bind(idParam(c)).run();
  await addHistory(db, item.card_id, c.get("user"), "checkliste", `Punkt entfernt: ${short(item.text)}`);
  return c.json(await loadCard(db, item.card_id));
});

// ---------- Besprechung / Abstimmung ----------

api.post("/cards/:id/vote", async (c) => {
  const db = c.env.DB;
  const card = await loadCard(db, idParam(c));
  if (!card) return bad(c, "Karte nicht gefunden", 404);
  const { vote, reject_reason } = await c.req.json<{ vote: "ja" | "nein" | "parken"; reject_reason?: string }>();
  if (!["ja", "nein", "parken"].includes(vote)) return bad(c, "Ungültige Stimme");
  const me = c.get("user");
  if (!VOTERS.includes(me)) return bad(c, "Keine Berechtigung zum Abstimmen");
  await db
    .prepare(
      "INSERT INTO votes (card_id, user_id, vote, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(card_id, user_id) DO UPDATE SET vote = excluded.vote, created_at = excluded.created_at",
    )
    .bind(card.id, me, vote, nowIso())
    .run();
  const label = { ja: "Ja", nein: "Nein", parken: "Parken" }[vote];
  await addHistory(db, card.id, me, "abgestimmt", label + (reject_reason ? ` (${reject_reason})` : ""));
  if (reject_reason && vote === "nein") {
    await db.prepare("UPDATE cards SET reject_reason = ? WHERE id = ?").bind(reject_reason, card.id).run();
  }

  const votes = (await db.prepare("SELECT user_id, vote FROM votes WHERE card_id = ?").bind(card.id).all<{ user_id: string; vote: string }>()).results.filter((v) => VOTERS.includes(v.user_id));
  let result: "offen" | "uneinig" | ColumnKey = "offen";
  if (votes.length >= VOTERS.length) {
    const all = new Set(votes.map((v) => v.vote));
    if (all.size === 1) {
      const target = ({ ja: "umsetzen", nein: "verworfen", parken: "parkplatz" } as const)[vote];
      const fresh = (await loadCard(db, card.id))!;
      await moveCard(c, fresh, target, null, target === "verworfen" ? fresh.reject_reason || "Gemeinsam abgelehnt" : undefined);
      result = target;
    } else result = "uneinig";
  }
  return c.json({ card: await loadCard(db, card.id), result });
});

// ---------- Zusammenführen ----------

api.post("/cards/:id/merge", async (c) => {
  const db = c.env.DB;
  const targetId = idParam(c);
  const { source_ids } = await c.req.json<{ source_ids: number[] }>();
  const target = await loadCard(db, targetId);
  if (!target) return bad(c, "Karte nicht gefunden", 404);
  const me = c.get("user");
  let description = target.description;
  for (const sid of source_ids ?? []) {
    if (sid === targetId) continue;
    const src = await loadCard(db, sid);
    if (!src || src.merged_into) continue;
    description += `\n\n— Zusammengeführt aus „${src.title}“ —${src.description ? "\n" + src.description : ""}`;
    await db.batch([
      db.prepare("UPDATE comments SET card_id = ? WHERE card_id = ?").bind(targetId, sid),
      db.prepare("UPDATE checklist_items SET card_id = ? WHERE card_id = ?").bind(targetId, sid),
      db.prepare("INSERT OR IGNORE INTO favorites (card_id, user_id) SELECT ?, user_id FROM favorites WHERE card_id = ?").bind(targetId, sid),
      db.prepare("DELETE FROM votes WHERE card_id = ?").bind(sid),
      db.prepare("UPDATE cards SET merged_into = ?, updated_at = ? WHERE id = ?").bind(targetId, nowIso(), sid),
      db
        .prepare(
          `UPDATE cards SET
             category_id = COALESCE(category_id, (SELECT category_id FROM cards WHERE id = ?)),
             benefit = COALESCE(benefit, (SELECT benefit FROM cards WHERE id = ?)),
             effort = COALESCE(effort, (SELECT effort FROM cards WHERE id = ?))
           WHERE id = ?`,
        )
        .bind(sid, sid, sid, targetId),
    ]);
    await addHistory(db, sid, me, "zusammengeführt", `in „${target.title}“ (#${targetId})`);
    await addHistory(db, targetId, me, "zusammengeführt", `„${src.title}“ (#${sid}) übernommen`);
  }
  await db.prepare("UPDATE cards SET description = ?, updated_at = ? WHERE id = ?").bind(description, nowIso(), targetId).run();
  return c.json(await loadCardDetail(db, targetId));
});

// ---------- KI ----------

api.post("/cards/:id/analyze", async (c) => {
  const db = c.env.DB;
  const id = idParam(c);
  await db.prepare("UPDATE cards SET ai_status = 'pending', ai_error = NULL, ai_attempts = 0 WHERE id = ?").bind(id).run();
  await addHistory(db, id, c.get("user"), "ki-analyse", "Neue Analyse angefordert");
  kickAnalysis(c, id, c.get("user"));
  return c.json(await loadCard(db, id));
});

api.post("/analyses/:id/item", async (c) => {
  const db = c.env.DB;
  const row = await db.prepare("SELECT * FROM ai_analyses WHERE id = ?").bind(idParam(c)).first();
  if (!row) return bad(c, "Analyse nicht gefunden", 404);
  const analysis = parseAnalysis(row);
  const body = await c.req.json<{ item_id: string; state: "uebernommen" | "verworfen" | "offen"; text?: string }>();
  const state: AiItemState = { ...analysis.item_state };
  if (body.state === "offen") delete state[body.item_id];
  else state[body.item_id] = body.state;
  if (body.state === "uebernommen") await applyAiItem(c, analysis, body.item_id, body.text);
  else if (body.state === "verworfen")
    await addHistory(db, analysis.card_id, c.get("user"), "ki-verworfen", `KI-Vorschlag verworfen (${body.item_id})`);
  await db.prepare("UPDATE ai_analyses SET item_state = ? WHERE id = ?").bind(JSON.stringify(state), analysis.id).run();
  return c.json(await loadCardDetail(db, analysis.card_id));
});

// ---------- Kategorien ----------

api.post("/categories", async (c) => {
  const { name, color } = await c.req.json<{ name: string; color: string }>();
  if (!name?.trim()) return bad(c, "Name fehlt");
  const max = await c.env.DB.prepare("SELECT MAX(sort) AS s FROM categories").first<{ s: number | null }>();
  await c.env.DB.prepare("INSERT INTO categories (name, color, sort) VALUES (?, ?, ?)")
    .bind(name.trim(), color || "#22c55e", (max?.s ?? 0) + 1)
    .run();
  return c.json({ ok: true });
});

api.patch("/categories/:id", async (c) => {
  const { name, color } = await c.req.json<{ name?: string; color?: string }>();
  if (name?.trim()) await c.env.DB.prepare("UPDATE categories SET name = ? WHERE id = ?").bind(name.trim(), idParam(c)).run();
  if (color) await c.env.DB.prepare("UPDATE categories SET color = ? WHERE id = ?").bind(color, idParam(c)).run();
  return c.json({ ok: true });
});

api.delete("/categories/:id", async (c) => {
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE cards SET category_id = NULL WHERE category_id = ?").bind(idParam(c)),
    c.env.DB.prepare("DELETE FROM categories WHERE id = ?").bind(idParam(c)),
  ]);
  return c.json({ ok: true });
});

// ---------- Einstellungen ----------

api.put("/settings", async (c) => {
  const body = await c.req.json<{ company_context?: string; ai_monthly_limit_eur?: string }>();
  if (body.company_context !== undefined) await setSetting(c.env.DB, "company_context", body.company_context);
  if (body.ai_monthly_limit_eur !== undefined) {
    const n = Number(body.ai_monthly_limit_eur);
    if (Number.isFinite(n) && n >= 0) await setSetting(c.env.DB, "ai_monthly_limit_eur", String(n));
  }
  return c.json({ ok: true });
});

// ---------- Brainstorming ----------

api.post("/brainstorms", async (c) => {
  const { topic } = await c.req.json<{ topic: string }>();
  if (!topic?.trim()) return bad(c, "Thema fehlt");
  const res = await c.env.DB.prepare("INSERT INTO brainstorms (topic, created_by, created_at) VALUES (?, ?, ?)")
    .bind(topic.trim(), c.get("user"), nowIso())
    .run();
  return c.json({ id: Number(res.meta.last_row_id) });
});

api.post("/brainstorms/:id/ideas", async (c) => {
  const bid = idParam(c);
  const { title } = await c.req.json<{ title: string }>();
  if (!title?.trim()) return bad(c, "Idee ist leer");
  // Im Brainstorming wird erst nach dem Sammeln analysiert
  const id = await createCard(c, { title, brainstorm_id: bid, deferred: true });
  return c.json(await loadCard(c.env.DB, id));
});

api.post("/brainstorms/:id/status", async (c) => {
  const db = c.env.DB;
  const bid = idParam(c);
  const { status } = await c.req.json<{ status: "sammeln" | "sortieren" | "fertig" }>();
  if (!["sammeln", "sortieren", "fertig"].includes(status)) return bad(c, "Ungültiger Status");
  await db.prepare("UPDATE brainstorms SET status = ? WHERE id = ?").bind(status, bid).run();
  if (status === "sortieren") {
    // Sammeln abgeschlossen: jetzt alle Ideen analysieren und bündeln
    await db.prepare("UPDATE cards SET ai_status = 'pending' WHERE brainstorm_id = ? AND ai_status = 'deferred'").bind(bid).run();
    await db.prepare("UPDATE brainstorms SET ai_status = 'pending', ai_error = NULL WHERE id = ?").bind(bid).run();
    kickBrainstorm(c, bid);
  }
  return c.json({ ok: true });
});

api.post("/brainstorms/:id/reanalyze", async (c) => {
  const bid = idParam(c);
  await c.env.DB.prepare("UPDATE brainstorms SET ai_status = 'pending', ai_error = NULL WHERE id = ?").bind(bid).run();
  kickBrainstorm(c, bid);
  return c.json({ ok: true });
});

api.post("/brainstorms/:id/extra/:ideaId", async (c) => {
  const db = c.env.DB;
  const bid = idParam(c);
  const ideaId = c.req.param("ideaId");
  const { action } = await c.req.json<{ action: "anlegen" | "verwerfen" }>();
  const row = await db.prepare("SELECT ai_data FROM brainstorms WHERE id = ?").bind(bid).first<{ ai_data: string | null }>();
  if (!row?.ai_data) return bad(c, "Keine KI-Daten", 404);
  const data = JSON.parse(row.ai_data);
  const idea = data.zusatz_ideen?.find((z: { id: string }) => z.id === ideaId);
  if (!idea) return bad(c, "Idee nicht gefunden", 404);
  if (action === "anlegen" && idea.status !== "angelegt") {
    const id = await createCard(c, { title: idea.titel, description: idea.beschreibung, brainstorm_id: bid });
    await addHistory(db, id, c.get("user"), "ki-übernommen", "Aus KI-Zusatzidee im Brainstorming angelegt");
    kickAnalysis(c, id, c.get("user"));
    idea.status = "angelegt";
  } else if (action === "verwerfen") idea.status = "verworfen";
  await db.prepare("UPDATE brainstorms SET ai_data = ? WHERE id = ?").bind(JSON.stringify(data), bid).run();
  return c.json({ ok: true });
});

// ---------- Beispielkarten ----------

api.post("/examples", async (c) => {
  const n = await seedExamples(c);
  return n ? c.json({ created: n }) : bad(c, "Beispielkarten wurden bereits angelegt");
});

// ---------- Export ----------

api.get("/export.json", async (c) => {
  const date = new Date().toISOString().slice(0, 10);
  return new Response(await buildExport(c.env.DB), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="ideen-board-backup-${date}.json"`,
    },
  });
});

api.get("/backups", async (c) => c.json(await listBackups(c.env)));

api.get("/backups/:key", async (c) => {
  const body = await getBackup(c.env, c.req.param("key"));
  if (!body) return bad(c, "Sicherung nicht gefunden", 404);
  return new Response(body, {
    headers: { "content-type": "application/json", "content-disposition": `attachment; filename="${c.req.param("key")}"` },
  });
});

api.post("/backups", async (c) => c.json({ key: await nightlyBackup(c.env) }));

api.get("/export.csv", async (c) => {
  const db = c.env.DB;
  const cards = await loadCards(db);
  const cats = new Map(
    (await db.prepare("SELECT id, name FROM categories").all<{ id: number; name: string }>()).results.map((r) => [r.id, r.name]),
  );
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const header = ["ID", "Titel", "Beschreibung", "Spalte", "Kategorie", "Nutzen", "Aufwand", "Priorität", "Ersteller", "Erstellt am", "Zuständig", "Nächster Schritt", "Wiedervorlage", "Checkliste", "Kommentare", "Favorit von", "Verwerfungsgrund"];
  const lines = [header.map(esc).join(";")];
  for (const k of cards) {
    lines.push(
      [
        k.id,
        k.title,
        k.description,
        columnTitle(k.column_key),
        k.category_id ? cats.get(k.category_id) : "",
        k.benefit ?? "",
        k.effort ?? "",
        PRIORITY_LABEL[priorityOf(k.benefit, k.effort)],
        userName(k.created_by),
        k.created_at.slice(0, 10),
        assigneeLabel(k.assignee),
        k.next_step,
        k.follow_up ?? "",
        k.checklist.map((i) => `${i.done ? "[x]" : "[ ]"} ${i.text}`).join(" | "),
        k.comment_count,
        k.favorite_by.map(userName).join(", "),
        k.reject_reason,
      ]
        .map(esc)
        .join(";"),
    );
  }
  const date = new Date().toISOString().slice(0, 10);
  return new Response("﻿" + lines.join("\r\n"), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="ideen-board-${date}.csv"`,
    },
  });
});
