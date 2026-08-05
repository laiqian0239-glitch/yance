'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const MIGRATION_ID = '023_oss1a_whatsapp_auth_state';
const TARGET_SCHEMA_VERSION = 23;
const AUTH_TABLES = Object.freeze([
  'whatsapp_auth_accounts',
  'whatsapp_auth_keys',
  'whatsapp_auth_import_receipts',
  'whatsapp_message_retry_counters',
  'whatsapp_message_key_index',
  'whatsapp_message_retry_payloads'
]);

let registered = false;

function loadMigration() {
  try {
    return require('../migrations/oss1aWhatsappAuthState');
  } catch (error) {
    assert.fail(`Schema 23 migration module must exist: ${error.code || error.message}`);
  }
}

function createSchema22Fixture(options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-oss1a-schema22-fixture-'));
  const dbPath = path.join(root, 'yance.db');
  const db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = FULL;

    CREATE TABLE r32_meta(
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE r32_schema_migrations(
      migration_id TEXT PRIMARY KEY,
      target_schema_version INTEGER NOT NULL,
      status TEXT NOT NULL,
      checksum TEXT NOT NULL DEFAULT '',
      started_at TEXT NOT NULL,
      completed_at TEXT NOT NULL DEFAULT '',
      report_json TEXT NOT NULL DEFAULT '{}'
    ) STRICT;

    CREATE TABLE r32_accounts(
      id TEXT PRIMARY KEY
    ) STRICT;
  `);
  if (options.withCanonicalMessages !== false) {
    db.exec(`CREATE TABLE communication_canonical_messages(
      message_id TEXT PRIMARY KEY
    ) STRICT;`);
  }
  const at = new Date().toISOString();
  const setMeta = db.prepare('INSERT INTO r32_meta(key,value_json,updated_at) VALUES(?,?,?)');
  const version = Number(options.schemaVersion ?? 22);
  setMeta.run('schema_version', JSON.stringify(version), at);
  setMeta.run('schemaVersion', JSON.stringify(version), at);
  return {
    root,
    dbPath,
    db,
    close() {
      try { db.close(); } catch (_) {}
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  };
}

function currentSchemaVersion(db) {
  const rows = db.prepare("SELECT value_json FROM r32_meta WHERE key IN ('schema_version','schemaVersion')").all();
  return Math.max(...rows.map(row => Number(JSON.parse(row.value_json))));
}

function userTables(db) {
  return new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()
    .map(row => String(row.name)));
}

function migrationReceipt(db) {
  return db.prepare('SELECT * FROM r32_schema_migrations WHERE migration_id=?').get(MIGRATION_ID) || null;
}

function withFixture(options, callback) {
  const fixture = createSchema22Fixture(options);
  try {
    return callback(fixture.db, fixture);
  } finally {
    fixture.close();
  }
}

function registerFaultMatrix() {
  if (registered) return;
  registered = true;

  test('Schema 23 migration exports the frozen identity and cryptographic checksum', () => {
    const migration = loadMigration();
    assert.equal(migration.MIGRATION_ID, MIGRATION_ID);
    assert.equal(migration.TARGET_SCHEMA_VERSION, TARGET_SCHEMA_VERSION);
    assert.match(String(migration.MIGRATION_CHECKSUM || ''), /^[a-f0-9]{64}$/u);
    assert.equal(typeof migration.applyOss1aWhatsappAuthState, 'function');
    assert.equal(typeof migration.ensureConsistency, 'function');
  });

  test('Schema 23 migration rolls back objects, receipt and metadata at every injected fault point', () => {
    const migration = loadMigration();
    for (const point of [
      'AFTER_RECEIPT_RUNNING',
      'AFTER_OBJECTS',
      'AFTER_CONSISTENCY',
      'BEFORE_SCHEMA_VERSION',
      'BEFORE_RECEIPT_COMPLETED'
    ]) {
      withFixture({}, db => {
        assert.throws(
          () => migration.applyOss1aWhatsappAuthState(db, { testFaultAt: point }),
          error => error?.code === 'OSS1A_WHATSAPP_AUTH_TEST_FAULT' && error?.faultPoint === point,
          point
        );
        assert.equal(currentSchemaVersion(db), 22, `${point} schema version`);
        assert.equal(migrationReceipt(db), null, `${point} receipt rollback`);
        const tables = userTables(db);
        for (const table of AUTH_TABLES) assert.equal(tables.has(table), false, `${point}:${table}`);
      });
    }
  });

  test('Schema 23 migration fails closed when a required canonical base table is missing', () => {
    const migration = loadMigration();
    withFixture({ withCanonicalMessages: false }, db => {
      assert.throws(
        () => migration.applyOss1aWhatsappAuthState(db),
        error => error?.code === 'OSS1A_WHATSAPP_AUTH_BASE_TABLE_MISSING'
          && error?.table === 'communication_canonical_messages'
      );
      assert.equal(currentSchemaVersion(db), 22);
      assert.equal(migrationReceipt(db), null);
      for (const table of AUTH_TABLES) assert.equal(userTables(db).has(table), false, table);
    });
  });

  test('Schema 23 migration is idempotent and writes both version keys only after consistency succeeds', () => {
    const migration = loadMigration();
    withFixture({}, db => {
      const first = migration.applyOss1aWhatsappAuthState(db);
      const second = migration.applyOss1aWhatsappAuthState(db);
      assert.equal(first.executed, true);
      assert.equal(second.executed, false);
      assert.equal(currentSchemaVersion(db), 23);
      assert.equal(Number(db.prepare('SELECT COUNT(*) AS count FROM r32_schema_migrations WHERE migration_id=?').get(MIGRATION_ID).count), 1);
      const receipt = migrationReceipt(db);
      assert.equal(receipt.status, 'completed');
      assert.equal(receipt.target_schema_version, 23);
      assert.equal(receipt.checksum, migration.MIGRATION_CHECKSUM);
      for (const table of AUTH_TABLES) assert.equal(userTables(db).has(table), true, table);
    });
  });

  test('Schema 23 migration rejects checksum tampering and incomplete receipts', () => {
    const migration = loadMigration();
    for (const mutation of [
      { sql: "UPDATE r32_schema_migrations SET checksum='tampered' WHERE migration_id=?", code: 'OSS1A_WHATSAPP_AUTH_MIGRATION_CHECKSUM_MISMATCH' },
      { sql: "UPDATE r32_schema_migrations SET status='running' WHERE migration_id=?", code: 'OSS1A_WHATSAPP_AUTH_MIGRATION_INCOMPLETE' }
    ]) {
      withFixture({}, db => {
        migration.applyOss1aWhatsappAuthState(db);
        db.prepare(mutation.sql).run(MIGRATION_ID);
        assert.throws(
          () => migration.applyOss1aWhatsappAuthState(db),
          error => error?.code === mutation.code
        );
      });
    }
  });

  test('Schema 23 migration revalidates completed objects and rejects a missing frozen index', () => {
    const migration = loadMigration();
    withFixture({}, db => {
      migration.applyOss1aWhatsappAuthState(db);
      db.exec('DROP INDEX idx_whatsapp_message_key_index_canonical');
      assert.throws(
        () => migration.applyOss1aWhatsappAuthState(db),
        error => error?.code === 'OSS1A_WHATSAPP_AUTH_INDEX_MISSING'
          && error?.index === 'idx_whatsapp_message_key_index_canonical'
      );
      assert.equal(currentSchemaVersion(db), 23);
    });
  });

  test('Schema 23 migration refuses to run over metadata newer than this binary', () => {
    const migration = loadMigration();
    withFixture({ schemaVersion: 24 }, db => {
      assert.throws(
        () => migration.applyOss1aWhatsappAuthState(db),
        error => error?.code === 'OSS1A_WHATSAPP_AUTH_SCHEMA_AHEAD'
          && error?.databaseVersion === 24
          && error?.supportedVersion === 23
      );
      assert.equal(currentSchemaVersion(db), 24);
      assert.equal(migrationReceipt(db), null);
    });
  });
}

registerFaultMatrix();

module.exports = {
  MIGRATION_ID,
  TARGET_SCHEMA_VERSION,
  AUTH_TABLES,
  createSchema22Fixture,
  registerFaultMatrix
};
