'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MIGRATION_VERSION = 1;
const MARKER_RELATIVE_PATH = path.join('migration', 'brand-data-location-v1.json');
const CRITICAL_RELATIVE_PATHS = Object.freeze([
  path.join('store', 'yance-r32.db'),
  path.join('desktop-settings.json'),
  path.join('secure', 'credentials.safe.json')
]);

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(filePath, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    for (;;) {
      const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

function inventory(root, options = {}) {
  const result = { fileCount: 0, directoryCount: 0, totalBytes: 0, treeSha256: '', critical: {} };
  const fileRows = [];
  const excluded = new Set((options.excludeRelativePaths || []).map(value => String(value).split(path.sep).join('/')));
  if (!fs.existsSync(root)) return result;
  const walk = (directory) => {
    result.directoryCount += 1;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      const relative = path.relative(root, full).split(path.sep).join('/');
      if (excluded.has(relative)) continue;
      if (entry.isSymbolicLink()) {
        const error = new Error(`Data migration refuses symbolic links: ${full}`);
        error.reasonCode = 'YANCE_DATA_MIGRATION_SYMLINK_REJECTED';
        throw error;
      }
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        const stat = fs.statSync(full);
        const digest = sha256File(full);
        result.fileCount += 1;
        result.totalBytes += stat.size;
        fileRows.push({ relative, bytes: stat.size, sha256: digest });
      }
    }
  };
  walk(root);
  const treeHash = crypto.createHash('sha256');
  for (const row of fileRows.sort((a, b) => a.relative.localeCompare(b.relative, 'en'))) {
    treeHash.update(row.relative, 'utf8');
    treeHash.update('\0');
    treeHash.update(String(row.bytes), 'utf8');
    treeHash.update('\0');
    treeHash.update(row.sha256, 'ascii');
    treeHash.update('\n');
  }
  result.treeSha256 = treeHash.digest('hex');
  for (const relative of CRITICAL_RELATIVE_PATHS) {
    const full = path.join(root, relative);
    if (fs.existsSync(full) && fs.statSync(full).isFile()) {
      result.critical[relative.split(path.sep).join('/')] = {
        bytes: fs.statSync(full).size,
        sha256: sha256File(full)
      };
    }
  }
  return result;
}

function inventoriesMatch(source, target) {
  if (source.fileCount !== target.fileCount || source.directoryCount !== target.directoryCount || source.totalBytes !== target.totalBytes || source.treeSha256 !== target.treeSha256) return false;
  const sourceCritical = JSON.stringify(source.critical);
  const targetCritical = JSON.stringify(target.critical);
  return sourceCritical === targetCritical;
}

function readMigrationMarker(target) {
  const markerPath = path.join(target, MARKER_RELATIVE_PATH);
  if (!fs.existsSync(markerPath)) return { markerPath, state: 'ABSENT', marker: null };
  try {
    const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
    const valid = marker
      && marker.schemaVersion === 1
      && marker.migrationVersion === MIGRATION_VERSION
      && marker.status === 'PASS'
      && marker.sourceRetained === true
      && marker.inventory
      && typeof marker.inventory === 'object'
      && typeof marker.inventory.treeSha256 === 'string'
      && marker.inventory.treeSha256.length === 64;
    return { markerPath, state: valid ? 'VALID' : 'INVALID', marker: valid ? marker : null };
  } catch (_) {
    return { markerPath, state: 'INVALID', marker: null };
  }
}

function resolveExistingTarget(target, existingLegacy) {
  const markerResult = readMigrationMarker(target);
  if (!existingLegacy) {
    return Object.freeze({
      dataRoot: target,
      status: markerResult.state === 'VALID' ? 'MIGRATED_TARGET_PRESENT' : 'TARGET_PRESENT',
      migrated: false,
      fallbackToLegacy: false,
      legacyRoot: null,
      markerPath: markerResult.markerPath,
      migrationMarkerState: markerResult.state,
      requiresMigrationReview: markerResult.state === 'INVALID',
      reasonCode: markerResult.state === 'INVALID' ? 'YANCE_DATA_MIGRATION_MARKER_INVALID' : null
    });
  }

  if (markerResult.state === 'VALID' && markerResult.marker.sourceDirectoryName === path.basename(existingLegacy)) {
    const legacyInventory = inventory(existingLegacy);
    const sourceUnchangedAfterMigration = inventoriesMatch(markerResult.marker.inventory, legacyInventory);
    return Object.freeze({
      dataRoot: target,
      status: sourceUnchangedAfterMigration ? 'MIGRATED_TARGET_PRESENT' : 'MIGRATED_TARGET_LEGACY_CHANGED',
      migrated: false,
      fallbackToLegacy: false,
      legacyRoot: existingLegacy,
      markerPath: markerResult.markerPath,
      migrationMarkerState: 'VALID',
      requiresMigrationReview: !sourceUnchangedAfterMigration,
      reasonCode: sourceUnchangedAfterMigration ? null : 'YANCE_LEGACY_DATA_CHANGED_AFTER_MIGRATION',
      legacyInventory,
      migrationSourceInventory: markerResult.marker.inventory
    });
  }

  const legacyInventory = inventory(existingLegacy);
  const targetInventory = inventory(target, { excludeRelativePaths: [MARKER_RELATIVE_PATH] });
  const identical = inventoriesMatch(legacyInventory, targetInventory);
  return Object.freeze({
    dataRoot: target,
    status: identical ? 'TARGET_AND_LEGACY_IDENTICAL' : 'TARGET_AND_LEGACY_DIVERGED',
    migrated: false,
    fallbackToLegacy: false,
    legacyRoot: existingLegacy,
    markerPath: markerResult.markerPath,
    migrationMarkerState: markerResult.state,
    requiresMigrationReview: !identical,
    reasonCode: identical ? null : 'YANCE_DATA_ROOT_CONFLICT_REVIEW_REQUIRED',
    legacyInventory,
    targetInventory
  });
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temp, filePath);
}

function copyDirectory(source, target) {
  fs.cpSync(source, target, {
    recursive: true,
    force: false,
    errorOnExist: true,
    preserveTimestamps: true,
    dereference: false
  });
}

function resolveYanceDataRootSync(options = {}) {
  const rawAppDataPath = String(options.appDataPath || '').trim();
  if (!rawAppDataPath) throw new Error('appDataPath is required');
  const appDataPath = path.resolve(rawAppDataPath);
  const newDirectoryName = String(options.newDirectoryName || 'Yance').trim();
  const legacyDirectoryNames = [...new Set((options.legacyDirectoryNames || ['Yance29']).map(String).map(v => v.trim()).filter(Boolean))];
  const explicit = String(options.explicitDataRoot || process.env.YANCE_DATA_DIR || '').trim();
  if (explicit) {
    return Object.freeze({ dataRoot: path.resolve(explicit), status: 'EXPLICIT', migrated: false, fallbackToLegacy: false, legacyRoot: null, markerPath: null });
  }

  const target = path.join(appDataPath, newDirectoryName);
  const existingLegacy = legacyDirectoryNames.map(name => path.join(appDataPath, name)).find(candidate => fs.existsSync(candidate)) || null;
  if (fs.existsSync(target)) return resolveExistingTarget(target, existingLegacy);
  if (!existingLegacy) {
    return Object.freeze({ dataRoot: target, status: 'NEW_INSTALL', migrated: false, fallbackToLegacy: false, legacyRoot: null, markerPath: path.join(target, MARKER_RELATIVE_PATH) });
  }

  const temp = path.join(appDataPath, `.${newDirectoryName}.migration-${process.pid}-${Date.now()}`);
  try {
    fs.rmSync(temp, { recursive: true, force: true });
    const before = inventory(existingLegacy);
    copyDirectory(existingLegacy, temp);
    const after = inventory(temp);
    if (!inventoriesMatch(before, after)) {
      const error = new Error('Copied data inventory does not match the legacy source');
      error.reasonCode = 'YANCE_DATA_MIGRATION_INVENTORY_MISMATCH';
      error.before = before;
      error.after = after;
      throw error;
    }
    const marker = {
      schemaVersion: 1,
      migrationVersion: MIGRATION_VERSION,
      status: 'PASS',
      migratedAtUtc: new Date().toISOString(),
      sourceDirectoryName: path.basename(existingLegacy),
      targetDirectoryName: newDirectoryName,
      sourceRetained: true,
      inventory: after
    };
    writeJsonAtomic(path.join(temp, MARKER_RELATIVE_PATH), marker);
    const promoteDirectory = typeof options.promoteDirectory === 'function' ? options.promoteDirectory : fs.renameSync;
    promoteDirectory(temp, target);
    return Object.freeze({ dataRoot: target, status: 'MIGRATED', migrated: true, fallbackToLegacy: false, legacyRoot: existingLegacy, markerPath: path.join(target, MARKER_RELATIVE_PATH), inventory: after });
  } catch (error) {
    fs.rmSync(temp, { recursive: true, force: true });
    // Two concurrent first starts may both copy the retained legacy root. The
    // atomic promotion has exactly one winner. A loser must adopt and verify
    // the winner's completed target rather than falling back to the legacy
    // root and creating a split-brain write session.
    if (fs.existsSync(target)) {
      const resolved = resolveExistingTarget(target, existingLegacy);
      if (resolved.migrationMarkerState === 'VALID') {
        return Object.freeze({ ...resolved, concurrentPromotionRecovered: true });
      }
    }
    if (options.allowLegacyFallback === false) throw error;
    return Object.freeze({
      dataRoot: existingLegacy,
      status: 'MIGRATION_FAILED_LEGACY_FALLBACK',
      migrated: false,
      fallbackToLegacy: true,
      legacyRoot: existingLegacy,
      markerPath: null,
      reasonCode: error.reasonCode || 'YANCE_DATA_MIGRATION_FAILED',
      errorMessage: String(error.message || error)
    });
  }
}

module.exports = {
  MIGRATION_VERSION,
  MARKER_RELATIVE_PATH,
  CRITICAL_RELATIVE_PATHS,
  inventory,
  inventoriesMatch,
  readMigrationMarker,
  resolveExistingTarget,
  resolveYanceDataRootSync
};
