'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createCompactSnapshotTarget } = require('./migrationSnapshotManifest');

const MIGRATION_ID = '011_round12_round13_selfcheck_hardening';
const TARGET_SCHEMA_VERSION = 11;
const CHECKSUM = 'round12-round13-selfcheck-hardening-v1';
const REQUIRED_INDEX = 'idx_domain_events_external_unique';

function now() { return new Date().toISOString(); }
function error(code, message, details = {}) { return Object.assign(new Error(message), { code, ...details }); }
function ensureMigrationTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS r32_schema_migrations (
      migration_id TEXT PRIMARY KEY,
      target_schema_version INTEGER NOT NULL,
      status TEXT NOT NULL,
      checksum TEXT NOT NULL DEFAULT '',
      started_at TEXT NOT NULL,
      completed_at TEXT NOT NULL DEFAULT '',
      report_json TEXT NOT NULL DEFAULT '{}'
    ) STRICT;
  `);
}
function schemaVersion(db) {
  const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='r32_meta'").get();
  if (!table) return 0;
  const rows = db.prepare("SELECT key, value_json FROM r32_meta WHERE key IN ('schema_version','schemaVersion')").all();
  const versions = [];
  for (const row of rows) {
    let parsed;
    try { parsed = JSON.parse(row.value_json); } catch (_) { parsed = row.value_json; }
    const value = Number(parsed);
    if (!Number.isInteger(value) || value < 0) {
      throw error('SCHEMA_VERSION_INVALID', `Database schema metadata ${row.key} is invalid`, { key: row.key, value: row.value_json });
    }
    versions.push(value);
  }
  return versions.length ? Math.max(...versions) : 0;
}
function setSchemaVersion(db, value, timestamp = now()) {
  const version = JSON.stringify(Number(value));
  const upsert = db.prepare(`
    INSERT INTO r32_meta(key, value_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_at=excluded.updated_at
  `);
  upsert.run('schema_version', version, timestamp);
  upsert.run('schemaVersion', version, timestamp);
}
function createSnapshot(db) {
  let dbPath = '';
  try { dbPath = db.prepare('PRAGMA database_list').all().find(row => row.name === 'main')?.file || ''; } catch (_) {}
  if (!dbPath || dbPath === ':memory:' || !fs.existsSync(dbPath)) return { created: false, reason: 'non-file-database' };
  try { db.exec('PRAGMA wal_checkpoint(FULL)'); } catch (_) {}
  const root = path.join(path.dirname(path.dirname(dbPath)), 'migration-backups');
  fs.mkdirSync(root, { recursive: true });
  // Different databases may migrate in parallel while sharing the same
  // migration-backups parent (for example isolated test roots below /tmp).
  // Timestamp-only names can collide within the same millisecond and make one
  // VACUUM INTO open another database's snapshot. Bind every snapshot to the
  // process and a cryptographically unique generation.
  const generation = crypto.randomUUID();
  const { targetPath: target } = createCompactSnapshotTarget({
    root, dbPath, migrationId: MIGRATION_ID, processGeneration: generation, extension: 'sqlite'
  });
  db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  const stat = fs.statSync(target);
  if (!stat.isFile() || stat.size <= 0) throw error('SELF_CHECK_MIGRATION_SNAPSHOT_FAILED', 'Schema 11 migration snapshot is empty');
  return {
    created: true,
    path: target,
    bytes: stat.size,
    sha256: crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex'),
    createdAt: now()
  };
}
function externalEventDuplicates(db) {
  return db.prepare(`
    SELECT platform, source_account_id, event_type, external_event_id,
           COUNT(*) AS duplicate_count,
           GROUP_CONCAT(event_id, ',') AS event_ids,
           COUNT(DISTINCT payload_sha256) AS payload_variants
    FROM domain_events
    WHERE external_event_id <> ''
    GROUP BY platform, source_account_id, event_type, external_event_id
    HAVING COUNT(*) > 1
    ORDER BY duplicate_count DESC, platform, source_account_id, event_type, external_event_id
    LIMIT 50
  `).all();
}
function ensurePostMigrationConsistency(db) {
  const duplicates = externalEventDuplicates(db);
  if (duplicates.length) {
    throw error('DOMAIN_EVENT_EXTERNAL_DUPLICATE_REQUIRES_REPAIR', 'Duplicate platform external events prevent safe Schema 11 activation', { duplicates });
  }
  const index = db.prepare("SELECT name, sql FROM sqlite_master WHERE type='index' AND name=?").get(REQUIRED_INDEX);
  const normalizedSql = String(index?.sql || '').replace(/\s+/g, ' ').toLowerCase();
  for (const token of ['create unique index', 'domain_events', 'platform', 'source_account_id', 'event_type', 'external_event_id', "where external_event_id <> ''"]) {
    if (!normalizedSql.includes(token)) throw error('SCHEMA_11_EXTERNAL_EVENT_INDEX_INVALID', `Schema 11 index ${REQUIRED_INDEX} is missing or malformed`, { sql: index?.sql || '' });
  }
  const version = schemaVersion(db);
  if (version < TARGET_SCHEMA_VERSION) {
    throw error('SCHEMA_11_VERSION_INCOMPLETE', `Schema version ${version} is below ${TARGET_SCHEMA_VERSION}`,
      { actual: version, minimum: TARGET_SCHEMA_VERSION });
  }
  const receipt = db.prepare('SELECT target_schema_version,status,checksum FROM r32_schema_migrations WHERE migration_id=?').get(MIGRATION_ID);
  if (!receipt || receipt.status !== 'completed'
    || Number(receipt.target_schema_version || 0) !== TARGET_SCHEMA_VERSION
    || String(receipt.checksum || '') !== CHECKSUM) {
    throw error('SCHEMA_11_MIGRATION_RECEIPT_INVALID', 'Schema 11 migration receipt is missing or has been tampered with', {
      receipt: receipt || null,
      expectedVersion: TARGET_SCHEMA_VERSION,
      expectedChecksum: CHECKSUM
    });
  }
  const foreignKeys = Number(db.prepare('PRAGMA foreign_keys').get()?.foreign_keys || 0);
  if (foreignKeys !== 1) throw error('SCHEMA_11_FOREIGN_KEYS_DISABLED', 'SQLite foreign key enforcement is disabled');
  return { ok: true, schemaVersion: version, migrationId: MIGRATION_ID, checksum: CHECKSUM, requiredIndex: REQUIRED_INDEX, checkedAt: now() };
}
function applyRound12Round13SelfCheckHardening(db) {
  ensureMigrationTable(db);
  const completed = db.prepare("SELECT target_schema_version,status,checksum FROM r32_schema_migrations WHERE migration_id=? AND status='completed'").get(MIGRATION_ID);
  if (completed) {
    return { ok: true, executed: false, migrationId: MIGRATION_ID, schemaVersion: TARGET_SCHEMA_VERSION, consistency: ensurePostMigrationConsistency(db) };
  }

  const duplicates = externalEventDuplicates(db);
  if (duplicates.length) {
    throw error('DOMAIN_EVENT_EXTERNAL_DUPLICATE_REQUIRES_REPAIR', 'Existing duplicate platform external events require explicit repair before Schema 11 migration', { duplicates });
  }

  const snapshot = createSnapshot(db);
  const startedAt = now();
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`
      INSERT INTO r32_schema_migrations(migration_id,target_schema_version,status,checksum,started_at,completed_at,report_json)
      VALUES(?,?,'running',?,?,'','{}')
      ON CONFLICT(migration_id) DO UPDATE SET
        target_schema_version=excluded.target_schema_version,status='running',checksum=excluded.checksum,
        started_at=excluded.started_at,completed_at='',report_json='{}'
    `).run(MIGRATION_ID, TARGET_SCHEMA_VERSION, CHECKSUM, startedAt);
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS ${REQUIRED_INDEX}
      ON domain_events(platform, source_account_id, event_type, external_event_id)
      WHERE external_event_id <> '';
    `);
    const completedAt = now();
    const report = {
      migrationId: MIGRATION_ID,
      schemaVersion: TARGET_SCHEMA_VERSION,
      checksum: CHECKSUM,
      createdIndexes: [REQUIRED_INDEX],
      duplicateExternalEvents: 0,
      snapshot,
      completedAt
    };
    setSchemaVersion(db, TARGET_SCHEMA_VERSION, completedAt);
    db.prepare(`
      UPDATE r32_schema_migrations
      SET status='completed',completed_at=?,report_json=?
      WHERE migration_id=?
    `).run(completedAt, JSON.stringify(report), MIGRATION_ID);
    db.exec('COMMIT');
    return { ok: true, executed: true, ...report };
  } catch (cause) {
    try { db.exec('ROLLBACK'); } catch (_) {}
    throw Object.assign(cause, { code: cause.code || 'ROUND12_13_SELF_CHECK_HARDENING_MIGRATION_FAILED', migrationId: MIGRATION_ID, snapshot });
  }
}

module.exports = {
  MIGRATION_ID,
  TARGET_SCHEMA_VERSION,
  CHECKSUM,
  REQUIRED_INDEX,
  applyRound12Round13SelfCheckHardening,
  ensurePostMigrationConsistency,
  externalEventDuplicates,
  createSnapshot
};
