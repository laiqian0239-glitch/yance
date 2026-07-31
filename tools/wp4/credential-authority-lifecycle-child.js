#!/usr/bin/env node
'use strict';
const path = require('node:path');
const { CredentialVault } = require('../../electron/credentialVault');
const { CredentialVaultHost } = require('../../electron/desktopHost/CredentialVaultHost');
const { lifecycleSafeStorage, paths } = require('./credential-authority-lifecycle-fixture');
function kill() { try { process.kill(process.pid, 'SIGKILL'); } catch (_) { process.abort(); } }
function main() {
  const root = path.resolve(process.argv[2] || '');
  const point = String(process.argv[3] || '');
  const mode = String(process.argv[4] || 'SIGKILL').toUpperCase();
  if (!root || !point) throw new Error('root and lifecycle crash point are required');
  const p = paths(root);
  const vault = new CredentialVault(p.vaultFile, { safeStorage: lifecycleSafeStorage() });
  const host = new CredentialVaultHost({
    vault,
    metadataPath: p.metadataPath,
    transactionPath: p.transactionPath,
    lifecycleIntentPath: p.intentPath,
    lifecycleCompletedPath: p.completedPath,
    crashInjector(name) {
      if (name !== point) return;
      if (mode === 'THROW') {
        const failure = new Error(`Injected credential authority lifecycle failure at ${point}`);
        failure.reasonCode = 'WP4_CREDENTIAL_AUTHORITY_LIFECYCLE_INJECTED_FAILURE';
        throw failure;
      }
      kill();
    }
  });
  if (point === 'MIGRATION_AFTER_COMPLETION_BEFORE_FIRST_FD5' || point === 'AUTHORITY_ACTIVE_BEFORE_FIRST_FD5') throw new Error(`crash point not reached: ${point}`);
  host.createHydrationFrame({
    startupNonce: 'lifecycle-child', backendSessionId: 'lifecycle-child-session', fd6PipeInstanceId: 'lifecycle-child-fd6',
    oneTimeToken: 'x'.repeat(43), backendPid: process.pid, manifestSha256: 'a'.repeat(64)
  });
  throw new Error(`crash point not reached: ${point}`);
}
try { main(); } catch (error) { process.stderr.write(`${error.reasonCode || error.code || 'AUTHORITY_LIFECYCLE_CHILD_FAILED'} ${error.stack || error.message}\n`); process.exit(91); }
