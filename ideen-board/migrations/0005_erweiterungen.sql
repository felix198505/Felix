-- Seit wann liegt eine Karte in ihrer Spalte (für „hängt seit X Tagen“)
ALTER TABLE cards ADD COLUMN column_since TEXT;
UPDATE cards SET column_since = updated_at;

-- E-Mail-Adresse für die Wochen-Mail
ALTER TABLE users ADD COLUMN email TEXT;

-- Fotos an Karten (in der Datenbank oder, falls vorhanden, in R2)
CREATE TABLE attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  data BLOB,
  r2_key TEXT
);
CREATE INDEX idx_attachments_card ON attachments(card_id);

-- Push-Benachrichtigungen
CREATE TABLE push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- KI-Wochenrückblicke
CREATE TABLE reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  requested_by TEXT,
  data TEXT NOT NULL
);
