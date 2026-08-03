'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { removePathWithRetries } = require('../../../../tests/test-support/windows-cleanup');

function migration() {
  return require('../../../migrations/architectureClosureV2WpB');
}

function lifecycle() {
  return require('../../../services/durableExecutionLifecycle');
}

function withStore(work) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-wp-b-schema23-fk-'));
  const dbPath = path.join(root, 'yance-r32.db');
  let store = null;
  try {
    const { R32SqliteStore } = require('../../../lib/r32SqliteStore');
    store = new R32SqliteStore({
      dbPath,
      ownershipPid: 9877,
      ownershipPidAlive: pid => pid === 9877
    });
    return work(store);
  } finally {
    try { store?.close(); } catch (_) {}
    removePathWithRetries(root);
  }
}

test('WP-B owns a new forward-only Schema 23 migration', () => {
  const {
    MIGRATION_ID,
    TARGET_SCHEMA_VERSION,
    MIGRATION_CHECKSUM,
    WP_B_SCHEMA_CONTRACT
  } = migration();
  assert.equal(MIGRATION_ID, '023_architecture_closure_v2_wp_b');
  assert.equal(TARGET_SCHEMA_VERSION, 23);
  assert.match(MIGRATION_CHECKSUM, /^[a-f0-9]{64}$/u);
  assert.equal(WP_B_SCHEMA_CONTRACT.authority, 'DurableExecutionAuthorityV2');
});

test('Schema 23 declares every durable execution concurrency fact', () => {
  const { WP_B_SCHEMA_CONTRACT } = migration();
  const columns = new Set(WP_B_SCHEMA_CONTRACT.durableExecutionColumns);
  for (const column of [
    'command_content_sha256', 'content_hash_version', 'state_version', 'generation',
    'owner_id', 'claim_id', 'host_generation', 'fencing_token', 'lease_started_at',
    'lease_expires_at', 'heartbeat_sequence', 'deadline_at', 'terminal_receipt_id'
  ]) assert.equal(columns.has(column), true, `missing ${column}`);
});

test('Schema 23 and the pure lifecycle share one exact state authority', () => {
  const { WP_B_SCHEMA_CONTRACT } = migration();
  const { STATES } = lifecycle();
  assert.deepEqual(
    [...WP_B_SCHEMA_CONTRACT.durableExecutionStates].sort(),
    Object.values(STATES).sort()
  );
});

test('Schema 23 declares append-only intent, attempt, receipt, reconciliation and checkpoint facts', () => {
  const { WP_B_SCHEMA_CONTRACT } = migration();
  assert.deepEqual(WP_B_SCHEMA_CONTRACT.appendOnlyTables, [
    'external_action_intents',
    'external_action_attempts',
    'external_action_receipts',
    'external_outcome_reconciliations',
    'durable_execution_checkpoints'
  ]);
});

test('Schema 23 never uses implicit SQLite business time', () => {
  const source = require('node:fs').readFileSync(require.resolve('../../../migrations/architectureClosureV2WpB'), 'utf8');
  assert.doesNotMatch(source, /CURRENT_TIMESTAMP/iu);
  assert.doesNotMatch(source, /DEFAULT\s*\(\s*datetime\s*\(/iu);
});

test('Schema 23 rebuilt event foreign key targets the final durable execution table', () => withStore(store => {
  const foreignKeys = store.db.prepare('PRAGMA foreign_key_list(durable_execution_events)').all();
  assert.equal(foreignKeys.length, 1);
  assert.equal(String(foreignKeys[0].table), 'durable_executions');
  assert.equal(String(foreignKeys[0].from), 'execution_id');
  assert.equal(String(foreignKeys[0].to), 'execution_id');
  assert.doesNotMatch(String(foreignKeys[0].table), /_v23_new/u);
}));

test('Schema 23 consistency validation rejects persisted foreign-key violations', () => withStore(store => {
  const { isArchitectureClosureV2WpBApplied } = migration();
  store.db.exec('PRAGMA foreign_keys=OFF');
  store.db.prepare(`INSERT INTO external_action_claims(
    intent_id,state,state_version,generation,owner_id,claim_id,host_generation,
    fencing_token,lease_started_at,lease_expires_at,updated_at
  ) VALUES(?,'READY',0,0,'','',0,0,'','',?)`).run(
    'orphan-intent-review-gate',
    '2026-08-03T06:30:00.000Z'
  );
  store.db.exec('PRAGMA foreign_keys=ON');
  assert.ok(store.db.prepare('PRAGMA foreign_key_check').all().length > 0);
  assert.throws(
    () => isArchitectureClosureV2WpBApplied(store.db),
    error => error?.code === 'ACV2_WP_B_FOREIGN_KEY_INTEGRITY_FAILED'
      && Array.isArray(error?.violations)
      && error.violations.length > 0
  );
}));