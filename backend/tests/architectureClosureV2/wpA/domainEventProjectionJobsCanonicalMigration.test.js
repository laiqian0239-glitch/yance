'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const { R32SqliteStore, SCHEMA_VERSION } = require('../../../lib/r32SqliteStore');

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

function withTempRoot(prefix, work) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    return work(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
}

function withRawDatabase(work) {
  return withTempRoot('yance-acv2-projection-job-migration-', root => {
    const dbPath = path.join(root, 'legacy-schema22.db');
    const db = new DatabaseSync(dbPath);
    try {
      db.exec('PRAGMA foreign_keys=ON;');
      return work(db);
    } finally {
      try { db.close(); } catch (_) {}
    }
  });
}

function createLegacyFixture(db, { includeCanonicalEvent = true } = {}) {
  db.exec(`
    CREATE TABLE domain_events(
      event_id TEXT PRIMARY KEY
    ) STRICT;

    CREATE TABLE canonical_event_headers(
      event_id TEXT PRIMARY KEY
    ) STRICT;

    CREATE TABLE domain_event_projection_jobs(
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
      FOREIGN KEY(event_id) REFERENCES domain_events(event_id) ON DELETE CASCADE
    ) STRICT;

    CREATE INDEX idx_domain_event_projection_jobs_claim
      ON domain_event_projection_jobs(state,next_attempt_at,created_at);
  `);

  db.prepare('INSERT INTO domain_events(event_id) VALUES(?)').run('event-1');
  if (includeCanonicalEvent) {
    db.prepare('INSERT INTO canonical_event_headers(event_id) VALUES(?)').run('event-1');
  }
  db.prepare(`INSERT INTO domain_event_projection_jobs(
    job_id,event_id,projector_name,state,attempts,claim_token,lease_expires_at,
    next_attempt_at,last_error,created_at,updated_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(
    'job-1',
    'event-1',
    'message-v1',
    'failed',
    7,
    'claim-7',
    '2026-08-14T01:02:03.000Z',
    '2026-08-14T01:03:04.000Z',
    'projection failed after durable enqueue',
    '2026-08-14T01:00:00.000Z',
    '2026-08-14T01:01:00.000Z'
  );
}

function foreignKeys(db) {
  return db.prepare('PRAGMA foreign_key_list(domain_event_projection_jobs)').all();
}

function claimIndexColumns(db) {
  const exists = db.prepare(`SELECT name FROM sqlite_master
    WHERE type='index' AND name='idx_domain_event_projection_jobs_claim'`).get();
  if (!exists) return [];
  return db.prepare("PRAGMA index_info('idx_domain_event_projection_jobs_claim')")
    .all().map(row => String(row.name));
}

function rowSnapshot(db) {
  const row = db.prepare(`SELECT ${EXPECTED_COLUMNS.join(',')}
    FROM domain_event_projection_jobs WHERE job_id='job-1'`).get();
  return Object.fromEntries(EXPECTED_COLUMNS.map(column => [column, row?.[column]]));
}

function loadMigration() {
  return require('../../../migrations/architectureClosureV2DomainEventProjectionJobsCanonical');
}

test('fresh R32 bootstrap owns durable projection jobs through the canonical event ledger', () => withTempRoot(
  'yance-acv2-projection-job-bootstrap-',
  root => {
    const store = new R32SqliteStore({ dbPath: path.join(root, 'yance-r32.db') });
    try {
      const keys = foreignKeys(store.db);
      assert.equal(keys.length, 1, 'domain_event_projection_jobs must have one event identity foreign key');
      assert.equal(String(keys[0].from), 'event_id');
      assert.equal(String(keys[0].to), 'event_id');
      assert.equal(
        String(keys[0].table),
        'canonical_event_headers',
        'durable projection jobs must not remain anchored to the retired legacy domain_events ledger'
      );
      assert.equal(String(keys[0].on_delete).toUpperCase(), 'CASCADE');
      assert.deepEqual(
        store.db.prepare('PRAGMA table_info(domain_event_projection_jobs)').all().map(row => String(row.name)),
        EXPECTED_COLUMNS
      );
      assert.deepEqual(claimIndexColumns(store.db), ['state', 'next_attempt_at', 'created_at']);
      assert.equal(SCHEMA_VERSION, 23, 'R32 schema version must register the forward canonical projection-job migration');
    } finally {
      store.close();
    }
  }
));

test('Schema 23 rebuild preserves every durable job field while moving only event identity authority', () => withRawDatabase(db => {
  createLegacyFixture(db);
  const before = rowSnapshot(db);
  const migration = loadMigration();

  const first = migration.applyArchitectureClosureV2DomainEventProjectionJobsCanonical(db);
  assert.equal(first.migrationId, migration.MIGRATION_ID);
  assert.equal(first.targetSchemaVersion, 23);
  assert.equal(first.checksum, migration.MIGRATION_CHECKSUM);

  assert.deepEqual(rowSnapshot(db), before, 'migration must preserve retry, claim, error, state and timestamps byte-for-byte');
  assert.deepEqual(
    foreignKeys(db).map(row => ({
      table: String(row.table),
      from: String(row.from),
      to: String(row.to),
      onDelete: String(row.on_delete).toUpperCase()
    })),
    [{ table: 'canonical_event_headers', from: 'event_id', to: 'event_id', onDelete: 'CASCADE' }]
  );
  assert.deepEqual(claimIndexColumns(db), ['state', 'next_attempt_at', 'created_at']);
  assert.deepEqual(
    db.prepare('PRAGMA table_info(domain_event_projection_jobs)').all().map(row => String(row.name)),
    EXPECTED_COLUMNS
  );
  assert.equal(db.prepare('PRAGMA foreign_key_check(domain_event_projection_jobs)').all().length, 0);

  const receipt = db.prepare(`SELECT target_schema_version,status,checksum
    FROM r32_schema_migrations WHERE migration_id=?`).get(migration.MIGRATION_ID);
  assert.equal(Number(receipt.target_schema_version), 23);
  assert.equal(String(receipt.status), 'completed');
  assert.equal(String(receipt.checksum), migration.MIGRATION_CHECKSUM);
  assert.equal(JSON.parse(db.prepare("SELECT value_json FROM r32_meta WHERE key='schema_version'").get().value_json), 23);
  assert.equal(JSON.parse(db.prepare("SELECT value_json FROM r32_meta WHERE key='schemaVersion'").get().value_json), 23);

  const second = migration.applyArchitectureClosureV2DomainEventProjectionJobsCanonical(db);
  assert.equal(second.checksum, first.checksum);
  assert.deepEqual(rowSnapshot(db), before, 'idempotent re-entry must not rewrite durable projection jobs');
}));

test('Schema 23 fails closed before rebuild when a durable job has no canonical event header', () => withRawDatabase(db => {
  createLegacyFixture(db, { includeCanonicalEvent: false });
  const before = rowSnapshot(db);
  const migration = loadMigration();

  assert.throws(
    () => migration.applyArchitectureClosureV2DomainEventProjectionJobsCanonical(db),
    error => error?.code === 'ACV2_DOMAIN_EVENT_PROJECTION_JOB_CANONICAL_EVENT_MISSING'
      && error?.eventId === 'event-1'
  );

  assert.deepEqual(rowSnapshot(db), before, 'orphan rejection must leave the durable job untouched');
  assert.equal(String(foreignKeys(db)[0].table), 'domain_events', 'failed migration must leave the legacy table definition intact');
  assert.deepEqual(claimIndexColumns(db), ['state', 'next_attempt_at', 'created_at']);
  const receipt = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='r32_schema_migrations'").get()
    ? db.prepare('SELECT * FROM r32_schema_migrations WHERE migration_id=?').get(migration.MIGRATION_ID)
    : undefined;
  assert.equal(receipt, undefined, 'failed migration must not claim completion');
}));

test('Schema 23 migration receipt is checksum-pinned and cannot bless altered history', () => withRawDatabase(db => {
  createLegacyFixture(db);
  const migration = loadMigration();
  db.exec(`CREATE TABLE r32_schema_migrations(
    migration_id TEXT PRIMARY KEY,
    target_schema_version INTEGER NOT NULL,
    status TEXT NOT NULL,
    checksum TEXT NOT NULL DEFAULT '',
    started_at TEXT NOT NULL,
    completed_at TEXT NOT NULL DEFAULT '',
    report_json TEXT NOT NULL DEFAULT '{}'
  ) STRICT;`);
  db.prepare(`INSERT INTO r32_schema_migrations(
    migration_id,target_schema_version,status,checksum,started_at,completed_at,report_json
  ) VALUES(?,23,'completed',?,'2026-08-14T00:00:00.000Z','2026-08-14T00:00:00.000Z','{}')`)
    .run(migration.MIGRATION_ID, '0'.repeat(64));

  assert.throws(
    () => migration.applyArchitectureClosureV2DomainEventProjectionJobsCanonical(db),
    error => error?.code === 'ACV2_DOMAIN_EVENT_PROJECTION_JOB_MIGRATION_CHECKSUM_MISMATCH'
      && error?.expectedChecksum === migration.MIGRATION_CHECKSUM
      && error?.actualChecksum === '0'.repeat(64)
  );
  assert.equal(String(foreignKeys(db)[0].table), 'domain_events');
}));
