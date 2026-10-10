import { useEffect, useMemo, useState } from "react";
import { GRUPPEN, STUFEN, gruppeKurz, kennzahlen, offeneSchritte, stufeName } from "../../shared/types";
import type { Fall, Kennzahl } from "../../shared/types";
import { useStore } from "../store";
import { LEER, filterAktiv, fmtDate, passt, sortiere, tageBis, terminLabel, today } from "../util";
import type { Filter, Sortierung, StatusFilter } from "../util";

const KACHELN: { k: Kennzahl; label: string; ton: string }[] = [
  { k: "offen", label: "Offen", ton: "" },
  { k: "kritisch", label: "Kritisch", ton: "crit" },
  { k: "ueberfaellig", label: "Termin überfällig", ton: "crit" },
  { k: "woche", label: "Termine in 7 Tagen", ton: "warn" },
  { k: "ohneSchritt", label: "Ohne nächsten Schritt", ton: "warn" },
];

const FILTER_KEY = "rk_filter";

function startFilter(k: Kennzahl | null): Filter {
  let f = LEER;
  try {
    f = { ...LEER, ...JSON.parse(sessionStorage.getItem(FILTER_KEY) ?? "{}") };
  } catch {
    /* egal */
  }
  return k ? { ...f, kennzahl: k } : f;
}

export const oeffne = (f: Fall) => (window.location.hash = `#/fall/${encodeURIComponent(f.id)}`);

export function Uebersicht({ startKennzahl }: { startKennzahl: Kennzahl | null }) {
  const { data } = useStore();
  const [flt, setFlt] = useState<Filter>(() => startFilter(startKennzahl));
  const t = today();
  const zahlen = useMemo(() => kennzahlen(data.faelle, t), [data.faelle, t]);
  const liste = useMemo(() => sortiere(data.faelle.filter((f) => passt(f, flt, t)), flt.sort), [data.faelle, flt, t]);
  const set = (p: Partial<Filter>) => setFlt((f) => ({ ...f, ...p }));

  useEffect(() => {
    if (startKennzahl) setFlt((f) => ({ ...f, kennzahl: startKennzahl }));
  }, [startKennzahl]);
  useEffect(() => {
    try {
      sessionStorage.setItem(FILTER_KEY, JSON.stringify(flt));
    } catch {
      /* egal */
    }
  }, [flt]);

  return (
    <main className="page">
      <section className="kacheln" aria-label="Kennzahlen">
        {KACHELN.map(({ k, label, ton }) => (
          <button key={k} className={`kachel ${ton}${flt.kennzahl === k ? " on" : ""}${zahlen[k] === 0 ? " null" : ""}`} onClick={() => set({ kennzahl: flt.kennzahl === k ? "" : k })} aria-pressed={flt.kennzahl === k}>
            <span className="zahl">{zahlen[k]}</span>
            <span className="lbl">{label}</span>
          </button>
        ))}
      </section>

      <Termine faelle={data.faelle} />

      <section className="filters" aria-label="Filter">
        <input className="suche" type="search" placeholder="Suchen in allen Feldern…" value={flt.q} onChange={(e) => set({ q: e.target.value })} />
        <select value={flt.gruppe} onChange={(e) => set({ gruppe: e.target.value as Filter["gruppe"] })} aria-label="Gruppe">
          <option value="">Alle Gruppen</option>
          {GRUPPEN.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
        <select value={flt.stufe} onChange={(e) => set({ stufe: e.target.value as Filter["stufe"] })} aria-label="Dringlichkeit">
          <option value="">Jede Dringlichkeit</option>
          {STUFEN.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <select value={flt.kennzahl ? "" : flt.status} disabled={!!flt.kennzahl} onChange={(e) => set({ status: e.target.value as StatusFilter })} aria-label="Status">
          <option value="offen">Offene Fälle</option>
          <option value="erledigt">Erledigte ({zahlen.erledigt})</option>
          <option value="alle">Alle Fälle</option>
          {flt.kennzahl && <option value="">nach Kennzahl</option>}
        </select>
        <select value={flt.sort} onChange={(e) => set({ sort: e.target.value as Sortierung })} aria-label="Sortierung">
          <option value="dringlichkeit">Nach Dringlichkeit</option>
          <option value="termin">Nach Termin</option>
          <option value="stand">Zuletzt bearbeitet</option>
          <option value="name">Nach Name</option>
        </select>
      </section>

      <div className="treffer">
        <span>
          {liste.length} {liste.length === 1 ? "Fall" : "Fälle"}
          {flt.kennzahl && ` · ${KACHELN.find((x) => x.k === flt.kennzahl)?.label}`}
        </span>
        {filterAktiv(flt) && (
          <button className="btn ghost small" onClick={() => setFlt({ ...LEER, sort: flt.sort })}>
            Filter zurücksetzen
          </button>
        )}
      </div>

      <section className="liste">
        {liste.map((f) => (
          <FallKarte key={f.id} f={f} />
        ))}
        {!liste.length && <div className="empty">{data.faelle.length ? "Keine Fälle für diese Auswahl." : "Noch keine Fälle. Inhaber können unter ⚙ Einstellungen die Export-Datei importieren."}</div>}
      </section>
    </main>
  );
}

/** Leiste „Nächste Termine und Fristen“: überfällige zuerst, dann die nächsten */
function Termine({ faelle }: { faelle: Fall[] }) {
  const list = useMemo(
    () =>
      faelle
        .filter((f) => !f.erledigt && f.termin)
        .sort((a, b) => a.termin!.localeCompare(b.termin!))
        .slice(0, 30),
    [faelle],
  );
  if (!list.length) return null;
  return (
    <section className="termine" aria-label="Nächste Termine und Fristen">
      <h2>Nächste Termine und Fristen</h2>
      <div className="termine-scroll">
        {list.map((f) => {
          const n = tageBis(f.termin!);
          return (
            <button key={f.id} className={"termin-chip" + (n < 0 ? " over" : n <= 1 ? " bald" : "")} onClick={() => oeffne(f)}>
              <span className="when">
                {fmtDate(f.termin)} · {terminLabel(f.termin!)}
              </span>
              <span className="who">{f.name}</span>
              {f.terminText && <span className="what">{f.terminText}</span>}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function FallKarte({ f }: { f: Fall }) {
  const offen = offeneSchritte(f);
  const naechster = f.schritte.find((s) => !s.done);
  const n = f.termin ? tageBis(f.termin) : null;
  return (
    <button className={`fall-karte stufe-${f.stufe}${f.erledigt ? " erledigt" : ""}`} onClick={() => oeffne(f)}>
      <div className="fk-top">
        <span className="fk-name">{f.name}</span>
        <span className={`chip g-${f.gruppe}`}>{gruppeKurz(f.gruppe)}</span>
        {f.erledigt ? <span className="chip ok">Erledigt</span> : <span className={`chip s-${f.stufe}`}>{stufeName(f.stufe)}</span>}
      </div>
      {f.meta && <div className="fk-meta">{f.meta}</div>}
      {f.what && <div className="fk-what">{f.what}</div>}
      {!f.erledigt && (
        <div className={"fk-next" + (naechster ? "" : " fehlt")}>{naechster ? `→ ${naechster.t}` : "Kein nächster Schritt festgelegt"}</div>
      )}
      <div className="fk-foot">
        {f.termin && (
          <span className={n !== null && n < 0 && !f.erledigt ? "over" : n !== null && n <= 7 && !f.erledigt ? "bald" : ""}>
            📅 {fmtDate(f.termin)}
            {!f.erledigt && ` (${terminLabel(f.termin)})`}
          </span>
        )}
        {f.status && <span>{f.status}</span>}
        {f.schritte.length > 0 && (
          <span>
            ☑ {f.schritte.length - offen}/{f.schritte.length}
          </span>
        )}
        {f.verlauf.length > 0 && <span>🕘 {f.verlauf.length}</span>}
        {f.anhang_count > 0 && <span>📎 {f.anhang_count}</span>}
        {f.stand && <span className="stand">Stand {fmtDate(f.stand)}</span>}
      </div>
    </button>
  );
}
