'use strict';

const crypto = require('node:crypto');

const MIGRATION_ID = '016_batch24_state_transaction_consistency';
const TARGET_SCHEMA_VERSION = 16;
const CHECKSUM = 'batch24-state-transaction-consistency-v3';

function nowIso() { return new Date().toISOString(); }
function clean(value) { return String(value == null ? '' : value).trim(); }
function tableExists(db, table) { return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)); }
function columnExists(db, table, column) { return tableExists(db, table) && db.prepare(`PRAGMA table_info(${table})`).all().some(row => String(row.name) === column); }
function addColumn(db, table, column, definition) { if (tableExists(db, table) && !columnExists(db, table, column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`); }
function ensureMigrationTable(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS r32_schema_migrations(
    migration_id TEXT PRIMARY KEY,target_schema_version INTEGER NOT NULL,status TEXT NOT NULL,checksum TEXT NOT NULL DEFAULT '',
    started_at TEXT NOT NULL,completed_at TEXT NOT NULL DEFAULT '',report_json TEXT NOT NULL DEFAULT '{}'
  ) STRICT;`);
}
function schemaVersion(db) {
  if (!tableExists(db, 'r32_meta')) return 0;
  const rows = db.prepare("SELECT key,value_json FROM r32_meta WHERE key IN ('schema_version','schemaVersion')").all();
  const values = rows.map(row => { try { return Number(JSON.parse(row.value_json)); } catch (_) { return Number(row.value_json); } }).filter(Number.isInteger);
  return values.length ? Math.max(...values) : 0;
}
function setSchemaVersion(db, value, at = nowIso()) {
  const statement = db.prepare(`INSERT INTO r32_meta(key,value_json,updated_at) VALUES(?,?,?)
    ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at`);
  const encoded = JSON.stringify(Number(value));
  statement.run('schema_version', encoded, at);
  statement.run('schemaVersion', encoded, at);
}
function scopeHash(row) {
  const source = [row.conversation_id,row.account_id,row.platform,row.route_target,row.external_identity_id || '',row.capability_snapshot_id || ''].map(clean).join('\u001f');
  return crypto.createHash('sha256').update(source).digest('hex');
}
function routeVersionId(hash) { return `routev_${hash.slice(0, 32)}`; }

function ensureSchemaObjects(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS async_operation_state (
      operation_id TEXT PRIMARY KEY,operation_type TEXT NOT NULL,scope_key TEXT NOT NULL,object_fingerprint TEXT NOT NULL,
      generation INTEGER NOT NULL,state TEXT NOT NULL DEFAULT 'CREATED',progress INTEGER NOT NULL DEFAULT 0,
      result_json TEXT NOT NULL DEFAULT '{}',error_code TEXT NOT NULL DEFAULT '',error_message TEXT NOT NULL DEFAULT '',
      superseded_by TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,started_at TEXT NOT NULL DEFAULT '',
      finished_at TEXT NOT NULL DEFAULT '',updated_at TEXT NOT NULL,
      CHECK(state IN ('CREATED','RUNNING','SUCCEEDED','FAILED','CANCELLED','SUPERSEDED')),
      CHECK(progress >= 0 AND progress <= 100),UNIQUE(operation_type,scope_key,generation)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_async_operation_scope ON async_operation_state(operation_type,scope_key,generation DESC);
    CREATE INDEX IF NOT EXISTS idx_async_operation_state ON async_operation_state(state,updated_at DESC);
  `);
  addColumn(db, 'r32_send_queue', 'claim_generation', 'INTEGER NOT NULL DEFAULT 0');
  addColumn(db, 'r32_send_queue', 'claim_token', "TEXT NOT NULL DEFAULT ''");
  addColumn(db, 'r32_send_queue', 'lease_expires_at', "TEXT NOT NULL DEFAULT ''");
  addColumn(db, 'r32_send_queue', 'row_version', 'INTEGER NOT NULL DEFAULT 0');
  addColumn(db, 'r32_send_queue', 'outbox_route_version_id', "TEXT NOT NULL DEFAULT ''");

  addColumn(db, 'identity_domain_event_outbox', 'claim_token', "TEXT NOT NULL DEFAULT ''");
  addColumn(db, 'identity_domain_event_outbox', 'locked_at', "TEXT NOT NULL DEFAULT ''");
  addColumn(db, 'identity_domain_event_outbox', 'lease_expires_at', "TEXT NOT NULL DEFAULT ''");

  addColumn(db, 'async_operation_state', 'resume_policy', "TEXT NOT NULL DEFAULT 'fail_on_restart'");
  addColumn(db, 'async_operation_state', 'lease_owner', "TEXT NOT NULL DEFAULT ''");
  addColumn(db, 'async_operation_state', 'lease_expires_at', "TEXT NOT NULL DEFAULT ''");
  addColumn(db, 'async_operation_state', 'challenge_expires_at', "TEXT NOT NULL DEFAULT ''");
  addColumn(db, 'async_operation_state', 'adapter_session_id', "TEXT NOT NULL DEFAULT ''");

  db.exec(`
    CREATE TABLE IF NOT EXISTS outbox_route_versions(
      route_version_id TEXT PRIMARY KEY,
      outbox_route_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      external_identity_id TEXT NOT NULL DEFAULT '',
      identity_link_id TEXT NOT NULL DEFAULT '',
      person_id TEXT NOT NULL DEFAULT '',
      route_target TEXT NOT NULL,
      capability_snapshot_id TEXT NOT NULL DEFAULT '',
      scope_hash TEXT NOT NULL UNIQUE,
      state TEXT NOT NULL CHECK(state IN ('active','superseded','blocked','detached')),
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      FOREIGN KEY(conversation_id) REFERENCES r32_conversations(session_key) ON DELETE RESTRICT,
      FOREIGN KEY(account_id) REFERENCES r32_accounts(id) ON DELETE RESTRICT,
      FOREIGN KEY(outbox_route_id) REFERENCES outbox_routes(outbox_route_id) ON DELETE RESTRICT
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_outbox_route_versions_scope ON outbox_route_versions(conversation_id,account_id,platform,state,created_at DESC);

    CREATE TABLE IF NOT EXISTS account_lifecycle_saga(
      operation_id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      operation_type TEXT NOT NULL CHECK(operation_type IN ('connect','disconnect','logout','remove','promote-auth')),
      phase TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('running','compensating','succeeded','failed','manual_review')),
      credential_generation TEXT NOT NULL DEFAULT '',
      account_version INTEGER NOT NULL DEFAULT 0,
      adapter_receipt_json TEXT NOT NULL DEFAULT '{}',
      last_error TEXT NOT NULL DEFAULT '',
      started_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      finished_at TEXT NOT NULL DEFAULT '',
      FOREIGN KEY(account_id) REFERENCES r32_accounts(id) ON DELETE RESTRICT
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_account_lifecycle_saga_recovery ON account_lifecycle_saga(state,updated_at);

    CREATE TABLE IF NOT EXISTS domain_event_projection_jobs(
      job_id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL UNIQUE,
      projector_name TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('pending','processing','applied','failed','quarantined')),
      attempts INTEGER NOT NULL DEFAULT 0,
      claim_token TEXT NOT NULL DEFAULT '',
      lease_expires_at TEXT NOT NULL DEFAULT '',
      next_attempt_at TEXT NOT NULL DEFAULT '',
      last_error TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(event_id) REFERENCES domain_events(event_id) ON DELETE CASCADE
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_domain_event_projection_jobs_claim ON domain_event_projection_jobs(state,next_attempt_at,created_at);

    CREATE TRIGGER IF NOT EXISTS trg_send_queue_state_insert
    BEFORE INSERT ON r32_send_queue
    WHEN NEW.state NOT IN ('pending','retry','sending','platform_accepted_local_pending','send_outcome_unknown','sent','failed','cancelled')
    BEGIN SELECT RAISE(ABORT,'SEND_QUEUE_STATE_INVALID'); END;

    CREATE TRIGGER IF NOT EXISTS trg_send_queue_state_update
    BEFORE UPDATE OF state ON r32_send_queue
    WHEN NEW.state NOT IN ('pending','retry','sending','platform_accepted_local_pending','send_outcome_unknown','sent','failed','cancelled')
    BEGIN SELECT RAISE(ABORT,'SEND_QUEUE_STATE_INVALID'); END;

    CREATE TRIGGER IF NOT EXISTS trg_send_queue_scope_insert
    BEFORE INSERT ON r32_send_queue
    WHEN NOT EXISTS(SELECT 1 FROM r32_accounts WHERE id=NEW.account_id)
      OR NOT EXISTS(SELECT 1 FROM r32_conversations WHERE session_key=NEW.session_key)
    BEGIN SELECT RAISE(ABORT,'SEND_QUEUE_SCOPE_INVALID'); END;

    CREATE TRIGGER IF NOT EXISTS trg_send_queue_scope_update
    BEFORE UPDATE OF account_id,session_key ON r32_send_queue
    WHEN NOT EXISTS(SELECT 1 FROM r32_accounts WHERE id=NEW.account_id)
      OR NOT EXISTS(SELECT 1 FROM r32_conversations WHERE session_key=NEW.session_key)
    BEGIN SELECT RAISE(ABORT,'SEND_QUEUE_SCOPE_INVALID'); END;

    CREATE TRIGGER IF NOT EXISTS trg_send_queue_route_required_insert
    BEFORE INSERT ON r32_send_queue
    WHEN NEW.state IN ('pending','retry','sending') AND NEW.outbox_route_version_id=''
    BEGIN SELECT RAISE(ABORT,'SEND_QUEUE_ROUTE_VERSION_REQUIRED'); END;

    CREATE TRIGGER IF NOT EXISTS trg_send_queue_route_required_update
    BEFORE UPDATE OF state,outbox_route_version_id ON r32_send_queue
    WHEN NEW.state IN ('pending','retry','sending') AND NEW.outbox_route_version_id=''
    BEGIN SELECT RAISE(ABORT,'SEND_QUEUE_ROUTE_VERSION_REQUIRED'); END;

    CREATE TRIGGER IF NOT EXISTS trg_send_queue_route_version_insert
    BEFORE INSERT ON r32_send_queue
    WHEN NEW.outbox_route_version_id<>'' AND NOT EXISTS(
      SELECT 1 FROM outbox_route_versions v
      JOIN r32_accounts a ON a.id=NEW.account_id
      JOIN r32_conversations c ON c.session_key=NEW.session_key
      WHERE v.route_version_id=NEW.outbox_route_version_id
        AND v.account_id=NEW.account_id
        AND v.conversation_id=NEW.session_key
        AND lower(v.platform)=lower(a.platform)
        AND lower(v.platform)=lower(c.platform)
    )
    BEGIN SELECT RAISE(ABORT,'SEND_QUEUE_ROUTE_VERSION_SCOPE_INVALID'); END;

    CREATE TRIGGER IF NOT EXISTS trg_send_queue_route_version_update
    BEFORE UPDATE OF outbox_route_version_id,account_id,session_key ON r32_send_queue
    WHEN NEW.outbox_route_version_id<>'' AND NOT EXISTS(
      SELECT 1 FROM outbox_route_versions v
      JOIN r32_accounts a ON a.id=NEW.account_id
      JOIN r32_conversations c ON c.session_key=NEW.session_key
      WHERE v.route_version_id=NEW.outbox_route_version_id
        AND v.account_id=NEW.account_id
        AND v.conversation_id=NEW.session_key
        AND lower(v.platform)=lower(a.platform)
        AND lower(v.platform)=lower(c.platform)
    )
    BEGIN SELECT RAISE(ABORT,'SEND_QUEUE_ROUTE_VERSION_SCOPE_INVALID'); END;
  `);
}

function backfillRouteVersions(db, at) {
  const routes = db.prepare('SELECT * FROM outbox_routes ORDER BY created_at').all();
  const insert = db.prepare(`INSERT INTO outbox_route_versions(
    route_version_id,outbox_route_id,conversation_id,account_id,platform,external_identity_id,identity_link_id,person_id,
    route_target,capability_snapshot_id,scope_hash,state,payload_json,created_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(scope_hash) DO NOTHING`);
  for (const row of routes) {
    const hash = scopeHash(row);
    insert.run(routeVersionId(hash),row.outbox_route_id,row.conversation_id,row.account_id,row.platform,row.external_identity_id||'',row.identity_link_id||'',row.person_id||'',row.route_target,row.capability_snapshot_id||'',hash,row.state === 'active' ? 'active' : 'detached',row.payload_json||'{}',row.created_at||at);
  }
  db.exec(`UPDATE r32_send_queue
    SET outbox_route_version_id=(SELECT v.route_version_id FROM outbox_route_versions v WHERE v.outbox_route_id=r32_send_queue.outbox_route_id ORDER BY v.created_at DESC LIMIT 1)
    WHERE outbox_route_id<>'' AND outbox_route_version_id=''`);
  db.exec(`UPDATE r32_send_queue
    SET state=CASE WHEN state='sending' THEN 'send_outcome_unknown' ELSE 'failed' END,
        locked_at='',lease_expires_at='',claim_token='',
        last_error=CASE WHEN last_error='' THEN 'OUTBOX_ROUTE_VERSION_MISSING_AFTER_MIGRATION' ELSE last_error END,
        updated_at='${at}'
    WHERE state IN ('pending','retry','sending') AND outbox_route_version_id=''`);
}

function ensureConsistency(db) {
  for (const table of ['outbox_route_versions','account_lifecycle_saga','domain_event_projection_jobs']) {
    if (!tableExists(db, table)) throw Object.assign(new Error(`Schema 16 missing ${table}`), { code: 'SCHEMA_16_TABLE_MISSING', table });
  }
  for (const [table,column] of [
    ['r32_send_queue','claim_generation'],['r32_send_queue','claim_token'],['r32_send_queue','lease_expires_at'],['r32_send_queue','row_version'],['r32_send_queue','outbox_route_version_id'],
    ['identity_domain_event_outbox','claim_token'],['identity_domain_event_outbox','lease_expires_at'],['async_operation_state','resume_policy']
  ]) if (!columnExists(db,table,column)) throw Object.assign(new Error(`Schema 16 missing ${table}.${column}`), { code: 'SCHEMA_16_COLUMN_MISSING', table, column });
  for (const trigger of ['trg_send_queue_scope_insert','trg_send_queue_scope_update','trg_send_queue_route_required_insert','trg_send_queue_route_required_update','trg_send_queue_route_version_insert','trg_send_queue_route_version_update']) {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='trigger' AND name=?").get(trigger)) {
      throw Object.assign(new Error(`Schema 16 missing ${trigger}`), { code: 'SCHEMA_16_TRIGGER_MISSING', trigger });
    }
  }
  const invalidQueueRoutes = Number(db.prepare(`SELECT COUNT(*) AS count FROM r32_send_queue q
    WHERE q.outbox_route_version_id<>'' AND NOT EXISTS(SELECT 1 FROM outbox_route_versions v
      WHERE v.route_version_id=q.outbox_route_version_id AND v.account_id=q.account_id AND v.conversation_id=q.session_key)`).get()?.count || 0);
  const missingSendableRouteVersions = Number(db.prepare(`SELECT COUNT(*) AS count FROM r32_send_queue
    WHERE state IN ('pending','retry','sending') AND outbox_route_version_id=''`).get()?.count || 0);
  if (invalidQueueRoutes || missingSendableRouteVersions) throw Object.assign(new Error('Schema 16 queue route-version consistency failed'), {
    code: 'SCHEMA_16_ROUTE_VERSION_INTEGRITY_FAILED', invalidQueueRoutes, missingSendableRouteVersions
  });
  return { schemaVersion: schemaVersion(db), invalidQueueRoutes, missingSendableRouteVersions };
}

function applyBatch24StateTransactionConsistency(db) {
  ensureMigrationTable(db);
  const current = schemaVersion(db);
  const receipt = db.prepare('SELECT * FROM r32_schema_migrations WHERE migration_id=?').get(MIGRATION_ID);
  if (receipt?.status === 'completed' && current >= TARGET_SCHEMA_VERSION && receipt.checksum === CHECKSUM) {
    ensureSchemaObjects(db);
    return { ok:true,executed:false,migrationId:MIGRATION_ID,schemaVersion:current,consistency:ensureConsistency(db) };
  }
  if (current < 15) throw Object.assign(new Error(`Schema 16 requires schema 15, found ${current}`), { code: 'SCHEMA_16_PREREQUISITE_MISSING' });
  const startedAt = nowIso();
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`INSERT INTO r32_schema_migrations(migration_id,target_schema_version,status,checksum,started_at,completed_at,report_json)
      VALUES(?,?,'running',?,?,'','{}') ON CONFLICT(migration_id) DO UPDATE SET target_schema_version=excluded.target_schema_version,status='running',checksum=excluded.checksum,started_at=excluded.started_at,completed_at='',report_json='{}'`)
      .run(MIGRATION_ID,TARGET_SCHEMA_VERSION,CHECKSUM,startedAt);
    ensureSchemaObjects(db);
    backfillRouteVersions(db, startedAt);
    setSchemaVersion(db, TARGET_SCHEMA_VERSION, startedAt);
    const report = ensureConsistency(db);
    const completedAt = nowIso();
    db.prepare(`UPDATE r32_schema_migrations SET status='completed',completed_at=?,report_json=? WHERE migration_id=?`)
      .run(completedAt,JSON.stringify(report),MIGRATION_ID);
    db.exec('COMMIT');
    return { ok:true,executed:true,migrationId:MIGRATION_ID,schemaVersion:TARGET_SCHEMA_VERSION,consistency:report };
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch (_) {}
    throw error;
  }
}

module.exports = { MIGRATION_ID, TARGET_SCHEMA_VERSION, CHECKSUM, applyBatch24StateTransactionConsistency, ensureConsistency };
