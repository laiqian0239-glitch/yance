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

test('public SQLite Engine owns one version-parametric startup lifecycle', () => {
  assert.equal(fs.existsSync(LEGACY_ENGINE_PATH), true, 'internal legacy operation base must be preserved explicitly');
  const source = fs.readFileSync(ENGINE_PATH, 'utf8');

  assert.match(source, /const legacy = require\('\.\/r32SqliteStoreEngineLegacy'\)/u);
  assert.match(source, /function R32SqliteStore\(options = \{\}\)/u);
  assert.match(source, /R32SqliteStore\.prototype = Object\.create\(LEGACY_ENGINE_PROTOTYPE\)/u);
  assert.match(source, /const targetSchemaVersion = supportedSchemaVersion\(store\)/u);
  assert.match(source, /schemaVersion: targetSchemaVersion/u);
  assert.doesNotMatch(source, /schemaVersion: SCHEMA_VERSION/u);

  for (const method of [
    'supportedSchemaVersion',
    'preflightSchemaVersion',
    'prepareSchemaMigrationBackup',
    'governSchemaVersion',
    'commitSchemaMigrationReceipt',
    'restoreMigrationBackup',
    'initializeStore'
  ]) {
    assert.match(source, new RegExp(`\\b${method}\\s*\\(`, 'u'), method);
  }
  for (const authority of [
    'acquireAuthorityWriteHost',
    'claimOwnership',
    'SqliteTransactionCoordinator',
    'startOwnershipHeartbeat'
  ]) {
    assert.equal(source.includes(authority), true, `${authority} must be owned by the public Engine startup pipeline`);
  }
});

test('Schema 23 Facade declares only version and additive migration', () => {
  const source = fs.readFileSync(FACADE_PATH, 'utf8');
  assert.match(source, /return engine\.R32SqliteStore\.call\(this, options\)/u);
  assert.match(source, /R32SqliteStore\.prototype = Object\.create\(ENGINE_PROTOTYPE\)/u);
  assert.match(source, /supportedSchemaVersion\(\)\s*\{[\s\S]*return SCHEMA_VERSION/u);
  assert.match(source, /ENGINE_PROTOTYPE\.ensureSchema\.call\(store\)/u);
  assert.match(source, /requireSchema23StartupRegistration\(\)/u);
  assert.match(source, /applyArchitectureClosureV2WpB\(store\.db/u);
  assert.match(source, /ensureCanonicalProjectionReceiptSchema\(store\.db\)/u);

  for (const forbidden of [
    'DatabaseSync',
    'createCompactSnapshotTarget',
    'acquireAuthorityWriteHost',
    'requireAuthorityWriteHostCapability',
    'claimOwnership',
    'SqliteTransactionCoordinator',
    'startOwnershipHeartbeat',
    'assertOwnership',
    'preflightSchemaVersion',
    'prepareSchemaMigrationBackup',
    'restoreMigrationBackup',
    'governSchemaVersion',
    'commitSchemaMigrationReceipt',
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
    if (source.includes("require('./r32SqliteStoreEngineLegacy')")) {
      importers.push(path.relative(REPOSITORY_ROOT, absolutePath).split(path.sep).join('/'));
    }
  }
  assert.deepEqual(importers, ['backend/lib/r32SqliteStoreEngine.js']);
});
