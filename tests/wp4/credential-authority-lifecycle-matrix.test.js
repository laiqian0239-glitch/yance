'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { GENESIS_POINTS, MIGRATION_POINTS, runCredentialAuthorityLifecycleMatrix } = require('../../tools/wp4/credential-authority-lifecycle-matrix');

test('real child-process authority lifecycle matrix recovers genesis and WP3 migration crash points', async () => {
  const result = await runCredentialAuthorityLifecycleMatrix();
  assert.equal(result.status, 'PASS');
  assert.equal(result.genesisCrashPointCount, GENESIS_POINTS.length);
  assert.equal(result.migrationCrashPointCount, MIGRATION_POINTS.length);
  for (const row of result.cases) {
    assert.equal(row.status, 'PASS', row.id);
    assert.equal(row.secretValueRecorded, false);
    assert.equal(row.secretHashRecorded, false);
  }
});
