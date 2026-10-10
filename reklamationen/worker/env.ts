export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  /** Optional: R2-Speicher für Anhänge und Sicherungen (sonst in der Datenbank, max. 1,8 MB je Datei) */
  FILES?: R2Bucket;
  /** Geheimer Schlüssel zum Signieren der Anmelde-Cookies (Secret). Ohne Eintrag wird einer in der Datenbank erzeugt. */
  SESSION_SECRET?: string;
  /** Passwörter als Secret – Klartext (PASSWORD_FELIX) oder Hash (PASSWORD_HASH_FELIX). In der App gesetzte Passwörter haben Vorrang. */
  [key: `PASSWORD_${string}`]: string | undefined;
  /** Schlüssel für den Import-Endpunkt (Claude liefert darüber neue Sachstände nach) */
  IMPORT_TOKEN?: string;
  /** Öffentliche Adresse der App (für Links in Mails und Push) */
  APP_URL?: string;
  /** E-Mail-Versand über Resend (optional) */
  RESEND_API_KEY?: string;
  /** Absender, z. B. "FT Reklamationen <reklamationen@ft-workanddesign.de>" */
  MAIL_FROM?: string;
}

export type Rolle = import("../shared/types").Rolle;

/** user = null bei Zugriff über den Import-Schlüssel */
export type AppEnv = { Bindings: Env; Variables: { user: string | null; rolle: Rolle } };
