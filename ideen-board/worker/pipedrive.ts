import { Hono } from "hono";
import { userName } from "../shared/types";
import { addHistory, appUrl, loadCard, nowIso } from "./db";
import type { AppEnv } from "./env";

export const pipedriveApi = new Hono<AppEnv>();

/** Legt aus einer Karte eine Aufgabe (Aktivität) in Pipedrive an */
pipedriveApi.post("/cards/:id/pipedrive", async (c) => {
  const token = c.env.PIPEDRIVE_API_TOKEN;
  if (!token) return c.json({ error: "Pipedrive ist nicht eingerichtet (PIPEDRIVE_API_TOKEN fehlt)" }, 400);
  const card = await loadCard(c.env.DB, Number(c.req.param("id")));
  if (!card) return c.json({ error: "Karte nicht gefunden" }, 404);
  const body = await c.req.json<{ subject?: string; due_date?: string }>().catch(() => ({}) as { subject?: string; due_date?: string });
  const subject = (body.subject || card.next_step || card.title).slice(0, 250);
  const note = [
    `Aus dem Ideen-Board (Karte #${card.id}): ${card.title}`,
    card.description,
    card.ai_summary ? `KI-Kurzfassung: ${card.ai_summary}` : "",
    card.checklist.length ? "Checkliste:\n" + card.checklist.map((i) => `${i.done ? "☑" : "☐"} ${i.text}`).join("\n") : "",
    (await appUrl(c.env)) ? `${await appUrl(c.env)}/#/karte/${card.id}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  const payload = {
    subject,
    type: "task",
    due_date: /^\d{4}-\d{2}-\d{2}$/.test(body.due_date ?? "") ? body.due_date : card.follow_up || nowIso().slice(0, 10),
    note: note.replace(/\n/g, "<br>"),
  };
  const result = await createActivity(token, payload);
  if (!result.ok) return c.json({ error: `Pipedrive: ${result.error}` }, 400);
  const data = { data: { id: result.id } };
  const link = c.env.PIPEDRIVE_DOMAIN ? `https://${c.env.PIPEDRIVE_DOMAIN}.pipedrive.com/activities/list` : "";
  await addHistory(c.env.DB, card.id, c.get("user"), "pipedrive", `Aufgabe „${subject.slice(0, 60)}“ in Pipedrive angelegt (#${data.data?.id}) von ${userName(c.get("user"))}`);
  return c.json({ ok: true, id: data.data?.id, link });
});

type ActivityPayload = { subject: string; type: string; due_date?: string; note: string };

/**
 * Legt eine Aktivität an – über die aktuelle API v2 (v1 ist seit 08/2026 ohne Support).
 * Fehlt der Aktivitätstyp „task“ im Konto, wird ohne Typ (Standardtyp) erneut versucht.
 */
async function createActivity(token: string, payload: ActivityPayload): Promise<{ ok: true; id: number } | { ok: false; error: string }> {
  const post = async (p: Partial<ActivityPayload>) => {
    const res = await fetch("https://api.pipedrive.com/api/v2/activities", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-token": token },
      body: JSON.stringify(p),
    });
    const data = (await res.json().catch(() => ({}))) as { success?: boolean; data?: { id: number }; error?: string; error_info?: string };
    return { res, data };
  };
  let { res, data } = await post(payload);
  if (!data.success && res.status === 400 && /type/i.test(`${data.error} ${data.error_info}`)) {
    const { type: _t, ...rest } = payload;
    ({ res, data } = await post(rest));
  }
  if (res.ok && data.success && data.data?.id) return { ok: true, id: data.data.id };
  if (res.status === 401) return { ok: false, error: "API-Token ungültig" };
  return { ok: false, error: `${data.error ?? res.status}${data.error_info ? " – " + data.error_info : ""}` };
}
