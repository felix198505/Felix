import { Hono } from "hono";
import { api } from "./api";
import { anhaengeApi } from "./anhaenge";
import { login, logout, nur, requireAuth } from "./auth";
import { getBackup, listBackups, nightlyBackup } from "./backup";
import { bumpRev } from "./db";
import { erinnerungenApi, taeglicheErinnerung } from "./erinnerungen";
import { pushApi } from "./push";
import { darf } from "../shared/types";
import type { AppEnv, Env } from "./env";

const app = new Hono<AppEnv>();

// Ohne gültige Anmeldung gibt die API nichts heraus
app.use("/api/*", requireAuth);

// Keine Zwischenspeicher für Falldaten
app.use("/api/*", async (c, next) => {
  await next();
  if (!c.res.headers.has("cache-control")) c.header("cache-control", "no-store");
});

// Jede erfolgreiche Änderung erhöht den Änderungszähler → andere Geräte laden automatisch nach
app.use("/api/*", async (c, next) => {
  await next();
  if (c.req.method !== "GET" && c.res.status < 400 && !["/api/login", "/api/logout"].includes(c.req.path)) await bumpRev(c.env.DB);
});

app.post("/api/login", login);
app.post("/api/logout", logout);
app.route("/api", api);
app.route("/api", anhaengeApi);
app.route("/api", pushApi);
app.route("/api", erinnerungenApi);

const verwalten = nur(darf.verwalten, "nur für Inhaber");
app.get("/api/backups", verwalten, async (c) => c.json(await listBackups(c.env)));
app.get("/api/backups/download", verwalten, async (c) => {
  const key = c.req.query("key") ?? "";
  const body = await getBackup(c.env, key);
  if (!body) return c.json({ error: "Nicht gefunden" }, 404);
  return new Response(body, { headers: { "content-type": "application/json", "content-disposition": `attachment; filename="${key.split("/").pop()}"`, "cache-control": "no-store" } });
});
app.post("/api/backups", verwalten, async (c) => c.json({ key: await nightlyBackup(c.env) }));

app.notFound((c) => (c.req.path.startsWith("/api/") ? c.json({ error: "Unbekannte Adresse" }, 404) : c.env.ASSETS.fetch(c.req.raw)));

app.onError((err, c) => {
  // Nur die Fehlermeldung protokollieren – keine Falldaten in die Logs
  console.error(`${c.req.method} ${c.req.path}: ${err.message}`);
  return c.json({ error: "Serverfehler: " + err.message }, 500);
});

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
    if (event.cron === "23 2 * * *") ctx.waitUntil(nightlyBackup(env));
    else ctx.waitUntil(taeglicheErinnerung(env));
  },
} satisfies ExportedHandler<Env>;
