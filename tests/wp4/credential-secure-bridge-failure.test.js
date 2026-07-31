'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { runSecureBridgeFailureProbe } = require('../../tools/wp4/credential-secure-bridge-failure-probe');

test('SecureBridge runtime update failure rolls back Electron and all backend authorities before the next request', async () => {
  const result = await runSecureBridgeFailureProbe();
  assert.equal(result.status, 'PASS', JSON.stringify(result));
  assert.equal(result.failureReasonCode, 'SECURE_BRIDGE_UPDATE_FAILED');
  assert.equal(result.finalTransactionState, 'ROLLED_BACK');
  assert.equal(result.nextLegalRequestSucceeded, true);
});
