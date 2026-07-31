'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { encodeCredentialFrame, makeCredentialFrame } = require('../../shared/credentialProtocol');
const { startup } = require('./helpers');
test('credential message larger than 262144 bytes is denied', () => {
  const context = startup();
  const frame = makeCredentialFrame({ startupNonce: context.startupNonce, oneTimeToken: context.credentialOneTimeToken, backendPid: context.backendPid, manifestSha256: context.manifestSha256, vaultEpoch: context.credentialVaultEpoch, generation: 1, authorityEventId: context.credentialAuthorityEventId, authorityHeadDigest: context.credentialAuthorityHeadDigest, vaultReferenceCount: 1, decryptedEntryCount: 1, entries: [{ ref: 'large', value: { secret: 'x'.repeat(270000) } }] });
  assert.throws(() => encodeCredentialFrame(frame), error => error.reasonCode === 'CREDENTIAL_MESSAGE_TOO_LARGE');
});
