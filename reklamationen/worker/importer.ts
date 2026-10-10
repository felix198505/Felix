// Import von Fällen im Format des bisherigen Tools (gleiche Feldnamen).
// Wird für den einmaligen Import der Export-Datei und für spätere Nachlieferungen (Claude) genutzt.
import { GRUPPEN, STUFEN, heute } from "../shared/types";
import type { Gruppe, Stufe } from "../shared/types";
import { audit, nowIso } from "./db";

export interface ImportFall {
  id: string;
  /** nur die im JSON vorhandenen Felder (Spaltennamen der Datenbank) */
  felder: Record<string, unknown>;
  schritte?: { t: string; done: boolean }[];
  verlauf?: { d: string; t: string }[];
}

export interface ImportBericht {
  gelesen: number;
  neu: number;
  aktualisiert: number;
  unveraendert: number;
  fehler: { nr: number; id?: string; grund: string }[];
  unbekannte_felder: string[];
}

const BEKANNT = new Set([
  "id", "name", "meta", "gruppe", "what", "pts", "schritte", "verlauf", "status", "stufe", "termin", "terminText", "termin_text",
  "erledigt", "stand", "hinweis", "lk", "lf", "mh_link", "pd_link", "mhLink", "pdLink",
  // Zeitstempel aus dem eigenen Export werden übersprungen
  "created_at", "created_by", "updated_at", "updated_by", "anhang_count",
]);

/** Datum in JJJJ-MM-TT umwandeln; akzeptiert auch TT.MM.JJJJ und ISO-Zeitstempel */
export function normDatum(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);
  if (m) {
    const y = m[3].length === 2 ? "20" + m[3] : m[3];
    return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  return null;
}

function bool(v: unknown): boolean {
  if (typeof v === "string") return ["ja", "true", "1", "yes", "x", "erledigt"].includes(v.trim().toLowerCase());
  return !!v;
}

const text = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());

function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "fall"
  );
}

export function neueId(name: string): string {
  return `${slug(name)}-${crypto.randomUUID().slice(0, 6)}`;
}

/** Findet die Liste der Fälle in verschiedenen JSON-Formen */
export function faelleAus(json: unknown): unknown[] {
  if (Array.isArray(json)) return json;
  if (json && typeof json === "object") {
    const o = json as Record<string, unknown>;
    for (const k of ["faelle", "fälle", "cases", "items", "data", "records"]) if (Array.isArray(o[k])) return o[k] as unknown[];
    if (o.faelle && typeof o.faelle === "object") return Object.entries(o.faelle as object).map(([id, v]) => ({ id, ...(v as object) }));
    // Objekt mit Fällen als Werten ({ "fall-1": {...}, ... })
    const vals = Object.entries(o).filter(([, v]) => v && typeof v === "object" && !Array.isArray(v) && "name" in (v as object));
    if (vals.length) return vals.map(([id, v]) => ({ id, ...(v as object) }));
    if ("name" in o) return [o];
  }
  throw new Error("Keine Fälle in der Datei gefunden (erwartet: Liste von Fällen oder { faelle: [...] })");
}

/** Prüft und vereinheitlicht einen Fall. Wirft bei unbrauchbaren Daten. */
export function normFall(raw: unknown, unbekannt: Set<string>): ImportFall {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("kein Objekt");
  const r = raw as Record<string, unknown>;
  for (const k of Object.keys(r)) if (!BEKANNT.has(k)) unbekannt.add(k);
  const has = (k: string) => k in r && r[k] !== undefined;
  const f: Record<string, unknown> = {};

  if (has("name")) {
    f.name = text(r.name);
    if (!f.name) throw new Error("Name fehlt");
  }
  const id = text(r.id) || (f.name ? neueId(f.name as string) : "");
  if (!id) throw new Error("weder id noch name");
  if (id.length > 120) throw new Error("id zu lang");

  for (const k of ["meta", "what", "status", "hinweis"]) if (has(k)) f[k] = text(r[k]);
  if (has("gruppe")) {
    const g = text(r.gruppe).toLowerCase();
    if (!GRUPPEN.some((x) => x.id === g)) throw new Error(`unbekannte gruppe "${g}"`);
    f.gruppe = g as Gruppe;
  }
  if (has("stufe")) {
    const s = text(r.stufe).toLowerCase();
    if (!STUFEN.some((x) => x.id === s)) throw new Error(`unbekannte stufe "${s}"`);
    f.stufe = s as Stufe;
  }
  if (has("pts")) {
    const p = r.pts;
    const list = Array.isArray(p) ? p.map(text) : text(p).split(/\n+/);
    f.pts = JSON.stringify(list.filter(Boolean));
  }
  for (const k of ["termin", "stand", "lk", "lf"]) {
    if (!has(k)) continue;
    const d = normDatum(r[k]);
    if (r[k] && !d) throw new Error(`${k} ist kein Datum: "${text(r[k]).slice(0, 30)}"`);
    f[k] = d;
  }
  if (has("terminText") || has("termin_text")) f.termin_text = text(r.terminText ?? r.termin_text);
  if (has("erledigt")) f.erledigt = bool(r.erledigt) ? 1 : 0;
  if (has("mh_link") || has("mhLink")) f.mh_link = text(r.mh_link ?? r.mhLink);
  if (has("pd_link") || has("pdLink")) f.pd_link = text(r.pd_link ?? r.pdLink);

  const out: ImportFall = { id, felder: f };
  if (has("schritte")) {
    if (!Array.isArray(r.schritte)) throw new Error("schritte ist keine Liste");
    out.schritte = r.schritte
      .map((s) => (typeof s === "string" ? { t: s.trim(), done: false } : { t: text((s as Record<string, unknown>)?.t ?? (s as Record<string, unknown>)?.text), done: bool((s as Record<string, unknown>)?.done ?? (s as Record<string, unknown>)?.erledigt) }))
      .filter((s) => s.t);
  }
  if (has("verlauf")) {
    if (!Array.isArray(r.verlauf)) throw new Error("verlauf ist keine Liste");
    out.verlauf = r.verlauf.map((v, i) => {
      const o = (typeof v === "string" ? { t: v } : v) as Record<string, unknown>;
      const t = text(o?.t ?? o?.text);
      const d = normDatum(o?.d ?? o?.datum);
      if (!t) throw new Error(`verlauf[${i}] ohne Text`);
      if (!d) throw new Error(`verlauf[${i}] ohne gültiges Datum`);
      return { d, t };
    });
  }
  return out;
}

type Existing = { row: Record<string, unknown>; schritte: { id: number; t: string; done: number }[]; verlauf: { d: string; t: string }[] };

/**
 * Schreibt importierte Fälle in die Datenbank.
 * modus "ergaenzen" (Standard): vorhandene Fälle behalten Felder, die nicht im JSON stehen; Verlaufseinträge
 * kommen dazu, wenn Datum + Text noch fehlen; Schritte werden über den Text erkannt (Haken wird übernommen).
 * modus "ersetzen": Schritte und Verlauf eines Falls werden durch die Liste im JSON ersetzt.
 */
export async function importiere(db: D1Database, json: unknown, user: string | null, modus: "ergaenzen" | "ersetzen" = "ergaenzen"): Promise<ImportBericht> {
  const liste = faelleAus(json);
  const bericht: ImportBericht = { gelesen: liste.length, neu: 0, aktualisiert: 0, unveraendert: 0, fehler: [], unbekannte_felder: [] };
  const unbekannt = new Set<string>();
  const wer = user ? undefined : "Import";
  const now = nowIso();
  const gesehen = new Set<string>();

  for (let i = 0; i < liste.length; i++) {
    let f: ImportFall;
    try {
      f = normFall(liste[i], unbekannt);
    } catch (e) {
      bericht.fehler.push({ nr: i + 1, id: text((liste[i] as Record<string, unknown>)?.id) || undefined, grund: (e as Error).message });
      continue;
    }
    if (gesehen.has(f.id)) {
      bericht.fehler.push({ nr: i + 1, id: f.id, grund: "id doppelt in der Datei" });
      continue;
    }
    gesehen.add(f.id);
    const ex = await existing(db, f.id);
    const stmts: D1PreparedStatement[] = [];
    const aenderungen: string[] = [];

    if (!ex) {
      if (!f.felder.name) {
        bericht.fehler.push({ nr: i + 1, id: f.id, grund: "neuer Fall ohne Name" });
        continue;
      }
      const cols = { gruppe: "kunde", stufe: "warn", stand: heute(), ...f.felder, id: f.id, created_at: now, created_by: user, updated_at: now, updated_by: user };
      const keys = Object.keys(cols);
      stmts.push(db.prepare(`INSERT INTO faelle (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`).bind(...Object.values(cols)));
      (f.schritte ?? []).forEach((s, pos) => stmts.push(insSchritt(db, f.id, pos, s, user, now)));
      (f.verlauf ?? []).forEach((v, pos) => stmts.push(insVerlauf(db, f.id, pos, v, user, now)));
      stmts.push(audit(db, f.id, user, "angelegt", `per Import${wer ? ` (${wer})` : ""}: ${f.schritte?.length ?? 0} Schritte, ${f.verlauf?.length ?? 0} Verlaufseinträge`));
      await db.batch(stmts);
      bericht.neu++;
      continue;
    }

    // Felder vergleichen und nur Abweichungen schreiben
    const diff = Object.entries(f.felder).filter(([k, v]) => (ex.row[k] ?? null) !== (v ?? null));
    if (diff.length) {
      stmts.push(
        db.prepare(`UPDATE faelle SET ${diff.map(([k]) => `${k} = ?`).join(", ")}, updated_at = ?, updated_by = ? WHERE id = ?`).bind(...diff.map(([, v]) => v), now, user, f.id),
      );
      aenderungen.push("Felder: " + diff.map(([k]) => k).join(", "));
    }

    if (f.schritte) {
      if (modus === "ersetzen") {
        const gleich = ex.schritte.length === f.schritte.length && ex.schritte.every((s, j) => s.t === f.schritte![j].t && !!s.done === f.schritte![j].done);
        if (!gleich) {
          stmts.push(db.prepare("DELETE FROM fall_schritte WHERE fall_id = ?").bind(f.id));
          f.schritte.forEach((s, pos) => stmts.push(insSchritt(db, f.id, pos, s, user, now)));
          aenderungen.push(`Schritte ersetzt (${f.schritte.length})`);
        }
      } else {
        let pos = ex.schritte.length;
        let neu = 0;
        let gehakt = 0;
        for (const s of f.schritte) {
          const m = ex.schritte.find((x) => x.t === s.t);
          if (!m) {
            stmts.push(insSchritt(db, f.id, pos++, s, user, now));
            neu++;
          } else if (!!m.done !== s.done) {
            stmts.push(
              db.prepare("UPDATE fall_schritte SET done = ?, done_by = ?, done_at = ?, updated_at = ?, updated_by = ? WHERE id = ?").bind(s.done ? 1 : 0, s.done ? user : null, s.done ? now : null, now, user, m.id),
            );
            gehakt++;
          }
        }
        if (neu) aenderungen.push(`${neu} Schritt(e) neu`);
        if (gehakt) aenderungen.push(`${gehakt} Schritt(e) abgehakt/geöffnet`);
      }
    }

    if (f.verlauf) {
      if (modus === "ersetzen") {
        const key = (v: { d: string; t: string }) => v.d + "\u0000" + v.t;
        const gleich = ex.verlauf.length === f.verlauf.length && ex.verlauf.map(key).sort().join("\u0001") === f.verlauf.map(key).sort().join("\u0001");
        if (!gleich) {
          stmts.push(db.prepare("DELETE FROM fall_verlauf WHERE fall_id = ?").bind(f.id));
          f.verlauf.forEach((v, pos) => stmts.push(insVerlauf(db, f.id, pos, v, user, now)));
          aenderungen.push(`Verlauf ersetzt (${f.verlauf.length})`);
        }
      } else {
        const da = new Set(ex.verlauf.map((v) => v.d + "\u0000" + v.t));
        const neu = f.verlauf.filter((v) => !da.has(v.d + "\u0000" + v.t));
        neu.forEach((v, j) => stmts.push(insVerlauf(db, f.id, ex.verlauf.length + j, v, user, now)));
        if (neu.length) aenderungen.push(`${neu.length} Verlaufseintrag/-einträge neu`);
      }
    }

    if (!stmts.length) {
      bericht.unveraendert++;
      continue;
    }
    // Stand mitziehen, wenn der Import ihn nicht selbst setzt
    if (!("stand" in f.felder)) stmts.push(db.prepare("UPDATE faelle SET stand = ?, updated_at = ?, updated_by = ? WHERE id = ?").bind(heute(), now, user, f.id));
    stmts.push(audit(db, f.id, user, "import", `${wer ? wer + ": " : ""}${aenderungen.join(" · ")}`));
    await db.batch(stmts);
    bericht.aktualisiert++;
  }
  bericht.unbekannte_felder = [...unbekannt].sort();
  return bericht;
}

async function existing(db: D1Database, id: string): Promise<Existing | null> {
  const [row, s, v] = await db.batch([
    db.prepare("SELECT * FROM faelle WHERE id = ?").bind(id),
    db.prepare("SELECT id, t, done FROM fall_schritte WHERE fall_id = ? ORDER BY pos, id").bind(id),
    db.prepare("SELECT d, t FROM fall_verlauf WHERE fall_id = ?").bind(id),
  ]);
  const r = row.results[0] as Record<string, unknown> | undefined;
  if (!r) return null;
  return { row: r, schritte: s.results as Existing["schritte"], verlauf: v.results as Existing["verlauf"] };
}

function insSchritt(db: D1Database, fallId: string, pos: number, s: { t: string; done: boolean }, user: string | null, now: string) {
  return db
    .prepare("INSERT INTO fall_schritte (fall_id, pos, t, done, done_by, done_at, created_at, created_by, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(fallId, pos, s.t, s.done ? 1 : 0, s.done ? user : null, s.done ? now : null, now, user, now, user);
}

function insVerlauf(db: D1Database, fallId: string, pos: number, v: { d: string; t: string }, user: string | null, now: string) {
  return db
    .prepare("INSERT INTO fall_verlauf (fall_id, pos, d, t, created_at, created_by, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(fallId, pos, v.d, v.t, now, user, now, user);
}
