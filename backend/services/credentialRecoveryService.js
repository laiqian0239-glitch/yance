'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PATHS } = require('../config');
const accountStore = require('./accountStore');
const settingsRepository = require('../repositories/settingsRepository');
const { getPrimaryStoreCapability } = require('../repositories/storeProvider');
const {
  safeKey,
  isNumericKey,
  resolveStableAccountKey,
  readCredentialState
} = require('./whatsappAuthResolver');

const SKIP_DIRS = new Set(['node_modules', 'backups', 'legacy-json', 'logs', 'media', 'tmp', 'dist', 'build']);
const TERMINAL_AUTH_STATES = new Set(['LOGGED_OUT', 'QUARANTINED']);

function readValidCredentials(directory) {
  const state = readCredentialState(directory);
  return state.importable ? state.credentials : null;
}

function discoverCredentialDirectories(root = PATHS.root, maxDepth = 4) {
  const result = [];
  const visited = new Set();
  function visit(directory, depth) {
    const resolved = path.resolve(directory);
    if (visited.has(resolved) || depth > maxDepth) return;
    visited.add(resolved);
    const credentialState = readCredentialState(resolved);
    if (credentialState.importable) {
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

function readAuthAuthority(store, accountKey, accountId = '') {
  return store.db.prepare(`SELECT account_key,account_id,state,current_epoch,
    writer_generation,writer_socket_token,logged_out_at,quarantine_reason
    FROM whatsapp_auth_accounts
    WHERE account_key=? OR account_id=?
    ORDER BY CASE WHEN account_key=? THEN 0 ELSE 1 END
    LIMIT 1`).get(accountKey, String(accountId || ''), accountKey) || null;
}

function tombstoneReport(authority, existing, stableKey, directory) {
  return {
    accountId: String(authority.account_id || existing?.id || ''),
    accountKey: String(authority.account_key),
    stableKey,
    state: String(authority.state),
    directory: path.resolve(directory),
    reasonCode: 'WHATSAPP_LEGACY_AUTH_RESURRECTION_BLOCKED'
  };
}

function importRequiredReport(authority, existing, accountKey, stableKey, directory) {
  return {
    accountId: String(authority?.account_id || existing?.id || ''),
    accountKey,
    stableKey,
    state: String(authority?.state || ''),
    directory: path.resolve(directory),
    reasonCode: 'WHATSAPP_LEGACY_AUTH_IMPORT_REQUIRED'
  };
}

async function recoverAtStartup(options = {}) {
  const roots = [
    PATHS.whatsappAuth,
    PATHS.baileysAuthLegacy,
    ...(Array.isArray(options.extraRoots) ? options.extraRoots : [])
  ];
  if (options.scanDataRoot !== false) roots.push(PATHS.root);

  const candidates = [];
  const seenDirectories = new Set();
  for (const root of roots) {
    if (!root || !fs.existsSync(root)) continue;
    for (const candidate of discoverCredentialDirectories(root, root === PATHS.root ? 4 : Number(options.extraRootDepth || 4))) {
      const resolved = path.resolve(candidate.directory);
      if (seenDirectories.has(resolved)) continue;
      seenDirectories.add(resolved);
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
    importRequired: [],
    tombstones: [],
    skipped: [],
    failed: [],
    at: new Date().toISOString()
  };

  const processedKeys = new Set();
  const store = getPrimaryStoreCapability();
  for (const candidate of candidates) {
    try {
      const stableKey = keyForCandidate(candidate);
      if (processedKeys.has(stableKey)) {
        report.skipped.push({
          directory: path.resolve(candidate.directory),
          stableKey,
          reason: 'duplicate-legacy-auth-candidate'
        });
        continue;
      }
      processedKeys.add(stableKey);

      const existing = findExistingAccount(stableKey);
      const accountKey = `whatsapp-auth-account:${stableKey}`;
      const authority = readAuthAuthority(store, accountKey, existing?.id || '');

      if (authority && TERMINAL_AUTH_STATES.has(String(authority.state))) {
        report.tombstones.push(tombstoneReport(
          authority,
          existing,
          stableKey,
          candidate.directory
        ));
        continue;
      }

      if (authority && String(authority.state) === 'ACTIVE') {
        report.skipped.push({
          accountId: String(authority.account_id || existing?.id || ''),
          accountKey: String(authority.account_key),
          stableKey,
          directory: path.resolve(candidate.directory),
          reason: 'database-auth-authority-active'
        });
        continue;
      }

      report.importRequired.push(importRequiredReport(
        authority,
        existing,
        accountKey,
        stableKey,
        candidate.directory
      ));
    } catch (error) {
      report.failed.push({
        directory: path.resolve(candidate.directory),
        error: error.message,
        code: error.code || ''
      });
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
  accountStableKey,
  readAuthAuthority
};
