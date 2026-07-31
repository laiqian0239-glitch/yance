'use strict';

const MIGRATION_ID = '012_round12_round13_remaining_closure';
const TARGET_SCHEMA_VERSION = 12;
const CHECKSUM = 'round12-round13-remaining-closure-v1';

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
  const rows = db.prepare("SELECT key,value_json FROM r32_meta WHERE key IN ('schema_version','schemaVersion')").all();
  const versions = rows.map(row => {
    let parsed;
    try { parsed = JSON.parse(row.value_json); } catch (_) { parsed = row.value_json; }
    const value = Number(parsed);
    if (!Number.isInteger(value) || value < 0) throw error('SCHEMA_VERSION_INVALID', `Database schema metadata ${row.key} is invalid`, { key: row.key, value: row.value_json });
    return value;
  });
  return versions.length ? Math.max(...versions) : 0;
}
function setSchemaVersion(db, value, timestamp = now()) {
  const upsert = db.prepare(`
    INSERT INTO r32_meta(key,value_json,updated_at) VALUES(?,?,?)
    ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at
  `);
  const encoded = JSON.stringify(Number(value));
  upsert.run('schema_version', encoded, timestamp);
  upsert.run('schemaVersion', encoded, timestamp);
}
function normalizedSql(db, table) {
  return String(db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table)?.sql || '').replace(/\s+/g, ' ').toLowerCase();
}
function ensurePostMigrationConsistency(db) {
  const profilesSql = normalizedSql(db, 'learning_preference_profiles');
  const auditsSql = normalizedSql(db, 'learning_promotion_audit');
  if (!profilesSql.includes("'pending-approval'")) throw error('SCHEMA_12_LEARNING_PROFILE_STATE_INVALID', 'Schema 12 learning profile pending-approval state is missing');
  if (!auditsSql.includes("'pending-human-approval'")) throw error('SCHEMA_12_PROMOTION_DECISION_INVALID', 'Schema 12 pending-human-approval decision is missing');
  const version = schemaVersion(db);
  if (version < TARGET_SCHEMA_VERSION) {
    throw error('SCHEMA_12_VERSION_INCOMPLETE', `Schema version ${version} is below ${TARGET_SCHEMA_VERSION}`,
      { actual: version, minimum: TARGET_SCHEMA_VERSION });
  }
  const receipt = db.prepare('SELECT target_schema_version,status,checksum FROM r32_schema_migrations WHERE migration_id=?').get(MIGRATION_ID);
  if (!receipt || receipt.status !== 'completed' || Number(receipt.target_schema_version || 0) !== TARGET_SCHEMA_VERSION || String(receipt.checksum || '') !== CHECKSUM) {
    throw error('SCHEMA_12_MIGRATION_RECEIPT_INVALID', 'Schema 12 migration receipt is missing or invalid', { receipt: receipt || null });
  }
  const foreignKeys = Number(db.prepare('PRAGMA foreign_keys').get()?.foreign_keys || 0);
  if (foreignKeys !== 1) throw error('SCHEMA_12_FOREIGN_KEYS_DISABLED', 'SQLite foreign key enforcement is disabled');
  return { ok: true, schemaVersion: version, migrationId: MIGRATION_ID, checksum: CHECKSUM, checkedAt: now() };
}
function applyRound12Round13RemainingClosure(db) {
  ensureMigrationTable(db);
  const completed = db.prepare("SELECT target_schema_version,status,checksum FROM r32_schema_migrations WHERE migration_id=? AND status='completed'").get(MIGRATION_ID);
  if (completed) return { ok: true, executed: false, migrationId: MIGRATION_ID, schemaVersion: TARGET_SCHEMA_VERSION, consistency: ensurePostMigrationConsistency(db) };

  const startedAt = now();
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`
      INSERT INTO r32_schema_migrations(migration_id,target_schema_version,status,checksum,started_at,completed_at,report_json)
      VALUES(?,?,'running',?,?,'','{}')
      ON CONFLICT(migration_id) DO UPDATE SET target_schema_version=excluded.target_schema_version,status='running',checksum=excluded.checksum,started_at=excluded.started_at,completed_at='',report_json='{}'
    `).run(MIGRATION_ID, TARGET_SCHEMA_VERSION, CHECKSUM, startedAt);

    db.exec(`
      CREATE TABLE learning_preference_profiles_v12 (
        scope_type TEXT NOT NULL,
        scope_id TEXT NOT NULL,
        learning_level TEXT NOT NULL,
        version INTEGER NOT NULL,
        preference_json TEXT NOT NULL DEFAULT '{}',
        evidence_signal_ids_json TEXT NOT NULL DEFAULT '[]',
        confidence REAL NOT NULL DEFAULT 0,
        state TEXT NOT NULL DEFAULT 'candidate',
        created_at TEXT NOT NULL,
        activated_at TEXT NOT NULL DEFAULT '',
        PRIMARY KEY(scope_type,scope_id,learning_level,version),
        CHECK(learning_level IN ('L1','L2','L3')),
        CHECK(state IN ('candidate','pending-approval','active','rejected','rolled-back','forgotten'))
      ) STRICT;
      INSERT INTO learning_preference_profiles_v12
      SELECT scope_type,scope_id,learning_level,version,preference_json,evidence_signal_ids_json,confidence,state,created_at,activated_at
      FROM learning_preference_profiles;
      DROP TABLE learning_preference_profiles;
      ALTER TABLE learning_preference_profiles_v12 RENAME TO learning_preference_profiles;
      CREATE INDEX idx_learning_profile_active ON learning_preference_profiles(scope_type,scope_id,learning_level,state,version DESC);

      CREATE TABLE learning_promotion_audit_v12 (
        promotion_id TEXT PRIMARY KEY,
        from_level TEXT NOT NULL,
        to_level TEXT NOT NULL,
        source_scope_type TEXT NOT NULL,
        source_scope_id TEXT NOT NULL,
        target_scope_type TEXT NOT NULL,
        target_scope_id TEXT NOT NULL,
        source_versions_json TEXT NOT NULL DEFAULT '[]',
        sample_count INTEGER NOT NULL DEFAULT 0,
        confidence REAL NOT NULL DEFAULT 0,
        decision TEXT NOT NULL,
        reason TEXT NOT NULL DEFAULT '',
        rollback_version INTEGER NOT NULL DEFAULT 0,
        actor TEXT NOT NULL DEFAULT 'system',
        created_at TEXT NOT NULL,
        CHECK(from_level IN ('L1','L2')),
        CHECK(to_level IN ('L2','L3')),
        CHECK(decision IN ('pending-human-approval','approved','rejected','rolled-back','forgotten'))
      ) STRICT;
      INSERT INTO learning_promotion_audit_v12
      SELECT promotion_id,from_level,to_level,source_scope_type,source_scope_id,target_scope_type,target_scope_id,source_versions_json,sample_count,confidence,decision,reason,rollback_version,actor,created_at
      FROM learning_promotion_audit;
      DROP TABLE learning_promotion_audit;
      ALTER TABLE learning_promotion_audit_v12 RENAME TO learning_promotion_audit;
    `);

    const completedAt = now();
    setSchemaVersion(db, TARGET_SCHEMA_VERSION, completedAt);
    const report = {
      migrationId: MIGRATION_ID,
      schemaVersion: TARGET_SCHEMA_VERSION,
      checksum: CHECKSUM,
      changes: ['learning_preference_profiles.pending-approval', 'learning_promotion_audit.pending-human-approval'],
      completedAt
    };
    db.prepare("UPDATE r32_schema_migrations SET status='completed',completed_at=?,report_json=? WHERE migration_id=?")
      .run(completedAt, JSON.stringify(report), MIGRATION_ID);
    db.exec('COMMIT');
    return { ok: true, executed: true, ...report, consistency: ensurePostMigrationConsistency(db) };
  } catch (cause) {
    try { db.exec('ROLLBACK'); } catch (_) {}
    throw Object.assign(cause, { code: cause.code || 'ROUND12_13_REMAINING_CLOSURE_MIGRATION_FAILED', migrationId: MIGRATION_ID });
  }
}

module.exports = {
  MIGRATION_ID,
  TARGET_SCHEMA_VERSION,
  CHECKSUM,
  applyRound12Round13RemainingClosure,
  ensurePostMigrationConsistency
};
