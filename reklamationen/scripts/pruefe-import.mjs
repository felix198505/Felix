// Abnahme-Prüfung: liest die Export-Datei des bisherigen Tools ein (ohne sie irgendwo abzulegen),
// importiert sie in eine frische, lokale Test-Instanz und vergleicht die Zahlen.
//
// Aufruf:  npm run pruefe-import -- /pfad/zu/reklamationen-faelle.json ["Fallname für Stichprobe"]
// Die Datei bleibt, wo sie ist – sie wird weder kopiert noch ins Repo übernommen.
import { readFileSync } from "node:fs";
import { startApp } from "../test/harness.mjs";
import { heute, kennzahlen } from "../shared/types.ts";

const [file, stichprobe] = process.argv.slice(2);
if (!file) {
  console.error('Aufruf: npm run pruefe-import -- /pfad/zu/reklamationen-faelle.json ["Name für Stichprobe"]');
  process.exit(1);
}
const json = JSON.parse(readFileSync(file, "utf8"));
const roh = Array.isArray(json) ? json : (json.faelle ?? json.cases ?? json.items ?? json.data ?? Object.values(json));
const ja = (v) => (typeof v === "string" ? ["ja", "true", "1"].includes(v.trim().toLowerCase()) : !!v);

// Erwartung direkt aus der Datei
const erwartet = {
  gesamt: roh.length,
  offen: roh.filter((f) => !ja(f.erledigt)).length,
  kritisch: roh.filter((f) => !ja(f.erledigt) && f.stufe === "crit").length,
  erledigt: roh.filter((f) => ja(f.erledigt)).length,
};

const app = await startApp();
let ok = true;
try {
  const felix = await app.as("felix");
  const r = await felix("/import", { body: json });
  if (r.status !== 200) throw new Error(`Import abgelehnt: ${JSON.stringify(r.data)}`);
  const b = r.data;
  console.log(`Import: ${b.gelesen} gelesen · ${b.neu} neu · ${b.fehler.length} Fehler`);
  for (const f of b.fehler) console.log(`  ✗ Eintrag ${f.nr}${f.id ? ` (${f.id})` : ""}: ${f.grund}`);
  if (b.unbekannte_felder.length) console.log(`  ⚠ nicht übernommene Felder: ${b.unbekannte_felder.join(", ")}`);
  if (b.fehler.length) ok = false;

  const d = (await felix("/daten")).data;
  const k = kennzahlen(d.faelle, heute());
  const ist = { gesamt: d.faelle.length, offen: k.offen, kritisch: k.kritisch, erledigt: k.erledigt };
  console.log("\n              Datei   App");
  for (const key of Object.keys(erwartet)) {
    const gleich = erwartet[key] === ist[key];
    if (!gleich) ok = false;
    console.log(`  ${gleich ? "✓" : "✗"} ${key.padEnd(10)} ${String(erwartet[key]).padStart(5)} ${String(ist[key]).padStart(5)}`);
  }
  console.log(`\n  Weitere Kennzahlen (Stand heute): ${k.ueberfaellig} Termin überfällig · ${k.woche} Termine in 7 Tagen · ${k.ohneSchritt} ohne nächsten Schritt`);

  // Verlauf und Schritte je Fall vollständig?
  let abweichend = 0;
  for (const f of roh) {
    const a = d.faelle.find((x) => x.id === String(f.id));
    if (!a) continue;
    if ((f.verlauf?.length ?? 0) !== a.verlauf.length || (f.schritte?.length ?? 0) !== a.schritte.length) abweichend++;
  }
  console.log(`  ${abweichend ? "✗" : "✓"} Verlauf und Schritte: ${abweichend ? `${abweichend} Fälle weichen ab` : "bei allen Fällen vollständig"}`);
  if (abweichend) ok = false;

  if (stichprobe) {
    const q = stichprobe.toLowerCase();
    for (const f of d.faelle.filter((x) => `${x.name} ${x.meta} ${x.id}`.toLowerCase().includes(q))) {
      const offen = f.schritte.filter((s) => !s.done).length;
      console.log(`\n  Stichprobe „${f.name}“: ${f.verlauf.length} Verlaufseinträge · ${f.schritte.length} Schritte, davon ${offen} offen`);
    }
  }
} finally {
  await app.stop();
}
console.log(ok ? "\n✓ Abnahme bestanden" : "\n✗ Abweichungen – siehe oben");
process.exit(ok ? 0 : 1);
