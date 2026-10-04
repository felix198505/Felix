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
  const res = await fetch(`https://api.pipedrive.com/v1/activities?api_token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      subject,
      type: "task",
      due_date: /^\d{4}-\d{2}-\d{2}$/.test(body.due_date ?? "") ? body.due_date : card.follow_up || nowIso().slice(0, 10),
      note: note.replace(/\n/g, "<br>"),
    }),
  });
  const data = (await res.json().catch(() => ({}))) as { success?: boolean; data?: { id: number }; error?: string };
  if (!res.ok || !data.success) return c.json({ error: `Pipedrive: ${data.error ?? res.status}` }, 400);
  const link = c.env.PIPEDRIVE_DOMAIN ? `https://${c.env.PIPEDRIVE_DOMAIN}.pipedrive.com/activities/list` : "";
  await addHistory(c.env.DB, card.id, c.get("user"), "pipedrive", `Aufgabe „${subject.slice(0, 60)}“ in Pipedrive angelegt (#${data.data?.id}) von ${userName(c.get("user"))}`);
  return c.json({ ok: true, id: data.data?.id, link });
});
