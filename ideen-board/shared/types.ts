// Gemeinsame Typen und Regeln für Server und Oberfläche

export const USERS = [
  { id: "felix", name: "Felix" },
  { id: "tim", name: "Tim" },
  { id: "kerstin", name: "Kerstin" },
] as const;

/** Wer in der Besprechung abstimmt. Eine Karte wandert weiter, wenn alle hier gleich stimmen. */
export const VOTERS: readonly string[] = ["felix", "tim"];

/** Sammel-Werte für „Zuständig“ */
export const ASSIGNEE_GROUPS = [
  { id: "beide", name: "Felix & Tim" },
  { id: "alle", name: "Alle" },
] as const;

export function assigneeLabel(v: string | null | undefined): string {
  if (!v) return "";
  return ASSIGNEE_GROUPS.find((g) => g.id === v)?.name ?? userName(v);
}

export function assigneeIncludes(assignee: string | null, user: string): boolean {
  if (!assignee) return false;
  if (assignee === "alle") return true;
  if (assignee === "beide") return VOTERS.includes(user);
  return assignee === user;
}
export type UserId = (typeof USERS)[number]["id"];

export function userName(id: string | null | undefined): string {
  if (!id) return "KI/System";
  return USERS.find((u) => u.id === id)?.name ?? id;
}

export const COLUMNS = [
  { key: "eingang", title: "Eingang", hint: "Rohe Ideen, ungefiltert" },
  { key: "ausarbeiten", title: "Ausarbeiten", hint: "Wird gerade durchdacht" },
  { key: "entscheiden", title: "Entscheiden", hint: "Wartet auf Ja/Nein von Felix und Tim" },
  { key: "umsetzen", title: "Umsetzen", hint: "Beschlossen, in Arbeit" },
  { key: "erledigt", title: "Erledigt", hint: "" },
  { key: "parkplatz", title: "Parkplatz", hint: "Später wieder ansehen" },
  { key: "verworfen", title: "Verworfen", hint: "Mit kurzem Grund" },
] as const;
export type ColumnKey = (typeof COLUMNS)[number]["key"];

export function columnTitle(key: string): string {
  return COLUMNS.find((c) => c.key === key)?.title ?? key;
}

export type AiStatus = "pending" | "running" | "done" | "error" | "deferred";

export interface Category {
  id: number;
  name: string;
  color: string;
  sort: number;
}

export interface ChecklistItem {
  id: number;
  card_id: number;
  text: string;
  done: number;
  position: number;
  source: "user" | "ai";
}

export interface Comment {
  id: number;
  card_id: number;
  user_id: string;
  text: string;
  created_at: string;
}

export interface Vote {
  card_id: number;
  user_id: string;
  vote: "ja" | "nein" | "parken";
}

export interface Card {
  id: number;
  title: string;
  description: string;
  column_key: ColumnKey;
  position: number;
  created_by: string;
  created_at: string;
  updated_at: string;
  category_id: number | null;
  benefit: number | null;
  effort: number | null;
  assignee: string | null;
  next_step: string;
  follow_up: string | null;
  reject_reason: string;
  merged_into: number | null;
  brainstorm_id: number | null;
  ai_status: AiStatus;
  ai_error: string | null;
  // vom Server ergänzt
  ai_summary: string | null;
  favorite_by: string[];
  checklist: ChecklistItem[];
  comment_count: number;
  votes: Vote[];
}

export interface HistoryEntry {
  id: number;
  card_id: number;
  user_id: string | null;
  action: string;
  detail: string;
  created_at: string;
}

export interface Brainstorm {
  id: number;
  topic: string;
  created_by: string;
  created_at: string;
  status: "sammeln" | "sortieren" | "fertig";
  ai_status: "none" | "pending" | "running" | "done" | "error";
  ai_error: string | null;
  ai_data: BrainstormAi | null;
}

export interface BrainstormAi {
  themen: { titel: string; karten_ids: number[]; hinweis: string }[];
  zusatz_ideen: { id: string; titel: string; beschreibung: string; status?: "offen" | "angelegt" | "verworfen" }[];
}

export interface BoardData {
  rev: number;
  me: string;
  cards: Card[];
  categories: Category[];
  brainstorms: Brainstorm[];
  settings: { examples_seeded: boolean; company_context: string; ai_monthly_limit_eur: string; ai_enabled: boolean; ai_model: string };
}

// ---- KI-Analyse ----

export interface Source {
  titel: string;
  url: string;
}

export interface AiItem {
  id: string;
  text: string;
}

export interface AiAnalysisData {
  kurzfassung: string;
  kategorie: { vorschlag: string; begruendung: string };
  nutzen: { wert: number; begruendung: string };
  aufwand: { wert: number; begruendung: string };
  naechste_schritte: AiItem[];
  massnahmen: AiItem[];
  infos: { id: string; text: string; ist_schaetzung: boolean; quellen: Source[] }[];
  kosten_zeit: { text: string; ist_schaetzung: boolean };
  risiken: AiItem[];
  offene_fragen: AiItem[];
  aehnliche_karten: { karte_id: number; titel: string; grund: string; zusammenfuehren_empfohlen: boolean }[];
  quellen: Source[];
}

export type AiItemState = Record<string, "uebernommen" | "verworfen">;

export interface AiAnalysis {
  id: number;
  card_id: number;
  version: number;
  created_at: string;
  requested_by: string | null;
  model: string;
  data: AiAnalysisData;
  item_state: AiItemState;
  cost_usd: number;
}

export interface CardDetail {
  card: Card;
  comments: Comment[];
  history: HistoryEntry[];
  analyses: AiAnalysis[];
}

// ---- Priorität ----

export type Priority = "quickwin" | "hoch" | "mittel" | "niedrig" | "offen";

export function priorityOf(benefit: number | null, effort: number | null): Priority {
  if (!benefit || !effort) return "offen";
  if (benefit >= 4 && effort <= 2) return "quickwin";
  const d = benefit - effort;
  if (d >= 2) return "hoch";
  if (d >= 0) return "mittel";
  return "niedrig";
}

export const PRIORITY_LABEL: Record<Priority, string> = {
  quickwin: "Quick Win",
  hoch: "Hoch",
  mittel: "Mittel",
  niedrig: "Niedrig",
  offen: "Unbewertet",
};

export const PRIORITY_ORDER: Priority[] = ["quickwin", "hoch", "mittel", "niedrig", "offen"];
