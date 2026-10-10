import { Hono } from "hono";
import { darf, heute } from "../shared/types";
import type { Anhang } from "../shared/types";
import { nur } from "./auth";
import { audit, nowIso } from "./db";
import type { AppEnv, Env } from "./env";

export const anhaengeApi = new Hono<AppEnv>();

const ALLOWED = ["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"];
/** Ohne R2 liegen Dateien in der Datenbank; dort ist eine Zeile auf 2 MB begrenzt */
const maxBytes = (env: Env) => (env.FILES ? 20_000_000 : 1_800_000);

const bearbeiten = nur(darf.bearbeiten, "Anhänge hinzufügen oder entfernen");

export async function listAnhaenge(db: D1Database, fallId: string): Promise<Anhang[]> {
  return (await db.prepare("SELECT id, fall_id, user_id, created_at, mime, size, name FROM anhaenge WHERE fall_id = ? ORDER BY created_at").bind(fallId).all<Anhang>()).results;
}

anhaengeApi.get("/faelle/:id/anhaenge", async (c) => c.json(await listAnhaenge(c.env.DB, (c.req.param("id") ?? ""))));

anhaengeApi.post("/faelle/:id/anhaenge", bearbeiten, async (c) => {
  const fallId = (c.req.param("id") ?? "");
  const db = c.env.DB;
  const mime = (c.req.header("content-type") ?? "").split(";")[0].trim();
  if (!ALLOWED.includes(mime)) return c.json({ error: "Nur Fotos (JPG, PNG, WebP, GIF) und PDF" }, 400);
  if (!(await db.prepare("SELECT 1 FROM faelle WHERE id = ?").bind(fallId).first())) return c.json({ error: "Fall nicht gefunden" }, 404);
  const buf = await c.req.arrayBuffer();
  if (buf.byteLength === 0) return c.json({ error: "Leere Datei" }, 400);
  const max = maxBytes(c.env);
  if (buf.byteLength > max) return c.json({ error: `Datei zu groß (max. ${(max / 1_000_000).toLocaleString("de-DE")} MB)` }, 400);
  const name = decodeURIComponent(c.req.header("x-filename") ?? "datei").replace(/[\\/\r\n"]/g, "_").slice(0, 120) || "datei";
  let r2Key: string | null = null;
  if (c.env.FILES) {
    r2Key = `anhaenge/${crypto.randomUUID()}`;
    await c.env.FILES.put(r2Key, buf, { httpMetadata: { contentType: mime } });
  }
  const now = nowIso();
  await db.batch([
    db.prepare("INSERT INTO anhaenge (fall_id, user_id, created_at, mime, size, name, data, r2_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(fallId, c.get("user"), now, mime, buf.byteLength, name, r2Key ? null : buf, r2Key),
    db.prepare("UPDATE faelle SET stand = ?, updated_at = ?, updated_by = ? WHERE id = ?").bind(heute(), now, c.get("user"), fallId),
    audit(db, fallId, c.get("user"), "Anhang neu", `${name} (${Math.round(buf.byteLength / 1024)} KB)`),
  ]);
  return c.json(await listAnhaenge(db, fallId));
});

async function readBytes(env: Env, row: { data: unknown; r2_key: string | null }): Promise<ArrayBuffer | ReadableStream | null> {
  if (row.r2_key) return env.FILES ? ((await env.FILES.get(row.r2_key))?.body ?? null) : null;
  if (!row.data) return null;
  if (row.data instanceof ArrayBuffer) return row.data;
  return Uint8Array.from(row.data as number[]).buffer;
}

anhaengeApi.get("/anhaenge/:aid", async (c) => {
  const row = await c.env.DB.prepare("SELECT mime, name, data, r2_key FROM anhaenge WHERE id = ?").bind(Number((c.req.param("aid") ?? ""))).first<{ mime: string; name: string; data: unknown; r2_key: string | null }>();
  if (!row) return c.json({ error: "Nicht gefunden" }, 404);
  const bytes = await readBytes(c.env, row);
  if (!bytes) return c.json({ error: "Datei fehlt" }, 404);
  return new Response(bytes, {
    headers: {
      "content-type": row.mime,
      "content-disposition": `${c.req.query("download") ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(row.name)}`,
      "cache-control": "private, max-age=86400",
      "x-content-type-options": "nosniff",
      "content-security-policy": "sandbox",
    },
  });
});

anhaengeApi.delete("/anhaenge/:aid", bearbeiten, async (c) => {
  const db = c.env.DB;
  const aid = Number((c.req.param("aid") ?? ""));
  const row = await db.prepare("SELECT fall_id, name, r2_key FROM anhaenge WHERE id = ?").bind(aid).first<{ fall_id: string; name: string; r2_key: string | null }>();
  if (!row) return c.json({ error: "Nicht gefunden" }, 404);
  if (row.r2_key && c.env.FILES) await c.env.FILES.delete(row.r2_key);
  await db.batch([db.prepare("DELETE FROM anhaenge WHERE id = ?").bind(aid), audit(db, row.fall_id, c.get("user"), "Anhang entfernt", row.name)]);
  return c.json(await listAnhaenge(db, row.fall_id));
});
