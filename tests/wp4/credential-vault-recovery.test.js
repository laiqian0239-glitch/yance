'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { recoverCredentialVaults } = require('../../electron/credentialVaultRecovery');
const { DesktopCredentialApplicationCoordinator } = require('../../electron/desktopHost/DesktopCredentialApplicationCoordinator');

function coded(reasonCode) {
  return Object.assign(new Error(reasonCode), { reasonCode, code: reasonCode });
}

function withLegacyVaultFile() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wp4-vault-recovery-'));
  const file = path.join(root, 'secure', 'credentials.safe.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '{}\n', 'utf8');
  return { root, file, close: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test('per-ref recovery replaces a matching unreadable destination without one bad ref poisoning the scan', async () => {
  const legacy = withLegacyVaultFile();
  const writes = [];
  const destinationErrors = new Map([
    ['model:recoverable', coded('CREDENTIAL_VAULT_DECRYPT_FAILED')],
    ['model:unrecoverable', coded('CREDENTIAL_VAULT_ENTRY_CORRUPTED')]
  ]);
  const host = {
    async initialize() {},
    refs: () => [...destinationErrors.keys()],
    get(ref) { throw destinationErrors.get(ref); },
    async persistFromMigration(ref, value, options) {
      writes.push({ ref, value, options });
      destinationErrors.delete(ref);
      return { persisted: true, transactionState: 'COMMITTED' };
    }
  };
  const sourceVault = {
    async load() {},
    refs: () => ['model:recoverable', 'model:source-unreadable'],
    getRequired(ref) {
      if (ref === 'model:recoverable') return { token: 'restored' };
      throw coded('CREDENTIAL_VAULT_DECRYPT_FAILED');
    }
  };
  try {
    const report = await recoverCredentialVaults({
      destinationVault: { file: path.join(legacy.root, 'destination.safe.json') },
      credentialVaultHost: host,
      createVault: () => sourceVault,
      legacyRoots: [legacy.root],
      applicationLeaseToken: 'lease-1',
      recoverSystemCredential: async () => ({ recovered: false })
    });
    assert.equal(writes.length, 1);
    assert.equal(writes[0].ref, 'model:recoverable');
    assert.deepEqual(writes[0].value, { token: 'restored' });
    assert.equal(report.replacedUnreadableRefs.some(row => row.ref === 'model:recoverable'), true);
    assert.equal(report.unreadableRefs.some(row => row.ref === 'model:source-unreadable'), true);
    assert.equal(report.unreadableRefs.some(row => row.ref === 'model:unrecoverable' && row.reason === 'destination-remains-unreadable'), true);
    assert.equal(report.ok, false);
  } finally { legacy.close(); }
});

test('secure-storage unavailable remains fail-closed during destination enumeration', async () => {
  const host = {
    async initialize() {},
    refs: () => ['model:user'],
    get() { throw coded('CREDENTIAL_VAULT_SECURE_STORAGE_UNAVAILABLE'); },
    async persistFromMigration() { throw new Error('must not mutate'); }
  };
  await assert.rejects(
    recoverCredentialVaults({
      destinationVault: { file: 'destination.safe.json' },
      credentialVaultHost: host,
      createVault: () => ({ refs: () => [] })
    }),
    error => error.reasonCode === 'CREDENTIAL_VAULT_SECURE_STORAGE_UNAVAILABLE'
  );
});

test('owner-free ACTIVE assertion does not conflate vault decryptability with owner release', () => {
  const authority = {
    activeOwnerSession: null,
    pendingOwnerSession: null,
    activeTransactionId: '',
    pendingOperations: 0,
    lifecycle: { state: 'ACTIVE' },
    available: false,
    decryptReasonCode: 'CREDENTIAL_VAULT_DECRYPT_FAILED'
  };
  const backend = {
    state: 'STOPPED',
    running: false,
    backendPid: 0,
    ownershipPresent: false,
    startupPending: false,
    shutdownPending: false
  };
  const vaultHost = {
    metadataPath: path.join(os.tmpdir(), 'wp4-owner-release-meta.json'),
    snapshotMetadata: () => authority,
    applicationFenceSnapshot: () => null
  };
  const desktopHost = {
    credentialVaultHost: vaultHost,
    setCredentialApplicationCoordinator() {},
    snapshot: () => ({ backend })
  };
  const coordinator = new DesktopCredentialApplicationCoordinator({
    desktopHost,
    vaultHost,
    startBackend: async () => ({}),
    stopBackend: async () => ({ stopped: true, exitConfirmed: true }),
    backendSnapshot: () => backend
  });
  assert.doesNotThrow(() => coordinator._assertOwnerReleased());

  authority.activeOwnerSession = { backendSessionId: 'still-owned' };
  assert.throws(
    () => coordinator._assertOwnerReleased(),
    error => error.reasonCode === 'WP4_CREDENTIAL_OWNER_EXIT_RECOVERY_FAILED'
  );
  authority.activeOwnerSession = null;
  authority.lifecycle = { state: 'RECOVERING' };
  assert.throws(
    () => coordinator._assertOwnerReleased(),
    error => error.reasonCode === 'WP4_CREDENTIAL_OWNER_EXIT_RECOVERY_FAILED'
  );
});
