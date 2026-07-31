'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { AppRuntimeError } = require('./errors');
const { OPERATING_MODES, normalizeLegacyOperatingMode } = require('./OperatingMode');

const MIGRATION_VERSION = 1;

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function hashBytes(file) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let position = 0;
    for (;;) {
      const read = fs.readSync(fd, buffer, 0, buffer.length, position);
      if (!read) break;
      hash.update(buffer.subarray(0, read));
      position += read;
    }
  } finally { fs.closeSync(fd); }
  return hash.digest('hex');
}

function fileIdentity(file) {
  const stat = fs.statSync(file);
  if (!stat.isFile()) return null;
  return Object.freeze({ path: path.resolve(file), size: stat.size, mtimeMs: Math.trunc(stat.mtimeMs), sha256: hashBytes(file) });
}

function existingFiles(root, relatives) {
  const rows = [];
  for (const relative of relatives) {
    const file = path.join(root, relative);
    try {
      const identity = fileIdentity(file);
      if (identity) rows.push(identity);
    } catch (cause) {
      if (cause?.code !== 'ENOENT') throw cause;
    }
  }
  return rows.sort((a, b) => a.path.localeCompare(b.path));
}

function sourceFingerprint(root, files) {
  return crypto.createHash('sha256').update(stable({ root: path.resolve(root), files })).digest('hex');
}

function resolveLegacyYance27Root(options = {}) {
  if (options.legacyRoot) return path.resolve(options.legacyRoot);
  const currentRoot = path.resolve(options.currentRoot || '');
  const parent = path.dirname(currentRoot);
  if ((options.platform || process.platform) === 'win32') return path.join(parent, 'Yance27');
  if (path.basename(currentRoot).startsWith('.')) return path.join(parent, '.yance27');
  return path.join(parent, 'Yance27');
}

function readJson(file) {
  const text = fs.readFileSync(file, 'utf8');
  const value = JSON.parse(text);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('JSON document is not an object');
  return value;
}

function candidate(source, rawValue, evidence = {}) {
  const operatingMode = normalizeLegacyOperatingMode(rawValue);
  if (!operatingMode) {
    throw new AppRuntimeError('LEGACY_OPERATING_MODE_INVALID', `Legacy operating mode from ${source} is invalid`, {
      status: 503,
      failedPhase: 'runtime_state_migration',
      details: { source, rawValue: String(rawValue ?? ''), evidence }
    });
  }
  return Object.freeze({ source, operatingMode, rawValue: String(rawValue), evidence });
}

function readSqliteCandidates(file) {
  const values = [];
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=3000;');
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name));
    if (tables.has('runtime_state')) {
      const rows = db.prepare('SELECT id,operating_mode,state_version FROM runtime_state ORDER BY id').all();
      if (rows.length > 1) throw new AppRuntimeError('LEGACY_RUNTIME_STATE_AMBIGUOUS', 'Legacy runtime_state contains multiple authority rows', { status: 503, details: { file, rowCount: rows.length } });
      if (rows.length === 1) values.push(candidate('yance27.sqlite.runtime_state', rows[0].operating_mode, { file, id: rows[0].id, stateVersion: Number(rows[0].state_version || 0) }));
    }
    if (tables.has('r32_settings')) {
      const row = db.prepare("SELECT value_json FROM r32_settings WHERE namespace='system-policy' AND key='document'").get();
      if (row?.value_json) {
        const document = JSON.parse(row.value_json);
        if (Object.prototype.hasOwnProperty.call(document || {}, 'safeMode')) values.push(candidate('yance27.sqlite.system-policy', document.safeMode ? 'safeMode' : 'normal', { file }));
      }
    }
  } finally { db.close(); }
  return values;
}

function discoverCandidates(legacyRoot) {
  const candidates = [];
  const dbFile = path.join(legacyRoot, 'store', 'yance-r32.db');
  if (fs.existsSync(dbFile)) candidates.push(...readSqliteCandidates(dbFile));
  const safeFile = path.join(legacyRoot, 'safe-mode-state.json');
  if (fs.existsSync(safeFile)) {
    const value = readJson(safeFile);
    if (Object.prototype.hasOwnProperty.call(value, 'active')) candidates.push(candidate('yance27.safe-mode-state', value.active ? 'safeMode' : 'normal', { file: safeFile }));
  }
  const policyFiles = [path.join(legacyRoot, 'system-policy.json'), path.join(legacyRoot, 'store', 'system-policy.json')];
  for (const policyFile of policyFiles) {
    if (!fs.existsSync(policyFile)) continue;
    const value = readJson(policyFile);
    if (Object.prototype.hasOwnProperty.call(value, 'safeMode')) candidates.push(candidate('yance27.system-policy-json', value.safeMode ? 'safeMode' : 'normal', { file: policyFile }));
  }
  return candidates;
}

class RuntimeAuthorityMigrationCoordinator {
  constructor(options = {}) {
    this.store = options.store;
    this.ownership = options.ownership;
    this.currentRoot = path.resolve(options.currentRoot || options.dataRoot || '');
    this.legacyRoot = resolveLegacyYance27Root({ currentRoot: this.currentRoot, legacyRoot: options.legacyRoot, platform: options.platform });
    this.clock = options.clock || (() => new Date().toISOString());
    if (!this.store || !this.ownership || !this.currentRoot) throw new TypeError('store, ownership and currentRoot are required');
  }

  ensureAuthority() {
    if (this.store.hasRuntimeState()) return { mode: 'existing', ...this.store.validateRuntimeAuthority(), legacyRead: false };

    const startedAtUtc = this.clock();
    let sourceExists = false;
    try { sourceExists = fs.statSync(this.legacyRoot).isDirectory(); }
    catch (cause) { if (cause?.code !== 'ENOENT') throw new AppRuntimeError('LEGACY_RUNTIME_SOURCE_UNAVAILABLE', 'Earlier runtime source cannot be inspected', { status: 503, cause, details: { legacyRoot: this.legacyRoot } }); }

    const relativeFiles = ['store/yance-r32.db', 'store/yance-r32.db-wal', 'store/yance-r32.db-shm', 'safe-mode-state.json', 'system-policy.json', 'store/system-policy.json'];
    const before = sourceExists ? existingFiles(this.legacyRoot, relativeFiles) : [];
    const fingerprint = sourceExists ? sourceFingerprint(this.legacyRoot, before) : crypto.createHash('sha256').update(`fresh:${this.currentRoot}:wp5:${MIGRATION_VERSION}`).digest('hex');
    let candidates = [];
    if (sourceExists) {
      try { candidates = discoverCandidates(this.legacyRoot); }
      catch (cause) {
        if (cause instanceof AppRuntimeError) throw cause;
        throw new AppRuntimeError('LEGACY_RUNTIME_SOURCE_INVALID', 'Earlier runtime source could not be validated', { status: 503, failedPhase: 'runtime_state_migration', cause, details: { legacyRoot: this.legacyRoot, causeCode: cause?.code || '' } });
      }
    }
    const modes = new Set(candidates.map(row => row.operatingMode));
    if (modes.size > 1) {
      throw new AppRuntimeError('LEGACY_RUNTIME_CANDIDATE_CONFLICT', 'Earlier runtime mode candidates conflict', {
        status: 503,
        failedPhase: 'runtime_state_migration',
        details: { legacyRoot: this.legacyRoot, candidates }
      });
    }
    const selected = candidates[0]?.operatingMode || OPERATING_MODES.NORMAL;
    const after = sourceExists ? existingFiles(this.legacyRoot, relativeFiles) : [];
    if (stable(before) !== stable(after)) {
      throw new AppRuntimeError('LEGACY_RUNTIME_SOURCE_CHANGED', 'Earlier runtime source changed during migration validation', { status: 503, details: { before, after } });
    }
    const completedAtUtc = this.clock();
    const result = this.store.initializeRuntimeAuthority({
      ...this.ownership.guard(),
      operatingMode: selected,
      migration: {
        migrationId: `wp5-runtime-authority-v${MIGRATION_VERSION}:${fingerprint}`,
        migrationVersion: MIGRATION_VERSION,
        sourceCanonicalPath: sourceExists ? this.legacyRoot : '',
        sourceFingerprint: fingerprint,
        sourceFileCount: before.length,
        sourceTotalBytes: before.reduce((sum, row) => sum + row.size, 0),
        targetSchemaVersion: 1,
        status: 'COMMITTED',
        candidates,
        verification: { sourceReadOnly: true, before, after, sourceMutationCount: 0, sourceExists },
        startedAtUtc,
        completedAtUtc
      }
    });
    return { mode: sourceExists ? 'migrated' : 'fresh', operatingMode: selected, stateVersion: result.stateVersion, receipt: result.receipt, legacyRead: sourceExists };
  }
}

module.exports = {
  MIGRATION_VERSION,
  RuntimeAuthorityMigrationCoordinator,
  discoverCandidates,
  existingFiles,
  resolveLegacyYance27Root,
  sourceFingerprint
};
