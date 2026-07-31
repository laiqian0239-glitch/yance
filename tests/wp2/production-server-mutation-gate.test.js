'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { REASON_CODE, SKIP_ENV, runServerMutationGate } = require('../../tools/wp2/server-mutation-gate');

const ROOT = path.resolve(__dirname, '../..');

if (process.env[SKIP_ENV] === '1') {
  test('real backend/server.js mutation gate meta-test', { skip: 'nested formal mutation execution' }, () => {});
} else {
  test('real backend/server.js mutation forces required test and formal evidence generator to fail nonzero', () => {
    const result = runServerMutationGate(ROOT);
    assert.equal(result.status, 'PASS');
    assert.equal(result.reasonCode, REASON_CODE);
    assert.equal(result.target, 'backend/server.js');
    assert.notEqual(result.requiredTest.exitCode, 0);
    assert.equal(result.requiredTest.reasonCodeObserved, true);
    assert.notEqual(result.evidenceGenerator.exitCode, 0);
    assert.equal(result.evidenceGenerator.reasonCodeObserved, true);
    process.stdout.write(`WP2_SERVER_MUTATION_GATE ${JSON.stringify(result)}\n`);
  });
}
