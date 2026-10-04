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
  if (!env.BACKUPS) {
    // Ohne R2: Sicherung in einer eigenen Tabelle der Datenbank
    await env.DB.prepare("INSERT INTO backups (key, created_at, data) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET created_at = excluded.created_at, data = excluded.data")
      .bind(key, nowIso(), await buildExport(env.DB))
      .run();
    await env.DB.prepare("DELETE FROM backups WHERE created_at < ?").bind(new Date(Date.now() - KEEP_DAYS * 24 * 3600 * 1000).toISOString()).run();
    return key;
  }
  await env.BACKUPS.put(key, await buildExport(env.DB), { httpMetadata: { contentType: "application/json" } });
  const cutoff = Date.now() - KEEP_DAYS * 24 * 3600 * 1000;
  const list = await env.BACKUPS.list({ prefix: "backup-" });
  for (const obj of list.objects) if (obj.uploaded.getTime() < cutoff) await env.BACKUPS.delete(obj.key);
  return key;
}

export async function listBackups(env: Env): Promise<{ key: string; size: number; uploaded: string }[]> {
  if (!env.BACKUPS) {
    const r = await env.DB.prepare("SELECT key, LENGTH(data) AS size, created_at AS uploaded FROM backups ORDER BY key DESC").all<{ key: string; size: number; uploaded: string }>();
    return r.results;
  }
  const list = await env.BACKUPS.list({ prefix: "backup-" });
  return list.objects.map((o) => ({ key: o.key, size: o.size, uploaded: o.uploaded.toISOString() })).sort((a, b) => b.key.localeCompare(a.key));
}

export async function getBackup(env: Env, key: string): Promise<BodyInit | null> {
  if (!env.BACKUPS) return (await env.DB.prepare("SELECT data FROM backups WHERE key = ?").bind(key).first<{ data: string }>())?.data ?? null;
  return (await env.BACKUPS.get(key))?.body ?? null;
}
