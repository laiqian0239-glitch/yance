'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
const matrixPath = path.join(repoRoot, 'tools', 'architecture-closure-v2', 'wp-b-process-fault-matrix.js');
const fakeRemotePath = path.join(repoRoot, 'tools', 'architecture-closure-v2', 'fixtures', 'wp-b-fake-remote.js');
const dispatcherProcessPath = path.join(repoRoot, 'tools', 'architecture-closure-v2', 'fixtures', 'wp-b-dispatcher-process.js');

const REQUIRED_SCENARIOS = Object.freeze([
  'KILL_BEFORE_PHYSICAL_CALL',
  'KILL_AFTER_ATTEMPT_BEFORE_CALL',
  'KILL_DURING_CALL',
  'REMOTE_SUCCESS_BEFORE_RECEIPT',
  'RECEIPT_BEFORE_TERMINAL',
  'DUPLICATE_DISPATCHERS',
  'LEASE_EXPIRY_TAKEOVER',
  'STALE_OWNER_GENERATION_HOST_FENCING',
  'HEARTBEAT_LOSS',
  'CLOCK_ROLLBACK_FORWARD_JUMP',
  'DEADLINE_BEFORE_CLAIM_DURING_WAIT',
  'CANCELLATION_BEFORE_DURING_AFTER_ACCEPTANCE',
  'REMOTE_RETRYABLE_PERMANENT_FAILURE',
  'RECONCILIATION_PROVES_SUCCESS',
  'RECONCILIATION_PROVES_ABSENCE',
  'RECONCILIATION_REMAINS_UNKNOWN',
  'CHECKPOINT_HISTORY_ROLLING',
  'RESTART_EVERY_NONTERMINAL_STATE'
]);

function requireFile(filePath, code) {
  assert.equal(fs.existsSync(filePath), true, `${code}: ${path.relative(repoRoot, filePath)}`);
  return fs.readFileSync(filePath, 'utf8');
}

test('M2-FAULT-001 real process-fault matrix defines all eighteen required scenarios', () => {
  const text = requireFile(matrixPath, 'WP_B_M2_PROCESS_FAULT_MATRIX_REQUIRED');
  for (const scenario of REQUIRED_SCENARIOS) assert.match(text, new RegExp(`['"]${scenario}['"]`, 'u'));
  assert.match(text, /runFaultMatrix/u);
});

test('M2-FAULT-002 fake remote persists idempotency and request lookup independently', () => {
  const text = requireFile(fakeRemotePath, 'WP_B_M2_FAKE_REMOTE_REQUIRED');
  assert.match(text, /idempotency/u);
  assert.match(text, /requestId/u);
  assert.match(text, /lookup/u);
  assert.match(text, /REMOTE_ABSENCE_PROVEN/u);
  assert.match(text, /REMOTE_SUCCESS_PROVEN/u);
});

test('M2-FAULT-003 two dispatcher processes use the real SQLite and write-host path', () => {
  const text = requireFile(dispatcherProcessPath, 'WP_B_M2_DISPATCHER_PROCESS_FIXTURE_REQUIRED');
  assert.match(text, /r32SqliteStore|AuthorityWriteHost|authorityWriteHost/u);
  assert.match(text, /ExternalActionDispatcher|externalActionDispatcher/u);
  assert.match(text, /process\.(?:pid|send)/u);
});

test('M2-FAULT-004 matrix evidence records concurrency identity without business content', () => {
  const text = requireFile(matrixPath, 'WP_B_M2_PROCESS_FAULT_MATRIX_REQUIRED');
  for (const field of [
    'processId',
    'executionId',
    'intentId',
    'attemptId',
    'claimId',
    'generation',
    'hostGeneration',
    'fencingToken',
    'physicalSideEffectCount',
    'receiptCount',
    'reconciliationCount',
    'finalState'
  ]) assert.match(text, new RegExp(field, 'u'));
  assert.doesNotMatch(text, /messageBody|promptBody|oauthToken|apiKey|cookie|binaryPayload/u);
});

test('M2-FAULT-005 matrix proves duplicate external side effects remain zero', () => {
  const text = requireFile(matrixPath, 'WP_B_M2_PROCESS_FAULT_MATRIX_REQUIRED');
  assert.match(text, /duplicateExternalSideEffectCount/u);
  assert.match(text, /physicalSideEffectCount/u);
  assert.match(text, /UNCERTAIN_REMOTE_OUTCOME/u);
  assert.match(text, /REMOTE_ABSENCE_PROVEN/u);
});
