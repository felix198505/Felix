import { Hono } from "hono";
import { buildPushPayload } from "@block65/webcrypto-web-push";
import { appUrl, getSetting, nowIso, setSetting } from "./db";
import type { AppEnv, Env } from "./env";

export const pushApi = new Hono<AppEnv>();

const b64url = (buf: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

/**
 * Kontaktadresse für die Push-Dienste. Apple lehnt Platzhalter (z. B. example.com, localhost) ab,
 * daher die echte Adresse der App oder die Absender-Adresse der Wochen-Mail.
 */
async function vapidSubject(env: Env): Promise<string> {
  const url = await appUrl(env);
  if (url.startsWith("https://") && !/localhost|127\.0\.0\.1/.test(url)) return url;
  const mail = env.MAIL_FROM?.match(/[^<\s]+@[^>\s]+/)?.[0];
  if (mail) return "mailto:" + mail;
  return "https://felix.workers.dev";
}

/** VAPID-Schlüssel: werden beim ersten Bedarf erzeugt und nur serverseitig in der Datenbank gehalten */
async function vapid(env: Env) {
  let pub = await getSetting(env.DB, "vapid_public");
  let priv = await getSetting(env.DB, "vapid_private");
  if (!pub || !priv) {
    const kp = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
    pub = b64url((await crypto.subtle.exportKey("raw", kp.publicKey)) as ArrayBuffer);
    priv = ((await crypto.subtle.exportKey("jwk", kp.privateKey)) as JsonWebKey).d!;
    await setSetting(env.DB, "vapid_public", pub);
    await setSetting(env.DB, "vapid_private", priv);
  }
  return { subject: await vapidSubject(env), publicKey: pub, privateKey: priv };
}

pushApi.get("/push/key", async (c) => c.json({ key: (await vapid(c.env)).publicKey }));

pushApi.post("/push/subscribe", async (c) => {
  const sub = await c.req.json<{ endpoint: string; keys: { p256dh: string; auth: string } }>();
  if (!sub?.endpoint?.startsWith("https://") || !sub.keys?.p256dh || !sub.keys?.auth) return c.json({ error: "Ungültiges Abo" }, 400);
  await c.env.DB.prepare(
    "INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth",
  )
    .bind(sub.endpoint, c.get("user"), sub.keys.p256dh, sub.keys.auth, nowIso())
    .run();
  return c.json({ ok: true });
});

pushApi.post("/push/unsubscribe", async (c) => {
  const { endpoint } = await c.req.json<{ endpoint: string }>();
  await c.env.DB.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").bind(endpoint).run();
  return c.json({ ok: true });
});

pushApi.post("/push/test", async (c) => {
  const n = await notify(c.env, [c.get("user")], { title: "Ideen-Board", body: "Benachrichtigungen funktionieren ✓", url: "/" });
  return c.json({ sent: n });
});

/** Schickt eine Benachrichtigung an alle Geräte der genannten Nutzer. Fehler werden still ignoriert. */
export async function notify(env: Env, userIds: string[], msg: { title: string; body: string; url?: string; tag?: string }): Promise<number> {
  if (!userIds.length) return 0;
  const subs = await env.DB.prepare(`SELECT * FROM push_subscriptions WHERE user_id IN (${userIds.map(() => "?").join(",")})`)
    .bind(...userIds)
    .all<{ endpoint: string; p256dh: string; auth: string }>();
  if (!subs.results.length) return 0;
  const keys = await vapid(env);
  let sent = 0;
  for (const s of subs.results) {
    try {
      const payload = await buildPushPayload(
        { data: { ...msg, url: msg.url ?? "/" }, options: { ttl: 24 * 3600, urgency: "normal" } },
        { endpoint: s.endpoint, expirationTime: null, keys: { p256dh: s.p256dh, auth: s.auth } },
        keys,
      );
      const res = await fetch(s.endpoint, payload);
      if (res.status === 404 || res.status === 410) await env.DB.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").bind(s.endpoint).run();
      else if (res.ok) sent++;
    } catch (e) {
      console.error("Push fehlgeschlagen", e);
    }
  }
  return sent;
}
