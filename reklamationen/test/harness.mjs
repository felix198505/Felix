// Test-Umgebung: startet den echten Worker lokal (Cloudflare-Simulator) mit frischer Datenbank.
// Keine Konten, keine Kosten, keine echten Falldaten.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unstable_startWorker } from "wrangler";

export const PASSWORD = "test-passwort";
const TEST_CONFIG = "wrangler.test.json";
export const IMPORT_TOKEN = "test-import-schluessel";

export async function startApp() {
  const dir = mkdtempSync(join(tmpdir(), "reklamationen-test-"));
  // Testkonfiguration: ohne Oberfläche (nur API) und ohne R2 (Dateien landen in D1)
  const cfg = JSON.parse(readFileSync("wrangler.jsonc", "utf8").replace(/^\s*\/\/.*$/gm, ""));
  delete cfg.assets;
  delete cfg.r2_buckets;
  delete cfg.triggers;
  writeFileSync(TEST_CONFIG, JSON.stringify(cfg));
  execFileSync("npx", ["wrangler", "d1", "migrations", "apply", "reklamationen", "--local", "--persist-to", dir, "-c", TEST_CONFIG], { stdio: "ignore" });
  const plain = (value) => ({ type: "plain_text", value });
  const worker = await unstable_startWorker({
    config: TEST_CONFIG,
    dev: { persist: dir, server: { port: 0 }, inspector: false, watch: false, logLevel: "error" },
    bindings: {
      PASSWORD_FELIX: plain(PASSWORD),
      PASSWORD_TIM: plain(PASSWORD),
      PASSWORD_KERSTIN: plain(PASSWORD),
      SESSION_SECRET: plain("test-geheimnis"),
      IMPORT_TOKEN: plain(IMPORT_TOKEN),
    },
  });
  await worker.ready;
  const base = await worker.url;

  async function login(user, password = PASSWORD) {
    const r = await fetch(new URL("/api/login", base), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ user, password }) });
    if (!r.ok) throw new Error(`Login ${user} fehlgeschlagen: ${r.status}`);
    return r.headers.get("set-cookie").split(";")[0];
  }

  /** Fetch-Hilfe mit Anmelde-Cookie (oder eigenen Kopfzeilen) */
  function client(headersBase) {
    return async (path, { method, body, raw, headers = {} } = {}) => {
      const res = await fetch(new URL("/api" + path, base), {
        method: method ?? (body !== undefined || raw !== undefined ? "POST" : "GET"),
        headers: { ...headersBase, ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers },
        body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
      });
      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
      return { status: res.status, data, headers: res.headers };
    };
  }

  const as = async (user, password) => client({ cookie: await login(user, password) });
  const withToken = (token) => client({ authorization: `Bearer ${token}` });

  async function cron(expr) {
    const r = await fetch(new URL(`/cdn-cgi/handler/scheduled?cron=${encodeURIComponent(expr)}`, base));
    return r.status;
  }

  async function stop() {
    await worker.dispose();
    rmSync(dir, { recursive: true, force: true });
    rmSync(TEST_CONFIG, { force: true });
  }

  return { base, as, withToken, cron, stop };
}
