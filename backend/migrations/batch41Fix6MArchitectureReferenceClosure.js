'use strict';

const MIGRATION_ID = '019_batch41_fix6m_architecture_reference_closure';
const TARGET_SCHEMA_VERSION = 19;
const CHECKSUM = 'batch41-fix6m-architecture-authorities-v7';

function nowIso() { return new Date().toISOString(); }
function tableExists(db, table) { return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)); }
function schemaVersion(db) {
  if (!tableExists(db, 'r32_meta')) return 0;
  const values = db.prepare("SELECT value_json FROM r32_meta WHERE key IN ('schema_version','schemaVersion')").all()
    .map(row => { try { return Number(JSON.parse(row.value_json)); } catch (_) { return Number(row.value_json); } })
    .filter(Number.isInteger);
  return values.length ? Math.max(...values) : 0;
}
function setSchemaVersion(db, value, at) {
  const statement = db.prepare(`INSERT INTO r32_meta(key,value_json,updated_at) VALUES(?,?,?)
    ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at`);
  const encoded = JSON.stringify(Number(value));
  statement.run('schema_version', encoded, at);
  statement.run('schemaVersion', encoded, at);
}
function ensureMigrationTable(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS r32_schema_migrations(
    migration_id TEXT PRIMARY KEY,target_schema_version INTEGER NOT NULL,status TEXT NOT NULL,checksum TEXT NOT NULL DEFAULT '',
    started_at TEXT NOT NULL,completed_at TEXT NOT NULL DEFAULT '',report_json TEXT NOT NULL DEFAULT '{}'
  ) STRICT;`);
}
function ensureObjects(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS evidence_traces(
      trace_id TEXT PRIMARY KEY,
      route_test_id TEXT NOT NULL DEFAULT '',
      trace_type TEXT NOT NULL DEFAULT 'generic',
      task TEXT NOT NULL DEFAULT '',
      execution_mode TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'running' CHECK(status IN ('running','completed','failed','cancelled')),
      metadata_json TEXT NOT NULL DEFAULT '{}',
      started_at TEXT NOT NULL,
      completed_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    ) STRICT;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_evidence_traces_route_test
      ON evidence_traces(route_test_id) WHERE route_test_id <> '';
    CREATE INDEX IF NOT EXISTS idx_evidence_traces_recent
      ON evidence_traces(started_at DESC, trace_id);
    CREATE INDEX IF NOT EXISTS idx_evidence_traces_status
      ON evidence_traces(status, updated_at DESC);

    CREATE TABLE IF NOT EXISTS evidence_observations(
      observation_id TEXT PRIMARY KEY,
      trace_id TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      idempotency_key TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'event' CHECK(kind IN ('event','span','generation','tool','retriever','evaluator')),
      stage TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT '',
      execution_id TEXT NOT NULL DEFAULT '',
      attempt_id TEXT NOT NULL DEFAULT '',
      provider_request_id TEXT NOT NULL DEFAULT '',
      route_receipt_id TEXT NOT NULL DEFAULT '',
      qualification_receipt_id TEXT NOT NULL DEFAULT '',
      delivery_receipt_id TEXT NOT NULL DEFAULT '',
      learning_receipt_id TEXT NOT NULL DEFAULT '',
      evidence_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      FOREIGN KEY(trace_id) REFERENCES evidence_traces(trace_id) ON DELETE RESTRICT,
      UNIQUE(trace_id, sequence),
      UNIQUE(trace_id, idempotency_key)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_evidence_observations_trace
      ON evidence_observations(trace_id, sequence);
    CREATE INDEX IF NOT EXISTS idx_evidence_observations_execution
      ON evidence_observations(execution_id, created_at) WHERE execution_id <> '';
    CREATE INDEX IF NOT EXISTS idx_evidence_observations_provider_request
      ON evidence_observations(provider_request_id) WHERE provider_request_id <> '';

    CREATE TRIGGER IF NOT EXISTS trg_evidence_observations_append_only_update
    BEFORE UPDATE ON evidence_observations
    BEGIN
      SELECT RAISE(ABORT, 'evidence observations are append-only');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_evidence_observations_append_only_delete
    BEFORE DELETE ON evidence_observations
    BEGIN
      SELECT RAISE(ABORT, 'evidence observations are append-only');
    END;


    CREATE TABLE IF NOT EXISTS durable_executions(
      execution_id TEXT PRIMARY KEY,
      trace_id TEXT NOT NULL DEFAULT '',
      operation_kind TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN (
        'CREATED','SCHEDULED','RUNNING','WAITING_REMOTE','RETRY_SCHEDULED',
        'CANCEL_REQUESTED','CANCELLED','SUCCEEDED','FAILED','DEAD_LETTERED'
      )),
      generation INTEGER NOT NULL DEFAULT 0,
      owner_id TEXT NOT NULL DEFAULT '',
      lease_sequence INTEGER NOT NULL DEFAULT 0,
      last_heartbeat_at TEXT NOT NULL DEFAULT '',
      cancellation_requested_at TEXT NOT NULL DEFAULT '',
      cancellation_actor TEXT NOT NULL DEFAULT '',
      retry_count INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 3,
      next_attempt_at TEXT NOT NULL DEFAULT '',
      failure_code TEXT NOT NULL DEFAULT '',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT NOT NULL DEFAULT '',
      UNIQUE(operation_kind,idempotency_key)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_durable_executions_state
      ON durable_executions(state,next_attempt_at,updated_at,execution_id);
    CREATE INDEX IF NOT EXISTS idx_durable_executions_trace
      ON durable_executions(trace_id,created_at,execution_id) WHERE trace_id <> '';

    CREATE TABLE IF NOT EXISTS durable_execution_events(
      event_id TEXT PRIMARY KEY,
      execution_id TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      from_state TEXT NOT NULL DEFAULT '',
      to_state TEXT NOT NULL,
      generation INTEGER NOT NULL,
      owner_id TEXT NOT NULL DEFAULT '',
      reason_code TEXT NOT NULL DEFAULT '',
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      FOREIGN KEY(execution_id) REFERENCES durable_executions(execution_id) ON DELETE RESTRICT,
      UNIQUE(execution_id,sequence)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_durable_execution_events_execution
      ON durable_execution_events(execution_id,sequence);

    CREATE TRIGGER IF NOT EXISTS trg_durable_execution_events_append_only_update
    BEFORE UPDATE ON durable_execution_events
    BEGIN
      SELECT RAISE(ABORT, 'durable execution events are append-only');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_durable_execution_events_append_only_delete
    BEFORE DELETE ON durable_execution_events
    BEGIN
      SELECT RAISE(ABORT, 'durable execution events are append-only');
    END;


    CREATE TABLE IF NOT EXISTS communication_canonical_messages(
      message_id TEXT PRIMARY KEY,
      trace_id TEXT NOT NULL DEFAULT '',
      platform TEXT NOT NULL,
      source_account_id TEXT NOT NULL,
      external_conversation_id TEXT NOT NULL,
      external_message_id TEXT NOT NULL,
      direction TEXT NOT NULL CHECK(direction IN ('inbound','outbound','system')),
      sender_external_id TEXT NOT NULL DEFAULT '',
      occurred_at TEXT NOT NULL DEFAULT '',
      content_kind TEXT NOT NULL,
      raw_event_ref_json TEXT NOT NULL DEFAULT '{}',
      normalized_content_json TEXT NOT NULL DEFAULT '{}',
      render_projection_json TEXT NOT NULL DEFAULT '{}',
      idempotency_key TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(platform,source_account_id,external_conversation_id,external_message_id)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_communication_canonical_messages_conversation
      ON communication_canonical_messages(platform,source_account_id,external_conversation_id,occurred_at,message_id);
    CREATE INDEX IF NOT EXISTS idx_communication_canonical_messages_trace
      ON communication_canonical_messages(trace_id,created_at) WHERE trace_id <> '';

    CREATE TABLE IF NOT EXISTS communication_media_assets(
      media_id TEXT PRIMARY KEY,
      trace_id TEXT NOT NULL DEFAULT '',
      platform TEXT NOT NULL,
      source_account_id TEXT NOT NULL,
      external_reference TEXT NOT NULL,
      media_kind TEXT NOT NULL,
      mime_type TEXT NOT NULL DEFAULT '',
      animated INTEGER NOT NULL DEFAULT 0,
      state TEXT NOT NULL CHECK(state IN (
        'REMOTE_DISCOVERED','FETCH_SCHEDULED','FETCHING','AVAILABLE','EXPIRED',
        'FAILED_RETRYABLE','FAILED_PERMANENT'
      )),
      version INTEGER NOT NULL DEFAULT 1,
      local_path TEXT NOT NULL DEFAULT '',
      thumbnail_path TEXT NOT NULL DEFAULT '',
      sha256 TEXT NOT NULL DEFAULT '',
      failure_code TEXT NOT NULL DEFAULT '',
      next_retry_at TEXT NOT NULL DEFAULT '',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(platform,source_account_id,external_reference,media_kind)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_communication_media_assets_state
      ON communication_media_assets(state,next_retry_at,updated_at,media_id);
    CREATE INDEX IF NOT EXISTS idx_communication_media_assets_trace
      ON communication_media_assets(trace_id,created_at) WHERE trace_id <> '';

    CREATE TABLE IF NOT EXISTS communication_delivery_attempts(
      attempt_id TEXT PRIMARY KEY,
      trace_id TEXT NOT NULL DEFAULT '',
      message_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      source_account_id TEXT NOT NULL,
      idempotency_key TEXT NOT NULL UNIQUE,
      state TEXT NOT NULL DEFAULT 'CREATED' CHECK(state IN ('CREATED','ACCEPTED','DELIVERED','READ','FAILED','UNKNOWN')),
      platform_message_id TEXT NOT NULL DEFAULT '',
      provider_request_id TEXT NOT NULL DEFAULT '',
      failure_code TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(message_id) REFERENCES communication_canonical_messages(message_id) ON DELETE RESTRICT
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_communication_delivery_attempts_message
      ON communication_delivery_attempts(message_id,created_at,attempt_id);
    CREATE INDEX IF NOT EXISTS idx_communication_delivery_attempts_state
      ON communication_delivery_attempts(state,updated_at,attempt_id);

    CREATE TABLE IF NOT EXISTS communication_delivery_receipts(
      receipt_id TEXT PRIMARY KEY,
      attempt_id TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('ACCEPTED','DELIVERED','READ','FAILED','UNKNOWN')),
      platform_message_id TEXT NOT NULL DEFAULT '',
      provider_request_id TEXT NOT NULL DEFAULT '',
      failure_code TEXT NOT NULL DEFAULT '',
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      FOREIGN KEY(attempt_id) REFERENCES communication_delivery_attempts(attempt_id) ON DELETE RESTRICT,
      UNIQUE(attempt_id,sequence),
      UNIQUE(attempt_id,status,platform_message_id,provider_request_id)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_communication_delivery_receipts_attempt
      ON communication_delivery_receipts(attempt_id,sequence);

    CREATE TRIGGER IF NOT EXISTS trg_communication_delivery_receipts_append_only_update
    BEFORE UPDATE ON communication_delivery_receipts
    BEGIN
      SELECT RAISE(ABORT, 'delivery receipts are append-only');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_communication_delivery_receipts_append_only_delete
    BEFORE DELETE ON communication_delivery_receipts
    BEGIN
      SELECT RAISE(ABORT, 'delivery receipts are append-only');
    END;

    CREATE TABLE IF NOT EXISTS communication_sync_checkpoints(
      checkpoint_id TEXT PRIMARY KEY,
      platform TEXT NOT NULL,
      source_account_id TEXT NOT NULL,
      stream_kind TEXT NOT NULL,
      external_conversation_id TEXT NOT NULL DEFAULT '',
      version INTEGER NOT NULL DEFAULT 0,
      cursor TEXT NOT NULL DEFAULT '',
      high_watermark TEXT NOT NULL DEFAULT '',
      gap_closed INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL,
      UNIQUE(platform,source_account_id,stream_kind,external_conversation_id)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_communication_sync_checkpoints_scope
      ON communication_sync_checkpoints(platform,source_account_id,stream_kind,external_conversation_id);

    CREATE TABLE IF NOT EXISTS contact_aggregates(
      contact_id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL DEFAULT '',
      state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','archived','merged')),
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS contact_external_identities(
      identity_id TEXT PRIMARY KEY,
      contact_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      source_account_id TEXT NOT NULL,
      external_id TEXT NOT NULL,
      display_name TEXT NOT NULL DEFAULT '',
      avatar_media_id TEXT NOT NULL DEFAULT '',
      evidence_type TEXT NOT NULL DEFAULT 'platform-observed',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(contact_id) REFERENCES contact_aggregates(contact_id) ON DELETE RESTRICT,
      UNIQUE(platform,source_account_id,external_id)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_contact_external_identities_contact
      ON contact_external_identities(contact_id,platform,source_account_id,external_id);

    CREATE TABLE IF NOT EXISTS contact_identity_link_events(
      event_id TEXT PRIMARY KEY,
      identity_id TEXT NOT NULL,
      previous_contact_id TEXT NOT NULL,
      target_contact_id TEXT NOT NULL,
      evidence_type TEXT NOT NULL,
      actor TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      FOREIGN KEY(identity_id) REFERENCES contact_external_identities(identity_id) ON DELETE RESTRICT
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_contact_identity_link_events_identity
      ON contact_identity_link_events(identity_id,created_at,event_id);

    CREATE TABLE IF NOT EXISTS contact_message_bindings(
      message_id TEXT PRIMARY KEY,
      contact_id TEXT NOT NULL,
      identity_id TEXT NOT NULL DEFAULT '',
      source_type TEXT NOT NULL,
      bound_at TEXT NOT NULL,
      FOREIGN KEY(message_id) REFERENCES communication_canonical_messages(message_id) ON DELETE RESTRICT,
      FOREIGN KEY(contact_id) REFERENCES contact_aggregates(contact_id) ON DELETE RESTRICT
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_contact_message_bindings_contact
      ON contact_message_bindings(contact_id,bound_at,message_id);

    CREATE TABLE IF NOT EXISTS relationship_assertions_v2(
      assertion_id TEXT PRIMARY KEY,
      contact_id TEXT NOT NULL,
      trace_id TEXT NOT NULL DEFAULT '',
      assertion_type TEXT NOT NULL,
      value_json TEXT NOT NULL DEFAULT '{}',
      confidence REAL NOT NULL DEFAULT 0,
      projection_version TEXT NOT NULL DEFAULT 'fix6m-v1',
      source_message_ids_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      FOREIGN KEY(contact_id) REFERENCES contact_aggregates(contact_id) ON DELETE RESTRICT
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_relationship_assertions_v2_contact
      ON relationship_assertions_v2(contact_id,created_at,assertion_id);

    CREATE TABLE IF NOT EXISTS relationship_assertion_events(
      event_id TEXT PRIMARY KEY,
      assertion_id TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      action TEXT NOT NULL CHECK(action IN ('created','approve','reject','revoke')),
      actor TEXT NOT NULL DEFAULT '',
      reason_code TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      FOREIGN KEY(assertion_id) REFERENCES relationship_assertions_v2(assertion_id) ON DELETE RESTRICT,
      UNIQUE(assertion_id,sequence)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_relationship_assertion_events_assertion
      ON relationship_assertion_events(assertion_id,sequence);

    CREATE TABLE IF NOT EXISTS contact_context_snapshots(
      snapshot_id TEXT PRIMARY KEY,
      contact_id TEXT NOT NULL,
      trace_id TEXT NOT NULL DEFAULT '',
      version INTEGER NOT NULL,
      context_json TEXT NOT NULL DEFAULT '{}',
      source_assertion_ids_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      FOREIGN KEY(contact_id) REFERENCES contact_aggregates(contact_id) ON DELETE RESTRICT,
      UNIQUE(contact_id,version)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_contact_context_snapshots_contact
      ON contact_context_snapshots(contact_id,version DESC);

    CREATE TRIGGER IF NOT EXISTS trg_relationship_assertions_v2_append_only_update
    BEFORE UPDATE ON relationship_assertions_v2
    BEGIN SELECT RAISE(ABORT, 'relationship assertions are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS trg_relationship_assertions_v2_append_only_delete
    BEFORE DELETE ON relationship_assertions_v2
    BEGIN SELECT RAISE(ABORT, 'relationship assertions are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS trg_relationship_assertion_events_append_only_update
    BEFORE UPDATE ON relationship_assertion_events
    BEGIN SELECT RAISE(ABORT, 'relationship assertion events are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS trg_relationship_assertion_events_append_only_delete
    BEFORE DELETE ON relationship_assertion_events
    BEGIN SELECT RAISE(ABORT, 'relationship assertion events are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS trg_contact_context_snapshots_append_only_update
    BEFORE UPDATE ON contact_context_snapshots
    BEGIN SELECT RAISE(ABORT, 'contact context snapshots are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS trg_contact_context_snapshots_append_only_delete
    BEFORE DELETE ON contact_context_snapshots
    BEGIN SELECT RAISE(ABORT, 'contact context snapshots are append-only'); END;

    CREATE TABLE IF NOT EXISTS ai_learning_receipts_v2(
      learning_receipt_id TEXT PRIMARY KEY,
      trace_id TEXT NOT NULL,
      contact_id TEXT NOT NULL,
      contact_snapshot_id TEXT NOT NULL,
      candidate_trace_id TEXT NOT NULL,
      delivery_attempt_id TEXT NOT NULL,
      source_kind TEXT NOT NULL,
      review_outcome TEXT NOT NULL,
      version INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(contact_id) REFERENCES contact_aggregates(contact_id) ON DELETE RESTRICT,
      FOREIGN KEY(contact_snapshot_id) REFERENCES contact_context_snapshots(snapshot_id) ON DELETE RESTRICT,
      FOREIGN KEY(delivery_attempt_id) REFERENCES communication_delivery_attempts(attempt_id) ON DELETE RESTRICT,
      UNIQUE(contact_id,version),
      UNIQUE(candidate_trace_id,delivery_attempt_id,contact_snapshot_id)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_ai_learning_receipts_v2_contact
      ON ai_learning_receipts_v2(contact_id,version DESC);

    CREATE TABLE IF NOT EXISTS ai_learning_receipt_events(
      event_id TEXT PRIMARY KEY,
      learning_receipt_id TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      action TEXT NOT NULL CHECK(action IN ('created','approve','reject','start-shadow','activate','revoke','rollback')),
      actor TEXT NOT NULL DEFAULT '',
      reason_code TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      FOREIGN KEY(learning_receipt_id) REFERENCES ai_learning_receipts_v2(learning_receipt_id) ON DELETE RESTRICT,
      UNIQUE(learning_receipt_id,sequence)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_ai_learning_receipt_events_receipt
      ON ai_learning_receipt_events(learning_receipt_id,sequence);

    CREATE TABLE IF NOT EXISTS ai_learning_retrieval_receipts(
      retrieval_receipt_id TEXT PRIMARY KEY,
      learning_receipt_id TEXT NOT NULL,
      trace_id TEXT NOT NULL,
      contact_snapshot_id TEXT NOT NULL,
      purpose TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      FOREIGN KEY(learning_receipt_id) REFERENCES ai_learning_receipts_v2(learning_receipt_id) ON DELETE RESTRICT,
      FOREIGN KEY(contact_snapshot_id) REFERENCES contact_context_snapshots(snapshot_id) ON DELETE RESTRICT
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_ai_learning_retrieval_receipts_trace
      ON ai_learning_retrieval_receipts(trace_id,created_at,retrieval_receipt_id);

    CREATE TRIGGER IF NOT EXISTS trg_ai_learning_receipts_v2_append_only_update
    BEFORE UPDATE ON ai_learning_receipts_v2
    BEGIN SELECT RAISE(ABORT, 'learning receipts are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS trg_ai_learning_receipts_v2_append_only_delete
    BEFORE DELETE ON ai_learning_receipts_v2
    BEGIN SELECT RAISE(ABORT, 'learning receipts are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS trg_ai_learning_receipt_events_append_only_update
    BEFORE UPDATE ON ai_learning_receipt_events
    BEGIN SELECT RAISE(ABORT, 'learning receipt events are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS trg_ai_learning_receipt_events_append_only_delete
    BEFORE DELETE ON ai_learning_receipt_events
    BEGIN SELECT RAISE(ABORT, 'learning receipt events are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS trg_ai_learning_retrieval_receipts_append_only_update
    BEFORE UPDATE ON ai_learning_retrieval_receipts
    BEGIN SELECT RAISE(ABORT, 'learning retrieval receipts are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS trg_ai_learning_retrieval_receipts_append_only_delete
    BEFORE DELETE ON ai_learning_retrieval_receipts
    BEGIN SELECT RAISE(ABORT, 'learning retrieval receipts are append-only'); END;

    CREATE TABLE IF NOT EXISTS architecture_shadow_comparisons(
      comparison_id TEXT PRIMARY KEY,
      authority TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      legacy_hash TEXT NOT NULL,
      authority_hash TEXT NOT NULL,
      is_match INTEGER NOT NULL CHECK(is_match IN (0,1)),
      observed_at TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_architecture_shadow_comparisons_window
      ON architecture_shadow_comparisons(authority,observed_at DESC,comparison_id DESC);
    CREATE TRIGGER IF NOT EXISTS trg_architecture_shadow_comparisons_append_only_update
    BEFORE UPDATE ON architecture_shadow_comparisons
    BEGIN SELECT RAISE(ABORT, 'shadow comparisons are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS trg_architecture_shadow_comparisons_append_only_delete
    BEFORE DELETE ON architecture_shadow_comparisons
    BEGIN SELECT RAISE(ABORT, 'shadow comparisons are append-only'); END;
  `);
}
function ensureConsistency(db) {
  for (const table of ['evidence_traces', 'evidence_observations', 'durable_executions', 'durable_execution_events', 'communication_canonical_messages', 'communication_media_assets', 'communication_delivery_attempts', 'communication_delivery_receipts', 'communication_sync_checkpoints', 'contact_aggregates', 'contact_external_identities', 'contact_identity_link_events', 'contact_message_bindings', 'relationship_assertions_v2', 'relationship_assertion_events', 'contact_context_snapshots', 'ai_learning_receipts_v2', 'ai_learning_receipt_events', 'ai_learning_retrieval_receipts', 'architecture_shadow_comparisons']) {
    if (!tableExists(db, table)) throw Object.assign(new Error(`Schema 19 missing ${table}`), { code: 'SCHEMA_19_EVIDENCE_TABLE_MISSING', table });
  }
  for (const trigger of ['trg_evidence_observations_append_only_update', 'trg_evidence_observations_append_only_delete', 'trg_durable_execution_events_append_only_update', 'trg_durable_execution_events_append_only_delete', 'trg_communication_delivery_receipts_append_only_update', 'trg_communication_delivery_receipts_append_only_delete', 'trg_relationship_assertions_v2_append_only_update', 'trg_relationship_assertions_v2_append_only_delete', 'trg_relationship_assertion_events_append_only_update', 'trg_relationship_assertion_events_append_only_delete', 'trg_contact_context_snapshots_append_only_update', 'trg_contact_context_snapshots_append_only_delete', 'trg_ai_learning_receipts_v2_append_only_update', 'trg_ai_learning_receipts_v2_append_only_delete', 'trg_ai_learning_receipt_events_append_only_update', 'trg_ai_learning_receipt_events_append_only_delete', 'trg_ai_learning_retrieval_receipts_append_only_update', 'trg_ai_learning_retrieval_receipts_append_only_delete', 'trg_architecture_shadow_comparisons_append_only_update', 'trg_architecture_shadow_comparisons_append_only_delete']) {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='trigger' AND name=?").get(trigger)) {
      throw Object.assign(new Error(`Schema 19 missing ${trigger}`), { code: 'SCHEMA_19_EVIDENCE_TRIGGER_MISSING', trigger });
    }
  }
  return { schemaVersion: schemaVersion(db), evidenceAuthority: true, durableExecutionAuthority: true, communicationAuthority: true, contactRelationshipAuthority: true, aiReplyLearningAuthority: true, appendOnly: true };
}
function applyBatch41Fix6MArchitectureReferenceClosure(db) {
  ensureMigrationTable(db);
  const current = schemaVersion(db);
  const receipt = db.prepare('SELECT * FROM r32_schema_migrations WHERE migration_id=?').get(MIGRATION_ID);
  if (receipt?.status === 'completed' && current >= TARGET_SCHEMA_VERSION && receipt.checksum === CHECKSUM) {
    ensureObjects(db);
    return { ok: true, executed: false, migrationId: MIGRATION_ID, schemaVersion: current, consistency: ensureConsistency(db) };
  }
  const startedAt = nowIso();
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`INSERT INTO r32_schema_migrations(migration_id,target_schema_version,status,checksum,started_at,completed_at,report_json)
      VALUES(?,?,'running',?,?,'','{}')
      ON CONFLICT(migration_id) DO UPDATE SET status='running',checksum=excluded.checksum,started_at=excluded.started_at,completed_at='',report_json='{}'`)
      .run(MIGRATION_ID, TARGET_SCHEMA_VERSION, CHECKSUM, startedAt);
    ensureObjects(db);
    const completedAt = nowIso();
    setSchemaVersion(db, TARGET_SCHEMA_VERSION, completedAt);
    db.prepare("UPDATE r32_schema_migrations SET status='completed',completed_at=?,report_json=? WHERE migration_id=?")
      .run(completedAt, JSON.stringify({ migrationId: MIGRATION_ID, schemaVersion: TARGET_SCHEMA_VERSION, completedAt }), MIGRATION_ID);
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch (_) {}
    throw error;
  }
  return { ok: true, executed: true, migrationId: MIGRATION_ID, schemaVersion: TARGET_SCHEMA_VERSION, consistency: ensureConsistency(db) };
}

module.exports = {
  MIGRATION_ID,
  TARGET_SCHEMA_VERSION,
  CHECKSUM,
  applyBatch41Fix6MArchitectureReferenceClosure,
  ensureConsistency
};
