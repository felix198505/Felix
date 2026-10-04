export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  /** Optional: R2-Speicher für Backups (sonst werden Backups in der Datenbank abgelegt) */
  BACKUPS?: R2Bucket;
  /** Optional: Warteschlange für KI-Analysen (sonst direkt im Hintergrund) */
  AI_QUEUE?: Queue<import("./ai").AiJob>;
  /** Geheimer Schlüssel zum Signieren der Anmelde-Cookies (Secret) */
  SESSION_SECRET?: string;
  /** Passwörter als Secret – Klartext (PASSWORD_FELIX) oder Hash (PASSWORD_HASH_FELIX, erzeugt mit npm run hash-password) */
  PASSWORD_FELIX?: string;
  PASSWORD_TIM?: string;
  PASSWORD_KERSTIN?: string;
  PASSWORD_HASH_FELIX?: string;
  PASSWORD_HASH_TIM?: string;
  PASSWORD_HASH_KERSTIN?: string;
  /** Anthropic-API-Schlüssel (Secret). Ohne Schlüssel bleibt die KI-Analyse ausstehend. */
  ANTHROPIC_API_KEY?: string;
  /** Öffentliche Adresse der App, z. B. https://felix.felix-till.workers.dev (für Links in Mails und Push) */
  APP_URL?: string;
  /** E-Mail-Versand über Resend (optional) */
  RESEND_API_KEY?: string;
  /** Absender, z. B. "Ideen-Board <ideen@ft-workanddesign.de>" */
  MAIL_FROM?: string;
  /** Pipedrive-API-Token (optional) */
  PIPEDRIVE_API_TOKEN?: string;
  /** Pipedrive-Firmenkürzel, z. B. ft-workanddesign (für Links) */
  PIPEDRIVE_DOMAIN?: string;
  /** Nur für Tests: andere API-Adresse */
  ANTHROPIC_BASE_URL?: string;
  /** Optional: anderes Modell, Standard claude-opus-5-5 */
  AI_MODEL?: string;
}

export type AppEnv = { Bindings: Env; Variables: { user: string } };
