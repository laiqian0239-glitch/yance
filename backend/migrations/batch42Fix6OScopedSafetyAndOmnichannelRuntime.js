'use strict';

const MIGRATION_ID = '020_batch42_fix6o_scoped_safety_omnichannel_runtime';
const TARGET_SCHEMA_VERSION = 20;
const CHECKSUM = 'batch42-fix6o-scoped-safety-omnichannel-v1';

function nowIso() { return new Date().toISOString(); }
function tableExists(db, table) { return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)); }
function ensureMigrationTable(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS r32_schema_migrations(
    migration_id TEXT PRIMARY KEY,target_schema_version INTEGER NOT NULL,status TEXT NOT NULL,checksum TEXT NOT NULL DEFAULT '',
    started_at TEXT NOT NULL,completed_at TEXT NOT NULL DEFAULT '',report_json TEXT NOT NULL DEFAULT '{}'
  ) STRICT;`);
}
function setSchemaVersion(db, value, at) {
  const statement = db.prepare(`INSERT INTO r32_meta(key,value_json,updated_at) VALUES(?,?,?)
    ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at`);
  const encoded = JSON.stringify(Number(value));
  statement.run('schema_version', encoded, at);
  statement.run('schemaVersion', encoded, at);
}
function ensureObjects(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS scoped_safety_issues(
      issue_id TEXT PRIMARY KEY,
      fingerprint TEXT NOT NULL UNIQUE,
      scope_type TEXT NOT NULL CHECK(scope_type IN ('system','platform','account','capability')),
      scope_id TEXT NOT NULL DEFAULT '',
      platform TEXT NOT NULL DEFAULT '',
      account_id TEXT NOT NULL DEFAULT '',
      capability TEXT NOT NULL DEFAULT '',
      severity TEXT NOT NULL DEFAULT 'high',
      reason_code TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','resolved')),
      detail_json TEXT NOT NULL DEFAULT '{}',
      resolution_receipt_json TEXT NOT NULL DEFAULT '{}',
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      resolved_at TEXT NOT NULL DEFAULT '',
      clear_observation_count INTEGER NOT NULL DEFAULT 0,
      last_clear_observation_at TEXT NOT NULL DEFAULT ''
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_scoped_safety_active
      ON scoped_safety_issues(state,scope_type,platform,account_id,capability,last_seen_at DESC);

    CREATE TABLE IF NOT EXISTS scoped_safety_events(
      event_id TEXT PRIMARY KEY,
      issue_id TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      event_type TEXT NOT NULL CHECK(event_type IN ('opened','observed','resolved','reopened','clear-observed','auto-resolved')),
      actor TEXT NOT NULL DEFAULT 'runtime-safety-supervisor',
      reason_code TEXT NOT NULL DEFAULT '',
      detail_json TEXT NOT NULL DEFAULT '{}',
      occurred_at TEXT NOT NULL,
      FOREIGN KEY(issue_id) REFERENCES scoped_safety_issues(issue_id) ON DELETE RESTRICT,
      UNIQUE(issue_id,sequence)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_scoped_safety_events_issue ON scoped_safety_events(issue_id,sequence);
    CREATE TRIGGER IF NOT EXISTS trg_scoped_safety_events_append_only_update
      BEFORE UPDATE ON scoped_safety_events BEGIN SELECT RAISE(ABORT,'scoped_safety_events append-only'); END;
    CREATE TRIGGER IF NOT EXISTS trg_scoped_safety_events_append_only_delete
      BEFORE DELETE ON scoped_safety_events BEGIN SELECT RAISE(ABORT,'scoped_safety_events append-only'); END;

    CREATE TABLE IF NOT EXISTS platform_driver_profiles(
      driver_id TEXT PRIMARY KEY,
      platform TEXT NOT NULL,
      account_kind TEXT NOT NULL,
      official INTEGER NOT NULL DEFAULT 0,
      support_level TEXT NOT NULL CHECK(support_level IN ('production','identity-only','experimental','unsupported')),
      messaging_supported INTEGER NOT NULL DEFAULT 0,
      risk_disclosure_required INTEGER NOT NULL DEFAULT 0,
      isolation_model TEXT NOT NULL DEFAULT '',
      capabilities_json TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL
    ) STRICT;
  `);
  const at = nowIso();
  const upsert = db.prepare(`INSERT INTO platform_driver_profiles(
      driver_id,platform,account_kind,official,support_level,messaging_supported,risk_disclosure_required,isolation_model,capabilities_json,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(driver_id) DO UPDATE SET platform=excluded.platform,account_kind=excluded.account_kind,official=excluded.official,
      support_level=excluded.support_level,messaging_supported=excluded.messaging_supported,risk_disclosure_required=excluded.risk_disclosure_required,
      isolation_model=excluded.isolation_model,capabilities_json=excluded.capabilities_json,updated_at=excluded.updated_at`);
  const rows = [
    ['whatsapp-web-multidevice','whatsapp','personal-multidevice',0,'experimental',1,1,'isolated-auth-directory',{ text:true,media:true,history:true,contacts:true }],
    ['telegram-personal-mtproto','telegram','personal',1,'production',1,0,'isolated-session-worker',{ text:true,media:true,history:true,contacts:true }],
    ['facebook-page-official','facebook','page',1,'production',1,0,'page-account-worker',{ text:true,media:true,history:true,contacts:true }],
    ['facebook-personal-identity-official','facebook','personal-identity',1,'identity-only',0,0,'oauth-identity',{ identity:true,avatar:true,pages:true }],
    ['facebook-personal-messenger-experimental','facebook','personal-messenger',0,'experimental',1,1,'isolated-browser-session',{ text:true,media:true,history:true,contacts:true }]
  ];
  for (const row of rows) upsert.run(row[0],row[1],row[2],row[3],row[4],row[5],row[6],row[7],JSON.stringify(row[8]),at);
}
function ensureConsistency(db) {
  for (const table of ['scoped_safety_issues','scoped_safety_events','platform_driver_profiles']) {
    if (!tableExists(db, table)) throw new Error(`FIX6O migration missing ${table}`);
  }
  const triggers = ['trg_scoped_safety_events_append_only_update','trg_scoped_safety_events_append_only_delete'];
  for (const trigger of triggers) if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='trigger' AND name=?").get(trigger)) throw new Error(`FIX6O migration missing ${trigger}`);
}
function applyBatch42Fix6OScopedSafetyAndOmnichannelRuntime(db) {
  ensureMigrationTable(db);
  const existing = db.prepare('SELECT * FROM r32_schema_migrations WHERE migration_id=?').get(MIGRATION_ID);
  ensureObjects(db);
  ensureConsistency(db);
  const at = nowIso();
  setSchemaVersion(db, TARGET_SCHEMA_VERSION, at);
  if (!existing) db.prepare(`INSERT INTO r32_schema_migrations(migration_id,target_schema_version,status,checksum,started_at,completed_at,report_json) VALUES(?,?,?,?,?,?,?)`)
    .run(MIGRATION_ID,TARGET_SCHEMA_VERSION,'completed',CHECKSUM,at,at,JSON.stringify({ tables:3,authority:'ScopedSafetyAuthority' }));
  else db.prepare(`UPDATE r32_schema_migrations SET target_schema_version=?,status='completed',checksum=?,completed_at=?,report_json=? WHERE migration_id=?`)
    .run(TARGET_SCHEMA_VERSION,CHECKSUM,at,JSON.stringify({ tables:3,authority:'ScopedSafetyAuthority' }),MIGRATION_ID);
  return { migrationId:MIGRATION_ID,targetSchemaVersion:TARGET_SCHEMA_VERSION,checksum:CHECKSUM };
}

module.exports = { MIGRATION_ID, TARGET_SCHEMA_VERSION, CHECKSUM, ensureObjects, ensureConsistency, applyBatch42Fix6OScopedSafetyAndOmnichannelRuntime };
