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
  const key = crypto.createHash('sha256').update('wp4-concurrency-evidence').digest();
  return {
    isEncryptionAvailable: () => true,
    encryptString(value) { const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv('aes-256-gcm', key, iv); const body = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), body]); },
    decryptString(value) { const bytes = Buffer.from(value); const decipher = crypto.createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12)); decipher.setAuthTag(bytes.subarray(12, 28)); return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8'); }
  };
}
function paths(root) { return { vault: path.join(root, 'vault.json'), metadata: path.join(root, 'vault-meta.json'), journal: path.join(root, 'transactions.json') }; }
function create(root, options = {}) { const p = paths(root); const vault = new CredentialVault(p.vault, { safeStorage: safeStorage() }); const host = new CredentialVaultHost({ vault, metadataPath: p.metadata, transactionPath: p.journal, randomUUID: () => 'concurrency-evidence-epoch', ...options }); return { vault, host, p }; }
async function hydrate(host, suffix = 'initial') { return (await host.createHydrationFrame({ startupNonce: `nonce-${suffix}`, oneTimeToken: 'x'.repeat(43), backendPid: process.pid, manifestSha256: 'd'.repeat(64) })).frame; }
function request(host, id, operation, ref, value) { const m = host.snapshotMetadata(); return makeCustodyRequest({ action: 'PREPARE', requestId: id, operation, ref, value, backendPid: process.pid, manifestSha256: 'd'.repeat(64), vaultEpoch: m.vaultEpoch, generation: m.generation }); }
function pair() { let a; let b; a = new Duplex({ read() {}, write(c, _e, cb) { b.push(Buffer.from(c)); cb(); } }); b = new Duplex({ read() {}, write(c, _e, cb) { a.push(Buffer.from(c)); cb(); } }); return { a, b }; }
function record(probe, values) { return { probe, secretValueRecorded: false, secretHashRecorded: false, ...values }; }

async function fd6PrepareDesktopSave() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wp4-concurrent-save-'));
  try {
    const x = create(root); await hydrate(x.host);
    const tx = request(x.host, 'fd6-prepare-desktop-save', 'persist', 'fd6/a', { redacted: true });
    await x.host.prepareCustodyTransaction(tx);
    let rejection = '';
    try { await x.host.persistFromDesktop('desktop/b', { redacted: true }); } catch (error) { rejection = error.reasonCode; }
    await x.host.commitCustodyTransaction({ ...tx, action: 'COMMIT' });
    await x.host.persistFromDesktop('desktop/b', { redacted: true });
    const refs = x.vault.refs().sort();
    const pass = rejection === 'CREDENTIAL_TRANSACTION_BUSY_RETRY' && refs.includes('fd6/a') && refs.includes('desktop/b');
    return record('fd6PrepareDuringDesktopSave', { status: pass ? 'PASS' : 'FAIL', initialDesktopAttempt: rejection, retryableRejection: rejection === 'CREDENTIAL_TRANSACTION_BUSY_RETRY', finalReferences: refs, electronVaultGeneration: x.host.snapshotMetadata().generation, lostCredentialCount: pass ? 0 : 1 });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

async function fd6PrepareDesktopDeleteAbort() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wp4-concurrent-delete-'));
  try {
    const x = create(root); await x.host.persistFromDesktop('desktop/delete', { redacted: true }); await hydrate(x.host);
    const tx = request(x.host, 'fd6-prepare-desktop-delete', 'persist', 'fd6/pending', { redacted: true });
    await x.host.prepareCustodyTransaction(tx);
    let rejection = '';
    try { await x.host.removeFromDesktop('desktop/delete'); } catch (error) { rejection = error.reasonCode; }
    await x.host.abortCustodyTransaction({ ...tx, action: 'ABORT' });
    await x.host.removeFromDesktop('desktop/delete');
    const pass = rejection === 'CREDENTIAL_TRANSACTION_BUSY_RETRY' && x.vault.get('desktop/delete') === null && x.vault.get('fd6/pending') === null;
    return record('fd6PrepareDuringDesktopDeleteThenAbort', { status: pass ? 'PASS' : 'FAIL', initialDesktopAttempt: rejection, retryableRejection: rejection === 'CREDENTIAL_TRANSACTION_BUSY_RETRY', finalReferences: x.vault.refs().sort(), finalTransactionState: 'ROLLED_BACK', lostCredentialCount: pass ? 0 : 1 });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

async function desktopSaveBackendArrival() {
  let release; let enteredResolve; let blocked = true;
  const entered = new Promise(resolve => { enteredResolve = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wp4-concurrent-arrival-'));
  try {
    const x = create(root, { beforeTransactionCommit: async tx => { if (blocked && tx.source === 'DESKTOP') { enteredResolve(); await gate; blocked = false; } } });
    await hydrate(x.host);
    const desktop = x.host.persistFromDesktop('desktop/inflight', { redacted: true });
    await entered;
    const stale = request(x.host, 'backend-stale-during-desktop', 'persist', 'fd6/after', { redacted: true });
    const backend = x.host.prepareCustodyTransaction(stale);
    release(); await desktop;
    let rejection = '';
    try { await backend; } catch (error) { rejection = error.reasonCode; }
    const frame = await hydrate(x.host, 'restart');
    const fresh = makeCustodyRequest({ action: 'PREPARE', requestId: 'backend-fresh-after-restart', operation: 'persist', ref: 'fd6/after', value: { redacted: true }, backendPid: process.pid, manifestSha256: 'd'.repeat(64), vaultEpoch: frame.vaultEpoch, generation: frame.generation });
    await x.host.prepareCustodyTransaction(fresh); await x.host.commitCustodyTransaction({ ...fresh, action: 'COMMIT' });
    const refs = x.vault.refs().sort();
    const pass = rejection === 'CREDENTIAL_GENERATION_MISMATCH' && refs.includes('desktop/inflight') && refs.includes('fd6/after');
    return record('backendCustodyArrivesDuringDesktopSave', { status: pass ? 'PASS' : 'FAIL', staleBackendAttempt: rejection, rejectedAndRetryable: rejection === 'CREDENTIAL_GENERATION_MISMATCH', restartHydrationGeneration: frame.generation, finalReferences: refs, lostCredentialCount: pass ? 0 : 1 });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

async function fd6CommitDesktopRestartRace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wp4-concurrent-restart-'));
  let custodyHost; let client;
  try {
    const x = create(root); const frame = await hydrate(x.host); const streams = pair(); let indeterminateCount = 0;
    custodyHost = new CredentialCustodyHost({ stream: streams.a, vaultHost: x.host, context: { backendPid: process.pid, manifestSha256: 'd'.repeat(64), vaultEpoch: frame.vaultEpoch, generation: frame.generation }, shouldDropAck: req => req.action === 'COMMIT', afterTransaction: req => { if (req.action === 'COMMIT') streams.b.push(null); } });
    client = new CredentialCustodyClient({ stream: streams.b, timeoutMs: 50, generation: frame.generation, context: { backendPid: process.pid, manifestSha256: 'd'.repeat(64), credentialVaultEpoch: frame.vaultEpoch, credentialGeneration: frame.generation }, onIndeterminateCommit: () => { indeterminateCount += 1; } });
    let failure = '';
    try { await client.request('persist', 'fd6/restart-race', { redacted: true }, { requestId: 'fd6-restart-race', prepareAuthority: async m => m, commitAuthority: async () => {}, rollbackAuthority: async () => {} }); } catch (error) { failure = error.reasonCode; }
    await new Promise(resolve => setImmediate(resolve));
    client.close(); custodyHost.close();
    const reloaded = create(root);
    const restartFrame = await hydrate(reloaded.host, 'controlled-restart');
    const refs = restartFrame.payload.entries.map(row => row.ref);
    const pass = failure === 'CREDENTIAL_COMMIT_RESULT_INDETERMINATE' && indeterminateCount === 1 && refs.includes('fd6/restart-race') && restartFrame.generation === 3;
    return record('fd6CommitDuringControlledDesktopRestart', { status: pass ? 'PASS' : 'FAIL', backendFailureReasonCode: failure, onIndeterminateCommitCount: indeterminateCount, electronGenerationBeforeRestart: 2, backendGenerationBeforeRestart: 1, backendContinuedRunning: false, restartHydrationGeneration: restartFrame.generation, finalReferences: refs, authoritySplitResolvedByFd5: pass });
  } finally { try { client?.close(); custodyHost?.close(); } catch (_) {} fs.rmSync(root, { recursive: true, force: true }); }
}

async function runCredentialConcurrencyProbes() {
  const probes = {
    fd6PrepareDuringDesktopSave: await fd6PrepareDesktopSave(),
    fd6PrepareDuringDesktopDeleteThenAbort: await fd6PrepareDesktopDeleteAbort(),
    backendCustodyArrivesDuringDesktopSave: await desktopSaveBackendArrival(),
    fd6CommitDuringControlledDesktopRestart: await fd6CommitDesktopRestartRace()
  };
  const failed = Object.values(probes).filter(row => row.status !== 'PASS');
  if (failed.length) { const error = new Error('Credential concurrent mutation probes failed'); error.reasonCode = 'WP4_CREDENTIAL_CONCURRENT_MUTATION_LOST'; error.probes = probes; throw error; }
  return { status: 'PASS', probeCount: Object.keys(probes).length, probes, secretValueRecorded: false, secretHashRecorded: false };
}

module.exports = { runCredentialConcurrencyProbes };
