import { useEffect, useState } from "react";
import { darf, rolleName } from "../shared/types";
import type { Daten, Kennzahl } from "../shared/types";
import { api, onUnauthorized } from "./api";
import type { ApiError } from "./api";
import { StoreProvider, clearSaved, isNetworkError, loadSavedDaten, saveDaten, useStore } from "./store";
import { Uebersicht } from "./components/Uebersicht";
import { Akte } from "./components/Akte";
import { FallForm } from "./components/FallForm";
import { Einstellungen } from "./components/Einstellungen";
import { fmtDateTime } from "./util";

/** Adresse: #/ (Übersicht, optional ?k=kritisch), #/fall/<id>, #/neu, #/einstellungen */
function useRoute(): { parts: string[]; query: URLSearchParams } {
  const read = () => {
    const h = window.location.hash.replace(/^#\/?/, "");
    const [path, q] = h.split("?");
    return { parts: path.split("/").filter(Boolean).map(decodeURIComponent), query: new URLSearchParams(q ?? "") };
  };
  const [r, setR] = useState(read);
  useEffect(() => {
    const on = () => setR(read());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return r;
}

export const go = (h: string) => {
  window.location.hash = h;
};

export default function App() {
  const [data, setData] = useState<Daten | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needLogin, setNeedLogin] = useState(false);
  const [startOffline, setStartOffline] = useState(false);

  async function load() {
    try {
      setError(null);
      const d = await api<Daten>("/daten");
      saveDaten(d);
      setStartOffline(false);
      setData(d);
      setNeedLogin(false);
    } catch (e) {
      if ((e as ApiError).status === 401) setNeedLogin(true);
      else if (isNetworkError(e) && loadSavedDaten()) {
        setStartOffline(true);
        setData(loadSavedDaten()!.daten);
      } else setError((e as Error).message);
    }
  }

  useEffect(() => {
    onUnauthorized(() => {
      clearSaved();
      setData(null);
      setNeedLogin(true);
    });
    load();
  }, []);

  if (needLogin) return <Login onDone={load} />;
  if (error)
    return (
      <div className="login">
        <div className="login-box">
          <p>Verbindung fehlgeschlagen: {error}</p>
          <button className="btn primary" onClick={load}>
            Erneut versuchen
          </button>
        </div>
      </div>
    );
  if (!data) return <div className="login muted">Lade…</div>;
  return (
    <StoreProvider key={data.me} initial={data} initialOffline={startOffline}>
      <Shell />
    </StoreProvider>
  );
}

function Logo() {
  return (
    <svg className="logo" viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="14" fill="#0a0a0a" />
      <path d="M10 26 L54 16 L54 22 L10 32 Z" fill="#22c55e" />
      <rect x="14" y="31" width="4" height="22" rx="1" fill="#22c55e" />
      <rect x="47" y="22" width="4" height="31" rx="1" fill="#22c55e" />
      <path d="M32 33 v10 M32 47.5 v.5" stroke="#fff" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

function Brand() {
  return (
    <div className="brand">
      <Logo />
      <div>
        <div className="name">
          FT <span>Reklamationen</span>
        </div>
        <div className="claim">Experten für Terrassenüberdachungen</div>
      </div>
    </div>
  );
}

function Shell() {
  const { rolle, offline, savedAt, byId, me, userName } = useStore();
  const { parts, query } = useRoute();
  const view = parts[0] ?? "";
  const fallId = view === "fall" ? parts[1] : null;
  const editId = view === "bearbeiten" ? parts[1] : null;

  // Startfilter aus der Adresse (Links aus Erinnerungen, z. B. #/?k=ueberfaellig)
  const k = query.get("k") as Kennzahl | null;

  return (
    <>
      {offline && (
        <div className="offline-bar">
          Keine Verbindung – du siehst den Stand {savedAt ? `vom ${fmtDateTime(savedAt)}` : "von vorhin"}. Änderungen gehen erst wieder mit Netz.
        </div>
      )}
      <header className="topbar">
        <a href="#/" className="brand-link" aria-label="Zur Übersicht">
          <Brand />
        </a>
        <div className="spacer" />
        {darf.bearbeiten(rolle) && (
          <button className="btn primary" onClick={() => go("#/neu")}>
            + Fall
          </button>
        )}
        <button className={"btn icon" + (view === "einstellungen" ? " active" : "")} onClick={() => go(view === "einstellungen" ? "#/" : "#/einstellungen")} title="Einstellungen" aria-label="Einstellungen">
          ⚙
        </button>
        <div className="usermenu" title={`${userName(me)} · ${rolleName(rolle)}`}>
          <span className="avatar">{userName(me).slice(0, 1).toUpperCase()}</span>
          <span className="uname">
            {userName(me)}
            <small>{rolleName(rolle)}</small>
          </span>
        </div>
      </header>

      {view === "einstellungen" ? <Einstellungen /> : <Uebersicht startKennzahl={k} />}

      {fallId && (byId.get(fallId) ? <Akte key={fallId} fall={byId.get(fallId)!} /> : <NichtGefunden />)}
      {view === "neu" && darf.bearbeiten(rolle) && <FallForm onClose={() => go("#/")} />}
      {editId && byId.get(editId) && darf.bearbeiten(rolle) && <FallForm key={editId} fall={byId.get(editId)!} onClose={() => go(`#/fall/${encodeURIComponent(editId)}`)} />}
    </>
  );
}

function NichtGefunden() {
  return (
    <div className="drawer-back" onClick={() => go("#/")}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <b>Fall nicht gefunden</b>
          <div className="spacer" />
          <button className="btn icon" onClick={() => go("#/")} aria-label="Schließen">
            ✕
          </button>
        </div>
        <div className="drawer-body muted">Der Fall wurde gelöscht oder die Adresse ist falsch.</div>
      </aside>
    </div>
  );
}

function Login({ onDone }: { onDone: () => void }) {
  const [user, setUser] = useState(() => {
    try {
      return localStorage.getItem("rk_user") ?? "";
    } catch {
      return "";
    }
  });
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="login">
      <form
        className="login-box"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setErr(null);
          try {
            await api("/login", { body: { user, password } });
            try {
              localStorage.setItem("rk_user", user.trim());
            } catch {
              /* egal */
            }
            onDone();
          } catch (e) {
            setErr((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Brand />
        <p className="muted small" style={{ margin: 0 }}>
          Reklamationen, Fristen und Streitfälle – nur für angemeldete Mitarbeiter.
        </p>
        <label className="field" htmlFor="login-name">
          Name
        </label>
        <input id="login-name" type="text" autoComplete="username" autoCapitalize="none" value={user} onChange={(e) => setUser(e.target.value)} placeholder="z. B. Felix" autoFocus={!user} />
        <label className="field" htmlFor="login-pw">
          Passwort
        </label>
        <input id="login-pw" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus={!!user} />
        {err && <div className="error">{err}</div>}
        <button className="btn primary" type="submit" disabled={busy || !password || !user.trim()}>
          {busy ? "Prüfe…" : "Anmelden"}
        </button>
      </form>
    </div>
  );
}
