import { Hono } from "hono";
import { columnTitle, priorityOf, STUCK_DAYS, userName } from "../shared/types";
import type { Card, Review } from "../shared/types";
import { appUrl, loadCards, nowIso } from "./db";
import type { AppEnv, Env } from "./env";
import { createReview, latestReview } from "./insights";
import { notify } from "./push";

export const digestApi = new Hono<AppEnv>();

const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);
const days = (iso: string | null) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : 0);

/** Wochen-Zusammenfassung als HTML-Mail und kurzer Push-Text */
export async function buildDigest(env: Env, review: Review | null) {
  const cards = await loadCards(env.DB);
  const today = nowIso().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const active = (c: Card) => ["eingang", "ausarbeiten", "entscheiden", "umsetzen", "parkplatz"].includes(c.column_key);
  const due = cards.filter((c) => c.follow_up && c.follow_up <= today && active(c));
  const decide = cards.filter((c) => c.column_key === "entscheiden").sort((a, b) => days(b.column_since) - days(a.column_since));
  const fresh = cards.filter((c) => c.created_at >= weekAgo);
  const doneWeek = cards.filter((c) => ["umsetzen", "erledigt"].includes(c.column_key) && (c.column_since ?? "") >= weekAgo);
  const base = await appUrl(env);
  const link = (c: Card) => (base ? `<a href="${base}/#/karte/${c.id}" style="color:#16c96a;text-decoration:none">${esc(c.title)}</a>` : esc(c.title));
  const section = (title: string, list: Card[], extra: (c: Card) => string = () => "") =>
    list.length
      ? `<h3 style="margin:22px 0 8px;font-size:15px;color:#0b3d22">${title} (${list.length})</h3><ul style="margin:0;padding-left:18px">${list
          .slice(0, 12)
          .map((c) => `<li style="margin-bottom:4px">${link(c)}${extra(c)}</li>`)
          .join("")}</ul>`
      : "";
  const r = review?.data;
  const byId = new Map(cards.map((c) => [c.id, c]));
  const title = (id: number) => esc(byId.get(id)?.title ?? `#${id}`);
  const html = `<!doctype html><html><body style="margin:0;background:#f3f7f4;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#1d2a22">
<div style="max-width:620px;margin:0 auto;padding:24px">
<div style="background:#07110b;color:#eaf7ee;border-radius:16px;padding:20px 22px">
<div style="font-size:20px;font-weight:700">✦ Ideen-Board · Wochenüberblick</div>
<div style="opacity:.7;font-size:13px;margin-top:4px">${new Date().toLocaleDateString("de-DE", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}</div>
<div style="margin-top:14px;font-size:14px">📥 ${fresh.length} neu · 🗳 ${decide.length} zur Entscheidung · ⏰ ${due.length} fällig · 🚀 ${doneWeek.length} beschlossen/erledigt</div>
</div>
<div style="background:#fff;border-radius:16px;padding:6px 22px 22px;margin-top:14px">
${r ? `<h3 style="margin:22px 0 8px;font-size:15px;color:#0b3d22">✦ KI-Rückblick (Vorschlag)</h3><p style="margin:0 0 8px">${esc(r.zusammenfassung)}</p><p style="margin:0;padding:10px 12px;background:#ecfbf2;border-radius:10px"><b>Fokus der Woche:</b> ${esc(r.fokus)}</p>${
    r.quick_wins.length ? `<p style="margin:12px 0 4px"><b>Quick Wins:</b></p><ul style="margin:0;padding-left:18px">${r.quick_wins.map((q) => `<li>${title(q.karte_id)} – ${esc(q.grund)}</li>`).join("")}</ul>` : ""
  }` : ""}
${section("Wartet auf Entscheidung", decide, (c) => ` <span style="color:${days(c.column_since) >= STUCK_DAYS ? "#d33" : "#789"}">· seit ${days(c.column_since)} Tagen</span>`)}
${section("Heute fällig / überfällig", due, (c) => ` <span style="color:#a60">· ${c.follow_up}</span>`)}
${section("Neu diese Woche", fresh, (c) => ` <span style="color:#789">· ${userName(c.created_by)}</span>`)}
${section("Beschlossen oder erledigt", doneWeek, (c) => ` <span style="color:#789">· ${columnTitle(c.column_key)}</span>`)}
${base ? `<p style="margin-top:24px"><a href="${base}" style="background:#16c96a;color:#02130a;padding:10px 18px;border-radius:10px;text-decoration:none;font-weight:700">Board öffnen</a></p>` : ""}
</div>
<p style="font-size:11px;color:#789;text-align:center;margin-top:14px">Automatisch erstellt vom Ideen-Board. KI-Inhalte sind Vorschläge.</p>
</div></body></html>`;
  const quickWins = cards.filter((c) => priorityOf(c.benefit, c.effort) === "quickwin" && active(c)).length;
  const push = `${decide.length} zur Entscheidung · ${due.length} fällig · ${fresh.length} neu${quickWins ? ` · ${quickWins} Quick Wins` : ""}`;
  return { subject: `Ideen-Board: ${decide.length} zur Entscheidung, ${due.length} fällig`, html, push };
}

async function sendMail(env: Env, to: string[], subject: string, html: string): Promise<void> {
  if (!env.RESEND_API_KEY || !env.MAIL_FROM) throw new Error("E-Mail-Versand ist nicht eingerichtet (RESEND_API_KEY / MAIL_FROM fehlen)");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ from: env.MAIL_FROM, to, subject, html }),
  });
  if (!res.ok) throw new Error(`E-Mail-Versand fehlgeschlagen: ${res.status} ${(await res.text()).slice(0, 200)}`);
}

/** Montags-Lauf: KI-Rückblick erstellen, Mail und Push an alle */
export async function weeklyRun(env: Env): Promise<void> {
  let review: Review | null = null;
  if (env.ANTHROPIC_API_KEY) {
    try {
      review = await createReview(env, null);
    } catch (e) {
      console.error("Rückblick fehlgeschlagen", e);
    }
  }
  review ??= await latestReview(env.DB);
  const d = await buildDigest(env, review);
  const users = (await env.DB.prepare("SELECT id, email FROM users").all<{ id: string; email: string | null }>()).results;
  const emails = users.map((u) => u.email).filter((e): e is string => !!e && e.includes("@"));
  if (emails.length && env.RESEND_API_KEY) {
    try {
      await sendMail(env, emails, d.subject, d.html);
    } catch (e) {
      console.error(e);
    }
  }
  await notify(env, users.map((u) => u.id), { title: "📋 Wochenüberblick", body: d.push, url: "/#/rueckblick", tag: "weekly" });
}

digestApi.get("/digest/preview", async (c) => {
  const d = await buildDigest(c.env, await latestReview(c.env.DB));
  return c.html(d.html);
});

digestApi.post("/digest/test", async (c) => {
  const me = await c.env.DB.prepare("SELECT email FROM users WHERE id = ?").bind(c.get("user")).first<{ email: string | null }>();
  if (!me?.email) return c.json({ error: "Bitte zuerst deine E-Mail-Adresse in den Einstellungen eintragen" }, 400);
  try {
    const d = await buildDigest(c.env, await latestReview(c.env.DB));
    await sendMail(c.env, [me.email], "[Test] " + d.subject, d.html);
    return c.json({ ok: true });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
});
