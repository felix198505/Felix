import type { CardDetail } from "../../shared/types";

// Etappe 3 füllt diesen Bereich mit der eigentlichen KI-Analyse.
export function AiPanel({ detail }: { detail: CardDetail; reload: () => void; onMerge: (id: number) => void }) {
  return (
    <div className="ai-panel">
      <div className="ai-head">
        <span className="title">✦ KI-Analyse</span>
        <span className="chip">Vorschlag</span>
      </div>
      <div className="ai-note">
        {detail.card.ai_status === "deferred" ? "Wird nach dem Brainstorming analysiert." : "Analyse steht aus – wird ab Etappe 3 automatisch erstellt."}
      </div>
    </div>
  );
}
