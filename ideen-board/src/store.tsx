import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { api } from "./api";
import type { BoardData, Card, Category } from "../shared/types";

interface Store {
  data: BoardData;
  me: string;
  cardsById: Map<number, Card>;
  catsById: Map<number, Category>;
  reload: () => Promise<void>;
  /** Führt eine Änderung aus, zeigt Fehler an und lädt das Board neu */
  run: <T>(fn: () => Promise<T>, okMsg?: string) => Promise<T | undefined>;
  toast: (msg: string, err?: boolean, action?: ToastAction) => void;
  openCard: (id: number | null) => void;
  openCardId: number | null;
  askText: (title: string, opts?: AskOpts) => Promise<string | null>;
}

/** optional: leere Eingabe erlaubt */
type AskOpts = { placeholder?: string; initial?: string; okLabel?: string; optional?: boolean };

type ToastAction = { label: string; run: () => void };

const Ctx = createContext<Store | null>(null);

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error("Store fehlt");
  return s;
}

const POLL_MS = 5000;

export function StoreProvider({ initial, children }: { initial: BoardData; children: ReactNode }) {
  const [data, setData] = useState(initial);
  const [toastMsg, setToastMsg] = useState<{ msg: string; err: boolean; action?: ToastAction } | null>(null);
  const [openCardId, setOpenCardId] = useState<number | null>(null);
  const [dialog, setDialog] = useState<null | (AskOpts & { title: string; resolve: (v: string | null) => void })>(null);
  const revRef = useRef(initial.rev);
  const toastTimer = useRef<number>(undefined);

  const toast = useCallback((msg: string, err = false, action?: ToastAction) => {
    setToastMsg({ msg, err, action });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastMsg(null), err || action ? 6000 : 2200);
  }, []);

  const reload = useCallback(async () => {
    try {
      const res = await api<BoardData | { unchanged: true; rev: number }>(`/board?rev=${revRef.current}`);
      if ("unchanged" in res) return;
      // Eine ältere, später eingetroffene Antwort darf neuere Daten nicht überschreiben
      if (res.rev < revRef.current) return;
      revRef.current = res.rev;
      setData(res);
    } catch {
      /* offline – nächster Versuch beim nächsten Intervall */
    }
  }, []);

  // Live-Abgleich: regelmäßig nachsehen, ob der andere etwas geändert hat
  useEffect(() => {
    const t = window.setInterval(() => {
      if (document.visibilityState === "visible") reload();
    }, POLL_MS);
    const onVis = () => document.visibilityState === "visible" && reload();
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("online", onVis);
    return () => {
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("online", onVis);
    };
  }, [reload]);

  const run = useCallback(
    async <T,>(fn: () => Promise<T>, okMsg?: string) => {
      try {
        const r = await fn();
        if (okMsg) toast(okMsg);
        await reload();
        return r;
      } catch (e) {
        toast((e as Error).message || "Fehler", true);
        await reload();
        return undefined;
      }
    },
    [reload, toast],
  );

  const askText = useCallback(
    (title: string, opts: AskOpts = {}) =>
      new Promise<string | null>((resolve) => setDialog({ title, ...opts, resolve })),
    [],
  );

  const value = useMemo<Store>(
    () => ({
      data,
      me: data.me,
      cardsById: new Map(data.cards.map((c) => [c.id, c])),
      catsById: new Map(data.categories.map((c) => [c.id, c])),
      reload,
      run,
      toast,
      openCard: setOpenCardId,
      openCardId,
      askText,
    }),
    [data, reload, run, toast, openCardId, askText],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      {toastMsg && (
        <div className={"toast" + (toastMsg.err ? " err" : "")}>
          {toastMsg.msg}
          {toastMsg.action && (
            <button
              className="btn small toast-action"
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
      {dialog && (
        <TextDialog
          {...dialog}
          onClose={(v) => {
            dialog.resolve(v);
            setDialog(null);
          }}
        />
      )}
    </Ctx.Provider>
  );
}

function TextDialog(props: AskOpts & { title: string; onClose: (v: string | null) => void }) {
  const [v, setV] = useState(props.initial ?? "");
  return (
    <div className="modal-back" style={{ alignItems: "center", zIndex: 80 }} onClick={() => props.onClose(null)}>
      <form
        className="modal narrow"
        style={{ minHeight: 0, borderRadius: 14, border: "1px solid var(--line)", margin: 12 }}
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (v.trim() || props.optional) props.onClose(v.trim());
        }}
      >
        <div className="modal-body">
          <div style={{ fontWeight: 700, marginBottom: 10 }}>{props.title}</div>
          <input type="text" autoFocus value={v} placeholder={props.placeholder} onChange={(e) => setV(e.target.value)} />
          <div className="row" style={{ marginTop: 12, justifyContent: "flex-end" }}>
            <button type="button" className="btn" onClick={() => props.onClose(null)}>
              Abbrechen
            </button>
            <button type="submit" className="btn primary" disabled={!v.trim() && !props.optional}>
              {props.okLabel ?? "OK"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
