PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS facebook_accounts (
  id TEXT PRIMARY KEY,
  page_id TEXT NOT NULL UNIQUE,
  page_name TEXT NOT NULL DEFAULT '',
  page_username TEXT NOT NULL DEFAULT '',
  graph_version TEXT NOT NULL,
  permission_status TEXT NOT NULL DEFAULT 'unknown',
  permissions_json TEXT NOT NULL DEFAULT '[]',
  webhook_status TEXT NOT NULL DEFAULT 'pending',
  token_status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  disconnected_at TEXT
);

CREATE TABLE IF NOT EXISTS facebook_page_tokens (
  account_id TEXT PRIMARY KEY REFERENCES facebook_accounts(id) ON DELETE CASCADE,
  page_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  key_id TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  iv TEXT NOT NULL,
  auth_tag TEXT NOT NULL,
  token_status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_validated_at TEXT,
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS facebook_webhook_events (
  id TEXT PRIMARY KEY,
  account_id TEXT REFERENCES facebook_accounts(id) ON DELETE SET NULL,
  page_id TEXT NOT NULL,
  dedup_key TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  meta_message_id TEXT,
  event_timestamp TEXT NOT NULL,
  raw_payload_json TEXT NOT NULL,
  normalized_payload_json TEXT NOT NULL,
  media_status TEXT NOT NULL DEFAULT 'none',
  processing_status TEXT NOT NULL DEFAULT 'pending',
  delivery_attempts INTEGER NOT NULL DEFAULT 0,
  last_error_code TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS facebook_event_deliveries (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES facebook_webhook_events(id) ON DELETE CASCADE,
  account_id TEXT REFERENCES facebook_accounts(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  lease_token TEXT,
  lease_expires_at TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  first_available_at TEXT NOT NULL,
  last_delivered_at TEXT,
  acked_at TEXT,
  dead_letter_at TEXT,
  last_error_code TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(event_id, device_id)
);

CREATE TABLE IF NOT EXISTS facebook_desktop_devices (
  id TEXT PRIMARY KEY,
  account_id TEXT REFERENCES facebook_accounts(id) ON DELETE SET NULL,
  page_id TEXT NOT NULL DEFAULT '',
  public_key_spki TEXT NOT NULL,
  key_algorithm TEXT NOT NULL DEFAULT 'Ed25519',
  status TEXT NOT NULL DEFAULT 'active',
  display_name TEXT NOT NULL DEFAULT '',
  registration_proof TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_seen_at TEXT,
  disabled_at TEXT
);

CREATE TABLE IF NOT EXISTS facebook_oauth_states (
  id TEXT PRIMARY KEY,
  flow_id TEXT NOT NULL UNIQUE,
  state_hash TEXT NOT NULL UNIQUE,
  client_proof TEXT NOT NULL,
  device_id TEXT NOT NULL,
  device_public_key_spki TEXT NOT NULL,
  device_display_name TEXT NOT NULL DEFAULT '',
  enrollment_mac TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  selected_page_id TEXT,
  error_code TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS facebook_oauth_page_candidates (
  id TEXT PRIMARY KEY,
  flow_id TEXT NOT NULL,
  page_id TEXT NOT NULL,
  page_name TEXT NOT NULL DEFAULT '',
  page_username TEXT NOT NULL DEFAULT '',
  picture_url TEXT NOT NULL DEFAULT '',
  permissions_json TEXT NOT NULL DEFAULT '[]',
  missing_permissions_json TEXT NOT NULL DEFAULT '[]',
  token_version INTEGER NOT NULL,
  token_key_id TEXT NOT NULL,
  token_ciphertext TEXT NOT NULL,
  token_iv TEXT NOT NULL,
  token_auth_tag TEXT NOT NULL,
  token_expires_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(flow_id, page_id)
);

CREATE TABLE IF NOT EXISTS facebook_send_idempotency (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES facebook_accounts(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'processing',
  response_json TEXT,
  error_code TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  UNIQUE(account_id, device_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS facebook_device_requests (
  request_id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  body_sha256 TEXT NOT NULL,
  idempotency_key TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS facebook_event_media (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES facebook_webhook_events(id) ON DELETE CASCADE,
  attachment_index INTEGER NOT NULL,
  r2_key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL DEFAULT 'unknown',
  mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  filename TEXT NOT NULL DEFAULT '',
  size_bytes INTEGER NOT NULL DEFAULT 0,
  sha256 TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_retry_at TEXT,
  last_error_code TEXT NOT NULL DEFAULT '',
  source_host TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  UNIQUE(event_id, attachment_index)
);
