'use strict';

const path = require('node:path');

function snapshotRootError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, ...details });
}

function resolveMigrationSnapshotRoot(dbPath) {
  const value = String(dbPath || '').trim();
  if (!value) throw snapshotRootError('MIGRATION_SNAPSHOT_DB_PATH_REQUIRED', 'Migration snapshot database path is required');
  const canonicalDatabasePath = path.resolve(value);
  const databaseDirectory = path.dirname(canonicalDatabasePath);
  const filesystemRoot = path.parse(databaseDirectory).root;
  if (databaseDirectory === filesystemRoot) {
    throw snapshotRootError('MIGRATION_SNAPSHOT_ROOT_UNSAFE', 'Migration snapshot root cannot be derived from a filesystem root', { dbPath: canonicalDatabasePath });
  }
  const dataRoot = path.basename(databaseDirectory).toLowerCase() === 'store'
    ? path.dirname(databaseDirectory)
    : databaseDirectory;
  const snapshotRoot = path.join(dataRoot, 'migration-backups');
  if (path.dirname(snapshotRoot) === filesystemRoot && dataRoot === filesystemRoot) {
    throw snapshotRootError('MIGRATION_SNAPSHOT_ROOT_UNSAFE', 'Migration snapshot root resolved to a filesystem root child', { dbPath: canonicalDatabasePath, snapshotRoot });
  }
  return snapshotRoot;
}

module.exports = { resolveMigrationSnapshotRoot };
