import { api, ApiError } from "./api";
import type { BoardData } from "../shared/types";

// Offline-Unterstützung: Ideen ohne Netz zwischenspeichern und später hochladen,
// letzten Board-Stand für die Anzeige ohne Netz merken.

const OUTBOX = "ib_outbox";
const BOARD = "ib_board";

export interface OutboxItem {
  id: string;
  path: string;
  body: unknown;
  label: string;
  at: string;
}

function read<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Speicher voll oder gesperrt – dann eben ohne */
  }
}

export const isNetworkError = (e: unknown) => e instanceof ApiError && e.status === 0;

export function outbox(): OutboxItem[] {
  return read<OutboxItem[]>(OUTBOX, []);
}

export function addToOutbox(path: string, body: unknown, label: string) {
  write(OUTBOX, [...outbox(), { id: crypto.randomUUID(), path, body, label, at: new Date().toISOString() }]);
  window.dispatchEvent(new Event("ib-outbox"));
}

let flushing = false;
/** Lädt zwischengespeicherte Ideen hoch. Gibt die Zahl der hochgeladenen zurück. */
export async function flushOutbox(): Promise<number> {
  if (flushing) return 0;
  flushing = true;
  let sent = 0;
  try {
    for (const item of outbox()) {
      try {
        await api(item.path, { body: item.body });
      } catch (e) {
        if (isNetworkError(e)) break; // immer noch offline
        // Fachlicher Fehler (z. B. Brainstorming gelöscht): Eintrag nicht ewig mitschleppen
      }
      write(
        OUTBOX,
        outbox().filter((x) => x.id !== item.id),
      );
      sent++;
    }
  } finally {
    flushing = false;
    window.dispatchEvent(new Event("ib-outbox"));
  }
  return sent;
}

/** Schickt eine neue Idee ab – oder legt sie offline in den Zwischenspeicher */
export async function sendOrQueue(path: string, body: unknown, label: string): Promise<"sent" | "queued"> {
  if (!navigator.onLine) {
    addToOutbox(path, body, label);
    return "queued";
  }
  try {
    await api(path, { body });
    return "sent";
  } catch (e) {
    if (!isNetworkError(e)) throw e;
    addToOutbox(path, body, label);
    return "queued";
  }
}

export function saveBoard(b: BoardData) {
  write(BOARD, { savedAt: new Date().toISOString(), board: b });
}

export function loadSavedBoard(): { savedAt: string; board: BoardData } | null {
  return read<{ savedAt: string; board: BoardData } | null>(BOARD, null);
}

export function clearSaved() {
  try {
    localStorage.removeItem(BOARD);
    localStorage.removeItem(OUTBOX);
  } catch {
    /* egal */
  }
}
