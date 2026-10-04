import { useEffect, useState } from "react";
import { assigneeLabel, columnTitle, userName, VOTERS } from "../../shared/types";
import type { Card } from "../../shared/types";
import { api } from "../api";
import { Avatar, catVar } from "./Avatar";
import { currentSubscription, disablePush, enablePush, pushSupported } from "../push";
import { useStore } from "../store";
import { fmtDate, isDue, todayStr } from "../util";
import { AiFlag, CardTile, PrioBadge, StarButton, StuckBadge } from "./CardTile";

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
        {due.length === 0 && (
          <div className="empty">
            <span className="big">🎉</span>
            Nichts fällig.
          </div>
        )}
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
  // Was am längsten wartet, kommt zuerst
  const list = data.cards
    .filter((c) => c.column_key === "entscheiden")
    .sort((a, b) => (a.column_since ?? "").localeCompare(b.column_since ?? "") || a.position - b.position);

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
      offen: "Stimme gespeichert – noch keine Mehrheit",
      uneinig: "Keine Mehrheit – bitte besprechen",
      umsetzen: "Mehrheit Ja → „Umsetzen“ 🚀",
      verworfen: "Mehrheit Nein → „Verworfen“",
      parkplatz: "Mehrheit Parken → „Parkplatz“",
    };
    toast(msg[res.result] ?? "Gespeichert");
  }

  return (
    <div className="page">
      <div className="page-inner">
        <h1>Besprechung</h1>
        <p className="muted">
          Alle Karten aus „Entscheiden“. Jeder stimmt für sich ab – sobald {Math.floor(VOTERS.length / 2) + 1} von {VOTERS.length} gleich stimmen, wandert die Karte automatisch weiter.
        </p>
        {list.length === 0 && (
          <div className="empty">
            <span className="big">✓</span>
            Keine Karten zur Entscheidung.
          </div>
        )}
        {list.map((c, i) => {
          const cat = c.category_id ? catsById.get(c.category_id) : undefined;
          const mine = c.votes.find((v) => v.user_id === me)?.vote;
          return (
            <div key={c.id} className="list-card" style={catVar(cat?.color)}>
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
                <StuckBadge card={c} />
                <span>
                  Nutzen {c.benefit ?? "–"} · Aufwand {c.effort ?? "–"}
                </span>
                {c.next_step && <span>Nächster Schritt: {c.next_step}</span>}
                <AiFlag card={c} />
              </div>
              <VoteBar card={c} />
              <div className="vote-row">
                {VOTERS.includes(me) && (["ja", "nein", "parken"] as const).map((v) => (
                  <button key={v} className={"btn vote-btn " + v + (mine === v ? " active" : "")} onClick={() => vote(c, v)}>
                    {v === "ja" ? "👍 Ja" : v === "nein" ? "👎 Nein" : "🅿 Parken"}
                  </button>
                ))}
                <span className="spacer" />
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

function VoteBar({ card }: { card: Card }) {
  const n = VOTERS.length;
  const needed = Math.floor(n / 2) + 1;
  const count = (v: string) => card.votes.filter((x) => x.vote === v && VOTERS.includes(x.user_id)).length;
  return (
    <div className="votebar">
      <div className="track" title={`Mehrheit ab ${needed} von ${n} Stimmen`}>
        {(["ja", "parken", "nein"] as const).map((v) => (
          <i key={v} className={v} style={{ width: `${(count(v) / n) * 100}%` }} />
        ))}
        <span className="mark" style={{ left: `${(needed / n) * 100}%` }} />
      </div>
      {VOTERS.map((uid) => {
        const v = card.votes.find((x) => x.user_id === uid)?.vote;
        return (
          <span key={uid} className={"voter " + (v ?? "")}>
            <Avatar id={uid} size="sm" />
            {v ? { ja: "Ja", nein: "Nein", parken: "Parken" }[v] : "offen"}
          </span>
        );
      })}
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
          <CostMeter used={data.settings.month_cost_eur} limit={Number(data.settings.ai_monthly_limit_eur) || 0} />
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

        {!data.settings.examples_seeded && (
          <div className="section">
            <h3>Beispielkarten</h3>
            <p className="small muted">Legt 5 Beispielideen aus eurem Betrieb an. Die KI analysiert sie automatisch.</p>
            <button className="btn" onClick={() => run(() => api("/examples", { method: "POST" }), "5 Beispielkarten angelegt – KI analysiert…")}>
              Beispielkarten anlegen
            </button>
          </div>
        )}

        <AccountSection />

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
          <p className="small muted">Zusätzlich wird jede Nacht automatisch eine Sicherung bei Cloudflare (R2) abgelegt und 30 Tage aufbewahrt.</p>
          <Backups />
        </div>
      </div>
    </div>
  );
}

function Backups() {
  const { run } = useStore();
  const [list, setList] = useState<{ key: string; size: number; uploaded: string }[] | null>(null);
  const load = () => api<{ key: string; size: number; uploaded: string }[]>("/backups").then(setList).catch(() => setList([]));
  if (list === null)
    return (
      <button className="btn small" onClick={load}>
        Automatische Sicherungen anzeigen
      </button>
    );
  return (
    <div>
      <div className="row" style={{ marginBottom: 6 }}>
        <b className="small">Automatische Sicherungen</b>
        <span className="spacer" />
        <button className="btn small" onClick={() => run(() => api("/backups", { method: "POST" }), "Sicherung erstellt").then(load)}>
          Jetzt sichern
        </button>
      </div>
      {list.length === 0 && <div className="small muted">Noch keine Sicherung vorhanden.</div>}
      {list.map((b) => (
        <div key={b.key} className="small">
          <a href={`/api/backups/${b.key}`}>{b.key}</a> <span className="muted">({Math.round(b.size / 1024)} KB)</span>
        </div>
      ))}
    </div>
  );
}

function CostMeter({ used, limit }: { used: number; limit: number }) {
  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
  return (
    <div style={{ margin: "4px 0 12px" }}>
      <div className="row small">
        <span className="grow">KI-Kosten diesen Monat (ca.)</span>
        <b>
          {used.toLocaleString("de-DE", { style: "currency", currency: "EUR" })} von {limit.toLocaleString("de-DE", { style: "currency", currency: "EUR" })}
        </b>
      </div>
      <div className="progress" style={{ height: 8 }}>
        <i style={{ width: `${pct}%`, background: pct >= 90 ? "var(--red)" : pct >= 70 ? "var(--amber)" : undefined }} />
      </div>
    </div>
  );
}

function AccountSection() {
  const { data, me, run, toast } = useStore();
  const mine = data.users.find((u) => u.id === me);
  const [email, setEmail] = useState(mine?.email ?? "");
  const [push, setPush] = useState<"aus" | "an" | "nicht">(pushSupported() ? "aus" : "nicht");
  useEffect(() => {
    currentSubscription().then((s) => s && setPush("an"));
  }, []);

  async function togglePush() {
    try {
      if (push === "an") {
        await disablePush();
        setPush("aus");
        toast("Benachrichtigungen auf diesem Gerät aus");
      } else {
        await enablePush();
        setPush("an");
        toast("Benachrichtigungen auf diesem Gerät an");
      }
    } catch (e) {
      toast((e as Error).message, true);
    }
  }

  return (
    <>
      <div className="section">
        <h3>Mein Konto</h3>
        <div className="row" style={{ marginBottom: 10 }}>
          <Avatar id={me} size="lg" />
          <b className="grow">{userName(me)}</b>
          <button
            className="btn"
            onClick={async () => {
              if (!confirm("Abmelden?")) return;
              await api("/logout", { method: "POST" });
              location.reload();
            }}
          >
            Abmelden
          </button>
        </div>
        <label className="field">E-Mail für den Wochenüberblick</label>
        <div className="row">
          <input type="text" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@ft-workanddesign.de" />
          <button className="btn" disabled={email === (mine?.email ?? "")} onClick={() => run(() => api("/me/email", { method: "PUT", body: { email } }), "Gespeichert")}>
            Speichern
          </button>
        </div>
      </div>

      <div className="section">
        <h3>Benachrichtigungen auf diesem Gerät</h3>
        {push === "nicht" ? (
          <p className="small muted">
            Hier nicht verfügbar. Am iPhone: Seite in Safari öffnen → Teilen → „Zum Home-Bildschirm“, dann die App von dort öffnen und hier einschalten.
          </p>
        ) : (
          <>
            <p className="small muted">Bei Kommentaren, fehlenden Stimmen, Entscheidungen und montags mit dem Wochenüberblick.</p>
            <div className="row">
              <button className={"btn" + (push === "an" ? " active" : "")} onClick={togglePush}>
                {push === "an" ? "🔔 An – ausschalten" : "🔕 Aus – einschalten"}
              </button>
              {push === "an" && (
                <button className="btn small" onClick={() => run(() => api("/push/test", { method: "POST" }), "Test gesendet")}>
                  Test senden
                </button>
              )}
            </div>
          </>
        )}
      </div>

      <div className="section">
        <h3>Wochenüberblick per Mail (montags)</h3>
        <p className="small muted">
          {data.settings.mail_enabled
            ? `Geht an: ${data.users.filter((u) => u.email).map((u) => u.name).join(", ") || "noch niemand – E-Mail oben eintragen"}.`
            : "E-Mail-Versand ist noch nicht eingerichtet (siehe README: Resend). Der Rückblick erscheint trotzdem unter „Überblick“ und per Push."}
        </p>
        <div className="row wrap">
          <a className="btn small" href="/api/digest/preview" target="_blank" rel="noreferrer">
            Vorschau ansehen
          </a>
          {data.settings.mail_enabled && (
            <button className="btn small" onClick={() => run(() => api("/digest/test", { method: "POST" }), "Test-Mail verschickt")}>
              Test-Mail an mich
            </button>
          )}
        </div>
      </div>

      <div className="section">
        <h3>Verbindungen</h3>
        <p className="small muted">
          Pipedrive: {data.settings.pipedrive_enabled ? "verbunden – in jeder Karte „Als Aufgabe in Pipedrive anlegen“" : "nicht eingerichtet (siehe README)"}
          <br />
          Plaud: Transkripte über <a href="#/import">Ideen aus Gespräch</a> importieren
        </p>
      </div>
    </>
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
                  <div key={c.id} className="print-card list-card" style={catVar(c.category_id ? catsById.get(c.category_id)?.color : undefined)}>
                    <b>{c.title}</b>{" "}
                    <span className="muted small">
                      · {c.category_id ? catsById.get(c.category_id)?.name : "ohne Kategorie"} · Nutzen {c.benefit ?? "–"} / Aufwand {c.effort ?? "–"} · <PrioBadge card={c} /> · von {userName(c.created_by)}, {fmtDate(c.created_at)}
                    </span>
                    {c.description && <div style={{ whiteSpace: "pre-wrap", marginTop: 4 }}>{c.description}</div>}
                    {c.ai_summary && <div className="small" style={{ marginTop: 4 }}>KI-Kurzfassung (Vorschlag): {c.ai_summary}</div>}
                    {(c.next_step || c.assignee || c.follow_up) && (
                      <div className="small" style={{ marginTop: 4 }}>
                        {c.next_step && <>Nächster Schritt: {c.next_step} · </>}
                        {c.assignee && <>Zuständig: {assigneeLabel(c.assignee)} · </>}
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
