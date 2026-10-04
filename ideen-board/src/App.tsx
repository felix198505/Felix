import { useEffect, useState } from "react";
import { PRIORITY_LABEL, PRIORITY_ORDER, USERS } from "../shared/types";
import type { BoardData } from "../shared/types";
import { api, onUnauthorized } from "./api";
import { StoreProvider, useStore } from "./store";
import { EMPTY_FILTERS, filtersActive, isDue } from "./util";
import type { Filters } from "./util";
import { Board } from "./components/Board";
import { CardModal } from "./components/CardModal";
import { MeetingView, PrintView, SettingsView, TodayView } from "./components/Views";
import { BrainstormList, BrainstormSession } from "./components/Brainstorm";

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

  async function load() {
    try {
      setError(null);
      setData(await api<BoardData>("/board"));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    onUnauthorized(() => setData(null));
    load();
  }, []);

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
    <StoreProvider key={data.me} initial={data}>
      <Shell />
    </StoreProvider>
  );
}

function Shell() {
  const { data, me, openCardId, run, toast } = useStore();
  const [hash, go] = useHash();
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [quick, setQuick] = useState("");
  const dueCount = data.cards.filter(isDue).length;
  const decideCount = data.cards.filter((c) => c.column_key === "entscheiden").length;

  const route = hash.replace(/^#\/?/, "").split("/");
  const view = route[0] || "board";

  async function addQuick(e: React.FormEvent) {
    e.preventDefault();
    const title = quick.trim();
    if (!title) return;
    setQuick("");
    await run(() => api("/cards", { body: { title } }));
    toast("Im Eingang gespeichert ✓");
  }

  const navBtn = (key: string, label: string, badge?: number, red?: boolean) => (
    <button className={"btn" + (view === key ? " active" : "")} onClick={() => go("#/" + key)}>
      {label}
      {badge ? <span className={"badge" + (red ? " red" : "")}>{badge}</span> : null}
    </button>
  );

  return (
    <>
      <header className="topbar no-print">
        <div className="brand">
          <div className="logo">i</div>
          <span className="name">Ideen-Board</span>
        </div>
        <form className="quick" onSubmit={addQuick}>
          <input type="text" value={quick} onChange={(e) => setQuick(e.target.value)} placeholder="Neue Idee… (Enter)" enterKeyHint="done" />
          <button className="btn primary" type="submit" disabled={!quick.trim()}>
            +
          </button>
        </form>
        <nav className="nav">
          {navBtn("board", "Board")}
          {navBtn("heute", "Heute fällig", dueCount, true)}
          {navBtn("besprechung", "Besprechung", decideCount)}
          {navBtn("brainstorming", "Brainstorming")}
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
      {view === "druck" && <PrintView />}

      {openCardId !== null && <CardModal key={openCardId} id={openCardId} />}
    </>
  );
}

function UserMenu({ me }: { me: string }) {
  // Etappe 1: lokale Nutzerauswahl zum Testen
  return (
    <select
      value={me}
      style={{ width: "auto" }}
      title="Angemeldet als"
      onChange={(e) => {
        localStorage.setItem("devUser", e.target.value);
        location.reload();
      }}
    >
      {USERS.map((u) => (
        <option key={u.id} value={u.id}>
          👤 {u.name}
        </option>
      ))}
    </select>
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
