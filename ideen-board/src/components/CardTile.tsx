import { assigneeLabel, priorityOf, PRIORITY_LABEL, userName } from "../../shared/types";
import type { Card } from "../../shared/types";
import { api } from "../api";
import { useStore } from "../store";
import { fmtDate, isDue, todayStr } from "../util";

export function PrioBadge({ card }: { card: Pick<Card, "benefit" | "effort"> }) {
  const p = priorityOf(card.benefit, card.effort);
  return <span className={"prio " + p}>{PRIORITY_LABEL[p]}</span>;
}

export function AiFlag({ card }: { card: Card }) {
  switch (card.ai_status) {
    case "pending":
    case "running":
      return (
        <span className="ai-flag" title="KI-Analyse läuft oder steht aus">
          <span className="spin">✦</span> KI
        </span>
      );
    case "done":
      return <span className="ai-flag" title="KI-Analyse vorhanden">✦ KI</span>;
    case "error":
      return (
        <span className="ai-flag err" title={card.ai_error ?? "KI-Analyse fehlgeschlagen – wird nachgeholt"}>
          ✦ KI ausstehend
        </span>
      );
    case "deferred":
      return <span className="ai-flag" title="Wird nach dem Brainstorming analysiert">✦ später</span>;
  }
}

export function StarButton({ card }: { card: Card }) {
  const { me, run } = useStore();
  const on = card.favorite_by.includes(me);
  return (
    <button
      className={"star" + (on ? " on" : "")}
      title={on ? "Merken entfernen" : "Merken"}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        run(() => api(`/cards/${card.id}/favorite`, { method: "POST" }));
      }}
    >
      {on ? "★" : "☆"}
    </button>
  );
}

export function CardTile({ card, ghost, overlay }: { card: Card; ghost?: boolean; overlay?: boolean }) {
  const { catsById, openCard } = useStore();
  const cat = card.category_id ? catsById.get(card.category_id) : undefined;
  const done = card.checklist.filter((i) => i.done).length;
  const due = isDue(card);
  return (
    <div
      className={"card" + (ghost ? " ghost" : "") + (overlay ? " overlay" : "")}
      style={{ borderLeftColor: cat?.color ?? "var(--line)" }}
      onClick={() => openCard(card.id)}
    >
      <div className="card-top">
        <div className="card-title grow">{card.title}</div>
        <StarButton card={card} />
      </div>
      {card.ai_summary && <div className="card-sum">{card.ai_summary}</div>}
      <div className="card-meta">
        {cat && (
          <span className="chip">
            <span className="dot" style={{ background: cat.color }} />
            {cat.name}
          </span>
        )}
        <PrioBadge card={card} />
        {card.assignee && <span title="Zuständig">👤 {assigneeLabel(card.assignee)}</span>}
        {card.follow_up && (
          <span className={"due" + (due ? " over" : "")} title="Wiedervorlage">
            ⏰ {card.follow_up === todayStr() ? "heute" : fmtDate(card.follow_up)}
          </span>
        )}
        {card.checklist.length > 0 && (
          <span title="Checkliste">
            ☑ {done}/{card.checklist.length}
          </span>
        )}
        {card.comment_count > 0 && <span title="Kommentare">💬 {card.comment_count}</span>}
        {card.column_key === "entscheiden" && card.votes.length > 0 && (
          <span title="Abstimmung">🗳 {card.votes.map((v) => `${userName(v.user_id)[0]}:${v.vote}`).join(" ")}</span>
        )}
        <AiFlag card={card} />
      </div>
      {card.column_key === "verworfen" && card.reject_reason && <div className="card-sum">Grund: {card.reject_reason}</div>}
    </div>
  );
}
