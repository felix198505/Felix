-- Rückmeldungen des Teams zu KI-Analysen (fließen in künftige Analysen ein)
CREATE TABLE ai_feedback (
  analysis_id INTEGER NOT NULL REFERENCES ai_analyses(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  rating INTEGER NOT NULL,          -- 1 = hilfreich, -1 = nicht hilfreich
  comment TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  PRIMARY KEY (analysis_id, user_id)
);
