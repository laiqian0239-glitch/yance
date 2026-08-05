'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const EXPECTED_SCENARIOS = Object.freeze([
  'SOCKET_A_CREDS_WAIT_SOCKET_B_TAKEOVER',
  'RECONNECT_TIMER_AFTER_GENERATION_CHANGE',
  'RETRY_COUNTER_COMMIT_THEN_PROCESS_EXIT',
  'MESSAGE_ROW_COMMIT_KEY_INDEX_FAILURE',
  'SQLITE_OWNERSHIP_HEARTBEAT_LOST',
  'WINDOWS_LEGACY_ARCHIVE_LOCK'
]);

function loadMatrix() {
  try {
    return require('../../tools/oss1a/whatsapp-generation-concurrency-matrix');
  } catch (error) {
    assert.fail(`Task 10 generation concurrency matrix must exist: ${error.code || error.message}`);
  }
}

test('generation concurrency matrix freezes the remaining six real failure scenarios', () => {
  const matrix = loadMatrix();
  assert.deepEqual(
    matrix.GENERATION_CONCURRENCY_SCENARIOS.map(scenario => scenario.id),
    EXPECTED_SCENARIOS
  );
  for (const scenario of matrix.GENERATION_CONCURRENCY_SCENARIOS) {
    assert.equal(scenario.execution, 'CHILD_PROCESS_OR_REAL_OS_BOUNDARY');
    assert.equal(typeof scenario.faultPoint, 'string');
    assert.ok(scenario.faultPoint.length > 0);
  }
});

test('generation concurrency matrix proves fencing, repair and deterministic restart', async () => {
  const matrix = loadMatrix();
  const report = await matrix.runGenerationConcurrencyMatrix({ quiet: true });

  assert.equal(report.matrix, 'OSS1A_WHATSAPP_GENERATION_CONCURRENCY_MATRIX');
  assert.equal(report.platform, process.platform);
  assert.equal(report.warningOnly, false);
  assert.deepEqual(report.warnings, []);
  assert.equal(report.scenarioCount, EXPECTED_SCENARIOS.length);
  assert.deepEqual(report.results.map(result => result.id), EXPECTED_SCENARIOS);

  for (const result of report.results) {
    assert.equal(result.status, 'PASS', JSON.stringify(result));
    assert.equal(result.realBoundaryObserved, true, JSON.stringify(result));
    assert.equal(result.databaseIntegrity, 'ok', JSON.stringify(result));
    assert.equal(result.activeWriterCount <= 1, true, JSON.stringify(result));
    assert.equal(result.automaticSendCount, 0, JSON.stringify(result));
    assert.equal(result.loggedOutResurrected, false, JSON.stringify(result));
    assert.equal(result.restartStateDeterministic, true, JSON.stringify(result));
    assert.equal(result.repairPersistent, true, JSON.stringify(result));
    assert.equal(result.repairIdempotent, true, JSON.stringify(result));
    assert.equal(result.auditReceiptPresent, true, JSON.stringify(result));
  }
});
