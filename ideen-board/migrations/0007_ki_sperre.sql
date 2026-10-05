-- Verhindert doppelte KI-Läufe und endlose Wiederholungen
ALTER TABLE cards ADD COLUMN ai_started_at TEXT;
ALTER TABLE brainstorms ADD COLUMN ai_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE brainstorms ADD COLUMN ai_started_at TEXT;
