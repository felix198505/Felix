import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { api, ApiError } from "./api";
import type { Daten, Fall, Rolle, User } from "../shared/types";

// Letzter Stand auf dem Gerät, damit die App ohne Netz (z. B. auf der Baustelle) lesbar bleibt.
// Wird beim Abmelden gelöscht.
const SAVED = "rk_daten";

export function saveDaten(d: Daten) {
  try {
    localStorage.setItem(SAVED, JSON.stringify({ savedAt: new Date().toISOString(), daten: d }));
  } catch {
    /* Speicher voll oder gesperrt */
  }
}

export function loadSavedDaten(): { savedAt: string; daten: Daten } | null {
  try {
    const v = localStorage.getItem(SAVED);
    return v ? JSON.parse(v) : null;
  } catch {
    return null;
  }
}

export function clearSaved() {
  try {
    localStorage.removeItem(SAVED);
  } catch {
    /* egal */
  }
}

export const isNetworkError = (e: unknown) => e instanceof ApiError && e.status === 0;

type ToastAction = { label: string; run: () => void };

interface Store {
  data: Daten;
  me: string;
  rolle: Rolle;
  byId: Map<string, Fall>;
  users: Map<string, User>;
  userName: (id: string | null | undefined) => string;
  reload: () => Promise<void>;
  /** Führt eine Änderung aus; liefert der Server einen Fall zurück, wird er sofort übernommen */
  run: <T>(fn: () => Promise<T>, okMsg?: string) => Promise<T | undefined>;
  toast: (msg: string, err?: boolean, action?: ToastAction) => void;
  offline: boolean;
  savedAt: string | null;
}

const Ctx = createContext<Store | null>(null);

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error("Store fehlt");
  return s;
}

/** Live-Abgleich: alle 5 Sekunden nachsehen, ob jemand etwas geändert hat */
const POLL_MS = 5000;

const istFall = (x: unknown): x is Fall => !!x && typeof x === "object" && "schritte" in x && "verlauf" in x && "id" in x;

export function StoreProvider({ initial, initialOffline = false, savedAt = null, children }: { initial: Daten; initialOffline?: boolean; savedAt?: string | null; children: ReactNode }) {
  const [data, setData] = useState(initial);
  const [toastMsg, setToastMsg] = useState<{ msg: string; err: boolean; action?: ToastAction } | null>(null);
  const [offline, setOffline] = useState(initialOffline);
  const revRef = useRef(initialOffline ? -1 : initial.rev);
  const toastTimer = useRef<number>(undefined);

  const toast = useCallback((msg: string, err = false, action?: ToastAction) => {
    setToastMsg({ msg, err, action });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastMsg(null), err || action ? 6000 : 2200);
  }, []);

  const reload = useCallback(async () => {
    try {
      const res = await api<Daten | { unchanged: true; rev: number }>(`/daten?rev=${revRef.current}`);
      // Eine ältere, später eingetroffene Antwort darf neuere Daten nicht überschreiben
      if (!("unchanged" in res) && res.rev >= revRef.current) {
        revRef.current = res.rev;
        setData(res);
        saveDaten(res);
      }
      setOffline(false);
    } catch (e) {
      if (isNetworkError(e)) setOffline(true);
    }
  }, []);

  useEffect(() => {
    const t = window.setInterval(() => document.visibilityState === "visible" && reload(), POLL_MS);
    const onVis = () => document.visibilityState === "visible" && reload();
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("online", onVis);
    if (initialOffline) reload();
    return () => {
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("online", onVis);
    };
  }, [reload, initialOffline]);

  const run = useCallback(
    async <T,>(fn: () => Promise<T>, okMsg?: string) => {
      try {
        const r = await fn();
        if (istFall(r)) setData((d) => ({ ...d, faelle: d.faelle.map((f) => (f.id === r.id ? r : f)).concat(d.faelle.some((f) => f.id === r.id) ? [] : [r]) }));
        if (okMsg) toast(okMsg);
        reload();
        return r;
      } catch (e) {
        if (isNetworkError(e)) setOffline(true);
        toast(isNetworkError(e) ? "Keine Verbindung – Änderungen gehen erst wieder mit Netz" : (e as Error).message || "Fehler", true);
        reload();
        return undefined;
      }
    },
    [reload, toast],
  );

  const value = useMemo<Store>(() => {
    const users = new Map(data.users.map((u) => [u.id, u]));
    return {
      data,
      me: data.me,
      rolle: data.rolle,
      byId: new Map(data.faelle.map((f) => [f.id, f])),
      users,
      userName: (id) => (id ? (users.get(id)?.name ?? id) : "Import"),
      reload,
      run,
      toast,
      offline,
      savedAt: offline ? (savedAt ?? loadSavedDaten()?.savedAt ?? null) : null,
    };
  }, [data, reload, run, toast, offline, savedAt]);

  return (
    <Ctx.Provider value={value}>
      {children}
      {toastMsg && (
        <div className={"toast" + (toastMsg.err ? " err" : "")} role="status">
          {toastMsg.msg}
          {toastMsg.action && (
            <button
              className="btn small"
              onClick={() => {
                toastMsg.action!.run();
                setToastMsg(null);
              }}
            >
              {toastMsg.action.label}
            </button>
          )}
        </div>
      )}
    </Ctx.Provider>
  );
}
