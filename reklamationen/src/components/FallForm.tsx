import { useEffect, useState } from "react";
import { GRUPPEN, STUFEN } from "../../shared/types";
import type { Fall, Gruppe, Stufe } from "../../shared/types";
import { api } from "../api";
import { useStore } from "../store";

interface Werte {
  name: string;
  meta: string;
  gruppe: Gruppe;
  stufe: Stufe;
  status: string;
  what: string;
  pts: string;
  termin: string;
  terminText: string;
  hinweis: string;
  lk: string;
  lf: string;
  mh_link: string;
  pd_link: string;
  schritte: string;
}

function ausFall(f?: Fall): Werte {
  return {
    name: f?.name ?? "",
    meta: f?.meta ?? "",
    gruppe: f?.gruppe ?? "kunde",
    stufe: f?.stufe ?? "warn",
    status: f?.status ?? "",
    what: f?.what ?? "",
    pts: (f?.pts ?? []).join("\n"),
    termin: f?.termin ?? "",
    terminText: f?.terminText ?? "",
    hinweis: f?.hinweis ?? "",
    lk: f?.lk ?? "",
    lf: f?.lf ?? "",
    mh_link: f?.mh_link ?? "",
    pd_link: f?.pd_link ?? "",
    schritte: "",
  };
}

/** Fall anlegen oder bearbeiten. Gespeichert werden nur geänderte Felder. */
export function FallForm({ fall, onClose }: { fall?: Fall; onClose: () => void }) {
  const { run } = useStore();
  const [start] = useState(() => ausFall(fall));
  const [w, setW] = useState<Werte>(start);
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<Werte>) => setW((x) => ({ ...x, ...p }));
  const geaendert = (Object.keys(w) as (keyof Werte)[]).filter((k) => w[k] !== start[k]);

  useEffect(() => {
    const on = (e: KeyboardEvent) => e.key === "Escape" && schliessen();
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  });

  function schliessen() {
    if (geaendert.length && !confirm("Änderungen verwerfen?")) return;
    onClose();
  }

  async function speichern(e: React.FormEvent) {
    e.preventDefault();
    const body: Record<string, unknown> = {};
    for (const k of geaendert) {
      if (k === "pts") body.pts = w.pts.split("\n").map((s) => s.trim()).filter(Boolean);
      else if (k === "schritte") body.schritte = w.schritte.split("\n").map((t) => ({ t: t.trim() })).filter((s) => s.t);
      else if (["termin", "lk", "lf"].includes(k)) body[k] = w[k] || null;
      else body[k] = typeof w[k] === "string" ? (w[k] as string).trim() : w[k];
    }
    if (!fall) Object.assign(body, { name: w.name.trim(), gruppe: w.gruppe, stufe: w.stufe });
    setBusy(true);
    const r = await run(
      () => (fall ? api<Fall>(`/faelle/${encodeURIComponent(fall.id)}`, { method: "PATCH", body }) : api<Fall>("/faelle", { body })),
      fall ? "Gespeichert" : "Fall angelegt",
    );
    setBusy(false);
    if (r) window.location.hash = `#/fall/${encodeURIComponent(r.id)}`;
  }

  return (
    <div className="modal-back" onClick={schliessen}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={speichern}>
        <div className="modal-head">
          <b className="grow">{fall ? `Fall bearbeiten: ${fall.name}` : "Neuer Fall"}</b>
          <button type="button" className="btn icon" onClick={schliessen} aria-label="Schließen">
            ✕
          </button>
        </div>
        <div className="modal-body fields">
          <Feld label="Kunde bzw. Fallname *" full>
            <input type="text" value={w.name} onChange={(e) => set({ name: e.target.value })} required autoFocus={!fall} />
          </Feld>
          <Feld label="Angaben (Vorname, Ort, Projektnummer, Anwalt, Aktenzeichen)" full>
            <input type="text" value={w.meta} onChange={(e) => set({ meta: e.target.value })} />
          </Feld>
          <Feld label="Gruppe">
            <select value={w.gruppe} onChange={(e) => set({ gruppe: e.target.value as Gruppe })}>
              {GRUPPEN.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </Feld>
          <Feld label="Dringlichkeit">
            <select value={w.stufe} onChange={(e) => set({ stufe: e.target.value as Stufe })}>
              {STUFEN.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Feld>
          <Feld label="Vorgang in einer Zeile" full>
            <input type="text" value={w.what} onChange={(e) => set({ what: e.target.value })} />
          </Feld>
          <Feld label="Status (Kurzlabel)">
            <input type="text" value={w.status} onChange={(e) => set({ status: e.target.value })} placeholder="z. B. Frist, Gutachten, wartet auf Kunde" />
          </Feld>
          <Feld label="Nächster Termin / Fristende">
            <div className="row">
              <input type="date" value={w.termin} onChange={(e) => set({ termin: e.target.value })} />
              {w.termin && (
                <button type="button" className="btn small" onClick={() => set({ termin: "" })} aria-label="Termin entfernen">
                  ✕
                </button>
              )}
            </div>
          </Feld>
          <Feld label="Was ist am Termin?" full>
            <input type="text" value={w.terminText} onChange={(e) => set({ terminText: e.target.value })} placeholder="z. B. Ortstermin Gutachter, Frist Stellungnahme" />
          </Feld>
          <Feld label="Sachstand (ein Punkt pro Zeile)" full>
            <textarea value={w.pts} onChange={(e) => set({ pts: e.target.value })} rows={5} />
          </Feld>
          {!fall && (
            <Feld label="Nächste Schritte (einer pro Zeile)" full>
              <textarea value={w.schritte} onChange={(e) => set({ schritte: e.target.value })} rows={3} />
            </Feld>
          )}
          <Feld label="Hinweis zur Datenlage" full>
            <input type="text" value={w.hinweis} onChange={(e) => set({ hinweis: e.target.value })} placeholder="z. B. Inhalt nur im PDF" />
          </Feld>
          <Feld label="Letzte Kundenmail">
            <input type="date" value={w.lk} onChange={(e) => set({ lk: e.target.value })} />
          </Feld>
          <Feld label="Letzte Mail von FT">
            <input type="date" value={w.lf} onChange={(e) => set({ lf: e.target.value })} />
          </Feld>
          <Feld label="Link zum Projekt in Mein Handwerker" full>
            <input type="url" value={w.mh_link} onChange={(e) => set({ mh_link: e.target.value })} placeholder="https://…" />
          </Feld>
          <Feld label="Link zum Deal in Pipedrive" full>
            <input type="url" value={w.pd_link} onChange={(e) => set({ pd_link: e.target.value })} placeholder="https://….pipedrive.com/deal/…" />
          </Feld>
        </div>
        <div className="modal-foot">
          <button type="button" className="btn" onClick={schliessen}>
            Abbrechen
          </button>
          <button type="submit" className="btn primary" disabled={busy || !w.name.trim() || (!!fall && !geaendert.length)}>
            {busy ? "Speichere…" : fall ? "Speichern" : "Fall anlegen"}
          </button>
        </div>
      </form>
    </div>
  );
}

function Feld({ label, full, children }: { label: string; full?: boolean; children: React.ReactNode }) {
  return (
    <label className={full ? "full" : ""}>
      <span className="field">{label}</span>
      {children}
    </label>
  );
}
