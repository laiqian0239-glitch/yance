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

test('startup source verifies RED evidence before applying WP-B and preserves migration order', () => {
  const source = fs.readFileSync(STORE_PATH, 'utf8');
  const evidenceImport = source.indexOf('requireSchema23StartupRegistration');
  const wpBImport = source.indexOf('applyArchitectureClosureV2WpB');
  const wpACall = source.indexOf('applyArchitectureClosureV2WpA(this.db)');
  const evidenceCall = source.indexOf('requireSchema23StartupRegistration(');
  const wpBCall = source.indexOf('applyArchitectureClosureV2WpB(this.db');
  const projectionCall = source.indexOf('ensureCanonicalProjectionReceiptSchema(this.db)');

  assert.ok(evidenceImport >= 0, 'RED authority import missing');
  assert.ok(wpBImport >= 0, 'Schema 23 migration import missing');
  assert.ok(wpACall >= 0, 'Schema 22 call missing');
  assert.ok(evidenceCall > wpACall, 'RED authority must be checked after Schema 22');
  assert.ok(wpBCall > evidenceCall, 'Schema 23 must run only after RED authority');
  assert.ok(projectionCall > wpBCall, 'projection schema finalization must remain after Schema 23');
  assert.match(source.slice(wpBCall, projectionCall), /at:\s*nowIso\(\)/u);
});
