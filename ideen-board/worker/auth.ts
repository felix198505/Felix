import type { Context, Next } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { USERS } from "../shared/types";
import type { AppEnv, Env } from "./env";

const COOKIE = "ib_session";
const SESSION_DAYS = 30;
const MAX_FAILS = 8; // Fehlversuche pro IP in 15 Minuten

const enc = new TextEncoder();

function b64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function unb64(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/** Prüft ein Passwort gegen einen Hash im Format pbkdf2$<iterationen>$<salt>$<hash> */
async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (stored.startsWith("plain$")) {
    // Vergleich über HMAC, damit die Laufzeit nichts über das Passwort verrät
    const k = crypto.getRandomValues(new Uint8Array(16)).join(",");
    return safeEqual(await hmac(k, password), await hmac(k, stored.slice(6)));
  }
  const [algo, iterStr, saltB64, hashB64] = stored.trim().split("$");
  if (algo !== "pbkdf2" || !iterStr || !saltB64 || !hashB64) return false;
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: unb64(saltB64), iterations: Number(iterStr) },
    key,
    256,
  );
  return safeEqual(b64(bits), hashB64);
}

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}

/** Passwort-Secret eines Nutzers: entweder Hash (PASSWORD_HASH_FELIX) oder Klartext-Secret (PASSWORD_FELIX) */
function passwordHashFor(env: Env, user: string): string | undefined {
  const vars = env as unknown as Record<string, string | undefined>;
  const hash = vars[`PASSWORD_HASH_${user.toUpperCase()}`];
  if (hash) return hash;
  const plain = vars[`PASSWORD_${user.toUpperCase()}`];
  return plain ? "plain$" + plain : undefined;
}

/** Signaturschlüssel für Sitzungen. Ohne eigenes SESSION_SECRET wird er aus den Passwort-Secrets abgeleitet. */
function sessionSecret(env: Env): string | undefined {
  if (env.SESSION_SECRET) return env.SESSION_SECRET;
  const parts = USERS.map((u) => passwordHashFor(env, u.id) ?? "");
  return parts.every((p) => p) ? "derived:" + parts.join("|") : undefined;
}

async function readSession(c: Context<AppEnv>): Promise<string | null> {
  const raw = getCookie(c, COOKIE);
  const secret = sessionSecret(c.env);
  if (!raw || !secret) return null;
  const [user, exp, sig] = raw.split(".");
  if (!user || !exp || !sig) return null;
  if (Number(exp) < Date.now()) return null;
  if (!USERS.some((u) => u.id === user)) return null;
  // Passwortwechsel macht alte Sitzungen ungültig (Hash fließt in die Signatur ein)
  const expected = await hmac(secret, `${user}.${exp}.${passwordHashFor(c.env, user) ?? ""}`);
  return safeEqual(sig, expected) ? user : null;
}

export async function requireAuth(c: Context<AppEnv>, next: Next) {
  const path = new URL(c.req.url).pathname;
  if (path === "/api/login") return next();
  const user = await readSession(c);
  if (!user) return c.json({ error: "Nicht angemeldet" }, 401);
  c.set("user", user);
  return next();
}

export async function login(c: Context<AppEnv>) {
  const db = c.env.DB;
  const ip = c.req.header("cf-connecting-ip") ?? "local";
  const since = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const fails = await db
    .prepare("SELECT COUNT(*) AS n FROM login_failures WHERE ip = ? AND at > ?")
    .bind(ip, since)
    .first<{ n: number }>();
  if ((fails?.n ?? 0) >= MAX_FAILS) return c.json({ error: "Zu viele Fehlversuche. Bitte 15 Minuten warten." }, 429);

  const body = await c.req.json<{ user?: string; password?: string }>().catch(() => ({}) as { user?: string; password?: string });
  const user = String(body.user ?? "").trim().toLowerCase();
  const hash = USERS.some((u) => u.id === user) ? passwordHashFor(c.env, user) : undefined;
  const ok = !!hash && !!sessionSecret(c.env) && (await verifyPassword(String(body.password ?? ""), hash));
  if (!ok) {
    await db.prepare("INSERT INTO login_failures (ip, at) VALUES (?, ?)").bind(ip, new Date().toISOString()).run();
    await db.prepare("DELETE FROM login_failures WHERE at < ?").bind(since).run();
    await new Promise((r) => setTimeout(r, 800));
    return c.json({ error: "Name oder Passwort falsch" }, 401);
  }
  const exp = Date.now() + SESSION_DAYS * 24 * 3600 * 1000;
  const sig = await hmac(sessionSecret(c.env)!, `${user}.${exp}.${hash}`);
  const secure = new URL(c.req.url).protocol === "https:";
  setCookie(c, COOKIE, `${user}.${exp}.${sig}`, {
    httpOnly: true,
    secure,
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 3600,
  });
  return c.json({ ok: true, user });
}

export function logout(c: Context<AppEnv>) {
  deleteCookie(c, COOKIE, { path: "/" });
  return c.json({ ok: true });
}
