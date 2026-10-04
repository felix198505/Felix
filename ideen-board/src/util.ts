import { assigneeIncludes, priorityOf } from "../shared/types";
import type { Card, Priority } from "../shared/types";

export function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = iso.length === 10 ? new Date(iso + "T00:00:00") : new Date(iso);
  return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export const ACTIVE_COLUMNS = new Set(["eingang", "ausarbeiten", "entscheiden", "umsetzen", "parkplatz"]);

export function isDue(c: Card): boolean {
  return !!c.follow_up && c.follow_up <= todayStr() && ACTIVE_COLUMNS.has(c.column_key);
}

export interface Filters {
  q: string;
  category: string; // "" | id | "none"
  person: string; // "" | felix | tim
  priority: "" | Priority;
  favorites: boolean;
}

export const EMPTY_FILTERS: Filters = { q: "", category: "", person: "", priority: "", favorites: false };

export function filtersActive(f: Filters): boolean {
  return !!(f.q || f.category || f.person || f.priority || f.favorites);
}

export function matches(c: Card, f: Filters, me: string): boolean {
  if (f.q) {
    const q = f.q.toLowerCase();
    const hay = [c.title, c.description, c.next_step, c.ai_summary ?? "", ...c.checklist.map((i) => i.text)].join(" ").toLowerCase();
    if (!hay.includes(q)) return false;
  }
  if (f.category === "none" && c.category_id) return false;
  if (f.category && f.category !== "none" && String(c.category_id) !== f.category) return false;
  if (f.person && c.created_by !== f.person && !assigneeIncludes(c.assignee, f.person)) return false;
  if (f.priority && priorityOf(c.benefit, c.effort) !== f.priority) return false;
  if (f.favorites && !c.favorite_by.includes(me)) return false;
  return true;
}
