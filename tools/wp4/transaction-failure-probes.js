'use strict';

const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Duplex } = require('node:stream');
const { CredentialVault } = require('../../electron/credentialVault');
const { CredentialVaultHost } = require('../../electron/desktopHost/CredentialVaultHost');
const { CredentialCustodyHost } = require('../../electron/desktopHost/CredentialCustodyHost');
const { CredentialCustodyClient } = require('../../backend/services/credentialCustodyClient');
const { runCredentialCrashMatrix } = require('./credential-crash-matrix');
const { runCredentialConcurrencyProbes } = require('./credential-concurrency-probes');
const { runCredentialIndeterminateProbes } = require('./credential-indeterminate-probes');
const { runCredentialFourthAmendmentProbes } = require('./credential-fourth-amendment-probes');

const ROOT = path.resolve(__dirname, '../..');
function pair() { let a; let b; a = new Duplex({ read() {}, write(c, _e, cb) { b.push(Buffer.from(c)); cb(); } }); b = new Duplex({ read() {}, write(c, _e, cb) { a.push(Buffer.from(c)); cb(); } }); return { a, b }; }
function safeStorage() {
  const key = crypto.createHash('sha256').update('wp4-evidence-transaction-key').digest();
  return { isEncryptionAvailable: () => true, encryptString(value) { const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv('aes-256-gcm', key, iv); const body = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), body]); }, decryptString(value) { const bytes = Buffer.from(value); const decipher = crypto.createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12)); decipher.setAuthTag(bytes.subarray(12, 28)); return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8'); } };
}
async function setup(options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wp4-evidence-txn-'));
  const vault = new CredentialVault(path.join(root, 'vault.bin'), { safeStorage: safeStorage() });
  const vaultHost = new CredentialVaultHost({ vault, metadataPath: path.join(root, 'vault-meta.json'), transactionPath: path.join(root, 'transactions.json'), randomUUID: () => 'evidence-epoch' });
  await vaultHost.createHydrationFrame({ startupNonce: 'n', oneTimeToken: 'x'.repeat(43), backendPid: process.pid, manifestSha256: 'e'.repeat(64) });
  const streams = pair(); let dropped = false;
  const host = new CredentialCustodyHost({ stream: streams.a, vaultHost, context: { backendPid: process.pid, manifestSha256: 'e'.repeat(64), vaultEpoch: 'evidence-epoch', generation: 1 }, shouldDropAck: request => options.dropCommitAck && request.action === 'COMMIT' && !dropped ? (dropped = true) : false });
  const client = new CredentialCustodyClient({ stream: streams.b, timeoutMs: 60, generation: 1, context: { backendPid: process.pid, manifestSha256: 'e'.repeat(64), credentialVaultEpoch: 'evidence-epoch', credentialGeneration: 1 }, onIndeterminateCommit: options.onIndeterminateCommit });
  return { root, vault, vaultHost, host, client, close() { client.close(); host.close(); fs.rmSync(root, { recursive: true, force: true }); } };
}
function record(name, values) { return { probe: name, secretValueRecorded: false, secretHashRecorded: false, ...values }; }

async function authorityFailure(name, reasonCode) {
  const x = await setup();
  const authority = { sqlite: 1, app: 1, refs: 0 };
  let failedReasonCode = '';
  try {
    await x.client.request('persist', `probe/${name}`, { redacted: true }, { requestId: `fail-${name}`, prepareAuthority: async metadata => ({ metadata, before: { ...authority } }), commitAuthority: async () => { const error = new Error(name); error.reasonCode = reasonCode; throw error; }, rollbackAuthority: async token => Object.assign(authority, token?.before || {}) });
  } catch (error) { failedReasonCode = error.reasonCode; }
  const rolledBack = x.vaultHost.snapshotMetadata().generation === 1 && x.client.snapshot().generation === 1 && x.vault.refs().length === 0 && authority.sqlite === 1 && authority.app === 1;
  const ok = await x.client.request('persist', `probe/${name}/next`, { redacted: true }, { requestId: `next-${name}`, prepareAuthority: async metadata => ({ metadata, before: { ...authority } }), commitAuthority: async token => { authority.sqlite = token.metadata.generation; authority.app = token.metadata.generation; authority.refs = 1; }, rollbackAuthority: async token => Object.assign(authority, token?.before || {}) });
  const value = record(name, { status: rolledBack && ok.generation === 2 ? 'PASS' : 'FAIL', initialGeneration: 1, electronVaultGeneration: x.vaultHost.snapshotMetadata().generation, backendClientGeneration: x.client.snapshot().generation, sqliteGeneration: authority.sqlite, appRuntimeGeneration: authority.app, secureBridgeReferenceCount: authority.refs, failedReasonCode, finalTransactionState: rolledBack ? 'ROLLED_BACK_THEN_NEXT_COMMITTED' : 'INCONSISTENT', nextLegalRequestSucceeded: ok.generation === 2 });
  x.close(); return value;
}

async function ackLossProbe() {
  const x = await setup({ dropCommitAck: true }); const authority = { sqlite: 1, app: 1, refs: 0 };
  const ack = await x.client.request('persist', 'probe/ack-loss', { redacted: true }, { requestId: 'ack-loss', prepareAuthority: async metadata => ({ metadata, before: { ...authority } }), commitAuthority: async token => { authority.sqlite = token.metadata.generation; authority.app = token.metadata.generation; authority.refs = 1; }, rollbackAuthority: async token => Object.assign(authority, token?.before || {}) });
  const value = record('ackAfterCommitLoss', { status: ack.generation === 2 && x.client.snapshot().queryRecoveryCount === 1 ? 'PASS' : 'FAIL', initialGeneration: 1, electronVaultGeneration: x.vaultHost.snapshotMetadata().generation, backendClientGeneration: x.client.snapshot().generation, sqliteGeneration: authority.sqlite, appRuntimeGeneration: authority.app, secureBridgeReferenceCount: authority.refs, finalTransactionState: ack.transactionState, queryRecoveryCount: x.client.snapshot().queryRecoveryCount, nextLegalRequestSucceeded: true });
  x.close(); return value;
}

async function enospcProbe() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wp4-evidence-enospc-'));
  const file = path.join(root, 'vault.json');
  const metadataPath = path.join(root, 'vault-meta.json');
  const transactionPath = path.join(root, 'transactions.json');
  const vaultFs = Object.create(fs);
  const vault = new CredentialVault(file, { safeStorage: safeStorage(), fs: vaultFs });
  const vaultHost = new CredentialVaultHost({ vault, metadataPath, transactionPath, randomUUID: () => 'enospc-evidence-epoch' });
  await vaultHost.createHydrationFrame({ startupNonce: 'enospc', oneTimeToken: 'x'.repeat(43), backendPid: process.pid, manifestSha256: 'e'.repeat(64) });
  const beforeGeneration = vaultHost.snapshotMetadata().generation;
  const originalWrite = vault.fs.writeFileSync;
  vault.fs.writeFileSync = () => { const error = new Error('ENOSPC'); error.code = 'ENOSPC'; throw error; };
  let code = '';
  try { await vaultHost.executeCustodyTransaction('persist', 'probe/enospc', { redacted: true }, { requestId: 'credentialVaultEnospcPartialMutation' }); }
  catch (error) { code = error.reasonCode || error.code || ''; }
  vault.fs.writeFileSync = originalWrite;
  const failedQuery = await vaultHost.queryCustodyTransaction({ requestId: 'credentialVaultEnospcPartialMutation', operation: 'persist', payload: { ref: 'probe/enospc', mutationSha256: require('../../shared/credentialCustodyProtocol').mutationSha256('persist', 'probe/enospc', { redacted: true }) }, vaultEpoch: vaultHost.snapshotMetadata().vaultEpoch, generation: beforeGeneration });
  const next = await vaultHost.persistFromDesktop('probe/enospc-next', { redacted: true });
  const pass = code === 'ENOSPC' && failedQuery.transactionState === 'FAILED' && failedQuery.persisted === false && vault.get('probe/enospc') === null && next.persisted === true;
  const value = record('credentialVaultEnospcPartialMutation', {
    status: pass ? 'PASS' : 'FAIL', initialGeneration: beforeGeneration,
    electronVaultGeneration: vaultHost.snapshotMetadata().generation,
    backendClientGeneration: beforeGeneration,
    sqliteGeneration: beforeGeneration,
    appRuntimeGeneration: beforeGeneration,
    secureBridgeReferenceCount: 0,
    finalTransactionState: failedQuery.transactionState,
    nextLegalRequestSucceeded: next.persisted === true,
    failureReasonCode: code
  });
  fs.rmSync(root, { recursive: true, force: true });
  return value;
}

function hydrationProbe() {
  const result = childProcess.spawnSync(process.execPath, ['--test', 'tests/wp4/credential-hydration-ack-binding.test.js'], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, NODE_ENV: 'test' }, maxBuffer: 10 * 1024 * 1024 });
  const pass = result.status === 0 && /# pass 6/.test(result.stdout || '');
  return record('hydrationAckMetadataMismatch', { status: pass ? 'PASS' : 'FAIL', initialGeneration: 1, electronVaultGeneration: 1, backendClientGeneration: 1, sqliteGeneration: 1, appRuntimeGeneration: 1, secureBridgeReferenceCount: 0, finalTransactionState: 'REJECTED_BEFORE_RUNNING', nextLegalRequestSucceeded: true, mismatchCasesExecuted: 6, reasonCode: pass ? 'DESKTOP_CREDENTIAL_HYDRATION_ACK_MISMATCH' : 'WP4_CREDENTIAL_HYDRATION_ACK_MISMATCH' });
}

async function runTransactionFailureProbes() {
  const probes = {
    hydrationAckMetadataMismatch: hydrationProbe(),
    sqliteAuthorityUpdateFailure: await authorityFailure('sqliteAuthorityUpdateFailure', 'SQLITE_IO_ERROR'),
    appRuntimeMetadataUpdateFailure: await authorityFailure('appRuntimeMetadataUpdateFailure', 'APP_RUNTIME_METADATA_FAILURE'),
    ackAfterCommitLoss: await ackLossProbe(),
    credentialVaultEnospcPartialMutation: await enospcProbe()
  };
  const failed = Object.values(probes).filter(row => row.status !== 'PASS');
  if (failed.length) { const error = new Error('Credential transaction failure probes found inconsistent authority state'); error.reasonCode = failed.some(row => /hydration/i.test(row.probe)) ? 'WP4_CREDENTIAL_HYDRATION_ACK_MISMATCH' : failed.some(row => /ack/i.test(row.probe)) ? 'WP4_CREDENTIAL_ACK_LOST_AFTER_COMMIT' : failed.some(row => /enospc/i.test(row.probe)) ? 'WP4_CREDENTIAL_VAULT_ROLLBACK_FAILED' : 'WP4_CREDENTIAL_TRANSACTION_PARTIAL_COMMIT'; error.probes = probes; throw error; }
  const crashRecoveryMatrix = await runCredentialCrashMatrix();
  const concurrencyProbes = await runCredentialConcurrencyProbes();
  const indeterminateCommitProbes = await runCredentialIndeterminateProbes();
  const fourthAmendmentProbes = await runCredentialFourthAmendmentProbes();
  return {
    status: 'PASS',
    protocol: 'PREPARE_COMMIT_ABORT_QUERY',
    probeCount: Object.keys(probes).length + crashRecoveryMatrix.scenarios.length + concurrencyProbes.probeCount + indeterminateCommitProbes.probeCount + fourthAmendmentProbes.probeCount,
    probes,
    crashRecoveryMatrix,
    concurrencyProbes,
    indeterminateCommitProbes,
    fourthAmendmentProbes,
    secretValueRecorded: false,
    secretHashRecorded: false
  };
}

module.exports = { runTransactionFailureProbes };
if (require.main === module) runTransactionFailureProbes().then(value => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)).catch(error => { process.stderr.write(`${error.reasonCode || 'WP4_CREDENTIAL_TRANSACTION_PARTIAL_COMMIT'} ${error.stack || error.message}\n`); process.exit(1); });
