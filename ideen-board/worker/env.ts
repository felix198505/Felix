export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  BACKUPS: R2Bucket;
  /** Geheimer Schlüssel zum Signieren der Anmelde-Cookies (Secret) */
  SESSION_SECRET?: string;
  /** Passwort-Hashes (Secrets), erzeugt mit npm run hash-password */
  PASSWORD_HASH_FELIX?: string;
  PASSWORD_HASH_TIM?: string;
  /** Anthropic-API-Schlüssel (Secret). Ohne Schlüssel bleibt die KI-Analyse ausstehend. */
  ANTHROPIC_API_KEY?: string;
  /** Optional: anderes Modell, Standard claude-opus-5-5 */
  AI_MODEL?: string;
}

export type AppEnv = { Bindings: Env; Variables: { user: string } };
