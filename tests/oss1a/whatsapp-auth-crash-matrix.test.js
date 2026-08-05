'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const EXPECTED_SCENARIOS = Object.freeze([
  'AUTH_ACCOUNT_INSERT_BEFORE_KEYS',
  'AUTH_KEYS_MID_BATCH',
  'AUTH_CREDS_AFTER_UPDATE_BEFORE_COMMIT',
  'LEGACY_IMPORT_BEFORE_DB_COMMIT',
  'LEGACY_IMPORT_AFTER_DB_COMMIT_BEFORE_ARCHIVE',
  'LOGOUT_TOMBSTONE_BEFORE_AND_AFTER_COMMIT'
]);

function loadMatrix() {
  try {
    return require('../../tools/oss1a/whatsapp-auth-crash-matrix');
  } catch (error) {
    assert.fail(`Task 10 auth crash matrix must exist: ${error.code || error.message}`);
  }
}

test('auth crash matrix freezes all six real process failure scenarios', () => {
  const matrix = loadMatrix();
  assert.deepEqual(
    matrix.AUTH_CRASH_SCENARIOS.map(scenario => scenario.id),
    EXPECTED_SCENARIOS
  );
  for (const scenario of matrix.AUTH_CRASH_SCENARIOS) {
    assert.equal(scenario.execution, 'CHILD_PROCESS_CRASH_AND_RESTART');
    assert.equal(typeof scenario.faultPoint, 'string');
    assert.ok(scenario.faultPoint.length > 0);
  }
});

test('auth crash matrix fails closed and proves durable recovery for every scenario', async () => {
  const matrix = loadMatrix();
  const report = await matrix.runAuthCrashMatrix({ quiet: true });

  assert.equal(report.matrix, 'OSS1A_WHATSAPP_AUTH_CRASH_MATRIX');
  assert.equal(report.platform, process.platform);
  assert.equal(report.warningOnly, false);
  assert.deepEqual(report.warnings, []);
  assert.equal(report.scenarioCount, EXPECTED_SCENARIOS.length);
  assert.deepEqual(report.results.map(result => result.id), EXPECTED_SCENARIOS);

  for (const result of report.results) {
    assert.equal(result.status, 'PASS', JSON.stringify(result));
    assert.equal(result.childExitedAbnormally, true, JSON.stringify(result));
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
