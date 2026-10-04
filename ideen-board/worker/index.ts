import { Hono } from "hono";
import { api } from "./api";
import { login, logout, requireAuth } from "./auth";
import { nightlyBackup } from "./backup";
import { bumpRev } from "./db";
import { retryPending } from "./ai";
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

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "Serverfehler: " + err.message }, 500);
});

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
    if (event.cron === "17 2 * * *") ctx.waitUntil(nightlyBackup(env));
    else ctx.waitUntil(retryPending(env));
  },
} satisfies ExportedHandler<Env>;
