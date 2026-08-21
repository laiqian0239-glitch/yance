CREATE TABLE IF NOT EXISTS personal_access_requests (
  id TEXT PRIMARY KEY,
  installation_id TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL CHECK (state IN ('PENDING','ASSIGNED','APPROVED','REJECTED')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  assigned_at TEXT,
  decided_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_personal_access_requests_installation
  ON personal_access_requests(installation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_personal_access_requests_state
  ON personal_access_requests(state, updated_at DESC);

CREATE TABLE IF NOT EXISTS personal_access_grants (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL UNIQUE REFERENCES personal_access_requests(id),
  installation_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('ACTIVE','SUSPENDED','REVOKED')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_personal_access_grants_installation
  ON personal_access_grants(installation_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_personal_access_grants_state
  ON personal_access_grants(state, updated_at DESC);
