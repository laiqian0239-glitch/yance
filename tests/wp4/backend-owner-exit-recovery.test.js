'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { runBackendOwnerExitMatrix } = require('../../tools/wp4/backend-owner-exit-probe');
const { realBackendExitCase } = require('../../tools/wp4/credential-architecture-fault-matrix');

test('real BackendProcessHost owner-exit matrix terminates old authority before automatic restart', { timeout: 240000 }, async () => {
  const result = await runBackendOwnerExitMatrix();
  assert.equal(result.status, 'PASS');
  assert.equal(result.f16Synthetic, false);
  const modes = new Set(result.cases.map(row => row.mode));
  if (modes.has('PREPARED')) {
    const f16 = realBackendExitCase(result);
    assert.equal(f16.status, 'PASS');
    assert.equal(f16.evidenceSource, 'BackendProcessHost.real-exit:PREPARED');
    assert.equal(f16.productionChainExecuted, true);
  }
  for (const row of result.cases) {
    assert.equal(row.status, 'PASS', row.id);
    assert.equal(row.activeTransactionId, '', row.id);
    assert.equal(row.authorityStateAfterRecovery, 'ACTIVE', row.id);
    assert.equal(row.backendFinalState, 'RUNNING', row.id);
    assert.equal(row.nextLegalRequestSucceeded, true, row.id);
    assert.equal(row.nextFd5HydrationSucceeded, true, row.id);
  }
});
