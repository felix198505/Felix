// Automatische Tests für das Reklamationstool. Aufruf: npm test
// Laufen auch vor jeder Veröffentlichung (npm run deploy) – schlägt ein Test fehl, wird nicht veröffentlicht.
// Alle Namen sind erfunden.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { IMPORT_TOKEN, PASSWORD, startApp } from "./harness.mjs";
import { BEISPIEL } from "./beispiel.mjs";
import { heute, kennzahlen } from "../shared/types.ts";

let app, felix, kerstin, tim, claude;

before(async () => {
  app = await startApp();
  felix = await app.as("felix");
  kerstin = await app.as("kerstin");
  tim = await app.as("Tim"); // Anmeldung auch mit angezeigtem Namen
  claude = app.withToken(IMPORT_TOKEN);
});
after(async () => app?.stop());

const daten = async (who = felix) => (await who("/daten")).data;
const fall = async (id, who = felix) => (await who(`/faelle/${id}`)).data;

describe("Anmeldung", () => {
  test("ohne Anmeldung keine Daten", async () => {
    assert.equal((await fetch(new URL("/api/daten", app.base))).status, 401);
  });
  test("falsches Passwort wird abgelehnt", async () => {
    const r = await fetch(new URL("/api/login", app.base), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ user: "felix", password: "falsch" }) });
    assert.equal(r.status, 401);
  });
  test("gefälschtes Cookie wird abgelehnt", async () => {
    const r = await fetch(new URL("/api/daten", app.base), { headers: { cookie: "rk_session=felix.99999999999999.abc" } });
    assert.equal(r.status, 401);
  });
  test("Rollen zum Start: Felix Inhaber, Kerstin und Tim Büro", async () => {
    assert.equal((await daten(felix)).rolle, "inhaber");
    assert.equal((await daten(kerstin)).rolle, "buero");
    assert.equal((await daten(tim)).rolle, "buero");
  });
});

describe("Import", () => {
  test("Import-Schlüssel gilt nur für den Import-Endpunkt", async () => {
    assert.equal((await claude("/daten")).status, 401);
    assert.equal((await app.withToken("falsch")("/import", { body: BEISPIEL })).status, 401);
  });
  test("Beispieldatei wird vollständig eingelesen", async () => {
    const r = await felix("/import", { body: BEISPIEL });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.deepEqual({ neu: r.data.neu, fehler: r.data.fehler, unbekannt: r.data.unbekannte_felder }, { neu: 5, fehler: [], unbekannt: [] });
  });
  test("Kennzahlen stimmen mit der Datei überein", async () => {
    const d = await daten();
    assert.equal(d.faelle.length, 5);
    assert.deepEqual(kennzahlen(d.faelle, heute()), { offen: 4, kritisch: 1, ueberfaellig: 1, woche: 2, ohneSchritt: 2, erledigt: 1 });
  });
  test("Verlauf, Schritte und Felder kommen vollständig an", async () => {
    const f = await fall("test-musterfrau");
    assert.equal(f.verlauf.length, 12);
    assert.equal(f.schritte.length, 5);
    assert.equal(f.schritte.filter((s) => !s.done).length, 4);
    assert.equal(f.terminText, "Stellungnahme fällig");
    assert.equal(f.hinweis, "Schreiben nur als PDF");
    assert.deepEqual(f.pts, ["Gutachten liegt vor", "Frist zur Stellungnahme läuft"]);
    const h = await fall("test-hersteller");
    assert.equal(h.verlauf[0].d, "2026-09-01"); // TT.MM.JJJJ umgewandelt
    assert.equal(h.schritte[0].t, "Antwort Hersteller abwarten"); // Schritt als reiner Text
    assert.equal((await fall("test-fertig")).erledigt, true); // „Ja“
  });
  test("zweiter Import derselben Datei ändert nichts", async () => {
    const r = await felix("/import", { body: BEISPIEL });
    assert.equal(r.data.unveraendert, 5);
    assert.equal((await fall("test-musterfrau")).verlauf.length, 12);
  });
  test("Nachlieferung über den Import-Schlüssel ergänzt nur Neues", async () => {
    const r = await claude("/import", {
      body: [{ id: "test-beispiel", stufe: "crit", lk: "2026-10-08", verlauf: [{ d: "2026-10-08", t: "Kunde schickt Fotos" }], schritte: [{ t: "Fotos sichten", done: false }] }],
    });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.aktualisiert, 1);
    const f = await fall("test-beispiel");
    assert.equal(f.stufe, "crit");
    assert.equal(f.what, "Kratzer im Glas"); // nicht mitgeliefert → bleibt
    assert.equal(f.verlauf.length, 1);
    assert.equal(f.schritte.length, 1);
    const log = (await felix("/faelle/test-beispiel/aenderungen")).data;
    assert.equal(log[0].aktion, "import");
    assert.equal(log[0].user_id, null);
    assert.match(log[0].detail, /^Import:/);
  });
  test("fehlerhafte Fälle werden gemeldet, der Rest wird eingelesen", async () => {
    const r = await felix("/import", { body: { faelle: [{ id: "test-kaputt", name: "Kaputt", stufe: "sehr" }, { id: "test-neu", name: "Neu", gruppe: "kunde", extra: 1 }] } });
    assert.equal(r.data.neu, 1);
    assert.equal(r.data.fehler.length, 1);
    assert.match(r.data.fehler[0].grund, /stufe/);
    assert.deepEqual(r.data.unbekannte_felder, ["extra"]);
  });
  test("Büro darf nicht importieren", async () => {
    assert.equal((await kerstin("/import", { body: BEISPIEL })).status, 403);
  });
});

describe("Fälle bearbeiten", () => {
  let id;
  test("anlegen mit Schritten", async () => {
    const r = await kerstin("/faelle", { body: { name: "Neukunde", gruppe: "kunde", stufe: "warn", what: "Wasser am Anschluss", termin: "2026-12-01", schritte: [{ t: "Termin machen" }] } });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    id = r.data.id;
    assert.equal(r.data.schritte.length, 1);
    assert.equal(r.data.created_by, "kerstin");
  });
  test("ungültige Werte werden abgelehnt", async () => {
    assert.equal((await kerstin(`/faelle/${id}`, { method: "PATCH", body: { termin: "1.12." } })).status, 400);
    assert.equal((await kerstin(`/faelle/${id}`, { method: "PATCH", body: { gruppe: "x" } })).status, 400);
    assert.equal((await kerstin(`/faelle/${id}`, { method: "PATCH", body: { mh_link: "javascript:alert(1)" } })).status, 400);
  });
  test("Änderung wird mit Name und Zeit protokolliert", async () => {
    const r = await kerstin(`/faelle/${id}`, { method: "PATCH", body: { termin: "2026-12-05", pd_link: "https://firma.pipedrive.com/deal/1" } });
    assert.equal(r.data.termin, "2026-12-05");
    assert.equal(r.data.updated_by, "kerstin");
    assert.equal(r.data.stand, heute());
    const log = (await felix(`/faelle/${id}/aenderungen`)).data;
    assert.ok(log.some((a) => a.user_id === "kerstin" && a.detail === "Termin: 2026-12-01 → 2026-12-05"));
  });
  test("Schritt ergänzen, abhaken, umformulieren, entfernen", async () => {
    let f = (await tim(`/faelle/${id}/schritte`, { body: { t: "Material bestellen" } })).data;
    const s = f.schritte.find((x) => x.t === "Material bestellen");
    f = (await tim(`/schritte/${s.id}`, { method: "PATCH", body: { done: true } })).data;
    const done = f.schritte.find((x) => x.id === s.id);
    assert.equal(done.done, 1);
    assert.equal(done.done_by, "tim");
    f = (await tim(`/schritte/${s.id}`, { method: "PATCH", body: { t: "Material bestellt" } })).data;
    assert.equal(f.schritte.find((x) => x.id === s.id).t, "Material bestellt");
    f = (await tim(`/schritte/${s.id}`, { method: "DELETE" })).data;
    assert.equal(f.schritte.length, 1);
  });
  test("Verlauf: neuer Eintrag mit Datum, chronologisch sortiert", async () => {
    await kerstin(`/faelle/${id}/verlauf`, { body: { d: "2026-10-05", t: "Zweiter" } });
    const f = (await kerstin(`/faelle/${id}/verlauf`, { body: { d: "2026-10-01", t: "Erster" } })).data;
    assert.deepEqual(f.verlauf.map((v) => v.t), ["Erster", "Zweiter"]);
    assert.equal(f.verlauf[0].created_by, "kerstin");
  });
  test("erledigt setzen und wieder öffnen", async () => {
    assert.equal((await kerstin(`/faelle/${id}`, { method: "PATCH", body: { erledigt: true } })).data.erledigt, true);
    assert.equal((await kerstin(`/faelle/${id}`, { method: "PATCH", body: { erledigt: false } })).data.erledigt, false);
    const log = (await felix(`/faelle/${id}/aenderungen`)).data.map((a) => a.aktion);
    assert.ok(log.includes("erledigt") && log.includes("wieder geöffnet"));
  });
  test("Löschen nur als Inhaber; Kopie bleibt im Protokoll", async () => {
    assert.equal((await kerstin(`/faelle/${id}`, { method: "DELETE" })).status, 403);
    assert.equal((await felix(`/faelle/${id}`, { method: "DELETE" })).status, 200);
    assert.equal((await felix(`/faelle/${id}`)).status, 404);
    const log = (await felix(`/faelle/${id}/aenderungen`)).data;
    const kopie = JSON.parse(log.find((a) => a.aktion === "gelöscht").detail);
    assert.equal(kopie.name, "Neukunde");
    assert.equal(kopie.verlauf.length, 2);
  });
});

describe("Rolle Montage", () => {
  let monteur, schrittId, eigenerEintrag;
  before(async () => {
    const r = await felix("/users", { body: { id: "monteur1", name: "Monteur Eins", rolle: "montage", passwort: "montage-1234" } });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    monteur = await app.as("monteur1", "montage-1234");
    schrittId = (await fall("test-musterfrau")).schritte.find((s) => !s.done).id;
  });
  test("darf lesen", async () => {
    const d = await daten(monteur);
    assert.equal(d.rolle, "montage");
    assert.ok(d.faelle.length >= 5);
    assert.equal(d.users.find((u) => u.id === "felix").email, null); // keine fremden Kontaktdaten
  });
  test("darf Schritte abhaken", async () => {
    const r = await monteur(`/schritte/${schrittId}`, { method: "PATCH", body: { done: true } });
    assert.equal(r.status, 200);
    assert.equal(r.data.schritte.find((s) => s.id === schrittId).done_by, "monteur1");
  });
  test("darf Verlaufseintrag schreiben und eigenen ändern", async () => {
    const r = await monteur("/faelle/test-musterfrau/verlauf", { body: { t: "Vor Ort: Rinne geprüft" } });
    assert.equal(r.status, 200);
    eigenerEintrag = r.data.verlauf.find((v) => v.created_by === "monteur1");
    assert.equal(eigenerEintrag.d, heute());
    assert.equal((await monteur(`/verlauf/${eigenerEintrag.id}`, { method: "PATCH", body: { t: "Vor Ort: Rinne geprüft, dicht" } })).status, 200);
  });
  test("darf nichts anderes", async () => {
    const fremd = (await fall("test-musterfrau")).verlauf.find((v) => v.created_by !== "monteur1");
    const versuche = [
      monteur("/faelle/test-musterfrau", { method: "PATCH", body: { stufe: "ok" } }),
      monteur("/faelle", { body: { name: "X" } }),
      monteur("/faelle/test-musterfrau/schritte", { body: { t: "X" } }),
      monteur(`/schritte/${schrittId}`, { method: "PATCH", body: { t: "umbenannt" } }),
      monteur(`/schritte/${schrittId}`, { method: "DELETE" }),
      monteur(`/verlauf/${fremd.id}`, { method: "PATCH", body: { t: "X" } }),
      monteur("/faelle/test-musterfrau", { method: "DELETE" }),
      monteur("/faelle/test-musterfrau/anhaenge", { raw: new Uint8Array([1]), headers: { "content-type": "image/png" } }),
      monteur("/export"),
      monteur("/users", { body: { id: "x", name: "X", rolle: "inhaber", passwort: "12345678" } }),
    ];
    for (const r of await Promise.all(versuche)) assert.equal(r.status, 403, JSON.stringify(r.data));
  });
  test("gesperrter Nutzer kommt nicht mehr rein", async () => {
    await felix("/users/monteur1", { method: "PATCH", body: { aktiv: false } });
    assert.equal((await monteur("/daten")).status, 401);
    await assert.rejects(app.as("monteur1", "montage-1234"));
  });
});

describe("Live-Abgleich", () => {
  test("Änderung des einen ist beim anderen sofort abrufbar", async () => {
    const vorher = await daten(tim);
    assert.deepEqual((await tim(`/daten?rev=${vorher.rev}`)).data, { unchanged: true, rev: vorher.rev });
    await kerstin("/faelle/test-hersteller", { method: "PATCH", body: { status: "Antwort da" } });
    const nachher = (await tim(`/daten?rev=${vorher.rev}`)).data;
    assert.ok(nachher.rev > vorher.rev);
    assert.equal(nachher.faelle.find((f) => f.id === "test-hersteller").status, "Antwort da");
  });
});

describe("Anhänge", () => {
  const pdf = new TextEncoder().encode("%PDF-1.4\n% Test\n");
  test("PDF hochladen und wieder abrufen", async () => {
    const r = await kerstin("/faelle/test-musterfrau/anhaenge", { raw: pdf, headers: { "content-type": "application/pdf", "x-filename": encodeURIComponent("Anwaltsschreiben.pdf") } });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data[0].name, "Anwaltsschreiben.pdf");
    const res = await fetch(new URL(`/api/anhaenge/${r.data[0].id}`, app.base), { headers: { cookie: (await loginCookie("tim")) } });
    assert.equal(res.headers.get("content-type"), "application/pdf");
    assert.equal(await res.text(), "%PDF-1.4\n% Test\n");
    assert.equal((await fall("test-musterfrau")).anhang_count, 1);
  });
  test("andere Dateitypen werden abgelehnt", async () => {
    assert.equal((await kerstin("/faelle/test-musterfrau/anhaenge", { raw: "<script>", headers: { "content-type": "text/html" } })).status, 400);
  });
});

async function loginCookie(user) {
  const r = await fetch(new URL("/api/login", app.base), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ user, password: PASSWORD }) });
  return r.headers.get("set-cookie").split(";")[0];
}

describe("Export und Sicherung", () => {
  test("Export nur für Inhaber, lässt sich unverändert wieder einlesen", async () => {
    assert.equal((await kerstin("/export")).status, 403);
    const r = await felix("/export");
    assert.equal(r.status, 200);
    assert.match(r.headers.get("content-disposition"), /attachment/);
    assert.equal(r.data.faelle.length, r.data.anzahl);
    const back = await felix("/import", { body: r.data });
    assert.deepEqual(back.data.fehler, []);
    assert.equal(back.data.unveraendert, r.data.anzahl);
  });
  test("Sicherung von Hand anlegen und herunterladen", async () => {
    const { key } = (await felix("/backups", { method: "POST" })).data;
    const list = (await felix("/backups")).data;
    assert.ok(list.some((b) => b.key === key));
    const dl = await felix(`/backups/download?key=${encodeURIComponent(key)}`);
    assert.ok(dl.data.faelle.length >= 5);
    assert.equal((await kerstin("/backups")).status, 403);
  });
});

describe("Erinnerungen", () => {
  test("Vorschau kennt Termine morgen und überfällige Fristen", async () => {
    const r = await felix("/erinnerungen/test", { method: "POST" });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.morgen, 1);
    assert.equal(r.data.ueberfaellig, 1);
  });
  test("täglicher Lauf läuft ohne Fehler", async () => {
    assert.equal(await app.cron("13 5 * * *"), 200);
  });
});

describe("Nutzer", () => {
  test("eigenes Passwort ändern macht alte Anmeldung ungültig", async () => {
    const t2 = await app.as("tim");
    assert.equal((await t2("/me", { method: "PATCH", body: { passwort_alt: "falsch", passwort: "neues-passwort" } })).status, 400);
    assert.equal((await t2("/me", { method: "PATCH", body: { passwort_alt: PASSWORD, passwort: "neues-passwort" } })).status, 200);
    assert.equal((await t2("/daten")).status, 401);
    const t3 = await app.as("tim", "neues-passwort");
    assert.equal((await t3("/daten")).status, 200);
  });
  test("Inhaber kann sich nicht selbst aussperren", async () => {
    assert.equal((await felix("/users/felix", { method: "PATCH", body: { rolle: "buero" } })).status, 400);
  });
});
