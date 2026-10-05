import { Hono } from "hono";
import { buildExport } from "./backup";
import { bumpRev, nowIso } from "./db";
import type { AppEnv, Env } from "./env";

export const restoreApi = new Hono<AppEnv>();

// Reihenfolge wegen Fremdschlüsseln: erst Eltern, dann Kinder einfügen – beim Löschen umgekehrt
const INSERT_ORDER = ["categories", "brainstorms", "cards", "favorites", "checklist_items", "comments", "votes", "history", "ai_analyses", "ai_feedback", "attachments", "reviews"];
const KEEP_SETTINGS = new Set(["rev", "app_url"]);
const BATCH = 40;

type Row = Record<string, unknown>;

async function columnsOf(db: D1Database, table: string): Promise<string[]> {
  const r = await db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
  return r.results.map((c) => c.name);
}

function hexToBytes(hex: string): ArrayBuffer {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out.buffer;
}

async function runBatches(db: D1Database, stmts: D1PreparedStatement[]) {
  for (let i = 0; i < stmts.length; i += BATCH) await db.batch(stmts.slice(i, i + BATCH));
}

/** Spielt einen JSON-Export komplett zurück. Vorher wird der aktuelle Stand gesichert. */
export async function restoreFromExport(env: Env, data: Record<string, unknown>, userId: string): Promise<{ safetyKey: string; counts: Record<string, number> }> {
  const db = env.DB;
  if (!Array.isArray(data.cards) || !Array.isArray(data.categories)) throw new Error("Das ist keine gültige Ideen-Board-Sicherung");

  // 1) Sicherheitskopie des aktuellen Stands
  const safetyKey = `backup-vor-wiederherstellung-${Date.now()}.json`;
  const current = await buildExport(db);
  if (env.BACKUPS) await env.BACKUPS.put(safetyKey, current, { httpMetadata: { contentType: "application/json" } });
  else await db.prepare("INSERT INTO backups (key, created_at, data) VALUES (?, ?, ?)").bind(safetyKey, nowIso(), current).run();

  // 2) Nutzer aus der Sicherung, die es nicht mehr gibt, anlegen (Fremdschlüssel)
  const users = (data.users as Row[] | undefined) ?? [];
  const stmts: D1PreparedStatement[] = users.map((u) =>
    db.prepare("INSERT INTO users (id, name, email) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET email = COALESCE(excluded.email, users.email)").bind(u.id, u.name ?? u.id, u.email ?? null),
  );

  // 3) Bestehende Daten löschen (Kinder zuerst)
  stmts.push(db.prepare("UPDATE cards SET merged_into = NULL"));
  for (const t of [...INSERT_ORDER].reverse()) stmts.push(db.prepare(`DELETE FROM ${t}`));
  await runBatches(db, stmts);

  // 4) Einfügen – nur Spalten, die es im aktuellen Schema gibt (ältere Sicherungen bleiben nutzbar)
  const counts: Record<string, number> = {};
  for (const t of INSERT_ORDER) {
    const rows = (data[t] as Row[] | undefined) ?? [];
    counts[t] = rows.length;
    if (!rows.length) continue;
    const cols = await columnsOf(db, t);
    const ins: D1PreparedStatement[] = [];
    for (const row of rows) {
      const r: Row = { ...row };
      if (t === "cards") r.merged_into = null; // wird unten gesetzt
      if (t === "attachments") r.data = typeof row.data_hex === "string" && row.data_hex ? hexToBytes(row.data_hex) : null;
      const use = cols.filter((c) => c in r);
      ins.push(db.prepare(`INSERT INTO ${t} (${use.join(", ")}) VALUES (${use.map(() => "?").join(", ")})`).bind(...use.map((c) => r[c] ?? null)));
    }
    await runBatches(db, ins);
  }
  const merges = ((data.cards as Row[]) ?? []).filter((c) => c.merged_into);
  await runBatches(db, merges.map((c) => db.prepare("UPDATE cards SET merged_into = ? WHERE id = ?").bind(c.merged_into, c.id)));

  // 5) Einstellungen (ohne Änderungszähler und Adresse)
  const settings = ((data.settings as Row[] | undefined) ?? []).filter((s) => !KEEP_SETTINGS.has(String(s.key)) && !String(s.key).startsWith("vapid_"));
  await runBatches(
    db,
    settings.map((s) => db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(s.key, String(s.value))),
  );
  await db
    .prepare("INSERT INTO history (card_id, user_id, action, detail, created_at) SELECT id, ?, 'wiederhergestellt', ?, ? FROM cards")
    .bind(userId, `Datenstand vom ${String(data.exportiert_am ?? "?").slice(0, 10)} zurückgespielt`, nowIso())
    .run();
  await bumpRev(db);
  return { safetyKey, counts };
}

restoreApi.post("/restore", async (c) => {
  let data: Record<string, unknown>;
  try {
    data = await c.req.json();
  } catch {
    return c.json({ error: "Datei ist kein gültiges JSON" }, 400);
  }
  try {
    return c.json(await restoreFromExport(c.env, data, c.get("user")));
  } catch (e) {
    return c.json({ error: "Wiederherstellung fehlgeschlagen: " + (e as Error).message }, 400);
  }
});
