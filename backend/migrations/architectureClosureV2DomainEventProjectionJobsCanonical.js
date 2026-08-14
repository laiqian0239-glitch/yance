'use strict';

const crypto = require('node:crypto');
const {
  isArchitectureClosureV2WpAIntegrityApplied,
  ensureConsistency: ensureArchitectureClosureV2WpAIntegrityConsistency
} = require('./architectureClosureV2WpAIntegrity');

const MIGRATION_ID = '023_architecture_closure_v2_domain_event_projection_jobs_canonical';
const TARGET_SCHEMA_VERSION = 23;
const TABLE = 'domain_event_projection_jobs';
const LEGACY_TABLE = 'domain_event_projection_jobs_legacy_v22';
const CLAIM_INDEX = 'idx_domain_event_projection_jobs_claim';
const EXPECTED_COLUMNS = Object.freeze([
  'job_id',
  'event_id',
  'projector_name',
  'state',
  'attempts',
  'claim_token',
  'lease_expires_at',
  'next_attempt_at',
  'last_error',
  'created_at',
  'updated_at'
]);
const CLAIM_INDEX_COLUMNS = Object.freeze(['state', 'next_attempt_at', 'created_at']);
const MIGRATION_CONTRACT = Object.freeze({
  authority: 'AuthorityWriteHost',
  schemaVersion: TARGET_SCHEMA_VERSION,
  table: TABLE,
  columns: EXPECTED_COLUMNS,
  states: Object.freeze(['pending', 'processing', 'applied', 'failed', 'quarantined']),
  canonicalForeignKey: Object.freeze({
    from: 'event_id',
    table: 'canonical_event_headers',
    to: 'event_id',
    onDelete: 'CASCADE'
  }),
  legacyForeignKey: Object.freeze({
    from: 'event_id',
    table: 'domain_events',
    to: 'event_id',
    onDelete: 'CASCADE'
  }),
  claimIndex: Object.freeze({ name: CLAIM_INDEX, columns: CLAIM_INDEX_COLUMNS }),
  orphanPolicy: 'FAIL_CLOSED_BEFORE_TABLE_REBUILD',
  dataLossAllowed: false,
  syntheticCanonicalEventAllowed: false,
  historicalMigrationRewriteAllowed: false
});
const MIGRATION_CHECKSUM = crypto.createHash('sha256')
  .update(JSON.stringify({ migrationId: MIGRATION_ID, contract: MIGRATION_CONTRACT }))
  .digest('hex');

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
function readSchemaVersion(db) {
  if (!tableExists(db, 'r32_meta')) return 0;
  const rows = db.prepare("SELECT value_json FROM r32_meta WHERE key IN ('schema_version','schemaVersion')").all();
  let highest = 0;
  for (const row of rows) {
    let value;
    try { value = JSON.parse(row.value_json); } catch (_) { value = row.value_json; }
    const numeric = Number(value);
    if (!Number.isInteger(numeric) || numeric < 0) {
      const error = new Error('Schema 23 projection-job migration found invalid schema-version metadata');
      error.code = 'ACV2_DOMAIN_EVENT_PROJECTION_JOB_SCHEMA_VERSION_INVALID';
      error.value = row.value_json;
      throw error;
    }
    highest = Math.max(highest, numeric);
  }
  return highest;
}
function setSchemaVersionAtLeast(db, value, at = nowIso()) {
  ensureMetaTable(db);
  const encoded = JSON.stringify(Math.max(Number(value), readSchemaVersion(db)));
  const statement = db.prepare(`INSERT INTO r32_meta(key,value_json,updated_at) VALUES(?,?,?)
    ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at`);
  statement.run('schema_version', encoded, at);
  statement.run('schemaVersion', encoded, at);
}
function actualColumns(db, table = TABLE) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map(row => String(row.name));
}
function assertExactColumns(db, table = TABLE) {
  const actual = actualColumns(db, table);
  if (JSON.stringify(actual) !== JSON.stringify(EXPECTED_COLUMNS)) {
    const error = new Error(`Schema 23 ${TABLE} columns do not match the frozen durable-job contract`);
    error.code = 'ACV2_DOMAIN_EVENT_PROJECTION_JOB_COLUMNS_MISMATCH';
    error.expectedColumns = [...EXPECTED_COLUMNS];
    error.actualColumns = actual;
    throw error;
  }
}
function foreignKeys(db, table = TABLE) {
  return db.prepare(`PRAGMA foreign_key_list(${table})`).all().map(row => ({
    table: String(row.table),
    from: String(row.from),
    to: String(row.to),
    onDelete: String(row.on_delete).toUpperCase()
  }));
}
function sameForeignKey(actual, expected) {
  return actual.length === 1
    && actual[0].table === expected.table
    && actual[0].from === expected.from
    && actual[0].to === expected.to
    && actual[0].onDelete === expected.onDelete;
}
function claimIndexColumns(db) {
  const index = db.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name=?").get(CLAIM_INDEX);
  if (!index) return [];
  return db.prepare(`PRAGMA index_info(${CLAIM_INDEX})`).all().map(row => String(row.name));
}
function hasUniqueEventId(db) {
  return db.prepare(`SELECT 1
    FROM pragma_index_list('${TABLE}') il
    WHERE il.[unique]=1
      AND (SELECT GROUP_CONCAT(ii.name,',') FROM pragma_index_info(il.name) ii)='event_id'
    LIMIT 1`).get() != null;
}
function assertNoCanonicalOrphans(db) {
  const orphan = db.prepare(`SELECT jobs.event_id AS event_id
    FROM ${TABLE} jobs
    LEFT JOIN canonical_event_headers headers ON headers.event_id=jobs.event_id
    WHERE headers.event_id IS NULL
    ORDER BY jobs.created_at,jobs.job_id
    LIMIT 1`).get();
  if (!orphan) return;
  const error = new Error('Durable projection job has no canonical event header; refusing Schema 23 rebuild');
  error.code = 'ACV2_DOMAIN_EVENT_PROJECTION_JOB_CANONICAL_EVENT_MISSING';
  error.eventId = String(orphan.event_id || '');
  throw error;
}
function ensureBaseTables(db) {
  for (const table of [TABLE, 'canonical_event_headers']) {
    if (!tableExists(db, table)) {
      const error = new Error(`Schema 23 projection-job migration requires ${table}`);
      error.code = 'ACV2_DOMAIN_EVENT_PROJECTION_JOB_BASE_TABLE_MISSING';
      error.table = table;
      throw error;
    }
  }
  assertExactColumns(db);
}
function ensureConsistency(db) {
  ensureBaseTables(db);
  assertNoCanonicalOrphans(db);
  const keys = foreignKeys(db);
  if (!sameForeignKey(keys, MIGRATION_CONTRACT.canonicalForeignKey)) {
    const error = new Error('Schema 23 durable projection-job event identity is not canonical');
    error.code = 'ACV2_DOMAIN_EVENT_PROJECTION_JOB_CANONICAL_FK_MISSING';
    error.actualForeignKeys = keys;
    throw error;
  }
  if (!hasUniqueEventId(db)) {
    const error = new Error('Schema 23 durable projection-job event identity uniqueness is missing');
    error.code = 'ACV2_DOMAIN_EVENT_PROJECTION_JOB_EVENT_ID_UNIQUE_MISSING';
    throw error;
  }
  const actualIndex = claimIndexColumns(db);
  if (JSON.stringify(actualIndex) !== JSON.stringify(CLAIM_INDEX_COLUMNS)) {
    const error = new Error('Schema 23 durable projection-job claim index does not match its frozen contract');
    error.code = 'ACV2_DOMAIN_EVENT_PROJECTION_JOB_CLAIM_INDEX_MISMATCH';
    error.expectedColumns = [...CLAIM_INDEX_COLUMNS];
    error.actualColumns = actualIndex;
    throw error;
  }
  const violation = db.prepare(`PRAGMA foreign_key_check(${TABLE})`).get();
  if (violation) {
    const error = new Error('Schema 23 durable projection-job foreign-key integrity check failed');
    error.code = 'ACV2_DOMAIN_EVENT_PROJECTION_JOB_FOREIGN_KEY_VIOLATION';
    error.violation = violation;
    throw error;
  }
}
function rebuildToCanonicalForeignKey(db) {
  ensureBaseTables(db);
  assertNoCanonicalOrphans(db);
  const keys = foreignKeys(db);
  if (sameForeignKey(keys, MIGRATION_CONTRACT.canonicalForeignKey)) {
    const error = new Error('Schema 23 canonical projection-job table exists without its migration receipt');
    error.code = 'ACV2_DOMAIN_EVENT_PROJECTION_JOB_CANONICAL_TABLE_UNRECORDED';
    throw error;
  }
  if (!sameForeignKey(keys, MIGRATION_CONTRACT.legacyForeignKey)) {
    const error = new Error('Schema 23 refuses to rebuild a projection-job table with an unknown foreign-key contract');
    error.code = 'ACV2_DOMAIN_EVENT_PROJECTION_JOB_LEGACY_FK_MISMATCH';
    error.expectedForeignKey = MIGRATION_CONTRACT.legacyForeignKey;
    error.actualForeignKeys = keys;
    throw error;
  }
  if (tableExists(db, LEGACY_TABLE)) {
    const error = new Error(`Schema 23 temporary table already exists: ${LEGACY_TABLE}`);
    error.code = 'ACV2_DOMAIN_EVENT_PROJECTION_JOB_TEMP_TABLE_PRESENT';
    throw error;
  }

  db.exec(`ALTER TABLE ${TABLE} RENAME TO ${LEGACY_TABLE};`);
  db.exec(`CREATE TABLE ${TABLE}(
    job_id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL UNIQUE,
    projector_name TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('pending','processing','applied','failed','quarantined')),
    attempts INTEGER NOT NULL DEFAULT 0,
    claim_token TEXT NOT NULL DEFAULT '',
    lease_expires_at TEXT NOT NULL DEFAULT '',
    next_attempt_at TEXT NOT NULL DEFAULT '',
    last_error TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(event_id) REFERENCES canonical_event_headers(event_id) ON DELETE CASCADE
  ) STRICT;`);
  db.exec(`INSERT INTO ${TABLE}(${EXPECTED_COLUMNS.join(',')})
    SELECT ${EXPECTED_COLUMNS.join(',')} FROM ${LEGACY_TABLE};`);
  db.exec(`DROP TABLE ${LEGACY_TABLE};`);
  db.exec(`CREATE INDEX ${CLAIM_INDEX} ON ${TABLE}(${CLAIM_INDEX_COLUMNS.join(',')});`);
  return true;
}
function migrationReceipt(db) {
  if (!tableExists(db, 'r32_schema_migrations')) return null;
  return db.prepare('SELECT * FROM r32_schema_migrations WHERE migration_id=?').get(MIGRATION_ID) || null;
}
function verifyReceipt(existing) {
  if (!existing) return false;
  if (String(existing.checksum || '') !== MIGRATION_CHECKSUM) {
    const error = new Error('Schema 23 projection-job canonical migration checksum mismatch');
    error.code = 'ACV2_DOMAIN_EVENT_PROJECTION_JOB_MIGRATION_CHECKSUM_MISMATCH';
    error.expectedChecksum = MIGRATION_CHECKSUM;
    error.actualChecksum = String(existing.checksum || '');
    throw error;
  }
  if (Number(existing.target_schema_version) !== TARGET_SCHEMA_VERSION) {
    const error = new Error('Schema 23 projection-job canonical migration target version mismatch');
    error.code = 'ACV2_DOMAIN_EVENT_PROJECTION_JOB_MIGRATION_TARGET_MISMATCH';
    error.expectedTargetSchemaVersion = TARGET_SCHEMA_VERSION;
    error.actualTargetSchemaVersion = Number(existing.target_schema_version);
    throw error;
  }
  if (String(existing.status || '') !== 'completed') {
    const error = new Error('Schema 23 projection-job canonical migration is not completed');
    error.code = 'ACV2_DOMAIN_EVENT_PROJECTION_JOB_MIGRATION_INCOMPLETE';
    throw error;
  }
  return true;
}
function isArchitectureClosureV2DomainEventProjectionJobsCanonicalApplied(db) {
  const existing = migrationReceipt(db);
  if (!existing && readSchemaVersion(db) >= TARGET_SCHEMA_VERSION) {
    const error = new Error('Schema metadata claims v23 without the projection-job canonical migration receipt');
    error.code = 'ACV2_DOMAIN_EVENT_PROJECTION_JOB_SCHEMA_VERSION_UNRECORDED';
    error.schemaVersion = readSchemaVersion(db);
    throw error;
  }
  return verifyReceipt(existing);
}
function ensureArchitectureClosureV2WpABaseForSchema23Reentry(db) {
  if (!isArchitectureClosureV2WpAIntegrityApplied(db)) {
    const error = new Error('Schema 23 projection-job migration requires completed Schema 22 ACV2 integrity authority');
    error.code = 'ACV2_DOMAIN_EVENT_PROJECTION_JOB_WP_A_INTEGRITY_REQUIRED';
    throw error;
  }
  ensureArchitectureClosureV2WpAIntegrityConsistency(db);
}
function result() {
  return Object.freeze({
    migrationId: MIGRATION_ID,
    targetSchemaVersion: TARGET_SCHEMA_VERSION,
    checksum: MIGRATION_CHECKSUM,
    table: TABLE,
    canonicalForeignKey: MIGRATION_CONTRACT.canonicalForeignKey,
    claimIndex: MIGRATION_CONTRACT.claimIndex
  });
}
function applyArchitectureClosureV2DomainEventProjectionJobsCanonical(db) {
  ensureMigrationTable(db);
  const existing = migrationReceipt(db);
  if (verifyReceipt(existing)) {
    ensureConsistency(db);
    setSchemaVersionAtLeast(db, TARGET_SCHEMA_VERSION);
    return result();
  }

  const at = nowIso();
  db.exec('SAVEPOINT acv2_domain_event_projection_jobs_canonical_v23');
  try {
    const rebuilt = rebuildToCanonicalForeignKey(db);
    ensureConsistency(db);
    setSchemaVersionAtLeast(db, TARGET_SCHEMA_VERSION, at);
    const report = JSON.stringify({
      authority: 'AuthorityWriteHost',
      schemaVersion: TARGET_SCHEMA_VERSION,
      migrationChecksum: MIGRATION_CHECKSUM,
      table: TABLE,
      rebuilt,
      canonicalForeignKey: MIGRATION_CONTRACT.canonicalForeignKey,
      claimIndex: MIGRATION_CONTRACT.claimIndex,
      orphanPolicy: MIGRATION_CONTRACT.orphanPolicy,
      dataLossAllowed: false
    });
    db.prepare(`INSERT INTO r32_schema_migrations(
      migration_id,target_schema_version,status,checksum,started_at,completed_at,report_json
    ) VALUES(?,?,?,?,?,?,?)`)
      .run(MIGRATION_ID, TARGET_SCHEMA_VERSION, 'completed', MIGRATION_CHECKSUM, at, at, report);
    db.exec('RELEASE SAVEPOINT acv2_domain_event_projection_jobs_canonical_v23');
  } catch (error) {
    try { db.exec('ROLLBACK TO SAVEPOINT acv2_domain_event_projection_jobs_canonical_v23'); } catch (_) {}
    try { db.exec('RELEASE SAVEPOINT acv2_domain_event_projection_jobs_canonical_v23'); } catch (_) {}
    throw error;
  }
  return result();
}

module.exports = {
  MIGRATION_ID,
  TARGET_SCHEMA_VERSION,
  TABLE,
  CLAIM_INDEX,
  EXPECTED_COLUMNS,
  CLAIM_INDEX_COLUMNS,
  MIGRATION_CONTRACT,
  MIGRATION_CHECKSUM,
  isArchitectureClosureV2DomainEventProjectionJobsCanonicalApplied,
  ensureArchitectureClosureV2WpABaseForSchema23Reentry,
  ensureConsistency,
  applyArchitectureClosureV2DomainEventProjectionJobsCanonical
};
