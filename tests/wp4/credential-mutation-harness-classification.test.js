'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { classifyOracleExecution } = require('../../tools/wp4/run-credential-mutation-tests');

test('mutation oracle accepts only a clean nonzero command exit as a kill', () => {
  const killed = classifyOracleExecution({ exitCode: 1, signal: '', timedOut: false, harnessError: null, spawnError: null });
  assert.deepEqual(killed, { status: 'KILLED', valid: true, killed: true, reasonCode: '', invalidReasons: [] });

  const survived = classifyOracleExecution({ exitCode: 0, signal: '', timedOut: false, harnessError: null, spawnError: null });
  assert.equal(survived.status, 'SURVIVED');
  assert.equal(survived.valid, true);
  assert.equal(survived.killed, false);
});

test('helper failure, signal, timeout, spawn error, or null exit is INVALID and never a kill', () => {
  const cases = [
    { exitCode: null, signal: 'SIGKILL', timedOut: false, harnessError: 'isolated-command-helper-failed' },
    { exitCode: 1, signal: 'SIGKILL', timedOut: false },
    { exitCode: null, signal: 'SIGKILL', timedOut: true },
    { exitCode: 1, signal: '', timedOut: false, spawnError: { code: 'ENOENT', message: 'missing' } },
    { exitCode: null, signal: '', timedOut: false },
    { exitCode: 1, signal: '', timedOut: false, outputTail: 'WP4_CREDENTIAL_MUTATION_MATRIX_TARGET_INVALID Unknown targeted fault matrix mutation M99' },
    null
  ];
  for (const value of cases) {
    const result = classifyOracleExecution(value);
    assert.equal(result.status, 'INVALID');
    assert.equal(result.valid, false);
    assert.equal(result.killed, false);
    assert.equal(result.reasonCode, 'WP4_MUTATION_ORACLE_HARNESS_INVALID');
    assert.ok(result.invalidReasons.length > 0);
  }
});

test('non-required complete matrix is explicitly NOT_REQUIRED rather than synthesized as killed', () => {
  const result = classifyOracleExecution({ exitCode: 0, signal: '', timedOut: false }, { required: false });
  assert.deepEqual(result, { status: 'NOT_REQUIRED', valid: true, killed: true, reasonCode: '' });
});
