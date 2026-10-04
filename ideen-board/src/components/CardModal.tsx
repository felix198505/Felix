import { useCallback, useEffect, useState } from "react";
import { ASSIGNEE_GROUPS, COLUMNS, columnTitle, USERS, userName } from "../../shared/types";
import type { Card, CardDetail, ColumnKey } from "../../shared/types";
import { api } from "../api";
import { Avatar, catVar } from "./Avatar";
import { useStore } from "../store";
import { fmtDate, fmtDateTime } from "../util";
import { AiPanel } from "./AiPanel";
import { MicButton } from "./Mic";
import { Photos } from "./Photos";
import { PrioBadge, StarButton } from "./CardTile";

export function CardModal({ id }: { id: number }) {
  const { data, cardsById, openCard, run, askText, toast } = useStore();
  const [detail, setDetail] = useState<CardDetail | null>(null);
  const boardCard = cardsById.get(id);

  const load = useCallback(async () => {
    try {
      setDetail(await api<CardDetail>(`/cards/${id}`));
    } catch (e) {
      toast((e as Error).message, true);
    }
  }, [id, toast]);

  // Neu laden, wenn sich die Karte auf dem Board geändert hat (auch durch den anderen Nutzer oder die KI)
  useEffect(() => {
    load();
  }, [load, boardCard?.updated_at, boardCard?.ai_status, boardCard?.comment_count, boardCard?.checklist.length, data.rev]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && openCard(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openCard]);

  if (!detail) {
    return (
      <div className="modal-back" onClick={() => openCard(null)}>
        <div className="modal">
          <div className="modal-body muted">Lade…</div>
        </div>
      </div>
    );
  }

  const card = boardCard ?? detail.card;
  const merged = detail.card.merged_into;

  const patch = (body: Partial<Record<keyof Card, unknown>>) => run(() => api(`/cards/${id}`, { method: "PATCH", body }));

  async function move(col: ColumnKey) {
    let reject_reason: string | undefined;
    if (col === "verworfen") {
      const r = await askText("Warum wird die Idee verworfen?", { placeholder: "Kurzer Grund", okLabel: "Verwerfen" });
      if (r === null) return;
      reject_reason = r;
    }
    await run(() => api(`/cards/${id}/move`, { body: { column_key: col, reject_reason } }), `Nach „${columnTitle(col)}“ verschoben`);
  }

  async function remove() {
    if (!confirm(`„${card.title}“ löschen?\nDie Karte kommt in den Papierkorb und lässt sich 30 Tage lang wiederherstellen.`)) return;
    const ok = await run(() => api(`/cards/${id}`, { method: "DELETE" }));
    if (ok === undefined) return;
    openCard(null);
    toast("Karte gelöscht", false, { label: "Rückgängig", run: () => run(() => api(`/cards/${id}/restore`, { method: "POST" }), "Wiederhergestellt") });
  }

  async function mergeWith(sourceId: number): Promise<boolean> {
    const src = cardsById.get(sourceId);
    if (!src || !confirm(`„${src.title}“ in diese Karte zusammenführen?\nKommentare und Checkliste werden übernommen, die andere Karte wird archiviert (nicht gelöscht).`)) return false;
    const ok = await run(() => api(`/cards/${id}/merge`, { body: { source_ids: [sourceId] } }), "Zusammengeführt");
    load();
    return ok !== undefined;
  }

  return (
    <div className="modal-back" onClick={() => openCard(null)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <StarButton card={card} />
          <input
            key={card.title}
            className="title-input grow"
            type="text"
            defaultValue={card.title}
            onBlur={(e) => e.target.value.trim() && e.target.value !== card.title && patch({ title: e.target.value })}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          />
          {!card.deleted_at && (
            <button className="btn ghost" onClick={remove} title="Karte löschen" aria-label="Karte löschen">
              🗑
            </button>
          )}
          <button className="btn" onClick={() => openCard(null)} aria-label="Schließen">
            ✕
          </button>
        </div>
        <div className="modal-body">
          {detail.card.deleted_at && (
            <div className="list-card" style={catVar("var(--red)")}>
              <div className="row wrap">
                <span className="grow">
                  🗑 Im Papierkorb – gelöscht von {userName(detail.card.deleted_by)} am {fmtDate(detail.card.deleted_at)}. Wird nach 30 Tagen endgültig entfernt.
                </span>
                <button className="btn small primary" onClick={() => run(() => api(`/cards/${id}/restore`, { method: "POST" }), "Wiederhergestellt").then(load)}>
                  Wiederherstellen
                </button>
              </div>
            </div>
          )}
          {merged && (
            <div className="list-card" style={catVar("var(--amber)")}>
              Diese Karte wurde in{" "}
              <a href="#" onClick={(e) => (e.preventDefault(), openCard(merged))}>
                Karte #{merged}
              </a>{" "}
              zusammengeführt und ist archiviert.
            </div>
          )}
          <div className="row wrap small muted" style={{ marginBottom: 12 }}>
            <span>
              #{card.id} · von <b>{userName(card.created_by)}</b> am {fmtDate(card.created_at)}
            </span>
            <span className="spacer" />
            <label className="row small">
              Spalte
              <select value={card.column_key} onChange={(e) => move(e.target.value as ColumnKey)} style={{ width: "auto" }}>
                {COLUMNS.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.title}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="detail-grid">
            <div>
              <OwnFields card={card} patch={patch} />
              <Checklist card={card} />
              <Photos cardId={id} list={detail.attachments} onChange={(attachments) => setDetail({ ...detail, attachments })} />
              <Comments id={id} detail={detail} setDetail={setDetail} />
              <MergeBox card={card} onMerge={mergeWith} />
              <PipedriveBox card={card} />
              <History detail={detail} />
            </div>
            <div>
              <AiPanel detail={detail} reload={load} onMerge={mergeWith} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function OwnFields({ card, patch }: { card: Card; patch: (b: Partial<Record<keyof Card, unknown>>) => void }) {
  const { data } = useStore();
  return (
    <div className="section">
      <h3>Unsere Angaben</h3>
      <div className="fields">
        <div className="full">
          <label className="field">Beschreibung</label>
          <textarea
            key={card.description}
            defaultValue={card.description}
            rows={4}
            placeholder="Was ist die Idee? Warum?"
            onBlur={(e) => e.target.value !== card.description && patch({ description: e.target.value })}
          />
        </div>
        <div>
          <label className="field">Kategorie</label>
          <select value={card.category_id ?? ""} onChange={(e) => patch({ category_id: e.target.value || null })}>
            <option value="">– keine –</option>
            {data.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="field">
            Priorität (automatisch) &nbsp;<PrioBadge card={card} />
          </label>
          <div className="small muted">aus Nutzen und Aufwand</div>
        </div>
        <div>
          <label className="field">Nutzen (1 = gering, 5 = sehr hoch)</label>
          <Score value={card.benefit} onChange={(v) => patch({ benefit: v })} />
        </div>
        <div>
          <label className="field">Aufwand (1 = gering, 5 = sehr hoch)</label>
          <Score value={card.effort} onChange={(v) => patch({ effort: v })} />
        </div>
        <div>
          <label className="field">Zuständig</label>
          <select value={card.assignee ?? ""} onChange={(e) => patch({ assignee: e.target.value || null })}>
            <option value="">– offen –</option>
            {USERS.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
            {ASSIGNEE_GROUPS.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="field">Wiedervorlage</label>
          <div className="row">
            <input type="date" value={card.follow_up ?? ""} onChange={(e) => patch({ follow_up: e.target.value || null })} />
            {card.follow_up && (
              <button className="btn small" onClick={() => patch({ follow_up: null })} title="Entfernen">
                ✕
              </button>
            )}
          </div>
        </div>
        <div className="full">
          <label className="field">Nächster Schritt</label>
          <input
            key={card.next_step}
            type="text"
            defaultValue={card.next_step}
            placeholder="Was passiert als Nächstes?"
            onBlur={(e) => e.target.value !== card.next_step && patch({ next_step: e.target.value })}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          />
        </div>
        {card.column_key === "verworfen" && (
          <div className="full">
            <label className="field">Verwerfungsgrund</label>
            <input
              key={card.reject_reason}
              type="text"
              defaultValue={card.reject_reason}
              onBlur={(e) => e.target.value !== card.reject_reason && patch({ reject_reason: e.target.value })}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function Score({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
  return (
    <div className="score">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} className={value === n ? "on" : ""} onClick={() => onChange(value === n ? null : n)}>
          {n}
        </button>
      ))}
    </div>
  );
}

function Checklist({ card }: { card: Card }) {
  const { run } = useStore();
  const [text, setText] = useState("");
  const done = card.checklist.filter((i) => i.done).length;
  return (
    <div className="section">
      <h3>
        Checkliste {card.checklist.length > 0 && `(${done}/${card.checklist.length})`}
      </h3>
      {card.checklist.map((i) => (
        <div key={i.id} className={"check-item" + (i.done ? " done" : "")}>
          <input type="checkbox" checked={!!i.done} onChange={(e) => run(() => api(`/checklist/${i.id}`, { method: "PATCH", body: { done: e.target.checked } }))} />
          <span className="txt">
            {i.text}
            {i.source === "ai" && <span className="src-ai">aus KI</span>}
          </span>
          <button className="btn ghost small" title="Entfernen" onClick={() => run(() => api(`/checklist/${i.id}`, { method: "DELETE" }))}>
            ✕
          </button>
        </div>
      ))}
      <form
        className="row"
        style={{ marginTop: 6 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          run(() => api(`/cards/${card.id}/checklist`, { body: { text } }));
          setText("");
        }}
      >
        <input type="text" value={text} onChange={(e) => setText(e.target.value)} placeholder="Teilschritt hinzufügen…" />
        <button className="btn" type="submit">
          +
        </button>
      </form>
    </div>
  );
}

function Comments({ id, detail, setDetail }: { id: number; detail: CardDetail; setDetail: (d: CardDetail) => void }) {
  const { run } = useStore();
  const [text, setText] = useState("");
  return (
    <div className="section">
      <h3>Kommentare</h3>
      {detail.comments.map((c) => (
        <div key={c.id} className="comment">
          <Avatar id={c.user_id} />
          <div className="bubble">
            <div className="who">
              <b>{userName(c.user_id)}</b> · {fmtDateTime(c.created_at)}
            </div>
            <div className="text">{c.text}</div>
          </div>
        </div>
      ))}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!text.trim()) return;
          const d = await run(() => api<CardDetail>(`/cards/${id}/comments`, { body: { text } }));
          if (d) setDetail(d);
          setText("");
        }}
      >
        <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Kommentar schreiben…" rows={2} />
        <div className="row" style={{ justifyContent: "flex-end", marginTop: 6 }}>
          <MicButton value={text} onChange={setText} title="Kommentar einsprechen" />
          <button className="btn primary" type="submit" disabled={!text.trim()}>
            Kommentieren
          </button>
        </div>
      </form>
    </div>
  );
}

function MergeBox({ card, onMerge }: { card: Card; onMerge: (id: number) => Promise<boolean> }) {
  const { data } = useStore();
  const [open, setOpen] = useState(false);
  if (card.merged_into) return null;
  const others = data.cards.filter((c) => c.id !== card.id).sort((a, b) => a.title.localeCompare(b.title, "de"));
  return (
    <div className="section">
      {!open ? (
        <button className="btn small" onClick={() => setOpen(true)}>
          ⇄ Andere Karte hier hinein zusammenführen…
        </button>
      ) : (
        <div className="row">
          <select defaultValue="" onChange={(e) => e.target.value && onMerge(Number(e.target.value))}>
            <option value="">Karte wählen…</option>
            {others.map((c) => (
              <option key={c.id} value={c.id}>
                #{c.id} {c.title} ({columnTitle(c.column_key)})
              </option>
            ))}
          </select>
          <button className="btn small" onClick={() => setOpen(false)}>
            ✕
          </button>
        </div>
      )}
    </div>
  );
}

function PipedriveBox({ card }: { card: Card }) {
  const { data, run, askText } = useStore();
  if (!data.settings.pipedrive_enabled || card.merged_into) return null;
  async function send() {
    const subject = await askText("Aufgabe in Pipedrive anlegen", { initial: card.next_step || card.title, okLabel: "In Pipedrive anlegen" });
    if (!subject) return;
    await run(() => api(`/cards/${card.id}/pipedrive`, { body: { subject, due_date: card.follow_up } }), "Aufgabe in Pipedrive angelegt");
  }
  return (
    <div className="section">
      <button className="btn small" onClick={send}>
        ↗ Als Aufgabe in Pipedrive anlegen
      </button>
    </div>
  );
}

function History({ detail }: { detail: CardDetail }) {
  const [open, setOpen] = useState(false);
  const list = open ? detail.history : detail.history.slice(0, 5);
  return (
    <div className="section">
      <h3>Verlauf</h3>
      <ul className="history" style={{ paddingLeft: 18, margin: 0 }}>
        {list.map((h) => (
          <li key={h.id}>
            {fmtDateTime(h.created_at)} – <b>{userName(h.user_id)}</b>: {h.action}
            {h.detail && ` · ${h.detail}`}
          </li>
        ))}
      </ul>
      {detail.history.length > 5 && (
        <button className="btn ghost small" onClick={() => setOpen(!open)}>
          {open ? "Weniger" : `Alle ${detail.history.length} Einträge`}
        </button>
      )}
    </div>
  );
}
