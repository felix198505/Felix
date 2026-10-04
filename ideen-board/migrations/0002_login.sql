-- Schutz gegen Passwort-Raten
CREATE TABLE login_failures (
  ip TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE INDEX idx_login_failures ON login_failures(ip, at);
