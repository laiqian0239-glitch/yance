'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Duplex } = require('node:stream');
const { CredentialCustodyClient } = require('../../backend/services/credentialCustodyClient');
const { CredentialCustodyHost } = require('../../electron/desktopHost/CredentialCustodyHost');

function duplexPair() {
  let left; let right;
  left = new Duplex({ read() {}, write(chunk, _encoding, callback) { right.push(Buffer.from(chunk)); callback(); } });
  right = new Duplex({ read() {}, write(chunk, _encoding, callback) { left.push(Buffer.from(chunk)); callback(); } });
  return { left, right };
}

test('Electron vault write failure is acknowledged as failure and runtime generation does not advance', async () => {
  const { left, right } = duplexPair();
  const context = { backendPid: process.pid, manifestSha256: 'b'.repeat(64), vaultEpoch: 'epoch-2', generation: 4 };
  const host = new CredentialCustodyHost({
    stream: left, context,
    vaultHost: { async applyCustodyMutation() { throw Object.assign(new Error('vault unavailable'), { reasonCode: 'CREDENTIAL_VAULT_PERSIST_FAILED' }); } }
  });
  const client = new CredentialCustodyClient({
    stream: right, timeoutMs: 500, generation: 4,
    context: { backendPid: process.pid, manifestSha256: context.manifestSha256, credentialVaultEpoch: context.vaultEpoch, credentialGeneration: 4 }
  });
  await assert.rejects(client.request('persist', 'telegram/session', { session: 'secret' }), error => error.reasonCode === 'CREDENTIAL_VAULT_PERSIST_FAILED');
  assert.equal(client.snapshot().generation, 4);
  assert.equal(client.snapshot().acknowledgedCount, 0);
  assert.equal(host.snapshot().failedCount, 1);
  client.close(); host.close();
});

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { CredentialVault } = require('../../electron/credentialVault');
const { CredentialVaultHost } = require('../../electron/desktopHost/CredentialVaultHost');

test('durable authority event completes metadata projection after a metadata write failure and restart', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-wp4-vault-projection-'));
  const metadataPath = path.join(root, 'vault-meta.json');
  const transactionPath = path.join(root, 'credential-authority-journal.json');
  const vaultPath = path.join(root, 'vault.bin');
  const safeStorage = { isEncryptionAvailable: () => true, encryptString: value => Buffer.from(String(value), 'utf8'), decryptString: value => Buffer.from(value).toString('utf8') };
  const vault = new CredentialVault(vaultPath, { safeStorage });
  const host = new CredentialVaultHost({ vault, metadataPath, transactionPath });
  await host.persistFromDesktop('telegram/session', { session: 'old' });
  host.createHydrationFrame({ startupNonce: 'metadata-failure-startup', oneTimeToken: 'x'.repeat(43), backendPid: process.pid, manifestSha256: 'a'.repeat(64) });
  const request = require('../../shared/credentialCustodyProtocol').makeCustodyRequest({
    action: 'PREPARE', requestId: 'metadata-failure', operation: 'persist', ref: 'telegram/session', value: { session: 'new' },
    backendPid: process.pid, manifestSha256: 'a'.repeat(64), vaultEpoch: host.snapshotMetadata().vaultEpoch, generation: 2
  });
  await host.prepareCustodyTransaction(request);
  const saveMetadata = host._saveMetadata.bind(host);
  host._saveMetadata = next => {
    if (Number(next.generation) === 3) throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
    return saveMetadata(next);
  };
  await assert.rejects(host.commitCustodyTransaction({ ...request, action: 'COMMIT' }), error => error.reasonCode === 'CREDENTIAL_COMMIT_RESULT_INDETERMINATE');
  assert.deepEqual(vault.getRequired('telegram/session'), { session: 'new' });
  assert.equal(JSON.parse(fs.readFileSync(metadataPath, 'utf8')).generation, 2);
  const restartedVault = new CredentialVault(vaultPath, { safeStorage });
  const restarted = new CredentialVaultHost({ vault: restartedVault, metadataPath, transactionPath });
  assert.equal(restarted.snapshotMetadata().generation, 3);
  assert.deepEqual(restartedVault.getRequired('telegram/session'), { session: 'new' });
  const query = await restarted.queryCustodyTransaction({ ...request, action: 'QUERY' });
  assert.equal(query.transactionState, 'COMMITTED');
  assert.equal(query.persisted, true);
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});
