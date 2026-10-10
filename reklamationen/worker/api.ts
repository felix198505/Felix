import { Hono } from "hono";
import type { Context } from "hono";
import { FALL_FELDER, FELD_NAME, GRUPPEN, ROLLEN, STUFEN, darf, heute, isDatum } from "../shared/types";
import type { FallFeld, Rolle } from "../shared/types";
import { hashPassword, nur, passwordFor, verifyPassword } from "./auth";
import { audit, getRev, loadAenderungen, loadDaten, loadFall, nowIso } from "./db";
import type { AppEnv } from "./env";
import { importiere, neueId } from "./importer";
import { buildExport } from "./backup";

export const api = new Hono<AppEnv>();

const bearbeiten = nur(darf.bearbeiten, "Fälle bearbeiten");
const loeschen = nur(darf.loeschen, "Fälle löschen");
const verwalten = nur(darf.verwalten, "nur für Inhaber");

const fehler = (c: Context, msg: string, status: 400 | 404 = 400) => c.json({ error: msg }, status);
const me = (c: Context<AppEnv>) => c.get("user");

class Ungueltig extends Error {}

const kurz = (v: unknown) => {
  if (v === null || v === undefined || v === "") return "–";
  const s = typeof v === "boolean" ? (v ? "ja" : "nein") : String(v);
  return s.length > 80 ? s.slice(0, 77) + "…" : s;
};

/** Prüft ein Feld aus der Oberfläche und liefert Spaltenname + Datenbankwert */
function feldWert(k: FallFeld, v: unknown): [string, unknown] {
  const str = (max: number) => {
    if (v !== null && v !== undefined && typeof v !== "string") throw new Ungueltig(`${FELD_NAME[k]}: Text erwartet`);
    return String(v ?? "").trim().slice(0, max);
  };
  const datum = () => {
    if (v === null || v === "" || v === undefined) return null;
    if (!isDatum(v)) throw new Ungueltig(`${FELD_NAME[k]}: Datum im Format JJJJ-MM-TT erwartet`);
    return v;
  };
  switch (k) {
    case "name": {
      const s = str(200);
      if (!s) throw new Ungueltig("Name darf nicht leer sein");
      return ["name", s];
    }
    case "gruppe":
      if (!GRUPPEN.some((g) => g.id === v)) throw new Ungueltig("Unbekannte Gruppe");
      return ["gruppe", v];
    case "stufe":
      if (!STUFEN.some((s) => s.id === v)) throw new Ungueltig("Unbekannte Dringlichkeit");
      return ["stufe", v];
    case "pts":
      if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) throw new Ungueltig("Sachstand: Liste von Texten erwartet");
      return ["pts", JSON.stringify(v.map((x: string) => x.trim()).filter(Boolean))];
    case "erledigt":
      return ["erledigt", v ? 1 : 0];
    case "termin":
    case "stand":
    case "lk":
    case "lf":
      return [k, datum()];
    case "terminText":
      return ["termin_text", str(300)];
    case "mh_link":
    case "pd_link": {
      const s = str(500);
      if (s && !/^https?:\/\//i.test(s)) throw new Ungueltig(`${FELD_NAME[k]}: Link muss mit https:// beginnen`);
      return [k, s];
    }
    default:
      return [k, str(k === "hinweis" || k === "what" ? 4000 : 1000)];
  }
}

function auditText(k: FallFeld, alt: unknown, neu: unknown): string {
  if (k === "pts") {
    const a = JSON.parse(String(alt ?? "[]")) as string[];
    const n = JSON.parse(String(neu ?? "[]")) as string[];
    return `Sachstand geändert (${a.length} → ${n.length} Punkte)`;
  }
  if (k === "erledigt") return neu ? "Fall erledigt" : "Fall wieder geöffnet";
  if (k === "hinweis" || k === "what") return `${FELD_NAME[k]} geändert: ${kurz(neu)}`;
  return `${FELD_NAME[k]}: ${kurz(alt)} → ${kurz(neu)}`;
}

// ---------- Daten ----------

api.get("/daten", async (c) => {
  const user = me(c)!;
  const since = Number(c.req.query("rev") ?? -1);
  if (since >= 0 && since === (await getRev(c.env.DB))) return c.json({ unchanged: true, rev: since });
  return c.json(await loadDaten(c.env, user, c.get("rolle")));
});

// ---------- Fälle ----------

api.post("/faelle", bearbeiten, async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const db = c.env.DB;
  const now = nowIso();
  const cols: Record<string, unknown> = { gruppe: "kunde", stufe: "warn", stand: heute() };
  try {
    for (const k of FALL_FELDER) if (k in body) Object.assign(cols, Object.fromEntries([feldWert(k, body[k])]));
    if (!cols.name) throw new Ungueltig("Name darf nicht leer sein");
  } catch (e) {
    if (e instanceof Ungueltig) return fehler(c, e.message);
    throw e;
  }
  const id = neueId(String(cols.name));
  Object.assign(cols, { id, created_at: now, created_by: me(c), updated_at: now, updated_by: me(c) });
  const keys = Object.keys(cols);
  const stmts = [db.prepare(`INSERT INTO faelle (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`).bind(...Object.values(cols))];
  const schritte = Array.isArray(body.schritte) ? (body.schritte as unknown[]).map((s) => String((s as { t?: string })?.t ?? s).trim()).filter(Boolean) : [];
  schritte.forEach((t, pos) =>
    stmts.push(db.prepare("INSERT INTO fall_schritte (fall_id, pos, t, created_at, created_by, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(id, pos, t.slice(0, 1000), now, me(c), now, me(c))),
  );
  stmts.push(audit(db, id, me(c), "angelegt", String(cols.name)));
  await db.batch(stmts);
  return c.json(await loadFall(db, id));
});

api.get("/faelle/:id", async (c) => {
  const f = await loadFall(c.env.DB, (c.req.param("id") ?? ""));
  return f ? c.json(f) : fehler(c, "Fall nicht gefunden", 404);
});

api.patch("/faelle/:id", bearbeiten, async (c) => {
  const id = (c.req.param("id") ?? "");
  const db = c.env.DB;
  const row = await db.prepare("SELECT * FROM faelle WHERE id = ?").bind(id).first<Record<string, unknown>>();
  if (!row) return fehler(c, "Fall nicht gefunden", 404);
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const sets: [string, unknown][] = [];
  const stmts: D1PreparedStatement[] = [];
  try {
    for (const k of FALL_FELDER) {
      if (!(k in body)) continue;
      const [col, val] = feldWert(k, body[k]);
      if ((row[col] ?? null) === (val ?? null)) continue;
      sets.push([col, val]);
      stmts.push(audit(db, id, me(c), k === "erledigt" ? (val ? "erledigt" : "wieder geöffnet") : "geändert", auditText(k, row[col], val)));
    }
  } catch (e) {
    if (e instanceof Ungueltig) return fehler(c, e.message);
    throw e;
  }
  if (!sets.length) return c.json(await loadFall(db, id));
  // „Stand“ = letzte Bearbeitung, außer er wurde ausdrücklich gesetzt
  if (!sets.some(([k]) => k === "stand")) sets.push(["stand", heute()]);
  sets.push(["updated_at", nowIso()], ["updated_by", me(c)]);
  await db.batch([db.prepare(`UPDATE faelle SET ${sets.map(([k]) => `${k} = ?`).join(", ")} WHERE id = ?`).bind(...sets.map(([, v]) => v), id), ...stmts]);
  return c.json(await loadFall(db, id));
});

api.delete("/faelle/:id", loeschen, async (c) => {
  const id = (c.req.param("id") ?? "");
  const db = c.env.DB;
  const f = await loadFall(db, id);
  if (!f) return fehler(c, "Fall nicht gefunden", 404);
  const files = await db.prepare("SELECT r2_key FROM anhaenge WHERE fall_id = ? AND r2_key IS NOT NULL").bind(id).all<{ r2_key: string }>();
  if (c.env.FILES) for (const r of files.results) await c.env.FILES.delete(r.r2_key);
  // Vollständige Kopie im Änderungsprotokoll – der Fall lässt sich daraus notfalls wieder importieren
  const { anhang_count: _a, ...kopie } = f;
  await db.batch([
    db.prepare("DELETE FROM fall_schritte WHERE fall_id = ?").bind(id),
    db.prepare("DELETE FROM fall_verlauf WHERE fall_id = ?").bind(id),
    db.prepare("DELETE FROM anhaenge WHERE fall_id = ?").bind(id),
    db.prepare("DELETE FROM erinnerungen WHERE fall_id = ?").bind(id),
    db.prepare("DELETE FROM faelle WHERE id = ?").bind(id),
    audit(db, id, me(c), "gelöscht", JSON.stringify({ ...kopie, schritte: f.schritte.map((s) => ({ t: s.t, done: !!s.done })), verlauf: f.verlauf.map((v) => ({ d: v.d, t: v.t })) })),
  ]);
  return c.json({ ok: true });
});

api.get("/faelle/:id/aenderungen", async (c) => c.json(await loadAenderungen(c.env.DB, (c.req.param("id") ?? ""))));

// ---------- Nächste Schritte ----------

async function touch(db: D1Database, fallId: string, user: string | null) {
  return db.prepare("UPDATE faelle SET stand = ?, updated_at = ?, updated_by = ? WHERE id = ?").bind(heute(), nowIso(), user, fallId);
}

api.post("/faelle/:id/schritte", bearbeiten, async (c) => {
  const id = (c.req.param("id") ?? "");
  const db = c.env.DB;
  const { t } = await c.req.json<{ t?: string }>().catch(() => ({}) as { t?: string });
  const txt = String(t ?? "").trim().slice(0, 1000);
  if (!txt) return fehler(c, "Text fehlt");
  if (!(await db.prepare("SELECT 1 FROM faelle WHERE id = ?").bind(id).first())) return fehler(c, "Fall nicht gefunden", 404);
  const now = nowIso();
  await db.batch([
    db
      .prepare("INSERT INTO fall_schritte (fall_id, pos, t, created_at, created_by, updated_at, updated_by) VALUES (?, (SELECT COALESCE(MAX(pos), -1) + 1 FROM fall_schritte WHERE fall_id = ?), ?, ?, ?, ?, ?)")
      .bind(id, id, txt, now, me(c), now, me(c)),
    await touch(db, id, me(c)),
    audit(db, id, me(c), "Schritt neu", txt),
  ]);
  return c.json(await loadFall(db, id));
});

api.patch("/schritte/:sid", async (c) => {
  const db = c.env.DB;
  const sid = Number((c.req.param("sid") ?? ""));
  const s = await db.prepare("SELECT * FROM fall_schritte WHERE id = ?").bind(sid).first<{ fall_id: string; t: string; done: number }>();
  if (!s) return fehler(c, "Schritt nicht gefunden", 404);
  const body = await c.req.json<{ done?: boolean; t?: string }>().catch(() => ({}) as { done?: boolean; t?: string });
  const now = nowIso();
  const stmts: D1PreparedStatement[] = [];
  if (body.t !== undefined) {
    if (!darf.bearbeiten(c.get("rolle"))) return c.json({ error: "Keine Berechtigung: Schritte umformulieren" }, 403);
    const t = String(body.t).trim().slice(0, 1000);
    if (!t) return fehler(c, "Text fehlt");
    if (t !== s.t) {
      stmts.push(db.prepare("UPDATE fall_schritte SET t = ?, updated_at = ?, updated_by = ? WHERE id = ?").bind(t, now, me(c), sid));
      stmts.push(audit(db, s.fall_id, me(c), "Schritt geändert", `${kurz(s.t)} → ${kurz(t)}`));
    }
  }
  if (body.done !== undefined && !!body.done !== !!s.done) {
    stmts.push(db.prepare("UPDATE fall_schritte SET done = ?, done_by = ?, done_at = ?, updated_at = ?, updated_by = ? WHERE id = ?").bind(body.done ? 1 : 0, body.done ? me(c) : null, body.done ? now : null, now, me(c), sid));
    stmts.push(audit(db, s.fall_id, me(c), body.done ? "Schritt erledigt" : "Schritt wieder offen", s.t));
  }
  if (stmts.length) await db.batch([...stmts, await touch(db, s.fall_id, me(c))]);
  return c.json(await loadFall(db, s.fall_id));
});

api.delete("/schritte/:sid", bearbeiten, async (c) => {
  const db = c.env.DB;
  const sid = Number((c.req.param("sid") ?? ""));
  const s = await db.prepare("SELECT fall_id, t FROM fall_schritte WHERE id = ?").bind(sid).first<{ fall_id: string; t: string }>();
  if (!s) return fehler(c, "Schritt nicht gefunden", 404);
  await db.batch([db.prepare("DELETE FROM fall_schritte WHERE id = ?").bind(sid), await touch(db, s.fall_id, me(c)), audit(db, s.fall_id, me(c), "Schritt entfernt", s.t)]);
  return c.json(await loadFall(db, s.fall_id));
});

// ---------- Verlauf ----------

api.post("/faelle/:id/verlauf", async (c) => {
  const id = (c.req.param("id") ?? "");
  const db = c.env.DB;
  const body = await c.req.json<{ d?: string; t?: string }>().catch(() => ({}) as { d?: string; t?: string });
  const t = String(body.t ?? "").trim().slice(0, 4000);
  const d = body.d || heute();
  if (!t) return fehler(c, "Text fehlt");
  if (!isDatum(d)) return fehler(c, "Datum im Format JJJJ-MM-TT erwartet");
  if (!(await db.prepare("SELECT 1 FROM faelle WHERE id = ?").bind(id).first())) return fehler(c, "Fall nicht gefunden", 404);
  const now = nowIso();
  await db.batch([
    db
      .prepare("INSERT INTO fall_verlauf (fall_id, pos, d, t, created_at, created_by, updated_at, updated_by) VALUES (?, (SELECT COALESCE(MAX(pos), -1) + 1 FROM fall_verlauf WHERE fall_id = ?), ?, ?, ?, ?, ?, ?)")
      .bind(id, id, d, t, now, me(c), now, me(c)),
    await touch(db, id, me(c)),
    audit(db, id, me(c), "Verlauf neu", `${d}: ${kurz(t)}`),
  ]);
  return c.json(await loadFall(db, id));
});

/** Verlaufseinträge ändern oder löschen: Büro/Inhaber oder wer den Eintrag selbst geschrieben hat */
async function verlaufZugriff(c: Context<AppEnv>) {
  const vid = Number((c.req.param("vid") ?? ""));
  const v = await c.env.DB.prepare("SELECT * FROM fall_verlauf WHERE id = ?").bind(vid).first<{ id: number; fall_id: string; d: string; t: string; created_by: string | null }>();
  if (!v) return { err: fehler(c, "Eintrag nicht gefunden", 404) };
  if (!darf.bearbeiten(c.get("rolle")) && v.created_by !== me(c)) return { err: c.json({ error: "Keine Berechtigung: nur eigene Einträge ändern" }, 403) };
  return { v };
}

api.patch("/verlauf/:vid", async (c) => {
  const { v, err } = await verlaufZugriff(c);
  if (err) return err;
  const db = c.env.DB;
  const body = await c.req.json<{ d?: string; t?: string }>().catch(() => ({}) as { d?: string; t?: string });
  const d = body.d ?? v.d;
  const t = body.t === undefined ? v.t : String(body.t).trim().slice(0, 4000);
  if (!t) return fehler(c, "Text fehlt");
  if (!isDatum(d)) return fehler(c, "Datum im Format JJJJ-MM-TT erwartet");
  if (d !== v.d || t !== v.t) {
    await db.batch([
      db.prepare("UPDATE fall_verlauf SET d = ?, t = ?, updated_at = ?, updated_by = ? WHERE id = ?").bind(d, t, nowIso(), me(c), v.id),
      await touch(db, v.fall_id, me(c)),
      audit(db, v.fall_id, me(c), "Verlauf geändert", `${v.d}: ${kurz(v.t)} → ${d}: ${kurz(t)}`),
    ]);
  }
  return c.json(await loadFall(db, v.fall_id));
});

api.delete("/verlauf/:vid", async (c) => {
  const { v, err } = await verlaufZugriff(c);
  if (err) return err;
  const db = c.env.DB;
  await db.batch([db.prepare("DELETE FROM fall_verlauf WHERE id = ?").bind(v.id), await touch(db, v.fall_id, me(c)), audit(db, v.fall_id, me(c), "Verlauf entfernt", `${v.d}: ${kurz(v.t)}`)]);
  return c.json(await loadFall(db, v.fall_id));
});

// ---------- Import & Export ----------

api.post("/import", verwalten, async (c) => {
  const json = await c.req.json().catch(() => undefined);
  if (json === undefined) return fehler(c, "Kein gültiges JSON");
  const modus = c.req.query("modus") === "ersetzen" ? "ersetzen" : "ergaenzen";
  try {
    return c.json(await importiere(c.env.DB, json, me(c), modus));
  } catch (e) {
    return fehler(c, (e as Error).message);
  }
});

api.get("/export", verwalten, async (c) => {
  const body = await buildExport(c.env.DB);
  return new Response(body, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="reklamationen-export-${heute()}.json"`,
      "cache-control": "no-store",
    },
  });
});

// ---------- Nutzer ----------

const ID_RE = /^[a-z][a-z0-9_-]{1,30}$/;

api.patch("/me", async (c) => {
  const body = await c.req.json<{ email?: string; erinnerungen?: boolean; passwort_alt?: string; passwort?: string }>().catch(() => ({}) as Record<string, never>);
  const db = c.env.DB;
  const id = me(c)!;
  if (body.email !== undefined) {
    const e = String(body.email).trim();
    if (e && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return fehler(c, "E-Mail-Adresse ungültig");
    await db.prepare("UPDATE users SET email = ? WHERE id = ?").bind(e || null, id).run();
  }
  if (body.erinnerungen !== undefined) await db.prepare("UPDATE users SET erinnerungen = ? WHERE id = ?").bind(body.erinnerungen ? 1 : 0, id).run();
  if (body.passwort !== undefined) {
    const u = await db.prepare("SELECT id, rolle, aktiv, password_hash FROM users WHERE id = ?").bind(id).first<{ id: string; rolle: Rolle; aktiv: number; password_hash: string | null }>();
    const pw = u && passwordFor(c.env, u);
    if (!pw || !(await verifyPassword(String(body.passwort_alt ?? ""), pw))) return fehler(c, "Bisheriges Passwort stimmt nicht");
    if (String(body.passwort).length < 8) return fehler(c, "Neues Passwort: mindestens 8 Zeichen");
    await db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").bind(await hashPassword(String(body.passwort)), id).run();
    return c.json({ ok: true, neu_anmelden: true });
  }
  return c.json({ ok: true });
});

api.post("/users", verwalten, async (c) => {
  const b = await c.req.json<{ id?: string; name?: string; rolle?: string; email?: string; passwort?: string }>().catch(() => ({}) as Record<string, never>);
  const id = String(b.id ?? "").trim().toLowerCase();
  const name = String(b.name ?? "").trim();
  if (!ID_RE.test(id)) return fehler(c, "Anmeldename: 2–31 Zeichen, nur a–z, 0–9, - und _, beginnt mit Buchstabe");
  if (!name) return fehler(c, "Name fehlt");
  if (!ROLLEN.some((r) => r.id === b.rolle)) return fehler(c, "Unbekannte Rolle");
  if (String(b.passwort ?? "").length < 8) return fehler(c, "Passwort: mindestens 8 Zeichen");
  if (await c.env.DB.prepare("SELECT 1 FROM users WHERE id = ?").bind(id).first()) return fehler(c, "Diesen Anmeldenamen gibt es schon");
  await c.env.DB.prepare("INSERT INTO users (id, name, rolle, email, password_hash, erinnerungen) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(id, name.slice(0, 60), b.rolle, String(b.email ?? "").trim() || null, await hashPassword(String(b.passwort)), b.rolle === "montage" ? 0 : 1)
    .run();
  return c.json({ ok: true });
});

api.patch("/users/:id", verwalten, async (c) => {
  const id = (c.req.param("id") ?? "");
  const b = await c.req.json<{ name?: string; rolle?: string; aktiv?: boolean; email?: string; passwort?: string }>().catch(() => ({}) as Record<string, never>);
  const db = c.env.DB;
  if (!(await db.prepare("SELECT 1 FROM users WHERE id = ?").bind(id).first())) return fehler(c, "Nutzer nicht gefunden", 404);
  if (id === me(c) && (b.aktiv === false || (b.rolle && b.rolle !== "inhaber"))) return fehler(c, "Sich selbst sperren oder herabstufen geht nicht");
  const sets: [string, unknown][] = [];
  if (b.name !== undefined) {
    if (!String(b.name).trim()) return fehler(c, "Name fehlt");
    sets.push(["name", String(b.name).trim().slice(0, 60)]);
  }
  if (b.rolle !== undefined) {
    if (!ROLLEN.some((r) => r.id === b.rolle)) return fehler(c, "Unbekannte Rolle");
    sets.push(["rolle", b.rolle]);
  }
  if (b.aktiv !== undefined) sets.push(["aktiv", b.aktiv ? 1 : 0]);
  if (b.email !== undefined) sets.push(["email", String(b.email).trim() || null]);
  if (b.passwort !== undefined) {
    if (String(b.passwort).length < 8) return fehler(c, "Passwort: mindestens 8 Zeichen");
    sets.push(["password_hash", await hashPassword(String(b.passwort))]);
  }
  if (sets.length) await db.prepare(`UPDATE users SET ${sets.map(([k]) => `${k} = ?`).join(", ")} WHERE id = ?`).bind(...sets.map(([, v]) => v), id).run();
  return c.json({ ok: true });
});
