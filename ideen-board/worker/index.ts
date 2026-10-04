import { Hono } from "hono";
import { api, purgeCard } from "./api";
import { attachmentsApi } from "./attachments";
import { digestApi, weeklyRun } from "./digest";
import { insightsApi } from "./insights";
import { pipedriveApi } from "./pipedrive";
import { pushApi } from "./push";
import { login, logout, requireAuth } from "./auth";
import { nightlyBackup } from "./backup";
import { bumpRev } from "./db";
import { handleQueue, retryPending } from "./ai";
import type { AiJob } from "./ai";
import type { AppEnv, Env } from "./env";

const app = new Hono<AppEnv>();

// Ohne gültige Anmeldung gibt die API nichts heraus
app.use("/api/*", requireAuth);

// Jede erfolgreiche Änderung erhöht den Änderungszähler → andere Geräte laden automatisch nach
app.use("/api/*", async (c, next) => {
  await next();
  if (c.req.method !== "GET" && c.res.status < 400 && !["/api/login", "/api/logout"].includes(c.req.path)) await bumpRev(c.env.DB);
});

app.post("/api/login", login);
app.post("/api/logout", logout);
app.route("/api", api);
app.route("/api", attachmentsApi);
app.route("/api", pushApi);
app.route("/api", insightsApi);
app.route("/api", digestApi);
app.route("/api", pipedriveApi);

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "Serverfehler: " + err.message }, 500);
});

/** Karten, die länger als 30 Tage im Papierkorb liegen, endgültig löschen */
async function emptyTrash(env: Env) {
  const cutoff = new Date(Date.now() - 30 * 86400000).toISOString();
  const old = await env.DB.prepare("SELECT id FROM cards WHERE deleted_at IS NOT NULL AND deleted_at < ?").bind(cutoff).all<{ id: number }>();
  for (const r of old.results) await purgeCard(env, r.id);
}

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
    if (event.cron === "17 2 * * *") ctx.waitUntil(nightlyBackup(env).then(() => emptyTrash(env)));
    else if (event.cron === "47 5 * * 1") ctx.waitUntil(weeklyRun(env));
    else ctx.waitUntil(retryPending(env));
  },
  async queue(batch: MessageBatch<AiJob>, env: Env) {
    await handleQueue(batch, env);
  },
} satisfies ExportedHandler<Env, AiJob>;
