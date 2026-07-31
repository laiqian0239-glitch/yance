'use strict';

const MIGRATION_ID = '018_batch27_developer_handoff_v2_closure';
const TARGET_SCHEMA_VERSION = 18;
const CHECKSUM = 'batch27-developer-handoff-v2-closure-v2';

function nowIso() { return new Date().toISOString(); }
function tableExists(db, table) { return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)); }
function columns(db, table) { return tableExists(db, table) ? db.prepare(`PRAGMA table_info(${table})`).all() : []; }
function addColumn(db, table, name, definition) {
  if (!columns(db, table).some(column => column.name === name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
}
function schemaVersion(db) {
  if (!tableExists(db, 'r32_meta')) return 0;
  const values = db.prepare("SELECT value_json FROM r32_meta WHERE key IN ('schema_version','schemaVersion')").all()
    .map(row => { try { return Number(JSON.parse(row.value_json)); } catch (_) { return Number(row.value_json); } })
    .filter(Number.isInteger);
  return values.length ? Math.max(...values) : 0;
}
function setSchemaVersion(db, value, at) {
  const statement = db.prepare(`INSERT INTO r32_meta(key,value_json,updated_at) VALUES(?,?,?)
    ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at`);
  const encoded = JSON.stringify(Number(value));
  statement.run('schema_version', encoded, at); statement.run('schemaVersion', encoded, at);
}
function ensureMigrationTable(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS r32_schema_migrations(
    migration_id TEXT PRIMARY KEY,target_schema_version INTEGER NOT NULL,status TEXT NOT NULL,checksum TEXT NOT NULL DEFAULT '',
    started_at TEXT NOT NULL,completed_at TEXT NOT NULL DEFAULT '',report_json TEXT NOT NULL DEFAULT '{}'
  ) STRICT;`);
}
function ensureObjects(db) {
  if (tableExists(db, 'r32_send_queue')) {
    addColumn(db, 'r32_send_queue', 'unknown_scope', "TEXT NOT NULL DEFAULT ''");
    addColumn(db, 'r32_send_queue', 'unknown_reason', "TEXT NOT NULL DEFAULT ''");
    addColumn(db, 'r32_send_queue', 'unknown_lane', "TEXT NOT NULL DEFAULT ''");
    addColumn(db, 'r32_send_queue', 'execution_generation', "TEXT NOT NULL DEFAULT ''");
    addColumn(db, 'r32_send_queue', 'unknown_recorded_at', "TEXT NOT NULL DEFAULT ''");
    db.exec(`CREATE INDEX IF NOT EXISTS idx_r32_send_queue_unknown_scope
      ON r32_send_queue(state,unknown_scope,account_id,updated_at);`);
  }
  if (tableExists(db, 'reply_learning_projection_jobs')) {
    addColumn(db, 'reply_learning_projection_jobs', 'lease_generation', 'INTEGER NOT NULL DEFAULT 0');
    addColumn(db, 'reply_learning_projection_jobs', 'last_heartbeat_at', "TEXT NOT NULL DEFAULT ''");
    addColumn(db, 'reply_learning_projection_jobs', 'final_failure_code', "TEXT NOT NULL DEFAULT ''");
    addColumn(db, 'reply_learning_projection_jobs', 'dlq_at', "TEXT NOT NULL DEFAULT ''");
    db.exec(`CREATE INDEX IF NOT EXISTS idx_reply_learning_projection_jobs_ledger
      ON reply_learning_projection_jobs(state,next_attempt_at,created_at,job_id);`);
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS reply_learning_projection_effects(
      job_id TEXT NOT NULL,
      effect_type TEXT NOT NULL CHECK(effect_type IN ('scope','l1')),
      effect_result_json TEXT NOT NULL DEFAULT '{}',
      applied_at TEXT NOT NULL,
      PRIMARY KEY(job_id,effect_type),
      FOREIGN KEY(job_id) REFERENCES reply_learning_projection_jobs(job_id) ON DELETE CASCADE
    ) STRICT;

    CREATE TABLE IF NOT EXISTS reply_learning_source_reconciliation(
      source_key TEXT PRIMARY KEY,
      source_type TEXT NOT NULL CHECK(source_type IN ('sent','rejected')),
      source_entity_id TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'retry' CHECK(state IN ('retry','completed','dead_letter')),
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TEXT NOT NULL DEFAULT '',
      last_error TEXT NOT NULL DEFAULT '',
      final_failure_code TEXT NOT NULL DEFAULT '',
      dlq_at TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_reply_learning_source_reconcile_claim
      ON reply_learning_source_reconciliation(state,next_attempt_at,updated_at,source_key);

    CREATE TABLE IF NOT EXISTS reply_learning_reconciliation_ledger(
      ledger_id TEXT PRIMARY KEY,
      source_pending INTEGER NOT NULL DEFAULT 0,
      source_retryable INTEGER NOT NULL DEFAULT 0,
      source_dead_letter INTEGER NOT NULL DEFAULT 0,
      projection_pending INTEGER NOT NULL DEFAULT 0,
      projection_processing INTEGER NOT NULL DEFAULT 0,
      projection_retryable INTEGER NOT NULL DEFAULT 0,
      projection_dead_letter INTEGER NOT NULL DEFAULT 0,
      projection_completed INTEGER NOT NULL DEFAULT 0,
      oldest_source_at TEXT NOT NULL DEFAULT '',
      oldest_projection_at TEXT NOT NULL DEFAULT '',
      payload_json TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS ai_provider_physical_execution_state(
      execution_id TEXT PRIMARY KEY,
      queue_name TEXT NOT NULL,
      provider_key TEXT NOT NULL,
      generation TEXT NOT NULL,
      job_id TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('physical-running','zombie','terminated','completed')),
      logical_state TEXT NOT NULL DEFAULT 'running',
      started_at TEXT NOT NULL,
      deadline_at TEXT NOT NULL DEFAULT '',
      finished_at TEXT NOT NULL DEFAULT '',
      last_error_code TEXT NOT NULL DEFAULT '',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_ai_provider_physical_state_provider
      ON ai_provider_physical_execution_state(provider_key,state,updated_at);

    CREATE TABLE IF NOT EXISTS durable_recovery_metrics(
      metric_key TEXT PRIMARY KEY,
      component TEXT NOT NULL,
      scanned INTEGER NOT NULL DEFAULT 0,
      recovered INTEGER NOT NULL DEFAULT 0,
      remaining INTEGER NOT NULL DEFAULT 0,
      oldest_pending_at TEXT NOT NULL DEFAULT '',
      payload_json TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL
    ) STRICT;
  `);
}
function ensureConsistency(db) {
  const queueColumns = columns(db, 'r32_send_queue').map(column => column.name);
  const required = ['unknown_scope','unknown_reason','unknown_lane','execution_generation','unknown_recorded_at'];
  const missing = required.filter(name => !queueColumns.includes(name));
  if (missing.length) throw Object.assign(new Error(`Schema 18 missing queue columns: ${missing.join(',')}`), { code: 'SCHEMA_18_QUEUE_COLUMNS_MISSING', missing });
  if (!tableExists(db, 'reply_learning_projection_effects')) throw Object.assign(new Error('Schema 18 missing learning projection effects table'), { code: 'SCHEMA_18_LEARNING_EFFECTS_TABLE_MISSING' });
  if (!tableExists(db, 'reply_learning_source_reconciliation')) throw Object.assign(new Error('Schema 18 missing learning source reconciliation table'), { code: 'SCHEMA_18_LEARNING_SOURCE_TABLE_MISSING' });
  if (!tableExists(db, 'ai_provider_physical_execution_state')) throw Object.assign(new Error('Schema 18 missing AI physical execution table'), { code: 'SCHEMA_18_AI_PHYSICAL_TABLE_MISSING' });
  return { schemaVersion: schemaVersion(db), queueColumns: required, aiPhysicalState: true };
}
function applyBatch27DeveloperHandoffV2Closure(db) {
  ensureMigrationTable(db);
  const current = schemaVersion(db);
  const receipt = db.prepare('SELECT * FROM r32_schema_migrations WHERE migration_id=?').get(MIGRATION_ID);
  if (receipt?.status === 'completed' && current >= TARGET_SCHEMA_VERSION && receipt.checksum === CHECKSUM) {
    ensureObjects(db);
    return { ok: true, executed: false, migrationId: MIGRATION_ID, schemaVersion: current, consistency: ensureConsistency(db) };
  }
  const startedAt = nowIso();
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`INSERT INTO r32_schema_migrations(migration_id,target_schema_version,status,checksum,started_at,completed_at,report_json)
      VALUES(?,?,'running',?,?,'','{}') ON CONFLICT(migration_id) DO UPDATE SET status='running',checksum=excluded.checksum,started_at=excluded.started_at,completed_at='',report_json='{}'`)
      .run(MIGRATION_ID,TARGET_SCHEMA_VERSION,CHECKSUM,startedAt);
    ensureObjects(db);
    const completedAt = nowIso();
    setSchemaVersion(db,TARGET_SCHEMA_VERSION,completedAt);
    db.prepare("UPDATE r32_schema_migrations SET status='completed',completed_at=?,report_json=? WHERE migration_id=?")
      .run(completedAt,JSON.stringify({migrationId:MIGRATION_ID,schemaVersion:TARGET_SCHEMA_VERSION,completedAt}),MIGRATION_ID);
    db.exec('COMMIT');
  } catch (error) { try { db.exec('ROLLBACK'); } catch (_) {} throw error; }
  return { ok: true, executed: true, migrationId: MIGRATION_ID, schemaVersion: TARGET_SCHEMA_VERSION, consistency: ensureConsistency(db) };
}

module.exports = { MIGRATION_ID, TARGET_SCHEMA_VERSION, CHECKSUM, applyBatch27DeveloperHandoffV2Closure, ensureConsistency };
