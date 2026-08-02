'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createCompactSnapshotTarget } = require('./migrationSnapshotManifest');
const { resolveMigrationSnapshotRoot } = require('./migrationSnapshotRoot');

const MIGRATION_ID = '010_round12_platform_core_unification';
const TARGET_SCHEMA_VERSION = 10;
const CHECKSUM = 'round12-platform-core-unification-v1';

function now() { return new Date().toISOString(); }
function quoteIdentifier(value) { return `"${String(value).replace(/"/g, '""')}"`; }
function hasColumn(db, table, column) {
  return db.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all().some(row => row.name === column);
}
function addColumn(db, table, column, definition) {
  if (!hasColumn(db, table, column)) db.exec(`ALTER TABLE ${quoteIdentifier(table)} ADD COLUMN ${quoteIdentifier(column)} ${definition}`);
}
function createSnapshot(db) {
  let dbPath = '';
  try { dbPath = db.prepare("PRAGMA database_list").all().find(row => row.name === 'main')?.file || ''; } catch (_) {}
  if (!dbPath || dbPath === ':memory:' || !fs.existsSync(dbPath)) return { created: false, reason: 'non-file-database' };
  try { db.exec('PRAGMA wal_checkpoint(FULL)'); } catch (_) {}
  const root = resolveMigrationSnapshotRoot(dbPath);
  fs.mkdirSync(root, { recursive: true });
  // Bind the snapshot to a unique process generation. Different isolated
  // databases may legitimately migrate in parallel while sharing the same
  // migration-backups parent; timestamp-only names are not collision safe.
  const generation = crypto.randomUUID();
  const { targetPath: target } = createCompactSnapshotTarget({
    root, dbPath, migrationId: MIGRATION_ID, processGeneration: generation, extension: 'sqlite'
  });
  const escaped = target.replace(/'/g, "''");
  db.exec(`VACUUM INTO '${escaped}'`);
  const stat = fs.statSync(target);
  if (!stat.isFile() || stat.size <= 0) throw Object.assign(new Error('Round 12 migration snapshot is empty'), { code: 'ROUND12_MIGRATION_SNAPSHOT_FAILED' });
  return {
    created: true,
    path: target,
    bytes: stat.size,
    sha256: crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex'),
    createdAt: now()
  };
}
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
  const rows = db.prepare("SELECT key, value_json FROM r32_meta WHERE key IN ('schema_version','schemaVersion')").all();
  const versions = [];
  for (const row of rows) {
    let parsed;
    try { parsed = JSON.parse(row.value_json); } catch (_) { parsed = row.value_json; }
    const value = Number(parsed);
    if (!Number.isInteger(value) || value < 0) {
      throw Object.assign(new Error(`Database schema metadata ${row.key} is invalid`), {
        code: 'SCHEMA_VERSION_INVALID', key: row.key, value: row.value_json
      });
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
function ensurePostMigrationConsistency(db) {
  const requiredTables = [
    'persons', 'identity_links', 'identity_link_audit',
    'platform_capability_observations', 'platform_health_states',
    'domain_events', 'domain_projection_receipts',
    'send_policy_versions', 'ai_director_strategies', 'ai_candidate_generation_plans',
    'learning_signal_ledger', 'learning_preference_profiles', 'learning_promotion_audit'
  ];
  const existing = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => String(row.name || '')));
  const missing = requiredTables.filter(name => !existing.has(name));
  if (missing.length) {
    const error = new Error(`Round 12 schema is incomplete: ${missing.join(', ')}`);
    error.code = 'ROUND12_SCHEMA_INCOMPLETE';
    error.missingTables = missing;
    throw error;
  }
  const requiredColumns = {
    identity_links: ['workspace_id','person_id','platform','source_account_id','external_id','link_status','evidence_refs_json','superseded_by'],
    domain_events: ['event_id','platform','source_account_id','external_event_id','event_type','idempotency_key','payload_sha256','replay_state'],
    domain_projection_receipts: ['projector_name','projector_version','event_id','projection_status','failure_code'],
    r32_send_queue: ['outbox_id','send_policy_json','capability_snapshot_id','quality_tier','emergency_mode'],
    ai_reply_outbox: ['target_language','final_text_sha256','idempotency_key','send_policy_version','capability_snapshot_id','approval_receipt_id','quality_route_receipt_json','learning_eligible']
  };
  const missingColumns = [];
  for (const [table, columns] of Object.entries(requiredColumns)) {
    const present = new Set(db.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all().map(row => String(row.name || '')));
    for (const column of columns) if (!present.has(column)) missingColumns.push(`${table}.${column}`);
  }
  if (missingColumns.length) throw Object.assign(new Error(`Round 12 schema columns are incomplete: ${missingColumns.join(', ')}`), { code: 'ROUND12_SCHEMA_COLUMNS_INCOMPLETE', missingColumns });
  const requiredIndexes = [
    'idx_identity_links_scope', 'idx_domain_events_scope', 'idx_projection_receipts_status',
    'idx_ai_reply_outbox_idempotency', 'idx_send_queue_outbox'
  ];
  const indexes = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map(row => String(row.name || '')));
  const missingIndexes = requiredIndexes.filter(name => !indexes.has(name));
  if (missingIndexes.length) throw Object.assign(new Error(`Round 12 schema indexes are incomplete: ${missingIndexes.join(', ')}`), { code: 'ROUND12_SCHEMA_INDEXES_INCOMPLETE', missingIndexes });
  const version = schemaVersion(db);
  if (version < TARGET_SCHEMA_VERSION) throw Object.assign(new Error(`Round 12 schema version is ${version}, expected at least ${TARGET_SCHEMA_VERSION}`), { code: 'ROUND12_SCHEMA_VERSION_INCOMPLETE', actual: version, expected: TARGET_SCHEMA_VERSION });
  // Later additive migrations remain compatible when the Round 12 receipt and owned structures are intact.
  const migration = db.prepare('SELECT target_schema_version, status, checksum FROM r32_schema_migrations WHERE migration_id=?').get(MIGRATION_ID);
  if (!migration || migration.status !== 'completed') throw Object.assign(new Error('Round 12 migration receipt is missing or incomplete'), { code: 'ROUND12_MIGRATION_RECEIPT_INVALID' });
  if (Number(migration.target_schema_version || 0) !== TARGET_SCHEMA_VERSION || String(migration.checksum || '') !== CHECKSUM) {
    throw Object.assign(new Error('Round 12 migration receipt checksum/version mismatch'), {
      code: 'ROUND12_MIGRATION_CHECKSUM_MISMATCH', actualChecksum: String(migration.checksum || ''), expectedChecksum: CHECKSUM,
      actualVersion: Number(migration.target_schema_version || 0), expectedVersion: TARGET_SCHEMA_VERSION
    });
  }
  const foreignKeys = Number(db.prepare('PRAGMA foreign_keys').get()?.foreign_keys || 0);
  if (foreignKeys !== 1) throw Object.assign(new Error('SQLite foreign key enforcement is disabled'), { code: 'ROUND12_FOREIGN_KEYS_DISABLED' });
  return { ok: true, schemaVersion: version, requiredTables, requiredColumns, requiredIndexes, checksum: CHECKSUM, checkedAt: now() };
}

function applyRound12PlatformCoreUnification(db) {
  ensureMigrationTable(db);
  const completed = db.prepare("SELECT target_schema_version, status, checksum FROM r32_schema_migrations WHERE migration_id=? AND status='completed'").get(MIGRATION_ID);
  if (completed) return { ok: true, executed: false, migrationId: MIGRATION_ID, schemaVersion: TARGET_SCHEMA_VERSION, consistency: ensurePostMigrationConsistency(db) };

  const startedAt = now();
  const snapshot = createSnapshot(db);
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`
      INSERT INTO r32_schema_migrations(migration_id, target_schema_version, status, checksum, started_at, completed_at, report_json)
      VALUES (?, ?, 'running', ?, ?, '', '{}')
      ON CONFLICT(migration_id) DO UPDATE SET
        target_schema_version=excluded.target_schema_version,
        status='running', checksum=excluded.checksum, started_at=excluded.started_at,
        completed_at='', report_json='{}'
    `).run(MIGRATION_ID, TARGET_SCHEMA_VERSION, CHECKSUM, startedAt);

    db.exec(`
      CREATE TABLE IF NOT EXISTS persons (
        person_id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL DEFAULT 'default',
        display_name TEXT NOT NULL DEFAULT '',
        state TEXT NOT NULL DEFAULT 'active',
        profile_contact_id TEXT NOT NULL DEFAULT '',
        confidence REAL NOT NULL DEFAULT 1,
        payload_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK(state IN ('active','merged','disputed','tombstoned'))
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_persons_workspace ON persons(workspace_id, state, updated_at DESC);

      CREATE TABLE IF NOT EXISTS identity_links (
        identity_link_id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL DEFAULT 'default',
        person_id TEXT NOT NULL,
        platform TEXT NOT NULL,
        source_account_id TEXT NOT NULL,
        external_id TEXT NOT NULL,
        link_status TEXT NOT NULL DEFAULT 'observed',
        confidence REAL NOT NULL DEFAULT 0,
        verification_method TEXT NOT NULL DEFAULT '',
        evidence_refs_json TEXT NOT NULL DEFAULT '[]',
        created_by TEXT NOT NULL DEFAULT 'system',
        superseded_by TEXT NOT NULL DEFAULT '',
        payload_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(person_id) REFERENCES persons(person_id) ON DELETE RESTRICT,
        UNIQUE(workspace_id, platform, source_account_id, external_id),
        CHECK(link_status IN ('observed','suggested','verified','merged','disputed','detached'))
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_identity_links_person ON identity_links(person_id, link_status, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_identity_links_scope ON identity_links(workspace_id, platform, source_account_id, external_id);

      CREATE TABLE IF NOT EXISTS identity_link_audit (
        audit_id TEXT PRIMARY KEY,
        operation TEXT NOT NULL,
        workspace_id TEXT NOT NULL DEFAULT 'default',
        source_person_id TEXT NOT NULL DEFAULT '',
        target_person_id TEXT NOT NULL DEFAULT '',
        identity_link_id TEXT NOT NULL DEFAULT '',
        before_json TEXT NOT NULL DEFAULT '{}',
        after_json TEXT NOT NULL DEFAULT '{}',
        evidence_refs_json TEXT NOT NULL DEFAULT '[]',
        rollback_plan_json TEXT NOT NULL DEFAULT '{}',
        reason TEXT NOT NULL DEFAULT '',
        actor TEXT NOT NULL DEFAULT 'system',
        created_at TEXT NOT NULL,
        CHECK(operation IN ('observe','suggest','verify','merge','detach','split','rollback','dispute'))
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_identity_link_audit_person ON identity_link_audit(source_person_id, target_person_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS platform_capability_observations (
        observation_id TEXT PRIMARY KEY,
        authority TEXT NOT NULL DEFAULT 'PlatformCapabilityAuthority',
        scope_type TEXT NOT NULL,
        scope_id TEXT NOT NULL,
        platform TEXT NOT NULL DEFAULT '',
        account_id TEXT NOT NULL DEFAULT '',
        capability_id TEXT NOT NULL,
        support TEXT NOT NULL,
        availability TEXT NOT NULL,
        reason_code TEXT NOT NULL DEFAULT '',
        constraints_json TEXT NOT NULL DEFAULT '[]',
        evidence_json TEXT NOT NULL DEFAULT '{}',
        observed_at TEXT NOT NULL,
        expires_at TEXT NOT NULL DEFAULT '',
        UNIQUE(scope_type, scope_id, capability_id, observed_at)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_capability_observation_scope ON platform_capability_observations(platform, account_id, capability_id, observed_at DESC);

      CREATE TABLE IF NOT EXISTS platform_health_states (
        health_state_id TEXT PRIMARY KEY,
        scope_type TEXT NOT NULL,
        scope_id TEXT NOT NULL,
        platform TEXT NOT NULL DEFAULT '',
        account_id TEXT NOT NULL DEFAULT '',
        health TEXT NOT NULL,
        reason_code TEXT NOT NULL DEFAULT '',
        next_action TEXT NOT NULL DEFAULT '',
        capability_snapshot_id TEXT NOT NULL DEFAULT '',
        evidence_json TEXT NOT NULL DEFAULT '{}',
        observed_at TEXT NOT NULL,
        expires_at TEXT NOT NULL DEFAULT '',
        UNIQUE(scope_type, scope_id, observed_at)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_platform_health_scope ON platform_health_states(scope_type, platform, account_id, observed_at DESC);

      CREATE TABLE IF NOT EXISTS domain_events (
        event_id TEXT PRIMARY KEY,
        schema_version INTEGER NOT NULL DEFAULT 1,
        platform TEXT NOT NULL,
        source_account_id TEXT NOT NULL,
        external_event_id TEXT NOT NULL DEFAULT '',
        event_type TEXT NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE,
        correlation_id TEXT NOT NULL DEFAULT '',
        causation_id TEXT NOT NULL DEFAULT '',
        occurred_at TEXT NOT NULL,
        received_at TEXT NOT NULL,
        redaction_version TEXT NOT NULL DEFAULT 'v1',
        payload_json TEXT NOT NULL DEFAULT '{}',
        payload_sha256 TEXT NOT NULL DEFAULT '',
        retention_until TEXT NOT NULL DEFAULT '',
        replay_state TEXT NOT NULL DEFAULT 'available',
        CHECK(replay_state IN ('available','quarantined','expired','replayed'))
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_domain_events_scope ON domain_events(platform, source_account_id, occurred_at, event_id);
      CREATE INDEX IF NOT EXISTS idx_domain_events_type ON domain_events(event_type, received_at DESC);

      CREATE TABLE IF NOT EXISTS domain_projection_receipts (
        projector_name TEXT NOT NULL,
        projector_version TEXT NOT NULL,
        event_id TEXT NOT NULL,
        projection_status TEXT NOT NULL,
        projection_hash TEXT NOT NULL DEFAULT '',
        target_refs_json TEXT NOT NULL DEFAULT '[]',
        failure_code TEXT NOT NULL DEFAULT '',
        failure_reason TEXT NOT NULL DEFAULT '',
        attempt INTEGER NOT NULL DEFAULT 1,
        projected_at TEXT NOT NULL,
        PRIMARY KEY(projector_name, projector_version, event_id),
        FOREIGN KEY(event_id) REFERENCES domain_events(event_id) ON DELETE CASCADE,
        CHECK(projection_status IN ('shadow-match','shadow-mismatch','applied','failed','skipped'))
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_projection_receipts_status ON domain_projection_receipts(projection_status, projected_at DESC);

      CREATE TABLE IF NOT EXISTS send_policy_versions (
        policy_version TEXT PRIMARY KEY,
        policy_json TEXT NOT NULL,
        policy_sha256 TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'candidate',
        created_by TEXT NOT NULL DEFAULT 'system',
        created_at TEXT NOT NULL,
        activated_at TEXT NOT NULL DEFAULT '',
        CHECK(state IN ('candidate','active','retired','rolled-back'))
      ) STRICT;

      CREATE TABLE IF NOT EXISTS ai_director_strategies (
        strategy_id TEXT PRIMARY KEY,
        contact_id TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        strategy_version INTEGER NOT NULL DEFAULT 1,
        conversation_generation TEXT NOT NULL DEFAULT '',
        persona_version_id INTEGER NOT NULL DEFAULT 0,
        memory_snapshot_id TEXT NOT NULL DEFAULT '',
        learning_profile_version INTEGER NOT NULL DEFAULT 0,
        strategy_json TEXT NOT NULL,
        strategy_sha256 TEXT NOT NULL,
        evidence_refs_json TEXT NOT NULL DEFAULT '[]',
        state TEXT NOT NULL DEFAULT 'active',
        expires_on_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK(state IN ('active','expired','superseded','rejected'))
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_director_strategy_conversation ON ai_director_strategies(conversation_id, state, updated_at DESC);

      CREATE TABLE IF NOT EXISTS ai_candidate_generation_plans (
        plan_id TEXT PRIMARY KEY,
        strategy_id TEXT NOT NULL,
        contact_id TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        candidate_count INTEGER NOT NULL DEFAULT 3,
        shared_constraints_json TEXT NOT NULL DEFAULT '{}',
        branches_json TEXT NOT NULL DEFAULT '[]',
        plan_sha256 TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(strategy_id) REFERENCES ai_director_strategies(strategy_id) ON DELETE RESTRICT,
        CHECK(candidate_count BETWEEN 1 AND 5),
        CHECK(state IN ('active','consumed','expired','superseded'))
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_candidate_plan_conversation ON ai_candidate_generation_plans(conversation_id, state, updated_at DESC);

      CREATE TABLE IF NOT EXISTS learning_signal_ledger (
        signal_id TEXT PRIMARY KEY,
        idempotency_key TEXT NOT NULL UNIQUE,
        learning_level TEXT NOT NULL,
        scope_type TEXT NOT NULL,
        scope_id TEXT NOT NULL,
        contact_id TEXT NOT NULL DEFAULT '',
        conversation_id TEXT NOT NULL DEFAULT '',
        candidate_id TEXT NOT NULL DEFAULT '',
        outbox_id TEXT NOT NULL DEFAULT '',
        signal_type TEXT NOT NULL,
        signal_json TEXT NOT NULL DEFAULT '{}',
        quality_tier TEXT NOT NULL DEFAULT '',
        emergency_mode INTEGER NOT NULL DEFAULT 0,
        learning_eligible INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        CHECK(learning_level IN ('L1','L2','L3'))
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_learning_signal_scope ON learning_signal_ledger(scope_type, scope_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_learning_signal_contact ON learning_signal_ledger(contact_id, conversation_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS learning_preference_profiles (
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
        PRIMARY KEY(scope_type, scope_id, learning_level, version),
        CHECK(learning_level IN ('L1','L2','L3')),
        CHECK(state IN ('candidate','active','rejected','rolled-back','forgotten'))
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_learning_profile_active ON learning_preference_profiles(scope_type, scope_id, learning_level, state, version DESC);

      CREATE TABLE IF NOT EXISTS learning_promotion_audit (
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
        CHECK(decision IN ('approved','rejected','rolled-back','forgotten'))
      ) STRICT;
    `);

    addColumn(db, 'ai_reply_outbox', 'target_language', "TEXT NOT NULL DEFAULT ''");
    addColumn(db, 'ai_reply_outbox', 'final_text_sha256', "TEXT NOT NULL DEFAULT ''");
    addColumn(db, 'ai_reply_outbox', 'idempotency_key', "TEXT NOT NULL DEFAULT ''");
    addColumn(db, 'ai_reply_outbox', 'send_policy_version', "TEXT NOT NULL DEFAULT ''");
    addColumn(db, 'ai_reply_outbox', 'capability_snapshot_id', "TEXT NOT NULL DEFAULT ''");
    addColumn(db, 'ai_reply_outbox', 'approval_receipt_id', "TEXT NOT NULL DEFAULT ''");
    addColumn(db, 'ai_reply_outbox', 'quality_route_receipt_json', "TEXT NOT NULL DEFAULT '{}'");
    addColumn(db, 'ai_reply_outbox', 'learning_eligible', 'INTEGER NOT NULL DEFAULT 1');
    addColumn(db, 'r32_send_queue', 'outbox_id', "TEXT NOT NULL DEFAULT ''");
    addColumn(db, 'r32_send_queue', 'send_policy_json', "TEXT NOT NULL DEFAULT '{}'");
    addColumn(db, 'r32_send_queue', 'capability_snapshot_id', "TEXT NOT NULL DEFAULT ''");
    addColumn(db, 'r32_send_queue', 'quality_tier', "TEXT NOT NULL DEFAULT ''");
    addColumn(db, 'r32_send_queue', 'emergency_mode', 'INTEGER NOT NULL DEFAULT 0');

    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_reply_outbox_idempotency
        ON ai_reply_outbox(idempotency_key) WHERE idempotency_key <> '';
      CREATE INDEX IF NOT EXISTS idx_ai_reply_outbox_capability
        ON ai_reply_outbox(capability_snapshot_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_send_queue_outbox
        ON r32_send_queue(outbox_id, state, updated_at DESC);
    `);

    const completedAt = now();
    const report = {
      migrationId: MIGRATION_ID,
      schemaVersion: TARGET_SCHEMA_VERSION,
      checksum: CHECKSUM,
      snapshot,
      createdTables: [
        'persons', 'identity_links', 'identity_link_audit',
        'platform_capability_observations', 'platform_health_states',
        'domain_events', 'domain_projection_receipts', 'send_policy_versions',
        'ai_director_strategies', 'ai_candidate_generation_plans',
        'learning_signal_ledger', 'learning_preference_profiles', 'learning_promotion_audit'
      ],
      completedAt
    };
    setSchemaVersion(db, TARGET_SCHEMA_VERSION, completedAt);
    db.prepare(`
      UPDATE r32_schema_migrations
      SET status='completed', completed_at=?, report_json=?
      WHERE migration_id=?
    `).run(completedAt, JSON.stringify(report), MIGRATION_ID);
    db.exec('COMMIT');
    return { ok: true, executed: true, ...report };
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch (_) {}
    throw Object.assign(error, { code: error.code || 'ROUND12_PLATFORM_CORE_MIGRATION_FAILED', migrationId: MIGRATION_ID, snapshot });
  }
}

module.exports = {
  MIGRATION_ID,
  TARGET_SCHEMA_VERSION,
  CHECKSUM,
  applyRound12PlatformCoreUnification,
  ensurePostMigrationConsistency,
  createSnapshot
};
