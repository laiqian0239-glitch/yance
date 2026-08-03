'use strict';

const crypto = require('node:crypto');
const {
  isArchitectureClosureV2WpAIntegrityApplied
} = require('./architectureClosureV2WpAIntegrity');
const { STATES } = require('../services/durableExecutionLifecycle');

const MIGRATION_ID = '023_architecture_closure_v2_wp_b';
const TARGET_SCHEMA_VERSION = 23;
const DURABLE_EXECUTION_STATES = Object.freeze(Object.values(STATES));
const DURABLE_EXECUTION_COLUMNS = Object.freeze([
  'execution_id',
  'trace_id',
  'operation_kind',
  'idempotency_key',
  'command_content_sha256',
  'content_hash_version',
  'state',
  'state_version',
  'generation',
  'owner_id',
  'claim_id',
  'lease_sequence',
  'host_generation',
  'fencing_token',
  'lease_started_at',
  'lease_expires_at',
  'heartbeat_sequence',
  'last_heartbeat_at',
  'deadline_at',
  'cancellation_requested_at',
  'cancellation_actor',
  'retry_count',
  'max_attempts',
  'next_attempt_at',
  'failure_code',
  'terminal_receipt_id',
  'metadata_json',
  'created_at',
  'updated_at',
  'completed_at'
]);
const EXTERNAL_ACTION_RECEIPT_COLUMNS = Object.freeze([
  'receipt_id',
  'intent_id',
  'attempt_id',
  'receipt_type',
  'provider_receipt_id',
  'evidence_reference',
  'receipt_content_sha256',
  'result_json',
  'authority_timestamp',
  'created_at'
]);
const EXTERNAL_OUTCOME_RECONCILIATION_COLUMNS = Object.freeze([
  'reconciliation_id',
  'intent_id',
  'attempt_id',
  'observation_outcome',
  'evidence_reference',
  'remote_receipt_id',
  'observation_json',
  'reconciliation_content_sha256',
  'content_hash_version',
  'observed_at',
  'authority_timestamp',
  'created_at'
]);
const APPEND_ONLY_TABLES = Object.freeze([
  'external_action_intents',
  'external_action_attempts',
  'external_action_receipts',
  'external_outcome_reconciliations',
  'durable_execution_checkpoints'
]);
const MUTABLE_CAS_TABLES = Object.freeze(['external_action_claims']);
const WP_B_SCHEMA_CONTRACT = Object.freeze({
  authority: 'DurableExecutionAuthorityV2',
  schemaVersion: TARGET_SCHEMA_VERSION,
  durableExecutionTable: 'durable_executions',
  durableExecutionColumns: DURABLE_EXECUTION_COLUMNS,
  durableExecutionStates: DURABLE_EXECUTION_STATES,
  externalActionReceiptColumns: EXTERNAL_ACTION_RECEIPT_COLUMNS,
  externalOutcomeReconciliationColumns: EXTERNAL_OUTCOME_RECONCILIATION_COLUMNS,
  attemptIntentBindingPolicy: 'COMPOSITE_ATTEMPT_INTENT_FOREIGN_KEY',
  reconciliationHashPolicy: 'VERSION_ONE_SHA256_REQUIRED',
  appendOnlyTables: APPEND_ONLY_TABLES,
  mutableCasTables: MUTABLE_CAS_TABLES,
  timeAuthority: 'APPLICATION_ASSIGNED_ONLY',
  legacyExecutionHashPolicy: 'VERSION_ZERO_EMPTY_HASH_ONLY',
  newExecutionHashPolicy: 'VERSION_ONE_SHA256_REQUIRED',
  externalActionIntentPolicy: 'IMMUTABLE_INTENT_WITH_SEPARATE_MUTABLE_CAS_CLAIM'
});
const MIGRATION_CHECKSUM = crypto.createHash('sha256')
  .update(JSON.stringify({ migrationId: MIGRATION_ID, contract: WP_B_SCHEMA_CONTRACT }))
  .digest('hex');

function migrationError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, ...details });
}

function requiredTimestamp(value, field = 'at') {
  const source = String(value == null ? '' : value);
  const epochMs = Date.parse(source);
  if (!Number.isFinite(epochMs) || new Date(epochMs).toISOString() !== source) {
    throw migrationError(
      'ACV2_WP_B_MIGRATION_TIMESTAMP_REQUIRED',
      `${field} must be an explicit normalized UTC ISO-8601 timestamp`,
      { field }
    );
  }
  return source;
}

function tableExists(db, table) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table));
}

function triggerExists(db, name, table) {
  return Boolean(db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='trigger' AND name=? AND tbl_name=?"
  ).get(name, table));
}

function actualColumns(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map(row => String(row.name));
}

function ensureMigrationTable(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS r32_schema_migrations(
    migration_id TEXT PRIMARY KEY,
    target_schema_version INTEGER NOT NULL,
    status TEXT NOT NULL,
    checksum TEXT NOT NULL DEFAULT '',
    started_at TEXT NOT NULL,
    completed_at TEXT NOT NULL DEFAULT '',
    report_json TEXT NOT NULL DEFAULT '{}'
  ) STRICT;`);
}

function ensureMetaTable(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS r32_meta(
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;`);
}

function currentSchemaVersion(db) {
  if (!tableExists(db, 'r32_meta')) return 0;
  const rows = db.prepare(
    "SELECT value_json FROM r32_meta WHERE key IN ('schema_version','schemaVersion')"
  ).all();
  const versions = rows.map(row => {
    try { return Number(JSON.parse(row.value_json)); } catch (_) { return Number(row.value_json); }
  }).filter(Number.isSafeInteger);
  return versions.length ? Math.max(...versions) : 0;
}

function setSchemaVersion(db, value, at) {
  ensureMetaTable(db);
  const statement = db.prepare(`INSERT INTO r32_meta(key,value_json,updated_at) VALUES(?,?,?)
    ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at`);
  const encoded = JSON.stringify(Number(value));
  statement.run('schema_version', encoded, at);
  statement.run('schemaVersion', encoded, at);
}

function appendOnlyTriggerName(table, operation) {
  return `trg_${table}_append_only_${operation}`;
}

function ensureAppendOnlyTriggers(db, table) {
  for (const operation of ['update', 'delete']) {
    const trigger = appendOnlyTriggerName(table, operation);
    db.exec(`CREATE TRIGGER IF NOT EXISTS ${trigger}
      BEFORE ${operation.toUpperCase()} ON ${table}
      BEGIN SELECT RAISE(ABORT,'${table} append-only'); END;`);
  }
}

function createDurableExecutionV23Tables(db) {
  const states = DURABLE_EXECUTION_STATES.map(state => `'${state}'`).join(',');
  db.exec(`
    CREATE TABLE durable_executions_v23_new(
      execution_id TEXT PRIMARY KEY,
      trace_id TEXT NOT NULL DEFAULT '',
      operation_kind TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      command_content_sha256 TEXT NOT NULL DEFAULT '',
      content_hash_version INTEGER NOT NULL DEFAULT 0 CHECK(content_hash_version IN (0,1)),
      state TEXT NOT NULL CHECK(state IN (${states})),
      state_version INTEGER NOT NULL DEFAULT 0 CHECK(state_version>=0),
      generation INTEGER NOT NULL DEFAULT 0 CHECK(generation>=0),
      owner_id TEXT NOT NULL DEFAULT '',
      claim_id TEXT NOT NULL DEFAULT '',
      lease_sequence INTEGER NOT NULL DEFAULT 0 CHECK(lease_sequence>=0),
      host_generation INTEGER NOT NULL DEFAULT 0 CHECK(host_generation>=0),
      fencing_token INTEGER NOT NULL DEFAULT 0 CHECK(fencing_token>=0),
      lease_started_at TEXT NOT NULL DEFAULT '',
      lease_expires_at TEXT NOT NULL DEFAULT '',
      heartbeat_sequence INTEGER NOT NULL DEFAULT 0 CHECK(heartbeat_sequence>=0),
      last_heartbeat_at TEXT NOT NULL DEFAULT '',
      deadline_at TEXT NOT NULL DEFAULT '',
      cancellation_requested_at TEXT NOT NULL DEFAULT '',
      cancellation_actor TEXT NOT NULL DEFAULT '',
      retry_count INTEGER NOT NULL DEFAULT 0 CHECK(retry_count>=0),
      max_attempts INTEGER NOT NULL DEFAULT 3 CHECK(max_attempts>=1),
      next_attempt_at TEXT NOT NULL DEFAULT '',
      failure_code TEXT NOT NULL DEFAULT '',
      terminal_receipt_id TEXT NOT NULL DEFAULT '',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT NOT NULL DEFAULT '',
      CHECK(
        (content_hash_version=0 AND command_content_sha256='')
        OR
        (content_hash_version=1
          AND length(command_content_sha256)=64
          AND lower(command_content_sha256)=command_content_sha256
          AND command_content_sha256 NOT GLOB '*[^0-9a-f]*')
      ),
      CHECK(
        (claim_id='' AND owner_id='' AND host_generation=0 AND fencing_token=0)
        OR
        (claim_id<>'' AND owner_id<>'' AND host_generation>=1 AND fencing_token>=1)
      ),
      UNIQUE(operation_kind,idempotency_key)
    ) STRICT;

    CREATE TABLE durable_execution_events_v23_new(
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
      FOREIGN KEY(execution_id) REFERENCES durable_executions_v23_new(execution_id) ON DELETE RESTRICT,
      UNIQUE(execution_id,sequence)
    ) STRICT;
  `);
}

function copyLegacyDurableExecutions(db) {
  db.exec(`INSERT INTO durable_executions_v23_new(
      execution_id,trace_id,operation_kind,idempotency_key,command_content_sha256,
      content_hash_version,state,state_version,generation,owner_id,claim_id,lease_sequence,
      host_generation,fencing_token,lease_started_at,lease_expires_at,heartbeat_sequence,
      last_heartbeat_at,deadline_at,cancellation_requested_at,cancellation_actor,retry_count,
      max_attempts,next_attempt_at,failure_code,terminal_receipt_id,metadata_json,created_at,
      updated_at,completed_at
    )
    SELECT
      execution_id,trace_id,operation_kind,idempotency_key,'',0,state,0,generation,
      '', '', lease_sequence,0,0,'','',0,last_heartbeat_at,'',
      cancellation_requested_at,cancellation_actor,retry_count,max_attempts,next_attempt_at,
      failure_code,'',metadata_json,created_at,updated_at,completed_at
    FROM durable_executions;

    INSERT INTO durable_execution_events_v23_new(
      event_id,execution_id,sequence,event_type,from_state,to_state,generation,
      owner_id,reason_code,payload_json,created_at
    )
    SELECT event_id,execution_id,sequence,event_type,from_state,to_state,generation,
      owner_id,reason_code,payload_json,created_at
    FROM durable_execution_events;
  `);
}

function replaceLegacyDurableExecutionTables(db) {
  db.exec(`
    DROP TABLE durable_execution_events;
    DROP TABLE durable_executions;
    ALTER TABLE durable_executions_v23_new RENAME TO durable_executions;
    ALTER TABLE durable_execution_events_v23_new RENAME TO durable_execution_events;

    CREATE INDEX idx_durable_executions_state_v23
      ON durable_executions(state,next_attempt_at,deadline_at,updated_at,execution_id);
    CREATE INDEX idx_durable_executions_claim_v23
      ON durable_executions(state,lease_expires_at,host_generation,fencing_token,execution_id);
    CREATE INDEX idx_durable_executions_trace_v23
      ON durable_executions(trace_id,created_at,execution_id) WHERE trace_id<>'';
    CREATE INDEX idx_durable_execution_events_execution_v23
      ON durable_execution_events(execution_id,sequence);

    CREATE TRIGGER trg_durable_execution_events_append_only_update
      BEFORE UPDATE ON durable_execution_events
      BEGIN SELECT RAISE(ABORT,'durable execution events are append-only'); END;
    CREATE TRIGGER trg_durable_execution_events_append_only_delete
      BEFORE DELETE ON durable_execution_events
      BEGIN SELECT RAISE(ABORT,'durable execution events are append-only'); END;

    CREATE TRIGGER trg_durable_executions_v23_hash_insert
      BEFORE INSERT ON durable_executions
      WHEN NEW.content_hash_version<>1
        OR length(NEW.command_content_sha256)<>64
        OR lower(NEW.command_content_sha256)<>NEW.command_content_sha256
        OR NEW.command_content_sha256 GLOB '*[^0-9a-f]*'
      BEGIN SELECT RAISE(ABORT,'new durable execution requires verified command hash'); END;
  `);
}

function createWpBFactTables(db) {
  db.exec(`
    CREATE TABLE external_action_intents(
      intent_id TEXT PRIMARY KEY,
      execution_id TEXT NOT NULL,
      action_kind TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      intent_content_sha256 TEXT NOT NULL CHECK(length(intent_content_sha256)=64),
      content_hash_version INTEGER NOT NULL CHECK(content_hash_version=1),
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(execution_id) REFERENCES durable_executions(execution_id) ON DELETE RESTRICT,
      CHECK(lower(intent_content_sha256)=intent_content_sha256),
      CHECK(intent_content_sha256 NOT GLOB '*[^0-9a-f]*'),
      UNIQUE(action_kind,idempotency_key)
    ) STRICT;
    CREATE INDEX idx_external_action_intents_execution
      ON external_action_intents(execution_id,created_at,intent_id);

    CREATE TABLE external_action_claims(
      intent_id TEXT PRIMARY KEY,
      state TEXT NOT NULL CHECK(state IN (
        'READY','CLAIMED','ATTEMPTED','COMPLETED','FAILED','UNCERTAIN','CANCELLED'
      )),
      state_version INTEGER NOT NULL DEFAULT 0 CHECK(state_version>=0),
      generation INTEGER NOT NULL DEFAULT 0 CHECK(generation>=0),
      owner_id TEXT NOT NULL DEFAULT '',
      claim_id TEXT NOT NULL DEFAULT '',
      host_generation INTEGER NOT NULL DEFAULT 0 CHECK(host_generation>=0),
      fencing_token INTEGER NOT NULL DEFAULT 0 CHECK(fencing_token>=0),
      lease_started_at TEXT NOT NULL DEFAULT '',
      lease_expires_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL,
      FOREIGN KEY(intent_id) REFERENCES external_action_intents(intent_id) ON DELETE RESTRICT,
      CHECK(
        (state='READY' AND claim_id='' AND owner_id='' AND host_generation=0 AND fencing_token=0)
        OR
        (state<>'READY' AND claim_id<>'' AND owner_id<>'' AND host_generation>=1 AND fencing_token>=1)
      )
    ) STRICT;
    CREATE INDEX idx_external_action_claims_ready
      ON external_action_claims(state,lease_expires_at,updated_at,intent_id);

    CREATE TABLE external_action_attempts(
      attempt_id TEXT PRIMARY KEY,
      intent_id TEXT NOT NULL,
      attempt_sequence INTEGER NOT NULL CHECK(attempt_sequence>=1),
      claim_id TEXT NOT NULL,
      generation INTEGER NOT NULL CHECK(generation>=1),
      host_generation INTEGER NOT NULL CHECK(host_generation>=1),
      fencing_token INTEGER NOT NULL CHECK(fencing_token>=1),
      request_content_sha256 TEXT NOT NULL CHECK(length(request_content_sha256)=64),
      authority_timestamp TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(intent_id) REFERENCES external_action_intents(intent_id) ON DELETE RESTRICT,
      CHECK(lower(request_content_sha256)=request_content_sha256),
      CHECK(request_content_sha256 NOT GLOB '*[^0-9a-f]*'),
      UNIQUE(intent_id,attempt_sequence),
      UNIQUE(intent_id,claim_id,generation),
      UNIQUE(attempt_id,intent_id)
    ) STRICT;
    CREATE INDEX idx_external_action_attempts_intent
      ON external_action_attempts(intent_id,attempt_sequence);

    CREATE TABLE external_action_receipts(
      receipt_id TEXT PRIMARY KEY,
      intent_id TEXT NOT NULL,
      attempt_id TEXT,
      receipt_type TEXT NOT NULL CHECK(receipt_type IN (
        'SUCCESS','FAILURE','UNKNOWN','LATE_RESULT','MANUAL_RESOLUTION'
      )),
      provider_receipt_id TEXT NOT NULL DEFAULT '',
      evidence_reference TEXT NOT NULL,
      receipt_content_sha256 TEXT NOT NULL CHECK(length(receipt_content_sha256)=64),
      result_json TEXT NOT NULL DEFAULT '{}',
      authority_timestamp TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(intent_id) REFERENCES external_action_intents(intent_id) ON DELETE RESTRICT,
      FOREIGN KEY(attempt_id,intent_id)
        REFERENCES external_action_attempts(attempt_id,intent_id) ON DELETE RESTRICT,
      CHECK(lower(receipt_content_sha256)=receipt_content_sha256),
      CHECK(receipt_content_sha256 NOT GLOB '*[^0-9a-f]*'),
      CHECK(
        (receipt_type='MANUAL_RESOLUTION' AND attempt_id IS NULL)
        OR
        (receipt_type<>'MANUAL_RESOLUTION' AND attempt_id IS NOT NULL)
      ),
      UNIQUE(intent_id,receipt_content_sha256)
    ) STRICT;
    CREATE INDEX idx_external_action_receipts_intent
      ON external_action_receipts(intent_id,created_at,receipt_id);
    CREATE INDEX idx_external_action_receipts_attempt
      ON external_action_receipts(attempt_id,created_at,receipt_id) WHERE attempt_id IS NOT NULL;

    CREATE TABLE external_outcome_reconciliations(
      reconciliation_id TEXT PRIMARY KEY,
      intent_id TEXT NOT NULL,
      attempt_id TEXT NOT NULL,
      observation_outcome TEXT NOT NULL CHECK(observation_outcome IN (
        'REMOTE_SUCCESS_PROVEN','REMOTE_ABSENCE_PROVEN','REMOTE_RESULT_UNKNOWN'
      )),
      evidence_reference TEXT NOT NULL,
      remote_receipt_id TEXT NOT NULL DEFAULT '',
      observation_json TEXT NOT NULL DEFAULT '{}',
      reconciliation_content_sha256 TEXT NOT NULL CHECK(length(reconciliation_content_sha256)=64),
      content_hash_version INTEGER NOT NULL CHECK(content_hash_version=1),
      observed_at TEXT NOT NULL,
      authority_timestamp TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(intent_id) REFERENCES external_action_intents(intent_id) ON DELETE RESTRICT,
      FOREIGN KEY(attempt_id,intent_id)
        REFERENCES external_action_attempts(attempt_id,intent_id) ON DELETE RESTRICT,
      CHECK(lower(reconciliation_content_sha256)=reconciliation_content_sha256),
      CHECK(reconciliation_content_sha256 NOT GLOB '*[^0-9a-f]*'),
      UNIQUE(intent_id,reconciliation_content_sha256)
    ) STRICT;
    CREATE INDEX idx_external_outcome_reconciliations_intent
      ON external_outcome_reconciliations(intent_id,created_at,reconciliation_id);

    CREATE TABLE durable_execution_checkpoints(
      checkpoint_id TEXT PRIMARY KEY,
      execution_id TEXT NOT NULL,
      sequence INTEGER NOT NULL CHECK(sequence>=1),
      state TEXT NOT NULL,
      state_version INTEGER NOT NULL CHECK(state_version>=0),
      generation INTEGER NOT NULL CHECK(generation>=0),
      owner_id TEXT NOT NULL DEFAULT '',
      claim_id TEXT NOT NULL DEFAULT '',
      host_generation INTEGER NOT NULL DEFAULT 0 CHECK(host_generation>=0),
      fencing_token INTEGER NOT NULL DEFAULT 0 CHECK(fencing_token>=0),
      snapshot_json TEXT NOT NULL,
      snapshot_sha256 TEXT NOT NULL CHECK(length(snapshot_sha256)=64),
      authority_timestamp TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(execution_id) REFERENCES durable_executions(execution_id) ON DELETE RESTRICT,
      CHECK(lower(snapshot_sha256)=snapshot_sha256),
      CHECK(snapshot_sha256 NOT GLOB '*[^0-9a-f]*'),
      UNIQUE(execution_id,sequence)
    ) STRICT;
    CREATE INDEX idx_durable_execution_checkpoints_execution
      ON durable_execution_checkpoints(execution_id,sequence);
  `);

  for (const table of APPEND_ONLY_TABLES) ensureAppendOnlyTriggers(db, table);
}

function ensureExactColumns(db, table, expected) {
  const actual = actualColumns(db, table);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw migrationError(
      'ACV2_WP_B_SCHEMA_CONTRACT_MISMATCH',
      `Schema 23 table ${table} does not match the frozen column contract`,
      { table, expectedColumns: expected, actualColumns: actual }
    );
  }
}

function ensureConsistency(db) {
  ensureExactColumns(db, 'durable_executions', DURABLE_EXECUTION_COLUMNS);
  ensureExactColumns(db, 'external_action_receipts', EXTERNAL_ACTION_RECEIPT_COLUMNS);
  ensureExactColumns(
    db,
    'external_outcome_reconciliations',
    EXTERNAL_OUTCOME_RECONCILIATION_COLUMNS
  );

  for (const table of [...APPEND_ONLY_TABLES, ...MUTABLE_CAS_TABLES]) {
    if (!tableExists(db, table)) {
      throw migrationError('ACV2_WP_B_TABLE_MISSING', `Schema 23 table ${table} is missing`, { table });
    }
  }

  for (const table of APPEND_ONLY_TABLES) {
    for (const operation of ['update', 'delete']) {
      const trigger = appendOnlyTriggerName(table, operation);
      if (!triggerExists(db, trigger, table)) {
        throw migrationError(
          'ACV2_WP_B_APPEND_ONLY_TRIGGER_MISSING',
          `Schema 23 append-only trigger ${trigger} is missing`,
          { table, operation }
        );
      }
    }
  }

  for (const operation of ['update', 'delete']) {
    const forbidden = appendOnlyTriggerName('external_action_claims', operation);
    if (triggerExists(db, forbidden, 'external_action_claims')) {
      throw migrationError(
        'ACV2_WP_B_CAS_TABLE_IMMUTABLY_BLOCKED',
        'External action claims must remain mutable only through predicate-complete CAS',
        { operation }
      );
    }
  }

  if (!triggerExists(db, 'trg_durable_executions_v23_hash_insert', 'durable_executions')) {
    throw migrationError(
      'ACV2_WP_B_EXECUTION_HASH_TRIGGER_MISSING',
      'Schema 23 new execution hash trigger is missing'
    );
  }

  const invalidExecution = db.prepare(`SELECT execution_id FROM durable_executions
    WHERE NOT (
      (content_hash_version=0 AND command_content_sha256='')
      OR
      (content_hash_version=1 AND length(command_content_sha256)=64
        AND lower(command_content_sha256)=command_content_sha256
        AND command_content_sha256 NOT GLOB '*[^0-9a-f]*')
    ) LIMIT 1`).get();
  if (invalidExecution) {
    throw migrationError(
      'ACV2_WP_B_EXECUTION_HASH_INVALID',
      'Schema 23 contains an unverifiable durable execution command hash',
      { executionId: String(invalidExecution.execution_id || '') }
    );
  }
}

function migrationResult() {
  return Object.freeze({
    migrationId: MIGRATION_ID,
    targetSchemaVersion: TARGET_SCHEMA_VERSION,
    checksum: MIGRATION_CHECKSUM,
    authority: WP_B_SCHEMA_CONTRACT.authority,
    appendOnlyTableCount: APPEND_ONLY_TABLES.length,
    mutableCasTableCount: MUTABLE_CAS_TABLES.length
  });
}

function isArchitectureClosureV2WpBApplied(db) {
  if (!tableExists(db, 'r32_schema_migrations')) return false;
  const row = db.prepare(
    'SELECT status,checksum FROM r32_schema_migrations WHERE migration_id=?'
  ).get(MIGRATION_ID);
  if (!row) return false;
  if (String(row.checksum || '') !== MIGRATION_CHECKSUM) {
    throw migrationError(
      'ACV2_WP_B_MIGRATION_CHECKSUM_MISMATCH',
      'Schema 23 WP-B migration checksum mismatch',
      { expectedChecksum: MIGRATION_CHECKSUM, actualChecksum: String(row.checksum || '') }
    );
  }
  if (String(row.status || '') !== 'completed') {
    throw migrationError(
      'ACV2_WP_B_MIGRATION_INCOMPLETE',
      'Schema 23 WP-B migration is not completed'
    );
  }
  ensureConsistency(db);
  return true;
}

function applyArchitectureClosureV2WpB(db, options = {}) {
  if (!db || typeof db.prepare !== 'function' || typeof db.exec !== 'function') {
    throw new TypeError('Schema 23 WP-B migration requires a SQLite database');
  }
  const at = requiredTimestamp(options.at, 'options.at');
  const schemaVersion = currentSchemaVersion(db);
  if (schemaVersion > TARGET_SCHEMA_VERSION) {
    throw migrationError(
      'ACV2_WP_B_FUTURE_SCHEMA_UNSUPPORTED',
      'Schema 23 migration refuses a future database schema',
      { schemaVersion, targetSchemaVersion: TARGET_SCHEMA_VERSION }
    );
  }
  if (!isArchitectureClosureV2WpAIntegrityApplied(db)) {
    throw migrationError(
      'ACV2_WP_B_SCHEMA_22_REQUIRED',
      'Schema 23 requires completed Schema 22 WP-A integrity migration'
    );
  }

  ensureMigrationTable(db);
  const existing = db.prepare('SELECT * FROM r32_schema_migrations WHERE migration_id=?').get(MIGRATION_ID);
  if (existing && String(existing.checksum || '') !== MIGRATION_CHECKSUM) {
    throw migrationError(
      'ACV2_WP_B_MIGRATION_CHECKSUM_MISMATCH',
      'Schema 23 WP-B migration checksum mismatch',
      { expectedChecksum: MIGRATION_CHECKSUM, actualChecksum: String(existing.checksum || '') }
    );
  }
  if (existing && String(existing.status || '') === 'completed') {
    ensureConsistency(db);
    setSchemaVersion(db, TARGET_SCHEMA_VERSION, at);
    return migrationResult();
  }
  if (existing) {
    throw migrationError(
      'ACV2_WP_B_MIGRATION_INCOMPLETE',
      'Schema 23 migration row exists without completed status'
    );
  }
  if (!tableExists(db, 'durable_executions') || !tableExists(db, 'durable_execution_events')) {
    throw migrationError(
      'ACV2_WP_B_DURABLE_EXECUTION_BASE_MISSING',
      'Schema 23 requires the existing durable execution authority tables'
    );
  }

  db.exec('SAVEPOINT acv2_wp_b_v23');
  try {
    createDurableExecutionV23Tables(db);
    copyLegacyDurableExecutions(db);
    replaceLegacyDurableExecutionTables(db);
    createWpBFactTables(db);
    ensureConsistency(db);
    setSchemaVersion(db, TARGET_SCHEMA_VERSION, at);
    const report = JSON.stringify({
      authority: WP_B_SCHEMA_CONTRACT.authority,
      schemaVersion: TARGET_SCHEMA_VERSION,
      migrationChecksum: MIGRATION_CHECKSUM,
      durableExecutionColumns: DURABLE_EXECUTION_COLUMNS.length,
      appendOnlyTables: APPEND_ONLY_TABLES.length,
      mutableCasTables: MUTABLE_CAS_TABLES.length,
      schema23Applied: true
    });
    db.prepare(`INSERT INTO r32_schema_migrations(
      migration_id,target_schema_version,status,checksum,started_at,completed_at,report_json
    ) VALUES(?,?,?,?,?,?,?)`)
      .run(MIGRATION_ID, TARGET_SCHEMA_VERSION, 'completed', MIGRATION_CHECKSUM, at, at, report);
    db.exec('RELEASE SAVEPOINT acv2_wp_b_v23');
  } catch (error) {
    try { db.exec('ROLLBACK TO SAVEPOINT acv2_wp_b_v23'); } catch (_) {}
    try { db.exec('RELEASE SAVEPOINT acv2_wp_b_v23'); } catch (_) {}
    throw error;
  }
  return migrationResult();
}

module.exports = Object.freeze({
  MIGRATION_ID,
  TARGET_SCHEMA_VERSION,
  MIGRATION_CHECKSUM,
  WP_B_SCHEMA_CONTRACT,
  DURABLE_EXECUTION_STATES,
  DURABLE_EXECUTION_COLUMNS,
  EXTERNAL_ACTION_RECEIPT_COLUMNS,
  EXTERNAL_OUTCOME_RECONCILIATION_COLUMNS,
  APPEND_ONLY_TABLES,
  MUTABLE_CAS_TABLES,
  appendOnlyTriggerName,
  createDurableExecutionV23Tables,
  createWpBFactTables,
  ensureConsistency,
  isArchitectureClosureV2WpBApplied,
  applyArchitectureClosureV2WpB
});
