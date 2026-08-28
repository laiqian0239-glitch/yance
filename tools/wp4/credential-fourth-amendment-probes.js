'use strict';

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

function safeStorage() {
  const key = crypto.createHash('sha256').update('wp4-fourth-amendment-evidence').digest();
  return {
    isEncryptionAvailable: () => true,
    encryptString(value) {
      const iv = Buffer.alloc(12, 5);
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
  let electron;
  let backend;
  electron = new Duplex({ read() {}, write(chunk, _encoding, callback) { backend.push(Buffer.from(chunk)); callback(); } });
  backend = new Duplex({ read() {}, write(chunk, _encoding, callback) { electron.push(Buffer.from(chunk)); callback(); } });
  return { electron, backend };
}

async function workspace(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const paths = { vault: path.join(root, 'vault.bin'), metadata: path.join(root, 'meta.json'), journal: path.join(root, 'journal.json') };
  const vault = new CredentialVault(paths.vault, { safeStorage: safeStorage() });
  const vaultHost = new CredentialVaultHost({ vault, metadataPath: paths.metadata, transactionPath: paths.journal, randomUUID: () => 'fourth-evidence-epoch' });
  await vaultHost.createHydrationFrame({ startupNonce: 'n', oneTimeToken: 'x'.repeat(43), backendPid: process.pid, manifestSha256: '4'.repeat(64) });
  return { root, paths, vault, vaultHost, close() { fs.rmSync(root, { recursive: true, force: true }); } };
}

function channel(vaultHost, generation, options = {}) {
  const streams = pair();
  let indeterminateCount = 0;
  const host = new CredentialCustodyHost({
    stream: streams.electron,
    vaultHost,
    context: { backendPid: process.pid, manifestSha256: '4'.repeat(64), vaultEpoch: 'fourth-evidence-epoch', generation },
    shouldDropAck: options.shouldDropAck || (() => false)
  });
  const client = new CredentialCustodyClient({
    stream: streams.backend,
    timeoutMs: 35,
    generation,
    context: { backendPid: process.pid, manifestSha256: '4'.repeat(64), credentialVaultEpoch: 'fourth-evidence-epoch', credentialGeneration: generation },
    onIndeterminateCommit: () => { indeterminateCount += 1; }
  });
  return { host, client, get indeterminateCount() { return indeterminateCount; }, close() { client.close(); host.close(); } };
}

function request(action, requestId, ref, generation = 1) {
  return makeCustodyRequest({ action, requestId, operation: 'persist', ref, value: { redacted: true }, backendPid: process.pid, manifestSha256: '4'.repeat(64), vaultEpoch: 'fourth-evidence-epoch', generation });
}

function record(probe, values) {
  return { probe, secretValueRecorded: false, secretHashRecorded: false, ...values };
}

async function prepareAckLostRecovery() {
  const x = await workspace('wp4-prepare-ack-evidence-');
  let dropped = false;
  const c = channel(x.vaultHost, 1, { shouldDropAck: req => req.action === 'PREPARE' && !dropped ? (dropped = true) : false });
  let reasonCode = '';
  let recovered = false;
  try {
    await c.client.request('persist', 'probe/prepare-ack-lost', { redacted: true }, { requestId: 'prepareAckLostRecovery' });
  } catch (error) {
    reasonCode = error.reasonCode || '';
    recovered = error.recovered === true;
  }
  const query = await c.client.query('prepareAckLostRecovery', 'persist', 'probe/prepare-ack-lost', { redacted: true }, 1);
  const next = await c.client.request('persist', 'probe/prepare-next', { redacted: true }, { requestId: 'prepareAckLostRecovery-next' });
  const snapshot = x.vaultHost.snapshotMetadata();
  const pass = recovered && query.payload.transactionState === 'ROLLED_BACK' && query.payload.persisted === false && snapshot.activeTransactionId === '' && next.payload.transactionState === 'COMMITTED' && c.client.snapshot().terminal === false;
  const value = record('prepareAckLostRecovery', {
    status: pass ? 'PASS' : 'FAIL', requestId: 'prepareAckLostRecovery', initialTransactionState: 'PREPARED', finalTransactionState: query.payload.transactionState,
    reasonCode, electronVaultGeneration: snapshot.generation, backendGeneration: c.client.snapshot().generation, actualReferenceCount: x.vault.refs().length,
    queryPersisted: query.payload.persisted, activeTransactionId: snapshot.activeTransactionId, backendContinuedRunning: !c.client.snapshot().terminal, nextCredentialRequestSucceeded: next.payload.transactionState === 'COMMITTED'
  });
  c.close(); x.close(); return value;
}

async function prepareResultUnknownShutdown() {
  const x = await workspace('wp4-prepare-shutdown-evidence-');
  const c = channel(x.vaultHost, 1, { shouldDropAck: req => req.action === 'PREPARE' || req.action === 'QUERY' });
  let reasonCode = '';
  try { await c.client.request('persist', 'probe/prepare-unknown', { redacted: true }, { requestId: 'prepareResultUnknownShutdown' }); }
  catch (error) { reasonCode = error.reasonCode || ''; }
  const beforeRestart = x.vaultHost.snapshotMetadata();
  c.host.close();
  const reloadedVault = new CredentialVault(x.paths.vault, { safeStorage: safeStorage() });
  const restarted = new CredentialVaultHost({ vault: reloadedVault, metadataPath: x.paths.metadata, transactionPath: x.paths.journal, randomUUID: () => 'fourth-evidence-epoch' });
  const req = request('QUERY', 'prepareResultUnknownShutdown', 'probe/prepare-unknown', 1);
  const query = await restarted.queryCustodyTransaction(req);
  const afterRestart = restarted.snapshotMetadata();
  const pass = reasonCode === 'WP4_CREDENTIAL_PREPARE_RESULT_INDETERMINATE' && c.client.snapshot().terminal && c.indeterminateCount === 1 && query.transactionState === 'ROLLED_BACK' && query.persisted === false && afterRestart.activeTransactionId === '';
  const value = record('prepareResultUnknownShutdown', {
    status: pass ? 'PASS' : 'FAIL', requestId: 'prepareResultUnknownShutdown', initialTransactionState: 'PREPARED', finalTransactionState: query.transactionState,
    reasonCode, electronVaultGeneration: afterRestart.generation, backendGeneration: c.client.snapshot().generation, actualReferenceCount: reloadedVault.refs().length,
    queryPersisted: query.persisted, activeTransactionIdBeforeRestart: beforeRestart.activeTransactionId, activeTransactionId: afterRestart.activeTransactionId,
    backendContinuedRunning: !c.client.snapshot().terminal, onIndeterminateCommitCount: c.indeterminateCount
  });
  c.close(); x.close(); return value;
}

async function abortJournalWriteFailureRecovery() {
  const x = await workspace('wp4-abort-journal-evidence-');
  const req = request('PREPARE', 'abortJournalWriteFailureRecovery', 'probe/abort-journal');
  await x.vaultHost.prepareCustodyTransaction(req);
  await x.vaultHost.commitCustodyTransaction({ ...req, action: 'COMMIT' });
  const originalSave = x.vaultHost._saveJournal.bind(x.vaultHost);
  let injected = false;
  x.vaultHost._saveJournal = () => {
    if (!injected) { injected = true; const error = new Error('rename EIO'); error.code = 'EIO'; throw error; }
    return originalSave();
  };
  let reasonCode = '';
  try { await x.vaultHost.abortCustodyTransaction({ ...req, action: 'ABORT' }); }
  catch (error) { reasonCode = error.reasonCode || ''; }
  let liveQueryRejected = false;
  try { await x.vaultHost.queryCustodyTransaction({ ...req, action: 'QUERY' }); }
  catch (_) { liveQueryRejected = true; }
  const reloadedVault = new CredentialVault(x.paths.vault, { safeStorage: safeStorage() });
  const restarted = new CredentialVaultHost({ vault: reloadedVault, metadataPath: x.paths.metadata, transactionPath: x.paths.journal, randomUUID: () => 'fourth-evidence-epoch' });
  const query = await restarted.queryCustodyTransaction({ ...req, action: 'QUERY' });
  const snapshot = restarted.snapshotMetadata();
  const pass = reasonCode === 'WP4_CREDENTIAL_TERMINAL_JOURNAL_MISMATCH' && liveQueryRejected && query.transactionState === 'COMMITTED' && query.persisted === true && reloadedVault.refs().length === 1 && snapshot.activeTransactionId === '';
  const value = record('abortJournalWriteFailureRecovery', {
    status: pass ? 'PASS' : 'FAIL', requestId: req.requestId, initialTransactionState: 'COMMITTED', finalTransactionState: query.transactionState,
    reasonCode, electronVaultGeneration: snapshot.generation, backendGeneration: snapshot.generation, actualReferenceCount: reloadedVault.refs().length,
    queryPersisted: query.persisted, activeTransactionId: snapshot.activeTransactionId, backendContinuedRunning: false, liveHostRejectedQuery: liveQueryRejected
  });
  x.close(); return value;
}

async function terminalMismatchProbe(name, terminalState) {
  const x = await workspace(`wp4-${name}-`);
  const req = request('PREPARE', name, `probe/${name}`);
  await x.vaultHost.prepareCustodyTransaction(req);
  if (terminalState === 'COMMITTED') await x.vaultHost.commitCustodyTransaction({ ...req, action: 'COMMIT' });
  else await x.vaultHost.abortCustodyTransaction({ ...req, action: 'ABORT' });
  fs.writeFileSync(x.paths.vault, `${JSON.stringify({ unrelated: { version: 1, encrypted: Buffer.from('corrupted').toString('base64') } }, null, 2)}\n`, 'utf8');
  const reloadedVault = new CredentialVault(x.paths.vault, { safeStorage: safeStorage() });
  let reasonCode = '';
  try { new CredentialVaultHost({ vault: reloadedVault, metadataPath: x.paths.metadata, transactionPath: x.paths.journal, randomUUID: () => 'fourth-evidence-epoch' }); }
  catch (error) { reasonCode = error.reasonCode || ''; }
  const pass = reasonCode === 'WP4_CREDENTIAL_AUTHORITY_HISTORY_MISMATCH';
  const value = record(name, {
    status: pass ? 'PASS' : 'FAIL', requestId: req.requestId, initialTransactionState: terminalState, finalTransactionState: 'FAIL_CLOSED',
    reasonCode, electronVaultGeneration: x.vaultHost.snapshotMetadata().generation, backendGeneration: 0, actualReferenceCount: reloadedVault.refs().length,
    queryPersisted: false, activeTransactionId: '', backendContinuedRunning: false
  });
  x.close(); return value;
}

async function requestIdReplayAfterBackendRestart() {
  const x = await workspace('wp4-durable-replay-evidence-');
  const first = channel(x.vaultHost, 1);
  const original = await first.client.request('persist', 'probe/durable-replay', { redacted: true }, { requestId: 'requestIdReplayAfterBackendRestart' });
  first.close();
  await x.vaultHost.createHydrationFrame({ startupNonce: 'n2', oneTimeToken: 'y'.repeat(43), backendPid: process.pid, manifestSha256: '4'.repeat(64) });
  const second = channel(x.vaultHost, 3);
  const replay = await second.client.request('persist', 'probe/durable-replay', { redacted: true }, { requestId: 'requestIdReplayAfterBackendRestart' });
  const query = await second.client.query('requestIdReplayAfterBackendRestart', 'persist', 'probe/durable-replay', { redacted: true }, 3);
  let conflictReasonCode = '';
  const third = channel(x.vaultHost, 3);
  try { await third.client.request('persist', 'probe/durable-replay', { redacted: false }, { requestId: 'requestIdReplayAfterBackendRestart' }); }
  catch (error) { conflictReasonCode = error.reasonCode || ''; }
  const snapshot = x.vaultHost.snapshotMetadata();
  const pass = original.generation === 2 && replay.payload.durableReplay === true && replay.generation === 2 && second.client.snapshot().generation === 3 && snapshot.generation === 3 && query.payload.persisted === true && x.vault.refs().length === 1 && conflictReasonCode === 'CREDENTIAL_CUSTODY_REQUEST_ID_CONFLICT';
  const value = record('requestIdReplayAfterBackendRestart', {
    status: pass ? 'PASS' : 'FAIL', requestId: 'requestIdReplayAfterBackendRestart', initialTransactionState: 'COMMITTED', finalTransactionState: replay.payload.transactionState,
    reasonCode: pass ? '' : 'WP4_CREDENTIAL_DURABLE_IDEMPOTENCY_FAILED', electronVaultGeneration: snapshot.generation, backendGeneration: second.client.snapshot().generation,
    originalResultGeneration: original.generation, replayResultGeneration: replay.generation, actualReferenceCount: x.vault.refs().length,
    queryPersisted: query.payload.persisted, activeTransactionId: snapshot.activeTransactionId, backendContinuedRunning: !second.client.snapshot().terminal,
    conflictingMutationReasonCode: conflictReasonCode
  });
  second.close(); third.close(); x.close(); return value;
}

async function runCredentialFourthAmendmentProbes() {
  const probes = {
    prepareAckLostRecovery: await prepareAckLostRecovery(),
    prepareResultUnknownShutdown: await prepareResultUnknownShutdown(),
    abortJournalWriteFailureRecovery: await abortJournalWriteFailureRecovery(),
    committedJournalVaultMismatchFailClosed: await terminalMismatchProbe('committedJournalVaultMismatchFailClosed', 'COMMITTED'),
    rolledBackJournalVaultMismatchFailClosed: await terminalMismatchProbe('rolledBackJournalVaultMismatchFailClosed', 'ROLLED_BACK'),
    requestIdReplayAfterBackendRestart: await requestIdReplayAfterBackendRestart()
  };
  const failed = Object.values(probes).filter(row => row.status !== 'PASS');
  if (failed.length) {
    const error = new Error('WP4 fourth amendment evidence probe failed');
    const names = failed.map(row => row.probe);
    error.reasonCode = names.some(name => /prepare/i.test(name)) ? 'WP4_CREDENTIAL_PREPARED_TRANSACTION_STUCK'
      : names.some(name => /Journal/i.test(name)) ? 'WP4_CREDENTIAL_TERMINAL_JOURNAL_MISMATCH'
        : 'WP4_CREDENTIAL_DURABLE_IDEMPOTENCY_FAILED';
    error.probes = probes;
    throw error;
  }
  return { status: 'PASS', probeCount: Object.keys(probes).length, probes, secretValueRecorded: false, secretHashRecorded: false };
}

module.exports = { runCredentialFourthAmendmentProbes };
if (require.main === module) runCredentialFourthAmendmentProbes().then(value => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)).catch(error => { process.stderr.write(`${error.reasonCode || 'WP4_CREDENTIAL_DURABLE_IDEMPOTENCY_FAILED'} ${error.stack || error.message}\n`); if (error.probes) process.stderr.write(`${JSON.stringify(error.probes, null, 2)}\n`); process.exit(1); });
