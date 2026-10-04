import { useState } from "react";
import type { TranscriptIdea } from "../../shared/types";
import { api } from "../api";
import { useStore } from "../store";

/** Ideen aus einem Gesprächs-Transkript (z. B. Plaud) oder Notizen herausziehen lassen */
export function ImportView() {
  const { data, run, toast, cardsById, openCard } = useStore();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [ideas, setIdeas] = useState<(TranscriptIdea & { on: boolean })[] | null>(null);

  async function readFile(f: File | undefined) {
    if (!f) return;
    setText(await f.text());
  }

  async function analyze() {
    setBusy(true);
    setIdeas(null);
    try {
      const r = await api<{ ideen: TranscriptIdea[] }>("/import/transcript", { body: { text } });
      setIdeas(r.ideen.map((i) => ({ ...i, on: !i.aehnlich_karte_id })));
      if (!r.ideen.length) toast("Keine Ideen im Text gefunden");
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    const chosen = ideas?.filter((i) => i.on) ?? [];
    for (const i of chosen) {
      await api("/cards", { body: { title: i.titel, description: `${i.beschreibung}\n\nAus Gespräch: „${i.zitat}“` } });
    }
    await run(async () => undefined, `${chosen.length} ${chosen.length === 1 ? "Idee" : "Ideen"} im Eingang angelegt`);
    setIdeas(null);
    setText("");
  }

  const set = (idx: number, p: Partial<TranscriptIdea & { on: boolean }>) => setIdeas((l) => l!.map((x, i) => (i === idx ? { ...x, ...p } : x)));

  return (
    <div className="page">
      <div className="page-inner">
        <h1>Ideen aus Gespräch</h1>
        <p className="muted">
          Transkript einer Besprechung (z. B. aus Plaud) oder lose Notizen einfügen. Die KI findet die Ideen darin, ihr wählt aus, was aufs Board soll.
        </p>
        <details className="small muted" style={{ marginBottom: 12 }}>
          <summary style={{ cursor: "pointer" }}>So kommt das Transkript aus Plaud hierher</summary>
          <ol style={{ marginTop: 6 }}>
            <li>In der Plaud-App die Aufnahme öffnen → Reiter „Transkript“.</li>
            <li>Oben auf Teilen/Exportieren → „Text kopieren“ oder als TXT exportieren.</li>
            <li>Hier einfügen bzw. die TXT-Datei auswählen.</li>
          </ol>
        </details>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={10} placeholder="Transkript oder Notizen hier einfügen…" />
        <div className="row wrap" style={{ marginTop: 8 }}>
          <label className="btn small">
            📄 Textdatei wählen
            <input type="file" accept=".txt,.md,.srt,.vtt,text/plain" hidden onChange={(e) => readFile(e.target.files?.[0])} />
          </label>
          <span className="small muted">{text.length ? `${text.length.toLocaleString("de-DE")} Zeichen` : ""}</span>
          <span className="spacer" />
          <button className="btn primary" disabled={busy || text.trim().length < 30 || !data.settings.ai_enabled} onClick={analyze}>
            {busy ? (
              <>
                <span className="spin">✦</span> KI liest…
              </>
            ) : (
              "✦ Ideen finden"
            )}
          </button>
        </div>
        {!data.settings.ai_enabled && <p className="small" style={{ color: "var(--amber)" }}>Dafür muss der Anthropic-API-Schlüssel hinterlegt sein.</p>}

        {ideas && ideas.length > 0 && (
          <div className="ai-panel" style={{ marginTop: 20 }}>
            <div className="ai-head">
              <span className="title">✦ Gefundene Ideen</span>
              <span className="chip">Vorschlag</span>
            </div>
            <div className="ai-note">Haken setzen, Titel bei Bedarf anpassen. Ideen, die es schon gibt, sind abgewählt.</div>
            {ideas.map((i, idx) => (
              <div key={idx} className={"ai-item" + (i.on ? "" : " verworfen")} style={{ textDecoration: "none" }}>
                <input type="checkbox" checked={i.on} onChange={(e) => set(idx, { on: e.target.checked })} style={{ width: 20, height: 20, accentColor: "var(--green)", marginTop: 6 }} />
                <div className="txt" style={{ whiteSpace: "normal" }}>
                  <input type="text" value={i.titel} onChange={(e) => set(idx, { titel: e.target.value })} style={{ fontWeight: 700 }} />
                  <div className="small" style={{ marginTop: 4 }}>{i.beschreibung}</div>
                  <div className="small muted" style={{ marginTop: 4, fontStyle: "italic" }}>„{i.zitat}“</div>
                  {i.aehnlich_karte_id > 0 && (
                    <div className="small" style={{ color: "var(--amber)", marginTop: 4 }}>
                      Ähnlich wie{" "}
                      <a href="#" onClick={(e) => (e.preventDefault(), openCard(i.aehnlich_karte_id))}>
                        {cardsById.get(i.aehnlich_karte_id)?.title ?? `#${i.aehnlich_karte_id}`}
                      </a>
                    </div>
                  )}
                </div>
              </div>
            ))}
            <div className="row" style={{ justifyContent: "flex-end", marginTop: 10 }}>
              <button className="btn primary" disabled={!ideas.some((i) => i.on)} onClick={create}>
                {ideas.filter((i) => i.on).length === 1 ? "1 Idee" : `${ideas.filter((i) => i.on).length} Ideen`} in den Eingang
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
