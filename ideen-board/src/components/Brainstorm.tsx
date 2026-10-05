import { useState } from "react";
import { COLUMNS, userName } from "../../shared/types";
import type { Brainstorm, Card } from "../../shared/types";
import { api } from "../api";
import { Avatar, catVar } from "./Avatar";
import { useStore } from "../store";
import { fmtDate } from "../util";
import { AiFlag, PrioBadge } from "./CardTile";
import { MicButton } from "./Mic";
import { sendOrQueue } from "../offline";

export function BrainstormList({ go }: { go: (hash: string) => void }) {
  const { data, run } = useStore();
  const [topic, setTopic] = useState("");
  return (
    <div className="page">
      <div className="page-inner">
        <div className="row wrap">
          <h1 className="grow">Brainstorming</h1>
          <button className="btn" onClick={() => go("#/import")}>
            🎙 Ideen aus Gespräch / Plaud
          </button>
        </div>
        <p className="muted">
          Zu einem Thema viele Ideen hintereinander eintippen. Danach gemeinsam sortieren und Ähnliches zusammenführen. Die KI analysiert erst nach dem Sammeln.
        </p>
        <form
          className="row"
          style={{ margin: "14px 0 22px" }}
          onSubmit={async (e) => {
            e.preventDefault();
            if (!topic.trim()) return;
            const r = await run(() => api<{ id: number }>("/brainstorms", { body: { topic } }));
            if (r) go(`#/brainstorming/${r.id}`);
          }}
        >
          <input type="text" placeholder="Thema, z. B. „Mehr Aufträge im Winter“" value={topic} onChange={(e) => setTopic(e.target.value)} />
          <button className="btn primary" type="submit">
            Starten
          </button>
        </form>
        {data.brainstorms.map((b) => {
          const n = data.cards.filter((c) => c.brainstorm_id === b.id).length;
          return (
            <div key={b.id} className="list-card" style={{ cursor: "pointer" }} onClick={() => go(`#/brainstorming/${b.id}`)}>
              <div className="row">
                <b className="grow">{b.topic}</b>
                <span className="chip">{{ sammeln: "Sammeln", sortieren: "Sortieren", fertig: "Fertig" }[b.status]}</span>
              </div>
              <div className="small muted">
                {n} Ideen · von {userName(b.created_by)} am {fmtDate(b.created_at)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function BrainstormSession({ id, go }: { id: number; go: (hash: string) => void }) {
  const { data } = useStore();
  const b = data.brainstorms.find((x) => x.id === id);
  if (!b) return <div className="page empty">Brainstorming nicht gefunden.</div>;
  const ideas = data.cards.filter((c) => c.brainstorm_id === id).sort((a, b) => b.id - a.id);
  // auch zusammengeführte Ideen zählen als Teil der Sitzung, sind aber nicht mehr auf dem Board
  return (
    <div className="page">
      <div className="page-inner">
        <div className="row" style={{ marginBottom: 6 }}>
          <button className="btn small" onClick={() => go("#/brainstorming")}>
            ← Übersicht
          </button>
        </div>
        <h1>{b.topic}</h1>
        {b.status === "sammeln" ? <Collect b={b} ideas={ideas} /> : <Sort b={b} ideas={ideas} />}
      </div>
    </div>
  );
}

function Collect({ b, ideas }: { b: Brainstorm; ideas: Card[] }) {
  const { run, toast } = useStore();
  const [text, setText] = useState("");
  return (
    <>
      <p className="muted">Idee eintippen, Enter, nächste Idee. Nicht bewerten, einfach sammeln.</p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const t = text.trim();
          if (!t) return;
          setText("");
          const r = await sendOrQueue(`/brainstorms/${b.id}/ideas`, { title: t }, t).catch((e) => {
            toast((e as Error).message, true);
            return null;
          });
          if (r === "queued") toast("Offline gespeichert – wird später hochgeladen");
          else if (r === "sent") await run(async () => undefined);
        }}
      >
        <div className="row">
          <input className="brain-input" type="text" autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="Nächste Idee…" enterKeyHint="send" />
          <MicButton value={text} onChange={setText} title="Idee einsprechen" />
        </div>
      </form>
      <div className="row" style={{ margin: "12px 0" }}>
        <span className="muted">{ideas.length} Ideen gesammelt</span>
        <span className="spacer" />
        <button
          className="btn primary"
          disabled={ideas.length === 0}
          onClick={() => run(() => api(`/brainstorms/${b.id}/status`, { body: { status: "sortieren" } })).then(() => toast("Sammeln beendet – KI analysiert jetzt"))}
        >
          Sammeln beenden → sortieren
        </button>
      </div>
      <ol style={{ paddingLeft: 22 }}>
        {[...ideas].reverse().map((c) => (
          <li key={c.id} style={{ marginBottom: 4 }}>
            {c.title} <span className="muted small">({userName(c.created_by)})</span>
          </li>
        ))}
      </ol>
    </>
  );
}

function Sort({ b, ideas }: { b: Brainstorm; ideas: Card[] }) {
  const { data, run, openCard, catsById, toast } = useStore();
  const [sel, setSel] = useState<number[]>([]);
  const toggle = (id: number) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  async function merge() {
    if (sel.length < 2) return;
    const [target, ...rest] = sel;
    const t = ideas.find((c) => c.id === target);
    if (!confirm(`${sel.length} Ideen in „${t?.title}“ zusammenführen? (Die zuerst gewählte bleibt erhalten, die anderen werden archiviert.)`)) return;
    await run(() => api(`/cards/${target}/merge`, { body: { source_ids: rest } }), "Zusammengeführt");
    setSel([]);
  }

  const ai = b.ai_data;
  const byId = new Map(ideas.map((c) => [c.id, c]));

  return (
    <>
      <p className="muted">
        Ideen sind im „Eingang“ gespeichert. Hier gemeinsam sortieren: Kategorie setzen, Ähnliches zusammenführen (Ideen anhaken, die zuerst gewählte bleibt), in Spalten verschieben.
      </p>
      <div className="row wrap" style={{ margin: "10px 0" }}>
        <button className="btn" disabled={sel.length < 2} onClick={merge}>
          ⇄ {sel.length >= 2 ? `${sel.length} zusammenführen` : "Zum Zusammenführen ≥ 2 anhaken"}
        </button>
        {sel.length > 0 && (
          <button className="btn ghost small" onClick={() => setSel([])}>
            Auswahl leeren
          </button>
        )}
        <span className="spacer" />
        {b.status === "sortieren" ? (
          <button className="btn primary" onClick={() => run(() => api(`/brainstorms/${b.id}/status`, { body: { status: "fertig" } }), "Brainstorming abgeschlossen")}>
            Fertig
          </button>
        ) : (
          <button className="btn" onClick={() => run(() => api(`/brainstorms/${b.id}/status`, { body: { status: "sortieren" } }))}>
            Wieder öffnen
          </button>
        )}
      </div>

      <div className="ai-panel" style={{ marginBottom: 16 }}>
        <div className="ai-head">
          <span className="title">✦ KI: Themen & fehlende Ideen</span>
          <span className="chip">Vorschlag</span>
          <span className="spacer" />
          {data.settings.ai_enabled && (
            <button className="btn ai small" disabled={b.ai_status === "running" || b.ai_status === "pending"} onClick={() => run(() => api(`/brainstorms/${b.id}/reanalyze`, { method: "POST" })).then(() => toast("KI bündelt neu…"))}>
              Neu bündeln
            </button>
          )}
        </div>
        {(b.ai_status === "pending" || b.ai_status === "running") && (
          <div className="ai-note">
            <span className="spin">✦</span> KI bündelt die Ideen…
          </div>
        )}
        {b.ai_status === "error" && <div className="ai-note">Bündelung fehlgeschlagen ({b.ai_error}). Wird automatisch nachgeholt.</div>}
        {b.ai_status === "none" && !ai && <div className="ai-note">Noch keine Bündelung.</div>}
        {ai && (
          <>
            {ai.themen.map((t, i) => (
              <div key={i} className="ai-block">
                <h4>{t.titel}</h4>
                {t.hinweis && <div className="small muted" style={{ marginBottom: 4 }}>{t.hinweis}</div>}
                <div className="row wrap">
                  {t.karten_ids
                    .map((cid) => byId.get(cid) ?? data.cards.find((c) => c.id === cid))
                    .filter(Boolean)
                    .map((c) => (
                      <button key={c!.id} className={"btn small" + (sel.includes(c!.id) ? " active" : "")} onClick={() => toggle(c!.id)}>
                        {c!.title}
                      </button>
                    ))}
                </div>
              </div>
            ))}
            {ai.zusatz_ideen.length > 0 && (
              <div className="ai-block">
                <h4>Noch fehlende Ideen</h4>
                {ai.zusatz_ideen.map((z) => (
                  <div key={z.id} className={"ai-item" + (z.status === "angelegt" ? " uebernommen" : z.status === "verworfen" ? " verworfen" : "")}>
                    <div className="txt">
                      <b>{z.titel}</b>
                      <div className="small">{z.beschreibung}</div>
                    </div>
                    {(!z.status || z.status === "offen") && (
                      <div className="ai-actions">
                        <button className="btn small primary" onClick={() => run(() => api(`/brainstorms/${b.id}/extra/${z.id}`, { body: { action: "anlegen" } }), "Als Karte angelegt")}>
                          Übernehmen
                        </button>
                        <button className="btn small" onClick={() => run(() => api(`/brainstorms/${b.id}/extra/${z.id}`, { body: { action: "verwerfen" } }))}>
                          Verwerfen
                        </button>
                      </div>
                    )}
                    {z.status === "angelegt" && <span className="small">✓ angelegt</span>}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {ideas.map((c) => {
        const cat = c.category_id ? catsById.get(c.category_id) : undefined;
        return (
          <div key={c.id} className="list-card" style={catVar(cat?.color)}>
            <div className="row">
              <input type="checkbox" checked={sel.includes(c.id)} onChange={() => toggle(c.id)} style={{ width: 20, height: 20, accentColor: "var(--green)" }} />
              <b className="grow" style={{ cursor: "pointer" }} onClick={() => openCard(c.id)}>
                {c.title}
              </b>
              {sel.indexOf(c.id) === 0 && sel.length > 1 && <span className="chip">bleibt</span>}
            </div>
            {c.ai_summary && <div className="small" style={{ color: "var(--ai)", marginTop: 4 }}>✦ {c.ai_summary}</div>}
            <div className="row wrap" style={{ marginTop: 8 }}>
              <select value={c.category_id ?? ""} style={{ width: "auto" }} onChange={(e) => run(() => api(`/cards/${c.id}`, { method: "PATCH", body: { category_id: e.target.value || null } }))}>
                <option value="">Kategorie…</option>
                {data.categories.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.name}
                  </option>
                ))}
              </select>
              <select value={c.column_key} style={{ width: "auto" }} onChange={(e) => run(() => api(`/cards/${c.id}/move`, { body: { column_key: e.target.value, reject_reason: e.target.value === "verworfen" ? "Im Brainstorming aussortiert" : undefined } }))}>
                {COLUMNS.map((k) => (
                  <option key={k.key} value={k.key}>
                    {k.title}
                  </option>
                ))}
              </select>
              <PrioBadge card={c} />
              <AiFlag card={c} />
            </div>
          </div>
        );
      })}
    </>
  );
}
