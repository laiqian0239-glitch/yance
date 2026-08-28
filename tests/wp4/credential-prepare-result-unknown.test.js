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

function storage() {
  const key = crypto.createHash('sha256').update('prepare-result-unknown').digest();
  return {
    isEncryptionAvailable: () => true,
    encryptString(value) {
      const iv = Buffer.alloc(12, 9);
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

function pair(options = {}) {
  let hostSide;
  let clientSide;
  let hostWrites = 0;
  hostSide = new Duplex({
    read() {},
    write(chunk, _encoding, callback) {
      hostWrites += 1;
      if (typeof options.hostWrite === 'function') return options.hostWrite({ chunk: Buffer.from(chunk), callback, hostWrites, hostSide, clientSide });
      clientSide.push(Buffer.from(chunk));
      callback();
    }
  });
  clientSide = new Duplex({
    read() {},
    write(chunk, _encoding, callback) {
      hostSide.push(Buffer.from(chunk));
      callback();
    }
  });
  return { hostSide, clientSide };
}

async function setup(options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wp4-prepare-unknown-'));
  const vaultPath = path.join(root, 'vault.bin');
  const metadataPath = path.join(root, 'meta.json');
  const transactionPath = path.join(root, 'journal.json');
  const vault = new CredentialVault(vaultPath, { safeStorage: storage() });
  const vaultHost = new CredentialVaultHost({ vault, metadataPath, transactionPath, randomUUID: () => 'prepare-epoch' });
  await vaultHost.createHydrationFrame({ startupNonce: 'n', oneTimeToken: 'x'.repeat(43), backendPid: process.pid, manifestSha256: 'a'.repeat(64) });
  const streams = pair(options.pairOptions);
  let indeterminateCount = 0;
  const host = new CredentialCustodyHost({
    stream: streams.hostSide,
    vaultHost,
    context: { backendPid: process.pid, manifestSha256: 'a'.repeat(64), vaultEpoch: 'prepare-epoch', generation: 1 },
    shouldDropAck: options.shouldDropAck || (() => false),
    afterTransaction: options.afterTransaction || (() => {})
  });
  const client = new CredentialCustodyClient({
    stream: streams.clientSide,
    timeoutMs: options.timeoutMs ?? 35,
    generation: 1,
    context: { backendPid: process.pid, manifestSha256: 'a'.repeat(64), credentialVaultEpoch: 'prepare-epoch', credentialGeneration: 1 },
    onIndeterminateCommit: () => { indeterminateCount += 1; }
  });
  return {
    root, vaultPath, metadataPath, transactionPath, vault, vaultHost, host, client, streams,
    get indeterminateCount() { return indeterminateCount; },
    close() { client.close(); host.close(); fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
  };
}

async function nextRequestSucceeds(x, id = 'prepare-next') {
  const ack = await x.client.request('persist', 'provider/next', { token: 'next' }, { requestId: id });
  assert.equal(ack.transactionState, 'COMMITTED');
  assert.equal(x.vaultHost.snapshotMetadata().generation, 2);
}

test('lost PREPARE ACK is automatically QUERYed and ABORTed so the next request succeeds', async () => {
  let dropped = false;
  // The recovery path performs two serialized host-side dispatches (QUERY then
  // ABORT), each of which now awaits real durable journal writes after the
  // async durability conversion. A timeout must therefore cover the full
  // QUERY+ABORT round-trip, not just a single PREPARE dispatch.
  const x = await setup({ timeoutMs: 500, shouldDropAck: request => request.action === 'PREPARE' && !dropped ? (dropped = true) : false });
  try {
    await assert.rejects(
      x.client.request('persist', 'provider/lost-prepare', { token: 'redacted' }, { requestId: 'prepare-ack-lost' }),
      error => error.reasonCode === 'CREDENTIAL_VAULT_ACK_TIMEOUT' && error.recovered === true && error.transactionState === 'ROLLED_BACK'
    );
    assert.equal(x.vaultHost.snapshotMetadata().activeTransactionId, '');
    const query = await x.client.query('prepare-ack-lost', 'persist', 'provider/lost-prepare', { token: 'redacted' }, 1);
    assert.equal(query.payload.transactionState, 'ROLLED_BACK');
    assert.equal(query.payload.persisted, false);
    await nextRequestSucceeds(x);
    assert.equal(x.indeterminateCount, 0);
  } finally { x.close(); }
});

test('PREPARE ACK callback EPIPE becomes indeterminate when QUERY cannot use the broken pipe', async () => {
  const x = await setup({ pairOptions: { hostWrite({ callback, hostWrites }) {
    if (hostWrites === 1) { const error = new Error('EPIPE'); error.code = 'EPIPE'; callback(error); return; }
    callback(Object.assign(new Error('EPIPE'), { code: 'EPIPE' }));
  } } });
  try {
    await assert.rejects(
      x.client.request('persist', 'provider/epipe', { token: 'redacted' }, { requestId: 'prepare-epipe' }),
      error => error.reasonCode === 'WP4_CREDENTIAL_PREPARE_RESULT_INDETERMINATE'
    );
    assert.equal(x.client.snapshot().terminal, true);
    assert.equal(x.indeterminateCount, 1);
  } finally { x.close(); }
});

test('partial PREPARE ACK followed by pipe close triggers one controlled shutdown and restart rolls back PREPARED', async () => {
  const x = await setup({ afterTransaction: async request => {
    if (request.action !== 'PREPARE') return;
    x.streams.clientSide.push(Buffer.from('{"type":"credential_custody_ack"'));
    x.streams.clientSide.push(null);
  }, shouldDropAck: request => request.action === 'PREPARE' });
  try {
    await assert.rejects(
      x.client.request('persist', 'provider/partial', { token: 'redacted' }, { requestId: 'prepare-partial' }),
      error => error.reasonCode === 'WP4_CREDENTIAL_PREPARE_RESULT_INDETERMINATE'
    );
    assert.equal(x.client.snapshot().terminal, true);
    assert.equal(x.indeterminateCount, 1);
    x.host.close();
    const reloadedVault = new CredentialVault(x.vaultPath, { safeStorage: storage() });
    const restarted = new CredentialVaultHost({ vault: reloadedVault, metadataPath: x.metadataPath, transactionPath: x.transactionPath, randomUUID: () => 'prepare-epoch' });
    await restarted.initialize();
    assert.equal(restarted.snapshotMetadata().activeTransactionId, '');
    assert.equal(restarted.transactions['prepare-partial'].state, 'ROLLED_BACK');
    assert.equal(reloadedVault.get('provider/partial'), null);
  } finally { x.close(); }
});

test('Electron exit after successful PREPARE forces controlled backend termination', async () => {
  const x = await setup({ afterTransaction: async request => {
    if (request.action === 'PREPARE') x.streams.clientSide.push(null);
  }, shouldDropAck: request => request.action === 'PREPARE' });
  try {
    await assert.rejects(x.client.request('persist', 'provider/exit', { token: 'redacted' }, { requestId: 'prepare-exit' }), error => error.reasonCode === 'WP4_CREDENTIAL_PREPARE_RESULT_INDETERMINATE');
    assert.equal(x.client.snapshot().terminal, true);
    assert.equal(x.client.snapshot().requestStates['prepare-exit'].state, 'PREPARE_RESULT_UNKNOWN');
    assert.equal(x.indeterminateCount, 1);
  } finally { x.close(); }
});

test('PREPARE QUERY failure triggers onIndeterminateCommit exactly once and terminates backend', async () => {
  const x = await setup({ shouldDropAck: request => request.action === 'PREPARE' || request.action === 'QUERY' });
  try {
    await assert.rejects(x.client.request('persist', 'provider/query-fail', { token: 'redacted' }, { requestId: 'prepare-query-fail' }), error => error.reasonCode === 'WP4_CREDENTIAL_PREPARE_RESULT_INDETERMINATE');
    assert.equal(x.client.snapshot().terminal, true);
    assert.equal(x.indeterminateCount, 1);
    await assert.rejects(x.client.request('persist', 'provider/blocked', { token: 'blocked' }), error => error.reasonCode === 'CREDENTIAL_COMMIT_RESULT_INDETERMINATE');
  } finally { x.close(); }
});
