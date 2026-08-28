'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  CredentialVault, DECRYPT_FAILED, ENTRY_CORRUPTED, SECURE_STORAGE_UNAVAILABLE
} = require('../../electron/credentialVault');
const { CredentialVaultHost, HYDRATION_REFERENCE_MISMATCH } = require('../../electron/desktopHost/CredentialVaultHost');

function storage(options = {}) {
  return {
    isEncryptionAvailable: () => options.available !== false,
    encryptString: value => Buffer.from(value, 'utf8'),
    decryptString: value => {
      if (options.throwDecrypt) throw new Error('simulated DPAPI failure');
      if (options.invalidJson) return '{not-json';
      return Buffer.from(value).toString('utf8');
    }
  };
}
function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wp4-strict-hydration-'));
  const paths = { vault: path.join(root, 'vault.json'), metadata: path.join(root, 'metadata.json'), journal: path.join(root, 'journal.json') };
  const vault = new CredentialVault(paths.vault, { safeStorage: storage() });
  const host = new CredentialVaultHost({ vault, metadataPath: paths.metadata, transactionPath: paths.journal });
  return { root, paths, vault, host, close() { fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); } };
}
async function seed(x) { await x.host.persistFromDesktop('secret:one', { token: 'not-recorded' }); }
function reload(x, safeStorage) {
  const vault = new CredentialVault(x.paths.vault, { safeStorage });
  return new CredentialVaultHost({ vault, metadataPath: x.paths.metadata, transactionPath: x.paths.journal });
}
async function hydrate(host, nonce = 'strict-hydration') {
  return await host.createHydrationFrame({ startupNonce: nonce, oneTimeToken: 'x'.repeat(43), backendPid: process.pid, manifestSha256: 'a'.repeat(64) });
}

test('safeStorage unavailable with existing references fails hydration without advancing generation', async () => {
  const x = setup();
  try {
    await seed(x);
    const before = x.host.snapshotMetadata().generation;
    const restarted = reload(x, storage({ available: false }));
    await assert.rejects(hydrate(restarted), error => error.reasonCode === SECURE_STORAGE_UNAVAILABLE);
    assert.equal(restarted.snapshotMetadata().generation, before);
  } finally { x.close(); }
});

test('ciphertext/DPAPI decryption failure rejects the entire hydration', async () => {
  const x = setup();
  try {
    await seed(x);
    const before = x.host.snapshotMetadata().generation;
    const restarted = reload(x, storage({ throwDecrypt: true }));
    await assert.rejects(hydrate(restarted), error => error.reasonCode === DECRYPT_FAILED);
    assert.equal(restarted.snapshotMetadata().generation, before);
  } finally { x.close(); }
});

test('decrypted credential JSON corruption rejects the entire hydration', async () => {
  const x = setup();
  try {
    await seed(x);
    const before = x.host.snapshotMetadata().generation;
    const restarted = reload(x, storage({ invalidJson: true }));
    await assert.rejects(hydrate(restarted), error => error.reasonCode === ENTRY_CORRUPTED);
    assert.equal(restarted.snapshotMetadata().generation, before);
  } finally { x.close(); }
});

test('vault reference count and decrypted entry count mismatch rejects hydration before generation advance', async () => {
  const x = setup();
  try {
    await seed(x);
    const before = x.host.snapshotMetadata().generation;
    x.vault.entriesStrict = () => [];
    await assert.rejects(hydrate(x.host), error => error.reasonCode === HYDRATION_REFERENCE_MISMATCH);
    assert.equal(x.host.snapshotMetadata().generation, before);
  } finally { x.close(); }
});
