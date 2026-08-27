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

function safeStorage() {
  const key = crypto.createHash('sha256').update('wp4-indeterminate-evidence').digest();
  return { isEncryptionAvailable: () => true, encryptString(value) { const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv('aes-256-gcm', key, iv); const body = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), body]); }, decryptString(value) { const bytes = Buffer.from(value); const decipher = crypto.createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12)); decipher.setAuthTag(bytes.subarray(12, 28)); return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8'); } };
}
function pair(options = {}) { let a; let b; let clientWrites = 0; a = new Duplex({ read() {}, write(c, _e, cb) { b.push(Buffer.from(c)); cb(); } }); b = new Duplex({ read() {}, write(c, _e, cb) { clientWrites += 1; a.push(Buffer.from(c)); if (options.commitWriteCallbackError && clientWrites === 2) { const error = new Error('write callback failed'); error.code = 'EPIPE'; cb(error); } else cb(); } }); return { a, b }; }
function record(probe, values) { return { probe, secretValueRecorded: false, secretHashRecorded: false, ...values }; }

async function runMode(mode) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `wp4-indeterminate-${mode}-`));
  let custodyHost; let client;
  try {
    const vault = new CredentialVault(path.join(root, 'vault.json'), { safeStorage: safeStorage() });
    const vaultHost = new CredentialVaultHost({ vault, metadataPath: path.join(root, 'vault-meta.json'), transactionPath: path.join(root, 'transactions.json'), randomUUID: () => 'indeterminate-evidence-epoch' });
    const frame = (await vaultHost.createHydrationFrame({ startupNonce: 'n', oneTimeToken: 'x'.repeat(43), backendPid: process.pid, manifestSha256: 'f'.repeat(64) })).frame;
    const streams = pair({ commitWriteCallbackError: mode === 'write-callback-error' });
    let callbacks = 0;
    const shouldDropAck = request => (mode === 'no-ack' && (request.action === 'COMMIT' || request.action === 'QUERY')) || (['pipe-end', 'pipe-error', 'partial-ack'].includes(mode) && request.action === 'COMMIT');
    custodyHost = new CredentialCustodyHost({ stream: streams.a, vaultHost, context: { backendPid: process.pid, manifestSha256: 'f'.repeat(64), vaultEpoch: frame.vaultEpoch, generation: frame.generation }, shouldDropAck, afterTransaction: request => { if (request.action !== 'COMMIT') return; if (mode === 'pipe-end') streams.b.push(null); if (mode === 'pipe-error') { const error = new Error('pipe error'); error.code = 'EPIPE'; streams.b.emit('error', error); } if (mode === 'partial-ack') { streams.b.push(Buffer.from('{"type":"credential_custody_ack"')); streams.b.push(null); } } });
    client = new CredentialCustodyClient({ stream: streams.b, timeoutMs: 35, generation: frame.generation, context: { backendPid: process.pid, manifestSha256: 'f'.repeat(64), credentialVaultEpoch: frame.vaultEpoch, credentialGeneration: frame.generation }, onIndeterminateCommit: () => { callbacks += 1; } });
    let reasonCode = '';
    try { await client.request('persist', `probe/${mode}`, { redacted: true }, { requestId: `indeterminate-${mode}`, prepareAuthority: async m => m, commitAuthority: async () => {}, rollbackAuthority: async () => {} }); } catch (error) { reasonCode = error.reasonCode; }
    await new Promise(resolve => setImmediate(resolve));
    const beforeRestart = client.snapshot();
    const electronGeneration = vaultHost.snapshotMetadata().generation;
    client.close(); custodyHost.close();
    const restartFrame = (await vaultHost.createHydrationFrame({ startupNonce: `restart-${mode}`, oneTimeToken: 'y'.repeat(43), backendPid: process.pid, manifestSha256: 'f'.repeat(64) })).frame;
    const refPresent = restartFrame.payload.entries.some(row => row.ref === `probe/${mode}`);
    const pass = reasonCode === 'CREDENTIAL_COMMIT_RESULT_INDETERMINATE' && callbacks === 1 && electronGeneration === 2 && beforeRestart.generation === 1 && beforeRestart.terminal === true && beforeRestart.dedicatedPipeActive === false && refPresent && restartFrame.generation === 3;
    return record(mode, { status: pass ? 'PASS' : 'FAIL', reasonCode, onIndeterminateCommitCount: callbacks, electronVaultGeneration: electronGeneration, backendGeneration: beforeRestart.generation, backendContinuedRunning: false, terminal: beforeRestart.terminal, requestState: beforeRestart.requestStates[`indeterminate-${mode}`]?.state || '', nextFd5HydrationGeneration: restartFrame.generation, authorityReestablishedByFd5: refPresent });
  } finally { try { client?.close(); custodyHost?.close(); } catch (_) {} fs.rmSync(root, { recursive: true, force: true }); }
}

async function runCredentialIndeterminateProbes() {
  const probes = {};
  for (const mode of ['pipe-end', 'pipe-error', 'partial-ack', 'no-ack', 'write-callback-error']) probes[mode] = await runMode(mode);
  const failed = Object.values(probes).filter(row => row.status !== 'PASS');
  if (failed.length) { const error = new Error('Indeterminate credential commit remained running or split authority'); error.reasonCode = failed.some(row => row.backendContinuedRunning) ? 'WP4_CREDENTIAL_INDETERMINATE_COMMIT_RUNNING' : 'WP4_CREDENTIAL_STATE_AUTHORITY_SPLIT'; error.probes = probes; throw error; }
  return { status: 'PASS', probeCount: Object.keys(probes).length, probes, secretValueRecorded: false, secretHashRecorded: false };
}

module.exports = { runCredentialIndeterminateProbes };
