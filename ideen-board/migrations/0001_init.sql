-- Grundschema Ideen-Board

CREATE TABLE users (
  id TEXT PRIMARY KEY,          -- 'felix' | 'tim'
  name TEXT NOT NULL
);

CREATE TABLE categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE brainstorms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  topic TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'sammeln',   -- sammeln | sortieren | fertig
  ai_status TEXT NOT NULL DEFAULT 'none',   -- none | pending | running | done | error
  ai_error TEXT,
  ai_data TEXT                              -- JSON: Themen + Zusatzideen
);

CREATE TABLE cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  column_key TEXT NOT NULL DEFAULT 'eingang',
  position REAL NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  benefit INTEGER,
  effort INTEGER,
  assignee TEXT,
  next_step TEXT NOT NULL DEFAULT '',
  follow_up TEXT,                           -- YYYY-MM-DD
  reject_reason TEXT NOT NULL DEFAULT '',
  merged_into INTEGER REFERENCES cards(id),
  brainstorm_id INTEGER REFERENCES brainstorms(id),
  ai_status TEXT NOT NULL DEFAULT 'pending', -- pending | running | done | error | deferred
  ai_error TEXT,
  ai_attempts INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_cards_column ON cards(column_key, position);

CREATE TABLE favorites (
  card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  PRIMARY KEY (card_id, user_id)
);

CREATE TABLE checklist_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  position REAL NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'user',      -- user | ai
  created_at TEXT NOT NULL
);
CREATE INDEX idx_checklist_card ON checklist_items(card_id);

CREATE TABLE comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  text TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_comments_card ON comments(card_id);

CREATE TABLE votes (
  card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  vote TEXT NOT NULL,                       -- ja | nein | parken
  created_at TEXT NOT NULL,
  PRIMARY KEY (card_id, user_id)
);

CREATE TABLE history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  user_id TEXT,                             -- NULL = System/KI
  action TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX idx_history_card ON history(card_id);

CREATE TABLE ai_analyses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  requested_by TEXT,
  model TEXT NOT NULL,
  data TEXT NOT NULL,                       -- JSON der Analyse
  item_state TEXT NOT NULL DEFAULT '{}',    -- JSON: { "<vorschlag-id>": "uebernommen" | "verworfen" }
  cost_usd REAL NOT NULL DEFAULT 0
);
CREATE INDEX idx_ai_card ON ai_analyses(card_id, version);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT INTO users (id, name) VALUES ('felix', 'Felix'), ('tim', 'Tim');

INSERT INTO categories (name, color, sort) VALUES
  ('Vertrieb', '#22c55e', 1),
  ('Marketing', '#eab308', 2),
  ('Montage', '#f97316', 3),
  ('Produkte', '#3b82f6', 4),
  ('Organisation', '#a855f7', 5),
  ('Personal', '#ec4899', 6),
  ('GmbH-Gründung', '#14b8a6', 7);

INSERT INTO settings (key, value) VALUES
  ('rev', '1'),
  ('company_context', 'Wir sind ein Handwerksbetrieb für Terrassenüberdachungen, Markisen und Kaltwintergärten mit kleinem Team.'),
  ('ai_monthly_limit_eur', '10');
