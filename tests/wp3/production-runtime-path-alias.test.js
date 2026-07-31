'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { runProductionRuntimeAliasScenario } = require('../../tools/wp3/production-runtime-alias-scenario');

test('real BackendProcessHost rejects a second production backend for every physical path alias', { timeout: 120000 }, async () => {
  const result = await runProductionRuntimeAliasScenario();
  assert.equal(result.status, 'PASS');
  assert.equal(result.checks.everyAliasRejectedWithRuntimeMutexHeld, true);
  assert.equal(result.checks.noSecondBackendReady, true);
  assert.equal(result.checks.noSecondApiPortOpened, true);
});
