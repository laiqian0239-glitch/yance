'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const {
  ensureObjects: ensureSchema21Objects
} = require('../../../migrations/architectureClosureV2WpA');
const {
  MIGRATION_ID,
  TARGET_SCHEMA_VERSION,
  MIGRATION_CHECKSUM,
  applyArchitectureClosureV2WpAIntegrity
} = require('../../../migrations/architectureClosureV2WpAIntegrity');

function withRawDatabase(work) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-schema22-integrity-'));
  const dbPath = path.join(root, 'legacy-schema21.db');
  const db = new DatabaseSync(dbPath);
  try {
    db.exec('PRAGMA foreign_keys=ON;');
    return work(db);
  } finally {
    try { db.close(); } catch (_) {}
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
}

function columnNames(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map(row => String(row.name));
}

function triggerNames(db, table) {
  return db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name=? ORDER BY name")
    .all(table).map(row => String(row.name));
}

test('Schema 22 upgrades a Schema 21 database without inventing historical event content', () => withRawDatabase(db => {
  ensureSchema21Objects(db);
  db.prepare(`INSERT INTO authority_payload_store(
    payload_id,classification,canonical_json,payload_sha256,encryption_key_ref,created_at
  ) VALUES(?,?,?,?,?,?)`).run(
    'payload:legacy-event',
    'BUSINESS_CONTENT',
    '{"legacy":true}',
    'a'.repeat(64),
    '',
    '2026-08-03T00:00:00.000Z'
  );
  db.prepare(`INSERT INTO canonical_event_headers(
    ledger_sequence,event_id,event_type,aggregate_type,aggregate_id,aggregate_version,
    command_id,idempotency_key,trace_id,correlation_id,causation_id,platform,source_account_id,
    generation,occurred_at,recorded_at,payload_id,payload_sha256,redaction_version,schema_version,
    canonicalization_version,writer_authority,host_generation,fencing_token,ledger_segment_id
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    1,'legacy-event','legacy.created','LegacyAggregate','legacy-1',1,
    'legacy-command','legacy-key','legacy-trace','','','legacy-platform','legacy-source',
    0,'2026-08-03T00:00:00.000Z','2026-08-03T00:00:00.000Z','payload:legacy-event','a'.repeat(64),
    'classification-v1',1,1,'LegacyAuthority',1,1,'segment-active-v1'
  );
  db.prepare(`INSERT INTO authority_command_receipts(
    command_id,authority_scope,idempotency_key,status,first_event_id,last_event_id,
    aggregate_version,host_generation,fencing_token,result_json,committed_at
  ) VALUES(?,?,?,'COMMITTED',?,?,?,?,?,?,?)`).run(
    'legacy-command','LegacyAuthority','legacy-key','legacy-event','legacy-event',1,1,1,
    JSON.stringify({ commandContentSha256: 'b'.repeat(64), receipt: { status: 'COMMITTED' } }),
    '2026-08-03T00:00:00.000Z'
  );

  const result = applyArchitectureClosureV2WpAIntegrity(db);
  assert.equal(result.targetSchemaVersion, TARGET_SCHEMA_VERSION);
  assert.equal(result.checksum, MIGRATION_CHECKSUM);
  assert.equal(TARGET_SCHEMA_VERSION, 22);

  assert.ok(columnNames(db, 'canonical_event_headers').includes('retention_class'));
  assert.ok(columnNames(db, 'authority_command_receipts').includes('command_content_sha256'));
  assert.ok(columnNames(db, 'authority_command_receipts').includes('event_content_sha256'));

  const receipt = db.prepare(`SELECT command_content_sha256,event_content_sha256
    FROM authority_command_receipts WHERE command_id='legacy-command'`).get();
  assert.equal(receipt.command_content_sha256, 'b'.repeat(64));
  assert.equal(receipt.event_content_sha256, '', 'unknown historical event semantics must not be invented');

  const header = db.prepare("SELECT retention_class FROM canonical_event_headers WHERE event_id='legacy-event'").get();
  assert.equal(header.retention_class, 'LEGACY_UNRECORDED');

  const migration = db.prepare('SELECT target_schema_version,status,checksum FROM r32_schema_migrations WHERE migration_id=?')
    .get(MIGRATION_ID);
  assert.deepEqual(migration, {
    target_schema_version: 22,
    status: 'completed',
    checksum: MIGRATION_CHECKSUM
  });
  assert.equal(JSON.parse(db.prepare("SELECT value_json FROM r32_meta WHERE key='schema_version'").get().value_json), 22);
}));

test('Schema 22 enforces one payload identifier and append-only immutable authorities', () => withRawDatabase(db => {
  ensureSchema21Objects(db);
  applyArchitectureClosureV2WpAIntegrity(db);

  const uniquePayload = db.prepare(`SELECT il.name
    FROM pragma_index_list('canonical_event_headers') il
    WHERE il.[unique]=1
      AND (SELECT GROUP_CONCAT(ii.name,',') FROM pragma_index_info(il.name) ii)='payload_id'`).get();
  assert.ok(uniquePayload);

  for (const table of [
    'canonical_event_headers',
    'authority_payload_store',
    'event_type_registry',
    'authority_command_receipts'
  ]) {
    const names = triggerNames(db, table);
    assert.ok(names.some(name => name.includes('append_only_update')), `${table}:update`);
    assert.ok(names.some(name => name.includes('append_only_delete')), `${table}:delete`);
  }
}));
