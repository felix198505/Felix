import { Hono } from "hono";
import { api } from "./api";
import { bumpRev } from "./db";
import type { AppEnv, Env } from "./env";
import { USERS } from "../shared/types";

const app = new Hono<AppEnv>();

// Etappe 1: Nutzer wird lokal über eine Auswahl gesetzt (Header). Etappe 2 ersetzt das durch echten Login.
app.use("/api/*", async (c, next) => {
  const u = c.req.header("x-user") ?? "felix";
  c.set("user", USERS.some((x) => x.id === u) ? u : "felix");
  await next();
});

// Jede erfolgreiche Änderung erhöht den Änderungszähler → andere Geräte laden automatisch nach
app.use("/api/*", async (c, next) => {
  await next();
  if (c.req.method !== "GET" && c.res.status < 400) await bumpRev(c.env.DB);
});

app.route("/api", api);

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "Serverfehler: " + err.message }, 500);
});

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, _env: Env, _ctx: ExecutionContext) {},
} satisfies ExportedHandler<Env>;
