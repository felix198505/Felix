// Test-Umgebung: startet den echten Worker lokal (Cloudflare-Simulator) mit frischer Datenbank
// und einer nachgebauten KI. Es werden keine echten Kosten verursacht und keine Konten benötigt.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unstable_startWorker } from "wrangler";

const PASSWORD = "test-passwort";
const TEST_CONFIG = "wrangler.test.json";

/** Nachgebaute Anthropic-API: antwortet auf jedes Werkzeug mit passenden Beispieldaten */
function startMockAi() {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      const j = JSON.parse(body || "{}");
      requests.push(j);
      const tool = j.tools?.find((t) => t.name?.endsWith("_speichern"))?.name;
      const c0 = j.messages?.[0]?.content;
      const text = typeof c0 === "string" ? c0 : (c0 ?? []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
      const ids = [...text.matchAll(/#(\d+)/g)].map((m) => Number(m[1]));
      const inputs = {
        analyse_speichern: {
          kurzfassung: `Kurzfassung (${j.model})`,
          kategorie: { vorschlag: "Vertrieb", begruendung: "passt" },
          nutzen: { wert: 4, begruendung: "hoch" },
          aufwand: { wert: 2, begruendung: "gering" },
          naechste_schritte: ["Schritt eins", "Schritt zwei", "Schritt drei"],
          massnahmen: ["Maßnahme"],
          infos: [
            { text: "Mit echter Quelle", ist_schaetzung: false, quellen: [{ titel: "Quelle", url: "https://example.com/echt" }] },
            { text: "Mit erfundener Quelle", ist_schaetzung: true, quellen: [{ titel: "Fake", url: "https://erfunden.example/x" }] },
          ],
          kosten_zeit: { text: "500–800 €", ist_schaetzung: true },
          risiken: ["Risiko"],
          offene_fragen: ["Frage"],
          aehnliche_karten: [],
        },
        buendelung_speichern: {
          themen: [{ titel: "Thema", karten_ids: ids.slice(0, 2), hinweis: "verwandt" }],
          zusatz_ideen: [1, 2, 3].map((n) => ({ titel: `Zusatz ${n}`, beschreibung: "B" })),
        },
        rueckblick_speichern: { zusammenfassung: "Lage", fokus: "Fokus", quick_wins: [], haengt_fest: [], doppelungen: [], kombinationen: [] },
        ideen_speichern: { ideen: [{ titel: "Idee aus Gespräch", beschreibung: "B", zitat: "Z", aehnlich_karte_id: 0 }] },
      };
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          id: "msg_test",
          type: "message",
          role: "assistant",
          model: j.model,
          stop_reason: "tool_use",
          stop_sequence: null,
          content: [
            { type: "web_search_tool_result", tool_use_id: "srv_1", content: [{ type: "web_search_result", url: "https://example.com/echt", title: "Quelle", encrypted_content: "x", page_age: null }] },
            { type: "tool_use", id: "toolu_1", name: tool, input: inputs[tool] },
          ],
          usage: { input_tokens: 1000, output_tokens: 500, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, server_tool_use: { web_search_requests: 1 } },
        }),
      );
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, requests, url: `http://127.0.0.1:${server.address().port}` })));
}

/** Startet Worker + Mock-KI. Gibt Hilfsfunktionen für die Tests zurück. */
export async function startApp() {
  const ai = await startMockAi();
  const dir = mkdtempSync(join(tmpdir(), "ideen-board-test-"));
  // Testkonfiguration: ohne Oberfläche (nur API) und ohne R2 (Fotos/Backups landen in D1)
  const cfg = JSON.parse(readFileSync("wrangler.jsonc", "utf8").replace(/^\s*\/\/.*$/gm, ""));
  delete cfg.assets;
  delete cfg.r2_buckets;
  delete cfg.triggers;
  writeFileSync(TEST_CONFIG, JSON.stringify(cfg));
  execFileSync("npx", ["wrangler", "d1", "migrations", "apply", "ideen-board", "--local", "--persist-to", dir, "-c", TEST_CONFIG], { stdio: "ignore" });
  const plain = (value) => ({ type: "plain_text", value });
  const worker = await unstable_startWorker({
    config: TEST_CONFIG,
    dev: { persist: dir, server: { port: 0 }, inspector: false, watch: false, logLevel: "error" },
    bindings: {
      PASSWORD_FELIX: plain(PASSWORD),
      PASSWORD_TIM: plain(PASSWORD),
      PASSWORD_KERSTIN: plain(PASSWORD),
      PASSWORD_HASH_FELIX: plain(""),
      PASSWORD_HASH_TIM: plain(""),
      PASSWORD_HASH_KERSTIN: plain(""),
      SESSION_SECRET: plain("test-geheimnis"),
      ANTHROPIC_API_KEY: plain("test-key"),
      ANTHROPIC_BASE_URL: plain(ai.url),
    },
  });
  await worker.ready;
  const base = await worker.url;

  /** Fetch-Hilfe mit Anmelde-Cookie */
  async function as(user) {
    const r = await fetch(new URL("/api/login", base), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ user, password: PASSWORD }),
    });
    if (!r.ok) throw new Error(`Login ${user} fehlgeschlagen: ${r.status}`);
    const cookie = r.headers.get("set-cookie").split(";")[0];
    return async (path, { method, body, raw, headers = {} } = {}) => {
      const res = await fetch(new URL("/api" + path, base), {
        method: method ?? (body !== undefined || raw !== undefined ? "POST" : "GET"),
        headers: { cookie, ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers },
        body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
      });
      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
      return { status: res.status, data };
    };
  }

  /** Wartet, bis eine Bedingung erfüllt ist (KI läuft im Hintergrund) */
  async function until(fn, ms = 15000) {
    const end = Date.now() + ms;
    for (;;) {
      const v = await fn();
      if (v) return v;
      if (Date.now() > end) throw new Error("Zeitüberschreitung beim Warten");
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  async function stop() {
    await worker.dispose();
    ai.server.close();
    rmSync(dir, { recursive: true, force: true });
    rmSync(TEST_CONFIG, { force: true });
  }

  return { base, as, until, stop, ai };
}
