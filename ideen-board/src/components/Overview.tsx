import { useEffect, useState } from "react";
import { userName } from "../../shared/types";
import type { Review, Stats } from "../../shared/types";
import { api } from "../api";
import { useStore } from "../store";
import { fmtDateTime } from "../util";
import { Avatar } from "./Avatar";

// Reihenfolge und Farben der Monatsreihen (dunkler Hintergrund, mit validate_palette geprüft)
const SERIES = [
  { key: "created", label: "Neu erfasst", color: "#1798ad" },
  { key: "decided", label: "Beschlossen", color: "#8a6ae6" },
  { key: "done", label: "Erledigt", color: "#14a35a" },
] as const;

const MONTHS = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];

export function Overview() {
  const [tab, setTab] = useState<"rueckblick" | "zahlen">(() => (location.hash.includes("zahlen") ? "zahlen" : "rueckblick"));
  return (
    <div className="page">
      <div className="page-inner">
        <h1>Überblick</h1>
        <div className="row" style={{ margin: "10px 0 18px" }}>
          <button className={"btn" + (tab === "rueckblick" ? " active" : "")} onClick={() => setTab("rueckblick")}>
            ✦ KI-Wochenrückblick
          </button>
          <button className={"btn" + (tab === "zahlen" ? " active" : "")} onClick={() => setTab("zahlen")}>
            📊 Zahlen
          </button>
        </div>
        {tab === "rueckblick" ? <ReviewView /> : <Dashboard />}
      </div>
    </div>
  );
}

function ReviewView() {
  const { data, cardsById, openCard, run, toast } = useStore();
  const [review, setReview] = useState<Review | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Review | null>("/reviews/latest").then(setReview).catch(() => setReview(null));
  }, [data.rev]);

  async function create() {
    setBusy(true);
    const r = await run(() => api<Review>("/reviews", { method: "POST" }), "Rückblick erstellt");
    if (r) setReview(r);
    setBusy(false);
  }

  async function merge(ids: number[]) {
    const [target, ...rest] = ids;
    if (!confirm(`${ids.map((i) => `„${cardsById.get(i)?.title ?? i}“`).join(" + ")} zusammenführen? Die erste Karte bleibt erhalten.`)) return;
    await run(() => api(`/cards/${target}/merge`, { body: { source_ids: rest } }), "Zusammengeführt");
  }

  const CardLink = ({ id }: { id: number }) => {
    const c = cardsById.get(id);
    return c ? (
      <a href="#" onClick={(e) => (e.preventDefault(), openCard(id))}>
        {c.title}
      </a>
    ) : (
      <span className="muted">#{id} (nicht mehr auf dem Board)</span>
    );
  };

  if (review === undefined) return <div className="muted">Lade…</div>;
  const r = review?.data;
  return (
    <div className="ai-panel">
      <div className="ai-head">
        <span className="title">✦ KI-Wochenrückblick</span>
        <span className="chip">Vorschlag</span>
        <span className="spacer" />
        {data.settings.ai_enabled && (
          <button className="btn ai small" disabled={busy} onClick={() => create().catch(() => toast("Fehler", true))}>
            {busy ? (
              <>
                <span className="spin">✦</span> erstellt…
              </>
            ) : (
              "↻ Jetzt neu erstellen"
            )}
          </button>
        )}
      </div>
      <div className="ai-note">
        Wird jeden Montagmorgen automatisch erstellt und per Mail/Push verschickt.
        {review && ` Stand: ${fmtDateTime(review.created_at)}${review.requested_by ? ` (von ${userName(review.requested_by)})` : ""}.`}
      </div>
      {!r && <div className="empty">Noch kein Rückblick vorhanden.</div>}
      {r && (
        <>
          <div className="ai-block">
            <h4>Lage</h4>
            <div>{r.zusammenfassung}</div>
          </div>
          <div className="ai-block">
            <h4>Fokus der Woche</h4>
            <div className="ai-item uebernommen" style={{ opacity: 1 }}>
              <div className="txt">🎯 {r.fokus}</div>
            </div>
          </div>
          {r.quick_wins.length > 0 && (
            <div className="ai-block">
              <h4>⚡ Quick Wins, die liegen bleiben</h4>
              {r.quick_wins.map((q) => (
                <div key={q.karte_id} className="ai-item">
                  <div className="txt">
                    <CardLink id={q.karte_id} />
                    <div className="small muted">{q.grund}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {r.haengt_fest.length > 0 && (
            <div className="ai-block">
              <h4>⏳ Hängt fest</h4>
              {r.haengt_fest.map((q) => (
                <div key={q.karte_id} className="ai-item">
                  <div className="txt">
                    <CardLink id={q.karte_id} />
                    <div className="small muted">{q.grund}</div>
                    <div className="small">→ {q.vorschlag}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {r.doppelungen.length > 0 && (
            <div className="ai-block">
              <h4>⇄ Doppelungen</h4>
              {r.doppelungen.map((d, i) => (
                <div key={i} className="ai-item">
                  <div className="txt">
                    {d.karten_ids.map((id, j) => (
                      <span key={id}>
                        {j > 0 && " + "}
                        <CardLink id={id} />
                      </span>
                    ))}
                    <div className="small muted">{d.grund}</div>
                  </div>
                  {d.karten_ids.every((id) => cardsById.has(id)) && (
                    <div className="ai-actions">
                      <button className="btn small primary" onClick={() => merge(d.karten_ids)}>
                        Zusammenführen
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          {r.kombinationen.length > 0 && (
            <div className="ai-block">
              <h4>🧩 Zusammen stärker</h4>
              {r.kombinationen.map((k, i) => (
                <div key={i} className="ai-item">
                  <div className="txt">
                    {k.karten_ids.map((id, j) => (
                      <span key={id}>
                        {j > 0 && " + "}
                        <CardLink id={id} />
                      </span>
                    ))}
                    <div className="small">{k.idee}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Dashboard() {
  const { data } = useStore();
  const [s, setS] = useState<Stats | null>(null);
  const [table, setTable] = useState(false);
  useEffect(() => {
    api<Stats>("/stats").then(setS).catch(() => setS(null));
  }, [data.rev]);
  if (!s) return <div className="muted">Lade…</div>;
  const max = Math.max(1, ...s.months.flatMap((m) => [m.created, m.decided, m.done]));
  const colMax = Math.max(1, ...s.columns.map((c) => c.count));
  const monthLabel = (m: string) => MONTHS[Number(m.slice(5, 7)) - 1] + " " + m.slice(2, 4);
  return (
    <>
      <div className="tiles">
        <div className="tile">
          <div className="tile-num">{s.total}</div>
          <div className="tile-label">Ideen auf dem Board</div>
        </div>
        <div className="tile">
          <div className="tile-num">{s.quick_wins_open}</div>
          <div className="tile-label">⚡ offene Quick Wins</div>
        </div>
        <div className="tile">
          <div className="tile-num" style={{ color: s.stuck ? "var(--amber)" : undefined }}>{s.stuck}</div>
          <div className="tile-label">⏳ hängen in „Entscheiden“ (≥ 7 Tage)</div>
        </div>
        <div className="tile">
          <div className="tile-num">{s.avg_days_to_decision ?? "–"}</div>
          <div className="tile-label">Ø Tage bis zum Beschluss</div>
        </div>
      </div>

      <div className="panel">
        <div className="row">
          <h3 className="grow" style={{ margin: 0 }}>
            Entwicklung der letzten 6 Monate
          </h3>
          <button className="btn small" onClick={() => setTable(!table)}>
            {table ? "Diagramm" : "Tabelle"}
          </button>
        </div>
        <div className="legend">
          {SERIES.map((se) => (
            <span key={se.key}>
              <i style={{ background: se.color }} />
              {se.label}
            </span>
          ))}
        </div>
        {table ? (
          <table className="data">
            <thead>
              <tr>
                <th>Monat</th>
                {SERIES.map((se) => (
                  <th key={se.key}>{se.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {s.months.map((m) => (
                <tr key={m.month}>
                  <td>{monthLabel(m.month)}</td>
                  {SERIES.map((se) => (
                    <td key={se.key}>{m[se.key]}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="chart">
            {s.months.map((m) => (
              <div key={m.month} className="chart-group">
                <div className="chart-bars">
                  {SERIES.map((se) => (
                    <div key={se.key} className="chart-bar" title={`${monthLabel(m.month)} · ${se.label}: ${m[se.key]}`}>
                      {m[se.key] > 0 && <span className="chart-val">{m[se.key]}</span>}
                      <i style={{ height: `${(m[se.key] / max) * 100}%`, background: se.color }} />
                    </div>
                  ))}
                </div>
                <div className="chart-x">{monthLabel(m.month)}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="two-col">
        <div className="panel">
          <h3>Karten je Spalte</h3>
          {s.columns.map((c) => (
            <div key={c.key} className="hbar" title={`${c.title}: ${c.count}`}>
              <span className="hbar-label">{c.title}</span>
              <span className="hbar-track">
                <i style={{ width: `${(c.count / colMax) * 100}%` }} />
              </span>
              <span className="hbar-val">{c.count}</span>
            </div>
          ))}
        </div>
        <div className="panel">
          <h3>Team</h3>
          <table className="data">
            <thead>
              <tr>
                <th></th>
                <th>Ideen</th>
                <th>offen zuständig</th>
                <th>Kommentare</th>
              </tr>
            </thead>
            <tbody>
              {s.people.map((p) => (
                <tr key={p.id}>
                  <td>
                    <span className="row">
                      <Avatar id={p.id} size="sm" /> {userName(p.id)}
                    </span>
                  </td>
                  <td>{p.created}</td>
                  <td>{p.assigned_open}</td>
                  <td>{p.comments}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
