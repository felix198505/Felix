// Erfundene Beispielfälle im Format der Export-Datei. Keine echten Namen!
const heute = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
const tage = (n) => {
  const d = new Date(heute + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export const BEISPIEL = {
  faelle: [
    {
      id: "test-musterfrau",
      name: "Musterfrau",
      meta: "Erika · Musterstadt · P-0001 · RA Beispiel · Az. 1 O 1/26",
      gruppe: "recht",
      what: "Undichte Rinne, Anwaltsschreiben",
      pts: ["Gutachten liegt vor", "Frist zur Stellungnahme läuft"],
      schritte: [
        { t: "Stellungnahme an Anwalt", done: false },
        { t: "Gutachten prüfen", done: true },
        { t: "Ortstermin vereinbaren", done: false },
        { t: "Rechnung zurückhalten", done: false },
        { t: "Fotos anfordern", done: false },
      ],
      verlauf: Array.from({ length: 12 }, (_, i) => ({ d: tage(-40 + i * 3), t: `Ereignis ${i + 1}` })),
      status: "Frist",
      stufe: "crit",
      termin: tage(-2),
      terminText: "Stellungnahme fällig",
      erledigt: false,
      stand: tage(-5),
      hinweis: "Schreiben nur als PDF",
      lk: tage(-6),
      lf: tage(-7),
    },
    { id: "test-beispiel", name: "Beispiel", meta: "Max · Testdorf", gruppe: "kunde", what: "Kratzer im Glas", pts: [], schritte: [], verlauf: [], status: "neu", stufe: "warn", termin: tage(1), terminText: "Nacharbeit", erledigt: "Nein", stand: tage(-1), hinweis: "", lk: null, lf: null },
    { id: "test-hersteller", name: "Profilhersteller", meta: "Charge 42", gruppe: "leiner", what: "Pulverbeschichtung blättert", pts: ["Muster eingeschickt"], schritte: ["Antwort Hersteller abwarten"], verlauf: [{ d: "01.09.2026", t: "Reklamation an Hersteller" }], status: "beim Hersteller", stufe: "ok", termin: tage(5), terminText: "", erledigt: false, stand: "2026-09-01", hinweis: "" },
    { id: "test-ohne", name: "Ohne Schritt", gruppe: "kunde", what: "Rückruf", stufe: "warn", erledigt: false, schritte: [{ t: "Erledigter Schritt", done: true }] },
    { id: "test-fertig", name: "Abgeschlossen", gruppe: "kunde", what: "Erledigt", stufe: "ok", erledigt: "Ja", termin: tage(-30) },
  ],
};
