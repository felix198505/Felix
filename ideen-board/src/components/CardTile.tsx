import { assigneeLabel, priorityOf, PRIORITY_LABEL, STUCK_DAYS, userName, USERS, VOTERS } from "../../shared/types";
import { Avatar, catVar } from "./Avatar";
import type { Card } from "../../shared/types";
import { api } from "../api";
import { useStore } from "../store";
import { daysSince, fmtDate, isDue, todayStr } from "../util";

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
      return <span className="ai-flag done" title="KI-Analyse vorhanden">✦ KI</span>;
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

/** Markiert Karten, die zu lange auf eine Entscheidung warten */
export function StuckBadge({ card }: { card: Card }) {
  if (card.column_key !== "entscheiden") return null;
  const d = daysSince(card.column_since);
  if (d < STUCK_DAYS) return null;
  return (
    <span className="stuck" title={`Wartet seit ${d} Tagen auf Entscheidung`}>
      ⏳ {d} Tage
    </span>
  );
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
  const assigneeIds = !card.assignee ? [] : card.assignee === "alle" ? USERS.map((u) => u.id) : card.assignee === "beide" ? [...VOTERS].slice(0, 2) : [card.assignee];
  return (
    <div
      className={"card" + (ghost ? " ghost" : "") + (overlay ? " overlay" : "") + (card.favorite_by.length ? " fav" : "")}
      style={catVar(cat?.color)}
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
            <span className="dot" style={{ background: cat.color, color: cat.color }} />
            {cat.name}
          </span>
        )}
        <PrioBadge card={card} />
        <StuckBadge card={card} />
        {card.follow_up && (
          <span className={"due" + (due ? " over" : "")} title="Wiedervorlage">
            ⏰ {card.follow_up === todayStr() ? "heute" : fmtDate(card.follow_up)}
          </span>
        )}
      </div>
      {card.checklist.length > 0 && (
        <div className="progress" title={`Checkliste ${done}/${card.checklist.length}`}>
          <i style={{ width: `${(done / card.checklist.length) * 100}%` }} />
        </div>
      )}
      <div className="card-foot">
        <span className="avatars" title={`von ${userName(card.created_by)}${card.assignee ? " · zuständig: " + assigneeLabel(card.assignee) : ""}`}>
          <Avatar id={card.created_by} size="sm" />
          {assigneeIds.filter((a) => a !== card.created_by).map((a) => (
            <Avatar key={a} id={a} size="sm" />
          ))}
        </span>
        <span className="stats">
          {card.checklist.length > 0 && (
            <span title="Checkliste">
              ☑ {done}/{card.checklist.length}
            </span>
          )}
          {card.comment_count > 0 && <span title="Kommentare">💬 {card.comment_count}</span>}
          {card.attachment_count > 0 && <span title="Fotos">📷 {card.attachment_count}</span>}
          {card.column_key === "entscheiden" && card.votes.length > 0 && (
            <span title={card.votes.map((v) => `${userName(v.user_id)}: ${v.vote}`).join(", ")}>🗳 {card.votes.length}/{VOTERS.length}</span>
          )}
        </span>
        <span className="spacer" />
        <AiFlag card={card} />
      </div>
      {card.column_key === "verworfen" && card.reject_reason && <div className="card-sum">Grund: {card.reject_reason}</div>}
    </div>
  );
}
