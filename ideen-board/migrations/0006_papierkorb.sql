-- Papierkorb: gelöschte Karten bleiben 30 Tage wiederherstellbar
ALTER TABLE cards ADD COLUMN deleted_at TEXT;
ALTER TABLE cards ADD COLUMN deleted_by TEXT;
