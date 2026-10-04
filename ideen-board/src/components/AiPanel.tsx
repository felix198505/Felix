import { useState } from "react";
import { userName } from "../../shared/types";
import type { AiAnalysis, AiItem, CardDetail, Source } from "../../shared/types";
import { api } from "../api";
import { useStore } from "../store";
import { fmtDateTime } from "../util";

type State = "uebernommen" | "verworfen" | undefined;

export function AiPanel({ detail, reload, onMerge }: { detail: CardDetail; reload: () => void; onMerge: (id: number) => Promise<boolean> }) {
  const { data, run, toast, openCard, catsById } = useStore();
  const [versionIdx, setVersionIdx] = useState(0);
  const card = detail.card;
  const analyses = detail.analyses;
  const a: AiAnalysis | undefined = analyses[Math.min(versionIdx, analyses.length - 1)];
  const busy = card.ai_status === "pending" || card.ai_status === "running";

  async function reanalyze() {
    await run(() => api(`/cards/${card.id}/analyze`, { method: "POST" }));
    setVersionIdx(0);
    toast("Neue KI-Analyse angefordert – die alte Fassung bleibt erhalten");
  }

  return (
    <div className="ai-panel">
      <div className="ai-head">
        <span className="title">✦ KI-Analyse</span>
        <span className="chip" title="Alles hier ist ein Vorschlag der KI und ändert nichts an euren Einträgen, solange ihr es nicht übernehmt.">
          Vorschlag
        </span>
        <span className="spacer" />
        {data.settings.ai_enabled && card.ai_status !== "deferred" && !card.merged_into && (
          <button className="btn ai small" disabled={busy} onClick={reanalyze} title="z. B. nach neuen Kommentaren oder Infos">
            ↻ Neu analysieren
          </button>
        )}
      </div>
      <div className="ai-note">
        Von der KI erstellt – nicht automatisch übernommen. Jeden Punkt einzeln übernehmen, ändern oder verwerfen. Eure eigenen Einträge werden nie überschrieben.
      </div>

      {busy && (
        <div className="ai-note" style={{ color: "var(--ai)" }}>
          <span className="spin">✦</span> {card.ai_status === "running" ? "KI analysiert gerade (mit Websuche kann das 1–2 Minuten dauern)…" : "Analyse steht in der Warteschlange…"}
          {!data.settings.ai_enabled && " Es ist noch kein API-Schlüssel hinterlegt – die Analyse wird nachgeholt, sobald er eingerichtet ist."}
        </div>
      )}
      {card.ai_status === "deferred" && <div className="ai-note">Wird nach dem Sammeln im Brainstorming analysiert.</div>}
      {card.ai_status === "error" && (
        <div className="ai-note" style={{ color: "var(--amber)" }}>
          Analyse fehlgeschlagen: {card.ai_error}. Die Idee ist gespeichert; die Analyse wird automatisch nachgeholt.
          {data.settings.ai_enabled && (
            <>
              {" "}
              <button className="btn small" onClick={reanalyze}>
                Jetzt erneut versuchen
              </button>
            </>
          )}
        </div>
      )}

      {analyses.length > 1 && (
        <div className="row small" style={{ marginBottom: 10 }}>
          <span className="muted">Fassung:</span>
          <select value={versionIdx} onChange={(e) => setVersionIdx(Number(e.target.value))} style={{ width: "auto" }}>
            {analyses.map((x, i) => (
              <option key={x.id} value={i}>
                {x.version} vom {fmtDateTime(x.created_at)}
                {i === 0 ? " (aktuell)" : ""}
              </option>
            ))}
          </select>
        </div>
      )}

      {a && <AnalysisBody a={a} isCurrent={versionIdx === 0} reload={reload} onMerge={onMerge} openCard={openCard} catName={card.category_id ? catsById.get(card.category_id)?.name : undefined} card={card} />}
      {!a && !busy && card.ai_status !== "error" && card.ai_status !== "deferred" && <div className="ai-note">Noch keine Analyse vorhanden.</div>}
    </div>
  );
}

function AnalysisBody({
  a,
  isCurrent,
  reload,
  onMerge,
  openCard,
  catName,
  card,
}: {
  a: AiAnalysis;
  isCurrent: boolean;
  reload: () => void;
  onMerge: (id: number) => Promise<boolean>;
  openCard: (id: number) => void;
  catName?: string;
  card: CardDetail["card"];
}) {
  const { run, askText } = useStore();
  const d = a.data;
  const st = (id: string): State => a.item_state[id];

  async function act(itemId: string, state: "uebernommen" | "verworfen" | "offen", text?: string) {
    await run(() => api(`/analyses/${a.id}/item`, { body: { item_id: itemId, state, text } }), state === "uebernommen" ? "Übernommen" : undefined);
    reload();
  }
  async function editAndTake(itemId: string, current: string, label = "Vorschlag anpassen und übernehmen") {
    const t = await askText(label, { initial: current, okLabel: "Übernehmen" });
    if (t !== null) act(itemId, "uebernommen", t);
  }

  const Actions = ({ id, text, take = "Übernehmen", extra }: { id: string; text: string; take?: string; extra?: React.ReactNode }) => {
    const s = st(id);
    if (s)
      return (
        <div className="ai-actions">
          <span className="small" style={{ color: s === "uebernommen" ? "var(--green)" : "var(--muted)" }}>
            {s === "uebernommen" ? "✓ übernommen" : "verworfen"}
          </span>
          {s === "verworfen" && (
            <button className="btn ghost small" onClick={() => act(id, "offen")} title="Rückgängig">
              ↺
            </button>
          )}
        </div>
      );
    return (
      <div className="ai-actions">
        <button className="btn small primary" onClick={() => act(id, "uebernommen")}>
          {take}
        </button>
        {extra}
        <button className="btn small" onClick={() => editAndTake(id, text)} title="Text anpassen, dann übernehmen">
          ✎
        </button>
        <button className="btn small" onClick={() => act(id, "verworfen")} title="Verwerfen">
          ✕
        </button>
      </div>
    );
  };

  const List = ({ title, items, take, hint }: { title: string; items: AiItem[]; take: string; hint?: string }) =>
    items.length ? (
      <div className="ai-block">
        <h4>{title}</h4>
        {hint && <div className="small muted" style={{ marginBottom: 4 }}>{hint}</div>}
        {items.map((it) => (
          <div key={it.id} className={"ai-item " + (st(it.id) ?? "")}>
            <div className="txt">{it.text}</div>
            <Actions id={it.id} text={it.text} take={take} />
          </div>
        ))}
      </div>
    ) : null;

  const openSteps = d.naechste_schritte.filter((s) => !st(s.id));

  return (
    <div>
      <div className="small muted" style={{ marginBottom: 10 }}>
        Fassung {a.version} · {fmtDateTime(a.created_at)}
        {a.requested_by ? ` · angefordert von ${userName(a.requested_by)}` : ""}
        {!isCurrent && " · ältere Fassung"}
      </div>

      <div className="ai-block">
        <h4>Kurzfassung</h4>
        <div className={"ai-item " + (st("kurzfassung") ?? "")}>
          <div className="txt">{d.kurzfassung}</div>
          <Actions id="kurzfassung" text={d.kurzfassung} take="In Beschreibung" />
        </div>
      </div>

      <div className="ai-block">
        <h4>Einordnung</h4>
        <div className={"ai-item " + (st("kategorie") ?? "")}>
          <div className="txt">
            <b>Kategorie: {d.kategorie.vorschlag}</b>
            {catName && catName !== d.kategorie.vorschlag && <span className="muted"> (bei euch: {catName})</span>}
            <div className="small muted">{d.kategorie.begruendung}</div>
          </div>
          <Actions id="kategorie" text={d.kategorie.vorschlag} />
        </div>
        {(["nutzen", "aufwand"] as const).map((k) => (
          <div key={k} className={"ai-item " + (st(k) ?? "")}>
            <div className="txt">
              <b>
                {k === "nutzen" ? "Nutzen" : "Aufwand"}: {d[k].wert} / 5
              </b>
              <span className="assume" style={{ marginLeft: 6 }}>Einschätzung</span>
              {(k === "nutzen" ? card.benefit : card.effort) && <span className="muted"> (bei euch: {k === "nutzen" ? card.benefit : card.effort})</span>}
              <div className="small muted">{d[k].begruendung}</div>
            </div>
            <Actions id={k} text={String(d[k].wert)} />
          </div>
        ))}
      </div>

      {d.naechste_schritte.length > 0 && (
        <div className="ai-block">
          <div className="row">
            <h4 className="grow">Nächste Schritte</h4>
            {openSteps.length > 1 && (
              <button
                className="btn small ai"
                onClick={async () => {
                  for (const s of openSteps) await api(`/analyses/${a.id}/item`, { body: { item_id: s.id, state: "uebernommen" } });
                  await run(async () => undefined, "Alle Schritte in die Checkliste übernommen");
                  reload();
                }}
              >
                Alle in Checkliste
              </button>
            )}
          </div>
          {d.naechste_schritte.map((it, i) => (
            <div key={it.id} className={"ai-item " + (st(it.id) ?? "")}>
              <div className="txt">
                {i + 1}. {it.text}
                {st("naechster:" + it.id) === "uebernommen" && <span className="src-ai">als nächster Schritt gesetzt</span>}
              </div>
              <Actions
                id={it.id}
                text={it.text}
                take="☑ Checkliste"
                extra={
                  !st("naechster:" + it.id) && (
                    <button className="btn small" title="Als „Nächster Schritt“ der Karte setzen" onClick={() => act("naechster:" + it.id, "uebernommen")}>
                      → Nächster
                    </button>
                  )
                }
              />
            </div>
          ))}
        </div>
      )}

      <List title="Ergänzende Maßnahmen" items={d.massnahmen} take="☑ Checkliste" />

      {(d.infos.length > 0 || d.kosten_zeit?.text) && (
        <div className="ai-block">
          <h4>Infos & Hintergrund</h4>
          {d.infos.map((it) => (
            <div key={it.id} className={"ai-item " + (st(it.id) ?? "")}>
              <div className="txt">
                {it.ist_schaetzung && <span className="assume">Schätzung</span>}
                {it.text}
                <Sources list={it.quellen} />
              </div>
              <Actions id={it.id} text={it.text} take="Als Kommentar" />
            </div>
          ))}
          {d.kosten_zeit?.text && (
            <div className={"ai-item " + (st("kosten_zeit") ?? "")}>
              <div className="txt">
                <b>Kosten & Zeit: </b>
                {d.kosten_zeit.ist_schaetzung && <span className="assume">Schätzung</span>}
                {d.kosten_zeit.text}
              </div>
              <Actions id="kosten_zeit" text={d.kosten_zeit.text} take="Als Kommentar" />
            </div>
          )}
          {d.quellen.length === 0 && <div className="small muted">Keine Websuche nötig – keine externen Quellen. Angaben ohne Quelle sind Einschätzungen der KI.</div>}
        </div>
      )}

      <List title="Risiken" items={d.risiken} take="Als Klärungspunkt" />
      <List title="Offene Fragen vor der Entscheidung" items={d.offene_fragen} take="Als Klärungspunkt" />

      {d.aehnliche_karten.length > 0 && (
        <div className="ai-block">
          <h4>Ähnliche Karten</h4>
          {d.aehnliche_karten.map((s) => {
            const id = "aehnlich:" + s.karte_id;
            return (
              <div key={id} className={"ai-item " + (st(id) ?? "")}>
                <div className="txt">
                  <a href="#" onClick={(e) => (e.preventDefault(), openCard(s.karte_id))}>
                    #{s.karte_id} {s.titel}
                  </a>
                  {s.zusammenfuehren_empfohlen && <span className="src-ai">Zusammenführen empfohlen</span>}
                  <div className="small muted">{s.grund}</div>
                </div>
                {st(id) ? (
                  <div className="ai-actions small">{st(id) === "uebernommen" ? "✓ zusammengeführt" : "verworfen"}</div>
                ) : (
                  <div className="ai-actions">
                    <button
                      className="btn small primary"
                      onClick={async () => {
                        if (await onMerge(s.karte_id)) await act(id, "uebernommen");
                      }}
                    >
                      Hier zusammenführen
                    </button>
                    <button className="btn small" onClick={() => act(id, "verworfen")}>
                      ✕
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {d.quellen.length > 0 && (
        <div className="ai-block">
          <h4>Quellen (Websuche)</h4>
          <Sources list={d.quellen} />
        </div>
      )}
    </div>
  );
}

function Sources({ list }: { list: Source[] }) {
  if (!list?.length) return null;
  return (
    <div className="sources">
      {list.map((s) => (
        <a key={s.url} href={s.url} target="_blank" rel="noreferrer noopener" title={s.url}>
          ↗ {s.titel || new URL(s.url).hostname}
        </a>
      ))}
    </div>
  );
}
