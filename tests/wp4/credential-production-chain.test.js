'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { runProductionCredentialScenario } = require('../../tools/wp4/production-credential-runtime');

test('real backend rejects post-ready generic IPC and uses restart plus acknowledged custody', { timeout: 120000 }, async () => {
  const result = await runProductionCredentialScenario();
  assert.equal(result.status, 'PASS');
  assert.equal(result.leakCount, 0);
  assert.equal(result.genericNodeIpcSecretTransportCount, 0);
  assert.equal(result.dedicatedCredentialPipeCount, 2);
  assert.equal(result.postReadyMutationAttemptCount, 3);
  assert.deepEqual(result.generationChanges, [1, 2, 3, 4, 5]);
  assert.equal(result.vaultAcknowledgement.success, true);
  assert.equal(result.vaultAcknowledgement.failureReasonCode, 'CREDENTIAL_VAULT_PERSIST_FAILED');
  for (const [name, passed] of Object.entries(result.checks)) assert.equal(passed, true, name);
});
