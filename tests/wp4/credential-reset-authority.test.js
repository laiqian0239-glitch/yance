'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { CredentialVault } = require('../../electron/credentialVault');
const { CredentialVaultHost } = require('../../electron/desktopHost/CredentialVaultHost');

function storage() {
  return { isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value, 'utf8'), decryptString: value => Buffer.from(value).toString('utf8') };
}
function make(root) {
  const vault = new CredentialVault(path.join(root, 'vault.json'), { safeStorage: storage() });
  return new CredentialVaultHost({ vault, metadataPath: path.join(root, 'metadata.json'), transactionPath: path.join(root, 'journal.json') });
}

test('reset authorization consumption does not fork authority history and survives restart', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wp4-reset-authority-'));
  const host = make(root);
  await host.initialize();
  const reset = await host.resetAfterBackendStopped({ exitConfirmed: true });
  assert.equal(reset.persisted, true);
  const prepared = await host.createHydrationFrame({ startupNonce: 'reset-startup', oneTimeToken: 'token', backendPid: 42, manifestSha256: 'a'.repeat(64) });
  assert.ok(prepared.resetAuthorization);
  assert.equal(await host.markHydrationAccepted({
    startupNonce: 'reset-startup', authorityEventId: prepared.frame.authorityEventId,
    vaultEpoch: prepared.frame.vaultEpoch, generation: prepared.frame.generation,
    vaultReferenceCount: prepared.frame.vaultReferenceCount, decryptedEntryCount: prepared.frame.decryptedEntryCount,
    frameEntryCount: prepared.frame.frameEntryCount, restoredReferenceCount: prepared.frame.frameEntryCount,
    payloadBytes: prepared.frame.payloadBytes
  }), true);
  assert.equal(host.snapshotMetadata().pendingReset, false);
  const restarted = make(root);
  await restarted.initialize();
  assert.equal(restarted.snapshotMetadata().pendingReset, false);
  const next = await restarted.createHydrationFrame({ startupNonce: 'next-startup', oneTimeToken: 'token2', backendPid: 43, manifestSha256: 'b'.repeat(64) });
  assert.equal(next.resetAuthorization, null);
});
