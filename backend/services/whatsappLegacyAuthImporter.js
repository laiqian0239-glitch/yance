'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const DEFAULT_BAILEYS = require('@whiskeysockets/baileys');
const { hasCriticalSignalState } = require('./whatsappAuthResolver');

const PRIVATE = new WeakMap();
const RECEIPT_PREFIX = 'oss1a-wa-import-';
const KEY_CATEGORIES = Object.freeze([
  'app-state-sync-version',
  'app-state-sync-key',
  'sender-key-memory',
  'sender-key',
  'device-list',
  'pre-key',
  'session'
].sort((left, right) => right.length - left.length));

function importerError(code, message, details = {}) {
  const error = new Error(message);
  error.name = 'WhatsAppLegacyAuthImporterError';
  error.code = code;
  error.reasonCode = code;
  error.details = Object.freeze({ ...details });
  return error;
}

function nonEmptyString(value, field) {
  if (typeof value !== 'string' || value !== value.trim() || !value) {
    throw importerError('WHATSAPP_LEGACY_AUTH_INPUT_INVALID', `${field} is invalid`, { field });
  }
  return value;
}

function nonNegativeInteger(value, field) {
  if (!Number.isInteger(value) || value < 0) {
    throw importerError('WHATSAPP_LEGACY_AUTH_INPUT_INVALID', `${field} is invalid`, { field });
  }
  return value;
}

function privateState(instance) {
  const state = PRIVATE.get(instance);
  if (!state) throw importerError('WHATSAPP_LEGACY_AUTH_IMPORTER_INVALID', 'Importer private state is unavailable');
  return state;
}

function validateDependencies(options) {
  if (!options.repository || typeof options.repository.importLegacySnapshot !== 'function') {
    throw importerError(
      'WHATSAPP_LEGACY_AUTH_REPOSITORY_INVALID',
      'Repository two-phase legacy import capability is required'
    );
  }
  if (typeof options.storeProvider !== 'function') {
    throw importerError('WHATSAPP_LEGACY_AUTH_STORE_PROVIDER_INVALID', 'Store provider is required');
  }
  if (!options.cipher || typeof options.cipher.hmacIndex !== 'function') {
    throw importerError('WHATSAPP_LEGACY_AUTH_CIPHER_INVALID', 'WhatsAppAuthCipher capability is required');
  }
  const baileys = options.baileys || DEFAULT_BAILEYS;
  if (typeof baileys?.BufferJSON?.reviver !== 'function') {
    throw importerError('WHATSAPP_LEGACY_AUTH_BAILEYS_INVALID', 'Pinned Baileys BufferJSON is unavailable');
  }
  if (typeof options.archiveRoot !== 'string' || !options.archiveRoot.trim()) {
    throw importerError('WHATSAPP_LEGACY_AUTH_ARCHIVE_ROOT_INVALID', 'Archive root is required');
  }
  return baileys;
}

function invokeFault(state, point, context = {}) {
  if (typeof state.faultInjector === 'function') {
    state.faultInjector(point, Object.freeze({ ...context }));
  }
}

function listFiles(root) {
  const resolvedRoot = path.resolve(root);
  let rootStat;
  try {
    rootStat = fs.lstatSync(resolvedRoot);
  } catch (error) {
    throw importerError(
      'WHATSAPP_LEGACY_AUTH_SOURCE_UNAVAILABLE',
      'Legacy auth source directory is unavailable',
      { causeCode: error.code || '', sourceDirectory: resolvedRoot }
    );
  }
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw importerError(
      'WHATSAPP_LEGACY_AUTH_SOURCE_INVALID',
      'Legacy auth source must be one physical directory'
    );
  }

  const files = [];
  const stack = [resolvedRoot];
  while (stack.length) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      const relative = path.relative(resolvedRoot, absolute).split(path.sep).join('/');
      const stat = fs.lstatSync(absolute);
      if (stat.isSymbolicLink()) {
        throw importerError(
          'WHATSAPP_LEGACY_AUTH_SOURCE_SYMLINK_FORBIDDEN',
          'Legacy auth manifest rejects symbolic links',
          { relativePath: relative }
        );
      }
      if (stat.isDirectory()) {
        stack.push(absolute);
        continue;
      }
      if (!stat.isFile()) {
        throw importerError(
          'WHATSAPP_LEGACY_AUTH_SOURCE_ENTRY_INVALID',
          'Legacy auth manifest accepts regular files only',
          { relativePath: relative }
        );
      }
      const bytes = fs.readFileSync(absolute);
      files.push(Object.freeze({
        relativePath: relative,
        size: bytes.length,
        sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
        bytes
      }));
    }
  }
  files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  return files;
}

function createManifest(directory) {
  const files = listFiles(directory);
  const digestInput = files.map(file => ({
    relativePath: file.relativePath,
    size: file.size,
    sha256: file.sha256
  }));
  const sha256 = crypto.createHash('sha256')
    .update(JSON.stringify(digestInput))
    .digest('hex');
  return Object.freeze({ directory: path.resolve(directory), sha256, files });
}

function parseJson(file, baileys) {
  try {
    return JSON.parse(file.bytes.toString('utf8'), baileys.BufferJSON.reviver);
  } catch (_) {
    throw importerError(
      'WHATSAPP_LEGACY_AUTH_JSON_INVALID',
      'Legacy auth JSON file is invalid',
      { relativePath: file.relativePath }
    );
  }
}

function parseKeyIdentity(relativePath) {
  if (relativePath.includes('/')) {
    throw importerError(
      'WHATSAPP_LEGACY_AUTH_KEY_PATH_INVALID',
      'Legacy key files must be located at the auth directory root',
      { relativePath }
    );
  }
  if (!relativePath.endsWith('.json') || relativePath === 'creds.json') return null;
  const stem = relativePath.slice(0, -5);
  const category = KEY_CATEGORIES.find(candidate => stem.startsWith(`${candidate}-`));
  if (!category) {
    throw importerError(
      'WHATSAPP_LEGACY_AUTH_KEY_CATEGORY_INVALID',
      'Legacy auth key category is not recognized',
      { relativePath }
    );
  }
  const keyId = stem.slice(category.length + 1);
  if (!keyId) {
    throw importerError(
      'WHATSAPP_LEGACY_AUTH_KEY_ID_INVALID',
      'Legacy auth key identifier is missing',
      { relativePath }
    );
  }
  return Object.freeze({ category, keyId });
}

function parseSnapshot(manifest, baileys) {
  const credsFile = manifest.files.find(file => file.relativePath === 'creds.json');
  if (!credsFile) {
    throw importerError('WHATSAPP_LEGACY_AUTH_CREDS_MISSING', 'Legacy auth creds.json is missing');
  }
  const creds = parseJson(credsFile, baileys);
  if (!hasCriticalSignalState(creds)) {
    throw importerError(
      'WHATSAPP_LEGACY_SIGNAL_STATE_INCOMPLETE',
      'Legacy auth credentials do not contain complete Signal state'
    );
  }
  const keys = [];
  for (const file of manifest.files) {
    const identity = parseKeyIdentity(file.relativePath);
    if (!identity) continue;
    keys.push(Object.freeze({
      category: identity.category,
      keyId: identity.keyId,
      value: parseJson(file, baileys)
    }));
  }
  return Object.freeze({ creds, keys: Object.freeze(keys) });
}

function normalizedInput(input) {
  return Object.freeze({
    accountId: nonEmptyString(input?.accountId, 'accountId'),
    accountKey: nonEmptyString(input?.accountKey, 'accountKey'),
    sourceDirectory: path.resolve(nonEmptyString(input?.sourceDirectory, 'sourceDirectory')),
    generation: nonNegativeInteger(input?.generation, 'generation'),
    socketToken: nonEmptyString(input?.socketToken, 'socketToken')
  });
}

function publicReceipt(receipt, overrides = {}) {
  return Object.freeze({
    receiptId: String(receipt.receiptId || receipt.receipt_id || ''),
    state: String(receipt.state || ''),
    imported: overrides.imported === true,
    cleanupRequired: String(receipt.state || '') === 'CLEANUP_REQUIRED',
    accountKey: String(receipt.accountKey || receipt.account_key || ''),
    epoch: Number(receipt.epoch || receipt.stagedEpoch || receipt.staged_epoch || 0),
    archiveDirectory: String(overrides.archiveDirectory || '')
  });
}

class WhatsAppLegacyAuthImporter {
  constructor(options = {}) {
    const baileys = validateDependencies(options);
    PRIVATE.set(this, Object.freeze({
      repository: options.repository,
      storeProvider: options.storeProvider,
      cipher: options.cipher,
      baileys,
      archiveRoot: path.resolve(options.archiveRoot),
      clock: typeof options.clock === 'function' ? options.clock : (() => new Date().toISOString()),
      renameDirectory: typeof options.renameDirectory === 'function'
        ? options.renameDirectory
        : ((source, destination) => fs.renameSync(source, destination)),
      faultInjector: options.faultInjector || null
    }));
    Object.freeze(this);
  }

  async importDirectory(input = {}) {
    const state = privateState(this);
    const normalized = normalizedInput(input);
    const basename = path.basename(normalized.sourceDirectory);
    if (basename.startsWith(RECEIPT_PREFIX)) {
      const archived = await Promise.resolve(state.repository.importLegacySnapshot({
        phase: 'LOOKUP',
        receiptId: basename
      }));
      if (archived) return publicReceipt(archived, { imported: false, archiveDirectory: normalized.sourceDirectory });
    }

    const sourceDirectoryHmac = state.cipher.hmacIndex(
      'LEGACY_AUTH_SOURCE_DIRECTORY',
      normalized.sourceDirectory
    );
    const receiptId = `${RECEIPT_PREFIX}${sourceDirectoryHmac.slice(0, 32)}`;
    const existing = await Promise.resolve(state.repository.importLegacySnapshot({
      phase: 'LOOKUP',
      receiptId,
      sourceDirectoryHmac
    }));
    if (existing && ['ACTIVATED', 'CLEANUP_REQUIRED', 'COMPLETED'].includes(String(existing.state))) {
      return publicReceipt(existing, { imported: false });
    }

    const manifestA = createManifest(normalized.sourceDirectory);
    invokeFault(state, 'after-manifest-a', { receiptId, manifestSha256: manifestA.sha256 });

    const prepared = await Promise.resolve(state.repository.importLegacySnapshot({
      phase: 'PREPARE',
      receiptId,
      accountId: normalized.accountId,
      accountKey: normalized.accountKey,
      sourceDirectoryHmac,
      manifestASha256: manifestA.sha256,
      generation: normalized.generation,
      socketToken: normalized.socketToken,
      at: String(state.clock())
    }));

    const manifestB = createManifest(normalized.sourceDirectory);
    await Promise.resolve(state.repository.importLegacySnapshot({
      phase: 'RECORD_MANIFEST_B',
      receiptId,
      manifestBSha256: manifestB.sha256,
      at: String(state.clock())
    }));
    if (manifestA.sha256 !== manifestB.sha256) {
      throw importerError(
        'WHATSAPP_LEGACY_AUTH_MANIFEST_CHANGED',
        'Legacy auth manifest changed after PREPARED',
        { receiptId }
      );
    }

    const snapshot = parseSnapshot(manifestB, state.baileys);
    const manifestC = createManifest(normalized.sourceDirectory);
    await Promise.resolve(state.repository.importLegacySnapshot({
      phase: 'RECORD_MANIFEST_C',
      receiptId,
      manifestCSha256: manifestC.sha256,
      at: String(state.clock())
    }));
    if (manifestB.sha256 !== manifestC.sha256) {
      throw importerError(
        'WHATSAPP_LEGACY_AUTH_MANIFEST_CHANGED',
        'Legacy auth manifest changed before activation',
        { receiptId }
      );
    }

    const activationSha256 = crypto.createHash('sha256').update(JSON.stringify({
      receiptId,
      accountKey: normalized.accountKey,
      stagedEpoch: Number(prepared.stagedEpoch || prepared.staged_epoch || 1),
      manifestSha256: manifestC.sha256,
      keyCount: snapshot.keys.length
    })).digest('hex');

    const activated = await Promise.resolve(state.repository.importLegacySnapshot({
      phase: 'ACTIVATE',
      receiptId,
      accountId: normalized.accountId,
      accountKey: normalized.accountKey,
      sourceDirectoryHmac,
      manifestASha256: manifestA.sha256,
      manifestBSha256: manifestB.sha256,
      manifestCSha256: manifestC.sha256,
      activationSha256,
      generation: normalized.generation,
      socketToken: normalized.socketToken,
      creds: snapshot.creds,
      keys: snapshot.keys,
      at: String(state.clock())
    }));

    const archiveDirectory = path.join(state.archiveRoot, receiptId);
    try {
      fs.mkdirSync(state.archiveRoot, { recursive: true });
      state.renameDirectory(normalized.sourceDirectory, archiveDirectory);
    } catch (error) {
      const cleanupReferenceHmac = state.cipher.hmacIndex(
        'LEGACY_AUTH_CLEANUP_REFERENCE',
        normalized.sourceDirectory
      );
      const cleanup = await Promise.resolve(state.repository.importLegacySnapshot({
        phase: 'CLEANUP_REQUIRED',
        receiptId,
        cleanupReferenceHmac,
        failureCode: 'WHATSAPP_LEGACY_AUTH_ARCHIVE_RENAME_FAILED',
        at: String(state.clock())
      }));
      return publicReceipt(cleanup, { imported: true });
    }

    const completed = await Promise.resolve(state.repository.importLegacySnapshot({
      phase: 'COMPLETE',
      receiptId,
      at: String(state.clock())
    }));
    return publicReceipt(completed || activated, { imported: true, archiveDirectory });
  }
}

Object.freeze(WhatsAppLegacyAuthImporter.prototype);

function createWhatsAppLegacyAuthImporter(options = {}) {
  return new WhatsAppLegacyAuthImporter(options);
}

module.exports = Object.freeze({
  RECEIPT_PREFIX,
  KEY_CATEGORIES,
  createManifest,
  parseSnapshot,
  WhatsAppLegacyAuthImporter,
  createWhatsAppLegacyAuthImporter
});
