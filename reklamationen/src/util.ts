import { heute, passtKennzahl, vergleicheDringlichkeit, vergleicheTermin } from "../shared/types";
import type { Fall, Gruppe, Kennzahl, Stufe } from "../shared/types";

export const today = () => heute();

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}.${m}.${y}`;
}

export function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/** Ganze Tage von heute bis zum Datum (negativ = vorbei) */
export function tageBis(iso: string): number {
  return Math.round((new Date(iso + "T12:00:00Z").getTime() - new Date(today() + "T12:00:00Z").getTime()) / 86400000);
}

export function terminLabel(iso: string): string {
  const n = tageBis(iso);
  if (n === 0) return "heute";
  if (n === 1) return "morgen";
  if (n === -1) return "gestern";
  if (n < 0) return `seit ${-n} Tagen`;
  if (n < 7) return `in ${n} Tagen`;
  return fmtDate(iso);
}

export type Sortierung = "dringlichkeit" | "termin" | "stand" | "name";
export type StatusFilter = "offen" | "erledigt" | "alle";

export interface Filter {
  q: string;
  gruppe: "" | Gruppe;
  stufe: "" | Stufe;
  status: StatusFilter;
  kennzahl: "" | Kennzahl;
  sort: Sortierung;
}

export const LEER: Filter = { q: "", gruppe: "", stufe: "", status: "offen", kennzahl: "", sort: "dringlichkeit" };

export const filterAktiv = (f: Filter) => !!(f.q || f.gruppe || f.stufe || f.kennzahl || f.status !== "offen");

/** Alle Textfelder eines Falls für die Suche */
function heuhaufen(f: Fall): string {
  return [f.name, f.meta, f.what, f.status, f.terminText, f.hinweis, f.id, ...f.pts, ...f.schritte.map((s) => s.t), ...f.verlauf.map((v) => v.t)].join("\n").toLowerCase();
}

const cache = new WeakMap<Fall, string>();

export function passt(f: Fall, flt: Filter, t: string): boolean {
  if (flt.kennzahl) {
    if (!passtKennzahl(f, flt.kennzahl, t)) return false;
  } else if (flt.status === "offen" && f.erledigt) return false;
  else if (flt.status === "erledigt" && !f.erledigt) return false;
  if (flt.gruppe && f.gruppe !== flt.gruppe) return false;
  if (flt.stufe && f.stufe !== flt.stufe) return false;
  if (flt.q) {
    let h = cache.get(f);
    if (h === undefined) cache.set(f, (h = heuhaufen(f)));
    // alle Wörter müssen vorkommen
    if (!flt.q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => h!.includes(w))) return false;
  }
  return true;
}

export function sortiere(list: Fall[], s: Sortierung): Fall[] {
  const cmp: Record<Sortierung, (a: Fall, b: Fall) => number> = {
    dringlichkeit: vergleicheDringlichkeit,
    termin: (a, b) => Number(a.erledigt) - Number(b.erledigt) || vergleicheTermin(a, b) || a.name.localeCompare(b.name, "de"),
    stand: (a, b) => (b.stand ?? "").localeCompare(a.stand ?? "") || b.updated_at.localeCompare(a.updated_at),
    name: (a, b) => a.name.localeCompare(b.name, "de"),
  };
  return [...list].sort(cmp[s]);
}

/** Schreibt eine Datei zum Herunterladen */
export function download(name: string, blob: Blob) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/** Verkleinert Fotos vor dem Hochladen (max. 2000 px, JPEG) */
export async function verkleinern(file: File): Promise<Blob> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 600_000) return file;
  try {
    const bmp = await createImageBitmap(file);
    const f = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * f);
    c.height = Math.round(bmp.height * f);
    c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", 0.85));
    return blob && blob.size < file.size ? blob : file;
  } catch {
    return file;
  }
}
