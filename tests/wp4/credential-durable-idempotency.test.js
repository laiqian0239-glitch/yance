'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Duplex } = require('node:stream');
const { CredentialVault } = require('../../electron/credentialVault');
const { CredentialVaultHost } = require('../../electron/desktopHost/CredentialVaultHost');
const { CredentialCustodyHost } = require('../../electron/desktopHost/CredentialCustodyHost');
const { CredentialCustodyClient } = require('../../backend/services/credentialCustodyClient');
const { makeCustodyRequest } = require('../../shared/credentialCustodyProtocol');

function storage() {
  const key = crypto.createHash('sha256').update('durable-idempotency').digest();
  return {
    isEncryptionAvailable: () => true,
    encryptString(value) {
      const iv = Buffer.alloc(12, 6);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const body = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), body]);
    },
    decryptString(value) {
      const bytes = Buffer.from(value);
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
      decipher.setAuthTag(bytes.subarray(12, 28));
      return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8');
    }
  };
}

function pair() {
  let a;
  let b;
  a = new Duplex({ read() {}, write(chunk, _encoding, callback) { b.push(Buffer.from(chunk)); callback(); } });
  b = new Duplex({ read() {}, write(chunk, _encoding, callback) { a.push(Buffer.from(chunk)); callback(); } });
  return { a, b };
}

async function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wp4-durable-replay-'));
  const paths = { vault: path.join(root, 'vault.bin'), metadata: path.join(root, 'meta.json'), journal: path.join(root, 'journal.json') };
  const vault = new CredentialVault(paths.vault, { safeStorage: storage() });
  const vaultHost = new CredentialVaultHost({ vault, metadataPath: paths.metadata, transactionPath: paths.journal, randomUUID: () => 'durable-epoch' });
  const initial = await vaultHost.createHydrationFrame({ startupNonce: 'n', oneTimeToken: 'x'.repeat(43), backendPid: process.pid, manifestSha256: 'd'.repeat(64) });
  return { root, paths, vault, vaultHost, initial, close() { fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); } };
}

function channel(vaultHost, generation, options = {}) {
  const streams = pair();
  let indeterminate = 0;
  const host = new CredentialCustodyHost({
    stream: streams.a,
    vaultHost,
    context: { backendPid: process.pid, manifestSha256: 'd'.repeat(64), vaultEpoch: 'durable-epoch', generation },
    shouldDropAck: options.shouldDropAck || (() => false)
  });
  const client = new CredentialCustodyClient({
    stream: streams.b,
    timeoutMs: 35,
    generation,
    context: { backendPid: process.pid, manifestSha256: 'd'.repeat(64), credentialVaultEpoch: 'durable-epoch', credentialGeneration: generation },
    onIndeterminateCommit: () => { indeterminate += 1; }
  });
  return { host, client, get indeterminate() { return indeterminate; }, close() { client.close(); host.close(); } };
}

function rawRequest(action, requestId, ref, value, generation) {
  return makeCustodyRequest({ action, requestId, operation: 'persist', ref, value, backendPid: process.pid, manifestSha256: 'd'.repeat(64), vaultEpoch: 'durable-epoch', generation });
}

test('same requestId and mutation returns original COMMITTED result after backend restart without advancing generation', async () => {
  const x = await setup();
  const first = channel(x.vaultHost, 1);
  try {
    const original = await first.client.request('persist', 'provider/replay', { token: 'redacted' }, { requestId: 'durable-A' });
    assert.equal(original.generation, 2);
    assert.equal(x.vaultHost.snapshotMetadata().generation, 2);
    first.close();

    const restartFrame = await x.vaultHost.createHydrationFrame({ startupNonce: 'n2', oneTimeToken: 'y'.repeat(43), backendPid: process.pid, manifestSha256: 'd'.repeat(64) });
    assert.equal(restartFrame.frame.generation, 3);
    const second = channel(x.vaultHost, 3);
    try {
      const replay = await second.client.request('persist', 'provider/replay', { token: 'redacted' }, { requestId: 'durable-A' });
      assert.equal(replay.payload.durableReplay, true);
      assert.equal(replay.generation, 2);
      assert.equal(second.client.snapshot().generation, 3);
      assert.equal(second.client.snapshot().durableReplayCount, 1);
      assert.equal(x.vaultHost.snapshotMetadata().generation, 3);
      assert.equal(x.vault.refs().length, 1);
    } finally { second.close(); }

    const conflictChannel = channel(x.vaultHost, 3);
    try {
      await assert.rejects(
        conflictChannel.client.request('persist', 'provider/replay', { token: 'different' }, { requestId: 'durable-A' }),
        error => error.reasonCode === 'CREDENTIAL_CUSTODY_REQUEST_ID_CONFLICT'
      );
      assert.equal(x.vaultHost.snapshotMetadata().generation, 3);
      assert.equal(x.vault.refs().length, 1);
    } finally { conflictChannel.close(); }
  } finally { first.close(); x.close(); }
});

test('COMMITTED request with lost ACK is recovered by a new backend using durable QUERY', async () => {
  const x = await setup();
  let dropCommit = true;
  let dropQuery = true;
  const first = channel(x.vaultHost, 1, { shouldDropAck: request => {
    if (request.action === 'COMMIT' && dropCommit) { dropCommit = false; return true; }
    if (request.action === 'QUERY' && dropQuery) { dropQuery = false; return true; }
    return false;
  } });
  try {
    await assert.rejects(
      first.client.request('persist', 'provider/lost-commit', { token: 'redacted' }, { requestId: 'durable-ack-lost' }),
      error => error.reasonCode === 'CREDENTIAL_COMMIT_RESULT_INDETERMINATE'
    );
    assert.equal(first.client.snapshot().terminal, true);
    assert.equal(first.indeterminate, 1);
    assert.equal(x.vaultHost.snapshotMetadata().generation, 2);
    assert.equal(x.vault.refs().length, 1);
    first.close();

    await x.vaultHost.createHydrationFrame({ startupNonce: 'n3', oneTimeToken: 'z'.repeat(43), backendPid: process.pid, manifestSha256: 'd'.repeat(64) });
    const second = channel(x.vaultHost, 3);
    try {
      const query = await second.client.query('durable-ack-lost', 'persist', 'provider/lost-commit', { token: 'redacted' }, 3);
      assert.equal(query.payload.transactionState, 'COMMITTED');
      assert.equal(query.payload.persisted, true);
      assert.equal(query.payload.durableReplay, true);
      assert.equal(second.client.snapshot().generation, 3);
      const replay = await second.client.request('persist', 'provider/lost-commit', { token: 'redacted' }, { requestId: 'durable-ack-lost' });
      assert.equal(replay.payload.durableReplay, true);
      assert.equal(x.vaultHost.snapshotMetadata().generation, 3);
    } finally { second.close(); }
  } finally { first.close(); x.close(); }
});

test('historical ROLLED_BACK request replays as a definite failure and does not block the next request', async () => {
  const x = await setup();
  try {
    const req = rawRequest('PREPARE', 'durable-rolledback', 'provider/rolledback', { token: 'redacted' }, 1);
    await x.vaultHost.prepareCustodyTransaction(req);
    await x.vaultHost.abortCustodyTransaction({ ...req, action: 'ABORT' });
    await x.vaultHost.createHydrationFrame({ startupNonce: 'n4', oneTimeToken: 'q'.repeat(43), backendPid: process.pid, manifestSha256: 'd'.repeat(64) });
    const restarted = channel(x.vaultHost, 2);
    try {
      await assert.rejects(
        restarted.client.request('persist', 'provider/rolledback', { token: 'redacted' }, { requestId: 'durable-rolledback' }),
        error => error.reasonCode === 'CREDENTIAL_TRANSACTION_ABORTED' && error.transactionState === 'ROLLED_BACK'
      );
      assert.equal(restarted.client.snapshot().generation, 2);
      const next = await restarted.client.request('persist', 'provider/next', { token: 'next' }, { requestId: 'after-rolledback' });
      assert.equal(next.generation, 3);
    } finally { restarted.close(); }
  } finally { x.close(); }
});

test('historical FAILED request remains a durable definite failure after later generations and restart', async () => {
  const x = await setup();
  try {
    const failedReq = rawRequest('PREPARE', 'durable-failed', 'provider/failed', { token: 'redacted' }, 1);
    await x.vaultHost.prepareCustodyTransaction(failedReq);
    const originalFs = x.vault.fs;
    x.vault.fs = new Proxy(originalFs, {
      get(target, property) {
        if (property === 'promises') return new Proxy(originalFs.promises, { get(p, method) { if (method === 'rename') return () => { const error = new Error('simulated vault rename failure'); error.code = 'EACCES'; return Promise.reject(error); }; const v = p[method]; return typeof v === 'function' ? v.bind(p) : v; } });
        const value = target[property];
        return typeof value === 'function' ? value.bind(target) : value;
      }
    });
    await assert.rejects(
      x.vaultHost.commitCustodyTransaction({ ...failedReq, action: 'COMMIT' }),
      error => error.reasonCode === 'EACCES' && error.transactionState === 'FAILED'
    );
    x.vault.fs = originalFs;
    assert.equal(x.vaultHost.transactions['durable-failed'].state, 'FAILED');
    await x.vaultHost.executeCustodyTransaction('persist', 'provider/later-1', { token: 'one' }, { requestId: 'later-1', source: 'TEST' });
    await x.vaultHost.executeCustodyTransaction('persist', 'provider/later-2', { token: 'two' }, { requestId: 'later-2', source: 'TEST' });
    assert.equal(x.vaultHost.snapshotMetadata().generation, 3);

    const reloadedVault = new CredentialVault(x.paths.vault, { safeStorage: storage() });
    const reloadedHost = new CredentialVaultHost({ vault: reloadedVault, metadataPath: x.paths.metadata, transactionPath: x.paths.journal, randomUUID: () => 'durable-epoch' });
    await reloadedHost.createHydrationFrame({ startupNonce: 'n5', oneTimeToken: 'r'.repeat(43), backendPid: process.pid, manifestSha256: 'd'.repeat(64) });
    const restarted = channel(reloadedHost, 4);
    try {
      await assert.rejects(
        restarted.client.request('persist', 'provider/failed', { token: 'redacted' }, { requestId: 'durable-failed' }),
        error => error.reasonCode === 'EACCES' && error.transactionState === 'FAILED'
      );
      assert.equal(restarted.client.snapshot().generation, 4);
      assert.equal(reloadedHost.snapshotMetadata().generation, 4);
      assert.equal(reloadedVault.refs().length, 2);
    } finally { restarted.close(); }
  } finally { x.close(); }
});
