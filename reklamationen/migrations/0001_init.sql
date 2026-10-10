-- Reklamationstool: Grundschema

CREATE TABLE users (
  id TEXT PRIMARY KEY,                 -- Anmeldename, z. B. felix
  name TEXT NOT NULL,
  rolle TEXT NOT NULL DEFAULT 'montage' CHECK (rolle IN ('inhaber', 'buero', 'montage')),
  email TEXT,
  password_hash TEXT,                  -- pbkdf2-Hash; leer = Passwort aus Cloudflare-Secret (PASSWORD_FELIX …)
  aktiv INTEGER NOT NULL DEFAULT 1,
  erinnerungen INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
INSERT INTO users (id, name, rolle) VALUES
  ('felix', 'Felix', 'inhaber'),
  ('kerstin', 'Kerstin', 'buero'),
  ('tim', 'Tim', 'buero');

CREATE TABLE faelle (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  meta TEXT NOT NULL DEFAULT '',
  gruppe TEXT NOT NULL DEFAULT 'kunde' CHECK (gruppe IN ('recht', 'kunde', 'leiner')),
  what TEXT NOT NULL DEFAULT '',
  pts TEXT NOT NULL DEFAULT '[]',      -- Sachstand als JSON-Liste von Texten
  status TEXT NOT NULL DEFAULT '',
  stufe TEXT NOT NULL DEFAULT 'warn' CHECK (stufe IN ('crit', 'warn', 'ok')),
  termin TEXT,                         -- JJJJ-MM-TT
  termin_text TEXT NOT NULL DEFAULT '',
  erledigt INTEGER NOT NULL DEFAULT 0,
  stand TEXT,                          -- JJJJ-MM-TT, letzte Bearbeitung
  hinweis TEXT NOT NULL DEFAULT '',
  lk TEXT,                             -- letzte Kundenmail
  lf TEXT,                             -- letzte Mail von FT
  mh_link TEXT NOT NULL DEFAULT '',    -- Projekt in Mein Handwerker
  pd_link TEXT NOT NULL DEFAULT '',    -- Deal in Pipedrive
  created_at TEXT NOT NULL,
  created_by TEXT,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);
CREATE INDEX idx_faelle_termin ON faelle(erledigt, termin);

CREATE TABLE fall_schritte (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fall_id TEXT NOT NULL REFERENCES faelle(id) ON DELETE CASCADE,
  pos INTEGER NOT NULL DEFAULT 0,
  t TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  done_by TEXT,
  done_at TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);
CREATE INDEX idx_schritte_fall ON fall_schritte(fall_id, pos);

CREATE TABLE fall_verlauf (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fall_id TEXT NOT NULL REFERENCES faelle(id) ON DELETE CASCADE,
  pos INTEGER NOT NULL DEFAULT 0,
  d TEXT NOT NULL,                     -- JJJJ-MM-TT
  t TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);
CREATE INDEX idx_verlauf_fall ON fall_verlauf(fall_id, d, pos);

-- Wer hat wann was geändert. Bleibt auch nach dem Löschen eines Falls erhalten.
CREATE TABLE aenderungen (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fall_id TEXT NOT NULL,
  user_id TEXT,                        -- NULL = Import über Schnittstelle
  at TEXT NOT NULL,
  aktion TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_aenderungen_fall ON aenderungen(fall_id, at);

CREATE TABLE anhaenge (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fall_id TEXT NOT NULL REFERENCES faelle(id) ON DELETE CASCADE,
  user_id TEXT,
  created_at TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  name TEXT NOT NULL,
  data BLOB,                           -- nur ohne R2
  r2_key TEXT
);
CREATE INDEX idx_anhaenge_fall ON anhaenge(fall_id);

CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT INTO settings (key, value) VALUES ('rev', '0');

CREATE TABLE login_failures (ip TEXT NOT NULL, at TEXT NOT NULL);
CREATE INDEX idx_login_failures ON login_failures(ip, at);

CREATE TABLE push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Bereits verschickte Erinnerungen (keine doppelten Nachrichten)
CREATE TABLE erinnerungen (
  fall_id TEXT NOT NULL,
  art TEXT NOT NULL,                   -- morgen | ueberfaellig
  termin TEXT NOT NULL,
  at TEXT NOT NULL,
  PRIMARY KEY (fall_id, art, termin)
);

CREATE TABLE backups (key TEXT PRIMARY KEY, created_at TEXT NOT NULL, data TEXT NOT NULL);
