import type { CSSProperties } from "react";
import { userName } from "../../shared/types";

const COLORS: Record<string, string> = {
  felix: "#34f58c",
  tim: "#67e8f9",
  kerstin: "#f472b6",
};
const FALLBACK = ["#a78bfa", "#fbbf24", "#fb923c", "#4ade80"];

export function userColor(id: string): string {
  if (COLORS[id]) return COLORS[id];
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return FALLBACK[h % FALLBACK.length];
}

export function Avatar({ id, size, title }: { id: string; size?: "sm" | "lg"; title?: string }) {
  return (
    <span className={"avatar" + (size ? " " + size : "")} style={{ "--c": userColor(id) } as CSSProperties} title={title ?? userName(id)}>
      {userName(id).slice(0, 1).toUpperCase()}
    </span>
  );
}

/** Kategorie-Farbe als CSS-Variable für Karten-Leuchtstreifen */
export const catVar = (color?: string | null) => ({ "--cat": color ?? "transparent" }) as CSSProperties;
