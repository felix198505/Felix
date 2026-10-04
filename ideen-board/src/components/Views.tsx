import { useState } from "react";
import { columnTitle, USERS, userName } from "../../shared/types";
import type { Card } from "../../shared/types";
import { api } from "../api";
import { useStore } from "../store";
import { fmtDate, isDue, todayStr } from "../util";
import { AiFlag, CardTile, PrioBadge, StarButton } from "./CardTile";

// ---------- Heute fällig ----------

export function TodayView() {
  const { data } = useStore();
  const due = data.cards.filter(isDue).sort((a, b) => (a.follow_up ?? "").localeCompare(b.follow_up ?? ""));
  const today = todayStr();
  return (
    <div className="page">
      <div className="page-inner">
        <h1>Heute fällig</h1>
        <p className="muted">Alle Karten, deren Wiedervorlage heute oder früher ist.</p>
        {due.length === 0 && <div className="empty">Nichts fällig. 🎉</div>}
        {due.map((c) => (
          <div key={c.id} style={{ marginBottom: 8 }}>
            <div className="small" style={{ color: c.follow_up! < today ? "var(--red)" : "var(--amber)", marginBottom: 2 }}>
              {c.follow_up! < today ? `Überfällig seit ${fmtDate(c.follow_up)}` : "Heute"} · {columnTitle(c.column_key)}
            </div>
            <CardTile card={c} />
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- Besprechung ----------

export function MeetingView() {
  const { data, me, catsById, openCard, run, askText, toast } = useStore();
  const list = data.cards.filter((c) => c.column_key === "entscheiden").sort((a, b) => a.position - b.position);

  async function vote(c: Card, v: "ja" | "nein" | "parken") {
    let reject_reason: string | undefined;
    if (v === "nein") {
      const r = await askText("Kurzer Grund für Nein?", { placeholder: "z. B. zu teuer, passt nicht", okLabel: "Nein" });
      if (r === null) return;
      reject_reason = r;
    }
    const res = await run(() => api<{ result: string }>(`/cards/${c.id}/vote`, { body: { vote: v, reject_reason } }));
    if (!res) return;
    const msg: Record<string, string> = {
      offen: "Stimme gespeichert – wartet auf die zweite Stimme",
      uneinig: "Ihr seid uneinig – bitte besprechen",
      umsetzen: "Beide Ja → „Umsetzen“",
      verworfen: "Beide Nein → „Verworfen“",
      parkplatz: "Beide Parken → „Parkplatz“",
    };
    toast(msg[res.result] ?? "Gespeichert");
  }

  return (
    <div className="page">
      <div className="page-inner">
        <h1>Besprechung</h1>
        <p className="muted">
          Alle Karten aus „Entscheiden“. Jeder stimmt für sich ab. Bei gleicher Stimme beider wandert die Karte automatisch weiter.
        </p>
        {list.length === 0 && <div className="empty">Keine Karten zur Entscheidung.</div>}
        {list.map((c, i) => {
          const cat = c.category_id ? catsById.get(c.category_id) : undefined;
          const mine = c.votes.find((v) => v.user_id === me)?.vote;
          return (
            <div key={c.id} className="list-card" style={{ borderLeftColor: cat?.color }}>
              <div className="row">
                <span className="muted">{i + 1}.</span>
                <b className="grow" style={{ cursor: "pointer" }} onClick={() => openCard(c.id)}>
                  {c.title}
                </b>
                <StarButton card={c} />
              </div>
              {c.description && <div style={{ whiteSpace: "pre-wrap", marginTop: 6 }}>{c.description}</div>}
              {c.ai_summary && (
                <div className="small" style={{ marginTop: 6, color: "var(--ai)" }}>
                  ✦ KI-Kurzfassung (Vorschlag): {c.ai_summary}
                </div>
              )}
              <div className="card-meta">
                {cat && <span className="chip">{cat.name}</span>}
                <PrioBadge card={c} />
                <span>
                  Nutzen {c.benefit ?? "–"} · Aufwand {c.effort ?? "–"}
                </span>
                {c.next_step && <span>Nächster Schritt: {c.next_step}</span>}
                <AiFlag card={c} />
              </div>
              <div className="vote-row">
                {(["ja", "nein", "parken"] as const).map((v) => (
                  <button key={v} className={"btn" + (mine === v ? " active" : "") + (v === "ja" ? " " : "")} onClick={() => vote(c, v)}>
                    {v === "ja" ? "👍 Ja" : v === "nein" ? "👎 Nein" : "🅿 Parken"}
                  </button>
                ))}
                <span className="spacer" />
                {USERS.map((u) => {
                  const v = c.votes.find((x) => x.user_id === u.id)?.vote;
                  return (
                    <span key={u.id} className="chip">
                      {u.name}: {v ? { ja: "Ja", nein: "Nein", parken: "Parken" }[v] : "…"}
                    </span>
                  );
                })}
                <button className="btn small" onClick={() => openCard(c.id)}>
                  Details
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------- Einstellungen ----------

export function SettingsView() {
  const { data, run, reload } = useStore();
  const [ctx, setCtx] = useState(data.settings.company_context);
  const [limit, setLimit] = useState(data.settings.ai_monthly_limit_eur);
  const [newCat, setNewCat] = useState({ name: "", color: "#22c55e" });

  return (
    <div className="page">
      <div className="page-inner">
        <h1>Einstellungen</h1>

        <div className="section" style={{ marginTop: 16 }}>
          <h3>Firmenkontext (wird bei jeder KI-Analyse mitgegeben)</h3>
          <textarea value={ctx} onChange={(e) => setCtx(e.target.value)} rows={5} />
          <div className="row" style={{ justifyContent: "flex-end", marginTop: 6 }}>
            <button className="btn primary" disabled={ctx === data.settings.company_context} onClick={() => run(() => api("/settings", { method: "PUT", body: { company_context: ctx } }), "Gespeichert")}>
              Speichern
            </button>
          </div>
        </div>

        <div className="section">
          <h3>KI</h3>
          <div className="small muted" style={{ marginBottom: 8 }}>
            Status: {data.settings.ai_enabled ? `aktiv (Modell ${data.settings.ai_model})` : "kein API-Schlüssel hinterlegt – Analysen werden gesammelt und später nachgeholt"}
          </div>
          <label className="field">Monatsgrenze für KI-Kosten (€)</label>
          <div className="row">
            <input type="number" min={0} step={1} value={limit} onChange={(e) => setLimit(e.target.value)} style={{ maxWidth: 140 }} />
            <button className="btn" disabled={limit === data.settings.ai_monthly_limit_eur} onClick={() => run(() => api("/settings", { method: "PUT", body: { ai_monthly_limit_eur: limit } }), "Gespeichert")}>
              Speichern
            </button>
          </div>
        </div>

        <div className="section">
          <h3>Kategorien</h3>
          {data.categories.map((c) => (
            <div key={c.id} className="row" style={{ marginBottom: 6 }}>
              <input type="color" value={c.color} onChange={(e) => run(() => api(`/categories/${c.id}`, { method: "PATCH", body: { color: e.target.value } }))} style={{ width: 40, height: 34, padding: 0, border: "none", background: "none" }} />
              <input type="text" defaultValue={c.name} onBlur={(e) => e.target.value.trim() && e.target.value !== c.name && run(() => api(`/categories/${c.id}`, { method: "PATCH", body: { name: e.target.value } }))} />
              <button
                className="btn danger small"
                onClick={() => confirm(`Kategorie „${c.name}“ löschen? Karten behalten ihren Inhalt, nur die Kategorie wird entfernt.`) && run(() => api(`/categories/${c.id}`, { method: "DELETE" }))}
              >
                Löschen
              </button>
            </div>
          ))}
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              if (!newCat.name.trim()) return;
              run(() => api("/categories", { body: newCat }), "Kategorie angelegt").then(reload);
              setNewCat({ name: "", color: "#22c55e" });
            }}
          >
            <input type="color" value={newCat.color} onChange={(e) => setNewCat({ ...newCat, color: e.target.value })} style={{ width: 40, height: 34, padding: 0, border: "none", background: "none" }} />
            <input type="text" placeholder="Neue Kategorie" value={newCat.name} onChange={(e) => setNewCat({ ...newCat, name: e.target.value })} />
            <button className="btn" type="submit">
              Hinzufügen
            </button>
          </form>
        </div>

        <div className="section">
          <h3>Export & Datensicherung</h3>
          <div className="row wrap">
            <a className="btn" href="/api/export.csv">
              CSV (Excel)
            </a>
            <a className="btn" href="#/druck">
              PDF / Drucken
            </a>
            <a className="btn" href="/api/export.json">
              Alles exportieren (JSON-Backup)
            </a>
          </div>
          <p className="small muted">Zusätzlich wird nach der Veröffentlichung jede Nacht automatisch eine Sicherung bei Cloudflare abgelegt (30 Tage).</p>
        </div>
      </div>
    </div>
  );
}

// ---------- Druck / PDF ----------

export function PrintView() {
  const { data, catsById } = useStore();
  const [cols, setCols] = useState<Set<string>>(new Set(["eingang", "ausarbeiten", "entscheiden", "umsetzen", "parkplatz"]));
  const all = ["eingang", "ausarbeiten", "entscheiden", "umsetzen", "erledigt", "parkplatz", "verworfen"];
  return (
    <div className="page">
      <div className="page-inner">
        <div className="no-print" style={{ marginBottom: 16 }}>
          <h1>PDF / Drucken</h1>
          <p className="muted small">Spalten wählen, dann „Drucken“ und als Ziel „Als PDF speichern“ wählen.</p>
          <div className="row wrap" style={{ marginBottom: 10 }}>
            {all.map((k) => (
              <button
                key={k}
                className={"btn small" + (cols.has(k) ? " active" : "")}
                onClick={() => {
                  const n = new Set(cols);
                  if (n.has(k)) n.delete(k);
                  else n.add(k);
                  setCols(n);
                }}
              >
                {columnTitle(k)}
              </button>
            ))}
          </div>
          <button className="btn primary" onClick={() => window.print()}>
            Drucken / PDF speichern
          </button>
        </div>
        <h1>Ideen-Board · Stand {fmtDate(new Date().toISOString())}</h1>
        {all
          .filter((k) => cols.has(k))
          .map((k) => {
            const list = data.cards.filter((c) => c.column_key === k).sort((a, b) => a.position - b.position);
            if (!list.length) return null;
            return (
              <div key={k} className="print-col" style={{ marginTop: 16 }}>
                <h2 style={{ fontSize: 16 }}>
                  {columnTitle(k)} ({list.length})
                </h2>
                {list.map((c) => (
                  <div key={c.id} className="print-card list-card" style={{ borderLeftColor: c.category_id ? catsById.get(c.category_id)?.color : undefined }}>
                    <b>{c.title}</b>{" "}
                    <span className="muted small">
                      · {c.category_id ? catsById.get(c.category_id)?.name : "ohne Kategorie"} · Nutzen {c.benefit ?? "–"} / Aufwand {c.effort ?? "–"} · <PrioBadge card={c} /> · von {userName(c.created_by)}, {fmtDate(c.created_at)}
                    </span>
                    {c.description && <div style={{ whiteSpace: "pre-wrap", marginTop: 4 }}>{c.description}</div>}
                    {c.ai_summary && <div className="small" style={{ marginTop: 4 }}>KI-Kurzfassung (Vorschlag): {c.ai_summary}</div>}
                    {(c.next_step || c.assignee || c.follow_up) && (
                      <div className="small" style={{ marginTop: 4 }}>
                        {c.next_step && <>Nächster Schritt: {c.next_step} · </>}
                        {c.assignee && <>Zuständig: {c.assignee === "beide" ? "Beide" : userName(c.assignee)} · </>}
                        {c.follow_up && <>Wiedervorlage: {fmtDate(c.follow_up)}</>}
                      </div>
                    )}
                    {c.checklist.length > 0 && (
                      <ul className="small" style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                        {c.checklist.map((i) => (
                          <li key={i.id}>
                            {i.done ? "☑" : "☐"} {i.text}
                          </li>
                        ))}
                      </ul>
                    )}
                    {c.reject_reason && <div className="small">Grund: {c.reject_reason}</div>}
                  </div>
                ))}
              </div>
            );
          })}
      </div>
    </div>
  );
}
