'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const {
  applyBatch41Fix6MArchitectureReferenceClosure
} = require('../../../migrations/batch41Fix6MArchitectureReferenceClosure');
const {
  applyArchitectureClosureV2WpA
} = require('../../../migrations/architectureClosureV2WpA');
const {
  MIGRATION_ID,
  MIGRATION_CHECKSUM,
  TARGET_SCHEMA_VERSION,
  WP_B_SCHEMA_CONTRACT,
  applyArchitectureClosureV2WpB,
  isArchitectureClosureV2WpBApplied
} = require('../../../migrations/architectureClosureV2WpB');

function withDatabase(work) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-wp-b-schema23-'));
  const dbPath = path.join(root, 'schema23.db');
  const db = new DatabaseSync(dbPath);
  try {
    db.exec('PRAGMA foreign_keys=ON;');
    return work(db);
  } finally {
    try { db.close(); } catch (_) {}
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
}

function createSchema22(db) {
  db.exec(`CREATE TABLE r32_meta(
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;`);
  applyBatch41Fix6MArchitectureReferenceClosure(db);
  const result = applyArchitectureClosureV2WpA(db);
  assert.equal(result.targetSchemaVersion, 22);
  return result;
}

function insertLegacyExecution(db) {
  db.prepare(`INSERT INTO durable_executions(
    execution_id,trace_id,operation_kind,idempotency_key,state,generation,owner_id,
    lease_sequence,last_heartbeat_at,cancellation_requested_at,cancellation_actor,
    retry_count,max_attempts,next_attempt_at,failure_code,metadata_json,created_at,
    updated_at,completed_at
  ) VALUES(?,?,?,?,?,0,'',0,'','','',0,3,'','',?,?,?,'')`).run(
    'legacy-execution-1',
    'legacy-trace-1',
    'LEGACY_OPERATION',
    'legacy-idempotency-1',
    'CREATED',
    JSON.stringify({ checkpoint: 'legacy-checkpoint' }),
    '2026-08-03T03:30:00.000Z',
    '2026-08-03T03:30:00.000Z'
  );
  db.prepare(`INSERT INTO durable_execution_events(
    event_id,execution_id,sequence,event_type,from_state,to_state,generation,
    owner_id,reason_code,payload_json,created_at
  ) VALUES(?,?,1,'created','',?,0,'','',?,?)`).run(
    'legacy-event-1',
    'legacy-execution-1',
    'CREATED',
    JSON.stringify({ operationKind: 'LEGACY_OPERATION' }),
    '2026-08-03T03:30:00.000Z'
  );
}

function schemaVersion(db) {
  return Number(JSON.parse(db.prepare(
    "SELECT value_json FROM r32_meta WHERE key='schema_version'"
  ).get().value_json));
}

function tableNames(db) {
  return db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all().map(row => String(row.name));
}

test('Schema 23 upgrades a real Schema 22 database and preserves legacy durable history', () => withDatabase(db => {
  createSchema22(db);
  insertLegacyExecution(db);

  const result = applyArchitectureClosureV2WpB(db, {
    at: '2026-08-03T03:31:00.000Z'
  });
  assert.equal(result.migrationId, MIGRATION_ID);
  assert.equal(result.targetSchemaVersion, TARGET_SCHEMA_VERSION);
  assert.equal(result.checksum, MIGRATION_CHECKSUM);
  assert.equal(schemaVersion(db), 23);
  assert.equal(isArchitectureClosureV2WpBApplied(db), true);

  const migration = db.prepare(`SELECT target_schema_version,status,checksum
    FROM r32_schema_migrations WHERE migration_id=?`).get(MIGRATION_ID);
  assert.deepEqual(migration, {
    target_schema_version: 23,
    status: 'completed',
    checksum: MIGRATION_CHECKSUM
  });

  const legacy = db.prepare(`SELECT execution_id,state,command_content_sha256,
      content_hash_version,state_version,generation,owner_id,claim_id,
      host_generation,fencing_token,metadata_json
    FROM durable_executions WHERE execution_id='legacy-execution-1'`).get();
  assert.equal(legacy.execution_id, 'legacy-execution-1');
  assert.equal(legacy.state, 'CREATED');
  assert.equal(legacy.command_content_sha256, '');
  assert.equal(legacy.content_hash_version, 0);
  assert.equal(legacy.state_version, 0);
  assert.equal(legacy.generation, 0);
  assert.equal(legacy.owner_id, '');
  assert.equal(legacy.claim_id, '');
  assert.equal(legacy.host_generation, 0);
  assert.equal(legacy.fencing_token, 0);
  assert.deepEqual(JSON.parse(legacy.metadata_json), { checkpoint: 'legacy-checkpoint' });

  const event = db.prepare(`SELECT event_id,execution_id,sequence,event_type,to_state
    FROM durable_execution_events WHERE event_id='legacy-event-1'`).get();
  assert.deepEqual(event, {
    event_id: 'legacy-event-1',
    execution_id: 'legacy-execution-1',
    sequence: 1,
    event_type: 'created',
    to_state: 'CREATED'
  });

  const names = new Set(tableNames(db));
  for (const table of [
    ...WP_B_SCHEMA_CONTRACT.appendOnlyTables,
    ...WP_B_SCHEMA_CONTRACT.mutableCasTables
  ]) assert.equal(names.has(table), true, `missing ${table}`);

  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
}));

test('Schema 23 reopen validation is idempotent and never downgrades metadata', () => withDatabase(db => {
  createSchema22(db);
  applyArchitectureClosureV2WpB(db, { at: '2026-08-03T03:32:00.000Z' });
  db.exec(`CREATE TRIGGER reject_schema_22_reentry
    BEFORE UPDATE OF value_json ON r32_meta
    WHEN NEW.key IN ('schema_version','schemaVersion') AND NEW.value_json='22'
    BEGIN SELECT RAISE(ABORT,'schema 22 downgrade forbidden'); END;`);

  const second = applyArchitectureClosureV2WpB(db, { at: '2026-08-03T03:33:00.000Z' });
  assert.equal(second.targetSchemaVersion, 23);
  assert.equal(schemaVersion(db), 23);
  assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM r32_schema_migrations
    WHERE migration_id=?`).get(MIGRATION_ID).count, 1);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
}));

test('Schema 23 rejects future schemas and tampered migration checksums', () => withDatabase(db => {
  createSchema22(db);
  applyArchitectureClosureV2WpB(db, { at: '2026-08-03T03:34:00.000Z' });

  db.prepare("UPDATE r32_meta SET value_json='24' WHERE key IN ('schema_version','schemaVersion')").run();
  assert.throws(
    () => applyArchitectureClosureV2WpB(db, { at: '2026-08-03T03:35:00.000Z' }),
    error => error?.code === 'ACV2_WP_B_FUTURE_SCHEMA_UNSUPPORTED'
  );

  db.prepare("UPDATE r32_meta SET value_json='23' WHERE key IN ('schema_version','schemaVersion')").run();
  db.prepare(`UPDATE r32_schema_migrations SET checksum='tampered'
    WHERE migration_id=?`).run(MIGRATION_ID);
  assert.throws(
    () => isArchitectureClosureV2WpBApplied(db),
    error => error?.code === 'ACV2_WP_B_MIGRATION_CHECKSUM_MISMATCH'
  );
}));
