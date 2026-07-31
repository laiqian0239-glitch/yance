'use strict';

const MIGRATION_ID = '013_round12_round13_final_governance_closure';
const TARGET_SCHEMA_VERSION = 13;
const CHECKSUM = 'round12-round13-final-governance-closure-v3';

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
  const rows = db.prepare("SELECT key,value_json FROM r32_meta WHERE key IN ('schema_version','schemaVersion')").all();
  const values = rows.map(row => {
    let parsed;
    try { parsed = JSON.parse(row.value_json); } catch (_) { parsed = row.value_json; }
    const value = Number(parsed);
    if (!Number.isInteger(value) || value < 0) throw error('SCHEMA_VERSION_INVALID', `Database schema metadata ${row.key} is invalid`, { key: row.key, value: row.value_json });
    return value;
  });
  return values.length ? Math.max(...values) : 0;
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
function tableExists(db, table) {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table));
}
function columnExists(db, table, column) {
  return tableExists(db, table) && db.prepare(`PRAGMA table_info(${table})`).all().some(row => String(row.name) === column);
}
function addColumn(db, table, column, definition) {
  if (tableExists(db, table) && !columnExists(db, table, column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function personAwareTables() {
  return ['customer_profiles','customer_profile_evidence','relationship_insights','relationship_timeline_events','customer_social_state','customer_interaction_preferences','interaction_policies','ai_context_snapshots','ai_reply_tasks','ai_reply_candidates','ai_reply_outbox','ai_analysis_runs','ai_candidate_generation_plans','ai_director_strategies','ai_reply_feedback_events','learning_signal_ledger','relationship_state_signals','social_inference_corrections','ai_reply_feedback_profiles','ai_reply_feedback_profile_versions','learning_preference_profiles','r32_conversations'];
}
function ensurePersonAnchorColumns(db) {
  for (const table of personAwareTables()) addColumn(db, table, 'person_id', "TEXT NOT NULL DEFAULT ''");
  for (const table of personAwareTables()) if (tableExists(db, table)) db.exec(`CREATE INDEX IF NOT EXISTS idx_${table}_person_id ON ${table}(person_id)`);
}
function ensurePersonAnchorTriggers(db) {
// Keep every future customer/AI write anchored to the active Person without relying on each caller.
const contactAnchorColumns = {
  customer_profiles: 'contact_id', customer_profile_evidence: 'canonical_contact_id', relationship_insights: 'contact_id',
  relationship_timeline_events: 'contact_id', customer_social_state: 'contact_id', customer_interaction_preferences: 'contact_id',
  interaction_policies: 'contact_id', ai_context_snapshots: 'contact_id', ai_reply_tasks: 'contact_id',
  ai_reply_candidates: 'contact_id', ai_reply_outbox: 'contact_id',
  ai_analysis_runs: 'contact_id', ai_candidate_generation_plans: 'contact_id', ai_director_strategies: 'contact_id',
  ai_reply_feedback_events: 'contact_id', learning_signal_ledger: 'contact_id', relationship_state_signals: 'contact_id',
  social_inference_corrections: 'contact_id'
};
for (const [table, contactColumn] of Object.entries(contactAnchorColumns)) {
  if (!tableExists(db, table) || !columnExists(db, table, contactColumn)) continue;
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_${table}_person_anchor_insert
    AFTER INSERT ON ${table}
    BEGIN
      UPDATE ${table}
      SET person_id=COALESCE((SELECT person_id FROM person_contact_bindings WHERE contact_id=NEW.${contactColumn} AND state='active' ORDER BY updated_at DESC LIMIT 1),'')
      WHERE rowid=NEW.rowid;
    END;
    CREATE TRIGGER IF NOT EXISTS trg_${table}_person_anchor_update
    AFTER UPDATE OF ${contactColumn} ON ${table}
    BEGIN
      UPDATE ${table}
      SET person_id=COALESCE((SELECT person_id FROM person_contact_bindings WHERE contact_id=NEW.${contactColumn} AND state='active' ORDER BY updated_at DESC LIMIT 1),'')
      WHERE rowid=NEW.rowid;
    END;
  `);
}
const scopeAnchorTables = ['ai_reply_feedback_profiles','ai_reply_feedback_profile_versions','learning_preference_profiles'];
for (const table of scopeAnchorTables) {
  if (!tableExists(db, table) || !columnExists(db, table, 'scope_type') || !columnExists(db, table, 'scope_id')) continue;
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_${table}_person_anchor_insert
    AFTER INSERT ON ${table}
    BEGIN
      UPDATE ${table}
      SET person_id=CASE WHEN NEW.scope_type='contact' THEN COALESCE((SELECT person_id FROM person_contact_bindings WHERE contact_id=NEW.scope_id AND state='active' ORDER BY updated_at DESC LIMIT 1),'') ELSE '' END
      WHERE rowid=NEW.rowid;
    END;
    CREATE TRIGGER IF NOT EXISTS trg_${table}_person_anchor_update
    AFTER UPDATE OF scope_type,scope_id ON ${table}
    BEGIN
      UPDATE ${table}
      SET person_id=CASE WHEN NEW.scope_type='contact' THEN COALESCE((SELECT person_id FROM person_contact_bindings WHERE contact_id=NEW.scope_id AND state='active' ORDER BY updated_at DESC LIMIT 1),'') ELSE '' END
      WHERE rowid=NEW.rowid;
    END;
  `);
}
if (tableExists(db, 'r32_conversations')) db.exec(`
  CREATE TRIGGER IF NOT EXISTS trg_r32_conversations_person_anchor_insert
  AFTER INSERT ON r32_conversations
  BEGIN
    UPDATE r32_conversations SET person_id=COALESCE(
      (SELECT person_id FROM conversation_bindings WHERE conversation_id=NEW.session_key AND state='active' ORDER BY updated_at DESC LIMIT 1),
      (SELECT person_id FROM person_contact_bindings WHERE contact_id=NEW.contact_id AND state='active' ORDER BY updated_at DESC LIMIT 1),'')
    WHERE rowid=NEW.rowid;
  END;
  CREATE TRIGGER IF NOT EXISTS trg_r32_conversations_person_anchor_update
  AFTER UPDATE OF contact_id,session_key ON r32_conversations
  BEGIN
    UPDATE r32_conversations SET person_id=COALESCE(
      (SELECT person_id FROM conversation_bindings WHERE conversation_id=NEW.session_key AND state='active' ORDER BY updated_at DESC LIMIT 1),
      (SELECT person_id FROM person_contact_bindings WHERE contact_id=NEW.contact_id AND state='active' ORDER BY updated_at DESC LIMIT 1),'')
    WHERE rowid=NEW.rowid;
  END;
`);
db.exec(`
  CREATE TRIGGER IF NOT EXISTS trg_person_contact_binding_propagate
  AFTER INSERT ON person_contact_bindings WHEN NEW.state='active'
  BEGIN
    UPDATE customer_profiles SET person_id=NEW.person_id WHERE contact_id=NEW.contact_id;
    UPDATE customer_profile_evidence SET person_id=NEW.person_id WHERE canonical_contact_id=NEW.contact_id;
    UPDATE relationship_insights SET person_id=NEW.person_id WHERE contact_id=NEW.contact_id;
    UPDATE relationship_timeline_events SET person_id=NEW.person_id WHERE contact_id=NEW.contact_id;
    UPDATE customer_social_state SET person_id=NEW.person_id WHERE contact_id=NEW.contact_id;
    UPDATE customer_interaction_preferences SET person_id=NEW.person_id WHERE contact_id=NEW.contact_id;
    UPDATE interaction_policies SET person_id=NEW.person_id WHERE contact_id=NEW.contact_id;
    UPDATE ai_context_snapshots SET person_id=NEW.person_id WHERE contact_id=NEW.contact_id;
    UPDATE ai_reply_tasks SET person_id=NEW.person_id WHERE contact_id=NEW.contact_id;
    UPDATE ai_reply_candidates SET person_id=NEW.person_id WHERE contact_id=NEW.contact_id;
    UPDATE ai_reply_outbox SET person_id=NEW.person_id WHERE contact_id=NEW.contact_id;
    UPDATE ai_analysis_runs SET person_id=NEW.person_id WHERE contact_id=NEW.contact_id;
    UPDATE ai_candidate_generation_plans SET person_id=NEW.person_id WHERE contact_id=NEW.contact_id;
    UPDATE ai_director_strategies SET person_id=NEW.person_id WHERE contact_id=NEW.contact_id;
    UPDATE ai_reply_feedback_events SET person_id=NEW.person_id WHERE contact_id=NEW.contact_id;
    UPDATE learning_signal_ledger SET person_id=NEW.person_id WHERE contact_id=NEW.contact_id;
    UPDATE relationship_state_signals SET person_id=NEW.person_id WHERE contact_id=NEW.contact_id;
    UPDATE social_inference_corrections SET person_id=NEW.person_id WHERE contact_id=NEW.contact_id;
    UPDATE ai_reply_feedback_profiles SET person_id=NEW.person_id WHERE scope_type='contact' AND scope_id=NEW.contact_id;
    UPDATE ai_reply_feedback_profile_versions SET person_id=NEW.person_id WHERE scope_type='contact' AND scope_id=NEW.contact_id;
    UPDATE learning_preference_profiles SET person_id=NEW.person_id WHERE scope_type='contact' AND scope_id=NEW.contact_id;
    UPDATE r32_conversations SET person_id=NEW.person_id WHERE contact_id=NEW.contact_id;
  END;
  CREATE TRIGGER IF NOT EXISTS trg_person_contact_binding_reactivate
  AFTER UPDATE OF state,person_id ON person_contact_bindings WHEN NEW.state='active'
  BEGIN
    UPDATE customer_profiles SET person_id=NEW.person_id WHERE contact_id=NEW.contact_id;
    UPDATE customer_profile_evidence SET person_id=NEW.person_id WHERE canonical_contact_id=NEW.contact_id;
    UPDATE relationship_insights SET person_id=NEW.person_id WHERE contact_id=NEW.contact_id;
    UPDATE relationship_timeline_events SET person_id=NEW.person_id WHERE contact_id=NEW.contact_id;
    UPDATE customer_social_state SET person_id=NEW.person_id WHERE contact_id=NEW.contact_id;
    UPDATE customer_interaction_preferences SET person_id=NEW.person_id WHERE contact_id=NEW.contact_id;
    UPDATE interaction_policies SET person_id=NEW.person_id WHERE contact_id=NEW.contact_id;
    UPDATE ai_context_snapshots SET person_id=NEW.person_id WHERE contact_id=NEW.contact_id;
    UPDATE ai_reply_tasks SET person_id=NEW.person_id WHERE contact_id=NEW.contact_id;
    UPDATE ai_reply_candidates SET person_id=NEW.person_id WHERE contact_id=NEW.contact_id;
    UPDATE ai_reply_outbox SET person_id=NEW.person_id WHERE contact_id=NEW.contact_id;
    UPDATE ai_analysis_runs SET person_id=NEW.person_id WHERE contact_id=NEW.contact_id;
    UPDATE ai_candidate_generation_plans SET person_id=NEW.person_id WHERE contact_id=NEW.contact_id;
    UPDATE ai_director_strategies SET person_id=NEW.person_id WHERE contact_id=NEW.contact_id;
    UPDATE ai_reply_feedback_events SET person_id=NEW.person_id WHERE contact_id=NEW.contact_id;
    UPDATE learning_signal_ledger SET person_id=NEW.person_id WHERE contact_id=NEW.contact_id;
    UPDATE relationship_state_signals SET person_id=NEW.person_id WHERE contact_id=NEW.contact_id;
    UPDATE social_inference_corrections SET person_id=NEW.person_id WHERE contact_id=NEW.contact_id;
    UPDATE ai_reply_feedback_profiles SET person_id=NEW.person_id WHERE scope_type='contact' AND scope_id=NEW.contact_id;
    UPDATE ai_reply_feedback_profile_versions SET person_id=NEW.person_id WHERE scope_type='contact' AND scope_id=NEW.contact_id;
    UPDATE learning_preference_profiles SET person_id=NEW.person_id WHERE scope_type='contact' AND scope_id=NEW.contact_id;
    UPDATE r32_conversations SET person_id=NEW.person_id WHERE contact_id=NEW.contact_id;
  END;
  CREATE TRIGGER IF NOT EXISTS trg_conversation_binding_propagate
  AFTER INSERT ON conversation_bindings WHEN NEW.state='active'
  BEGIN
    UPDATE r32_conversations SET person_id=NEW.person_id WHERE session_key=NEW.conversation_id;
  END;
  CREATE TRIGGER IF NOT EXISTS trg_conversation_binding_reactivate
  AFTER UPDATE OF state,person_id ON conversation_bindings WHEN NEW.state='active'
  BEGIN
    UPDATE r32_conversations SET person_id=NEW.person_id WHERE session_key=NEW.conversation_id;
  END;
`);

}
function ensurePostMigrationConsistency(db) {
  const requiredTables = ['person_contact_bindings', 'conversation_bindings', 'identity_governance_operation_receipts'];
  for (const table of requiredTables) if (!tableExists(db, table)) throw error('SCHEMA_13_TABLE_MISSING', `Schema 13 required table is missing: ${table}`, { table });
  for (const [table, columns] of Object.entries({
    person_contact_bindings: ['person_id','contact_id','workspace_id','state','evidence_refs_json','merge_audit_id'],
    conversation_bindings: ['person_id','conversation_id','contact_id','platform','account_id','state','evidence_refs_json','merge_audit_id'],
    identity_governance_operation_receipts: ['receipt_id','audit_id','operation','status','before_json','after_json']
  })) for (const column of columns) if (!columnExists(db, table, column)) throw error('SCHEMA_13_COLUMN_MISSING', `Schema 13 column is missing: ${table}.${column}`, { table, column });
  for (const table of personAwareTables()) if (tableExists(db, table) && !columnExists(db, table, 'person_id')) throw error('SCHEMA_13_PERSON_ANCHOR_MISSING', `Person anchor missing from ${table}`, { table });
  const requiredTriggers = ['trg_person_contact_binding_propagate','trg_person_contact_binding_reactivate','trg_conversation_binding_propagate','trg_conversation_binding_reactivate'];
  for (const trigger of requiredTriggers) if (!db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name=?").get(trigger)) throw error('SCHEMA_13_TRIGGER_MISSING', `Schema 13 person anchor trigger is missing: ${trigger}`, { trigger });
  const version = schemaVersion(db);
  if (version < TARGET_SCHEMA_VERSION) throw error('SCHEMA_13_VERSION_INCOMPLETE', `Schema version ${version} is below ${TARGET_SCHEMA_VERSION}`, { actual: version, minimum: TARGET_SCHEMA_VERSION });
  const receipt = db.prepare('SELECT target_schema_version,status,checksum FROM r32_schema_migrations WHERE migration_id=?').get(MIGRATION_ID);
  if (!receipt || receipt.status !== 'completed' || Number(receipt.target_schema_version) !== TARGET_SCHEMA_VERSION || String(receipt.checksum) !== CHECKSUM) throw error('SCHEMA_13_MIGRATION_RECEIPT_INVALID', 'Schema 13 migration receipt is missing or invalid', { receipt: receipt || null });
  if (Number(db.prepare('PRAGMA foreign_keys').get()?.foreign_keys || 0) !== 1) throw error('SCHEMA_13_FOREIGN_KEYS_DISABLED', 'SQLite foreign key enforcement is disabled');
  return { ok: true, schemaVersion: version, migrationId: MIGRATION_ID, checksum: CHECKSUM, checkedAt: now() };
}
function applyRound12Round13FinalGovernanceClosure(db) {
  ensureMigrationTable(db);
  const completed = db.prepare("SELECT target_schema_version,status,checksum FROM r32_schema_migrations WHERE migration_id=? AND status='completed'").get(MIGRATION_ID);
  if (completed) {
    db.exec('BEGIN IMMEDIATE');
    try {
      ensurePersonAnchorColumns(db);
      ensurePersonAnchorTriggers(db);
      db.exec("UPDATE person_contact_bindings SET updated_at=updated_at WHERE state='active'");
      if (String(completed.checksum || '') !== CHECKSUM) db.prepare("UPDATE r32_schema_migrations SET checksum=?,report_json=? WHERE migration_id=?").run(CHECKSUM, JSON.stringify({ migrationId:MIGRATION_ID, schemaVersion:TARGET_SCHEMA_VERSION, checksum:CHECKSUM, additiveHardening:['person-anchor-triggers'], completedAt:now() }), MIGRATION_ID);
      db.exec('COMMIT');
    } catch (cause) { try { db.exec('ROLLBACK'); } catch (_) {} throw cause; }
    return { ok: true, executed: false, repaired: String(completed.checksum || '') !== CHECKSUM, migrationId: MIGRATION_ID, schemaVersion: TARGET_SCHEMA_VERSION, consistency: ensurePostMigrationConsistency(db) };
  }
  const startedAt = now();
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`
      INSERT INTO r32_schema_migrations(migration_id,target_schema_version,status,checksum,started_at,completed_at,report_json)
      VALUES(?,?,'running',?,?,'','{}')
      ON CONFLICT(migration_id) DO UPDATE SET target_schema_version=excluded.target_schema_version,status='running',checksum=excluded.checksum,started_at=excluded.started_at,completed_at='',report_json='{}'
    `).run(MIGRATION_ID, TARGET_SCHEMA_VERSION, CHECKSUM, startedAt);

    db.exec(`
      CREATE TABLE IF NOT EXISTS person_contact_bindings (
        person_id TEXT NOT NULL,
        contact_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL DEFAULT 'default',
        state TEXT NOT NULL DEFAULT 'active',
        source TEXT NOT NULL DEFAULT 'identity-authority',
        evidence_refs_json TEXT NOT NULL DEFAULT '[]',
        merge_audit_id TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(person_id,contact_id),
        FOREIGN KEY(person_id) REFERENCES persons(person_id) ON DELETE RESTRICT,
        FOREIGN KEY(contact_id) REFERENCES contacts(id) ON DELETE CASCADE,
        CHECK(state IN ('active','merged','detached','rolled-back'))
      ) STRICT;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_person_contact_active_contact
        ON person_contact_bindings(contact_id) WHERE state='active';
      CREATE INDEX IF NOT EXISTS idx_person_contact_person ON person_contact_bindings(person_id,state,updated_at DESC);

      CREATE TABLE IF NOT EXISTS conversation_bindings (
        person_id TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        contact_id TEXT NOT NULL DEFAULT '',
        platform TEXT NOT NULL DEFAULT '',
        account_id TEXT NOT NULL DEFAULT '',
        external_id TEXT NOT NULL DEFAULT '',
        state TEXT NOT NULL DEFAULT 'active',
        source TEXT NOT NULL DEFAULT 'identity-authority',
        evidence_refs_json TEXT NOT NULL DEFAULT '[]',
        merge_audit_id TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(person_id,conversation_id),
        FOREIGN KEY(person_id) REFERENCES persons(person_id) ON DELETE RESTRICT,
        CHECK(state IN ('active','merged','detached','rolled-back'))
      ) STRICT;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_conversation_binding_active_conversation
        ON conversation_bindings(conversation_id) WHERE state='active';
      CREATE INDEX IF NOT EXISTS idx_conversation_binding_person ON conversation_bindings(person_id,state,updated_at DESC);

      CREATE TABLE IF NOT EXISTS identity_governance_operation_receipts (
        receipt_id TEXT PRIMARY KEY,
        audit_id TEXT NOT NULL,
        operation TEXT NOT NULL,
        status TEXT NOT NULL,
        before_json TEXT NOT NULL DEFAULT '{}',
        after_json TEXT NOT NULL DEFAULT '{}',
        actor TEXT NOT NULL DEFAULT 'system',
        reason TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        FOREIGN KEY(audit_id) REFERENCES identity_link_audit(audit_id) ON DELETE RESTRICT,
        UNIQUE(audit_id,status),
        CHECK(status IN ('applied','rolled-back','reapplied','blocked'))
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_identity_governance_receipt_audit ON identity_governance_operation_receipts(audit_id,created_at DESC);
    `);

    ensurePersonAnchorColumns(db);
    ensurePersonAnchorTriggers(db);

    // Backfill direct contact anchors from Person.profile_contact_id and existing contact identities.
    db.exec(`
      INSERT OR IGNORE INTO person_contact_bindings(person_id,contact_id,workspace_id,state,source,evidence_refs_json,merge_audit_id,created_at,updated_at)
      SELECT p.person_id,p.profile_contact_id,p.workspace_id,'active','schema13-backfill','[]','',p.created_at,p.updated_at
      FROM persons p JOIN contacts c ON c.id=p.profile_contact_id
      WHERE p.profile_contact_id<>'' AND p.state<>'tombstoned';

      UPDATE customer_profiles SET person_id=COALESCE((SELECT b.person_id FROM person_contact_bindings b WHERE b.contact_id=customer_profiles.contact_id AND b.state='active' LIMIT 1),'') WHERE person_id='';
      UPDATE customer_profile_evidence SET person_id=COALESCE((SELECT b.person_id FROM person_contact_bindings b WHERE b.contact_id=customer_profile_evidence.canonical_contact_id AND b.state='active' LIMIT 1),'') WHERE person_id='';
      UPDATE relationship_insights SET person_id=COALESCE((SELECT b.person_id FROM person_contact_bindings b WHERE b.contact_id=relationship_insights.contact_id AND b.state='active' LIMIT 1),'') WHERE person_id='';
      UPDATE relationship_timeline_events SET person_id=COALESCE((SELECT b.person_id FROM person_contact_bindings b WHERE b.contact_id=relationship_timeline_events.contact_id AND b.state='active' LIMIT 1),'') WHERE person_id='';
      UPDATE customer_social_state SET person_id=COALESCE((SELECT b.person_id FROM person_contact_bindings b WHERE b.contact_id=customer_social_state.contact_id AND b.state='active' LIMIT 1),'') WHERE person_id='';
      UPDATE customer_interaction_preferences SET person_id=COALESCE((SELECT b.person_id FROM person_contact_bindings b WHERE b.contact_id=customer_interaction_preferences.contact_id AND b.state='active' LIMIT 1),'') WHERE person_id='';
      UPDATE interaction_policies SET person_id=COALESCE((SELECT b.person_id FROM person_contact_bindings b WHERE b.contact_id=interaction_policies.contact_id AND b.state='active' LIMIT 1),'') WHERE person_id='';
      UPDATE ai_context_snapshots SET person_id=COALESCE((SELECT b.person_id FROM person_contact_bindings b WHERE b.contact_id=ai_context_snapshots.contact_id AND b.state='active' LIMIT 1),'') WHERE person_id='';
      UPDATE ai_reply_tasks SET person_id=COALESCE((SELECT b.person_id FROM person_contact_bindings b WHERE b.contact_id=ai_reply_tasks.contact_id AND b.state='active' LIMIT 1),'') WHERE person_id='';
      UPDATE ai_reply_candidates SET person_id=COALESCE((SELECT b.person_id FROM person_contact_bindings b WHERE b.contact_id=ai_reply_candidates.contact_id AND b.state='active' LIMIT 1),'') WHERE person_id='';
      UPDATE ai_reply_outbox SET person_id=COALESCE((SELECT b.person_id FROM person_contact_bindings b WHERE b.contact_id=ai_reply_outbox.contact_id AND b.state='active' LIMIT 1),'') WHERE person_id='';
      UPDATE ai_analysis_runs SET person_id=COALESCE((SELECT b.person_id FROM person_contact_bindings b WHERE b.contact_id=ai_analysis_runs.contact_id AND b.state='active' LIMIT 1),'') WHERE person_id='';
      UPDATE ai_candidate_generation_plans SET person_id=COALESCE((SELECT b.person_id FROM person_contact_bindings b WHERE b.contact_id=ai_candidate_generation_plans.contact_id AND b.state='active' LIMIT 1),'') WHERE person_id='';
      UPDATE ai_director_strategies SET person_id=COALESCE((SELECT b.person_id FROM person_contact_bindings b WHERE b.contact_id=ai_director_strategies.contact_id AND b.state='active' LIMIT 1),'') WHERE person_id='';
      UPDATE ai_reply_feedback_events SET person_id=COALESCE((SELECT b.person_id FROM person_contact_bindings b WHERE b.contact_id=ai_reply_feedback_events.contact_id AND b.state='active' LIMIT 1),'') WHERE person_id='';
      UPDATE learning_signal_ledger SET person_id=COALESCE((SELECT b.person_id FROM person_contact_bindings b WHERE b.contact_id=learning_signal_ledger.contact_id AND b.state='active' LIMIT 1),'') WHERE person_id='';
      UPDATE relationship_state_signals SET person_id=COALESCE((SELECT b.person_id FROM person_contact_bindings b WHERE b.contact_id=relationship_state_signals.contact_id AND b.state='active' LIMIT 1),'') WHERE person_id='';
      UPDATE social_inference_corrections SET person_id=COALESCE((SELECT b.person_id FROM person_contact_bindings b WHERE b.contact_id=social_inference_corrections.contact_id AND b.state='active' LIMIT 1),'') WHERE person_id='';
      UPDATE ai_reply_feedback_profiles SET person_id=COALESCE((SELECT b.person_id FROM person_contact_bindings b WHERE b.contact_id=ai_reply_feedback_profiles.scope_id AND b.state='active' LIMIT 1),'') WHERE person_id='' AND scope_type='contact';
      UPDATE ai_reply_feedback_profile_versions SET person_id=COALESCE((SELECT b.person_id FROM person_contact_bindings b WHERE b.contact_id=ai_reply_feedback_profile_versions.scope_id AND b.state='active' LIMIT 1),'') WHERE person_id='' AND scope_type='contact';
      UPDATE learning_preference_profiles SET person_id=COALESCE((SELECT b.person_id FROM person_contact_bindings b WHERE b.contact_id=learning_preference_profiles.scope_id AND b.state='active' LIMIT 1),'') WHERE person_id='' AND scope_type='contact';
      UPDATE r32_conversations SET person_id=COALESCE((SELECT b.person_id FROM person_contact_bindings b WHERE b.contact_id=r32_conversations.contact_id AND b.state='active' LIMIT 1),'') WHERE person_id='';

      INSERT OR IGNORE INTO conversation_bindings(person_id,conversation_id,contact_id,platform,account_id,external_id,state,source,evidence_refs_json,merge_audit_id,created_at,updated_at)
      SELECT c.person_id,c.session_key,c.contact_id,c.platform,c.account_id,'','active','schema13-backfill','[]','',c.created_at,c.updated_at
      FROM r32_conversations c WHERE c.person_id<>'';
    `);

    const completedAt = now();
    setSchemaVersion(db, TARGET_SCHEMA_VERSION, completedAt);
    const report = { migrationId: MIGRATION_ID, schemaVersion: TARGET_SCHEMA_VERSION, checksum: CHECKSUM, changes: ['person_contact_bindings','conversation_bindings','identity_governance_operation_receipts','person_id anchors'], completedAt };
    db.prepare("UPDATE r32_schema_migrations SET status='completed',completed_at=?,report_json=? WHERE migration_id=?").run(completedAt, JSON.stringify(report), MIGRATION_ID);
    db.exec('COMMIT');
    return { ok: true, executed: true, ...report, consistency: ensurePostMigrationConsistency(db) };
  } catch (cause) {
    try { db.exec('ROLLBACK'); } catch (_) {}
    throw Object.assign(cause, { code: cause.code || 'ROUND12_13_FINAL_GOVERNANCE_MIGRATION_FAILED', migrationId: MIGRATION_ID });
  }
}

module.exports = { MIGRATION_ID, TARGET_SCHEMA_VERSION, CHECKSUM, applyRound12Round13FinalGovernanceClosure, ensurePostMigrationConsistency };
