'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Duplex } = require('node:stream');
const { CredentialCustodyClient } = require('../../backend/services/credentialCustodyClient');

class SilentDuplex extends Duplex {
  _read() {}
  _write(_chunk, _encoding, callback) { callback(); }
}

test('backend terminates when PREPARE and recovery QUERY both time out', async () => {
  const client = new CredentialCustodyClient({
    stream: new SilentDuplex(), timeoutMs: 35, generation: 1,
    context: { backendPid: process.pid, manifestSha256: 'a'.repeat(64), credentialVaultEpoch: 'epoch-1', credentialGeneration: 1 }
  });
  await assert.rejects(client.request('persist', 'telegram/session', { session: 'secret' }), error => error.reasonCode === 'WP4_CREDENTIAL_PREPARE_RESULT_INDETERMINATE');
  assert.equal(client.snapshot().generation, 1);
  assert.equal(client.snapshot().acknowledgedCount, 0);
  assert.equal(client.snapshot().terminal, true);
  assert.equal(client.snapshot().indeterminatePrepareCount, 1);
  client.close();
});
