CREATE TABLE IF NOT EXISTS facebook_oauth_diagnostics (
  flow_id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT '',
  diagnostics_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_fb_oauth_diagnostics_updated
ON facebook_oauth_diagnostics(updated_at);
