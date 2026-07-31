'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PATHS } = require('../config');

function safeKey(value) {
  return String(value || '').trim().replace(/[^a-zA-Z0-9_-]/g, '_').replace(/^_+|_+$/g, '');
}

function isNumericKey(value) {
  return /^\d+$/.test(String(value || '').trim());
}

function accountKeyCandidates(account = {}) {
  const metadata = account && typeof account.metadata === 'object' && account.metadata ? account.metadata : {};
  return [
    metadata.openClawAccountId,
    metadata.whatsappAccountId,
    metadata.authAccountKey,
    metadata.accountKey,
    account.accountKey,
    account.externalId,
    account.adapterAccountId
  ];
}

function resolveStableAccountKey(accountOrKey, options = {}) {
  const candidates = accountOrKey && typeof accountOrKey === 'object'
    ? accountKeyCandidates(accountOrKey)
    : [accountOrKey];

  for (const candidate of candidates) {
    const key = safeKey(candidate);
    if (key && !isNumericKey(key)) return key;
  }

  const fallback = safeKey(options.fallback || '');
  if (fallback && !isNumericKey(fallback)) return fallback;

  if (options.allowNumeric === true) {
    const numeric = candidates.map(safeKey).find(value => value && isNumericKey(value));
    if (numeric) return numeric;
  }

  const error = new Error('WhatsApp 缺少稳定账号键，拒绝使用数据库数字主键作为认证目录');
  error.code = 'WHATSAPP_STABLE_ACCOUNT_KEY_MISSING';
  error.status = 409;
  throw error;
}

function readCredentialState(directory) {
  const file = path.join(directory, 'creds.json');
  try {
    const credentials = JSON.parse(fs.readFileSync(file, 'utf8') || '{}');
    const hasIdentity = Boolean(credentials?.me?.id || credentials?.me?.lid);
    return {
      directory: path.resolve(directory),
      file,
      exists: true,
      usable: hasIdentity,
      hasIdentity,
      registered: credentials?.registered === true,
      credentials
    };
  } catch (error) {
    return {
      directory: path.resolve(directory),
      file,
      exists: fs.existsSync(file),
      usable: false,
      hasIdentity: false,
      registered: false,
      credentials: null,
      error: error.code === 'ENOENT' ? '' : error.message
    };
  }
}

function countFiles(directory) {
  let count = 0;
  const stack = [directory];
  while (stack.length) {
    const current = stack.pop();
    let entries = [];
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch (_) { continue; }
    for (const entry of entries) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(target);
      else if (entry.isFile()) count += 1;
    }
  }
  return count;
}

function uniqueSibling(directory, suffix) {
  const parent = path.dirname(directory);
  const base = path.basename(directory);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(parent, `${base}.${suffix}-${stamp}-${crypto.randomBytes(3).toString('hex')}`);
}

function copyDirectoryAtomically(source, destination) {
  const resolvedSource = path.resolve(source);
  const resolvedDestination = path.resolve(destination);
  if (resolvedSource === resolvedDestination) {
    return { copied: false, destination: resolvedDestination, backup: '', source: resolvedSource };
  }

  const sourceState = readCredentialState(resolvedSource);
  if (!sourceState.usable) {
    const error = new Error('旧 WhatsApp 凭据目录缺少可识别身份');
    error.code = 'WHATSAPP_LEGACY_CREDENTIALS_UNUSABLE';
    throw error;
  }

  fs.mkdirSync(path.dirname(resolvedDestination), { recursive: true });
  const temporary = uniqueSibling(resolvedDestination, 'migrating');
  let backup = '';
  try {
    fs.cpSync(resolvedSource, temporary, { recursive: true, force: false, errorOnExist: true });
    const copiedState = readCredentialState(temporary);
    if (!copiedState.usable) {
      const error = new Error('复制后的 WhatsApp 凭据校验失败');
      error.code = 'WHATSAPP_COPIED_CREDENTIALS_UNUSABLE';
      throw error;
    }

    if (fs.existsSync(resolvedDestination)) {
      const destinationState = readCredentialState(resolvedDestination);
      if (destinationState.usable) {
        fs.rmSync(temporary, { recursive: true, force: true });
        return { copied: false, destination: resolvedDestination, backup: '', source: resolvedSource };
      }
      backup = uniqueSibling(resolvedDestination, 'pre-migration-backup');
      fs.renameSync(resolvedDestination, backup);
    }

    fs.renameSync(temporary, resolvedDestination);
    return { copied: true, destination: resolvedDestination, backup, source: resolvedSource };
  } catch (error) {
    try { fs.rmSync(temporary, { recursive: true, force: true }); } catch (_) {}
    if (backup && !fs.existsSync(resolvedDestination) && fs.existsSync(backup)) {
      try { fs.renameSync(backup, resolvedDestination); } catch (_) {}
    }
    throw error;
  }
}

function resolveAuthLocation(accountOrKey, options = {}) {
  const key = resolveStableAccountKey(accountOrKey, options);
  const currentDirectory = path.join(PATHS.whatsappAuth, key);
  const legacyDirectory = path.join(PATHS.baileysAuthLegacy, key);
  let current = readCredentialState(currentDirectory);
  const legacy = readCredentialState(legacyDirectory);
  let migration = { performed: false, copied: false, source: '', destination: currentDirectory, backup: '' };

  if (!current.usable && legacy.usable && options.migrate !== false) {
    const copied = copyDirectoryAtomically(legacyDirectory, currentDirectory);
    migration = {
      performed: true,
      copied: copied.copied,
      source: copied.source,
      destination: copied.destination,
      backup: copied.backup
    };
    current = readCredentialState(currentDirectory);
  }

  return {
    key,
    directory: currentDirectory,
    current,
    legacy,
    migration,
    usable: current.usable || legacy.usable,
    registered: current.usable ? current.registered : legacy.registered,
    fileCount: options.includeFileCount === true
      ? (current.usable ? countFiles(currentDirectory) : (legacy.usable ? countFiles(legacyDirectory) : 0))
      : 0
  };
}

module.exports = {
  safeKey,
  isNumericKey,
  accountKeyCandidates,
  resolveStableAccountKey,
  readCredentialState,
  countFiles,
  copyDirectoryAtomically,
  resolveAuthLocation
};
