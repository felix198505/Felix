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
  PASSWORD_HASH_FELIX?: string;
  PASSWORD_HASH_TIM?: string;
  /** Anthropic-API-Schlüssel (Secret). Ohne Schlüssel bleibt die KI-Analyse ausstehend. */
  ANTHROPIC_API_KEY?: string;
  /** Nur für Tests: andere API-Adresse */
  ANTHROPIC_BASE_URL?: string;
  /** Optional: anderes Modell, Standard claude-opus-5-5 */
  AI_MODEL?: string;
}

export type AppEnv = { Bindings: Env; Variables: { user: string } };
