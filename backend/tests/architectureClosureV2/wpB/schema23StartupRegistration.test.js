'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { removePathWithRetries } = require('../../../../tests/test-support/windows-cleanup');
const {
  requireSchema23StartupRegistration
} = require('../../../../shared/release/wpBM1RedEvidenceAuthority');

const STORE_PATH = require.resolve('../../../lib/r32SqliteStore');
const STORE_ENGINE_PATH = require.resolve('../../../lib/r32SqliteStoreEngine');
const REPOSITORY_ROOT = path.resolve(__dirname, '../../../..');
const WORKFLOW_PATH = path.join(REPOSITORY_ROOT, '.github', 'workflows', 'wp-b-validation.yml');
const HISTORICAL_RED_PATH = path.join(
  REPOSITORY_ROOT,
  'governance',
  'architecture-closure-v2',
  'wp-b-m1-red-evidence.json'
);

function withStore(work) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-wp-b-startup-v23-'));
  const dbPath = path.join(root, 'yance-r32.db');
  let store = null;
  try {
    const { R32SqliteStore } = require(STORE_PATH);
    store = new R32SqliteStore({
      dbPath,
      ownershipPid: 9876,
      ownershipPidAlive: pid => pid === 9876
    });
    return work(store);
  } finally {
    try { store?.close(); } catch (_) {}
    removePathWithRetries(root);
  }
}

test('immutable RED authority explicitly permits Schema 23 startup registration', () => {
  const report = requireSchema23StartupRegistration();
  assert.equal(report.ok, true, JSON.stringify(report.violations, null, 2));
  assert.equal(report.schema23StartupRegistrationAuthorized, true);
});

test('R32SqliteStore registers Schema 23 in the one startup migration chain', () => {
  delete require.cache[STORE_PATH];
  const { SCHEMA_VERSION } = require(STORE_PATH);
  assert.equal(SCHEMA_VERSION, 23);

  withStore(store => {
    assert.equal(store.getMeta('schema_version', null), 23);
    assert.equal(store.getMeta('schemaVersion', null), 23);
    const migration = store.db.prepare(`SELECT migration_id,target_schema_version,status,checksum
      FROM r32_schema_migrations WHERE migration_id='023_architecture_closure_v2_wp_b'`).get();
    assert.equal(migration.migration_id, '023_architecture_closure_v2_wp_b');
    assert.equal(migration.target_schema_version, 23);
    assert.equal(migration.status, 'completed');
    assert.match(migration.checksum, /^[a-f0-9]{64}$/u);
    for (const table of [
      'external_action_intents',
      'external_action_claims',
      'external_action_attempts',
      'external_action_receipts',
      'external_outcome_reconciliations',
      'durable_execution_checkpoints'
    ]) {
      assert.equal(Boolean(store.db.prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?"
      ).get(table)), true, table);
    }
    assert.deepEqual(store.db.prepare('PRAGMA foreign_key_check').all(), []);
  });
});

test('startup assembly verifies RED evidence after the Engine WP-A chain and before WP-B', () => {
  const source = fs.readFileSync(STORE_PATH, 'utf8');
  const engineSource = fs.readFileSync(STORE_ENGINE_PATH, 'utf8');
  const engineCall = source.indexOf('ENGINE_PROTOTYPE.ensureSchema.call(store)');
  const evidenceImport = source.indexOf('requireSchema23StartupRegistration');
  const wpBImport = source.indexOf('applyArchitectureClosureV2WpB');
  const evidenceCall = source.lastIndexOf('requireSchema23StartupRegistration(');
  const wpBCall = source.indexOf('applyArchitectureClosureV2WpB(store.db');
  const projectionCall = source.indexOf('ensureCanonicalProjectionReceiptSchema(store.db)');
  const wpACall = engineSource.indexOf('applyArchitectureClosureV2WpA(this.db)');
  const engineProjectionCall = engineSource.indexOf('ensureCanonicalProjectionReceiptSchema(this.db)');

  assert.ok(evidenceImport >= 0, 'RED authority import missing');
  assert.ok(wpBImport >= 0, 'Schema 23 migration import missing');
  assert.ok(wpACall >= 0, 'Engine Schema 22 call missing');
  assert.ok(engineProjectionCall > wpACall, 'Engine projection finalization must follow Schema 22');
  assert.ok(engineCall >= 0, 'Engine startup chain call missing');
  assert.ok(evidenceCall > engineCall, 'RED authority must be checked after the Engine WP-A chain');
  assert.ok(wpBCall > evidenceCall, 'Schema 23 must run only after RED authority');
  assert.ok(projectionCall > wpBCall, 'projection schema finalization must run after Schema 23');
  assert.match(source.slice(wpBCall, projectionCall), /at:\s*nowIso\(\)/u);
});

test('current WP-B validation truth records Schema 23 applied without rewriting historical RED evidence', () => {
  const workflow = fs.readFileSync(WORKFLOW_PATH, 'utf8');
  const historicalRed = JSON.parse(fs.readFileSync(HISTORICAL_RED_PATH, 'utf8'));

  assert.equal(
    historicalRed.governance.schema23AppliedToProductionStartup,
    false,
    'historical RED evidence must remain immutable'
  );
  assert.match(workflow, /echo '- schema23Applied=true'/u);
  assert.doesNotMatch(workflow, /echo '- schema23Applied=false'/u);
  assert.match(workflow, /echo '- thirdPartyProductionUseAuthorized=false'/u);
  assert.match(workflow, /echo '- wpCAuthorized=false'/u);
  assert.match(workflow, /echo '- formalRelease=false'/u);
  assert.match(workflow, /echo '- publish=false'/u);
});
