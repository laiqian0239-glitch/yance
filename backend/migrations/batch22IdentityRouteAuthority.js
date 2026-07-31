'use strict';

const MIGRATION_ID = '015_batch22_identity_route_authority';
const TARGET_SCHEMA_VERSION = 15;
const CHECKSUM = 'batch22-identity-route-authority-v2';

function now() { return new Date().toISOString(); }
function error(code, message, details = {}) { return Object.assign(new Error(message), { code, ...details }); }
function tableExists(db, table) { return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table)); }
function columnExists(db, table, column) { return tableExists(db, table) && db.prepare(`PRAGMA table_info(${table})`).all().some(row => String(row.name) === column); }
function addColumn(db, table, column, definition) { if (tableExists(db, table) && !columnExists(db, table, column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`); }
function ensureMigrationTable(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS r32_schema_migrations(
    migration_id TEXT PRIMARY KEY,target_schema_version INTEGER NOT NULL,status TEXT NOT NULL,checksum TEXT NOT NULL DEFAULT '',
    started_at TEXT NOT NULL,completed_at TEXT NOT NULL DEFAULT '',report_json TEXT NOT NULL DEFAULT '{}'
  ) STRICT;`);
}
function schemaVersion(db) {
  const rows = db.prepare("SELECT key,value_json FROM r32_meta WHERE key IN ('schema_version','schemaVersion')").all();
  const values = rows.map(row => { let parsed; try { parsed = JSON.parse(row.value_json); } catch (_) { parsed = row.value_json; } return Number(parsed); }).filter(Number.isInteger);
  return values.length ? Math.max(...values) : 0;
}
function setSchemaVersion(db, value, at = now()) {
  const upsert = db.prepare(`INSERT INTO r32_meta(key,value_json,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at`);
  const encoded = JSON.stringify(Number(value)); upsert.run('schema_version', encoded, at); upsert.run('schemaVersion', encoded, at);
}
function resolveAccountId(db, sourceAccountId, platform) {
  const row = db.prepare(`SELECT id FROM r32_accounts WHERE id=? OR (platform=? AND adapter_account_id=?) ORDER BY CASE WHEN id=? THEN 0 ELSE 1 END LIMIT 1`)
    .get(String(sourceAccountId || ''), String(platform || ''), String(sourceAccountId || ''), String(sourceAccountId || ''));
  return String(row?.id || '');
}
function backfill(db, at) {
  const links = db.prepare(`SELECT identity_link_id,workspace_id,person_id,platform,source_account_id,external_id,link_status,payload_json,created_at,updated_at FROM identity_links`).all();
  const insertExternal = db.prepare(`INSERT INTO external_identities(
    external_identity_id,workspace_id,platform,account_id,external_id,contact_id,person_id,identity_link_id,state,payload_json,created_at,updated_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(workspace_id,platform,account_id,external_id) DO UPDATE SET
    contact_id=CASE WHEN excluded.contact_id<>'' THEN excluded.contact_id ELSE external_identities.contact_id END,
    person_id=CASE WHEN excluded.person_id<>'' THEN excluded.person_id ELSE external_identities.person_id END,
    identity_link_id=CASE WHEN excluded.identity_link_id<>'' THEN excluded.identity_link_id ELSE external_identities.identity_link_id END,
    state=excluded.state,payload_json=excluded.payload_json,updated_at=excluded.updated_at`);
  for (const link of links) {
    const accountId = resolveAccountId(db, link.source_account_id, link.platform);
    if (!accountId) continue;
    const binding = db.prepare("SELECT contact_id FROM conversation_bindings WHERE person_id=? AND platform=? AND account_id IN (?,?) AND external_id=? AND state='active' ORDER BY updated_at DESC LIMIT 1")
      .get(link.person_id, link.platform, accountId, link.source_account_id, link.external_id);
    const id = `extid_${require('crypto').createHash('sha256').update([link.workspace_id,link.platform,accountId,link.external_id].join('\u001f')).digest('hex').slice(0,32)}`;
    insertExternal.run(id, link.workspace_id || 'default', link.platform, accountId, link.external_id, binding?.contact_id || null, link.person_id || null, link.identity_link_id || null, link.link_status === 'detached' ? 'detached' : 'active', link.payload_json || '{}', link.created_at || at, link.updated_at || at);
    db.prepare('UPDATE identity_links SET external_identity_id=? WHERE identity_link_id=?').run(id, link.identity_link_id);
    db.prepare('UPDATE conversation_bindings SET external_identity_id=?, account_id=? WHERE person_id=? AND platform=? AND account_id IN (?,?) AND external_id=?')
      .run(id, accountId, link.person_id, link.platform, accountId, link.source_account_id, link.external_id);
  }
  const conversations = db.prepare(`SELECT c.session_key,c.account_id,c.contact_id,c.platform,c.person_id,c.payload_json,c.created_at,c.updated_at,
      b.external_identity_id,b.external_id FROM r32_conversations c LEFT JOIN conversation_bindings b ON b.conversation_id=c.session_key AND b.state='active'
      WHERE c.account_id<>''`).all();
  const insertRoute = db.prepare(`INSERT INTO outbox_routes(
    outbox_route_id,conversation_id,account_id,platform,external_identity_id,identity_link_id,person_id,route_target,state,capability_snapshot_id,payload_json,created_at,updated_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(conversation_id) DO UPDATE SET
    account_id=excluded.account_id,platform=excluded.platform,external_identity_id=excluded.external_identity_id,
    identity_link_id=excluded.identity_link_id,person_id=excluded.person_id,route_target=excluded.route_target,
    state=excluded.state,payload_json=excluded.payload_json,updated_at=excluded.updated_at`);
  for (const row of conversations) {
    if (!db.prepare('SELECT 1 FROM r32_accounts WHERE id=?').get(row.account_id)) continue;
    const ext = row.external_identity_id ? db.prepare('SELECT identity_link_id,external_id FROM external_identities WHERE external_identity_id=?').get(row.external_identity_id) : null;
    let payload = {}; try { payload = JSON.parse(row.payload_json || '{}') || {}; } catch (_) {}
    const target = String(row.external_id || ext?.external_id || payload.chatJid || payload.externalId || '').trim();
    if (!target) continue;
    const routeId = `route_${require('crypto').createHash('sha256').update(row.session_key).digest('hex').slice(0,32)}`;
    insertRoute.run(routeId,row.session_key,row.account_id,row.platform,row.external_identity_id||null,ext?.identity_link_id||null,row.person_id||null,target,'active','',JSON.stringify({source:'schema-15-backfill'}),row.created_at||at,row.updated_at||at);
  }
}
function ensureConsistency(db) {
  for (const table of ['external_identities','outbox_routes','identity_domain_event_outbox']) if (!tableExists(db, table)) throw error('SCHEMA_15_TABLE_MISSING', `Missing ${table}`);
  for (const [table,column] of [['identity_links','external_identity_id'],['conversation_bindings','external_identity_id'],['r32_messages','external_identity_id'],['r32_send_queue','outbox_route_id']]) if (!columnExists(db,table,column)) throw error('SCHEMA_15_COLUMN_MISSING', `${table}.${column} missing`);
  const invalidBindings = Number(db.prepare("SELECT COUNT(*) AS n FROM conversation_bindings WHERE account_id<>'' AND NOT EXISTS(SELECT 1 FROM r32_accounts a WHERE a.id=conversation_bindings.account_id)").get()?.n || 0);
  const invalidRoutes = Number(db.prepare("SELECT COUNT(*) AS n FROM outbox_routes r WHERE NOT EXISTS(SELECT 1 FROM r32_accounts a WHERE a.id=r.account_id) OR NOT EXISTS(SELECT 1 FROM r32_conversations c WHERE c.session_key=r.conversation_id)").get()?.n || 0);
  if (invalidBindings || invalidRoutes) throw error('SCHEMA_15_REFERENTIAL_INTEGRITY_FAILED', 'Identity/route references are invalid.', { invalidBindings, invalidRoutes });
  const version = schemaVersion(db);
  if (version < TARGET_SCHEMA_VERSION) throw error('SCHEMA_15_VERSION_INCOMPLETE', `Schema version ${version} is below ${TARGET_SCHEMA_VERSION}`);
  const receipt = db.prepare('SELECT target_schema_version,status,checksum FROM r32_schema_migrations WHERE migration_id=?').get(MIGRATION_ID);
  if (!receipt || receipt.status !== 'completed' || Number(receipt.target_schema_version) !== TARGET_SCHEMA_VERSION || String(receipt.checksum) !== CHECKSUM) throw error('SCHEMA_15_MIGRATION_RECEIPT_INVALID', 'Schema 15 migration receipt is missing or invalid.');
  return { schemaVersion: version, invalidBindings, invalidRoutes };
}
function applyBatch22IdentityRouteAuthority(db) {
  ensureMigrationTable(db);
  const current = schemaVersion(db);
  const receipt = db.prepare('SELECT * FROM r32_schema_migrations WHERE migration_id=?').get(MIGRATION_ID);
  if (receipt?.status === 'completed' && current >= TARGET_SCHEMA_VERSION && receipt.checksum === CHECKSUM) return { ok:true,executed:false,migrationId:MIGRATION_ID,schemaVersion:current,consistency:ensureConsistency(db) };
  if (current < 14) throw error('SCHEMA_15_PREREQUISITE_MISSING', `Schema 15 requires schema 14, found ${current}`);
  const startedAt = now();
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`INSERT INTO r32_schema_migrations(migration_id,target_schema_version,status,checksum,started_at,completed_at,report_json)
      VALUES(?,?,'running',?,?,'','{}') ON CONFLICT(migration_id) DO UPDATE SET target_schema_version=excluded.target_schema_version,status='running',checksum=excluded.checksum,started_at=excluded.started_at,completed_at='',report_json='{}'`)
      .run(MIGRATION_ID,TARGET_SCHEMA_VERSION,CHECKSUM,startedAt);
    addColumn(db,'identity_links','external_identity_id',"TEXT NOT NULL DEFAULT ''");
    addColumn(db,'conversation_bindings','external_identity_id',"TEXT NOT NULL DEFAULT ''");
    addColumn(db,'r32_messages','external_identity_id',"TEXT NOT NULL DEFAULT ''");
    addColumn(db,'r32_send_queue','outbox_route_id',"TEXT NOT NULL DEFAULT ''");
    db.exec(`
      CREATE TABLE IF NOT EXISTS external_identities(
        external_identity_id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL DEFAULT 'default',platform TEXT NOT NULL,account_id TEXT NOT NULL,
        external_id TEXT NOT NULL,contact_id TEXT,person_id TEXT,identity_link_id TEXT,
        state TEXT NOT NULL DEFAULT 'active',payload_json TEXT NOT NULL DEFAULT '{}',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
        FOREIGN KEY(account_id) REFERENCES r32_accounts(id) ON DELETE RESTRICT,
        FOREIGN KEY(contact_id) REFERENCES contacts(id) ON DELETE RESTRICT,
        FOREIGN KEY(person_id) REFERENCES persons(person_id) ON DELETE RESTRICT,
        FOREIGN KEY(identity_link_id) REFERENCES identity_links(identity_link_id) ON DELETE RESTRICT,
        UNIQUE(workspace_id,platform,account_id,external_id),CHECK(state IN ('observed','active','verified','disputed','detached'))
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_external_identity_person ON external_identities(person_id,state,updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_external_identity_account ON external_identities(platform,account_id,external_id);
      CREATE TABLE IF NOT EXISTS outbox_routes(
        outbox_route_id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL UNIQUE,account_id TEXT NOT NULL,platform TEXT NOT NULL,
        external_identity_id TEXT,identity_link_id TEXT,person_id TEXT,route_target TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'active',capability_snapshot_id TEXT NOT NULL DEFAULT '',payload_json TEXT NOT NULL DEFAULT '{}',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
        FOREIGN KEY(conversation_id) REFERENCES r32_conversations(session_key) ON DELETE CASCADE,
        FOREIGN KEY(account_id) REFERENCES r32_accounts(id) ON DELETE RESTRICT,
        FOREIGN KEY(external_identity_id) REFERENCES external_identities(external_identity_id) ON DELETE RESTRICT,
        FOREIGN KEY(identity_link_id) REFERENCES identity_links(identity_link_id) ON DELETE RESTRICT,
        FOREIGN KEY(person_id) REFERENCES persons(person_id) ON DELETE RESTRICT,
        CHECK(state IN ('active','blocked','superseded','detached'))
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_outbox_route_account ON outbox_routes(account_id,state,updated_at DESC);
      CREATE TABLE IF NOT EXISTS identity_domain_event_outbox(
        outbox_id TEXT PRIMARY KEY,audit_id TEXT NOT NULL,event_type TEXT NOT NULL,payload_json TEXT NOT NULL DEFAULT '{}',state TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0,last_error TEXT NOT NULL DEFAULT '',next_attempt_at TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
        UNIQUE(audit_id,event_type),CHECK(state IN ('pending','processing','sent','failed'))
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_identity_event_outbox_claim ON identity_domain_event_outbox(state,next_attempt_at,created_at);
      DROP TRIGGER IF EXISTS trg_conversation_binding_account_insert;
      DROP TRIGGER IF EXISTS trg_conversation_binding_account_update;
      CREATE TRIGGER trg_conversation_binding_account_insert BEFORE INSERT ON conversation_bindings
        WHEN NEW.account_id<>'' AND NOT EXISTS(SELECT 1 FROM r32_accounts WHERE id=NEW.account_id)
        BEGIN SELECT RAISE(ABORT,'CONVERSATION_BINDING_ACCOUNT_NOT_FOUND'); END;
      CREATE TRIGGER trg_conversation_binding_account_update BEFORE UPDATE OF account_id ON conversation_bindings
        WHEN NEW.account_id<>'' AND NOT EXISTS(SELECT 1 FROM r32_accounts WHERE id=NEW.account_id)
        BEGIN SELECT RAISE(ABORT,'CONVERSATION_BINDING_ACCOUNT_NOT_FOUND'); END;
      DROP TRIGGER IF EXISTS trg_send_queue_outbox_route_insert;
      DROP TRIGGER IF EXISTS trg_send_queue_outbox_route_update;
      CREATE TRIGGER trg_send_queue_outbox_route_insert BEFORE INSERT ON r32_send_queue
        WHEN NEW.outbox_route_id<>'' AND NOT EXISTS(SELECT 1 FROM outbox_routes WHERE outbox_route_id=NEW.outbox_route_id)
        BEGIN SELECT RAISE(ABORT,'SEND_QUEUE_OUTBOX_ROUTE_NOT_FOUND'); END;
      CREATE TRIGGER trg_send_queue_outbox_route_update BEFORE UPDATE OF outbox_route_id ON r32_send_queue
        WHEN NEW.outbox_route_id<>'' AND NOT EXISTS(SELECT 1 FROM outbox_routes WHERE outbox_route_id=NEW.outbox_route_id)
        BEGIN SELECT RAISE(ABORT,'SEND_QUEUE_OUTBOX_ROUTE_NOT_FOUND'); END;
    `);
    backfill(db, startedAt);
    const completedAt = now(); setSchemaVersion(db,TARGET_SCHEMA_VERSION,completedAt);
    db.prepare("UPDATE r32_schema_migrations SET status='completed',completed_at=?,report_json=? WHERE migration_id=?")
      .run(completedAt,JSON.stringify({migrationId:MIGRATION_ID,schemaVersion:TARGET_SCHEMA_VERSION,changes:['external_identities','outbox_routes','identity_domain_event_outbox','binding account constraints'],completedAt}),MIGRATION_ID);
    db.exec('COMMIT');
  } catch (cause) { try { db.exec('ROLLBACK'); } catch (_) {} throw cause; }
  return { ok:true,executed:true,migrationId:MIGRATION_ID,schemaVersion:TARGET_SCHEMA_VERSION,consistency:ensureConsistency(db) };
}
module.exports = { MIGRATION_ID, TARGET_SCHEMA_VERSION, CHECKSUM, applyBatch22IdentityRouteAuthority, ensureConsistency };
