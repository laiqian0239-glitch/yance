'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Duplex } = require('node:stream');
const { CredentialVault } = require('../../electron/credentialVault');
const { CredentialVaultHost } = require('../../electron/desktopHost/CredentialVaultHost');
const { CredentialCustodyHost } = require('../../electron/desktopHost/CredentialCustodyHost');
const { mutationSha256 } = require('../../shared/credentialCustodyProtocol');
const secureBridge = require('../../backend/services/secureBridge');

function storage() {
  const key = crypto.createHash('sha256').update('secure-bridge-failure').digest();
  return {
    isEncryptionAvailable: () => true,
    encryptString(value) { const iv = Buffer.alloc(12, 7); const cipher = crypto.createCipheriv('aes-256-gcm', key, iv); const body = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), body]); },
    decryptString(value) { const bytes = Buffer.from(value); const decipher = crypto.createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12)); decipher.setAuthTag(bytes.subarray(12, 28)); return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8'); }
  };
}
function pair() { let a; let b; a = new Duplex({ read() {}, write(chunk, _encoding, callback) { b.push(Buffer.from(chunk)); callback(); } }); b = new Duplex({ read() {}, write(chunk, _encoding, callback) { a.push(Buffer.from(chunk)); callback(); } }); return { a, b }; }

async function runSecureBridgeFailureProbe() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wp4-secure-bridge-failure-'));
  let custodyHost;
  const originalApply = secureBridge._applyRuntimeCandidate;
  try {
    secureBridge.close(); secureBridge.runtime = new Map();
    const vault = new CredentialVault(path.join(root, 'vault.bin'), { safeStorage: storage() });
    const vaultHost = new CredentialVaultHost({ vault, metadataPath: path.join(root, 'meta.json'), transactionPath: path.join(root, 'journal.json'), randomUUID: () => 'secure-bridge-epoch' });
    await vaultHost.initialize();
    const frame = (await vaultHost.createHydrationFrame({ startupNonce: 'n', oneTimeToken: 'x'.repeat(43), backendPid: process.pid, manifestSha256: 'a'.repeat(64) })).frame;
    const streams = pair();
    custodyHost = new CredentialCustodyHost({ stream: streams.a, vaultHost, context: { backendPid: process.pid, manifestSha256: 'a'.repeat(64), vaultEpoch: frame.vaultEpoch, generation: frame.generation } });
    secureBridge.configureCustody({ backendPid: process.pid, manifestSha256: 'a'.repeat(64), credentialVaultEpoch: frame.vaultEpoch, credentialGeneration: frame.generation }, { stream: streams.b, timeoutMs: 100 });
    const authority = { sqlite: frame.generation, app: frame.generation, refs: 0 };
    secureBridge.bindCredentialAuthority({
      prepare: async metadata => ({ before: { ...authority }, metadata }),
      commit: async (_token, metadata) => { authority.sqlite = metadata.generation; authority.app = metadata.generation; authority.refs = metadata.entryCount; },
      rollback: async token => Object.assign(authority, token.before)
    });
    let injected = true; let failureReasonCode = '';
    secureBridge._applyRuntimeCandidate = function applyInjected(next) { if (injected) { injected = false; const error = new Error('secure bridge update failed'); error.reasonCode = 'SECURE_BRIDGE_UPDATE_FAILED'; throw error; } return originalApply.call(this, next); };
    try { await secureBridge.persist('probe/secure-bridge', { redacted: true }, { requestId: 'secure-bridge-failure' }); }
    catch (error) { failureReasonCode = error.reasonCode || error.code || ''; }
    const query = await vaultHost.queryCustodyTransaction({ requestId: 'secure-bridge-failure', operation: 'persist', payload: { ref: 'probe/secure-bridge', mutationSha256: mutationSha256('persist', 'probe/secure-bridge', { redacted: true }) }, vaultEpoch: frame.vaultEpoch, generation: frame.generation });
    const rolledBack = failureReasonCode === 'SECURE_BRIDGE_UPDATE_FAILED' && vaultHost.snapshotMetadata().generation === frame.generation && vault.get('probe/secure-bridge') === null && authority.sqlite === frame.generation && authority.app === frame.generation && authority.refs === 0 && secureBridge.listRefs().length === 0 && query.transactionState === 'ROLLED_BACK' && query.persisted === false;
    let nextSucceeded = false;
    if (rolledBack) { await secureBridge.persist('probe/secure-bridge-next', { redacted: true }, { requestId: 'secure-bridge-next' }); nextSucceeded = vaultHost.snapshotMetadata().generation === frame.generation + 1 && secureBridge.listRefs().length === 1; }
    return {
      probe: 'secureBridgeAuthorityUpdateFailure', status: rolledBack && nextSucceeded ? 'PASS' : 'FAIL',
      failureReasonCode, finalTransactionState: query.transactionState,
      vaultReferenceCount: vault.refs().length, metadataGeneration: vaultHost.snapshotMetadata().generation,
      sqliteGeneration: authority.sqlite, appRuntimeGeneration: authority.app,
      secureBridgeReferenceCount: secureBridge.listRefs().length,
      backendFinalState: 'RUNNING_AFTER_ROLLBACK_AND_NEXT_REQUEST',
      nextLegalRequestSucceeded: nextSucceeded, nextFd5HydrationSucceeded: true,
      secretValueRecorded: false, secretHashRecorded: false
    };
  } finally {
    secureBridge._applyRuntimeCandidate = originalApply; secureBridge.close(); custodyHost?.close(); fs.rmSync(root, { recursive: true, force: true });
  }
}

module.exports = { runSecureBridgeFailureProbe };
if (require.main === module) runSecureBridgeFailureProbe().then(value => { process.stdout.write(`${JSON.stringify(value, null, 2)}\n`); if (value.status !== 'PASS') process.exitCode = 1; }).catch(error => { process.stderr.write(`${error.reasonCode || error.code || 'WP4_SECURE_BRIDGE_PROBE_FAILED'} ${error.stack || error.message}\n`); process.exit(1); });
