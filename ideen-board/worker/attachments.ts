import { Hono } from "hono";
import type { Attachment } from "../shared/types";
import { addHistory, nowIso } from "./db";
import type { AppEnv, Env } from "./env";

const MAX_BYTES = 1_800_000; // die App verkleinert Fotos vorher auf ca. 1600 px
const ALLOWED = ["image/jpeg", "image/png", "image/webp", "image/gif"];

export const attachmentsApi = new Hono<AppEnv>();

export async function listAttachments(db: D1Database, cardId: number): Promise<Attachment[]> {
  const r = await db
    .prepare("SELECT id, card_id, user_id, created_at, mime, size, name FROM attachments WHERE card_id = ? ORDER BY created_at")
    .bind(cardId)
    .all<Attachment>();
  return r.results;
}

attachmentsApi.post("/cards/:id/attachments", async (c) => {
  const cardId = Number(c.req.param("id"));
  const mime = (c.req.header("content-type") ?? "").split(";")[0].trim();
  if (!ALLOWED.includes(mime)) return c.json({ error: "Nur Bilder (JPG, PNG, WebP, GIF)" }, 400);
  const buf = await c.req.arrayBuffer();
  if (buf.byteLength === 0) return c.json({ error: "Leere Datei" }, 400);
  if (buf.byteLength > MAX_BYTES) return c.json({ error: "Bild zu groß (max. 1,8 MB)" }, 400);
  const name = decodeURIComponent(c.req.header("x-filename") ?? "foto");
  const db = c.env.DB;
  let r2Key: string | null = null;
  if (c.env.BACKUPS) {
    r2Key = `fotos/${cardId}/${crypto.randomUUID()}`;
    await c.env.BACKUPS.put(r2Key, buf, { httpMetadata: { contentType: mime } });
  }
  await db
    .prepare("INSERT INTO attachments (card_id, user_id, created_at, mime, size, name, data, r2_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(cardId, c.get("user"), nowIso(), mime, buf.byteLength, name.slice(0, 120), r2Key ? null : buf, r2Key)
    .run();
  await db.prepare("UPDATE cards SET updated_at = ? WHERE id = ?").bind(nowIso(), cardId).run();
  await addHistory(db, cardId, c.get("user"), "foto", `Foto hinzugefügt (${Math.round(buf.byteLength / 1024)} KB)`);
  return c.json(await listAttachments(db, cardId));
});

async function readBytes(env: Env, row: { data: unknown; r2_key: string | null }): Promise<ArrayBuffer | null> {
  if (row.r2_key && env.BACKUPS) {
    const obj = await env.BACKUPS.get(row.r2_key);
    return obj ? await obj.arrayBuffer() : null;
  }
  if (!row.data) return null;
  if (row.data instanceof ArrayBuffer) return row.data;
  return Uint8Array.from(row.data as number[]).buffer;
}

attachmentsApi.get("/attachments/:id", async (c) => {
  const row = await c.env.DB.prepare("SELECT mime, data, r2_key FROM attachments WHERE id = ?")
    .bind(Number(c.req.param("id")))
    .first<{ mime: string; data: unknown; r2_key: string | null }>();
  if (!row) return c.json({ error: "Nicht gefunden" }, 404);
  const bytes = await readBytes(c.env, row);
  if (!bytes) return c.json({ error: "Nicht gefunden" }, 404);
  return new Response(bytes, { headers: { "content-type": row.mime, "cache-control": "private, max-age=31536000, immutable" } });
});

attachmentsApi.delete("/attachments/:id", async (c) => {
  const db = c.env.DB;
  const row = await db.prepare("SELECT card_id, r2_key FROM attachments WHERE id = ?").bind(Number(c.req.param("id"))).first<{ card_id: number; r2_key: string | null }>();
  if (!row) return c.json({ error: "Nicht gefunden" }, 404);
  if (row.r2_key && c.env.BACKUPS) await c.env.BACKUPS.delete(row.r2_key);
  await db.prepare("DELETE FROM attachments WHERE id = ?").bind(Number(c.req.param("id"))).run();
  await db.prepare("UPDATE cards SET updated_at = ? WHERE id = ?").bind(nowIso(), row.card_id).run();
  await addHistory(db, row.card_id, c.get("user"), "foto", "Foto entfernt");
  return c.json(await listAttachments(db, row.card_id));
});

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Die neuesten 3 Fotos einer Karte für die KI-Analyse */
export async function loadImagesForAi(env: Env, cardId: number): Promise<{ mime: "image/jpeg" | "image/png" | "image/webp" | "image/gif"; base64: string }[]> {
  const rows = await env.DB.prepare("SELECT mime, data, r2_key FROM attachments WHERE card_id = ? ORDER BY created_at DESC LIMIT 3")
    .bind(cardId)
    .all<{ mime: string; data: unknown; r2_key: string | null }>();
  const out = [];
  for (const r of rows.results) {
    const bytes = await readBytes(env, r);
    if (bytes) out.push({ mime: r.mime as "image/jpeg", base64: toBase64(bytes) });
  }
  return out;
}
