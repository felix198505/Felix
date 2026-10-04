// Veröffentlicht das Ideen-Board bei Cloudflare.
// Legt beim ersten Mal Datenbank (D1), Backup-Speicher (R2) und Warteschlange (Queue) an,
// spielt Datenbank-Änderungen ein und lädt die App hoch.
//
// Lokal:            npx wrangler login   und dann   npm run deploy
// Cloudflare-Build: Deploy-Befehl  npm run deploy  (Token wird automatisch gestellt)
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const DB_NAME = "ideen-board";
const BUCKET = "ideen-board-backups";
const QUEUE = "ideen-board-ai";
const OUT = "wrangler.deploy.jsonc";

function wrangler(args, { allowFail = false } = {}) {
  console.log(`\n$ wrangler ${args.join(" ")}`);
  const r = spawnSync("npx", ["wrangler", ...args], { encoding: "utf8", shell: process.platform === "win32" });
  const out = (r.stdout || "") + (r.stderr || "");
  if (r.status !== 0 && !allowFail) {
    console.error(out);
    throw new Error(`wrangler ${args[0]} ist fehlgeschlagen`);
  }
  return { ok: r.status === 0, out, stdout: r.stdout || "" };
}

function run(cmd, args, env = {}) {
  console.log(`\n$ ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, { stdio: "inherit", env: { ...process.env, ...env }, shell: process.platform === "win32" });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} ist fehlgeschlagen`);
}

const stripComments = (s) => s.replace(/^\s*\/\/.*$/gm, "");
const config = JSON.parse(stripComments(readFileSync("wrangler.jsonc", "utf8")));

// 1) Datenbank
const findDb = () => JSON.parse(wrangler(["d1", "list", "--json"]).stdout).find((d) => d.name === DB_NAME);
let db = findDb();
if (!db) {
  wrangler(["d1", "create", DB_NAME]);
  db = findDb();
}
if (!db?.uuid) throw new Error("Datenbank konnte nicht angelegt werden");
config.d1_databases[0].database_id = db.uuid;
console.log(`✓ Datenbank ${DB_NAME} (${db.uuid})`);

// 2) Backup-Speicher (R2) – optional
const r2 = wrangler(["r2", "bucket", "create", BUCKET], { allowFail: true });
if (r2.ok || /already exists|already own/i.test(r2.out)) console.log(`✓ Backup-Speicher ${BUCKET}`);
else {
  console.warn("⚠ R2 ist im Cloudflare-Konto nicht aktiviert – Backups werden stattdessen in der Datenbank abgelegt.");
  delete config.r2_buckets;
}

// 3) Warteschlange für KI-Analysen – optional
const q = wrangler(["queues", "create", QUEUE], { allowFail: true });
if (q.ok || /already (exists|taken)/i.test(q.out)) console.log(`✓ Warteschlange ${QUEUE}`);
else {
  console.warn("⚠ Queues nicht verfügbar – KI-Analysen laufen direkt im Hintergrund.");
  delete config.queues;
}

writeFileSync(OUT, JSON.stringify(config, null, 2));

// 4) Datenbank-Änderungen einspielen, bauen, hochladen
wrangler(["d1", "migrations", "apply", DB_NAME, "--remote", "-c", OUT]);
run("npx", ["tsc", "-b"]);
run("npx", ["vite", "build"], { WRANGLER_CONFIG: OUT });
run("npx", ["wrangler", "deploy"]);
console.log("\n✓ Fertig. Die Adresse der App steht oben bei „Deployed … triggers“ bzw. im Cloudflare-Dashboard.");
