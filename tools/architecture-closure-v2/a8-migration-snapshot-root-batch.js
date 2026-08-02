'use strict';

const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
function absolute(relativePath) { return path.join(repoRoot, relativePath); }
function read(relativePath) { return fs.readFileSync(absolute(relativePath), 'utf8'); }
function write(relativePath, content) {
  fs.mkdirSync(path.dirname(absolute(relativePath)), { recursive: true });
  fs.writeFileSync(absolute(relativePath), content, 'utf8');
}
function replaceExactlyOnce(relativePath, before, after) {
  const source = read(relativePath);
  const first = source.indexOf(before);
  const second = first < 0 ? -1 : source.indexOf(before, first + before.length);
  if (first < 0 || second >= 0) throw new Error(`${relativePath}: replacement target count must be exactly one`);
  write(relativePath, source.slice(0, first) + after + source.slice(first + before.length));
}

const helperPath = 'backend/migrations/migrationSnapshotRoot.js';
if (fs.existsSync(absolute(helperPath))) throw new Error(`${helperPath} already exists`);
write(helperPath, `'use strict';\n\nconst path = require('node:path');\n\nfunction snapshotRootError(code, message, details = {}) {\n  return Object.assign(new Error(message), { code, ...details });\n}\n\nfunction resolveMigrationSnapshotRoot(dbPath) {\n  const value = String(dbPath || '').trim();\n  if (!value) throw snapshotRootError('MIGRATION_SNAPSHOT_DB_PATH_REQUIRED', 'Migration snapshot database path is required');\n  const canonicalDatabasePath = path.resolve(value);\n  const databaseDirectory = path.dirname(canonicalDatabasePath);\n  const filesystemRoot = path.parse(databaseDirectory).root;\n  if (databaseDirectory === filesystemRoot) {\n    throw snapshotRootError('MIGRATION_SNAPSHOT_ROOT_UNSAFE', 'Migration snapshot root cannot be derived from a filesystem root', { dbPath: canonicalDatabasePath });\n  }\n  const dataRoot = path.basename(databaseDirectory).toLowerCase() === 'store'\n    ? path.dirname(databaseDirectory)\n    : databaseDirectory;\n  const snapshotRoot = path.join(dataRoot, 'migration-backups');\n  if (path.dirname(snapshotRoot) === filesystemRoot && dataRoot === filesystemRoot) {\n    throw snapshotRootError('MIGRATION_SNAPSHOT_ROOT_UNSAFE', 'Migration snapshot root resolved to a filesystem root child', { dbPath: canonicalDatabasePath, snapshotRoot });\n  }\n  return snapshotRoot;\n}\n\nmodule.exports = { resolveMigrationSnapshotRoot };\n`);

const migrations = [
  {
    path: 'backend/migrations/stage6_3_4ArchitectureClosure.js',
    importBefore: "const { createVerifiedSnapshot } = require('./migrationSnapshotManifest');\n",
    importAfter: "const { createVerifiedSnapshot } = require('./migrationSnapshotManifest');\nconst { resolveMigrationSnapshotRoot } = require('./migrationSnapshotRoot');\n"
  },
  {
    path: 'backend/migrations/round12PlatformCoreUnification.js',
    importBefore: "const { createCompactSnapshotTarget } = require('./migrationSnapshotManifest');\n",
    importAfter: "const { createCompactSnapshotTarget } = require('./migrationSnapshotManifest');\nconst { resolveMigrationSnapshotRoot } = require('./migrationSnapshotRoot');\n"
  },
  {
    path: 'backend/migrations/round12Round13SelfCheckHardening.js',
    importBefore: "const { createCompactSnapshotTarget } = require('./migrationSnapshotManifest');\n",
    importAfter: "const { createCompactSnapshotTarget } = require('./migrationSnapshotManifest');\nconst { resolveMigrationSnapshotRoot } = require('./migrationSnapshotRoot');\n"
  }
];
for (const migration of migrations) {
  replaceExactlyOnce(migration.path, migration.importBefore, migration.importAfter);
  replaceExactlyOnce(
    migration.path,
    "  const root = path.join(path.dirname(path.dirname(dbPath)), 'migration-backups');\n",
    "  const root = resolveMigrationSnapshotRoot(dbPath);\n"
  );
}

for (const migration of migrations) {
  const source = read(migration.path);
  if (!source.includes("resolveMigrationSnapshotRoot(dbPath)")) throw new Error(`${migration.path}: shared snapshot root authority missing`);
  if (source.includes("path.dirname(path.dirname(dbPath))")) throw new Error(`${migration.path}: unsafe duplicated root derivation remains`);
}

console.log(JSON.stringify({
  ok: true,
  helper: helperPath,
  changedFiles: [helperPath, ...migrations.map(row => row.path)],
  invariant: 'all migration snapshots resolve through one fail-closed portable root authority'
}, null, 2));
