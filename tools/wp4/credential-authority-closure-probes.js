#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { CredentialVault } = require('../../electron/credentialVault');
const { CredentialVaultHost } = require('../../electron/desktopHost/CredentialVaultHost');
const { makeCustodyRequest } = require('../../shared/credentialCustodyProtocol');
const { refreshJournalIntegrity } = require('../../electron/desktopHost/credentialAuthority');

function safeStorage(overrides = {}) {
  const key = crypto.createHash('sha256').update('wp4-authority-closure-probes').digest();
  return {
    isEncryptionAvailable: () => overrides.available !== false,
    encryptString(value) {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const body = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), body]);
    },
    decryptString(value) {
      if (overrides.decryptError) throw Object.assign(new Error('decrypt failure'), { code: 'EDECRYPT' });
      const bytes = Buffer.from(value);
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
      decipher.setAuthTag(bytes.subarray(12, 28));
      return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8');
    }
  };
}
function workspace(prefix = 'wp4-authority-closure-') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const paths = {
    vault: path.join(root, 'vault.bin'),
    metadata: path.join(root, 'vault-meta.json'),
    journal: path.join(root, 'credential-authority-journal.json')
  };
  const storage = safeStorage();
  const create = (options = {}) => {
    const vault = new CredentialVault(paths.vault, { safeStorage: options.safeStorage || storage });
    const host = new CredentialVaultHost({ vault, metadataPath: paths.metadata, transactionPath: paths.journal, randomUUID: crypto.randomUUID });
    return { vault, host };
  };
  const first = create();
  const hydration = first.host.createHydrationFrame({
    startupNonce: 'authority-closure-startup',
    backendSessionId: 'authority-closure-session',
    fd6PipeInstanceId: 'authority-closure-fd6',
    oneTimeToken: 'x'.repeat(43),
    backendPid: process.pid,
    manifestSha256: 'c'.repeat(64)
  });
  const frame = hydration.frame;
  const accepted = first.host.markHydrationAccepted({
    startupNonce: frame.startupNonce,
    authorityEventId: frame.authorityEventId,
    vaultEpoch: frame.vaultEpoch,
    generation: frame.generation,
    vaultReferenceCount: frame.vaultReferenceCount,
    decryptedEntryCount: frame.decryptedEntryCount,
    frameEntryCount: frame.frameEntryCount,
    restoredReferenceCount: frame.frameEntryCount,
    payloadBytes: frame.payloadBytes
  });
  if (!accepted) throw new Error('Authority closure fixture failed to accept FD5 hydration');
  return { root, paths, storage, ...first, ownerSession: hydration.ownerSession, create, close: () => fs.rmSync(root, { recursive: true, force: true }) };
}
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function writeJson(file, value) { fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8'); }
function request(host, action, requestId, operation = 'persist', ref = `probe/${requestId}`, value = { redacted: true }) {
  const metadata = host.snapshotMetadata();
  const owner = host.activeOwnerSession || host.pendingOwnerSession;
  if (!owner) throw new Error('Credential authority closure request requires an accepted FD5 owner session');
  return makeCustodyRequest({
    action, requestId, operation, ref, value,
    backendPid: owner.backendPid,
    startupNonce: owner.startupNonce,
    backendSessionId: owner.backendSessionId,
    fd6PipeInstanceId: owner.fd6PipeInstanceId,
    hydrationGeneration: owner.hydrationGeneration,
    manifestSha256: owner.manifestSha256,
    vaultEpoch: metadata.vaultEpoch,
    generation: metadata.generation
  });
}
function snapshot(root, vault, host, overrides = {}) {
  const metadata = fs.existsSync(path.join(root, 'vault-meta.json')) ? readJson(path.join(root, 'vault-meta.json')) : null;
  const journal = fs.existsSync(path.join(root, 'credential-authority-journal.json')) ? readJson(path.join(root, 'credential-authority-journal.json')) : null;
  let decryptedEntryCount = -1; let decryptReasonCode = '';
  try { decryptedEntryCount = vault.entriesStrict().length; } catch (error) { decryptReasonCode = error.reasonCode || error.code || ''; }
  return {
    vaultEpoch: metadata?.vaultEpoch || '',
    metadataGeneration: metadata?.generation ?? null,
    journalTransactionCount: journal?.transactionCount ?? null,
    latestTransactionGeneration: journal ? Math.max(-1, ...Object.values(journal.transactions || {}).map(row => Number(row.generation))) : null,
    latestTransactionState: journal ? (Object.values(journal.transactions || {}).sort((a, b) => String(a.updatedAtUtc).localeCompare(String(b.updatedAtUtc))).at(-1)?.state || 'NONE') : 'MISSING',
    vaultReferenceCount: vault.refs().length,
    decryptedEntryCount,
    frameEntryCount: overrides.frameEntryCount ?? null,
    restoredReferenceCount: overrides.restoredReferenceCount ?? null,
    backendFinalState: overrides.backendFinalState || 'NOT_STARTED_FAIL_CLOSED',
    activeTransactionId: host?.snapshotMetadata?.().activeTransactionId || '',
    decryptReasonCode,
    queryPersisted: overrides.queryPersisted ?? false,
    nextLegalRequestSucceeded: overrides.nextLegalRequestSucceeded ?? false,
    nextHydrationSucceeded: overrides.nextHydrationSucceeded ?? false
  };
}
function record(probe, status, reasonCode, state, extra = {}) {
  return { probe, status, reasonCode, ...state, ...extra, secretValueRecorded: false, secretHashRecorded: false };
}

async function terminalMetadataUnrelatedGeneration(terminalState) {
  const name = terminalState === 'COMMITTED' ? 'terminalMetadataUnrelatedGenerationCommitted' : 'terminalMetadataUnrelatedGenerationRolledBack';
  const x = workspace(`wp4-${name}-`);
  try {
    const req = request(x.host, 'PREPARE', name);
    await x.host.prepareCustodyTransaction(req);
    if (terminalState === 'COMMITTED') await x.host.commitCustodyTransaction({ ...req, action: 'COMMIT' });
    else await x.host.abortCustodyTransaction({ ...req, action: 'ABORT' });
    const metadata = readJson(x.paths.metadata); metadata.generation = 999; writeJson(x.paths.metadata, metadata);
    const reloadedVault = new CredentialVault(x.paths.vault, { safeStorage: x.storage });
    let reasonCode = ''; let restarted = null;
    try { restarted = new CredentialVaultHost({ vault: reloadedVault, metadataPath: x.paths.metadata, transactionPath: x.paths.journal }); }
    catch (error) { reasonCode = error.reasonCode || error.code || ''; }
    const state = snapshot(x.root, reloadedVault, restarted);
    const pass = reasonCode === 'WP4_CREDENTIAL_AUTHORITY_HISTORY_MISMATCH' && state.backendFinalState !== 'RUNNING';
    return record(name, pass ? 'PASS' : 'FAIL', reasonCode, state, { initialTransactionState: terminalState, finalTransactionState: 'FAIL_CLOSED' });
  } finally { x.close(); }
}

async function invalidTransactionState() {
  const x = workspace('wp4-invalid-transaction-state-');
  try {
    const req = request(x.host, 'PREPARE', 'invalidTransactionState');
    await x.host.prepareCustodyTransaction(req);
    const journal = readJson(x.paths.journal); journal.transactions[req.requestId].state = 'CORRUPTED'; journal.transactions[req.requestId].stateHistory.at(-1).state = 'CORRUPTED'; refreshJournalIntegrity(journal); writeJson(x.paths.journal, journal);
    const reloadedVault = new CredentialVault(x.paths.vault, { safeStorage: x.storage });
    let reasonCode = '';
    try { new CredentialVaultHost({ vault: reloadedVault, metadataPath: x.paths.metadata, transactionPath: x.paths.journal }); }
    catch (error) { reasonCode = error.reasonCode || error.code || ''; }
    const state = snapshot(x.root, reloadedVault, null);
    return record('invalidTransactionState', reasonCode === 'WP4_CREDENTIAL_TRANSACTION_JOURNAL_INVALID' ? 'PASS' : 'FAIL', reasonCode, state, { finalTransactionState: 'FAIL_CLOSED' });
  } finally { x.close(); }
}

async function missingDurableJournal() {
  const x = workspace('wp4-missing-durable-journal-');
  try {
    await x.host.persistFromDesktop('probe/missing-journal', { redacted: true });
    fs.rmSync(x.paths.journal, { force: true });
    const reloadedVault = new CredentialVault(x.paths.vault, { safeStorage: x.storage });
    let reasonCode = '';
    try { new CredentialVaultHost({ vault: reloadedVault, metadataPath: x.paths.metadata, transactionPath: x.paths.journal }); }
    catch (error) { reasonCode = error.reasonCode || error.code || ''; }
    const state = snapshot(x.root, reloadedVault, null);
    return record('missingDurableJournal', reasonCode === 'WP4_CREDENTIAL_TRANSACTION_JOURNAL_MISSING' ? 'PASS' : 'FAIL', reasonCode, state, { finalTransactionState: 'FAIL_CLOSED' });
  } finally { x.close(); }
}

async function truncatedDurableJournal() {
  const x = workspace('wp4-truncated-durable-journal-');
  try {
    const committed = await x.host.executeCustodyTransaction('persist', 'probe/truncated', { redacted: true }, { requestId: 'truncatedDurableJournal' });
    const journal = readJson(x.paths.journal); delete journal.transactions.truncatedDurableJournal; writeJson(x.paths.journal, journal);
    const reloadedVault = new CredentialVault(x.paths.vault, { safeStorage: x.storage });
    let reasonCode = '';
    try { new CredentialVaultHost({ vault: reloadedVault, metadataPath: x.paths.metadata, transactionPath: x.paths.journal }); }
    catch (error) { reasonCode = error.reasonCode || error.code || ''; }
    const state = snapshot(x.root, reloadedVault, null);
    const pass = reasonCode === 'WP4_CREDENTIAL_DURABLE_IDEMPOTENCY_HISTORY_LOST';
    return record('truncatedDurableJournal', pass ? 'PASS' : 'FAIL', reasonCode, state, { requestId: 'truncatedDurableJournal', originalResultGeneration: committed.generation, finalTransactionState: 'FAIL_CLOSED' });
  } finally { x.close(); }
}

async function requestIdReplayAfterJournalLoss() {
  const x = workspace('wp4-request-replay-journal-loss-');
  try {
    const requestId = 'requestIdReplayAfterJournalLoss';
    const original = await x.host.executeCustodyTransaction('persist', 'probe/replay-loss', { redacted: true }, { requestId });
    const beforeGeneration = x.host.snapshotMetadata().generation;
    fs.rmSync(x.paths.journal, { force: true });
    const reloadedVault = new CredentialVault(x.paths.vault, { safeStorage: x.storage });
    let reasonCode = ''; let restarted = null;
    try { restarted = new CredentialVaultHost({ vault: reloadedVault, metadataPath: x.paths.metadata, transactionPath: x.paths.journal }); }
    catch (error) { reasonCode = error.reasonCode || error.code || ''; }
    let replayExecuted = false;
    if (restarted) {
      try { await restarted.executeCustodyTransaction('persist', 'probe/replay-loss', { redacted: true }, { requestId }); replayExecuted = true; } catch (_) {}
    }
    const state = snapshot(x.root, reloadedVault, restarted);
    const pass = reasonCode === 'WP4_CREDENTIAL_TRANSACTION_JOURNAL_MISSING' && !replayExecuted && state.metadataGeneration === beforeGeneration && reloadedVault.refs().length === 1;
    return record('requestIdReplayAfterJournalLoss', pass ? 'PASS' : 'FAIL', reasonCode, state, { requestId, originalResultGeneration: original.generation, replayExecuted, finalTransactionState: 'FAIL_CLOSED' });
  } finally { x.close(); }
}

async function credentialDecryptFailure(mode = 'ciphertext') {
  const name = mode === 'secureStorage' ? 'credentialSecureStorageUnavailable' : mode === 'throw' ? 'credentialDecryptStringFailure' : 'credentialCiphertextCorruption';
  const x = workspace(`wp4-${name}-`);
  try {
    await x.host.persistFromDesktop(`probe/${name}`, { redacted: true });
    const beforeGeneration = x.host.snapshotMetadata().generation;
    if (mode === 'ciphertext') {
      const raw = readJson(x.paths.vault); raw[`probe/${name}`].ciphertext = 'AAAA'; writeJson(x.paths.vault, raw);
    }
    const storage = mode === 'secureStorage' ? safeStorage({ available: false }) : mode === 'throw' ? safeStorage({ decryptError: true }) : x.storage;
    const reloadedVault = new CredentialVault(x.paths.vault, { safeStorage: storage });
    let restarted = null; let reasonCode = ''; let frameEntryCount = null;
    try { restarted = new CredentialVaultHost({ vault: reloadedVault, metadataPath: x.paths.metadata, transactionPath: x.paths.journal }); }
    catch (error) { reasonCode = error.reasonCode || error.code || ''; }
    if (restarted) {
      try { const prepared = restarted.createHydrationFrame({ startupNonce: name, oneTimeToken: 'x'.repeat(43), backendPid: process.pid, manifestSha256: 'c'.repeat(64) }); frameEntryCount = prepared.frame.frameEntryCount; }
      catch (error) { reasonCode = error.reasonCode || error.code || ''; }
    }
    const state = snapshot(x.root, reloadedVault, restarted, { frameEntryCount });
    const acceptedCodes = mode === 'ciphertext'
      ? new Set(['WP4_CREDENTIAL_AUTHORITY_HISTORY_MISMATCH', 'CREDENTIAL_VAULT_ENTRY_CORRUPTED', 'CREDENTIAL_VAULT_DECRYPT_FAILED'])
      : new Set(['CREDENTIAL_VAULT_DECRYPT_FAILED', 'CREDENTIAL_VAULT_SECURE_STORAGE_UNAVAILABLE']);
    const pass = acceptedCodes.has(reasonCode) && state.metadataGeneration === beforeGeneration && frameEntryCount === null && state.backendFinalState !== 'RUNNING';
    return record(name, pass ? 'PASS' : 'FAIL', reasonCode, state, { finalTransactionState: 'HYDRATION_REJECTED' });
  } finally { x.close(); }
}

async function credentialReferenceHydrationCountMismatch() {
  const x = workspace('wp4-hydration-count-mismatch-');
  try {
    await x.host.persistFromDesktop('probe/count-mismatch', { redacted: true });
    const beforeGeneration = x.host.snapshotMetadata().generation;
    await x.host.handleBackendOwnerExit(x.ownerSession);
    x.host.entriesStrict = () => [];
    let reasonCode = ''; let frameEntryCount = null;
    try { const prepared = x.host.createHydrationFrame({ startupNonce: 'count-mismatch', oneTimeToken: 'x'.repeat(43), backendPid: process.pid, manifestSha256: 'c'.repeat(64) }); frameEntryCount = prepared.frame.frameEntryCount; }
    catch (error) { reasonCode = error.reasonCode || error.code || ''; }
    const state = snapshot(x.root, x.vault, x.host, { frameEntryCount });
    const pass = reasonCode === 'WP4_CREDENTIAL_HYDRATION_REFERENCE_MISMATCH' && state.metadataGeneration === beforeGeneration && frameEntryCount === null;
    return record('credentialReferenceHydrationCountMismatch', pass ? 'PASS' : 'FAIL', reasonCode, state, { finalTransactionState: 'HYDRATION_REJECTED' });
  } finally { x.close(); }
}

async function runCredentialAuthorityClosureProbes() {
  const rows = [
    await terminalMetadataUnrelatedGeneration('COMMITTED'),
    await terminalMetadataUnrelatedGeneration('ROLLED_BACK'),
    await invalidTransactionState(),
    await missingDurableJournal(),
    await truncatedDurableJournal(),
    await requestIdReplayAfterJournalLoss(),
    await credentialDecryptFailure('ciphertext'),
    await credentialDecryptFailure('throw'),
    await credentialDecryptFailure('secureStorage'),
    await credentialReferenceHydrationCountMismatch()
  ];
  const probes = Object.fromEntries(rows.map(row => [row.probe, row]));
  const failed = rows.filter(row => row.status !== 'PASS');
  if (failed.length) {
    const error = new Error('Credential authority closure probes failed');
    error.reasonCode = failed.some(row => /Decrypt|Storage|Hydration/.test(row.probe)) ? 'WP4_CREDENTIAL_HYDRATION_REFERENCE_MISMATCH'
      : failed.some(row => /Journal|journal/.test(row.probe)) ? 'WP4_CREDENTIAL_DURABLE_IDEMPOTENCY_HISTORY_LOST'
        : 'WP4_CREDENTIAL_AUTHORITY_HISTORY_MISMATCH';
    error.probes = probes;
    throw error;
  }
  return { status: 'PASS', probeCount: rows.length, probes, secretValueRecorded: false, secretHashRecorded: false };
}

module.exports = { runCredentialAuthorityClosureProbes };
if (require.main === module) runCredentialAuthorityClosureProbes().then(value => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)).catch(error => { process.stderr.write(`${error.reasonCode || 'WP4_CREDENTIAL_AUTHORITY_HISTORY_MISMATCH'} ${error.stack || error.message}\n`); if (error.probes) process.stderr.write(`${JSON.stringify(error.probes, null, 2)}\n`); process.exit(1); });
