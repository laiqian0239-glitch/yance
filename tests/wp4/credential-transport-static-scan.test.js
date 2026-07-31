'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { scanSecretTransports } = require('../../tools/wp4/scan-secret-transports');

test('production code contains no secret-bearing generic Node IPC transport', () => {
  const result = scanSecretTransports();
  assert.equal(result.status, 'PASS', JSON.stringify(result.unapprovedGenericSendSites));
  assert.equal(result.genericNodeIpcSecretTransportCount, 0);
  assert.equal(result.dedicatedCredentialPipeCount, 2);
  assert.deepEqual(result.forbiddenMessageTypes, [
    'secure:credential:hydrate',
    'secure:credential:set',
    'secure:credential:delete',
    'secure:credential:persist',
    'secure:credential:remove'
  ]);
  assert.deepEqual(result.forbiddenOccurrences, []);
  assert.deepEqual(result.bootFailureBuilderViolations, []);
  assert.deepEqual(result.serverStartupFailureBuilderViolations, []);
});
