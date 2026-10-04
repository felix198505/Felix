export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  /** Anthropic-API-Schlüssel (Secret). Ohne Schlüssel bleibt die KI-Analyse ausstehend. */
  ANTHROPIC_API_KEY?: string;
  /** Optional: anderes Modell, Standard claude-opus-5-5 */
  AI_MODEL?: string;
}

export type AppEnv = { Bindings: Env; Variables: { user: string } };
