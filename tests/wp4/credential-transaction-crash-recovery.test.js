'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { runCredentialCrashMatrix, CRASH_POINTS } = require('../../tools/wp4/credential-crash-matrix');

test('real child-process crash matrix deterministically recovers every credential commit disk state', async () => {
  const result = await runCredentialCrashMatrix();
  assert.equal(result.status, 'PASS');
  assert.deepEqual(result.crashPoints, [...CRASH_POINTS]);
  for (const row of result.scenarios) {
    assert.equal(row.status, 'PASS', row.crashPoint);
    assert.ok(row.exitCode !== 0 || row.terminationSignal, row.crashPoint);
    assert.notEqual(row.query.transactionState, 'FAILED', row.crashPoint);
    assert.equal(row.nextLegalRequest.transactionState, 'COMMITTED', row.crashPoint);
    assert.equal(row.nextFd5Hydration.expectedReferencesPresent, true, row.crashPoint);
    assert.equal(row.secretPresentAfterRecovery && row.query.transactionState === 'FAILED', false, row.crashPoint);
  }
});
