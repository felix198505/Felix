// Gemeinsame Typen und Regeln für Server und Oberfläche

export type Rolle = "inhaber" | "buero" | "montage";
export type Gruppe = "recht" | "kunde" | "leiner";
export type Stufe = "crit" | "warn" | "ok";

export const ROLLEN: { id: Rolle; name: string; hint: string }[] = [
  { id: "inhaber", name: "Inhaber", hint: "alles, auch Löschen, Nutzer und Export" },
  { id: "buero", name: "Büro", hint: "alles außer Löschen" },
  { id: "montage", name: "Montage", hint: "lesen, Schritte abhaken, Verlauf schreiben" },
];

export const GRUPPEN: { id: Gruppe; name: string; kurz: string }[] = [
  { id: "recht", name: "Mit Anwalt oder Gericht", kurz: "Recht" },
  { id: "kunde", name: "Kundenreklamation", kurz: "Kunde" },
  { id: "leiner", name: "Herstellerfall", kurz: "Hersteller" },
];

export const STUFEN: { id: Stufe; name: string }[] = [
  { id: "crit", name: "Kritisch" },
  { id: "warn", name: "Offen" },
  { id: "ok", name: "Im Plan" },
];

export const gruppeName = (g: string) => GRUPPEN.find((x) => x.id === g)?.name ?? g;
export const gruppeKurz = (g: string) => GRUPPEN.find((x) => x.id === g)?.kurz ?? g;
export const stufeName = (s: string) => STUFEN.find((x) => x.id === s)?.name ?? s;
export const rolleName = (r: string) => ROLLEN.find((x) => x.id === r)?.name ?? r;

/** Was darf eine Rolle? */
export const darf = {
  bearbeiten: (r: Rolle) => r === "inhaber" || r === "buero",
  loeschen: (r: Rolle) => r === "inhaber",
  verwalten: (r: Rolle) => r === "inhaber",
  abhaken: (_r: Rolle) => true,
  verlaufSchreiben: (_r: Rolle) => true,
};

export interface User {
  id: string;
  name: string;
  rolle: Rolle;
  email: string | null;
  aktiv: number;
  erinnerungen: number;
  /** nur für Inhaber sichtbar: Passwort in der App gesetzt (sonst Cloudflare-Secret) */
  hat_passwort?: boolean;
}

export interface Schritt {
  id: number;
  pos: number;
  t: string;
  done: number;
  done_by: string | null;
  done_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_by: string | null;
  updated_at: string;
}

export interface VerlaufEintrag {
  id: number;
  pos: number;
  d: string;
  t: string;
  created_by: string | null;
  created_at: string;
  updated_by: string | null;
  updated_at: string;
}

export interface Fall {
  id: string;
  name: string;
  meta: string;
  gruppe: Gruppe;
  what: string;
  pts: string[];
  schritte: Schritt[];
  verlauf: VerlaufEintrag[];
  status: string;
  stufe: Stufe;
  termin: string | null;
  terminText: string;
  erledigt: boolean;
  stand: string | null;
  hinweis: string;
  lk: string | null;
  lf: string | null;
  mh_link: string;
  pd_link: string;
  created_at: string;
  created_by: string | null;
  updated_at: string;
  updated_by: string | null;
  anhang_count: number;
}

export interface Aenderung {
  id: number;
  fall_id: string;
  user_id: string | null;
  at: string;
  aktion: string;
  detail: string;
}

export interface Anhang {
  id: number;
  fall_id: string;
  user_id: string | null;
  created_at: string;
  mime: string;
  size: number;
  name: string;
}

export interface Daten {
  rev: number;
  me: string;
  rolle: Rolle;
  faelle: Fall[];
  users: User[];
  settings: { mail_enabled: boolean; import_token_set: boolean; files_in_r2: boolean };
}

/** Felder, die beim Bearbeiten eines Falls geändert werden dürfen (Namen wie im JSON-Export) */
export const FALL_FELDER = [
  "name",
  "meta",
  "gruppe",
  "what",
  "pts",
  "status",
  "stufe",
  "termin",
  "terminText",
  "erledigt",
  "stand",
  "hinweis",
  "lk",
  "lf",
  "mh_link",
  "pd_link",
] as const;
export type FallFeld = (typeof FALL_FELDER)[number];

export const FELD_NAME: Record<FallFeld, string> = {
  name: "Name",
  meta: "Angaben",
  gruppe: "Gruppe",
  what: "Vorgang",
  pts: "Sachstand",
  status: "Status",
  stufe: "Dringlichkeit",
  termin: "Termin",
  terminText: "Termin-Text",
  erledigt: "Erledigt",
  stand: "Stand",
  hinweis: "Hinweis zur Datenlage",
  lk: "Letzte Kundenmail",
  lf: "Letzte Mail von FT",
  mh_link: "Mein Handwerker",
  pd_link: "Pipedrive",
};

// ---------- Datum ----------

/** Heutiges Datum (JJJJ-MM-TT) in deutscher Zeit */
export function heute(now = new Date()): string {
  return now.toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
}

export function plusTage(iso: string, n: number): string {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function isDatum(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

// ---------- Kennzahlen ----------

export type Kennzahl = "offen" | "kritisch" | "ueberfaellig" | "woche" | "ohneSchritt" | "erledigt";

export const offeneSchritte = (f: Fall) => f.schritte.filter((s) => !s.done).length;

export function passtKennzahl(f: Fall, k: Kennzahl, today: string): boolean {
  if (k === "erledigt") return f.erledigt;
  if (f.erledigt) return false;
  switch (k) {
    case "offen":
      return true;
    case "kritisch":
      return f.stufe === "crit";
    case "ueberfaellig":
      return !!f.termin && f.termin < today;
    case "woche":
      return !!f.termin && f.termin >= today && f.termin <= plusTage(today, 7);
    case "ohneSchritt":
      return offeneSchritte(f) === 0;
  }
}

export function kennzahlen(faelle: Fall[], today: string): Record<Kennzahl, number> {
  const ks: Kennzahl[] = ["offen", "kritisch", "ueberfaellig", "woche", "ohneSchritt", "erledigt"];
  return Object.fromEntries(ks.map((k) => [k, faelle.filter((f) => passtKennzahl(f, k, today)).length])) as Record<Kennzahl, number>;
}

const STUFE_RANG: Record<string, number> = { crit: 0, warn: 1, ok: 2 };

/** Dringlichkeit: offen vor erledigt, kritisch vor offen vor im Plan, überfällige/nahe Termine zuerst */
export function vergleicheDringlichkeit(a: Fall, b: Fall): number {
  if (a.erledigt !== b.erledigt) return a.erledigt ? 1 : -1;
  const s = (STUFE_RANG[a.stufe] ?? 1) - (STUFE_RANG[b.stufe] ?? 1);
  if (s) return s;
  return vergleicheTermin(a, b) || a.name.localeCompare(b.name, "de");
}

export function vergleicheTermin(a: Fall, b: Fall): number {
  if (a.termin && b.termin) return a.termin.localeCompare(b.termin);
  if (a.termin) return -1;
  if (b.termin) return 1;
  return 0;
}
