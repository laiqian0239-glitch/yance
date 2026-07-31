'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { R32SqliteStore } = require('../lib/r32SqliteStore');
const migration = require('../migrations/round12PlatformCoreUnification');
const hardening = require('../migrations/round12Round13SelfCheckHardening');
const remainingClosure = require('../migrations/round12Round13RemainingClosure');
const finalGovernance = require('../migrations/round12Round13FinalGovernanceClosure');
const finalSeven = require('../migrations/round12Round13FinalSevenClosure');
const batch22 = require('../migrations/batch22IdentityRouteAuthority');
const batch24 = require('../migrations/batch24StateTransactionConsistency');
const batch27 = require('../migrations/batch27DeveloperHandoffV2Closure');

function withStore(callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-r12-schema-'));
  const dbPath = path.join(root, 'database', 'yance.db');
  let store;
  try {
    store = new R32SqliteStore({ dbPath });
    return callback(store, { root, dbPath });
  } finally {
    try { store?.close(); } catch (_) {}
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
}

test('round12 migration creates platform, identity, event, strategy and learning authorities', () => {
  withStore(store => {
    const tables = new Set(store.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name));
    for (const name of [
      'persons', 'identity_links', 'identity_link_audit',
      'platform_capability_observations', 'platform_health_states',
      'domain_events', 'domain_projection_receipts', 'send_policy_versions',
      'ai_director_strategies', 'ai_candidate_generation_plans',
      'learning_signal_ledger', 'learning_preference_profiles', 'learning_promotion_audit'
    ]) assert.equal(tables.has(name), true, name);

    const outboxColumns = new Set(store.db.prepare('PRAGMA table_info(ai_reply_outbox)').all().map(row => row.name));
    for (const name of ['target_language', 'final_text_sha256', 'idempotency_key', 'send_policy_version', 'capability_snapshot_id', 'approval_receipt_id', 'quality_route_receipt_json', 'learning_eligible']) {
      assert.equal(outboxColumns.has(name), true, name);
    }
    const queueColumns = new Set(store.db.prepare('PRAGMA table_info(r32_send_queue)').all().map(row => row.name));
    for (const name of ['outbox_id', 'send_policy_json', 'capability_snapshot_id', 'quality_tier', 'emergency_mode']) {
      assert.equal(queueColumns.has(name), true, name);
    }
    assert.equal(store.getMeta('schemaVersion', 0), batch27.TARGET_SCHEMA_VERSION);
    assert.equal(store.getMeta('schema_version', 0), batch27.TARGET_SCHEMA_VERSION);
    const receipt = store.db.prepare('SELECT status,target_schema_version,checksum FROM r32_schema_migrations WHERE migration_id=?').get(migration.MIGRATION_ID);
    assert.equal(receipt.status, 'completed');
    assert.equal(receipt.target_schema_version, migration.TARGET_SCHEMA_VERSION);
    assert.equal(receipt.checksum, migration.CHECKSUM);
  });
});

test('round12 migration is idempotent and older consistency checks do not downgrade schemaVersion', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-r12-reopen-'));
  const dbPath = path.join(root, 'database', 'yance.db');
  let first;
  let second;
  try {
    first = new R32SqliteStore({ dbPath });
    assert.equal(first.getMeta('schemaVersion', 0), batch27.TARGET_SCHEMA_VERSION);
    assert.equal(first.getMeta('schema_version', 0), batch27.TARGET_SCHEMA_VERSION);
    first.close(); first = null;
    second = new R32SqliteStore({ dbPath });
    assert.equal(second.getMeta('schemaVersion', 0), batch27.TARGET_SCHEMA_VERSION);
    assert.equal(second.getMeta('schema_version', 0), batch27.TARGET_SCHEMA_VERSION);
    const count = second.db.prepare('SELECT COUNT(*) AS count FROM r32_schema_migrations WHERE migration_id=?').get(migration.MIGRATION_ID).count;
    assert.equal(count, 1);
  } finally {
    try { first?.close(); } catch (_) {}
    try { second?.close(); } catch (_) {}
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});


test('schema 14 final-seven closure installs relationship Person anchors and an exact durable receipt', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-r12-schema14-'));
  const dbPath = path.join(root, 'database', 'yance.db');
  let first;
  let second;
  try {
    first = new R32SqliteStore({ dbPath });
    const receipt = first.db.prepare('SELECT status,target_schema_version,checksum FROM r32_schema_migrations WHERE migration_id=?').get(finalSeven.MIGRATION_ID);
    assert.equal(receipt.status, 'completed');
    assert.equal(receipt.target_schema_version, finalSeven.TARGET_SCHEMA_VERSION);
    assert.equal(receipt.checksum, finalSeven.CHECKSUM);
    for (const table of ['ai_reply_feedback_profiles','ai_reply_feedback_profile_versions','learning_preference_profiles']) {
      for (const suffix of ['insert','update']) {
        const name = `trg_${table}_person_anchor_${suffix}`;
        const sql = String(first.db.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?").get(name)?.sql || '');
        assert.match(sql, /scope_type='relationship'/u, name);
      }
    }
    first.close(); first = null;
    second = new R32SqliteStore({ dbPath });
    assert.equal(second.getMeta('schemaVersion', 0), batch27.TARGET_SCHEMA_VERSION);
    assert.equal(second.db.prepare('SELECT COUNT(*) AS n FROM r32_schema_migrations WHERE migration_id=?').get(finalSeven.MIGRATION_ID).n, 1);
  } finally {
    try { first?.close(); } catch (_) {}
    try { second?.close(); } catch (_) {}
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test('schema 14 consistency blocks a tampered migration receipt', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-r12-schema14-receipt-tamper-'));
  const dbPath = path.join(root, 'database', 'yance.db');
  let store;
  try {
    store = new R32SqliteStore({ dbPath });
    store.db.prepare('UPDATE r32_schema_migrations SET checksum=? WHERE migration_id=?').run('tampered', finalSeven.MIGRATION_ID);
    store.close(); store = null;
    assert.throws(() => { store = new R32SqliteStore({ dbPath }); }, error => error?.code === 'SCHEMA_14_MIGRATION_RECEIPT_INVALID');
  } finally {
    try { store?.close(); } catch (_) {}
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test('schema 14 consistency blocks a missing relationship anchor trigger', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-r12-schema14-trigger-tamper-'));
  const dbPath = path.join(root, 'database', 'yance.db');
  let store;
  try {
    store = new R32SqliteStore({ dbPath });
    store.db.exec('DROP TRIGGER trg_learning_preference_profiles_person_anchor_insert');
    store.close(); store = null;
    assert.throws(() => { store = new R32SqliteStore({ dbPath }); }, error => error?.code === 'SCHEMA_14_RELATIONSHIP_TRIGGER_MISSING');
  } finally {
    try { store?.close(); } catch (_) {}
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test('identity links are account scoped and prevent display-name based accidental collisions', () => {
  withStore(store => {
    const at = new Date().toISOString();
    store.db.prepare("INSERT INTO persons(person_id,workspace_id,display_name,created_at,updated_at) VALUES(?,?,?,?,?)").run('person-a', 'default', 'Alex', at, at);
    store.db.prepare("INSERT INTO persons(person_id,workspace_id,display_name,created_at,updated_at) VALUES(?,?,?,?,?)").run('person-b', 'default', 'Alex', at, at);
    const insert = store.db.prepare(`
      INSERT INTO identity_links(identity_link_id,workspace_id,person_id,platform,source_account_id,external_id,link_status,confidence,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?)
    `);
    insert.run('link-a', 'default', 'person-a', 'facebook', 'page-1', 'psid-1', 'verified', 1, at, at);
    insert.run('link-b', 'default', 'person-b', 'facebook', 'page-2', 'psid-1', 'verified', 1, at, at);
    assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM identity_links').get().count, 2);
    assert.throws(() => insert.run('link-c', 'default', 'person-b', 'facebook', 'page-1', 'psid-1', 'suggested', 0.5, at, at), /UNIQUE/i);
  });
});

test('emergency learning signals can be recorded but are ineligible for profile promotion', () => {
  withStore(store => {
    const at = new Date().toISOString();
    store.db.prepare(`
      INSERT INTO learning_signal_ledger(
        signal_id,idempotency_key,learning_level,scope_type,scope_id,signal_type,
        quality_tier,emergency_mode,learning_eligible,created_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?)
    `).run('signal-1', 'idem-1', 'L1', 'conversation', 'conv-1', 'candidate_used', 'emergency', 1, 0, at);
    const row = store.db.prepare('SELECT emergency_mode,learning_eligible FROM learning_signal_ledger WHERE signal_id=?').get('signal-1');
    assert.equal(row.emergency_mode, 1);
    assert.equal(row.learning_eligible, 0);
  });
});


test('schema governance reads both historical keys and refuses either key ahead of the binary', () => {
  for (const aheadKey of ['schema_version', 'schemaVersion']) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-r12-ahead-'));
    const dbPath = path.join(root, 'database', 'yance.db');
    let store;
    try {
      store = new R32SqliteStore({ dbPath });
      store.setMeta(aheadKey, batch27.TARGET_SCHEMA_VERSION + 1);
      store.close(); store = null;
      assert.throws(
        () => { store = new R32SqliteStore({ dbPath }); },
        error => error?.reasonCode === 'SCHEMA_VERSION_AHEAD' && error?.databaseVersion === batch27.TARGET_SCHEMA_VERSION + 1,
        aheadKey
      );
    } finally {
      try { store?.close(); } catch (_) {}
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  }
});

test('schema governance rejects malformed schema metadata instead of silently adopting it', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-r12-invalid-'));
  const dbPath = path.join(root, 'database', 'yance.db');
  let store;
  try {
    store = new R32SqliteStore({ dbPath });
    store.db.prepare("UPDATE r32_meta SET value_json=? WHERE key='schemaVersion'").run('"not-a-version"');
    store.close(); store = null;
    assert.throws(
      () => { store = new R32SqliteStore({ dbPath }); },
      error => error?.reasonCode === 'SCHEMA_VERSION_INVALID'
    );
  } finally {
    try { store?.close(); } catch (_) {}
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});


test('schema 11 hardening installs an external-event uniqueness index and exact migration receipt', () => {
  withStore(store => {
    const index = store.db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND name=?").get(hardening.REQUIRED_INDEX);
    assert.match(String(index?.sql || ''), /CREATE UNIQUE INDEX/i);
    assert.match(String(index?.sql || ''), /external_event_id/i);
    const receipt = store.db.prepare('SELECT status,target_schema_version,checksum FROM r32_schema_migrations WHERE migration_id=?').get(hardening.MIGRATION_ID);
    assert.equal(receipt.status, 'completed');
    assert.equal(receipt.target_schema_version, hardening.TARGET_SCHEMA_VERSION);
    assert.equal(receipt.checksum, hardening.CHECKSUM);
  });
});



test('schema 12 remaining closure admits pending L3 governance states and installs an exact receipt', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-r12-schema12-'));
  const dbPath = path.join(root, 'database', 'yance.db');
  let first;
  let second;
  try {
    first = new R32SqliteStore({ dbPath });
    assert.equal(first.getMeta('schemaVersion', 0), batch27.TARGET_SCHEMA_VERSION);
    assert.equal(first.getMeta('schema_version', 0), batch27.TARGET_SCHEMA_VERSION);

    const profileSql = String(first.db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='learning_preference_profiles'").get()?.sql || '');
    const auditSql = String(first.db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='learning_promotion_audit'").get()?.sql || '');
    assert.match(profileSql, /pending-approval/);
    assert.match(auditSql, /pending-human-approval/);

    const at = new Date().toISOString();
    first.db.prepare(`
      INSERT INTO learning_preference_profiles(
        scope_type,scope_id,learning_level,version,preference_json,evidence_signal_ids_json,
        confidence,state,created_at,activated_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?)
    `).run('persona', 'owner', 'L3', 1, '{}', '[]', 0.9, 'pending-approval', at, '');
    first.db.prepare(`
      INSERT INTO learning_promotion_audit(
        promotion_id,from_level,to_level,source_scope_type,source_scope_id,target_scope_type,target_scope_id,
        source_versions_json,sample_count,confidence,decision,reason,rollback_version,actor,created_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run('promotion-pending', 'L2', 'L3', 'contact', 'contact-1', 'persona', 'owner', '[]', 25, 0.9,
      'pending-human-approval', 'AWAITING_HUMAN_APPROVAL', 0, 'system', at);

    const receipt = first.db.prepare('SELECT status,target_schema_version,checksum FROM r32_schema_migrations WHERE migration_id=?').get(remainingClosure.MIGRATION_ID);
    assert.equal(receipt.status, 'completed');
    assert.equal(receipt.target_schema_version, remainingClosure.TARGET_SCHEMA_VERSION);
    assert.equal(receipt.checksum, remainingClosure.CHECKSUM);

    first.close(); first = null;
    second = new R32SqliteStore({ dbPath });
    assert.equal(second.getMeta('schemaVersion', 0), batch27.TARGET_SCHEMA_VERSION);
    assert.equal(second.db.prepare('SELECT COUNT(*) AS count FROM r32_schema_migrations WHERE migration_id=?').get(remainingClosure.MIGRATION_ID).count, 1);
    assert.equal(second.db.prepare("SELECT state FROM learning_preference_profiles WHERE scope_type='persona' AND scope_id='owner' AND learning_level='L3' AND version=1").get().state, 'pending-approval');
  } finally {
    try { first?.close(); } catch (_) {}
    try { second?.close(); } catch (_) {}
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test('schema 12 consistency blocks a tampered migration receipt', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-r12-schema12-tamper-'));
  const dbPath = path.join(root, 'database', 'yance.db');
  let store;
  try {
    store = new R32SqliteStore({ dbPath });
    store.db.prepare('UPDATE r32_schema_migrations SET checksum=? WHERE migration_id=?').run('tampered', remainingClosure.MIGRATION_ID);
    store.close(); store = null;
    assert.throws(
      () => { store = new R32SqliteStore({ dbPath }); },
      error => error?.code === 'SCHEMA_12_MIGRATION_RECEIPT_INVALID'
    );
  } finally {
    try { store?.close(); } catch (_) {}
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test('schema 11 consistency blocks a tampered migration receipt', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-r13-receipt-tamper-'));
  const dbPath = path.join(root, 'database', 'yance.db');
  let store;
  try {
    store = new R32SqliteStore({ dbPath });
    store.db.prepare('UPDATE r32_schema_migrations SET checksum=? WHERE migration_id=?').run('tampered', hardening.MIGRATION_ID);
    store.close(); store = null;
    assert.throws(() => { store = new R32SqliteStore({ dbPath }); }, error => error?.code === 'SCHEMA_11_MIGRATION_RECEIPT_INVALID');
  } finally {
    try { store?.close(); } catch (_) {}
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test('schema 11 consistency blocks a missing external-event unique index', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-r13-index-tamper-'));
  const dbPath = path.join(root, 'database', 'yance.db');
  let store;
  try {
    store = new R32SqliteStore({ dbPath });
    store.db.exec(`DROP INDEX ${hardening.REQUIRED_INDEX}`);
    store.close(); store = null;
    assert.throws(() => { store = new R32SqliteStore({ dbPath }); }, error => error?.code === 'SCHEMA_11_EXTERNAL_EVENT_INDEX_INVALID');
  } finally {
    try { store?.close(); } catch (_) {}
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test('schema 11 migration refuses pre-existing duplicate platform external events without deleting evidence', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-r13-duplicate-event-'));
  const dbPath = path.join(root, 'database', 'yance.db');
  let store;
  try {
    store = new R32SqliteStore({ dbPath });
    store.db.exec(`DROP INDEX ${hardening.REQUIRED_INDEX}`);
    store.db.prepare('DELETE FROM r32_schema_migrations WHERE migration_id=?').run(hardening.MIGRATION_ID);
    store.setMeta('schema_version', migration.TARGET_SCHEMA_VERSION);
    store.setMeta('schemaVersion', migration.TARGET_SCHEMA_VERSION);
    const at = new Date().toISOString();
    const insert = store.db.prepare(`
      INSERT INTO domain_events(event_id,schema_version,platform,source_account_id,external_event_id,event_type,idempotency_key,occurred_at,received_at,payload_json,payload_sha256,retention_until,replay_state)
      VALUES(?,1,'facebook','page-1','meta-1','message.received',?,?,?,'{}',?,?,'available')
    `);
    insert.run('e-1', 'idem-1', at, at, 'hash-a', new Date(Date.now() + 86400000).toISOString());
    insert.run('e-2', 'idem-2', at, at, 'hash-b', new Date(Date.now() + 86400000).toISOString());
    store.close(); store = null;
    assert.throws(
      () => { store = new R32SqliteStore({ dbPath }); },
      error => error?.code === 'DOMAIN_EVENT_EXTERNAL_DUPLICATE_REQUIRES_REPAIR' && Array.isArray(error?.duplicates) && error.duplicates.length === 1
    );
  } finally {
    try { store?.close(); } catch (_) {}
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});
