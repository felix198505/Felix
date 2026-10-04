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

## Nutzer verwalten

- **Passwort ändern:** Im Cloudflare-Dashboard unter Variablen und Geheimnisse `PASSWORD_FELIX` bzw. `PASSWORD_TIM` bearbeiten. Alle bestehenden Anmeldungen dieses Nutzers werden dadurch ungültig.
- **Passwort lieber als Hash speichern:** Mit `npm run hash-password -- "NeuesPasswort"` einen Hash erzeugen und als `PASSWORD_HASH_FELIX` hinterlegen. Ein Hash hat Vorrang vor dem Klartext-Secret.
- **Nutzer:** Felix, Tim und Kerstin. Alle können Ideen anlegen, bearbeiten und kommentieren. In der Besprechung stimmen nur Felix und Tim ab; das steht in `VOTERS` in `shared/types.ts`.
- **Weiteren Nutzer hinzufügen:** In `shared/types.ts` die Liste `USERS` ergänzen. Dazu eine neue Datei in `migrations/` anlegen, z. B. `0004_nutzer.sql` mit `INSERT INTO users (id, name) VALUES ('anna', 'Anna');`. Danach das Secret `PASSWORD_ANNA` setzen und neu veröffentlichen (Vorbild: `migrations/0004_kerstin.sql`).
- Eine offene Registrierung gibt es nicht. Ohne Anmeldung liefert der Server keine Daten. Nach 8 Fehlversuchen innerhalb von 15 Minuten wird die Anmeldung gesperrt.
- Eine Anmeldung bleibt 30 Tage gültig. Abmelden geht oben rechts.

---

## Backup und Wiederherstellung

Es gibt drei Sicherungsebenen:

1. **Automatisch jede Nacht** (02:17 Uhr UTC): Der komplette Datenbestand wird als JSON in R2 gespeichert und 30 Tage aufbewahrt. Ist R2 im Konto nicht aktiviert, landet die Sicherung in der Datenbank selbst. Liste und Download: ⚙ Einstellungen → „Automatische Sicherungen anzeigen“.
2. **Von Hand:** ⚙ Einstellungen → **Alles exportieren (JSON)**. Die Datei auf dem PC oder in der Cloud ablegen. **CSV** öffnet sich in Excel, **PDF / Drucken** liefert eine druckfertige Liste.
3. **Zeitreise der Datenbank (Cloudflare D1):** stellt den Stand zu einem beliebigen Zeitpunkt der letzten 7 Tage wieder her (30 Tage im bezahlten Workers-Tarif).

   ```bash
   npx wrangler d1 time-travel info ideen-board --timestamp "2026-10-01T08:00:00Z"
   npx wrangler d1 time-travel restore ideen-board --timestamp "2026-10-01T08:00:00Z"
   ```

---

## Funktionen

- **Spalten:** Eingang, Ausarbeiten, Entscheiden, Umsetzen, Erledigt, Parkplatz, Verworfen (Verwerfen nur mit Grund). Drag & Drop am Handy: Karte kurz gedrückt halten, dann ziehen. Alternativ in der Karte über „Spalte“ verschieben.
- **Schnellerfassung:** Feld oben, Enter, die Idee landet im Eingang.
- **Brainstorming:** Thema anlegen, Ideen hintereinander tippen, „Sammeln beenden“. Danach analysiert die KI, bündelt die Ideen zu Themen und schlägt 3 fehlende Ideen vor. Gemeinsam sortieren und Ähnliches zusammenführen.
- **Besprechung:** alle Karten aus „Entscheiden“. Jeder stimmt Ja/Nein/Parken. Bei gleicher Stimme beider wandert die Karte automatisch weiter.
- **Heute fällig:** Karten mit erreichter Wiedervorlage.
- **Filter:** Suche, Kategorie, Person, Priorität, gemerkte Karten (★).
- **Priorität** (automatisch aus Nutzen und Aufwand):
  - Quick Win: Nutzen ≥ 4 und Aufwand ≤ 2
  - sonst Nutzen − Aufwand: ≥ 2 Hoch, 0–1 Mittel, < 0 Niedrig
- **Verlauf:** Jede Änderung wird pro Karte mit Name und Zeit festgehalten.
- **Zusammenführen:** Kommentare und Checklisten werden übernommen. Die zweite Karte wird archiviert, nicht gelöscht.
- **Live-Abgleich:** Änderungen des anderen erscheinen nach spätestens 5 Sekunden ohne Neuladen.

### KI-Analyse

- Läuft automatisch bei jeder neuen Idee, über eine Warteschlange.
- Fällt sie aus (keine Verbindung, Fehler, Limit), bleibt die Idee gespeichert. Alle 10 Minuten wird die Analyse nachgeholt, bis zu 5 Versuche. Danach hilft „Neu analysieren“.
- Alles im blau gestrichelten Bereich „KI-Analyse“ ist ein **Vorschlag**. Jeder Punkt lässt sich einzeln übernehmen, ändern (✎) oder verwerfen (✕). Eure eigenen Felder überschreibt die KI nie.
- Schätzungen sind gelb als **Schätzung** markiert. Quellen werden nur angezeigt, wenn die Websuche sie tatsächlich gefunden hat; erfundene Links werden automatisch entfernt.
- **Neu analysieren** z. B. nach neuen Kommentaren. Frühere Fassungen bleiben unter „Fassung“ abrufbar.
- Der **Firmenkontext** aus den Einstellungen wird bei jeder Analyse mitgegeben.

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
  src/                  Oberfläche (React)
  migrations/           Datenbank-Schema
  scripts/deploy.mjs    Veröffentlichung
```
