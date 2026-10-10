import type { Aenderung, Daten, Fall, Rolle, Schritt, User, VerlaufEintrag } from "../shared/types";
import type { Env } from "./env";

export const nowIso = () => new Date().toISOString();

export async function getSetting(db: D1Database, key: string): Promise<string | null> {
  const row = await db.prepare("SELECT value FROM settings WHERE key = ?").bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

export async function setSetting(db: D1Database, key: string, value: string): Promise<void> {
  await db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(key, value).run();
}

export async function getRev(db: D1Database): Promise<number> {
  return Number((await getSetting(db, "rev")) ?? "0");
}

/** Erhöht den Änderungszähler, damit alle Geräte neu laden */
export async function bumpRev(db: D1Database): Promise<void> {
  await db.prepare("UPDATE settings SET value = CAST(value AS INTEGER) + 1 WHERE key = 'rev'").run();
}

/** Öffentliche Adresse der App: APP_URL oder die zuletzt genutzte https-Adresse */
export async function appUrl(env: Env): Promise<string> {
  return (env.APP_URL || (await getSetting(env.DB, "app_url")) || "").replace(/\/$/, "");
}

export function audit(db: D1Database, fallId: string, user: string | null, aktion: string, detail = ""): D1PreparedStatement {
  return db.prepare("INSERT INTO aenderungen (fall_id, user_id, at, aktion, detail) VALUES (?, ?, ?, ?, ?)").bind(fallId, user, nowIso(), aktion, detail.slice(0, 2000));
}

type FallRow = Omit<Fall, "pts" | "schritte" | "verlauf" | "erledigt" | "terminText"> & { pts: string; erledigt: number; termin_text: string };

function toFall(r: FallRow, schritte: Schritt[], verlauf: VerlaufEintrag[]): Fall {
  const { termin_text, ...rest } = r;
  let pts: string[] = [];
  try {
    pts = JSON.parse(r.pts);
  } catch {
    /* leer lassen */
  }
  return { ...rest, pts, terminText: termin_text, erledigt: !!r.erledigt, schritte, verlauf };
}

function groupBy<T extends { fall_id: string }>(list: T[]): Map<string, Omit<T, "fall_id">[]> {
  const m = new Map<string, Omit<T, "fall_id">[]>();
  for (const { fall_id, ...x } of list) {
    const arr = m.get(fall_id) ?? [];
    arr.push(x);
    m.set(fall_id, arr);
  }
  return m;
}

export async function loadFaelle(db: D1Database, id?: string): Promise<Fall[]> {
  const w = id ? " WHERE fall_id = ?" : "";
  const b = id ? [id] : [];
  const [rows, schritte, verlauf] = await db.batch([
    db
      .prepare(`SELECT f.*, (SELECT COUNT(*) FROM anhaenge a WHERE a.fall_id = f.id) AS anhang_count FROM faelle f${id ? " WHERE f.id = ?" : ""}`)
      .bind(...b),
    db.prepare(`SELECT * FROM fall_schritte${w} ORDER BY pos, id`).bind(...b),
    db.prepare(`SELECT * FROM fall_verlauf${w} ORDER BY d, pos, id`).bind(...b),
  ]);
  const sm = groupBy(schritte.results as unknown as (Schritt & { fall_id: string })[]);
  const vm = groupBy(verlauf.results as unknown as (VerlaufEintrag & { fall_id: string })[]);
  return (rows.results as unknown as FallRow[]).map((r) => toFall(r, (sm.get(r.id) ?? []) as Schritt[], (vm.get(r.id) ?? []) as VerlaufEintrag[]));
}

export async function loadFall(db: D1Database, id: string): Promise<Fall | null> {
  return (await loadFaelle(db, id))[0] ?? null;
}

export async function loadUsers(db: D1Database, mitDetails: boolean): Promise<User[]> {
  const r = await db.prepare("SELECT id, name, rolle, email, aktiv, erinnerungen, password_hash IS NOT NULL AS hat_passwort FROM users ORDER BY aktiv DESC, name").all<Omit<User, "hat_passwort"> & { hat_passwort: number }>();
  return r.results.map((u) => (mitDetails ? { ...u, hat_passwort: !!u.hat_passwort } : { id: u.id, name: u.name, rolle: u.rolle, email: null, aktiv: u.aktiv, erinnerungen: 0 }));
}

export async function loadDaten(env: Env, me: string, rolle: Rolle): Promise<Daten> {
  const [rev, faelle, users] = await Promise.all([getRev(env.DB), loadFaelle(env.DB), loadUsers(env.DB, rolle === "inhaber")]);
  // eigene Angaben immer vollständig
  const meRow = await env.DB.prepare("SELECT email, erinnerungen FROM users WHERE id = ?").bind(me).first<{ email: string | null; erinnerungen: number }>();
  for (const u of users) if (u.id === me && meRow) Object.assign(u, meRow);
  return {
    rev,
    me,
    rolle,
    faelle,
    users,
    settings: { mail_enabled: Boolean(env.RESEND_API_KEY && env.MAIL_FROM), import_token_set: Boolean(env.IMPORT_TOKEN), files_in_r2: Boolean(env.FILES) },
  };
}

export async function loadAenderungen(db: D1Database, fallId: string): Promise<Aenderung[]> {
  return (await db.prepare("SELECT * FROM aenderungen WHERE fall_id = ? ORDER BY at DESC, id DESC LIMIT 300").bind(fallId).all<Aenderung>()).results;
}
