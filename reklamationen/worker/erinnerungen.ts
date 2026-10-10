// Tägliche Erinnerung: Termine morgen und neu überfällige Fristen – per Push und, wenn eingerichtet, per E-Mail.
import { Hono } from "hono";
import { gruppeKurz, heute, plusTage } from "../shared/types";
import type { Fall } from "../shared/types";
import { appUrl, loadFaelle, nowIso } from "./db";
import type { AppEnv, Env } from "./env";
import { notify } from "./push";

export const erinnerungenApi = new Hono<AppEnv>();

const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);
const fmt = (iso: string) => iso.split("-").reverse().join(".");

interface Lage {
  morgen: Fall[];
  neuUeberfaellig: Fall[];
  alleUeberfaellig: Fall[];
}

/** Was steht an? „neu überfällig“ = für diesen Termin noch nicht gemeldet */
async function lage(env: Env, nurNeue: boolean): Promise<Lage> {
  const today = heute();
  const morgen = plusTage(today, 1);
  const offen = (await loadFaelle(env.DB)).filter((f) => !f.erledigt && f.termin);
  const gesendet = new Set(
    nurNeue ? (await env.DB.prepare("SELECT fall_id, art, termin FROM erinnerungen").all<{ fall_id: string; art: string; termin: string }>()).results.map((r) => `${r.fall_id}|${r.art}|${r.termin}`) : [],
  );
  const alleUeberfaellig = offen.filter((f) => f.termin! < today).sort((a, b) => a.termin!.localeCompare(b.termin!));
  return {
    morgen: offen.filter((f) => f.termin === morgen && !gesendet.has(`${f.id}|morgen|${f.termin}`)),
    neuUeberfaellig: alleUeberfaellig.filter((f) => !gesendet.has(`${f.id}|ueberfaellig|${f.termin}`)),
    alleUeberfaellig,
  };
}

function nachricht(l: Lage, base: string) {
  const link = (f: Fall) => (base ? `<a href="${base}/#/fall/${encodeURIComponent(f.id)}" style="color:#15803d;text-decoration:none;font-weight:600">${esc(f.name)}</a>` : `<b>${esc(f.name)}</b>`);
  const zeile = (f: Fall) =>
    `<li style="margin-bottom:6px">${link(f)} <span style="color:#667">· ${gruppeKurz(f.gruppe)} · ${fmt(f.termin!)}${f.terminText ? " – " + esc(f.terminText) : ""}</span>${f.what ? `<br><span style="color:#445;font-size:13px">${esc(f.what)}</span>` : ""}</li>`;
  const block = (titel: string, list: Fall[]) => (list.length ? `<h3 style="margin:20px 0 8px;font-size:15px;color:#0a0a0a">${titel} (${list.length})</h3><ul style="margin:0;padding-left:18px">${list.map(zeile).join("")}</ul>` : "");
  const html = `<!doctype html><html><body style="margin:0;background:#f2f5f3;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#1a1f1c">
<div style="max-width:620px;margin:0 auto;padding:24px">
<div style="background:#0a0a0a;color:#fff;border-radius:14px;padding:18px 22px;border-bottom:4px solid #22c55e">
<div style="font-size:19px;font-weight:700">FT Reklamationen · Erinnerung</div>
<div style="opacity:.7;font-size:13px;margin-top:4px">Experten für Terrassenüberdachungen · ${new Date().toLocaleDateString("de-DE", { weekday: "long", day: "2-digit", month: "long", year: "numeric", timeZone: "Europe/Berlin" })}</div>
</div>
<div style="background:#fff;border-radius:14px;padding:4px 22px 22px;margin-top:12px">
${block("Termin morgen", l.morgen)}
${block("Frist neu überfällig", l.neuUeberfaellig)}
${l.alleUeberfaellig.length > l.neuUeberfaellig.length ? `<p style="margin-top:18px;color:#a11">Insgesamt ${l.alleUeberfaellig.length} Fälle mit überfälligem Termin.</p>` : ""}
${base ? `<p style="margin-top:22px"><a href="${base}" style="background:#22c55e;color:#04120a;padding:10px 18px;border-radius:10px;text-decoration:none;font-weight:700">Reklamationen öffnen</a></p>` : ""}
</div>
<p style="font-size:11px;color:#789;text-align:center;margin-top:12px">Automatisch verschickt. Abbestellen: in der App unter Einstellungen → Erinnerungen.</p>
</div></body></html>`;
  const teile = [
    l.morgen.length ? `Morgen: ${l.morgen.map((f) => f.name).slice(0, 4).join(", ")}${l.morgen.length > 4 ? ` +${l.morgen.length - 4}` : ""}` : "",
    l.neuUeberfaellig.length ? `Überfällig: ${l.neuUeberfaellig.map((f) => f.name).slice(0, 4).join(", ")}${l.neuUeberfaellig.length > 4 ? ` +${l.neuUeberfaellig.length - 4}` : ""}` : "",
  ].filter(Boolean);
  const subject = `Reklamationen: ${l.morgen.length} Termin(e) morgen, ${l.neuUeberfaellig.length} neu überfällig`;
  const url = l.morgen.length + l.neuUeberfaellig.length === 1 ? `/#/fall/${encodeURIComponent((l.morgen[0] ?? l.neuUeberfaellig[0]).id)}` : "/#/?k=ueberfaellig";
  return { html, subject, push: teile.join(" · "), url };
}

export async function sendMail(env: Env, to: string[], subject: string, html: string): Promise<void> {
  if (!env.RESEND_API_KEY || !env.MAIL_FROM) throw new Error("E-Mail-Versand ist nicht eingerichtet (RESEND_API_KEY / MAIL_FROM fehlen)");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ from: env.MAIL_FROM, to, subject, html }),
  });
  if (!res.ok) throw new Error(`E-Mail-Versand fehlgeschlagen: ${res.status}`);
}

async function empfaenger(env: Env, nur?: string) {
  const r = await env.DB.prepare(`SELECT id, email FROM users WHERE aktiv = 1 ${nur ? "AND id = ?" : "AND erinnerungen = 1"}`)
    .bind(...(nur ? [nur] : []))
    .all<{ id: string; email: string | null }>();
  return r.results;
}

/** Täglicher Lauf (Cron). Gibt zurück, wie viele Fälle gemeldet wurden. */
export async function taeglicheErinnerung(env: Env): Promise<number> {
  const l = await lage(env, true);
  const n = l.morgen.length + l.neuUeberfaellig.length;
  if (!n) return 0;
  const m = nachricht(l, await appUrl(env));
  const users = await empfaenger(env);
  await notify(env, users.map((u) => u.id), { title: "⏰ Reklamationen", body: m.push, url: m.url, tag: "erinnerung" });
  const mails = users.map((u) => u.email).filter((e): e is string => !!e);
  if (mails.length && env.RESEND_API_KEY && env.MAIL_FROM) {
    try {
      await sendMail(env, mails, m.subject, m.html);
    } catch (e) {
      console.error((e as Error).message);
    }
  }
  const now = nowIso();
  await env.DB.batch([
    ...l.morgen.map((f) => env.DB.prepare("INSERT OR IGNORE INTO erinnerungen (fall_id, art, termin, at) VALUES (?, 'morgen', ?, ?)").bind(f.id, f.termin, now)),
    ...l.neuUeberfaellig.map((f) => env.DB.prepare("INSERT OR IGNORE INTO erinnerungen (fall_id, art, termin, at) VALUES (?, 'ueberfaellig', ?, ?)").bind(f.id, f.termin, now)),
  ]);
  return n;
}

/** Vorschau / Test: zeigt die aktuelle Lage ohne „schon gemeldet“-Filter und schickt sie nur an mich */
erinnerungenApi.post("/erinnerungen/test", async (c) => {
  const l = await lage(c.env, false);
  const m = nachricht({ ...l, neuUeberfaellig: l.alleUeberfaellig }, await appUrl(c.env));
  const [u] = await empfaenger(c.env, c.get("user")!);
  const push = await notify(c.env, [u.id], { title: "⏰ Reklamationen (Test)", body: m.push || "Zurzeit nichts fällig", url: m.url, tag: "erinnerung-test" });
  let mail = false;
  let mailFehler: string | undefined;
  if (u.email && c.env.RESEND_API_KEY && c.env.MAIL_FROM) {
    try {
      await sendMail(c.env, [u.email], "[Test] " + m.subject, m.html);
      mail = true;
    } catch (e) {
      mailFehler = (e as Error).message;
    }
  }
  return c.json({ push, mail, mailFehler, morgen: l.morgen.length, ueberfaellig: l.alleUeberfaellig.length });
});
