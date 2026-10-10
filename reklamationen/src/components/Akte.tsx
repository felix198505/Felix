import { useEffect, useState } from "react";
import { darf, gruppeName, stufeName } from "../../shared/types";
import type { Aenderung, Anhang, Fall, Schritt, VerlaufEintrag } from "../../shared/types";
import { api, upload } from "../api";
import { useStore } from "../store";
import { fmtDate, fmtDateTime, tageBis, terminLabel, today, verkleinern } from "../util";

const zu = () => (window.location.hash = "#/");

export function Akte({ fall: f }: { fall: Fall }) {
  const { rolle, run, userName } = useStore();
  const kann = darf.bearbeiten(rolle);
  const enc = encodeURIComponent(f.id);

  // Escape schließt die Akte
  useEffect(() => {
    const on = (e: KeyboardEvent) => e.key === "Escape" && !document.querySelector(".modal-back") && zu();
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);

  async function erledigt(v: boolean) {
    await run(() => api<Fall>(`/faelle/${enc}`, { method: "PATCH", body: { erledigt: v } }), v ? "Fall erledigt" : "Fall wieder geöffnet");
  }

  async function loeschen() {
    if (!confirm(`Fall „${f.name}“ wirklich löschen?\n\nSachstand, Schritte, Verlauf und Anhänge werden entfernt. Eine Kopie der Texte bleibt im Änderungsprotokoll.`)) return;
    const r = await run(() => api(`/faelle/${enc}`, { method: "DELETE" }), "Fall gelöscht");
    if (r) zu();
  }

  const n = f.termin ? tageBis(f.termin) : null;

  return (
    <div className="drawer-back" onClick={zu}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()} aria-label={`Fallakte ${f.name}`}>
        <div className={`drawer-head stufe-${f.stufe}`}>
          <div className="grow">
            <div className="akte-name">{f.name}</div>
            <div className="row wrap small">
              <span className={`chip g-${f.gruppe}`}>{gruppeName(f.gruppe)}</span>
              {f.erledigt ? <span className="chip ok">Erledigt</span> : <span className={`chip s-${f.stufe}`}>{stufeName(f.stufe)}</span>}
              {f.status && <span className="chip">{f.status}</span>}
            </div>
          </div>
          <button className="btn icon" onClick={zu} aria-label="Schließen">
            ✕
          </button>
        </div>

        <div className="drawer-body">
          {kann && (
            <div className="row wrap akte-aktionen">
              <button className="btn small" onClick={() => (window.location.hash = `#/bearbeiten/${enc}`)}>
                ✎ Bearbeiten
              </button>
              {f.erledigt ? (
                <button className="btn small" onClick={() => erledigt(false)}>
                  ↺ Wieder öffnen
                </button>
              ) : (
                <button className="btn small" onClick={() => erledigt(true)}>
                  ✓ Erledigt
                </button>
              )}
              {darf.loeschen(rolle) && (
                <button className="btn small danger" onClick={loeschen}>
                  🗑 Löschen
                </button>
              )}
            </div>
          )}

          {(f.what || f.meta) && (
            <section className="akte-sec">
              {f.what && <p className="akte-what">{f.what}</p>}
              {f.meta && <p className="muted small" style={{ margin: 0 }}>{f.meta}</p>}
            </section>
          )}

          <section className={"termin-box" + (n !== null && n < 0 && !f.erledigt ? " over" : n !== null && n <= 7 && !f.erledigt ? " bald" : "")}>
            <div className="lbl">Nächster Termin / Fristende</div>
            {f.termin ? (
              <div className="wert">
                {fmtDate(f.termin)} <span className="small">({terminLabel(f.termin)})</span>
              </div>
            ) : (
              <div className="wert muted">kein Termin</div>
            )}
            {f.terminText && <div>{f.terminText}</div>}
          </section>

          {f.hinweis && (
            <section className="hinweis">
              <b>Hinweis zur Datenlage:</b> {f.hinweis}
            </section>
          )}

          <section className="akte-sec">
            <h3>Sachstand</h3>
            {f.pts.length ? (
              <ul className="pts">
                {f.pts.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            ) : (
              <p className="muted small">Noch kein Sachstand eingetragen.</p>
            )}
          </section>

          <Schritte f={f} />
          <Ablauf f={f} />

          <section className="akte-sec">
            <h3>Kontakt & Verknüpfungen</h3>
            <div className="kv">
              <span>Letzte Kundenmail</span>
              <b>{fmtDate(f.lk) || "–"}</b>
              <span>Letzte Mail von FT</span>
              <b>{fmtDate(f.lf) || "–"}</b>
            </div>
            <div className="row wrap" style={{ marginTop: 10 }}>
              {f.mh_link ? (
                <a className="btn small" href={f.mh_link} target="_blank" rel="noopener noreferrer">
                  Projekt in Mein Handwerker ↗
                </a>
              ) : null}
              {f.pd_link ? (
                <a className="btn small" href={f.pd_link} target="_blank" rel="noopener noreferrer">
                  Deal in Pipedrive ↗
                </a>
              ) : null}
              {!f.mh_link && !f.pd_link && <span className="muted small">Keine Links hinterlegt{kann ? " – über „Bearbeiten“ ergänzen" : ""}.</span>}
            </div>
          </section>

          <Anhaenge f={f} />
          <Protokoll f={f} />

          <p className="muted small fussnote">
            Angelegt {fmtDateTime(f.created_at)} von {userName(f.created_by)} · zuletzt geändert {fmtDateTime(f.updated_at)} von {userName(f.updated_by)}
            {f.stand && <> · Stand {fmtDate(f.stand)}</>}
          </p>
        </div>
      </aside>
    </div>
  );
}

function Schritte({ f }: { f: Fall }) {
  const { rolle, run, userName } = useStore();
  const kann = darf.bearbeiten(rolle);
  const [neu, setNeu] = useState("");
  const [edit, setEdit] = useState<{ id: number; t: string } | null>(null);
  const offen = f.schritte.filter((s) => !s.done);
  const erledigt = f.schritte.filter((s) => s.done);
  const [zeigeErledigt, setZeigeErledigt] = useState(false);

  const toggle = (s: Schritt) => run(() => api<Fall>(`/schritte/${s.id}`, { method: "PATCH", body: { done: !s.done } }));

  const item = (s: Schritt) =>
    edit?.id === s.id ? (
      <form
        key={s.id}
        className="row"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await run(() => api<Fall>(`/schritte/${s.id}`, { method: "PATCH", body: { t: edit.t } }))) setEdit(null);
        }}
      >
        <input type="text" autoFocus value={edit.t} onChange={(e) => setEdit({ id: s.id, t: e.target.value })} />
        <button className="btn small primary" type="submit" disabled={!edit.t.trim()}>
          OK
        </button>
        <button className="btn small" type="button" onClick={() => setEdit(null)}>
          ✕
        </button>
      </form>
    ) : (
      <div key={s.id} className={"check-item" + (s.done ? " done" : "")}>
        <input type="checkbox" checked={!!s.done} onChange={() => toggle(s)} aria-label={s.done ? "Wieder öffnen" : "Abhaken"} />
        <div className="txt">
          {s.t}
          {s.done && s.done_by ? (
            <span className="wer">
              {" "}
              · {userName(s.done_by)}, {s.done_at ? fmtDateTime(s.done_at) : ""}
            </span>
          ) : null}
        </div>
        {kann && (
          <span className="item-actions">
            <button className="btn ghost small" onClick={() => setEdit({ id: s.id, t: s.t })} aria-label="Ändern">
              ✎
            </button>
            <button
              className="btn ghost small"
              onClick={() => confirm(`Schritt entfernen?\n\n${s.t}`) && run(() => api<Fall>(`/schritte/${s.id}`, { method: "DELETE" }))}
              aria-label="Entfernen"
            >
              🗑
            </button>
          </span>
        )}
      </div>
    );

  return (
    <section className="akte-sec">
      <h3>
        Nächste Schritte <span className="count">{offen.length}</span>
      </h3>
      {offen.map(item)}
      {!offen.length && <p className="muted small fehlt-hinweis">Kein offener Schritt.</p>}
      {kann && (
        <form
          className="row add-row"
          onSubmit={async (e) => {
            e.preventDefault();
            const t = neu.trim();
            if (!t) return;
            if (await run(() => api<Fall>(`/faelle/${encodeURIComponent(f.id)}/schritte`, { body: { t } }))) setNeu("");
          }}
        >
          <input type="text" value={neu} onChange={(e) => setNeu(e.target.value)} placeholder="Schritt ergänzen…" enterKeyHint="done" />
          <button className="btn primary small" type="submit" disabled={!neu.trim()}>
            +
          </button>
        </form>
      )}
      {erledigt.length > 0 && (
        <>
          <button className="btn ghost small" onClick={() => setZeigeErledigt(!zeigeErledigt)}>
            {zeigeErledigt ? "▾" : "▸"} {erledigt.length} erledigt
          </button>
          {zeigeErledigt && erledigt.map(item)}
        </>
      )}
    </section>
  );
}

function Ablauf({ f }: { f: Fall }) {
  const { run, userName, me, rolle } = useStore();
  const [d, setD] = useState(today());
  const [t, setT] = useState("");
  const [edit, setEdit] = useState<VerlaufEintrag | null>(null);
  const [alle, setAlle] = useState(false);
  const LIMIT = 8;
  const sichtbar = alle || f.verlauf.length <= LIMIT ? f.verlauf : f.verlauf.slice(-LIMIT);
  const darfAendern = (v: VerlaufEintrag) => darf.bearbeiten(rolle) || v.created_by === me;

  return (
    <section className="akte-sec">
      <h3>
        Ablauf <span className="count">{f.verlauf.length}</span>
      </h3>
      {f.verlauf.length > LIMIT && !alle && (
        <button className="btn ghost small" onClick={() => setAlle(true)}>
          ▸ {f.verlauf.length - LIMIT} ältere Einträge zeigen
        </button>
      )}
      <ol className="timeline">
        {sichtbar.map((v) =>
          edit?.id === v.id ? (
            <li key={v.id}>
              <form
                className="verlauf-form"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (await run(() => api<Fall>(`/verlauf/${v.id}`, { method: "PATCH", body: { d: edit.d, t: edit.t } }))) setEdit(null);
                }}
              >
                <input type="date" value={edit.d} onChange={(e) => setEdit({ ...edit, d: e.target.value })} required />
                <textarea value={edit.t} onChange={(e) => setEdit({ ...edit, t: e.target.value })} rows={3} />
                <div className="row">
                  <button className="btn small primary" type="submit" disabled={!edit.t.trim() || !edit.d}>
                    Speichern
                  </button>
                  <button className="btn small" type="button" onClick={() => setEdit(null)}>
                    Abbrechen
                  </button>
                  <div className="spacer" />
                  <button
                    className="btn small danger"
                    type="button"
                    onClick={async () => confirm("Eintrag löschen?") && (await run(() => api<Fall>(`/verlauf/${v.id}`, { method: "DELETE" }))) && setEdit(null)}
                  >
                    Löschen
                  </button>
                </div>
              </form>
            </li>
          ) : (
            <li key={v.id}>
              <div className="tl-date">
                {fmtDate(v.d)}
                {v.created_by && <span className="wer"> · {userName(v.created_by)}</span>}
                {darfAendern(v) && (
                  <button className="btn ghost tiny" onClick={() => setEdit(v)} aria-label="Eintrag ändern">
                    ✎
                  </button>
                )}
              </div>
              <div className="tl-text">{v.t}</div>
            </li>
          ),
        )}
      </ol>
      <form
        className="verlauf-form neu"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!t.trim()) return;
          if (await run(() => api<Fall>(`/faelle/${encodeURIComponent(f.id)}/verlauf`, { body: { d, t: t.trim() } }), "Eintrag gespeichert")) {
            setT("");
            setD(today());
          }
        }}
      >
        <div className="row">
          <input type="date" value={d} onChange={(e) => setD(e.target.value)} required style={{ maxWidth: 170 }} aria-label="Datum" />
          <span className="muted small">Neuer Eintrag</span>
        </div>
        <textarea value={t} onChange={(e) => setT(e.target.value)} rows={2} placeholder="Was ist passiert? (z. B. Kunde angerufen, Gutachten erhalten)" />
        <button className="btn primary small" type="submit" disabled={!t.trim() || !d}>
          Eintrag speichern
        </button>
      </form>
    </section>
  );
}

function Anhaenge({ f }: { f: Fall }) {
  const { rolle, run, userName, toast } = useStore();
  const kann = darf.bearbeiten(rolle);
  const [list, setList] = useState<Anhang[] | null>(null);
  const [busy, setBusy] = useState(false);
  const enc = encodeURIComponent(f.id);

  useEffect(() => {
    if (f.anhang_count === 0) setList([]);
    else api<Anhang[]>(`/faelle/${enc}/anhaenge`).then(setList, () => setList([]));
  }, [enc, f.anhang_count]);

  async function hochladen(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    try {
      let ok = 0;
      for (const file of Array.from(files)) {
        const blob = await verkleinern(file);
        const r = await run(() => upload<Anhang[]>(`/faelle/${enc}/anhaenge`, blob, file.name));
        if (r) {
          setList(r);
          ok++;
        }
      }
      if (ok) toast(ok === 1 ? "Hochgeladen" : `${ok} Dateien hochgeladen`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="akte-sec">
      <h3>
        Anhänge <span className="count">{f.anhang_count}</span>
      </h3>
      {list === null && <p className="muted small">Lade…</p>}
      <div className="anhaenge">
        {list?.map((a) => (
          <div key={a.id} className="anhang">
            <a href={`/api/anhaenge/${a.id}`} target="_blank" rel="noopener">
              {a.mime.startsWith("image/") ? <img src={`/api/anhaenge/${a.id}`} alt={a.name} loading="lazy" /> : <span className="pdf">PDF</span>}
            </a>
            <div className="anhang-info">
              <a href={`/api/anhaenge/${a.id}`} target="_blank" rel="noopener" className="anhang-name">
                {a.name}
              </a>
              <span className="muted">
                {Math.max(1, Math.round(a.size / 1024))} KB · {userName(a.user_id)}, {fmtDate(a.created_at)}
              </span>
            </div>
            {kann && (
              <button
                className="btn ghost small"
                aria-label="Anhang entfernen"
                onClick={async () => {
                  if (!confirm(`Anhang „${a.name}“ entfernen?`)) return;
                  const r = await run(() => api<Anhang[]>(`/anhaenge/${a.id}`, { method: "DELETE" }));
                  if (r) setList(r);
                }}
              >
                🗑
              </button>
            )}
          </div>
        ))}
      </div>
      {kann && (
        <div className="row wrap" style={{ marginTop: 8 }}>
          <label className={"btn small" + (busy ? " disabled" : "")}>
            📷 Foto
            <input type="file" accept="image/*" capture="environment" hidden disabled={busy} onChange={(e) => hochladen(e.target.files).then(() => (e.target.value = ""))} />
          </label>
          <label className={"btn small" + (busy ? " disabled" : "")}>
            📎 Datei / PDF
            <input type="file" accept="image/*,application/pdf" multiple hidden disabled={busy} onChange={(e) => hochladen(e.target.files).then(() => (e.target.value = ""))} />
          </label>
          {busy && <span className="muted small">Lade hoch…</span>}
        </div>
      )}
    </section>
  );
}

function Protokoll({ f }: { f: Fall }) {
  const { userName } = useStore();
  const [list, setList] = useState<Aenderung[] | null>(null);
  const [offen, setOffen] = useState(false);
  useEffect(() => {
    if (offen) api<Aenderung[]>(`/faelle/${encodeURIComponent(f.id)}/aenderungen`).then(setList, () => setList([]));
  }, [offen, f.id, f.updated_at]);
  return (
    <section className="akte-sec">
      <button className="btn ghost small" onClick={() => setOffen(!offen)}>
        {offen ? "▾" : "▸"} Änderungsprotokoll (wer hat wann was geändert)
      </button>
      {offen && (
        <ul className="protokoll">
          {list === null && <li className="muted">Lade…</li>}
          {list?.map((a) => (
            <li key={a.id}>
              <span className="muted">
                {fmtDateTime(a.at)} · {userName(a.user_id)}
              </span>
              <br />
              <b>{a.aktion}</b> {a.detail}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
