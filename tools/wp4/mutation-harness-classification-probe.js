#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const { classifyOracleExecution } = require('./run-credential-mutation-tests');

function runMutationHarnessClassificationProbe() {
  const cleanKill = classifyOracleExecution({ exitCode: 1, signal: '', timedOut: false, harnessError: null, spawnError: null });
  assert.equal(cleanKill.status, 'KILLED');
  assert.equal(cleanKill.valid, true);
  assert.equal(cleanKill.killed, true);

  const invalid = [
    classifyOracleExecution({ exitCode: null, signal: 'SIGKILL', timedOut: false, harnessError: 'isolated-command-helper-failed' }),
    classifyOracleExecution({ exitCode: 1, signal: 'SIGKILL', timedOut: false }),
    classifyOracleExecution({ exitCode: null, signal: '', timedOut: false }),
    classifyOracleExecution({ exitCode: 1, signal: '', timedOut: true }),
    classifyOracleExecution({ exitCode: 1, signal: '', timedOut: false, spawnError: { code: 'ENOENT' } }),
    classifyOracleExecution({ exitCode: 1, signal: '', timedOut: false, outputTail: 'WP4_CREDENTIAL_MUTATION_MATRIX_TARGET_INVALID Unknown targeted fault matrix mutation M99' })
  ];
  for (const row of invalid) {
    assert.equal(row.status, 'INVALID');
    assert.equal(row.valid, false);
    assert.equal(row.killed, false);
  }
  return { schemaVersion: 1, status: 'PASS', probe: 'MUTATION_HARNESS_CLASSIFICATION', caseCount: 7, cleanKillAccepted: true, invalidExecutionRejected: 6 };
}

module.exports = { runMutationHarnessClassificationProbe };
if (require.main === module) {
  try { process.stdout.write(`${JSON.stringify(runMutationHarnessClassificationProbe(), null, 2)}
`); }
  catch (error) { process.stderr.write(`${error.stack || error.message}
`); process.exit(1); }
}
