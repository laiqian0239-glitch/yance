'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { CredentialVault } = require('../../electron/credentialVault');
const {
  CredentialVaultHost,
  AUTHORITY_HISTORY_MISMATCH,
  DURABLE_HISTORY_LOST,
  JOURNAL_INVALID,
  JOURNAL_MISSING
} = require('../../electron/desktopHost/CredentialVaultHost');
const { refreshJournalIntegrity } = require('../../electron/desktopHost/credentialAuthority');
const { makeCustodyRequest } = require('../../shared/credentialCustodyProtocol');

function storage(options = {}) {
  return {
    isEncryptionAvailable: () => options.available !== false,
    encryptString: value => Buffer.from(value, 'utf8'),
    decryptString: value => Buffer.from(value).toString('utf8')
  };
}

function setup(prefix = 'wp4-authority-') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const paths = {
    vault: path.join(root, 'credential-vault.json'),
    metadata: path.join(root, 'vault-meta.json'),
    journal: path.join(root, 'credential-authority-journal.json')
  };
  const vault = new CredentialVault(paths.vault, { safeStorage: storage() });
  const host = new CredentialVaultHost({ vault, metadataPath: paths.metadata, transactionPath: paths.journal });
  return {
    root, paths, vault, host,
    read(name) { return JSON.parse(fs.readFileSync(paths[name], 'utf8')); },
    write(name, value) { fs.writeFileSync(paths[name], `${JSON.stringify(value, null, 2)}\n`); },
    reload(safeStorage = storage()) {
      const nextVault = new CredentialVault(paths.vault, { safeStorage });
      return new CredentialVaultHost({ vault: nextVault, metadataPath: paths.metadata, transactionPath: paths.journal });
    },
    close() { fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
  };
}

function request(host, requestId, value = { token: 'value' }) {
  const metadata = host.snapshotMetadata();
  return makeCustodyRequest({
    action: 'PREPARE', requestId, operation: 'persist', ref: `ref:${requestId}`, value,
    backendPid: process.pid, manifestSha256: 'a'.repeat(64),
    vaultEpoch: metadata.vaultEpoch, generation: Math.max(1, metadata.generation)
  });
}

async function commit(x, requestId) {
  // FD6 is only valid after an FD5 authority generation has been issued.
  if (x.host.snapshotMetadata().generation === 0) {
    x.host.createHydrationFrame({ startupNonce: `startup:${requestId}`, oneTimeToken: 'x'.repeat(43), backendPid: process.pid, manifestSha256: 'a'.repeat(64) });
  }
  const frame = request(x.host, requestId);
  await x.host.prepareCustodyTransaction(frame);
  return x.host.commitCustodyTransaction({ ...frame, action: 'COMMIT' });
}

test('latest COMMITTED transaction with unrelated metadata generation fails closed', async () => {
  const x = setup();
  try {
    await commit(x, 'metadata-committed');
    const metadata = x.read('metadata');
    metadata.generation = 999;
    x.write('metadata', metadata);
    assert.throws(() => x.reload(), error => error.reasonCode === AUTHORITY_HISTORY_MISMATCH);
  } finally { x.close(); }
});

test('latest ROLLED_BACK transaction with unrelated metadata generation fails closed', async () => {
  const x = setup();
  try {
    x.host.createHydrationFrame({ startupNonce: 'rollback-startup', oneTimeToken: 'x'.repeat(43), backendPid: process.pid, manifestSha256: 'a'.repeat(64) });
    const frame = request(x.host, 'metadata-rolled-back');
    await x.host.prepareCustodyTransaction(frame);
    await x.host.abortCustodyTransaction({ ...frame, action: 'ABORT' });
    const metadata = x.read('metadata');
    metadata.generation = 777;
    x.write('metadata', metadata);
    assert.throws(() => x.reload(), error => error.reasonCode === AUTHORITY_HISTORY_MISMATCH);
  } finally { x.close(); }
});

test('unknown transaction state is rejected instead of skipped', async () => {
  const x = setup();
  try {
    x.host.createHydrationFrame({ startupNonce: 'invalid-state-startup', oneTimeToken: 'x'.repeat(43), backendPid: process.pid, manifestSha256: 'a'.repeat(64) });
    const frame = request(x.host, 'invalid-state');
    await x.host.prepareCustodyTransaction(frame);
    const journal = x.read('journal');
    journal.transactions['invalid-state'].state = 'CORRUPTED';
    journal.transactions['invalid-state'].stateHistory.at(-1).state = 'CORRUPTED';
    refreshJournalIntegrity(journal);
    x.write('journal', journal);
    assert.throws(() => x.reload(), error => error.reasonCode === JOURNAL_INVALID);
  } finally { x.close(); }
});

test('journal key and requestId mismatch is rejected', async () => {
  const x = setup();
  try {
    await commit(x, 'journal-key');
    const journal = x.read('journal');
    journal.transactions['different-key'] = journal.transactions['journal-key'];
    delete journal.transactions['journal-key'];
    refreshJournalIntegrity(journal);
    x.write('journal', journal);
    assert.throws(() => x.reload(), error => error.reasonCode === JOURNAL_INVALID);
  } finally { x.close(); }
});

test('transaction generation discontinuity is rejected', async () => {
  const x = setup();
  try {
    await commit(x, 'generation-gap');
    const journal = x.read('journal');
    const tx = journal.transactions['generation-gap'];
    tx.generation = tx.previousGeneration + 2;
    refreshJournalIntegrity(journal);
    x.write('journal', journal);
    assert.throws(() => x.reload(), error => error.reasonCode === JOURNAL_INVALID);
  } finally { x.close(); }
});

test('nonzero authority generation with missing journal fails closed', async () => {
  const x = setup();
  try {
    await commit(x, 'missing-journal');
    fs.rmSync(x.paths.journal);
    assert.throws(() => x.reload(), error => error.reasonCode === JOURNAL_MISSING);
  } finally { x.close(); }
});

test('truncated durable journal transaction row is detected by sealed transaction history', async () => {
  const x = setup();
  try {
    await commit(x, 'truncated-row');
    const journal = x.read('journal');
    delete journal.transactions['truncated-row'];
    // Deliberately do not rewrite transactionCount/transactionsDigest.
    x.write('journal', journal);
    assert.throws(() => x.reload(), error => error.reasonCode === DURABLE_HISTORY_LOST);
  } finally { x.close(); }
});

test('journal loss prevents a repeated requestId from being executed as a new mutation', async () => {
  const x = setup();
  try {
    await commit(x, 'history-lost-replay');
    const generation = x.host.snapshotMetadata().generation;
    fs.rmSync(x.paths.journal);
    assert.throws(() => x.reload(), error => error.reasonCode === JOURNAL_MISSING);
    assert.equal(JSON.parse(fs.readFileSync(x.paths.metadata, 'utf8')).generation, generation);
  } finally { x.close(); }
});
