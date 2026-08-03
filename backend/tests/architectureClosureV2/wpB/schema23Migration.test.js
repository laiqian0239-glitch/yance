'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

function migration() {
  return require('../../../migrations/architectureClosureV2WpB');
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
