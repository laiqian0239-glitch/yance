-- Retention is enforced by the Worker scheduled handler. This migration records
-- the schema revision without storing customer data indefinitely.
CREATE TABLE IF NOT EXISTS facebook_schema_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
INSERT INTO facebook_schema_meta(key, value, updated_at)
VALUES ('retention_policy_version', '1', strftime('%Y-%m-%dT%H:%M:%fZ','now'))
ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at;
