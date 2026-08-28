'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { CredentialVault } = require('../../electron/credentialVault');
const { CredentialVaultHost } = require('../../electron/desktopHost/CredentialVaultHost');
const { createOwnership, temporaryRoot } = require('./helpers');
const safeStorage = { isEncryptionAvailable: () => true, encryptString: value => Buffer.from(String(value), 'utf8'), decryptString: value => Buffer.from(value).toString('utf8') };
test('same vault epoch rejects lower or repeated generation', async () => {
  const root = temporaryRoot();
  const vault = new CredentialVault(path.join(root, 'vault', 'credential-vault.bin'), { safeStorage });
  const vaultHost = new CredentialVaultHost({ vault, metadataPath: path.join(root, 'vault', 'vault-meta.json') });
  const base = { startupNonce: 'nonce', oneTimeToken: 'x'.repeat(43), backendPid: process.pid, manifestSha256: 'a'.repeat(64) };
  const one = (await vaultHost.createHydrationFrame(base)).frame;
  const two = (await vaultHost.createHydrationFrame({ ...base, startupNonce: 'nonce-2' })).frame;
  assert.equal(one.generation, 1);
  assert.equal(two.generation, 2);
  assert.equal(one.vaultEpoch, two.vaultEpoch);
  const ownership = await createOwnership(root);
  const guard = ownership.guard();
  const accept = frame => ownership.store.acceptCredentialHydration({
    ...guard, vaultEpoch: frame.vaultEpoch, generation: frame.generation,
    authorityEventId: frame.authorityEventId, authorityHeadDigest: frame.authorityHeadDigest,
    referenceCount: frame.vaultReferenceCount, payloadBytes: frame.payloadBytes
  });
  accept(two);
  assert.throws(() => accept(two), error => error.reasonCode === 'CREDENTIAL_GENERATION_ROLLBACK_DENIED');
  assert.throws(() => accept(one), error => error.reasonCode === 'CREDENTIAL_GENERATION_ROLLBACK_DENIED');
  await ownership.release(); fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});
