import type { Context, Next } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Rolle } from "../shared/types";
import { getSetting, setSetting } from "./db";
import type { AppEnv, Env } from "./env";

const COOKIE = "rk_session";
const SESSION_DAYS = 30;
const MAX_FAILS = 8; // Fehlversuche pro IP in 15 Minuten

const enc = new TextEncoder();

export function b64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function unb64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}

/** Vergleich zweier Geheimnisse ohne Laufzeit-Hinweise */
export async function secretEqual(a: string, b: string): Promise<boolean> {
  const k = crypto.getRandomValues(new Uint8Array(16)).join(",");
  return safeEqual(await hmac(k, a), await hmac(k, b));
}

const ITERATIONS = 100000;

/** Erzeugt einen Hash im Format pbkdf2$<iterationen>$<salt>$<hash> */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: ITERATIONS }, key, 256);
  return `pbkdf2$${ITERATIONS}$${b64(salt)}$${b64(bits)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (stored.startsWith("plain$")) return secretEqual(password, stored.slice(6));
  const [algo, iterStr, saltB64, hashB64] = stored.trim().split("$");
  if (algo !== "pbkdf2" || !iterStr || !saltB64 || !hashB64) return false;
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: unb64(saltB64), iterations: Number(iterStr) }, key, 256);
  return safeEqual(b64(bits), hashB64);
}

interface UserRow {
  id: string;
  rolle: Rolle;
  aktiv: number;
  password_hash: string | null;
}

/** Passwort eines Nutzers: in der App gesetzt (Datenbank) oder als Cloudflare-Secret (PASSWORD_HASH_FELIX bzw. PASSWORD_FELIX) */
export function passwordFor(env: Env, u: UserRow): string | undefined {
  if (u.password_hash) return u.password_hash;
  const hash = env[`PASSWORD_HASH_${u.id.toUpperCase()}`];
  if (hash) return hash;
  const plain = env[`PASSWORD_${u.id.toUpperCase()}`];
  return plain ? "plain$" + plain : undefined;
}

/** Signaturschlüssel für Sitzungen: SESSION_SECRET oder ein einmal erzeugter Zufallswert in der Datenbank */
async function sessionSecret(env: Env): Promise<string> {
  if (env.SESSION_SECRET) return env.SESSION_SECRET;
  let s = await getSetting(env.DB, "session_secret");
  if (!s) {
    s = b64(crypto.getRandomValues(new Uint8Array(32)));
    await env.DB.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('session_secret', ?)").bind(s).run();
    s = (await getSetting(env.DB, "session_secret"))!;
  }
  return s;
}

const getUser = (db: D1Database, id: string) => db.prepare("SELECT id, rolle, aktiv, password_hash FROM users WHERE id = ?").bind(id).first<UserRow>();

async function readSession(c: Context<AppEnv>): Promise<UserRow | null> {
  const raw = getCookie(c, COOKIE);
  if (!raw) return null;
  const [user, exp, sig] = raw.split(".");
  if (!user || !exp || !sig || Number(exp) < Date.now()) return null;
  const u = await getUser(c.env.DB, user);
  // Deaktivierte Nutzer sind sofort draußen; Passwortwechsel macht alte Sitzungen ungültig
  if (!u || !u.aktiv) return null;
  const pw = passwordFor(c.env, u);
  if (!pw) return null;
  const expected = await hmac(await sessionSecret(c.env), `${user}.${exp}.${pw}`);
  return safeEqual(sig, expected) ? u : null;
}

export async function requireAuth(c: Context<AppEnv>, next: Next) {
  const path = c.req.path;
  if (path === "/api/login") return next();
  // Import-Schnittstelle: Zugriff auch mit dem Import-Schlüssel (für Claude)
  const bearer = c.req.header("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (bearer && path === "/api/import" && c.env.IMPORT_TOKEN && (await secretEqual(bearer, c.env.IMPORT_TOKEN))) {
    c.set("user", null);
    c.set("rolle", "inhaber");
    return next();
  }
  const u = await readSession(c);
  if (!u) return c.json({ error: "Nicht angemeldet" }, 401);
  c.set("user", u.id);
  c.set("rolle", u.rolle);
  return next();
}

/** Rollenprüfung für einzelne Endpunkte */
export function nur(pruef: (r: Rolle) => boolean, was: string) {
  return async (c: Context<AppEnv>, next: Next) => {
    if (!pruef(c.get("rolle"))) return c.json({ error: `Keine Berechtigung: ${was}` }, 403);
    return next();
  };
}

export async function login(c: Context<AppEnv>) {
  const db = c.env.DB;
  const ip = c.req.header("cf-connecting-ip") ?? "local";
  const since = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const fails = await db.prepare("SELECT COUNT(*) AS n FROM login_failures WHERE ip = ? AND at > ?").bind(ip, since).first<{ n: number }>();
  if ((fails?.n ?? 0) >= MAX_FAILS) return c.json({ error: "Zu viele Fehlversuche. Bitte 15 Minuten warten." }, 429);

  const body = await c.req.json<{ user?: string; password?: string }>().catch(() => ({}) as { user?: string; password?: string });
  const name = String(body.user ?? "").trim().toLowerCase();
  // Anmeldung mit Kürzel (felix) oder angezeigtem Namen (Felix)
  const u = name ? await db.prepare("SELECT id, rolle, aktiv, password_hash FROM users WHERE aktiv = 1 AND (id = ? OR lower(name) = ?)").bind(name, name).first<UserRow>() : null;
  const pw = u ? passwordFor(c.env, u) : undefined;
  const ok = !!u && !!pw && (await verifyPassword(String(body.password ?? ""), pw));
  if (!ok) {
    await db.prepare("INSERT INTO login_failures (ip, at) VALUES (?, ?)").bind(ip, new Date().toISOString()).run();
    await db.prepare("DELETE FROM login_failures WHERE at < ?").bind(since).run();
    await new Promise((r) => setTimeout(r, 800));
    return c.json({ error: "Name oder Passwort falsch" }, 401);
  }
  const exp = Date.now() + SESSION_DAYS * 24 * 3600 * 1000;
  const sig = await hmac(await sessionSecret(c.env), `${u.id}.${exp}.${pw}`);
  const url = new URL(c.req.url);
  setCookie(c, COOKIE, `${u.id}.${exp}.${sig}`, { httpOnly: true, secure: url.protocol === "https:", sameSite: "Lax", path: "/", maxAge: SESSION_DAYS * 24 * 3600 });
  // Adresse für Links in Erinnerungen merken
  if (url.protocol === "https:" && !c.env.APP_URL) await setSetting(db, "app_url", url.origin);
  return c.json({ ok: true, user: u.id });
}

export function logout(c: Context<AppEnv>) {
  deleteCookie(c, COOKIE, { path: "/" });
  return c.json({ ok: true });
}
