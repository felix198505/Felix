// Automatische Tests für das Ideen-Board. Aufruf: npm test
// Läuft auch vor jeder Veröffentlichung (npm run deploy) – schlägt ein Test fehl, wird nicht veröffentlicht.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { startApp } from "./harness.mjs";

let app, felix, tim, kerstin;

before(async () => {
  app = await startApp();
  felix = await app.as("felix");
  tim = await app.as("tim");
  kerstin = await app.as("kerstin");
});
after(async () => app?.stop());

const newCard = async (title, who = felix) => (await who("/cards", { body: { title } })).data;
const card = async (id) => (await felix(`/cards/${id}`)).data;
const analysed = (id, n = 1) => app.until(async () => ((await card(id)).analyses.length >= n ? card(id) : null));
const board = async () => (await felix("/board")).data;

describe("Anmeldung", () => {
  test("ohne Anmeldung keine Daten", async () => {
    const r = await fetch(new URL("/api/board", app.base));
    assert.equal(r.status, 401);
  });
  test("falsches Passwort wird abgelehnt", async () => {
    const r = await fetch(new URL("/api/login", app.base), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ user: "felix", password: "falsch" }) });
    assert.equal(r.status, 401);
  });
  test("gefälschtes Cookie wird abgelehnt", async () => {
    const r = await fetch(new URL("/api/board", app.base), { headers: { cookie: "ib_session=felix.99999999999999.abc" } });
    assert.equal(r.status, 401);
  });
});

describe("KI-Analyse", () => {
  test("neue Idee wird automatisch mit dem schnellen Modell analysiert", async () => {
    const c = await newCard("Wartungsabo testen");
    const d = await analysed(c.id);
    assert.equal(d.card.ai_status, "done");
    assert.match(d.analyses[0].model, /sonnet/);
    assert.equal(d.analyses[0].data.naechste_schritte.length, 3);
  });
  test("erfundene Quellen werden entfernt, echte bleiben", async () => {
    const c = await newCard("Quellentest");
    const a = (await analysed(c.id)).analyses[0].data;
    const urls = a.infos.flatMap((i) => i.quellen.map((q) => q.url));
    assert.deepEqual(urls, ["https://example.com/echt"]);
  });
  test("Verschieben ins Ausarbeiten löst gründliche Analyse aus", async () => {
    const c = await newCard("Tiefentest");
    await analysed(c.id);
    await felix(`/cards/${c.id}/move`, { body: { column_key: "ausarbeiten" } });
    const d = await analysed(c.id, 2);
    assert.match(d.analyses[0].model, /opus/);
  });
  test("KI überschreibt nie eigene Felder – erst „Übernehmen“ setzt sie", async () => {
    const c = await newCard("Übernahmetest");
    const d = await analysed(c.id);
    assert.equal(d.card.benefit, null);
    await felix(`/analyses/${d.analyses[0].id}/item`, { body: { item_id: "nutzen", state: "uebernommen" } });
    assert.equal((await card(c.id)).card.benefit, 4);
  });
  test("Feedback und Hinweise fließen in die nächste Analyse ein", async () => {
    await felix("/settings", { method: "PUT", body: { ai_guidance: "Wir arbeiten im Raum Hannover." } });
    const c = await newCard("Feedbacktest");
    const d = await analysed(c.id);
    await felix(`/analyses/${d.analyses[0].id}/feedback`, { body: { rating: -1, comment: "zu allgemein" } });
    await felix(`/cards/${c.id}/analyze`, { body: {} });
    await analysed(c.id, 2);
    const last = JSON.stringify(app.ai.requests.at(-1).messages);
    assert.ok(last.includes("Raum Hannover"));
    assert.ok(last.includes("zu allgemein"));
  });
  test("Kosten werden mitgezählt und die Monatsgrenze greift", async () => {
    assert.ok((await board()).settings.month_cost_eur > 0);
    await felix("/settings", { method: "PUT", body: { ai_monthly_limit_eur: "0" } });
    const c = await newCard("Über dem Limit");
    const d = await app.until(async () => ((await card(c.id)).card.ai_status === "error" ? card(c.id) : null));
    assert.match(d.card.ai_error, /Monatsgrenze/);
    assert.equal(d.analyses.length, 0);
    await felix("/settings", { method: "PUT", body: { ai_monthly_limit_eur: "10" } });
  });
});

describe("Besprechung", () => {
  test("Mehrheit entscheidet (2 von 3)", async () => {
    const c = await newCard("Abstimmung");
    await felix(`/cards/${c.id}/move`, { body: { column_key: "entscheiden" } });
    assert.equal((await felix(`/cards/${c.id}/vote`, { body: { vote: "ja" } })).data.result, "offen");
    assert.equal((await tim(`/cards/${c.id}/vote`, { body: { vote: "nein" } })).data.result, "offen");
    const r = await kerstin(`/cards/${c.id}/vote`, { body: { vote: "ja" } });
    assert.equal(r.data.result, "umsetzen");
    assert.equal(r.data.card.column_key, "umsetzen");
  });
  test("Abstimmen nur in „Entscheiden“", async () => {
    const c = await newCard("Nicht zur Entscheidung");
    assert.equal((await felix(`/cards/${c.id}/vote`, { body: { vote: "ja" } })).status, 400);
  });
});

describe("Karten", () => {
  test("Verschieben setzt Position und Verlauf", async () => {
    const c = await newCard("Verlauf");
    await tim(`/cards/${c.id}/move`, { body: { column_key: "parkplatz" } });
    const d = await card(c.id);
    assert.equal(d.card.column_key, "parkplatz");
    assert.ok(d.history.some((h) => h.action === "verschoben" && h.user_id === "tim"));
  });
  test("Zusammenführen übernimmt Kommentare und Fotos", async () => {
    const a = await newCard("Ziel");
    const b = await newCard("Quelle");
    await felix(`/cards/${b.id}/comments`, { body: { text: "Kommentar an B" } });
    const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="), (ch) => ch.charCodeAt(0));
    assert.equal((await felix(`/cards/${b.id}/attachments`, { raw: png, headers: { "content-type": "image/png" } })).status, 200);
    const r = await felix(`/cards/${a.id}/merge`, { body: { source_ids: [b.id] } });
    assert.equal(r.data.comments.length, 1);
    assert.equal(r.data.attachments.length, 1);
    assert.ok(!(await board()).cards.some((k) => k.id === b.id));
  });
  test("Löschen, Wiederherstellen, endgültig löschen", async () => {
    const c = await newCard("Papierkorb");
    await felix(`/cards/${c.id}/comments`, { body: { text: "bleibt" } });
    await felix(`/cards/${c.id}`, { method: "DELETE" });
    assert.ok(!(await board()).cards.some((k) => k.id === c.id));
    await felix(`/cards/${c.id}/restore`, { method: "POST" });
    assert.ok((await board()).cards.some((k) => k.id === c.id));
    // Nicht gelöschte Karte darf nicht endgültig gelöscht werden
    assert.equal((await felix(`/trash/${c.id}`, { method: "DELETE" })).status, 400);
    assert.equal((await card(c.id)).comments.length, 1);
    await felix(`/cards/${c.id}`, { method: "DELETE" });
    assert.equal((await felix(`/trash/${c.id}`, { method: "DELETE" })).status, 200);
    assert.equal((await felix(`/cards/${c.id}`)).status, 404);
  });
  test("Endgültiges Löschen entfernt auch hineingeführte Karten", async () => {
    const a = await newCard("Ziel2");
    const b = await newCard("Quelle2");
    await felix(`/cards/${a.id}/merge`, { body: { source_ids: [b.id] } });
    await felix(`/cards/${a.id}`, { method: "DELETE" });
    await felix(`/trash/${a.id}`, { method: "DELETE" });
    assert.ok(!(await board()).cards.some((k) => k.id === b.id));
  });
});

describe("Datensicherung", () => {
  test("Export und Zurückspielen ergeben denselben Stand", async () => {
    const exp = (await felix("/export.json")).data;
    await newCard("Nach dem Export");
    const r = await felix("/restore", { body: exp });
    assert.equal(r.status, 200);
    assert.ok(r.data.safetyKey.startsWith("backup-vor-wiederherstellung-"));
    const b = await board();
    assert.ok(!b.cards.some((k) => k.title === "Nach dem Export"));
    assert.equal(b.cards.length, exp.cards.filter((k) => !k.merged_into && !k.deleted_at).length);
    // Die Sicherheitskopie ist abrufbar
    assert.equal((await felix(`/backups/${r.data.safetyKey}`)).status, 200);
  });
  test("Backup-Download nur für Backup-Dateien", async () => {
    assert.equal((await felix("/backups/fotos%2F1%2Fx")).status, 404);
  });
  test("Push-Schlüssel stehen nicht im Export", async () => {
    await felix("/push/key");
    const exp = (await felix("/export.json")).data;
    assert.ok(!exp.settings.some((s) => s.key.startsWith("vapid")));
  });
});

describe("Weitere Funktionen", () => {
  test("Ideen aus Gespräch", async () => {
    const r = await felix("/import/transcript", { body: { text: "Felix: wir sollten mal einen Newsletter für Bestandskunden machen." } });
    assert.equal(r.status, 200);
    assert.equal(r.data.ideen[0].titel, "Idee aus Gespräch");
  });
  test("Wochenrückblick und Kennzahlen", async () => {
    assert.equal((await felix("/reviews", { method: "POST" })).status, 200);
    const s = (await felix("/stats")).data;
    assert.ok(s.total > 0);
    assert.equal(s.months.length, 6);
  });
  test("Brainstorming: erst sammeln, dann bündeln", async () => {
    const { id } = (await felix("/brainstorms", { body: { topic: "Winter" } })).data;
    const i1 = (await felix(`/brainstorms/${id}/ideas`, { body: { title: "Idee 1" } })).data;
    assert.equal(i1.ai_status, "deferred");
    await felix(`/brainstorms/${id}/ideas`, { body: { title: "Idee 2" } });
    await felix(`/brainstorms/${id}/status`, { body: { status: "sortieren" } });
    const b = await app.until(async () => (await board()).brainstorms.find((x) => x.id === id && x.ai_status === "done"));
    assert.equal(b.ai_data.zusatz_ideen.length, 3);
  });
  test("Nicht eingerichtete Verbindungen melden sich verständlich", async () => {
    const c = await newCard("Pipedrive");
    assert.match((await felix(`/cards/${c.id}/pipedrive`, { body: {} })).data.error, /nicht eingerichtet/);
    assert.match((await felix("/digest/test", { method: "POST" })).data.error, /E-Mail/);
  });
});
