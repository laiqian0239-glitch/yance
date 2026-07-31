'use strict';

const MIGRATION_ID = '014_round12_round13_final_seven_closure';
const TARGET_SCHEMA_VERSION = 14;
const CHECKSUM = 'round12-round13-final-seven-closure-v1';

function now() { return new Date().toISOString(); }
function error(code, message, details = {}) { return Object.assign(new Error(message), { code, ...details }); }
function tableExists(db, table) { return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table)); }
function columnExists(db, table, column) { return tableExists(db, table) && db.prepare(`PRAGMA table_info(${table})`).all().some(row => String(row.name) === column); }
function ensureMigrationTable(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS r32_schema_migrations(
    migration_id TEXT PRIMARY KEY,target_schema_version INTEGER NOT NULL,status TEXT NOT NULL,checksum TEXT NOT NULL DEFAULT '',
    started_at TEXT NOT NULL,completed_at TEXT NOT NULL DEFAULT '',report_json TEXT NOT NULL DEFAULT '{}'
  ) STRICT;`);
}
function schemaVersion(db) {
  const rows = db.prepare("SELECT key,value_json FROM r32_meta WHERE key IN ('schema_version','schemaVersion')").all();
  const values = rows.map(row => {
    let parsed; try { parsed = JSON.parse(row.value_json); } catch (_) { parsed = row.value_json; }
    const value = Number(parsed);
    if (!Number.isInteger(value) || value < 0) throw error('SCHEMA_VERSION_INVALID', `Database schema metadata ${row.key} is invalid`, { key: row.key, value: row.value_json });
    return value;
  });
  return values.length ? Math.max(...values) : 0;
}
function setSchemaVersion(db, value, timestamp = now()) {
  const upsert = db.prepare(`INSERT INTO r32_meta(key,value_json,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at`);
  const encoded = JSON.stringify(Number(value)); upsert.run('schema_version', encoded, timestamp); upsert.run('schemaVersion', encoded, timestamp);
}
function recreateScopeAnchorTrigger(db, table) {
  if (!tableExists(db, table) || !columnExists(db, table, 'person_id') || !columnExists(db, table, 'scope_type') || !columnExists(db, table, 'scope_id')) return;
  db.exec(`DROP TRIGGER IF EXISTS trg_${table}_person_anchor_insert; DROP TRIGGER IF EXISTS trg_${table}_person_anchor_update;`);
  const expression = `CASE
    WHEN NEW.scope_type='contact' THEN COALESCE((SELECT person_id FROM person_contact_bindings WHERE contact_id=NEW.scope_id AND state='active' ORDER BY updated_at DESC LIMIT 1),'')
    WHEN NEW.scope_type='relationship' THEN CASE
      WHEN COALESCE(NEW.person_id,'')<>'' AND EXISTS(SELECT 1 FROM persons WHERE person_id=NEW.person_id) THEN NEW.person_id
      WHEN EXISTS(SELECT 1 FROM persons WHERE person_id=NEW.scope_id) THEN NEW.scope_id
      ELSE '' END
    ELSE '' END`;
  db.exec(`
    CREATE TRIGGER trg_${table}_person_anchor_insert AFTER INSERT ON ${table} BEGIN
      UPDATE ${table} SET person_id=${expression} WHERE rowid=NEW.rowid;
    END;
    CREATE TRIGGER trg_${table}_person_anchor_update AFTER UPDATE OF scope_type,scope_id,person_id ON ${table} BEGIN
      UPDATE ${table} SET person_id=${expression} WHERE rowid=NEW.rowid;
    END;
  `);
}
function ensureConsistency(db) {
  const version = schemaVersion(db);
  if (version < TARGET_SCHEMA_VERSION) throw error('SCHEMA_14_VERSION_INCOMPLETE', `Schema version ${version} is below ${TARGET_SCHEMA_VERSION}`);
  const receipt = db.prepare('SELECT target_schema_version,status,checksum FROM r32_schema_migrations WHERE migration_id=?').get(MIGRATION_ID);
  if (!receipt || Number(receipt.target_schema_version) !== TARGET_SCHEMA_VERSION || String(receipt.status || '') !== 'completed' || String(receipt.checksum || '') !== CHECKSUM) {
    throw error('SCHEMA_14_MIGRATION_RECEIPT_INVALID', 'Schema 14 migration receipt is missing or invalid.', { receipt: receipt || null });
  }
  for (const table of ['ai_reply_feedback_profiles','ai_reply_feedback_profile_versions','learning_preference_profiles']) {
    if (!tableExists(db, table)) continue;
    for (const suffix of ['insert','update']) {
      const name = `trg_${table}_person_anchor_${suffix}`;
      const row = db.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?").get(name);
      if (!row || !/scope_type='relationship'/u.test(String(row.sql || ''))) throw error('SCHEMA_14_RELATIONSHIP_TRIGGER_MISSING', `Relationship Person anchor trigger missing: ${name}`, { name });
    }
  }
  const orphan = tableExists(db, 'learning_preference_profiles')
    ? Number(db.prepare("SELECT COUNT(*) AS n FROM learning_preference_profiles p WHERE p.scope_type='relationship' AND p.state='active' AND EXISTS(SELECT 1 FROM persons x WHERE x.person_id=p.scope_id) AND p.person_id<>p.scope_id").get()?.n || 0)
    : 0;
  if (orphan) throw error('SCHEMA_14_RELATIONSHIP_PERSON_ANCHOR_INCOMPLETE', 'Active relationship L2 profiles are not anchored to their Person.', { orphan });
  return { schemaVersion: version, relationshipProfileOrphans: orphan };
}
function applyRound12Round13FinalSevenClosure(db) {
  ensureMigrationTable(db);
  const current = schemaVersion(db);
  const receipt = db.prepare('SELECT * FROM r32_schema_migrations WHERE migration_id=?').get(MIGRATION_ID);
  if (receipt?.status === 'completed' && current >= TARGET_SCHEMA_VERSION) return { ok: true, executed: false, migrationId: MIGRATION_ID, schemaVersion: current, consistency: ensureConsistency(db) };
  if (current < 13) throw error('SCHEMA_14_PREREQUISITE_MISSING', `Schema 14 requires schema 13, found ${current}`);
  const startedAt = now();
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`INSERT INTO r32_schema_migrations(migration_id,target_schema_version,status,checksum,started_at,completed_at,report_json)
      VALUES(?,?,'running',?,?,'','{}') ON CONFLICT(migration_id) DO UPDATE SET target_schema_version=excluded.target_schema_version,status='running',checksum=excluded.checksum,started_at=excluded.started_at,completed_at='',report_json='{}'`)
      .run(MIGRATION_ID, TARGET_SCHEMA_VERSION, CHECKSUM, startedAt);
    for (const table of ['ai_reply_feedback_profiles','ai_reply_feedback_profile_versions','learning_preference_profiles']) recreateScopeAnchorTrigger(db, table);
    if (tableExists(db, 'learning_preference_profiles')) db.exec(`
      UPDATE learning_preference_profiles SET person_id=scope_id
      WHERE scope_type='relationship' AND EXISTS(SELECT 1 FROM persons WHERE person_id=learning_preference_profiles.scope_id);
    `);
    const completedAt = now(); setSchemaVersion(db, TARGET_SCHEMA_VERSION, completedAt);
    const report = { migrationId: MIGRATION_ID, schemaVersion: TARGET_SCHEMA_VERSION, checksum: CHECKSUM, changes: ['relationship L2 Person anchors','scope anchor triggers'], completedAt };
    db.prepare("UPDATE r32_schema_migrations SET status='completed',completed_at=?,report_json=? WHERE migration_id=?").run(completedAt, JSON.stringify(report), MIGRATION_ID);
    db.exec('COMMIT');
    return { ok: true, executed: true, ...report, consistency: ensureConsistency(db) };
  } catch (cause) {
    try { db.exec('ROLLBACK'); } catch (_) {}
    throw Object.assign(cause, { code: cause.code || 'ROUND12_13_FINAL_SEVEN_MIGRATION_FAILED', migrationId: MIGRATION_ID });
  }
}
module.exports = { MIGRATION_ID, TARGET_SCHEMA_VERSION, CHECKSUM, applyRound12Round13FinalSevenClosure, ensureConsistency };
