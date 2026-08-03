'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPOSITORY_ROOT = path.resolve(__dirname, '../../../..');
const FACADE_PATH = path.join(REPOSITORY_ROOT, 'backend', 'lib', 'r32SqliteStore.js');
const ENGINE_PATH = path.join(REPOSITORY_ROOT, 'backend', 'lib', 'r32SqliteStoreEngine.js');
const LEGACY_ENGINE_PATH = path.join(REPOSITORY_ROOT, 'backend', 'lib', 'r32SqliteStoreEngineLegacy.js');

function walkJavaScriptFiles(root) {
  const output = [];
  const pending = [root];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'tests' || entry.name === 'node_modules') continue;
        pending.push(absolute);
      } else if (entry.isFile() && /\.(?:c?js|mjs)$/u.test(entry.name)) {
        output.push(absolute);
      }
    }
  }
  return output.sort();
}

test('public SQLite Engine owns one version-parametric schema lifecycle', () => {
  assert.equal(fs.existsSync(LEGACY_ENGINE_PATH), true, 'internal legacy engine base must be preserved explicitly');
  const source = fs.readFileSync(ENGINE_PATH, 'utf8');

  assert.match(source, /class R32SqliteStore extends legacy\.R32SqliteStore/u);
  assert.match(source, /supportedSchemaVersion\(\)\s*\{[\s\S]*legacy\.SCHEMA_VERSION/u);
  assert.match(source, /schemaMigrationId\(\)\s*\{[\s\S]*legacy\.SCHEMA_MIGRATION_ID/u);
  assert.match(source, /schemaMigrationChecksum\(\)\s*\{[\s\S]*legacy\.SCHEMA_MIGRATION_CHECKSUM/u);
  for (const method of [
    'preflightSchemaVersion',
    'prepareSchemaMigrationBackup',
    'restoreSchemaMigrationBackup',
    'verifyRestoredSchemaVersion',
    'governSchemaVersionAfterMigration',
    'commitSchemaMigrationBackup'
  ]) {
    assert.match(source, new RegExp(`\\b${method}\\s*\\(`, 'u'), method);
  }
  assert.doesNotMatch(source, /new WriterOwnership|claimOwnership\s*\(|startOwnershipHeartbeat\s*\(|assertOwnership\s*\(/u);
});

test('Schema 23 Facade extends the public Engine without duplicating ownership or migration backup', () => {
  const source = fs.readFileSync(FACADE_PATH, 'utf8');
  assert.match(source, /class R32SqliteStore extends engine\.R32SqliteStore/u);
  assert.match(source, /supportedSchemaVersion\(\)\s*\{[\s\S]*SCHEMA_VERSION/u);
  assert.match(source, /schemaMigrationId\(\)\s*\{[\s\S]*WPB_MIGRATION_ID/u);
  assert.match(source, /schemaMigrationChecksum\(\)\s*\{[\s\S]*WPB_MIGRATION_CHECKSUM/u);
  assert.match(source, /ENGINE_PROTOTYPE\.ensureSchema\.call\(store\)/u);

  for (const forbidden of [
    'openSqliteDatabase',
    'createSqliteAdapter',
    'WriterOwnership',
    'claimOwnership',
    'startOwnershipHeartbeat',
    'assertOwnership',
    'preflightSchemaVersion',
    'prepareSchemaMigrationBackup',
    'restoreSchemaMigrationBackup',
    'verifyRestoredSchemaVersion',
    'governSchemaVersionAfterMigration',
    'commitSchemaMigrationBackup',
    'initializeStore'
  ]) {
    assert.equal(source.includes(forbidden), false, `${forbidden} must not be implemented by the Schema 23 Facade`);
  }
});

test('internal legacy Engine has exactly one production importer', () => {
  const importers = [];
  for (const absolutePath of walkJavaScriptFiles(path.join(REPOSITORY_ROOT, 'backend'))) {
    if (absolutePath === LEGACY_ENGINE_PATH) continue;
    const source = fs.readFileSync(absolutePath, 'utf8');
    if (source.includes('r32SqliteStoreEngineLegacy')) {
      importers.push(path.relative(REPOSITORY_ROOT, absolutePath).split(path.sep).join('/'));
    }
  }
  assert.deepEqual(importers, ['backend/lib/r32SqliteStoreEngine.js']);
});
