-- Sicherungen in der Datenbank, falls kein R2-Speicher eingerichtet ist
CREATE TABLE backups (
  key TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  data TEXT NOT NULL
);
