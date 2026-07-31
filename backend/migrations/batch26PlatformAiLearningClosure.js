'use strict';

const MIGRATION_ID = '017_batch26_platform_ai_learning_closure';
const TARGET_SCHEMA_VERSION = 17;
const CHECKSUM = 'batch26-platform-ai-learning-closure-v1';

function nowIso() { return new Date().toISOString(); }
function tableExists(db, table) { return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)); }
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
  db.exec(`
    CREATE TABLE IF NOT EXISTS reply_learning_projection_jobs(
      job_id TEXT PRIMARY KEY,
      evidence_id TEXT NOT NULL UNIQUE,
      contact_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL DEFAULT '',
      state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','processing','retry','completed','failed')),
      scope_state TEXT NOT NULL DEFAULT 'pending' CHECK(scope_state IN ('pending','completed','failed')),
      l1_state TEXT NOT NULL DEFAULT 'pending' CHECK(l1_state IN ('pending','completed','skipped','failed')),
      attempts INTEGER NOT NULL DEFAULT 0,
      claim_token TEXT NOT NULL DEFAULT '',
      lease_expires_at TEXT NOT NULL DEFAULT '',
      next_attempt_at TEXT NOT NULL DEFAULT '',
      last_error TEXT NOT NULL DEFAULT '',
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT NOT NULL DEFAULT '',
      FOREIGN KEY(evidence_id) REFERENCES ai_reply_feedback_events(id) ON DELETE CASCADE
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_reply_learning_projection_jobs_claim
      ON reply_learning_projection_jobs(state,next_attempt_at,updated_at);
    CREATE INDEX IF NOT EXISTS idx_reply_learning_projection_jobs_scope
      ON reply_learning_projection_jobs(contact_id,conversation_id,state);
  `);
}
function backfill(db, at) {
  if (!tableExists(db, 'ai_reply_feedback_events')) return 0;
  const rows = db.prepare('SELECT * FROM ai_reply_feedback_events ORDER BY created_at').all();
  const insert = db.prepare(`INSERT OR IGNORE INTO reply_learning_projection_jobs(
    job_id,evidence_id,contact_id,conversation_id,state,scope_state,l1_state,payload_json,created_at,updated_at
  ) VALUES(?,?,?,?,'pending','pending','pending',?,?,?)`);
  let inserted = 0;
  for (const row of rows) {
    const payload = {
      evidenceId: row.id, eventType: row.event_type, candidateId: row.candidate_id, outboxId: row.outbox_id,
      contactId: row.contact_id, conversationId: row.conversation_id, personaProfileId: row.persona_profile_id,
      originalText: row.original_text, finalText: row.final_text, rejectionReason: row.rejection_reason,
      source: row.reply_source, contextRevision: Number(row.context_revision || 0),
      contextMessageIds: (() => { try { return JSON.parse(row.context_message_ids_json || '[]'); } catch (_) { return []; } })(),
      performanceMode: row.performance_mode, platform: row.platform, sourceAccountId: row.source_account_id,
      platformContactIdentity: row.platform_contact_identity, canonicalContactId: row.canonical_contact_id,
      learningMode: row.learning_mode, targetLanguage: row.target_language, translatedZh: row.translated_zh,
      translationModel: row.translation_model, modelId: row.model_id, model: row.model_name,
      replyTask: row.reply_task, styleVariant: row.style_variant,
      generationMetadata: (() => { try { return JSON.parse(row.generation_metadata_json || '{}'); } catch (_) { return {}; } })(),
      observedAt: row.created_at
    };
    const result = insert.run(`learnproj_${String(row.id).replace(/[^a-zA-Z0-9_-]/g, '_')}`, row.id, row.contact_id, row.conversation_id || '', JSON.stringify(payload), row.created_at || at, at);
    inserted += Number(result.changes || 0);
  }
  return inserted;
}
function ensureConsistency(db) {
  if (!tableExists(db, 'reply_learning_projection_jobs')) {
    throw Object.assign(new Error('Schema 17 missing reply_learning_projection_jobs'), { code: 'SCHEMA_17_TABLE_MISSING' });
  }
  return { schemaVersion: schemaVersion(db), pending: Number(db.prepare("SELECT COUNT(*) AS count FROM reply_learning_projection_jobs WHERE state<>'completed'").get()?.count || 0) };
}
function applyBatch26PlatformAiLearningClosure(db) {
  ensureMigrationTable(db);
  const current = schemaVersion(db);
  const receipt = db.prepare('SELECT * FROM r32_schema_migrations WHERE migration_id=?').get(MIGRATION_ID);
  if (receipt?.status === 'completed' && current >= TARGET_SCHEMA_VERSION && receipt.checksum === CHECKSUM) {
    ensureObjects(db); return { ok: true, executed: false, migrationId: MIGRATION_ID, schemaVersion: current, consistency: ensureConsistency(db) };
  }
  const startedAt = nowIso();
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`INSERT INTO r32_schema_migrations(migration_id,target_schema_version,status,checksum,started_at,completed_at,report_json)
      VALUES(?,?,'running',?,?,'','{}') ON CONFLICT(migration_id) DO UPDATE SET status='running',checksum=excluded.checksum,started_at=excluded.started_at,completed_at='',report_json='{}'`)
      .run(MIGRATION_ID,TARGET_SCHEMA_VERSION,CHECKSUM,startedAt);
    ensureObjects(db);
    const backfilled = backfill(db, startedAt);
    const completedAt = nowIso(); setSchemaVersion(db,TARGET_SCHEMA_VERSION,completedAt);
    db.prepare("UPDATE r32_schema_migrations SET status='completed',completed_at=?,report_json=? WHERE migration_id=?")
      .run(completedAt,JSON.stringify({migrationId:MIGRATION_ID,schemaVersion:TARGET_SCHEMA_VERSION,backfilled,completedAt}),MIGRATION_ID);
    db.exec('COMMIT');
  } catch (error) { try { db.exec('ROLLBACK'); } catch (_) {} throw error; }
  return { ok: true, executed: true, migrationId: MIGRATION_ID, schemaVersion: TARGET_SCHEMA_VERSION, consistency: ensureConsistency(db) };
}

module.exports = { MIGRATION_ID, TARGET_SCHEMA_VERSION, CHECKSUM, applyBatch26PlatformAiLearningClosure, ensureConsistency };
