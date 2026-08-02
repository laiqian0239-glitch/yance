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
const MIGRATION_CHECKSUM = crypto.createHash('sha256').update([
  MIGRATION_ID,
  TARGET_SCHEMA_VERSION,
  BOOTSTRAP_CHECKSUM,
  'canonical_event_headers',
  'authority_payload_store',
  'event_type_registry',
  'authority_command_receipts',
  'projection_checkpoints_v2',
  'ledger_segments',
  'ledger_snapshots'
].join('\n')).digest('hex');

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
      event_id TEXT PRIMARY KEY,
      aggregate_type TEXT NOT NULL,
      aggregate_id TEXT NOT NULL,
      aggregate_version INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      schema_version INTEGER NOT NULL,
      payload_id TEXT NOT NULL,
      command_id TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      correlation_id TEXT NOT NULL DEFAULT '',
      causation_id TEXT NOT NULL DEFAULT '',
      host_generation INTEGER NOT NULL,
      fencing_token INTEGER NOT NULL,
      occurred_at TEXT NOT NULL,
      recorded_at TEXT NOT NULL,
      UNIQUE(aggregate_type,aggregate_id,aggregate_version),
      UNIQUE(command_id,idempotency_key)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_canonical_event_headers_sequence
      ON canonical_event_headers(aggregate_type,aggregate_id,aggregate_version);

    CREATE TABLE IF NOT EXISTS authority_payload_store(
      payload_id TEXT PRIMARY KEY,
      classification TEXT NOT NULL,
      canonical_json TEXT NOT NULL,
      payload_sha256 TEXT NOT NULL,
      encryption_key_ref TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS event_type_registry(
      event_type TEXT NOT NULL,
      schema_version INTEGER NOT NULL,
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
      host_generation INTEGER NOT NULL,
      fencing_token INTEGER NOT NULL,
      result_json TEXT NOT NULL DEFAULT '{}',
      committed_at TEXT NOT NULL,
      UNIQUE(authority_scope,idempotency_key)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS projection_checkpoints_v2(
      projector_id TEXT PRIMARY KEY,
      projector_version TEXT NOT NULL,
      last_event_id TEXT NOT NULL DEFAULT '',
      last_aggregate_version INTEGER NOT NULL DEFAULT 0,
      state_hash TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    ) STRICT;

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

function ensureConsistency(db) {
  const required = [
    'authority_write_host_bootstrap_metadata',
    'authority_write_host_lease',
    'canonical_event_headers',
    'authority_payload_store',
    'event_type_registry',
    'authority_command_receipts',
    'projection_checkpoints_v2',
    'ledger_segments',
    'ledger_snapshots'
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
    bootstrapChecksum: BOOTSTRAP_CHECKSUM,
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
    bootstrapChecksum: BOOTSTRAP_CHECKSUM
  };
}

module.exports = {
  MIGRATION_ID,
  TARGET_SCHEMA_VERSION,
  BOOTSTRAP_DEFINITION,
  BOOTSTRAP_CHECKSUM,
  MIGRATION_CHECKSUM,
  ensureAuthorityWriteHostBootstrapObjects,
  ensureObjects,
  ensureConsistency,
  applyArchitectureClosureV2WpA
};
