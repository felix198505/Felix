# Ideen-Board

Ideen- und Brainstorming-Board für Felix, Tim und Kerstin. Es ist ein Kanban-Board mit automatischer KI-Analyse, läuft auf Handy und Desktop und lässt sich als App auf den Startbildschirm legen.

**Technik:** Cloudflare Workers (App + Server), D1 (Datenbank), R2 (Backups), Queues (KI-Warteschlange), React-Oberfläche, Anthropic API (Claude) für die KI-Analyse.

---

## Laufende Kosten

| Posten | Kosten |
|---|---|
| Cloudflare Workers, D1, R2, Queues, Cron | 0 € (Gratis-Kontingent reicht bei zwei Nutzern) |
| KI pro Analyse (Claude Opus 5.5, mit Websuche) | ca. 0,07–0,20 € |
| KI pro Analyse (Claude Sonnet 5.5) | ca. 0,04–0,10 € |
| KI-Wochenrückblick / Transkript-Import | ca. 0,05–0,20 € je Lauf |
| Wochen-Mail über Resend | 0 € (bis 3.000 Mails pro Monat) |

Die Monatsgrenze für KI-Kosten (Standard 10 €) stellt ihr in der App unter ⚙ Einstellungen ein. Wird sie erreicht, werden Ideen trotzdem gespeichert. Die Analyse wartet dann bis zum nächsten Monat oder bis ihr die Grenze anhebt.

---

## Veröffentlichen (einmalig)

Die einfachste Variante: Cloudflare holt den Code direkt aus GitHub und veröffentlicht bei jeder Änderung automatisch neu. Auf deinem PC muss dafür nichts installiert sein.

### Schritt 1: Anthropic-API-Schlüssel besorgen

1. Auf https://console.anthropic.com anmelden bzw. registrieren. Das ist getrennt vom Claude-Abo.
2. Unter **Billing** Guthaben aufladen, z. B. 10 $. Empfehlung: unter **Limits** zusätzlich ein Monatslimit setzen.
3. Unter **API Keys** auf **Create Key** klicken und als Namen „Ideen-Board“ eingeben.
4. Den Schlüssel (`sk-ant-…`) kopieren und sicher zwischenspeichern. Er wird nur einmal angezeigt.

### Schritt 2: App bei Cloudflare anlegen

1. Auf https://dash.cloudflare.com anmelden.
2. Links **Workers & Pages** → **Erstellen** → **Repository importieren** wählen.
3. GitHub verbinden und das Repository **felix198505/Felix** auswählen.
4. Einstellungen:
   - **Projektname:** `felix` (muss mit `name` in `wrangler.jsonc` übereinstimmen)
   - **Produktions-Branch:** der Branch mit dem Ideen-Board (z. B. `main`, sobald zusammengeführt)
   - **Root-Verzeichnis (Erweitert):** `ideen-board`
   - **Build-Befehl:** leer lassen
   - **Deploy-Befehl:** `npm run deploy`
5. Auf **Speichern und bereitstellen** klicken. Beim ersten Mal werden Datenbank, Backup-Speicher und KI-Warteschlange automatisch angelegt. Das dauert 1–3 Minuten.

> Falls der Build mit einem Berechtigungsfehler abbricht: Unter **Mein Profil → API-Token** ein Token aus der Vorlage „Cloudflare Workers bearbeiten“ erstellen und die Rechte **D1: Bearbeiten**, **Workers R2 Storage: Bearbeiten** und **Queues: Bearbeiten** ergänzen. Dann im Worker unter **Einstellungen → Build → Variablen** als `CLOUDFLARE_API_TOKEN` eintragen und den Build neu starten.

### Schritt 3: Passwörter und API-Schlüssel hinterlegen

Im Cloudflare-Dashboard: **Workers & Pages** → **felix** → **Einstellungen** → **Variablen und Geheimnisse** → **Hinzufügen**. Für jeden Eintrag den Typ **Geheimnis (Secret)** wählen:

| Name | Wert |
|---|---|
| `PASSWORD_FELIX` | Passwort für Felix |
| `PASSWORD_TIM` | Passwort für Tim |
| `PASSWORD_KERSTIN` | Passwort für Kerstin |
| `ANTHROPIC_API_KEY` | der Schlüssel aus Schritt 1 |

Optional:

| Name | Wert |
|---|---|
| `SESSION_SECRET` | beliebige lange Zufallszeichenkette. Ohne diesen Eintrag wird der Schlüssel aus den Passwörtern abgeleitet. |
| `AI_MODEL` | z. B. `claude-sonnet-5-5` für günstigere Analysen. Standard ist `claude-opus-5-5`. |

Speichern. Die Werte gelten sofort und stehen nirgends im Code.

### Schritt 4: Loslegen

1. Die Adresse steht im Dashboard beim Worker, z. B. `https://felix.<dein-name>.workers.dev`.
2. Anmelden.
3. ⚙ Einstellungen → **Beispielkarten anlegen**. Die KI analysiert die 5 Karten innerhalb von 1–2 Minuten.
4. **Auf dem Handy als App installieren:**
   - iPhone: Adresse in Safari öffnen → Teilen → **Zum Home-Bildschirm**.
   - Android: Adresse in Chrome öffnen → Menü ⋮ → **App installieren**.

**Eigene Adresse, z. B. `ideen.ft-workanddesign.de`:** Worker → **Einstellungen → Domains & Routen** → **Hinzufügen** → **Benutzerdefinierte Domain**. Das geht, wenn die Domain bei Cloudflare liegt.

### Alternative: vom eigenen PC veröffentlichen

Voraussetzung ist Node.js 20 oder neuer.

```bash
cd ideen-board
npm install
npx wrangler login          # öffnet den Browser zur Cloudflare-Anmeldung
npm run deploy              # legt alles an und veröffentlicht
npx wrangler secret put PASSWORD_FELIX
npx wrangler secret put PASSWORD_TIM
npx wrangler secret put ANTHROPIC_API_KEY
```

---

## Lokal starten (zum Entwickeln)

```bash
cd ideen-board
npm install
cp .dev.vars.example .dev.vars        # lokales Passwort für beide: test
npm run db:migrate:local
npm run dev                           # http://localhost:5173
```

Für die KI lokal `ANTHROPIC_API_KEY=…` in `.dev.vars` eintragen. Den Zeitplan (Nachholen ausstehender Analysen) löst `npm run cron:test` von Hand aus.

---

## Automatische Tests

`npm test` startet den Server lokal mit frischer Datenbank und einer nachgebauten KI. Es entstehen keine Kosten, und es werden keine Konten gebraucht. Geprüft werden:
- Anmeldung
- KI-Analyse samt Modellwahl, Quellenprüfung, Feedback und Kostengrenze
- Abstimmung
- Verschieben, Zusammenführen und Papierkorb
- Export und Zurückspielen
- Brainstorming, Import und Rückblick

Die Tests laufen automatisch vor jeder Veröffentlichung (`npm run deploy`, also auch bei jedem Push über Cloudflare). Schlägt ein Test fehl, bleibt die bisherige Version online. Nur im Notfall lassen sie sich mit der Build-Variable `SKIP_TESTS=1` überspringen.

## Nutzer verwalten

- **Passwort ändern:** Im Cloudflare-Dashboard unter Variablen und Geheimnisse `PASSWORD_FELIX` bzw. `PASSWORD_TIM` bearbeiten. Alle bestehenden Anmeldungen dieses Nutzers werden dadurch ungültig.
- **Passwort lieber als Hash speichern:** Mit `npm run hash-password -- "NeuesPasswort"` einen Hash erzeugen und als `PASSWORD_HASH_FELIX` hinterlegen. Ein Hash hat Vorrang vor dem Klartext-Secret.
- **Nutzer:** Felix, Tim und Kerstin, alle mit gleichen Rechten. In der Besprechung stimmen alle ab; die Mehrheit entscheidet (bei drei Personen reichen zwei gleiche Stimmen).
- **Weiteren Nutzer hinzufügen:** In `shared/types.ts` die Liste `USERS` ergänzen. Dazu eine neue Datei in `migrations/` anlegen, z. B. `0004_nutzer.sql` mit `INSERT INTO users (id, name) VALUES ('anna', 'Anna');`. Danach das Secret `PASSWORD_ANNA` setzen und neu veröffentlichen (Vorbild: `migrations/0004_kerstin.sql`).
- Eine offene Registrierung gibt es nicht. Ohne Anmeldung liefert der Server keine Daten. Nach 8 Fehlversuchen innerhalb von 15 Minuten wird die Anmeldung gesperrt.
- Eine Anmeldung bleibt 30 Tage gültig. Abmelden geht oben rechts.

---

## Backup und Wiederherstellung

Es gibt vier Sicherungsebenen:

1. **Automatisch jede Nacht** (02:17 Uhr UTC): Der komplette Datenbestand wird als JSON in R2 gespeichert und 30 Tage aufbewahrt. Ist R2 im Konto nicht aktiviert, landet die Sicherung in der Datenbank selbst. Liste und Download: ⚙ Einstellungen → „Automatische Sicherungen anzeigen“.
2. **Von Hand:** ⚙ Einstellungen → **Alles exportieren (JSON)**. Die Datei auf dem PC oder in der Cloud ablegen. **CSV** öffnet sich in Excel, **PDF / Drucken** liefert eine druckfertige Liste.
3. **Sicherung zurückspielen:** ⚙ Einstellungen → Export & Datensicherung → „⟲ Sicherung zurückspielen…“ → JSON-Datei wählen (Export-Datei oder heruntergeladene automatische Sicherung) → `WIEDERHERSTELLEN` eintippen. Alle Daten werden durch den Stand der Datei ersetzt, inklusive Fotos. Vorher wird automatisch eine Sicherung des aktuellen Stands angelegt (`backup-vor-wiederherstellung-….json`). Damit lässt sich auch das Zurückspielen wieder rückgängig machen.
4. **Zeitreise der Datenbank (Cloudflare D1):** stellt den Stand zu einem beliebigen Zeitpunkt der letzten 7 Tage wieder her (30 Tage im bezahlten Workers-Tarif).

   ```bash
   npx wrangler d1 time-travel info ideen-board --timestamp "2026-10-01T08:00:00Z"
   npx wrangler d1 time-travel restore ideen-board --timestamp "2026-10-01T08:00:00Z"
   ```

---

## Funktionen

- **Spalten:** Eingang, Ausarbeiten, Entscheiden, Umsetzen, Erledigt, Parkplatz, Verworfen (Verwerfen nur mit Grund). Drag & Drop am Handy: Karte kurz gedrückt halten, dann ziehen. Alternativ in der Karte über „Spalte“ verschieben.
- **Schnellerfassung:** Feld oben, Enter, die Idee landet im Eingang.
- **Brainstorming:** Thema anlegen, Ideen hintereinander tippen, „Sammeln beenden“. Danach analysiert die KI, bündelt die Ideen zu Themen und schlägt 3 fehlende Ideen vor. Gemeinsam sortieren und Ähnliches zusammenführen.
- **Besprechung:** alle Karten aus „Entscheiden“. Jeder stimmt Ja/Nein/Parken. Sobald die Mehrheit gleich stimmt, wandert die Karte automatisch weiter.
- **Heute fällig:** Karten mit erreichter Wiedervorlage.
- **Filter:** Suche, Kategorie, Person, Priorität, gemerkte Karten (★).
- **Priorität** (automatisch aus Nutzen und Aufwand):
  - Quick Win: Nutzen ≥ 4 und Aufwand ≤ 2
  - sonst Nutzen − Aufwand: ≥ 2 Hoch, 0–1 Mittel, < 0 Niedrig
- **Verlauf:** Jede Änderung wird pro Karte mit Name und Zeit festgehalten.
- **Zusammenführen:** Kommentare und Checklisten werden übernommen. Die zweite Karte wird archiviert, nicht gelöscht.
- **Löschen:** In der Karte oben auf 🗑. Die Karte kommt in den Papierkorb (⚙ Einstellungen). Direkt danach geht „Rückgängig“, sonst 30 Tage lang „Wiederherstellen“. Danach wird sie automatisch endgültig gelöscht. „Endgültig löschen“ im Papierkorb geht auch sofort.
- **Live-Abgleich:** Änderungen des anderen erscheinen nach spätestens 5 Sekunden ohne Neuladen.
- **Spracheingabe (🎙):** in der Schnellerfassung, im Brainstorming und bei Kommentaren. Nutzt die Spracherkennung von Chrome bzw. Safari; Mikrofon-Zugriff einmal erlauben.
- **Fotos:** in jeder Karte über „📷 Foto“ aufnehmen oder hochladen. Fotos werden automatisch verkleinert. Die KI bezieht die neuesten 3 Fotos bei der Analyse mit ein.
- **Hängt fest:** Karten, die 7 Tage oder länger in „Entscheiden“ liegen, bekommen ein gelbes ⏳ und stehen in der Besprechung oben.
- **Ideen aus Gespräch (Plaud):** Brainstorming → „Ideen aus Gespräch / Plaud“. Transkript einfügen oder als Textdatei laden, die KI findet die Ideen, ihr wählt aus. Plaud hat keine offene Schnittstelle; der Weg ist darum: in der Plaud-App Transkript teilen bzw. kopieren und hier einfügen.
- **Überblick:**
  - KI-Wochenrückblick (Fokus der Woche, liegengebliebene Quick Wins, festhängende Karten, Doppelungen mit Zusammenführen-Knopf, Ideen, die zusammen mehr bringen)
  - Zahlen-Dashboard (Entwicklung über 6 Monate, Karten je Spalte, Team)
- **Wochenüberblick montags** (05:47 UTC, also ca. 7:47 Uhr): Der Rückblick wird automatisch erstellt und per Push sowie, wenn eingerichtet, per E-Mail an alle verschickt.
- **Push-Benachrichtigungen:** ⚙ Einstellungen → „Benachrichtigungen auf diesem Gerät“. Sie kommen bei neuen Kommentaren, wenn deine Stimme fehlt, bei Entscheidungen und montags. Am iPhone erst die App zum Home-Bildschirm hinzufügen und von dort öffnen.
- **Pipedrive:** In jeder Karte „Als Aufgabe in Pipedrive anlegen“, wenn eingerichtet (siehe unten).
- **Offline am Handy:** Ohne Netz zeigt die App den letzten bekannten Stand (gelbe Leiste oben). Neue Ideen aus der Schnellerfassung und dem Brainstorming werden auf dem Gerät zwischengespeichert und automatisch hochgeladen, sobald wieder Netz da ist. Andere Änderungen gehen erst wieder mit Netz. Die App selbst startet offline, sobald sie einmal mit Netz geöffnet wurde.
- **Kosten-Anzeige:** ⚙ Einstellungen zeigt die KI-Kosten des Monats im Verhältnis zur Monatsgrenze.

### KI-Analyse

- Läuft automatisch bei jeder neuen Idee, über eine Warteschlange.
- Fällt sie aus (keine Verbindung, Fehler, Limit), bleibt die Idee gespeichert. Alle 10 Minuten wird die Analyse nachgeholt, bis zu 5 Versuche. Danach hilft „Neu analysieren“.
- Alles im blau gestrichelten Bereich „KI-Analyse“ ist ein **Vorschlag**. Jeder Punkt lässt sich einzeln übernehmen, ändern (✎) oder verwerfen (✕). Eure eigenen Felder überschreibt die KI nie.
- Schätzungen sind gelb als **Schätzung** markiert. Quellen werden nur angezeigt, wenn die Websuche sie tatsächlich gefunden hat; erfundene Links werden automatisch entfernt.
- **Neu analysieren** z. B. nach neuen Kommentaren. Frühere Fassungen bleiben unter „Fassung“ abrufbar.
- Der **Firmenkontext** aus den Einstellungen wird bei jeder Analyse mitgegeben.
- **Zwei Modelle:** Ideen im Eingang (und Parkplatz/Verworfen), Brainstorming und Import analysiert das schnelle, günstige Modell (Claude Sonnet 5.5). Wandert eine Karte ins Ausarbeiten oder Entscheiden, folgt automatisch eine gründliche Analyse mit Claude Opus 5.5. In der Karte geht das jederzeit auch per „✦ Gründlich“. Andere Modelle lassen sich mit `AI_MODEL` bzw. `AI_MODEL_FAST` einstellen.
- **Die KI lernt mit:** Unter jeder Analyse 👍/👎 mit kurzem Kommentar. Die letzten 10 Rückmeldungen und die „Hinweise an die KI“ aus den Einstellungen fließen in jede neue Analyse ein, z. B. Region, Stundensätze oder was ihr nicht wollt.

---

## Optionale Verbindungen einrichten

Alles hier ist freiwillig. Die App läuft auch ohne. Einträge kommen wie die Passwörter unter **Workers & Pages → felix → Einstellungen → Variablen und Geheimnisse**.

### Wochen-Mail (Resend)

1. Bei https://resend.com kostenlos registrieren (3.000 Mails pro Monat gratis).
2. **Domains → Add Domain** → `ft-workanddesign.de`. Die angezeigten DNS-Einträge (TXT/MX) beim Domain-Anbieter eintragen und auf „Verify“ warten.
3. **API Keys → Create API Key**, Berechtigung „Sending access“.
4. In Cloudflare hinterlegen:
   - `RESEND_API_KEY` (Geheimnis): der Schlüssel
   - `MAIL_FROM` (Text): z. B. `Ideen-Board <ideen@ft-workanddesign.de>`
5. In der App unter ⚙ Einstellungen trägt jede Person ihre E-Mail-Adresse ein. Mit „Test-Mail an mich“ prüfen.

### Pipedrive

1. In Pipedrive: Profilbild oben rechts → **Persönliche Einstellungen → API** → Token kopieren.
2. In Cloudflare: `PIPEDRIVE_API_TOKEN` (Geheimnis).
3. Optional `PIPEDRIVE_DOMAIN` (Text): euer Firmenkürzel aus der Pipedrive-Adresse (`<kürzel>.pipedrive.com`).

Angelegt wird eine Aufgabe (Aktivität) mit Beschreibung, Checkliste und Link zur Karte. Fällig ist sie zur Wiedervorlage der Karte, sonst heute.

### Eigene Adresse (z. B. `ideen.ft-workanddesign.de`)

Das geht nur, wenn die Domain ihre DNS bei Cloudflare hat:

1. Cloudflare → **Domain hinzufügen** → `ft-workanddesign.de`. Der kostenlose Tarif reicht.
2. Cloudflare zeigt zwei Nameserver. Diese beim bisherigen Domain-Anbieter eintragen. Vorher prüfen, dass alle bestehenden Einträge (Website, E-Mail/MX) in Cloudflare übernommen wurden.
3. Danach: Worker **felix → Einstellungen → Domains & Routen → Hinzufügen → Benutzerdefinierte Domain** → `ideen.ft-workanddesign.de`.

Links in Mails und Push-Nachrichten nutzen automatisch die zuletzt verwendete Adresse. Fest einstellen lässt sie sich mit `APP_URL` (Text).

---

## Aufbau des Codes

```
ideen-board/
  shared/types.ts       Typen, Spalten, Nutzer, Prioritätsregel
  worker/               Server (Cloudflare Worker)
    index.ts            Einstieg, Anmeldung, Zeitplan, Warteschlange
    api.ts              alle API-Endpunkte
    ai.ts               KI-Analyse (Anthropic API), Brainstorming-Bündelung
    auth.ts             Login, Sitzungen
    backup.ts           Export und nächtliche Sicherung
    examples.ts         Beispielkarten
    attachments.ts      Fotos
    push.ts             Push-Benachrichtigungen
    insights.ts         Wochenrückblick, Transkript-Import, Kennzahlen
    digest.ts           Wochen-Mail (Resend)
    pipedrive.ts        Pipedrive-Aufgaben
  src/                  Oberfläche (React)
  migrations/           Datenbank-Schema
  scripts/deploy.mjs    Veröffentlichung
```
