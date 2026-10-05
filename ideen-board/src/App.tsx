import { useEffect, useState } from "react";
import { PRIORITY_LABEL, PRIORITY_ORDER, USERS, userName } from "../shared/types";
import type { BoardData } from "../shared/types";
import { api, onUnauthorized } from "./api";
import type { ApiError } from "./api";
import { StoreProvider, useStore } from "./store";
import { clearSaved, isNetworkError, loadSavedBoard, saveBoard, sendOrQueue } from "./offline";
import { OfflineBar } from "./components/OfflineBar";
import { Avatar } from "./components/Avatar";
import { EMPTY_FILTERS, filtersActive, isDue } from "./util";
import type { Filters } from "./util";
import { Board } from "./components/Board";
import { CardModal } from "./components/CardModal";
import { MeetingView, PrintView, SettingsView, TodayView } from "./components/Views";
import { BrainstormList, BrainstormSession } from "./components/Brainstorm";
import { ImportView } from "./components/Import";
import { MicButton } from "./components/Mic";
import { Overview } from "./components/Overview";

function useHash(): [string, (h: string) => void] {
  const [hash, setHash] = useState(window.location.hash || "#/board");
  useEffect(() => {
    const on = () => setHash(window.location.hash || "#/board");
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return [hash, (h) => (window.location.hash = h)];
}

export default function App() {
  const [data, setData] = useState<BoardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needLogin, setNeedLogin] = useState(false);

  const [startOffline, setStartOffline] = useState(false);

  async function load() {
    try {
      setError(null);
      const b = await api<BoardData>("/board");
      saveBoard(b);
      setStartOffline(false);
      setData(b);
      setNeedLogin(false);
    } catch (e) {
      if ((e as ApiError).status === 401) setNeedLogin(true);
      else if (isNetworkError(e) && loadSavedBoard()) {
        // Ohne Netz: letzten bekannten Stand anzeigen
        setStartOffline(true);
        setData(loadSavedBoard()!.board);
      } else setError((e as Error).message);
    }
  }
  useEffect(() => {
    onUnauthorized(() => {
      setData(null);
      setNeedLogin(true);
    });
    load();
  }, []);

  if (needLogin) return <Login onDone={load} />;

  if (error) {
    return (
      <div className="login">
        <div>
          <p>Verbindung fehlgeschlagen: {error}</p>
          <button className="btn primary" onClick={load}>
            Erneut versuchen
          </button>
        </div>
      </div>
    );
  }
  if (!data) return <div className="login muted">Lade…</div>;
  return (
    <StoreProvider key={data.me} initial={data} initialOffline={startOffline}>
      <Shell />
    </StoreProvider>
  );
}

function Shell() {
  const { data, me, openCardId, openCard, run, toast } = useStore();
  const [hash, go] = useHash();
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [quick, setQuick] = useState("");
  const dueCount = data.cards.filter(isDue).length;
  const decideCount = data.cards.filter((c) => c.column_key === "entscheiden").length;

  const route = hash.replace(/^#\/?/, "").split("/");
  const view = route[0] === "karte" ? "board" : route[0] || "board";

  // Direktlink #/karte/12 (aus Mail oder Push) öffnet die Karte auf dem Board
  useEffect(() => {
    if (route[0] === "karte" && route[1]) {
      openCard(Number(route[1]));
      history.replaceState(null, "", "#/board");
    }
  }, [hash]); // eslint-disable-line react-hooks/exhaustive-deps

  async function addQuick(e: React.FormEvent) {
    e.preventDefault();
    const title = quick.trim();
    if (!title) return;
    setQuick("");
    const r = await sendOrQueue("/cards", { title }, title).catch((e) => {
      toast((e as Error).message, true);
      return null;
    });
    if (r === "queued") toast("Offline gespeichert – wird hochgeladen, sobald wieder Netz da ist");
    else if (r === "sent") {
      await run(async () => undefined);
      toast("Im Eingang gespeichert ✓");
    }
  }

  const navBtn = (key: string, label: string, badge?: number, red?: boolean) => (
    <button className={"btn" + (view === key ? " active" : "")} onClick={() => go("#/" + key)}>
      {label}
      {badge ? <span className={"badge" + (red ? " red" : "")}>{badge}</span> : null}
    </button>
  );

  return (
    <>
      <OfflineBar />
      <header className="topbar no-print">
        <div className="brand">
          <div className="logo">✦</div>
          <span className="name">
            Ideen<span>Board</span>
          </span>
        </div>
        <form className="quick" onSubmit={addQuick}>
          <input type="text" value={quick} onChange={(e) => setQuick(e.target.value)} placeholder="Neue Idee… (Enter)" enterKeyHint="done" />
          <MicButton value={quick} onChange={setQuick} title="Idee einsprechen" />
          <button className="btn primary" type="submit" disabled={!quick.trim()}>
            +
          </button>
        </form>
        <nav className="nav">
          {navBtn("board", "Board")}
          {navBtn("heute", "Heute fällig", dueCount, true)}
          {navBtn("besprechung", "Besprechung", decideCount)}
          {navBtn("brainstorming", "Brainstorming")}
          {navBtn("ueberblick", "Überblick")}
          {navBtn("einstellungen", "⚙")}
        </nav>
        <UserMenu me={me} />
      </header>

      {view === "board" && (
        <>
          <FilterBar filters={filters} setFilters={setFilters} />
          <Board filters={filters} />
        </>
      )}
      {view === "heute" && <TodayView />}
      {view === "besprechung" && <MeetingView />}
      {view === "brainstorming" && (route[1] ? <BrainstormSession id={Number(route[1])} go={go} /> : <BrainstormList go={go} />)}
      {view === "einstellungen" && <SettingsView />}
      {(view === "ueberblick" || view === "rueckblick") && <Overview />}
      {view === "import" && <ImportView />}
      {view === "druck" && <PrintView />}

      {openCardId !== null && <CardModal key={openCardId} id={openCardId} />}
    </>
  );
}

function UserMenu({ me }: { me: string }) {
  return (
    <div className="usermenu small">
      <Avatar id={me} />
      <span className="uname">{userName(me)}</span>
      <button
        className="btn small"
        onClick={async () => {
          if (!confirm("Abmelden?")) return;
          await api("/logout", { method: "POST" });
          clearSaved();
          location.reload();
        }}
      >
        Abmelden
      </button>
    </div>
  );
}

function Login({ onDone }: { onDone: () => void }) {
  const [user, setUser] = useState("felix");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="login">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setErr(null);
          try {
            await api("/login", { body: { user, password } });
            onDone();
          } catch (e) {
            setErr((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="brand">
          <div className="logo">✦</div>
          <span className="name">
            Ideen<span style={{ color: "var(--green)" }}>Board</span>
          </span>
        </div>
        <div className="tagline">Ideen festhalten, gemeinsam ausarbeiten, umsetzen.</div>
        <div className="who">
          {USERS.map((u) => (
            <button type="button" key={u.id} className={"btn" + (user === u.id ? " active" : "")} onClick={() => setUser(u.id)}>
              <Avatar id={u.id} size="lg" />
              {u.name}
            </button>
          ))}
        </div>
        <input type="password" placeholder="Passwort" autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
        {err && <div style={{ color: "var(--red)" }}>{err}</div>}
        <button className="btn primary" type="submit" disabled={busy || !password}>
          {busy ? "Prüfe…" : "Anmelden"}
        </button>
      </form>
    </div>
  );
}

function FilterBar({ filters, setFilters }: { filters: Filters; setFilters: (f: Filters) => void }) {
  const { data } = useStore();
  const set = (p: Partial<Filters>) => setFilters({ ...filters, ...p });
  return (
    <div className="filters no-print">
      <input type="search" placeholder="Suchen…" value={filters.q} onChange={(e) => set({ q: e.target.value })} />
      <select value={filters.category} onChange={(e) => set({ category: e.target.value })}>
        <option value="">Alle Kategorien</option>
        {data.categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
        <option value="none">Ohne Kategorie</option>
      </select>
      <select value={filters.person} onChange={(e) => set({ person: e.target.value })}>
        <option value="">Alle Personen</option>
        {USERS.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name}
          </option>
        ))}
      </select>
      <select value={filters.priority} onChange={(e) => set({ priority: e.target.value as Filters["priority"] })}>
        <option value="">Alle Prioritäten</option>
        {PRIORITY_ORDER.map((p) => (
          <option key={p} value={p}>
            {PRIORITY_LABEL[p]}
          </option>
        ))}
      </select>
      <button className={"btn small" + (filters.favorites ? " active" : "")} onClick={() => set({ favorites: !filters.favorites })}>
        ★ Gemerkt
      </button>
      {filtersActive(filters) && (
        <button className="btn ghost small" onClick={() => setFilters(EMPTY_FILTERS)}>
          Zurücksetzen
        </button>
      )}
    </div>
  );
}
