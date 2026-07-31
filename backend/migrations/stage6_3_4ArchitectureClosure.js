'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createVerifiedSnapshot } = require('./migrationSnapshotManifest');

const MIGRATION_ID = '009_stage6_3_4_architecture_closure';
const TARGET_SCHEMA_VERSION = 9;

function now() { return new Date().toISOString(); }
function quoteIdentifier(value) { return `"${String(value).replace(/"/g, '""')}"`; }

function hasColumn(db, table, column) {
  return db.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all().some(row => row.name === column);
}

function addColumn(db, table, column, definition) {
  if (!hasColumn(db, table, column)) db.exec(`ALTER TABLE ${quoteIdentifier(table)} ADD COLUMN ${quoteIdentifier(column)} ${definition}`);
}

function ensureSetting(db, namespace, value) {
  const timestamp = now();
  db.prepare(`
    INSERT INTO r32_settings(namespace, key, value_json, updated_at)
    VALUES (?, 'document', ?, ?)
    ON CONFLICT(namespace, key) DO NOTHING
  `).run(namespace, JSON.stringify(value), timestamp);
}


function createPreMigrationSnapshot(db) {
  let dbPath = '';
  try {
    dbPath = db.prepare("PRAGMA database_list").all().find(row => row.name === 'main')?.file || '';
  } catch (error) {
    throw Object.assign(new Error('Migration snapshot database identity is unavailable', { cause: error }), {
      code: 'MIGRATION_SNAPSHOT_IDENTITY_INVALID'
    });
  }
  if (dbPath === ':memory:' || /^file:.*(?:[?&]mode=memory(?:&|$))/iu.test(dbPath)) {
    return { created: false, reason: 'non-file-database' };
  }
  if (!dbPath || !fs.existsSync(dbPath)) {
    throw Object.assign(new Error('Migration snapshot database identity is invalid'), {
      code: 'MIGRATION_SNAPSHOT_IDENTITY_INVALID'
    });
  }
  try {
    const rows = db.prepare('PRAGMA wal_checkpoint(FULL)').all();
    if (!Array.isArray(rows) || rows.length !== 1) {
      throw new Error('WAL checkpoint returned an ambiguous result');
    }
    const row = rows[0] || {};
    const busy = Number(row.busy ?? row[0]);
    const log = Number(row.log ?? row[1]);
    const checkpointed = Number(row.checkpointed ?? row[2]);
    if (![busy, log, checkpointed].every(Number.isInteger)
      || busy !== 0 || log < 0 || checkpointed < 0 || checkpointed < log) {
      throw new Error(`WAL checkpoint incomplete: busy=${busy}, log=${log}, checkpointed=${checkpointed}`);
    }
  } catch (error) {
    throw Object.assign(new Error('Migration snapshot WAL checkpoint failed', { cause: error }), {
      code: 'MIGRATION_SNAPSHOT_CHECKPOINT_FAILED'
    });
  }
  // Keep migration safety snapshots outside the live store tree so normal backups
  // cannot recursively capture snapshot WAL/SHM companions.
  const root = path.join(path.dirname(path.dirname(dbPath)), 'migration-backups');
  fs.mkdirSync(root, { recursive: true });
  const generation = crypto.randomUUID();
  return createVerifiedSnapshot({
    dbPath,
    migrationId: MIGRATION_ID,
    processGeneration: generation,
    root
  });
}


const REQUIRED_SETTING_DOCUMENTS = Object.freeze({
  'desktop-settings': {
    schemaVersion: 2, autoLaunch: false, startMinimized: false, closeToTray: true,
    autoConnectAccounts: true, backupOnStart: true, gifAutoplay: true,
    stickerAutoplay: true, mediaAutoDownload: false, pauseAnimationWhenHidden: true,
    updatedAt: ''
  },
  'notification-settings': {
    schemaVersion: 3, enabled: true, desktopEnabled: true, soundEnabled: true,
    soundVolume: 0.68, paused: false, privacy: 'preview', activeConversationId: '',
    mutedConversations: [], mutedAccounts: [], mutedPlatforms: [],
    dnd: { enabled: false, start: '22:30', end: '07:30' }, updatedAt: ''
  },
  'system-policy': {
    schemaVersion: 1, emergencyStop: false, privacyMode: true,
    reason: '', updatedAt: '', updatedBy: 'system'
  },
  'performance-settings': {
    schemaVersion: 1, messagePageSize: 120, streamChunkSize: 40,
    maxMessagesPerConversation: 800, maxCachedConversations: 8,
    inactiveConversationRetain: 80, softMemoryLimitMb: 768, updatedAt: ''
  }
});

function ensurePostMigrationConsistency(db) {
  const repaired = { namespaces: [], accountRows: 0, contactRows: 0, schemaVersion: TARGET_SCHEMA_VERSION };
  for (const [namespace, value] of Object.entries(REQUIRED_SETTING_DOCUMENTS)) {
    const present = db.prepare(`SELECT 1 FROM r32_settings WHERE namespace=? AND key='document'`).get(namespace);
    if (!present) {
      ensureSetting(db, namespace, value);
      repaired.namespaces.push(namespace);
    }
  }
  repaired.accountRows = Number(db.prepare(`
    UPDATE r32_accounts
    SET canonical_account_id=CASE WHEN COALESCE(canonical_account_id,'')='' THEN id ELSE canonical_account_id END,
        lifecycle_state=CASE
          WHEN COALESCE(tombstoned_at,'')<>'' THEN 'tombstoned'
          WHEN COALESCE(merged_into_id,'')<>'' THEN 'merged'
          WHEN json_extract(payload_json,'$.paused')=1 OR state='paused' THEN 'paused'
          ELSE COALESCE(NULLIF(lifecycle_state,''),'active')
        END
    WHERE COALESCE(canonical_account_id,'')='' OR COALESCE(lifecycle_state,'')=''
  `).run().changes || 0);
  repaired.contactRows = Number(db.prepare(`
    UPDATE contacts
    SET canonical_contact_id=CASE WHEN COALESCE(canonical_contact_id,'')='' THEN id ELSE canonical_contact_id END
    WHERE COALESCE(canonical_contact_id,'')=''
  `).run().changes || 0);
  const schemaRow = db.prepare(`SELECT value_json FROM r32_meta WHERE key='schemaVersion'`).get();
  let currentSchema = 0;
  try { currentSchema = Number(JSON.parse(schemaRow?.value_json || '0')) || 0; } catch (_) {}
  if (currentSchema < TARGET_SCHEMA_VERSION) {
    db.prepare(`
      INSERT INTO r32_meta(key, value_json, updated_at)
      VALUES ('schemaVersion', ?, ?)
      ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_at=excluded.updated_at
    `).run(JSON.stringify(TARGET_SCHEMA_VERSION), now());
  }
  return { ok: true, repaired: repaired.namespaces.length > 0 || repaired.accountRows > 0 || repaired.contactRows > 0, ...repaired, checkedAt: now() };
}

function applyStage634ArchitectureClosure(db) {
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

  const completed = db.prepare(`SELECT 1 FROM r32_schema_migrations WHERE migration_id=? AND status='completed'`).get(MIGRATION_ID);
  if (completed) {
    const consistency = ensurePostMigrationConsistency(db);
    return { ok: true, executed: false, migrationId: MIGRATION_ID, schemaVersion: TARGET_SCHEMA_VERSION, consistency };
  }

  const startedAt = now();
  const preMigrationSnapshot = createPreMigrationSnapshot(db);
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`
      INSERT INTO r32_schema_migrations(migration_id, target_schema_version, status, checksum, started_at, completed_at, report_json)
      VALUES (?, ?, 'running', ?, ?, '', '{}')
      ON CONFLICT(migration_id) DO UPDATE SET
        target_schema_version=excluded.target_schema_version,
        status='running',
        checksum=excluded.checksum,
        started_at=excluded.started_at,
        completed_at='',
        report_json='{}'
    `).run(MIGRATION_ID, TARGET_SCHEMA_VERSION, 'stage6.3.4-v1', startedAt);

    addColumn(db, 'r32_accounts', 'canonical_account_id', "TEXT NOT NULL DEFAULT ''");
    addColumn(db, 'r32_accounts', 'lifecycle_state', "TEXT NOT NULL DEFAULT 'active'");
    addColumn(db, 'r32_accounts', 'merged_into_id', "TEXT NOT NULL DEFAULT ''");
    addColumn(db, 'r32_accounts', 'tombstoned_at', "TEXT NOT NULL DEFAULT ''");
    addColumn(db, 'contacts', 'canonical_contact_id', "TEXT NOT NULL DEFAULT ''");
    addColumn(db, 'contacts', 'merged_into_id', "TEXT NOT NULL DEFAULT ''");
    addColumn(db, 'contacts', 'tombstoned_at', "TEXT NOT NULL DEFAULT ''");

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_r32_accounts_canonical ON r32_accounts(canonical_account_id);
      CREATE INDEX IF NOT EXISTS idx_r32_accounts_lifecycle ON r32_accounts(lifecycle_state, platform);
      CREATE INDEX IF NOT EXISTS idx_contacts_canonical ON contacts(canonical_contact_id);
      CREATE INDEX IF NOT EXISTS idx_contacts_tombstone ON contacts(tombstoned_at, archived_at);

      CREATE TABLE IF NOT EXISTS identity_aliases (
        id TEXT PRIMARY KEY,
        platform TEXT NOT NULL DEFAULT '',
        alias_type TEXT NOT NULL,
        alias_value TEXT NOT NULL,
        canonical_account_id TEXT NOT NULL DEFAULT '',
        canonical_contact_id TEXT NOT NULL DEFAULT '',
        confidence TEXT NOT NULL DEFAULT 'high',
        source TEXT NOT NULL DEFAULT '',
        payload_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(platform, alias_type, alias_value)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_identity_alias_account ON identity_aliases(canonical_account_id);
      CREATE INDEX IF NOT EXISTS idx_identity_alias_contact ON identity_aliases(canonical_contact_id);

      CREATE TABLE IF NOT EXISTS identity_merge_audit (
        id TEXT PRIMARY KEY,
        platform TEXT NOT NULL DEFAULT '',
        entity_type TEXT NOT NULL,
        source_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        confidence TEXT NOT NULL DEFAULT '',
        reason TEXT NOT NULL DEFAULT '',
        report_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_identity_merge_source ON identity_merge_audit(entity_type, source_id);
      CREATE INDEX IF NOT EXISTS idx_identity_merge_target ON identity_merge_audit(entity_type, target_id);

      CREATE TABLE IF NOT EXISTS sync_checkpoints (
        platform TEXT NOT NULL,
        account_id TEXT NOT NULL,
        scope_id TEXT NOT NULL DEFAULT '',
        cursor TEXT NOT NULL DEFAULT '',
        remote_message_id TEXT NOT NULL DEFAULT '',
        remote_timestamp TEXT NOT NULL DEFAULT '',
        batch_id TEXT NOT NULL DEFAULT '',
        phase TEXT NOT NULL DEFAULT 'idle',
        payload_json TEXT NOT NULL DEFAULT '{}',
        committed_at TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL,
        PRIMARY KEY(platform, account_id, scope_id)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_sync_checkpoint_phase ON sync_checkpoints(phase, updated_at);

      CREATE TABLE IF NOT EXISTS sync_message_receipts (
        platform TEXT NOT NULL,
        account_id TEXT NOT NULL,
        remote_message_id TEXT NOT NULL,
        conversation_id TEXT NOT NULL DEFAULT '',
        message_id TEXT NOT NULL DEFAULT '',
        first_seen_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(platform, account_id, remote_message_id)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS integrity_issue_aggregates (
        fingerprint TEXT PRIMARY KEY,
        code TEXT NOT NULL,
        severity TEXT NOT NULL,
        domain TEXT NOT NULL DEFAULT '',
        entity_id TEXT NOT NULL DEFAULT '',
        detail_json TEXT NOT NULL DEFAULT '{}',
        occurrences INTEGER NOT NULL DEFAULT 1,
        active INTEGER NOT NULL DEFAULT 1,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        resolved_at TEXT NOT NULL DEFAULT ''
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_integrity_issue_active ON integrity_issue_aggregates(active, severity, last_seen_at DESC);

      CREATE TABLE IF NOT EXISTS cache_manifest (
        relative_path TEXT PRIMARY KEY,
        owner TEXT NOT NULL,
        schema_version INTEGER NOT NULL DEFAULT 1,
        source_fingerprint TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        last_access_at TEXT NOT NULL,
        expires_at TEXT NOT NULL DEFAULT '',
        protected INTEGER NOT NULL DEFAULT 0,
        payload_json TEXT NOT NULL DEFAULT '{}'
      ) STRICT;
    `);

    for (const [namespace, value] of Object.entries(REQUIRED_SETTING_DOCUMENTS)) ensureSetting(db, namespace, value);

    db.prepare(`
      UPDATE r32_accounts
      SET canonical_account_id=CASE WHEN canonical_account_id='' THEN id ELSE canonical_account_id END,
          lifecycle_state=CASE
            WHEN tombstoned_at<>'' THEN 'tombstoned'
            WHEN merged_into_id<>'' THEN 'merged'
            WHEN json_extract(payload_json,'$.paused')=1 OR state='paused' THEN 'paused'
            ELSE COALESCE(NULLIF(lifecycle_state,''),'active')
          END
    `).run();
    db.prepare(`
      UPDATE contacts
      SET canonical_contact_id=CASE WHEN canonical_contact_id='' THEN id ELSE canonical_contact_id END
    `).run();

    const report = {
      migrationId: MIGRATION_ID,
      schemaVersion: TARGET_SCHEMA_VERSION,
      accountRows: Number(db.prepare('SELECT COUNT(*) AS count FROM r32_accounts').get()?.count || 0),
      contactRows: Number(db.prepare('SELECT COUNT(*) AS count FROM contacts').get()?.count || 0),
      requiredNamespaces: ['desktop-settings', 'notification-settings', 'system-policy', 'performance-settings'],
      preMigrationSnapshot,
      completedAt: now()
    };
    db.prepare(`
      UPDATE r32_schema_migrations
      SET status='completed', completed_at=?, report_json=?
      WHERE migration_id=?
    `).run(report.completedAt, JSON.stringify(report), MIGRATION_ID);
    db.prepare(`
      INSERT INTO r32_meta(key, value_json, updated_at)
      VALUES ('schemaVersion', ?, ?)
      ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_at=excluded.updated_at
    `).run(JSON.stringify(TARGET_SCHEMA_VERSION), report.completedAt);
    db.exec('COMMIT');
    return { ok: true, executed: true, ...report };
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch (_) {}
    throw Object.assign(error, { code: error.code || 'STAGE6_3_4_SCHEMA_MIGRATION_FAILED', migrationId: MIGRATION_ID });
  }
}

module.exports = { MIGRATION_ID, TARGET_SCHEMA_VERSION, REQUIRED_SETTING_DOCUMENTS, applyStage634ArchitectureClosure, ensurePostMigrationConsistency, createPreMigrationSnapshot };
