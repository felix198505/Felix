# FT Reklamationen

Reklamationen, Fristen und Streitfälle für FT Work & Design. Die App ist eigenständig und läuft ohne Claude und ohne einen bestimmten Rechner. Sie funktioniert auf Handy und Desktop und lässt sich als App auf den Startbildschirm legen.

**Technik** (wie beim Ideen-Board):
- Cloudflare Workers für App und Server
- D1 als Datenbank
- R2 für Anhänge und Sicherungen
- React-Oberfläche
- Login mit Passwort je Person

---

## Laufende Kosten

| Posten | Kosten |
|---|---|
| Cloudflare Workers, D1, R2, Cron | 0 € (Gratis-Kontingent reicht) |
| Erinnerungs-Mails über Resend | 0 € (bis 3.000 Mails pro Monat) |

---

## Veröffentlichen (einmalig)

Cloudflare holt den Code aus GitHub und veröffentlicht bei jeder Änderung neu. Das Ideen-Board bleibt davon unberührt, denn die App ist ein eigener Worker mit eigener Datenbank.

### Schritt 1: App bei Cloudflare anlegen

1. https://dash.cloudflare.com → **Workers & Pages** → **Erstellen** → **Repository importieren**.
2. Repository **felix198505/Felix** auswählen.
3. Einstellungen:
   - **Projektname:** `reklamationen` (muss mit `name` in `wrangler.jsonc` übereinstimmen)
   - **Produktions-Branch:** der Branch mit dem Reklamationstool (z. B. `main`, sobald zusammengeführt)
   - **Root-Verzeichnis (Erweitert):** `reklamationen`
   - **Build-Befehl:** leer lassen
   - **Deploy-Befehl:** `npm run deploy`
4. **Speichern und bereitstellen.** Beim ersten Mal werden Datenbank `reklamationen` und Dateispeicher `reklamationen-dateien` automatisch angelegt.

> Bricht der Build mit einem Berechtigungsfehler ab: Unter **Mein Profil → API-Token** ein Token aus der Vorlage „Cloudflare Workers bearbeiten“ erstellen und die Rechte **D1: Bearbeiten** und **Workers R2 Storage: Bearbeiten** ergänzen. Dann im Worker unter **Einstellungen → Build → Variablen** als `CLOUDFLARE_API_TOKEN` eintragen.

### Schritt 2: Passwörter und Schlüssel hinterlegen

**Workers & Pages → reklamationen → Einstellungen → Variablen und Geheimnisse → Hinzufügen**, jeweils Typ **Geheimnis (Secret)**:

| Name | Wert |
|---|---|
| `PASSWORD_FELIX` | Passwort für Felix |
| `PASSWORD_KERSTIN` | Passwort für Kerstin |
| `PASSWORD_TIM` | Passwort für Tim |
| `SESSION_SECRET` | lange Zufallszeichenkette (empfohlen) |
| `IMPORT_TOKEN` | lange Zufallszeichenkette, nur für die Import-Schnittstelle (Claude) |

Optional:

| Name | Wert |
|---|---|
| `RESEND_API_KEY` + `MAIL_FROM` | E-Mail-Erinnerungen (siehe unten) |
| `APP_URL` | feste Adresse für Links in Mails, z. B. `https://reklamationen.ft-workanddesign.de` |

Statt Klartext geht auch ein Hash: `npm run hash-password -- "Passwort"` und dann als `PASSWORD_HASH_FELIX` hinterlegen.

### Schritt 3: Fälle importieren

1. App-Adresse öffnen (steht im Dashboard, z. B. `https://reklamationen.<name>.workers.dev`) und als Felix anmelden.
2. ⚙ → **Import** → **Ergänzen** → `reklamationen-faelle.json` wählen.
3. Der Bericht zeigt, wie viele Fälle gelesen und angelegt wurden und welche Fehler es gab. Ein zweiter Import legt nichts doppelt an.

**Vorher lokal prüfen (empfohlen):**

```bash
npm run pruefe-import -- /pfad/zu/reklamationen-faelle.json "Fallname"
```

Die Prüfung importiert die Datei in eine frische Test-Instanz auf dem eigenen Rechner. Sie vergleicht Gesamtzahl, offene, kritische und erledigte Fälle mit der Datei und prüft bei jedem Fall, ob Verlauf und Schritte vollständig sind. Für den genannten Fall zeigt sie außerdem eine Stichprobe. Die Datei wird dabei weder kopiert noch ins Repo übernommen. `.gitignore` schließt `*faelle*.json` zusätzlich aus.

### Schritt 4: Auf dem Handy installieren

- **iPhone:** Adresse in Safari öffnen → Teilen → **Zum Home-Bildschirm**.
- **Android:** Adresse in Chrome öffnen → Menü ⋮ → **App installieren**.

Danach unter ⚙ → **Push auf diesem Gerät einschalten**. Am iPhone geht das nur aus der installierten App heraus.

---

## Rollen und Nutzer

| Rolle | Darf |
|---|---|
| **Inhaber** | alles: Fälle löschen, Nutzer verwalten, Import, Export, Sicherungen |
| **Büro** | Fälle anlegen, bearbeiten, erledigt setzen und wieder öffnen; Schritte, Verlauf und Anhänge; **nicht** löschen |
| **Montage** | lesen, Schritte abhaken, Verlaufseinträge schreiben und eigene Einträge korrigieren |

- Zum Start ist Felix Inhaber, Kerstin und Tim sind Büro. Die Rolle ändert Felix unter ⚙ → **Nutzer und Rollen**.
- **Montageleiter und Monteure** legt Felix direkt in der App an (⚙ → **Neuen Nutzer anlegen**). Dafür ist keine Code-Änderung nötig. Das erste Passwort gibt Felix persönlich weiter, ändern kann es jeder selbst unter ⚙.
- **Sperren** wirkt sofort: Die betroffene Person wird beim nächsten Abruf abgemeldet.
- **Passwort-Vorrang:** Ein in der App gesetztes Passwort gilt vor dem Cloudflare-Secret.
- **Schutz vor Raten:** Nach 8 Fehlversuchen innerhalb von 15 Minuten ist die Anmeldung gesperrt.
- **Dauer:** Eine Anmeldung gilt 30 Tage.

---

## Funktionen

- **Kennzahlen:** offen, kritisch, Termin überfällig, Termine in 7 Tagen und ohne nächsten Schritt. Ein Klick auf eine Kachel filtert die Liste.
- **Nächste Termine und Fristen:** Leiste mit überfälligen Terminen zuerst (rot), danach die nächsten.
- **Suche** über alle Textfelder: Name, Angaben, Vorgang, Sachstand, Schritte, Verlauf, Hinweis und Status.
- **Filter:** nach Gruppe, Dringlichkeit und offen/erledigt.
- **Sortierung:** nach Dringlichkeit, Termin, letzter Bearbeitung oder Name.
- **Fallakte als Seitenleiste:**
  - Sachstand
  - nächste Schritte zum Abhaken und Ergänzen
  - Ablauf als Zeitleiste mit neuem Eintrag
  - Termin
  - Hinweis zur Datenlage
  - Links zu Mein Handwerker und Pipedrive
  - Anhänge
  - Änderungsprotokoll
- **Fall bearbeiten:** anlegen, bearbeiten, erledigt setzen, wieder öffnen und löschen. Löschen geht mit Rückfrage und nur für Inhaber. Eine Kopie der Texte bleibt im Protokoll.
- **Änderungsprotokoll:** Jede Änderung wird mit Name und Zeit festgehalten. Bei Schritten und Verlaufseinträgen steht zusätzlich dabei, wer sie angelegt bzw. abgehakt hat.
- **Live-Abgleich:** Änderungen anderer erscheinen nach spätestens 5 Sekunden ohne Neuladen.
- **Anhänge:** Fotos, die direkt mit der Handykamera aufgenommen werden können und automatisch verkleinert werden, und PDF, z. B. Anwaltsschreiben. Mit R2 sind Dateien bis 20 MB möglich, ohne R2 bis 1,8 MB.
- **Erinnerungen:** täglich um ca. 7 Uhr per Push und E-Mail. Sie kommen am Tag vor einem Termin und einmalig, wenn eine Frist überfällig wird. Jeder schaltet sie für sich unter ⚙ ein oder aus; für neue Montage-Nutzer sind sie anfangs aus. „Test-Erinnerung an mich“ zeigt die aktuelle Lage.
- **Ohne Netz:** Die App zeigt den zuletzt geladenen Stand (gelbe Leiste). Ändern geht erst wieder mit Netz. Beim Abmelden wird der Stand auf dem Gerät gelöscht.

---

## Import-Schnittstelle (für Claude)

Über diese Schnittstelle kann Claude neue Sachstände aus dem Postfach nachliefern. Die Feldnamen sind dieselben wie in der Export-Datei.

```
POST https://<app-adresse>/api/import
Authorization: Bearer <IMPORT_TOKEN>
Content-Type: application/json

[
  { "id": "beispiel-123", "stufe": "crit", "lk": "2026-10-09",
    "verlauf": [{ "d": "2026-10-09", "t": "Anwalt kündigt Klage an" }],
    "schritte": [{ "t": "Stellungnahme vorbereiten", "done": false }] }
]
```

- Die Fälle werden über die `id` erkannt. Unbekannte `id` mit `name` legen einen neuen Fall an.
- Nur mitgelieferte Felder werden geändert.
- **Verlauf:** Ein Eintrag kommt dazu, wenn es Datum und Text in dem Fall noch nicht gibt.
- **Schritte:** werden über den Text erkannt. `done` setzt den Haken.
- **`?modus=ersetzen`:** Schritte und Verlauf der gelieferten Fälle werden genau durch die Liste ersetzt.
- **Datumsformate:** `JJJJ-MM-TT` und `TT.MM.JJJJ`. `erledigt` versteht `true` bzw. `false`, „Ja“ bzw. „Nein“ und `1` bzw. `0`.
- **Antwort:** ein Bericht mit den Feldern `neu`, `aktualisiert`, `unveraendert`, `fehler` und `unbekannte_felder`.
- **Protokoll:** Jede Nachlieferung steht im Änderungsprotokoll des Falls als „Import“.
- **Zugriff:** Der Schlüssel öffnet nur diesen einen Endpunkt, Daten lesen kann man damit nicht.

---

## Datenschutz

- Ohne Anmeldung liefert der Server keine Daten. Es gibt keine offene Registrierung, und Suchmaschinen sind ausgesperrt (`noindex`, `robots.txt`).
- Im Repository stehen nur Programmcode und **erfundene** Testfälle. Echte Falldaten liegen ausschließlich in der Cloudflare-Datenbank.
- Server-Logs enthalten nur Fehlermeldungen, keine Falldaten.
- **Export** und Sicherungen gibt es nur für angemeldete Inhaber.
- **Montage-Nutzer** sehen keine E-Mail-Adressen der Kollegen.
- Zusätzlich lässt sich **Cloudflare Access** davorschalten: Workers & Pages → reklamationen → Einstellungen → Domains & Routen. Dann ist die Adresse nur nach E-Mail-Bestätigung überhaupt erreichbar.

---

## Backup und Wiederherstellung

1. **Automatisch jede Nacht** (02:23 Uhr UTC) wird der komplette Bestand als JSON in R2 gesichert und 30 Tage aufbewahrt. Abrufbar unter ⚙ → **Automatische Sicherungen anzeigen**.
2. **Von Hand:** ⚙ → **Alles exportieren (JSON)**. Die Datei hat dasselbe Format wie der Import. Zurückspielen geht über ⚙ → **Import** → **Ersetzen**.
3. **Zeitreise der Datenbank** (letzte 7 Tage):
   ```bash
   npx wrangler d1 time-travel restore reklamationen --timestamp "2026-10-01T08:00:00Z"
   ```

---

## E-Mail-Erinnerungen einrichten (Resend)

1. Bei https://resend.com registrieren und die Domain `ft-workanddesign.de` verifizieren. Ein bereits für das Ideen-Board angelegtes Konto lässt sich weiterverwenden.
2. API-Key mit „Sending access“ erzeugen.
3. In Cloudflare hinterlegen:
   - `RESEND_API_KEY` (Geheimnis)
   - `MAIL_FROM` (Text), z. B. `FT Reklamationen <reklamationen@ft-workanddesign.de>`
4. In der App trägt jede Person unter ⚙ ihre E-Mail-Adresse ein und prüft sie mit „Test-Erinnerung an mich“.

---

## Lokal starten und testen

```bash
cd reklamationen
npm install
cp .dev.vars.example .dev.vars        # lokales Passwort für alle: test
npm run db:migrate:local
npm run dev                           # http://localhost:5173
npm test                              # automatische Tests (laufen auch vor jeder Veröffentlichung)
```

Die Tests prüfen:
- Anmeldung und Rollen
- Import, Nachlieferung und Fehlerbericht
- Kennzahlen
- Bearbeiten und Protokoll
- Rechte der Montage
- Live-Abgleich
- Anhänge
- Export mit erneutem Import
- Sicherungen
- Erinnerungen

Schlägt ein Test fehl, bleibt die bisherige Version online.

## Aufbau des Codes

```
reklamationen/
  shared/types.ts        Datenmodell, Rollen, Kennzahlen, Sortierung
  worker/                Server (Cloudflare Worker)
    index.ts             Einstieg, Zeitplan, Sicherungen
    auth.ts              Login, Sitzungen, Rollenprüfung, Import-Schlüssel
    api.ts               Fälle, Schritte, Verlauf, Nutzer, Import/Export
    importer.ts          Einlesen im Format des bisherigen Tools
    anhaenge.ts          Fotos und PDF
    erinnerungen.ts      tägliche Erinnerung (Push + Mail)
    push.ts              Push-Benachrichtigungen
    backup.ts            Export und nächtliche Sicherung
  src/                   Oberfläche (React)
  migrations/            Datenbank-Schema (faelle, fall_schritte, fall_verlauf, aenderungen, …)
  scripts/               Veröffentlichung, Passwort-Hash, Import-Prüfung
  test/                  automatische Tests mit erfundenen Fällen
```
