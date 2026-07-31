#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const { CredentialVault } = require('../../electron/credentialVault');
const { CredentialVaultHost } = require('../../electron/desktopHost/CredentialVaultHost');
const { makeCustodyRequest } = require('../../shared/credentialCustodyProtocol');

function safeStorage() {
  const key = crypto.createHash('sha256').update('wp4-real-crash-matrix').digest();
  return {
    isEncryptionAvailable: () => true,
    encryptString(value) { const iv = Buffer.alloc(12, 11); const cipher = crypto.createCipheriv('aes-256-gcm', key, iv); const body = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), body]); },
    decryptString(value) { const bytes = Buffer.from(value); const decipher = crypto.createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12)); decipher.setAuthTag(bytes.subarray(12, 28)); return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8'); }
  };
}
function terminateAbruptly() { try { process.kill(process.pid, 'SIGKILL'); } catch (_) { process.abort(); } }
async function main() {
  const root = path.resolve(process.argv[2] || ''); const crashPoint = String(process.argv[3] || '');
  if (!root || !crashPoint) throw new Error('root and crash point are required');
  const injectedPoint = crashPoint.startsWith('ABORT_') ? crashPoint.slice('ABORT_'.length) : crashPoint;
  const vault = new CredentialVault(path.join(root, 'vault.json'), { safeStorage: safeStorage() });
  const host = new CredentialVaultHost({
    vault, metadataPath: path.join(root, 'vault-meta.json'), transactionPath: path.join(root, 'transactions.json'),
    randomUUID: () => 'wp4-crash-epoch', crashInjector(name) { if (name === injectedPoint) terminateAbruptly(); }
  });
  host.createHydrationFrame({ startupNonce: 'crash-start', oneTimeToken: 'x'.repeat(43), backendPid: process.pid, manifestSha256: 'c'.repeat(64) });
  if (crashPoint === 'BEFORE_PREPARE') terminateAbruptly();
  const request = makeCustodyRequest({ action: 'PREPARE', requestId: 'crash-request', operation: 'persist', ref: 'probe/crash', value: { token: 'redacted' }, backendPid: process.pid, manifestSha256: 'c'.repeat(64), vaultEpoch: 'wp4-crash-epoch', generation: 1 });
  await host.prepareCustodyTransaction(request);
  if (crashPoint === 'BEFORE_COMMIT_SEND') terminateAbruptly();
  if (crashPoint.startsWith('ABORT_')) await host.abortCustodyTransaction({ ...request, action: 'ABORT' });
  else await host.commitCustodyTransaction({ ...request, action: 'COMMIT' });
  throw new Error(`Crash point was not reached: ${crashPoint}`);
}
main().catch(error => { process.stderr.write(`${error.reasonCode || error.code || 'CRASH_CHILD_FAILED'} ${error.stack || error.message}\n`); process.exit(91); });
