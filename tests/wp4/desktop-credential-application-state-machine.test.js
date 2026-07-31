'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  ALLOWED,
  STATES,
  transitionDesktopCredentialApplication
} = require('../../shared/desktopCredentialApplicationStateMachine');
const { CredentialVault } = require('../../electron/credentialVault');
const { CredentialVaultHost } = require('../../electron/desktopHost/CredentialVaultHost');

function safeStorage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: value => Buffer.from(String(value), 'utf8'),
    decryptString: value => Buffer.from(value).toString('utf8')
  };
}

test('Desktop Credential Application state graph exactly matches the reviewed lifecycle document', () => {
  const document = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../docs/wp4/desktop-credential-application-lifecycle-state-machine.json'), 'utf8'));
  assert.deepEqual(Object.keys(document.states).sort(), Object.values(STATES).sort());
  for (const state of Object.values(STATES)) {
    assert.deepEqual([...ALLOWED[state]].sort(), [...document.states[state].allowedNextStates].sort(), state);
  }

  const lifecycle = { state: STATES.IDLE, stateHistory: [] };
  assert.throws(
    () => transitionDesktopCredentialApplication(lifecycle, STATES.MUTATION_COMMITTING),
    error => error.reasonCode === 'WP4_DESKTOP_CREDENTIAL_APPLICATION_TRANSITION_INVALID'
  );
});

test('coordinator-required vault host rejects every local desktop, migration, reset and generic mutation bypass', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wp4-app-coordinator-required-'));
  try {
    const vault = new CredentialVault(path.join(root, 'credentials.safe.json'), { safeStorage: safeStorage() });
    const host = new CredentialVaultHost({ vault });
    host.requireApplicationCoordinator(true);

    const rejected = error => error.reasonCode === 'WP4_DESKTOP_CREDENTIAL_APPLICATION_COORDINATOR_REQUIRED';
    await assert.rejects(Promise.resolve().then(() => host.persistFromDesktop('bypass/desktop', { token: 'x' })), rejected);
    await assert.rejects(Promise.resolve().then(() => host.removeFromDesktop('bypass/desktop')), rejected);
    await assert.rejects(host.executeCustodyTransaction('persist', 'bypass/local', { token: 'x' }, { requestId: 'bypass-local' }), rejected);
    await assert.rejects(Promise.resolve().then(() => host.persistFromMigration('bypass/migration', { token: 'x' }, { requestId: 'bypass-migration' })), rejected);
    await assert.rejects(Promise.resolve().then(() => host.resetAfterBackendStopped({ exitConfirmed: true, requestId: 'bypass-reset' })), rejected);
    assert.equal(host.refs().length, 0);

    const lease = await host.acquireApplicationLease({ operationId: 'authorized', operationType: 'DESKTOP_MUTATION', requestId: 'authorized-1' });
    const committed = await host.executeDesktopMutation('persist', 'authorized/desktop', { token: 'kept-secret' }, {
      requestId: 'authorized-1',
      applicationLeaseToken: lease
    });
    assert.equal(committed.transactionState, 'COMMITTED');
    assert.equal(host.refs().includes('authorized/desktop'), true);
    await host.releaseApplicationLease(lease);
  } finally {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});
