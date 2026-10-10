import { heute } from "../shared/types";
import { loadFaelle, nowIso } from "./db";
import type { Env } from "./env";

const KEEP_DAYS = 30;

/**
 * Kompletter Datenbestand als JSON. Die Fälle haben dieselben Feldnamen wie beim Import,
 * die Datei lässt sich also unverändert wieder einlesen. Anhänge nur als Liste (Dateien bleiben im Speicher).
 */
export async function buildExport(db: D1Database): Promise<string> {
  const faelle = (await loadFaelle(db)).map(({ anhang_count: _a, schritte, verlauf, ...f }) => ({
    ...f,
    schritte: schritte.map(({ t, done, done_by, done_at, created_by, created_at }) => ({ t, done: !!done, done_by, done_at, created_by, created_at })),
    verlauf: verlauf.map(({ d, t, created_by, created_at }) => ({ d, t, created_by, created_at })),
  }));
  const [users, aenderungen, anhaenge] = await db.batch([
    db.prepare("SELECT id, name, rolle, email, aktiv, erinnerungen, created_at FROM users"),
    db.prepare("SELECT * FROM aenderungen ORDER BY id"),
    db.prepare("SELECT id, fall_id, user_id, created_at, mime, size, name, r2_key FROM anhaenge"),
  ]);
  return JSON.stringify(
    { exportiert_am: nowIso(), version: 1, anzahl: faelle.length, faelle, users: users.results, aenderungen: aenderungen.results, anhaenge: anhaenge.results },
    null,
    1,
  );
}

/** Nächtliche Sicherung in R2 (sonst in der Datenbank), 30 Tage aufbewahrt */
export async function nightlyBackup(env: Env): Promise<string> {
  const key = `sicherungen/backup-${heute()}.json`;
  const data = await buildExport(env.DB);
  const cutoff = Date.now() - KEEP_DAYS * 24 * 3600 * 1000;
  if (!env.FILES) {
    await env.DB.prepare("INSERT INTO backups (key, created_at, data) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET created_at = excluded.created_at, data = excluded.data").bind(key, nowIso(), data).run();
    await env.DB.prepare("DELETE FROM backups WHERE created_at < ?").bind(new Date(cutoff).toISOString()).run();
    return key;
  }
  await env.FILES.put(key, data, { httpMetadata: { contentType: "application/json" } });
  const list = await env.FILES.list({ prefix: "sicherungen/" });
  for (const o of list.objects) if (o.uploaded.getTime() < cutoff) await env.FILES.delete(o.key);
  return key;
}

export async function listBackups(env: Env): Promise<{ key: string; size: number; uploaded: string }[]> {
  if (!env.FILES) return (await env.DB.prepare("SELECT key, LENGTH(data) AS size, created_at AS uploaded FROM backups ORDER BY key DESC").all<{ key: string; size: number; uploaded: string }>()).results;
  const list = await env.FILES.list({ prefix: "sicherungen/" });
  return list.objects.map((o) => ({ key: o.key, size: o.size, uploaded: o.uploaded.toISOString() })).sort((a, b) => b.key.localeCompare(a.key));
}

export async function getBackup(env: Env, key: string): Promise<BodyInit | null> {
  if (!key.startsWith("sicherungen/")) return null;
  if (!env.FILES) return (await env.DB.prepare("SELECT data FROM backups WHERE key = ?").bind(key).first<{ data: string }>())?.data ?? null;
  return (await env.FILES.get(key))?.body ?? null;
}
