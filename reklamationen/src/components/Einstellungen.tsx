import { useEffect, useState } from "react";
import { ROLLEN, darf, rolleName } from "../../shared/types";
import type { Rolle, User } from "../../shared/types";
import { api } from "../api";
import { clearSaved, useStore } from "../store";
import { currentSubscription, disablePush, enablePush, pushSupported } from "../push";
import { download, fmtDateTime } from "../util";

export function Einstellungen() {
  const { rolle } = useStore();
  return (
    <main className="page narrow">
      <h1>Einstellungen</h1>
      <MeinKonto />
      <Installieren />
      {darf.verwalten(rolle) && (
        <>
          <Nutzer />
          <Import />
          <Export />
          <Schnittstelle />
        </>
      )}
    </main>
  );
}

function MeinKonto() {
  const { data, me, run, toast, userName, rolle } = useStore();
  const ich = data.users.find((u) => u.id === me);
  const [email, setEmail] = useState(ich?.email ?? "");
  const [push, setPush] = useState<boolean | null>(null);
  const [pw, setPw] = useState({ alt: "", neu: "" });

  useEffect(() => {
    currentSubscription().then((s) => setPush(!!s), () => setPush(false));
  }, []);

  return (
    <section className="card-sec">
      <h2>Mein Konto</h2>
      <p className="muted small">
        Angemeldet als <b>{userName(me)}</b> ({rolleName(rolle)}).
      </p>

      <h3>Erinnerungen</h3>
      <p className="muted small">Am Tag vor einem Termin und wenn eine Frist überfällig wird, kommt morgens um ca. 7 Uhr eine Nachricht – per Push auf freigeschaltete Geräte und per E-Mail, wenn eine Adresse eingetragen ist.</p>
      <label className="row check">
        <input type="checkbox" checked={!!ich?.erinnerungen} onChange={(e) => run(() => api("/me", { method: "PATCH", body: { erinnerungen: e.target.checked } }), "Gespeichert")} />
        Erinnerungen für mich einschalten
      </label>
      <div className="row wrap" style={{ marginTop: 10 }}>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="E-Mail-Adresse für Erinnerungen" style={{ maxWidth: 320 }} />
        <button className="btn small" disabled={email === (ich?.email ?? "")} onClick={() => run(() => api("/me", { method: "PATCH", body: { email } }), "E-Mail gespeichert")}>
          Speichern
        </button>
      </div>
      {!data.settings.mail_enabled && <p className="muted small">E-Mail-Versand ist noch nicht eingerichtet (siehe README, Abschnitt Resend). Push geht trotzdem.</p>}
      <div className="row wrap" style={{ marginTop: 10 }}>
        {push ? (
          <button className="btn small" onClick={() => run(async () => (await disablePush(), setPush(false)), "Benachrichtigungen auf diesem Gerät aus")}>
            🔕 Push auf diesem Gerät ausschalten
          </button>
        ) : (
          <button
            className="btn small"
            disabled={push === null}
            onClick={async () => {
              try {
                await enablePush();
                setPush(true);
                toast("Push auf diesem Gerät eingeschaltet");
              } catch (e) {
                toast((e as Error).message, true);
              }
            }}
          >
            🔔 Push auf diesem Gerät einschalten
          </button>
        )}
        <button
          className="btn small"
          onClick={async () => {
            const r = await run(() => api<{ push: number; mail: boolean; mailFehler?: string; morgen: number; ueberfaellig: number }>("/erinnerungen/test", { method: "POST" }));
            if (r) toast(`Test: ${r.morgen} Termin(e) morgen, ${r.ueberfaellig} überfällig · Push an ${r.push} Gerät(e) · ${r.mail ? "E-Mail verschickt" : r.mailFehler ?? "keine E-Mail"}`);
          }}
        >
          Test-Erinnerung an mich
        </button>
      </div>
      {!pushSupported() && <p className="muted small">Dieser Browser kann keine Push-Nachrichten. Am iPhone: App erst zum Home-Bildschirm hinzufügen und von dort öffnen.</p>}

      <h3>Passwort ändern</h3>
      <form
        className="row wrap"
        onSubmit={async (e) => {
          e.preventDefault();
          const r = await run(() => api("/me", { method: "PATCH", body: { passwort_alt: pw.alt, passwort: pw.neu } }));
          if (r) {
            alert("Passwort geändert. Bitte neu anmelden.");
            clearSaved();
            location.reload();
          }
        }}
      >
        <input type="password" autoComplete="current-password" placeholder="Bisheriges Passwort" value={pw.alt} onChange={(e) => setPw({ ...pw, alt: e.target.value })} style={{ maxWidth: 220 }} />
        <input type="password" autoComplete="new-password" placeholder="Neues Passwort (mind. 8 Zeichen)" value={pw.neu} onChange={(e) => setPw({ ...pw, neu: e.target.value })} style={{ maxWidth: 260 }} />
        <button className="btn small" type="submit" disabled={!pw.alt || pw.neu.length < 8}>
          Ändern
        </button>
      </form>

      <div style={{ marginTop: 18 }}>
        <button
          className="btn small danger"
          onClick={async () => {
            if (!confirm("Abmelden? Der auf diesem Gerät gespeicherte Stand wird gelöscht.")) return;
            await disablePush().catch(() => {});
            await api("/logout", { method: "POST" }).catch(() => {});
            clearSaved();
            location.href = "/";
          }}
        >
          Abmelden
        </button>
      </div>
    </section>
  );
}

function Installieren() {
  return (
    <section className="card-sec">
      <h2>Als App auf dem Handy</h2>
      <ul className="small">
        <li>
          <b>iPhone:</b> Adresse in Safari öffnen → Teilen → <i>Zum Home-Bildschirm</i>.
        </li>
        <li>
          <b>Android:</b> Adresse in Chrome öffnen → Menü ⋮ → <i>App installieren</i>.
        </li>
        <li>
          <b>Desktop (Chrome/Edge):</b> in der Adressleiste auf das Installieren-Symbol klicken.
        </li>
      </ul>
    </section>
  );
}

function Nutzer() {
  const { data, run, me } = useStore();
  const [neu, setNeu] = useState({ id: "", name: "", rolle: "montage" as Rolle, email: "", passwort: "" });

  const patch = (u: User, body: Record<string, unknown>, msg = "Gespeichert") => run(() => api(`/users/${u.id}`, { method: "PATCH", body }), msg);

  return (
    <section className="card-sec">
      <h2>Nutzer und Rollen</h2>
      <ul className="small muted">
        {ROLLEN.map((r) => (
          <li key={r.id}>
            <b>{r.name}:</b> {r.hint}
          </li>
        ))}
      </ul>
      <div className="nutzer-liste">
        {data.users.map((u) => (
          <div key={u.id} className={"nutzer" + (u.aktiv ? "" : " inaktiv")}>
            <div className="grow">
              <b>{u.name}</b> <span className="muted small">({u.id})</span>
              <div className="muted small">
                {u.email || "keine E-Mail"} · {u.hat_passwort ? "Passwort in der App gesetzt" : "Passwort aus Cloudflare"}
                {!u.aktiv && " · gesperrt"}
              </div>
            </div>
            <select value={u.rolle} disabled={u.id === me} onChange={(e) => patch(u, { rolle: e.target.value })} aria-label={`Rolle von ${u.name}`}>
              {ROLLEN.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
            {u.id !== me && (
              <button className="btn small" onClick={() => patch(u, { aktiv: !u.aktiv }, u.aktiv ? "Gesperrt" : "Freigeschaltet")}>
                {u.aktiv ? "Sperren" : "Freischalten"}
              </button>
            )}
            <button
              className="btn small"
              onClick={() => {
                const p = prompt(`Neues Passwort für ${u.name} (mind. 8 Zeichen):`);
                if (p) patch(u, { passwort: p }, "Passwort gesetzt – bitte persönlich weitergeben");
              }}
            >
              Passwort
            </button>
          </div>
        ))}
      </div>

      <h3>Neuen Nutzer anlegen</h3>
      <form
        className="fields"
        onSubmit={async (e) => {
          e.preventDefault();
          const body = { ...neu, id: neu.id || vorschlagId(neu.name) };
          const r = await run(() => api("/users", { body }), `${neu.name} angelegt`);
          if (r) setNeu({ id: "", name: "", rolle: "montage", email: "", passwort: "" });
        }}
      >
        <label>
          <span className="field">Name</span>
          <input type="text" value={neu.name} onChange={(e) => setNeu({ ...neu, name: e.target.value })} placeholder="z. B. Jan" required />
        </label>
        <label>
          <span className="field">Anmeldename</span>
          <input
            type="text"
            value={neu.id}
            onChange={(e) => setNeu({ ...neu, id: e.target.value.toLowerCase() })}
            placeholder={neu.name ? vorschlagId(neu.name) : "z. B. jan"}
            pattern="[a-z][a-z0-9_\-]{1,30}"
            title="kleine Buchstaben, Ziffern, - und _ (leer = Vorschlag)"
          />
        </label>
        <label>
          <span className="field">Rolle</span>
          <select value={neu.rolle} onChange={(e) => setNeu({ ...neu, rolle: e.target.value as Rolle })}>
            {ROLLEN.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="field">E-Mail (optional)</span>
          <input type="email" value={neu.email} onChange={(e) => setNeu({ ...neu, email: e.target.value })} />
        </label>
        <label className="full">
          <span className="field">Erstes Passwort (mind. 8 Zeichen, persönlich weitergeben)</span>
          <input type="text" value={neu.passwort} onChange={(e) => setNeu({ ...neu, passwort: e.target.value })} autoComplete="off" minLength={8} required />
        </label>
        <div className="full">
          <button className="btn primary" type="submit">
            Nutzer anlegen
          </button>
        </div>
      </form>
    </section>
  );
}

/** Anmeldename aus dem Namen: „Jürgen M.“ → juergenm */
const vorschlagId = (name: string) =>
  name.toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss").replace(/[^a-z0-9]/g, "").slice(0, 30);

interface Bericht {
  gelesen: number;
  neu: number;
  aktualisiert: number;
  unveraendert: number;
  fehler: { nr: number; id?: string; grund: string }[];
  unbekannte_felder: string[];
}

function Import() {
  const { run } = useStore();
  const [modus, setModus] = useState<"ergaenzen" | "ersetzen">("ergaenzen");
  const [bericht, setBericht] = useState<Bericht | null>(null);
  const [busy, setBusy] = useState(false);

  async function lesen(file: File | undefined) {
    if (!file) return;
    let json: unknown;
    try {
      json = JSON.parse(await file.text());
    } catch {
      alert("Die Datei ist kein gültiges JSON.");
      return;
    }
    setBusy(true);
    setBericht(null);
    const r = await run(() => api<Bericht>(`/import?modus=${modus}`, { body: json }), "Import abgeschlossen");
    setBusy(false);
    if (r) setBericht(r);
  }

  return (
    <section className="card-sec">
      <h2>Import</h2>
      <p className="small muted">
        JSON-Datei mit Fällen im Format des bisherigen Tools einlesen (z. B. <code>reklamationen-faelle.json</code>). Fälle werden über die <code>id</code> erkannt; ein erneuter Import legt nichts doppelt an.
      </p>
      <label className="row check">
        <input type="radio" checked={modus === "ergaenzen"} onChange={() => setModus("ergaenzen")} />
        Ergänzen (empfohlen): neue Verlaufseinträge und Schritte kommen dazu, nichts wird gelöscht
      </label>
      <label className="row check">
        <input type="radio" checked={modus === "ersetzen"} onChange={() => setModus("ersetzen")} />
        Ersetzen: Schritte und Verlauf der enthaltenen Fälle genau wie in der Datei
      </label>
      <label className={"btn" + (busy ? " disabled" : "")} style={{ marginTop: 10 }}>
        {busy ? "Importiere…" : "JSON-Datei wählen…"}
        <input type="file" accept="application/json,.json" hidden disabled={busy} onChange={(e) => lesen(e.target.files?.[0]).then(() => (e.target.value = ""))} />
      </label>
      {bericht && (
        <div className="bericht">
          <b>
            {bericht.gelesen} gelesen · {bericht.neu} neu · {bericht.aktualisiert} aktualisiert · {bericht.unveraendert} unverändert · {bericht.fehler.length} Fehler
          </b>
          {bericht.fehler.length > 0 && (
            <ul>
              {bericht.fehler.map((f) => (
                <li key={f.nr}>
                  Eintrag {f.nr}
                  {f.id ? ` (${f.id})` : ""}: {f.grund}
                </li>
              ))}
            </ul>
          )}
          {bericht.unbekannte_felder.length > 0 && <p className="muted">Nicht übernommene Felder: {bericht.unbekannte_felder.join(", ")}</p>}
        </div>
      )}
    </section>
  );
}

function Export() {
  const { toast } = useStore();
  const [backups, setBackups] = useState<{ key: string; size: number; uploaded: string }[] | null>(null);

  async function holen(path: string, name: string) {
    try {
      const res = await fetch("/api" + path, { credentials: "same-origin" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `Fehler ${res.status}`);
      download(name, await res.blob());
    } catch (e) {
      toast((e as Error).message, true);
    }
  }

  return (
    <section className="card-sec">
      <h2>Export und Sicherung</h2>
      <p className="small muted">Der Export enthält alle Fälle mit Schritten, Verlauf und Änderungsprotokoll im selben Format wie der Import. Er enthält Kundennamen und Streitstände – nur sicher ablegen. Jede Nacht wird automatisch eine Sicherung angelegt (30 Tage aufbewahrt).</p>
      <div className="row wrap">
        <button className="btn" onClick={() => holen("/export", `reklamationen-export-${new Date().toISOString().slice(0, 10)}.json`)}>
          ⬇ Alles exportieren (JSON)
        </button>
        <button className="btn" onClick={async () => setBackups(await api("/backups"))}>
          Automatische Sicherungen anzeigen
        </button>
      </div>
      {backups && (
        <ul className="small">
          {!backups.length && <li className="muted">Noch keine Sicherung vorhanden (die erste entsteht heute Nacht).</li>}
          {backups.map((b) => (
            <li key={b.key}>
              <button className="btn ghost small" onClick={() => holen(`/backups/download?key=${encodeURIComponent(b.key)}`, b.key.split("/").pop()!)}>
                {b.key.split("/").pop()}
              </button>{" "}
              <span className="muted">
                {Math.round(b.size / 1024)} KB · {fmtDateTime(b.uploaded)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Schnittstelle() {
  const { data } = useStore();
  const url = `${location.origin}/api/import`;
  return (
    <section className="card-sec">
      <h2>Import-Schnittstelle für Claude</h2>
      <p className="small muted">
        Darüber kann Claude neue Sachstände aus dem Postfach nachliefern. Gleiche Feldnamen wie die Export-Datei; nur mitgelieferte Felder werden geändert, Verlaufseinträge und Schritte werden ergänzt. Jede Nachlieferung steht im Änderungsprotokoll als „Import“.
      </p>
      <p className="small">
        Status: {data.settings.import_token_set ? <b className="ok-text">Schlüssel ist hinterlegt</b> : <b className="warn-text">kein Schlüssel – in Cloudflare das Secret IMPORT_TOKEN setzen</b>}
      </p>
      <pre className="code">{`POST ${url}
Authorization: Bearer <IMPORT_TOKEN>
Content-Type: application/json

[{ "id": "…", "stufe": "crit", "lk": "2026-10-09",
   "verlauf": [{ "d": "2026-10-09", "t": "Kunde schickt Fotos" }],
   "schritte": [{ "t": "Fotos sichten", "done": false }] }]`}</pre>
    </section>
  );
}
