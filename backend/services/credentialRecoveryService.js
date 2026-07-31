'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PATHS } = require('../config');
const accountStore = require('./accountStore');
const settingsRepository = require('../repositories/settingsRepository');
const {
  safeKey,
  isNumericKey,
  resolveStableAccountKey,
  readCredentialState,
  copyDirectoryAtomically,
  resolveAuthLocation
} = require('./whatsappAuthResolver');

const SKIP_DIRS = new Set(['node_modules', 'backups', 'legacy-json', 'logs', 'media', 'tmp', 'dist', 'build']);

function readValidCredentials(directory) {
  const state = readCredentialState(directory);
  return state.usable ? state.credentials : null;
}

function discoverCredentialDirectories(root = PATHS.root, maxDepth = 4) {
  const result = [];
  const visited = new Set();
  function visit(directory, depth) {
    const resolved = path.resolve(directory);
    if (visited.has(resolved) || depth > maxDepth) return;
    visited.add(resolved);
    const credentialState = readCredentialState(resolved);
    if (credentialState.usable) {
      result.push({ directory: resolved, credentials: credentialState.credentials, credentialState });
      return;
    }
    let entries = [];
    try { entries = fs.readdirSync(resolved, { withFileTypes: true }); } catch (_) { return; }
    for (const entry of entries) {
      if (!entry.isDirectory() || SKIP_DIRS.has(entry.name.toLowerCase())) continue;
      visit(path.join(resolved, entry.name), depth + 1);
    }
  }
  visit(root, 0);
  return result;
}

function safeAdapterId(directory, credentials) {
  const id = String(credentials?.me?.id || credentials?.me?.lid || '').split(':')[0].split('@')[0].replace(/[^a-zA-Z0-9_-]/g, '');
  if (id) return `wa-${id.slice(0, 48)}`;
  return `wa-recovered-${crypto.createHash('sha256').update(directory).digest('hex').slice(0, 12)}`;
}

function directChildKey(directory, root) {
  if (!root) return '';
  const parent = path.resolve(path.dirname(directory));
  if (parent !== path.resolve(root)) return '';
  const key = safeKey(path.basename(directory));
  return key && !isNumericKey(key) ? key : '';
}

function keyForCandidate(candidate) {
  return directChildKey(candidate.directory, PATHS.whatsappAuth)
    || directChildKey(candidate.directory, PATHS.baileysAuthLegacy)
    || safeAdapterId(candidate.directory, candidate.credentials);
}

function accountStableKey(account) {
  try { return resolveStableAccountKey(account); } catch (_) { return ''; }
}

function findExistingAccount(stableKey) {
  const accounts = accountStore.list().filter(account => account.platform === 'whatsapp');
  return accounts.find(account => account.adapterAccountId === stableKey)
    || accounts.find(account => accountStableKey(account) === stableKey)
    || null;
}

async function disableDuplicateAliases(stableKey, canonicalId, report) {
  for (const account of accountStore.list().filter(row => row.platform === 'whatsapp' && row.id !== canonicalId && accountStableKey(row) === stableKey)) {
    const updated = await accountStore.update(account.id, {
      paused: true,
      autoReconnect: false,
      metadata: {
        authAliasOf: canonicalId,
        resolvedAuthAccountKey: stableKey,
        validationState: 'duplicate-auth-alias-disabled'
      }
    });
    report.aliasesDisabled.push({ accountId: updated.id, adapterAccountId: updated.adapterAccountId, canonicalId, stableKey });
  }
}

async function reconcileExistingAccount(existing, stableKey, destination, candidate, report) {
  let account = existing;
  const conflict = accountStore.list().find(row => row.platform === 'whatsapp' && row.id !== account.id && row.adapterAccountId === stableKey);
  const patch = {
    autoReconnect: true,
    paused: false,
    identityLabel: account.identityLabel || '本机认证凭据已恢复，等待连接验证',
    metadata: {
      recoveredFrom: candidate.directory,
      credentialDirectory: destination,
      resolvedAuthAccountKey: stableKey,
      recoveredAt: report.at,
      validationState: account.metadata?.validationState === 'live-validated' ? 'live-validated' : 'pending-live-connect',
      filesystemValidated: true,
      registeredFlag: candidate.credentialState?.registered === true,
      recoveryCreatedAccount: false
    }
  };
  if (account.adapterAccountId !== stableKey && !conflict) patch.adapterAccountId = stableKey;
  account = await accountStore.update(account.id, patch);
  report.reconciled.push({
    accountId: account.id,
    previousAdapterAccountId: existing.adapterAccountId,
    adapterAccountId: account.adapterAccountId,
    stableKey,
    directory: destination,
    rebindApplied: account.adapterAccountId === stableKey,
    conflictAccountId: conflict?.id || ''
  });
  await disableDuplicateAliases(stableKey, account.id, report);
  return account;
}

async function recoverAtStartup(options = {}) {
  const roots = [
    PATHS.whatsappAuth,
    PATHS.baileysAuthLegacy,
    ...(Array.isArray(options.extraRoots) ? options.extraRoots : [])
  ];
  if (options.scanDataRoot !== false) roots.push(PATHS.root);

  const candidates = [];
  const seen = new Set();
  for (const root of roots) {
    if (!root || !fs.existsSync(root)) continue;
    for (const candidate of discoverCredentialDirectories(root, root === PATHS.root ? 4 : Number(options.extraRootDepth || 4))) {
      const resolved = path.resolve(candidate.directory);
      if (seen.has(resolved)) continue;
      seen.add(resolved);
      candidates.push(candidate);
    }
  }

  const report = {
    ok: true,
    scanned: candidates.length,
    registered: [],
    reconciled: [],
    copied: [],
    aliasesDisabled: [],
    skipped: [],
    failed: [],
    at: new Date().toISOString()
  };

  for (const candidate of candidates) {
    try {
      const stableKey = keyForCandidate(candidate);
      let destination = path.join(PATHS.whatsappAuth, stableKey);
      let copied = false;
      let migrationBackup = '';

      const fromKnownLegacy = path.resolve(path.dirname(candidate.directory)) === path.resolve(PATHS.baileysAuthLegacy);
      if (fromKnownLegacy) {
        const resolved = resolveAuthLocation(stableKey, { migrate: true });
        destination = resolved.directory;
        copied = resolved.migration.copied;
        migrationBackup = resolved.migration.backup;
      } else if (path.resolve(candidate.directory) !== path.resolve(destination)) {
        const result = copyDirectoryAtomically(candidate.directory, destination);
        copied = result.copied;
        migrationBackup = result.backup;
      }

      const destinationState = readCredentialState(destination);
      if (!destinationState.usable) {
        const error = new Error('复制后的 WhatsApp 凭据缺少 me.id/me.lid，无法进入连接验证');
        error.code = 'COPIED_CREDENTIAL_VALIDATION_FAILED';
        throw error;
      }
      if (copied) {
        report.copied.push({
          source: candidate.directory,
          destination,
          backup: migrationBackup,
          validationState: 'filesystem-validated',
          registeredFlag: destinationState.registered,
          recoveryCreatedAccount: true
        });
      }

      const existing = findExistingAccount(stableKey);
      if (existing) {
        const account = await reconcileExistingAccount(existing, stableKey, destination, candidate, report);
        report.skipped.push({
          directory: candidate.directory,
          reason: 'account-reconciled',
          accountId: account.id,
          credentialRestored: copied,
          stableKey
        });
        continue;
      }

      const identity = String(candidate.credentials?.me?.name || candidate.credentials?.me?.id || candidate.credentials?.me?.lid || stableKey);
      const account = await accountStore.create({
        platform: 'whatsapp',
        adapterAccountId: stableKey,
        displayName: identity,
        identityLabel: '本机认证凭据已恢复，等待连接验证',
        autoReconnect: true,
        source: 'automatic-credential-recovery',
        metadata: {
          recoveredFrom: candidate.directory,
          credentialDirectory: destination,
          resolvedAuthAccountKey: stableKey,
          recoveredAt: report.at,
          validationState: 'pending-live-connect',
          filesystemValidated: true,
          registeredFlag: destinationState.registered,
          recoveryCreatedAccount: true
        }
      });
      report.registered.push({
        accountId: account.id,
        adapterAccountId: stableKey,
        directory: destination,
        validationState: 'pending-live-connect',
        registeredFlag: destinationState.registered
      });
    } catch (error) {
      report.failed.push({ directory: candidate.directory, error: error.message, code: error.code || '' });
    }
  }

  report.ok = report.failed.length === 0;
  settingsRepository.set('credential-recovery', 'last-report', report);
  return report;
}

module.exports = {
  recoverAtStartup,
  discoverCredentialDirectories,
  readValidCredentials,
  keyForCandidate,
  accountStableKey
};
