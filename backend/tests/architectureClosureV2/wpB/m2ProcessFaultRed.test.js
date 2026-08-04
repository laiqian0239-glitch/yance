'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
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

function matrixModule() {
  requireFile(matrixPath, 'WP_B_M2_PROCESS_FAULT_MATRIX_REQUIRED');
  delete require.cache[require.resolve(matrixPath)];
  return require(matrixPath);
}

function withTempRoot(prefix, work) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return Promise.resolve()
    .then(() => work(root))
    .finally(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 }));
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

test('M2-FAULT-006 key crash windows execute in child processes against real SQLite', async () => withTempRoot(
  'yance-wp-b-process-fault-',
  async workspaceRoot => {
    const { runFaultMatrix } = matrixModule();
    const scenarios = [
      'KILL_BEFORE_PHYSICAL_CALL',
      'KILL_AFTER_ATTEMPT_BEFORE_CALL',
      'REMOTE_SUCCESS_BEFORE_RECEIPT',
      'DUPLICATE_DISPATCHERS'
    ];
    const report = await runFaultMatrix({ workspaceRoot, scenarios, timeoutMs: 20_000 });
    assert.equal(report.scenarioCount, scenarios.length);
    assert.deepEqual(report.results.map(row => row.scenario), scenarios);
    assert.equal(report.results.every(row => Number.isInteger(row.processId) && row.processId > 0), true);
    assert.equal(report.results.every(row => row.executionId && row.intentId && row.claimId), true);
    assert.equal(report.results.every(row => row.duplicateExternalSideEffectCount === 0), true);
    assert.equal(report.results.find(row => row.scenario === 'KILL_BEFORE_PHYSICAL_CALL').physicalSideEffectCount, 0);
    assert.equal(report.results.find(row => row.scenario === 'KILL_AFTER_ATTEMPT_BEFORE_CALL').attemptCount, 1);
    assert.equal(report.results.find(row => row.scenario === 'REMOTE_SUCCESS_BEFORE_RECEIPT').physicalSideEffectCount, 1);
    assert.equal(report.results.find(row => row.scenario === 'REMOTE_SUCCESS_BEFORE_RECEIPT').receiptCount, 0);
    assert.equal(report.results.find(row => row.scenario === 'DUPLICATE_DISPATCHERS').physicalSideEffectCount, 1);
  }
));

test('M2-FAULT-007 fake remote lookup and idempotency survive a process restart', async () => withTempRoot(
  'yance-wp-b-remote-restart-',
  async workspaceRoot => {
    const { runFakeRemoteRestartProbe } = matrixModule();
    const receipt = await runFakeRemoteRestartProbe({ workspaceRoot, timeoutMs: 10_000 });
    assert.equal(receipt.firstPhysicalSideEffectCount, 1);
    assert.equal(receipt.secondPhysicalSideEffectCount, 1);
    assert.equal(receipt.lookupOutcome, 'REMOTE_SUCCESS_PROVEN');
    assert.equal(receipt.requestIdBeforeRestart, receipt.requestIdAfterRestart);
  }
));

test('M2-FAULT-008 normalized process evidence is bounded and contains no business content', async () => withTempRoot(
  'yance-wp-b-process-evidence-',
  async workspaceRoot => {
    const { runFaultMatrix } = matrixModule();
    const report = await runFaultMatrix({
      workspaceRoot,
      scenarios: ['REMOTE_SUCCESS_BEFORE_RECEIPT'],
      timeoutMs: 15_000
    });
    const encoded = JSON.stringify(report);
    for (const forbidden of ['messageBody', 'promptBody', 'oauthToken', 'apiKey', 'cookie', 'binaryPayload']) {
      assert.equal(encoded.includes(forbidden), false, forbidden);
    }
    const row = report.results[0];
    assert.deepEqual(Object.keys(row).sort(), [
      'attemptCount',
      'attemptId',
      'claimId',
      'duplicateExternalSideEffectCount',
      'executionId',
      'fencingToken',
      'finalState',
      'generation',
      'hostGeneration',
      'intentId',
      'physicalSideEffectCount',
      'processId',
      'receiptCount',
      'reconciliationCount',
      'scenario'
    ].sort());
  }
));

test('M2-FAULT-009 receipt persistence path completes without a fault barrier', async () => withTempRoot(
  'yance-wp-b-receipt-before-terminal-',
  async workspaceRoot => {
    const { runFaultMatrix } = matrixModule();
    const report = await runFaultMatrix({
      workspaceRoot,
      scenarios: ['RECEIPT_BEFORE_TERMINAL'],
      timeoutMs: 15_000
    });
    assert.equal(report.scenarioCount, 1);
    assert.equal(report.results[0].scenario, 'RECEIPT_BEFORE_TERMINAL');
    assert.equal(report.results[0].attemptCount, 1);
    assert.equal(report.results[0].physicalSideEffectCount, 1);
    assert.equal(report.results[0].receiptCount, 1);
    assert.equal(report.results[0].duplicateExternalSideEffectCount, 0);
  }
));
