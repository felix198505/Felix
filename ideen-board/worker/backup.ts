import { nowIso } from "./db";
import type { Env } from "./env";

const TABLES = ["users", "categories", "brainstorms", "cards", "favorites", "checklist_items", "comments", "votes", "history", "ai_analyses", "settings"];
const KEEP_DAYS = 30;

/** Kompletter Datenbestand als JSON (für Download und nächtliches Backup) */
export async function buildExport(db: D1Database): Promise<string> {
  const out: Record<string, unknown> = { exportiert_am: nowIso(), version: 1 };
  for (const t of TABLES) out[t] = (await db.prepare(`SELECT * FROM ${t}`).all()).results;
  return JSON.stringify(out, null, 2);
}

/** Legt eine Sicherung im R2-Speicher ab und löscht Sicherungen, die älter als 30 Tage sind. */
export async function nightlyBackup(env: Env): Promise<string> {
  const key = `backup-${new Date().toISOString().slice(0, 10)}.json`;
  await env.BACKUPS.put(key, await buildExport(env.DB), { httpMetadata: { contentType: "application/json" } });
  const cutoff = Date.now() - KEEP_DAYS * 24 * 3600 * 1000;
  const list = await env.BACKUPS.list({ prefix: "backup-" });
  for (const obj of list.objects) if (obj.uploaded.getTime() < cutoff) await env.BACKUPS.delete(obj.key);
  return key;
}
