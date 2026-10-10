// Veröffentlicht das Reklamationstool bei Cloudflare.
// Legt beim ersten Mal Datenbank (D1) und Dateispeicher (R2) an, spielt Datenbank-Änderungen ein und lädt die App hoch.
//
// Lokal:            npx wrangler login   und dann   npm run deploy
// Cloudflare-Build: Deploy-Befehl  npm run deploy  (Token wird automatisch gestellt)
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const DB_NAME = "reklamationen";
const BUCKET = "reklamationen-dateien";
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

// 0) Automatische Tests – schlägt einer fehl, wird nicht veröffentlicht.
//    Notfalls überspringen mit der Build-Variable SKIP_TESTS=1.
if (process.env.SKIP_TESTS === "1") console.warn("⚠ Tests übersprungen (SKIP_TESTS=1)");
else {
  run("npm", ["test"]);
  console.log("✓ Alle Tests bestanden");
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

// 2) Dateispeicher (R2) für Anhänge und Sicherungen – optional
const r2 = wrangler(["r2", "bucket", "create", BUCKET], { allowFail: true });
if (r2.ok || /already exists|already own/i.test(r2.out)) console.log(`✓ Dateispeicher ${BUCKET}`);
else {
  console.warn("⚠ R2 ist im Cloudflare-Konto nicht aktiviert – Anhänge (max. 1,8 MB) und Sicherungen liegen stattdessen in der Datenbank.");
  delete config.r2_buckets;
}

writeFileSync(OUT, JSON.stringify(config, null, 2));

// 3) Datenbank-Änderungen einspielen, bauen, hochladen
wrangler(["d1", "migrations", "apply", DB_NAME, "--remote", "-c", OUT]);
run("npx", ["tsc", "-b"]);
run("npx", ["vite", "build"], { WRANGLER_CONFIG: OUT });
run("npx", ["wrangler", "deploy"]);
console.log("\n✓ Fertig. Die Adresse der App steht oben bei „Deployed … triggers“ bzw. im Cloudflare-Dashboard.");
