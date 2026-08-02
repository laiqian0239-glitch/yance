'use strict';

const crypto = require('node:crypto');

const MIGRATION_ID = '021_architecture_closure_v2_wp_a';
const TARGET_SCHEMA_VERSION = 21;
const BOOTSTRAP_DEFINITION = Object.freeze({
  metadataTable: 'authority_write_host_bootstrap_metadata',
  leaseTable: 'authority_write_host_lease',
  version: 1
});
const BOOTSTRAP_CHECKSUM = crypto.createHash('sha256').update(JSON.stringify(BOOTSTRAP_DEFINITION)).digest('hex');
const SCHEMA_CONTRACT = Object.freeze({
  canonical_event_headers: Object.freeze([
    'ledger_sequence', 'event_id', 'event_type', 'aggregate_type', 'aggregate_id', 'aggregate_version',
    'command_id', 'idempotency_key', 'trace_id', 'correlation_id', 'causation_id', 'platform',
    'source_account_id', 'generation', 'occurred_at', 'recorded_at', 'payload_id', 'payload_sha256',
    'redaction_version', 'schema_version', 'canonicalization_version', 'writer_authority',
    'host_generation', 'fencing_token', 'ledger_segment_id'
  ]),
  authority_payload_store: Object.freeze([
    'payload_id', 'classification', 'canonical_json', 'payload_sha256', 'encryption_key_ref', 'created_at'
  ]),
  event_type_registry: Object.freeze([
    'event_type', 'schema_version', 'aggregate_type', 'payload_classification', 'upcaster_id', 'active', 'registered_at'
  ]),
  authority_command_receipts: Object.freeze([
    'command_id', 'authority_scope', 'idempotency_key', 'status', 'first_event_id', 'last_event_id',
    'aggregate_version', 'host_generation', 'fencing_token', 'result_json', 'committed_at'
  ]),
  projection_checkpoints_v2: Object.freeze([
    'projector_id', 'projector_version', 'ledger_sequence', 'lease_owner', 'generation',
    'fencing_token', 'output_hash', 'lag', 'updated_at'
  ]),
  ledger_segments: Object.freeze([
    'segment_id', 'first_event_id', 'last_event_id', 'event_count', 'previous_segment_hash', 'segment_hash', 'sealed_at'
  ]),
  ledger_snapshots: Object.freeze([
    'snapshot_id', 'aggregate_type', 'aggregate_id', 'aggregate_version', 'snapshot_schema_version',
    'payload_id', 'event_head_hash', 'created_at'
  ])
});
const MIGRATION_CHECKSUM = crypto.createHash('sha256').update(JSON.stringify({
  migrationId: MIGRATION_ID,
  targetSchemaVersion: TARGET_SCHEMA_VERSION,
  bootstrapChecksum: BOOTSTRAP_CHECKSUM,
  schemaContract: SCHEMA_CONTRACT,
  contractVersion: 2
})).digest('hex');

function nowIso() { return new Date().toISOString(); }
function tableExists(db, table) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table));
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
function setSchemaVersion(db, value, at) {
  ensureMetaTable(db);
  const statement = db.prepare(`INSERT INTO r32_meta(key,value_json,updated_at) VALUES(?,?,?)
    ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at`);
  const encoded = JSON.stringify(Number(value));
  statement.run('schema_version', encoded, at);
  statement.run('schemaVersion', encoded, at);
}

function ensureAuthorityWriteHostBootstrapObjects(db, options = {}) {
  const at = String(options.at || nowIso());
  db.exec(`
    CREATE TABLE IF NOT EXISTS authority_write_host_bootstrap_metadata(
      singleton_id INTEGER PRIMARY KEY CHECK(singleton_id=1),
      checksum TEXT NOT NULL,
      created_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS authority_write_host_lease(
      singleton_id INTEGER PRIMARY KEY CHECK(singleton_id=1),
      owner_instance_id TEXT NOT NULL,
      owner_pid INTEGER NOT NULL,
      owner_process_identity TEXT NOT NULL DEFAULT '',
      startup_nonce TEXT NOT NULL DEFAULT '',
      host_generation INTEGER NOT NULL CHECK(host_generation>=1),
      fencing_token INTEGER NOT NULL CHECK(fencing_token>=1),
      state TEXT NOT NULL CHECK(state IN ('ACTIVE','RELEASED','FAILED')),
      acquired_at_ms INTEGER NOT NULL,
      heartbeat_at_ms INTEGER NOT NULL,
      acquired_at TEXT NOT NULL,
      heartbeat_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;
  `);
  const metadata = db.prepare('SELECT checksum FROM authority_write_host_bootstrap_metadata WHERE singleton_id=1').get();
  if (metadata && metadata.checksum !== BOOTSTRAP_CHECKSUM) {
    const error = new Error('AuthorityWriteHost bootstrap checksum mismatch');
    error.code = 'AUTHORITY_WRITE_HOST_BOOTSTRAP_CHECKSUM_MISMATCH';
    error.expectedChecksum = BOOTSTRAP_CHECKSUM;
    error.actualChecksum = String(metadata.checksum || '');
    throw error;
  }
  if (!metadata) {
    db.prepare('INSERT INTO authority_write_host_bootstrap_metadata(singleton_id,checksum,created_at) VALUES(1,?,?)')
      .run(BOOTSTRAP_CHECKSUM, at);
  }
  return { bootstrapChecksum: BOOTSTRAP_CHECKSUM };
}

function ensureObjects(db) {
  ensureAuthorityWriteHostBootstrapObjects(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS canonical_event_headers(
      ledger_sequence INTEGER NOT NULL,
      event_id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      aggregate_type TEXT NOT NULL,
      aggregate_id TEXT NOT NULL,
      aggregate_version INTEGER NOT NULL CHECK(aggregate_version>=1),
      command_id TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      trace_id TEXT NOT NULL,
      correlation_id TEXT NOT NULL DEFAULT '',
      causation_id TEXT NOT NULL DEFAULT '',
      platform TEXT NOT NULL DEFAULT '',
      source_account_id TEXT NOT NULL DEFAULT '',
      generation INTEGER NOT NULL DEFAULT 0 CHECK(generation>=0),
      occurred_at TEXT NOT NULL,
      recorded_at TEXT NOT NULL,
      payload_id TEXT NOT NULL,
      payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256)=64),
      redaction_version TEXT NOT NULL,
      schema_version INTEGER NOT NULL CHECK(schema_version>=1),
      canonicalization_version INTEGER NOT NULL CHECK(canonicalization_version>=1),
      writer_authority TEXT NOT NULL,
      host_generation INTEGER NOT NULL CHECK(host_generation>=1),
      fencing_token INTEGER NOT NULL CHECK(fencing_token>=1),
      ledger_segment_id TEXT NOT NULL,
      UNIQUE(aggregate_type,aggregate_id,aggregate_version),
      UNIQUE(command_id,idempotency_key)
    ) STRICT;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_canonical_event_headers_ledger_sequence
      ON canonical_event_headers(ledger_sequence);
    CREATE INDEX IF NOT EXISTS idx_canonical_event_headers_aggregate
      ON canonical_event_headers(aggregate_type,aggregate_id,aggregate_version);
    CREATE INDEX IF NOT EXISTS idx_canonical_event_headers_trace
      ON canonical_event_headers(trace_id,ledger_sequence);
    CREATE TRIGGER IF NOT EXISTS trg_canonical_event_headers_append_only_update
      BEFORE UPDATE ON canonical_event_headers BEGIN SELECT RAISE(ABORT,'canonical_event_headers append-only'); END;
    CREATE TRIGGER IF NOT EXISTS trg_canonical_event_headers_append_only_delete
      BEFORE DELETE ON canonical_event_headers BEGIN SELECT RAISE(ABORT,'canonical_event_headers append-only'); END;

    CREATE TABLE IF NOT EXISTS authority_payload_store(
      payload_id TEXT PRIMARY KEY,
      classification TEXT NOT NULL,
      canonical_json TEXT NOT NULL,
      payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256)=64),
      encryption_key_ref TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS event_type_registry(
      event_type TEXT NOT NULL,
      schema_version INTEGER NOT NULL CHECK(schema_version>=1),
      aggregate_type TEXT NOT NULL,
      payload_classification TEXT NOT NULL,
      upcaster_id TEXT NOT NULL DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
      registered_at TEXT NOT NULL,
      PRIMARY KEY(event_type,schema_version)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS authority_command_receipts(
      command_id TEXT PRIMARY KEY,
      authority_scope TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('COMMITTED','REJECTED','INDETERMINATE')),
      first_event_id TEXT NOT NULL DEFAULT '',
      last_event_id TEXT NOT NULL DEFAULT '',
      aggregate_version INTEGER NOT NULL DEFAULT 0,
      host_generation INTEGER NOT NULL CHECK(host_generation>=1),
      fencing_token INTEGER NOT NULL CHECK(fencing_token>=1),
      result_json TEXT NOT NULL DEFAULT '{}',
      committed_at TEXT NOT NULL,
      UNIQUE(authority_scope,idempotency_key)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS projection_checkpoints_v2(
      projector_id TEXT PRIMARY KEY,
      projector_version TEXT NOT NULL,
      ledger_sequence INTEGER NOT NULL CHECK(ledger_sequence>=0),
      lease_owner TEXT NOT NULL,
      generation INTEGER NOT NULL CHECK(generation>=1),
      fencing_token INTEGER NOT NULL CHECK(fencing_token>=1),
      output_hash TEXT NOT NULL CHECK(length(output_hash)=64),
      lag INTEGER NOT NULL CHECK(lag>=0),
      updated_at TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_projection_checkpoints_v2_sequence
      ON projection_checkpoints_v2(ledger_sequence,projector_id);

    CREATE TABLE IF NOT EXISTS ledger_segments(
      segment_id TEXT PRIMARY KEY,
      first_event_id TEXT NOT NULL,
      last_event_id TEXT NOT NULL,
      event_count INTEGER NOT NULL,
      previous_segment_hash TEXT NOT NULL DEFAULT '',
      segment_hash TEXT NOT NULL,
      sealed_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS ledger_snapshots(
      snapshot_id TEXT PRIMARY KEY,
      aggregate_type TEXT NOT NULL,
      aggregate_id TEXT NOT NULL,
      aggregate_version INTEGER NOT NULL,
      snapshot_schema_version INTEGER NOT NULL,
      payload_id TEXT NOT NULL,
      event_head_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(aggregate_type,aggregate_id,aggregate_version)
    ) STRICT;
  `);
}

function actualColumns(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map(row => String(row.name));
}
function ensureExactColumns(db, table, expected) {
  const actual = actualColumns(db, table);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    const error = new Error(`Schema 21 table ${table} does not match its frozen column contract`);
    error.code = 'ACV2_WP_A_SCHEMA_CONTRACT_MISMATCH';
    error.table = table;
    error.expectedColumns = expected;
    error.actualColumns = actual;
    throw error;
  }
}
function ensureConsistency(db) {
  const required = [
    'authority_write_host_bootstrap_metadata', 'authority_write_host_lease',
    ...Object.keys(SCHEMA_CONTRACT)
  ];
  for (const table of required) {
    if (!tableExists(db, table)) throw new Error(`ACV2 WP-A migration missing ${table}`);
  }
  const metadata = db.prepare('SELECT checksum FROM authority_write_host_bootstrap_metadata WHERE singleton_id=1').get();
  if (!metadata || metadata.checksum !== BOOTSTRAP_CHECKSUM) {
    const error = new Error('AuthorityWriteHost bootstrap checksum mismatch');
    error.code = 'AUTHORITY_WRITE_HOST_BOOTSTRAP_CHECKSUM_MISMATCH';
    throw error;
  }
  for (const [table, expected] of Object.entries(SCHEMA_CONTRACT)) ensureExactColumns(db, table, expected);
  const ledgerIndex = db.prepare("SELECT name,sql FROM sqlite_master WHERE type='index' AND name='idx_canonical_event_headers_ledger_sequence'").get();
  if (!ledgerIndex || !/CREATE UNIQUE INDEX/i.test(String(ledgerIndex.sql || ''))) {
    const error = new Error('Schema 21 canonical ledger sequence unique index is missing');
    error.code = 'ACV2_WP_A_LEDGER_SEQUENCE_INDEX_MISSING';
    throw error;
  }
}

function applyArchitectureClosureV2WpA(db) {
  ensureMigrationTable(db);
  const existing = db.prepare('SELECT * FROM r32_schema_migrations WHERE migration_id=?').get(MIGRATION_ID);
  if (existing && String(existing.checksum || '') !== MIGRATION_CHECKSUM) {
    const error = new Error('Schema 21 migration checksum mismatch');
    error.code = 'ACV2_WP_A_MIGRATION_CHECKSUM_MISMATCH';
    error.expectedChecksum = MIGRATION_CHECKSUM;
    error.actualChecksum = String(existing.checksum || '');
    throw error;
  }
  ensureObjects(db);
  ensureConsistency(db);
  const at = nowIso();
  setSchemaVersion(db, TARGET_SCHEMA_VERSION, at);
  const report = JSON.stringify({
    authority: 'AuthorityWriteHost',
    schemaVersion: TARGET_SCHEMA_VERSION,
    schemaContractVersion: 2,
    bootstrapChecksum: BOOTSTRAP_CHECKSUM,
    migrationChecksum: MIGRATION_CHECKSUM,
    tables: 9
  });
  if (!existing) {
    db.prepare(`INSERT INTO r32_schema_migrations(
      migration_id,target_schema_version,status,checksum,started_at,completed_at,report_json
    ) VALUES(?,?,?,?,?,?,?)`).run(MIGRATION_ID,TARGET_SCHEMA_VERSION,'completed',MIGRATION_CHECKSUM,at,at,report);
  } else {
    db.prepare(`UPDATE r32_schema_migrations
      SET target_schema_version=?,status='completed',checksum=?,completed_at=?,report_json=?
      WHERE migration_id=?`).run(TARGET_SCHEMA_VERSION,MIGRATION_CHECKSUM,at,report,MIGRATION_ID);
  }
  return {
    migrationId: MIGRATION_ID,
    targetSchemaVersion: TARGET_SCHEMA_VERSION,
    checksum: MIGRATION_CHECKSUM,
    bootstrapChecksum: BOOTSTRAP_CHECKSUM,
    schemaContractVersion: 2
  };
}

module.exports = {
  MIGRATION_ID,
  TARGET_SCHEMA_VERSION,
  BOOTSTRAP_DEFINITION,
  BOOTSTRAP_CHECKSUM,
  SCHEMA_CONTRACT,
  MIGRATION_CHECKSUM,
  ensureAuthorityWriteHostBootstrapObjects,
  ensureObjects,
  ensureConsistency,
  applyArchitectureClosureV2WpA
};
