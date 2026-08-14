'use strict';

const { assertStorageAccess } = require('./runtimeRoleGuard');
assertStorageAccess('R32SqliteStore');

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const { createCompactSnapshotTarget } = require('../migrations/migrationSnapshotManifest');
const {
  applyStage634ArchitectureClosure,
  TARGET_SCHEMA_VERSION: STAGE634_SCHEMA_VERSION
} = require('../migrations/stage6_3_4ArchitectureClosure');
const {
  applyRound12PlatformCoreUnification,
  TARGET_SCHEMA_VERSION: ROUND12_SCHEMA_VERSION
} = require('../migrations/round12PlatformCoreUnification');
const {
  applyRound12Round13SelfCheckHardening,
  TARGET_SCHEMA_VERSION: ROUND12_13_HARDENING_SCHEMA_VERSION
} = require('../migrations/round12Round13SelfCheckHardening');
const {
  applyRound12Round13RemainingClosure,
  TARGET_SCHEMA_VERSION: ROUND12_13_REMAINING_SCHEMA_VERSION
} = require('../migrations/round12Round13RemainingClosure');
const {
  applyRound12Round13FinalGovernanceClosure,
  TARGET_SCHEMA_VERSION: ROUND12_13_FINAL_GOVERNANCE_SCHEMA_VERSION
} = require('../migrations/round12Round13FinalGovernanceClosure');
const {
  applyRound12Round13FinalSevenClosure,
  TARGET_SCHEMA_VERSION: ROUND12_13_FINAL_SEVEN_SCHEMA_VERSION
} = require('../migrations/round12Round13FinalSevenClosure');
const {
  applyBatch22IdentityRouteAuthority,
  TARGET_SCHEMA_VERSION: BATCH22_IDENTITY_ROUTE_SCHEMA_VERSION
} = require('../migrations/batch22IdentityRouteAuthority');
const {
  applyBatch24StateTransactionConsistency,
  TARGET_SCHEMA_VERSION: BATCH24_STATE_TRANSACTION_SCHEMA_VERSION
} = require('../migrations/batch24StateTransactionConsistency');
const {
  applyBatch26PlatformAiLearningClosure,
  TARGET_SCHEMA_VERSION: BATCH26_PLATFORM_AI_LEARNING_SCHEMA_VERSION
} = require('../migrations/batch26PlatformAiLearningClosure');
const {
  applyBatch27DeveloperHandoffV2Closure,
  TARGET_SCHEMA_VERSION: BATCH27_DEVELOPER_HANDOFF_SCHEMA_VERSION
} = require('../migrations/batch27DeveloperHandoffV2Closure');
const {
  applyBatch41Fix6MArchitectureReferenceClosure,
  TARGET_SCHEMA_VERSION: BATCH41_FIX6M_SCHEMA_VERSION
} = require('../migrations/batch41Fix6MArchitectureReferenceClosure');
const {
  applyBatch42Fix6OScopedSafetyAndOmnichannelRuntime,
  TARGET_SCHEMA_VERSION: BATCH42_FIX6O_SCHEMA_VERSION
} = require('../migrations/batch42Fix6OScopedSafetyAndOmnichannelRuntime');
const {
  applyArchitectureClosureV2WpA,
  TARGET_SCHEMA_VERSION: ACV2_WP_A_SCHEMA_VERSION
} = require('../migrations/architectureClosureV2WpA');
const {
  applyArchitectureClosureV2DomainEventProjectionJobsCanonical,
  isArchitectureClosureV2DomainEventProjectionJobsCanonicalApplied,
  ensureArchitectureClosureV2WpABaseForSchema23Reentry,
  TARGET_SCHEMA_VERSION: ACV2_DOMAIN_EVENT_PROJECTION_JOBS_CANONICAL_SCHEMA_VERSION
} = require('../migrations/architectureClosureV2DomainEventProjectionJobsCanonical');
const { ensureCanonicalProjectionReceiptSchema } = require('../migrations/projectionReceiptSchemaAuthority');
const {
  acquireAuthorityWriteHost,
  assertCurrentAuthorityWriteHostToken,
  requireAuthorityWriteHostCapability
} = require('../services/authorityWriteHost');
const { claimOwnership, SqliteOwnershipError } = require('./sqliteOwnership');
const { SqliteTransactionCoordinator } = require('../store/sqliteTransactionCoordinator');

// M5 — schema-version governance. Bump this only when a forward migration is
// shipped; an older binary opening a newer DB must fail fast (downgrade risk),
// never silently corrupt.
const SCHEMA_VERSION = Math.max(STAGE634_SCHEMA_VERSION, ROUND12_SCHEMA_VERSION, ROUND12_13_HARDENING_SCHEMA_VERSION, ROUND12_13_REMAINING_SCHEMA_VERSION, ROUND12_13_FINAL_GOVERNANCE_SCHEMA_VERSION, ROUND12_13_FINAL_SEVEN_SCHEMA_VERSION, BATCH22_IDENTITY_ROUTE_SCHEMA_VERSION, BATCH24_STATE_TRANSACTION_SCHEMA_VERSION, BATCH26_PLATFORM_AI_LEARNING_SCHEMA_VERSION, BATCH27_DEVELOPER_HANDOFF_SCHEMA_VERSION, BATCH41_FIX6M_SCHEMA_VERSION, BATCH42_FIX6O_SCHEMA_VERSION, ACV2_WP_A_SCHEMA_VERSION, ACV2_DOMAIN_EVENT_PROJECTION_JOBS_CANONICAL_SCHEMA_VERSION);

function nowIso() {
  return new Date().toISOString();
}

function clean(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  return String(value).trim();
}

function first(source, keys, fallback = '') {
  for (const key of keys) {
    const value = source?.[key];
    if (value !== undefined && value !== null && clean(value)) return value;
  }
  return fallback;
}

function boolInt(value) {
  if (value === true || value === 1 || value === '1' || value === 'true') return 1;
  if (value === false || value === 0 || value === '0' || value === 'false') return 0;
  return null;
}

function integer(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function stableId(prefix, parts) {
  const source = parts.map(value => clean(value)).join('\u001f');
  return `${prefix}_${crypto.createHash('sha256').update(source).digest('hex').slice(0, 32)}`;
}

function json(value) {
  return JSON.stringify(value ?? null);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

function parseJson(value, fallback = null) {
  try {
    return value == null || value === '' ? fallback : JSON.parse(value);
  } catch (_) {
    return fallback;
  }
}

const MESSAGE_TRANSLATION_FIELDS = Object.freeze([
  'sourceText', 'sourceLanguage', 'translatedZh', 'translationZh', 'translationZH', 'chineseTranslation',
  'translationStatus', 'translationModel', 'translatedAt', 'translationUpdatedAt', 'translationErrorCode',
  'translationError', 'translationSourceHash', 'translationTargetLanguage', 'translationQuality',
  'translationAttempts', 'protectedTerms', 'lastSuccessfulTranslatedZh', 'lastSuccessfulTranslationModel',
  'lastSuccessfulTranslatedAt'
]);

function hasOwn(source, key) {
  return Object.prototype.hasOwnProperty.call(source || {}, key);
}

function hasDefinedOwn(source, key) {
  return hasOwn(source, key) && source[key] !== undefined;
}

function mergeMessagePayload(existingPayload = {}, incoming = {}, existingText = '', nextText = '') {
  const merged = { ...(existingPayload && typeof existingPayload === 'object' ? existingPayload : {}), ...incoming };
  for (const key of MESSAGE_TRANSLATION_FIELDS) {
    if (!hasDefinedOwn(incoming, key) && hasOwn(existingPayload, key)) merged[key] = existingPayload[key];
  }
  const textChanged = Boolean(clean(existingText) && clean(nextText) && clean(existingText) !== clean(nextText));
  const translationExplicit = MESSAGE_TRANSLATION_FIELDS.some(key => hasDefinedOwn(incoming, key));
  if (textChanged && !translationExplicit) {
    const previousZh = clean(existingPayload.translatedZh || existingPayload.translationZh || existingPayload.chineseTranslation);
    if (previousZh) {
      merged.lastSuccessfulTranslatedZh = previousZh;
      merged.lastSuccessfulTranslationModel = clean(existingPayload.translationModel);
      merged.lastSuccessfulTranslatedAt = clean(existingPayload.translatedAt);
    }
    merged.sourceText = clean(nextText);
    merged.translatedZh = '';
    merged.translationStatus = 'stale';
    merged.translationSourceHash = '';
    merged.translationErrorCode = '';
    merged.translationError = '';
  }
  return merged;
}

function queueClaim(input = {}) {
  return {
    generation: integer(input.generation ?? input.claimGeneration ?? input.claim_generation, 0),
    token: clean(input.token ?? input.claimToken ?? input.claim_token)
  };
}

function staleQueueCompletion(id, current, claim, code = 'SEND_QUEUE_STALE_COMPLETION') {
  return Object.assign(new Error('Stale send completion rejected'), {
    code,
    status: 409,
    queueId: clean(id),
    expectedGeneration: Number(current?.claim_generation || 0),
    receivedGeneration: Number(claim?.generation || 0)
  });
}

class R32SqliteStore {
  constructor(options = {}) {
    const dbPath = path.resolve(options.dbPath || path.join(process.cwd(), 'data', 'database', 'yance-r32.db'));
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.dbPath = dbPath;
    this.ownership = null;
    this.db = null;
    this.transactions = null;
    this.ownershipHeartbeatTimer = null;
    this.ownershipLostError = null;
    this.ownedAuthorityWriteHost = null;
    if (options.authorityWriteHostCapability) {
      this.authorityWriteHostCapability = requireAuthorityWriteHostCapability(options.authorityWriteHostCapability);
    } else {
      this.ownedAuthorityWriteHost = acquireAuthorityWriteHost({
        dbPath,
        instanceId: options.instanceId,
        ownershipStaleMs: options.ownershipStaleMs,
        ownershipPid: options.ownershipPid,
        ownershipPidAlive: options.ownershipPidAlive,
        ownershipProcessIdentity: options.ownershipProcessIdentity,
        ownershipCapturePidIdentity: options.ownershipCapturePidIdentity,
        ownershipFsProvider: options.ownershipFsProvider,
        clock: options.ownershipClock
      });
      this.authorityWriteHostCapability = this.ownedAuthorityWriteHost.capability;
    }
    if (path.resolve(this.authorityWriteHostCapability.dbPath) !== dbPath) {
      throw Object.assign(new Error('AuthorityWriteHost capability path mismatch'), { code: 'AUTHORITY_WRITE_HOST_CAPABILITY_PATH_MISMATCH' });
    }
    this.ownershipStaleMs = Math.max(1000, Number(options.ownershipStaleMs || 30000));
    this.ownershipHeartbeatMs = Math.max(250, Math.min(
      Math.floor(this.ownershipStaleMs / 3),
      Number(options.ownershipHeartbeatMs || Math.floor(this.ownershipStaleMs / 4))
    ));
    try {
      // M5 — claim single-instance ownership BEFORE opening the db file, so a
      // second live owner fails fast instead of corrupting / hanging on locks.
      this.ownership = claimOwnership({
        dbPath,
        staleMs: this.ownershipStaleMs,
        schemaVersion: SCHEMA_VERSION,
        // Allow tests / integrators to simulate a different owner PID and/or
        // inject a custom PID-liveness probe (e.g. to assert cross-process
        // conflict guards without actually spawning a second OS process).
        pid: options.ownershipPid,
        pidAlive: options.ownershipPidAlive,
        clock: options.ownershipClock,
        fsProvider: options.ownershipFsProvider,
        capturePidIdentity: options.ownershipCapturePidIdentity
      });
      this.db = new DatabaseSync(dbPath);
      this.transactions = new SqliteTransactionCoordinator(this.db);
      this.db.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = FULL;
        PRAGMA foreign_keys = ON;
        PRAGMA busy_timeout = 8000;
        PRAGMA temp_store = MEMORY;
      `);
      const schemaPreflight = this.preflightSchemaVersion();
      this.schemaMigrationBackup = this.prepareSchemaMigrationBackup(schemaPreflight);
      this.ensureSchema();
      this.governSchemaVersion(schemaPreflight);
      this.commitSchemaMigrationReceipt(schemaPreflight);
      this.authorityWriteHostCapability.attachStore(this);
      this.startOwnershipHeartbeat();
    } catch (error) {
      // A constructor that rejects the database (for example, because its
      // schema is newer than this binary) must not leak the SQLite handle or
      // its ownership sidecar. Windows otherwise keeps the file locked and
      // subsequent cleanup/recovery fails with EBUSY.
      let closeError = null;
      if (this.db) {
        try {
          this.db.close();
          this.db = null;
        } catch (candidate) {
          closeError = candidate;
        }
      }
      if (!closeError) {
        try { this.ownership?.release(); } catch (_) {}
      }
      if (!closeError && this.schemaMigrationBackup?.path) {
        try {
          for (const suffix of ['-wal', '-shm']) fs.rmSync(`${this.dbPath}${suffix}`, { force: true });
          fs.copyFileSync(this.schemaMigrationBackup.path, this.dbPath);
          error.schemaMigrationRollback = { restored: true, backupPath: this.schemaMigrationBackup.path };
        } catch (rollbackError) {
          error.schemaMigrationRollback = { restored: false, backupPath: this.schemaMigrationBackup.path, error: rollbackError.message || String(rollbackError) };
        }
      }
      if (closeError && error && typeof error === 'object') {
        error.sqliteCloseError = {
          code: closeError.code || '',
          message: closeError.message || String(closeError)
        };
      }
      try { this.ownedAuthorityWriteHost?.close(); } catch (_) {}
      try { this.authorityWriteHostCapability?.close(); } catch (_) {}
      throw error;
    }
  }

  startOwnershipHeartbeat() {
    if (!this.ownership || this.ownershipHeartbeatTimer) return;
    const loseOwnership = () => {
      if (this.ownershipLostError) return;
      this.ownershipLostError = Object.assign(new Error('SQLite write ownership heartbeat was lost; store is fail-closed'), {
        code: 'SQLITE_OWNERSHIP_HEARTBEAT_LOST', dbPath: this.dbPath
      });
      if (this.ownershipHeartbeatTimer) clearInterval(this.ownershipHeartbeatTimer);
      this.ownershipHeartbeatTimer = null;
      // Stop all further writes immediately. Closing may fail if a synchronous
      // statement is active; query_only is the conservative fallback.
      try { this.db?.exec('PRAGMA query_only = ON'); } catch (_) {}
      try { this.db?.close(); this.db = null; } catch (_) {}
    };
    this.ownershipHeartbeatTimer = setInterval(() => {
      let ok = false;
      try { ok = this.authorityWriteHostCapability.heartbeat() === true; } catch (error) { this.ownershipLostError = error; ok = false; }
      if (!ok) loseOwnership();
    }, this.ownershipHeartbeatMs);
    this.ownershipHeartbeatTimer.unref?.();
  }

  assertOwnership() {
    if (this.ownershipLostError) throw this.ownershipLostError;
    if (!this.db) throw Object.assign(new Error('SQLite store is closed'), { code: 'SQLITE_STORE_CLOSED', dbPath: this.dbPath });
    assertCurrentAuthorityWriteHostToken(this.authorityWriteHostCapability, this.db);
    return true;
  }

  existingSchemaVersion() {
    const tables = new Set(this.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => String(row.name || '')));
    if (!tables.has('r32_meta')) return null;
    const rows = this.db.prepare("SELECT key, value_json FROM r32_meta WHERE key IN ('schema_version','schemaVersion')").all();
    if (!rows.length) return null;
    const versions = [];
    for (const row of rows) {
      const parsed = parseJson(row.value_json, row.value_json);
      const number = Number(parsed);
      if (!Number.isInteger(number) || number < 0) {
        throw new SqliteOwnershipError(
          'SCHEMA_VERSION_INVALID',
          `Database schema version metadata ${row.key} is invalid`,
          { key: row.key, value: row.value_json, dbPath: this.dbPath }
        );
      }
      versions.push(number);
    }
    // Historical migrations wrote camelCase while M5 wrote snake_case. During
    // convergence they may differ; the highest value is authoritative so an
    // older binary can never hide a newer schema behind the legacy key.
    return Math.max(...versions);
  }

  preflightSchemaVersion() {
    const current = this.existingSchemaVersion();
    if (current != null && current > SCHEMA_VERSION) {
      throw new SqliteOwnershipError(
        'SCHEMA_VERSION_AHEAD',
        `Database schema version ${current} is newer than supported version ${SCHEMA_VERSION}; refusing to open (downgrade risk)`,
        { databaseVersion: current, supportedVersion: SCHEMA_VERSION, dbPath: this.dbPath }
      );
    }
    const userTables = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(row => String(row.name || ''));
    return { current, target: SCHEMA_VERSION, needsMigration: current == null ? userTables.length > 0 : current < SCHEMA_VERSION, userTables };
  }

  prepareSchemaMigrationBackup(preflight = {}) {
    if (!preflight.needsMigration) return null;
    const from = preflight.current == null ? 'unversioned' : `v${preflight.current}`;
    const generation = crypto.randomUUID();
    const { targetPath: backupPath } = createCompactSnapshotTarget({
      root: path.dirname(this.dbPath),
      dbPath: this.dbPath,
      migrationId: `schema-adoption-${from}-to-v${SCHEMA_VERSION}`,
      processGeneration: generation,
      extension: 'bak'
    });
    const escaped = backupPath.replace(/'/g, "''");
    this.db.exec(`PRAGMA wal_checkpoint(FULL); VACUUM INTO '${escaped}';`);
    const stat = fs.statSync(backupPath);
    if (!stat.isFile() || stat.size <= 0) throw new SqliteOwnershipError('SCHEMA_MIGRATION_BACKUP_FAILED', 'Database pre-migration backup is empty', { backupPath, dbPath: this.dbPath });
    const verification = new DatabaseSync(backupPath, { readOnly: true });
    try {
      const integrity = String(verification.prepare('PRAGMA integrity_check').get()?.integrity_check || '');
      if (integrity.toLowerCase() !== 'ok') throw new Error(`integrity_check=${integrity}`);
    } finally { verification.close(); }
    return { path: backupPath, from: preflight.current, to: SCHEMA_VERSION, createdAt: new Date().toISOString(), size: stat.size };
  }

  // M5 — record/verify the schema version so a downgrade (newer DB, older
  // binary) is refused instead of silently corrupting data.
  governSchemaVersion(preflight = {}) {
    const current = preflight.current ?? this.getMeta('schema_version', null);
    if (current != null && Number(current) > SCHEMA_VERSION) {
      throw new SqliteOwnershipError(
        'SCHEMA_VERSION_AHEAD',
        `Database schema version ${current} is newer than supported version ${SCHEMA_VERSION}; refusing to open (downgrade risk)`,
        { databaseVersion: Number(current), supportedVersion: SCHEMA_VERSION, dbPath: this.dbPath }
      );
    }
    this.setMeta('schema_version', SCHEMA_VERSION);
    this.setMeta('schemaVersion', SCHEMA_VERSION);
  }

  commitSchemaMigrationReceipt(preflight = {}) {
    if (!preflight.needsMigration) return;
    this.setMeta('schema_migration_last_receipt', {
      status: 'COMMITTED',
      fromVersion: preflight.current,
      toVersion: SCHEMA_VERSION,
      backupPath: this.schemaMigrationBackup?.path || '',
      backupSize: Number(this.schemaMigrationBackup?.size || 0),
      completedAt: new Date().toISOString()
    });
  }

  ensureSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS r32_meta (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS r32_accounts (
        id TEXT PRIMARY KEY,
        platform TEXT NOT NULL DEFAULT '',
        adapter_account_id TEXT NOT NULL DEFAULT '',
        display_name TEXT NOT NULL DEFAULT '',
        identity_label TEXT NOT NULL DEFAULT '',
        state TEXT NOT NULL DEFAULT '',
        can_send INTEGER,
        can_receive INTEGER,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_r32_accounts_platform ON r32_accounts(platform);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_r32_accounts_adapter
        ON r32_accounts(platform, adapter_account_id)
        WHERE adapter_account_id <> '';


      CREATE TABLE IF NOT EXISTS contacts (
        id TEXT PRIMARY KEY,
        platform TEXT NOT NULL DEFAULT '',
        account_id TEXT NOT NULL DEFAULT '',
        external_id TEXT NOT NULL DEFAULT '',
        display_name TEXT NOT NULL DEFAULT '',
        phone TEXT NOT NULL DEFAULT '',
        avatar_url TEXT NOT NULL DEFAULT '',
        avatar_updated_at TEXT NOT NULL DEFAULT '',
        avatar_status TEXT NOT NULL DEFAULT '',
        tags_json TEXT NOT NULL DEFAULT '[]',
        aliases_json TEXT NOT NULL DEFAULT '[]',
        source TEXT NOT NULL DEFAULT '',
        last_seen_at TEXT NOT NULL DEFAULT '',
        archived_at TEXT NOT NULL DEFAULT '',
        archive_reason TEXT NOT NULL DEFAULT '',
        archived_by TEXT NOT NULL DEFAULT '',
        payload_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_contacts_name ON contacts(display_name);
      CREATE INDEX IF NOT EXISTS idx_contacts_account ON contacts(account_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_external
        ON contacts(platform, account_id, external_id)
        WHERE external_id <> '';

      CREATE TABLE IF NOT EXISTS customer_profiles (
        contact_id TEXT PRIMARY KEY,
        facts_json TEXT NOT NULL DEFAULT '{}',
        tags_json TEXT NOT NULL DEFAULT '[]',
        traits_json TEXT NOT NULL DEFAULT '{}',
        confirmed_facts_json TEXT NOT NULL DEFAULT '[]',
        inferred_facts_json TEXT NOT NULL DEFAULT '[]',
        notes TEXT NOT NULL DEFAULT '',
        lifecycle_stage TEXT NOT NULL DEFAULT '',
        intimacy_score REAL NOT NULL DEFAULT 0,
        openness_score REAL NOT NULL DEFAULT 0,
        activity_score REAL NOT NULL DEFAULT 0,
        risk_score REAL NOT NULL DEFAULT 0,
        next_action TEXT NOT NULL DEFAULT '',
        source_message_count INTEGER NOT NULL DEFAULT 0,
        analyzed_through_message_id TEXT NOT NULL DEFAULT '',
        analyzed_through_at TEXT NOT NULL DEFAULT '',
        model_id TEXT NOT NULL DEFAULT '',
        model_name TEXT NOT NULL DEFAULT '',
        review_status TEXT NOT NULL DEFAULT 'manual',
        profile_version INTEGER NOT NULL DEFAULT 1,
        payload_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(contact_id) REFERENCES contacts(id) ON DELETE CASCADE
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_customer_profiles_stage ON customer_profiles(lifecycle_stage);
      CREATE INDEX IF NOT EXISTS idx_customer_profiles_updated ON customer_profiles(updated_at DESC);

      CREATE TABLE IF NOT EXISTS customer_profile_evidence (
        evidence_id TEXT PRIMARY KEY,
        idempotency_key TEXT NOT NULL UNIQUE,
        canonical_contact_id TEXT NOT NULL DEFAULT '',
        platform TEXT NOT NULL DEFAULT '',
        source_account_id TEXT NOT NULL DEFAULT '',
        platform_contact_identity TEXT NOT NULL DEFAULT '',
        conversation_id TEXT NOT NULL DEFAULT '',
        platform_message_id TEXT NOT NULL DEFAULT '',
        evidence_type TEXT NOT NULL DEFAULT '',
        projection_version TEXT NOT NULL DEFAULT '',
        source_text TEXT NOT NULL DEFAULT '',
        translated_zh TEXT NOT NULL DEFAULT '',
        translation_status TEXT NOT NULL DEFAULT '',
        translation_model TEXT NOT NULL DEFAULT '',
        confidence REAL NOT NULL DEFAULT 0,
        payload_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_customer_profile_evidence_contact
        ON customer_profile_evidence(canonical_contact_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_customer_profile_evidence_scope
        ON customer_profile_evidence(platform, source_account_id, conversation_id, platform_message_id);

      CREATE TABLE IF NOT EXISTS relationship_insights (
        contact_id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL DEFAULT '',
        summary TEXT NOT NULL DEFAULT '',
        relationship_stage TEXT NOT NULL DEFAULT '',
        tone TEXT NOT NULL DEFAULT '',
        intimacy_score REAL NOT NULL DEFAULT 0,
        initiative_score REAL NOT NULL DEFAULT 0,
        openness_score REAL NOT NULL DEFAULT 0,
        response_pressure_score REAL NOT NULL DEFAULT 0,
        opportunity_score REAL NOT NULL DEFAULT 0,
        risk_score REAL NOT NULL DEFAULT 0,
        hidden_need TEXT NOT NULL DEFAULT '',
        next_action TEXT NOT NULL DEFAULT '',
        evidence_json TEXT NOT NULL DEFAULT '[]',
        open_loops_json TEXT NOT NULL DEFAULT '[]',
        dimensions_json TEXT NOT NULL DEFAULT '{}',
        source_message_count INTEGER NOT NULL DEFAULT 0,
        analyzed_through_message_id TEXT NOT NULL DEFAULT '',
        analyzed_through_at TEXT NOT NULL DEFAULT '',
        model_id TEXT NOT NULL DEFAULT '',
        model_name TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'ready',
        payload_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(contact_id) REFERENCES contacts(id) ON DELETE CASCADE
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_relationship_insights_conversation ON relationship_insights(conversation_id);
      CREATE INDEX IF NOT EXISTS idx_relationship_insights_updated ON relationship_insights(updated_at DESC);

      CREATE TABLE IF NOT EXISTS ai_analysis_runs (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        contact_id TEXT NOT NULL,
        model_id TEXT NOT NULL DEFAULT '',
        model_name TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL,
        source_message_count INTEGER NOT NULL DEFAULT 0,
        source_last_message_id TEXT NOT NULL DEFAULT '',
        request_json TEXT NOT NULL DEFAULT '{}',
        result_json TEXT NOT NULL DEFAULT '{}',
        error_text TEXT NOT NULL DEFAULT '',
        started_at TEXT NOT NULL,
        completed_at TEXT NOT NULL DEFAULT '',
        FOREIGN KEY(contact_id) REFERENCES contacts(id) ON DELETE CASCADE
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_ai_analysis_runs_conversation
        ON ai_analysis_runs(conversation_id, completed_at DESC);

      CREATE TABLE IF NOT EXISTS r32_conversations (
        session_key TEXT PRIMARY KEY,
        account_id TEXT NOT NULL DEFAULT '',
        contact_id TEXT NOT NULL DEFAULT '',
        platform TEXT NOT NULL DEFAULT '',
        title TEXT NOT NULL DEFAULT '',
        avatar_url TEXT NOT NULL DEFAULT '',
        avatar_updated_at TEXT NOT NULL DEFAULT '',
        avatar_status TEXT NOT NULL DEFAULT '',
        last_message TEXT NOT NULL DEFAULT '',
        last_message_at TEXT NOT NULL DEFAULT '',
        unread_count INTEGER NOT NULL DEFAULT 0,
        route_state TEXT NOT NULL DEFAULT '',
        archived_at TEXT NOT NULL DEFAULT '',
        archive_reason TEXT NOT NULL DEFAULT '',
        archived_by TEXT NOT NULL DEFAULT '',
        merged_into TEXT NOT NULL DEFAULT '',
        merged_at TEXT NOT NULL DEFAULT '',
        merge_reason TEXT NOT NULL DEFAULT '',
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_r32_conversations_updated
        ON r32_conversations(last_message_at DESC, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_r32_conversations_account
        ON r32_conversations(account_id);

      CREATE TABLE IF NOT EXISTS r32_messages (
        id TEXT PRIMARY KEY,
        session_key TEXT NOT NULL,
        account_id TEXT NOT NULL DEFAULT '',
        sender_id TEXT NOT NULL DEFAULT '',
        role TEXT NOT NULL DEFAULT '',
        direction TEXT NOT NULL DEFAULT '',
        message_type TEXT NOT NULL DEFAULT 'text',
        text TEXT NOT NULL DEFAULT '',
        media_url TEXT NOT NULL DEFAULT '',
        media_path TEXT NOT NULL DEFAULT '',
        quoted_message_id TEXT NOT NULL DEFAULT '',
        delivery_status TEXT NOT NULL DEFAULT '',
        sent_at TEXT NOT NULL DEFAULT '',
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(session_key) REFERENCES r32_conversations(session_key) ON DELETE CASCADE
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_r32_messages_session_time
        ON r32_messages(session_key, sent_at, created_at);
      CREATE INDEX IF NOT EXISTS idx_r32_messages_session_cursor
        ON r32_messages(session_key, sent_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS idx_r32_messages_account
        ON r32_messages(account_id);
      CREATE INDEX IF NOT EXISTS idx_r32_messages_external
        ON r32_messages(account_id, json_extract(payload_json, '$.externalMessageId'));

      CREATE VIRTUAL TABLE IF NOT EXISTS r32_messages_fts USING fts5(
        message_id UNINDEXED,
        session_key UNINDEXED,
        text,
        tokenize = 'unicode61'
      );

      CREATE TABLE IF NOT EXISTS r32_settings (
        namespace TEXT NOT NULL,
        key TEXT NOT NULL,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(namespace, key)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS r32_migration_runs (
        id TEXT PRIMARY KEY,
        source_root TEXT NOT NULL,
        source_fingerprint TEXT NOT NULL,
        status TEXT NOT NULL,
        report_json TEXT NOT NULL,
        started_at TEXT NOT NULL,
        completed_at TEXT NOT NULL DEFAULT ''
      ) STRICT;

      CREATE TABLE IF NOT EXISTS relationship_state_signals (
        signal_id TEXT PRIMARY KEY,
        idempotency_key TEXT NOT NULL DEFAULT '',
        platform TEXT NOT NULL DEFAULT '',
        source_account_id TEXT NOT NULL DEFAULT '',
        platform_message_id TEXT NOT NULL DEFAULT '',
        projection_version TEXT NOT NULL DEFAULT '1.0',
        contact_id TEXT NOT NULL,
        conversation_id TEXT NOT NULL DEFAULT '',
        message_id TEXT NOT NULL,
        signal_type TEXT NOT NULL,
        dimension TEXT NOT NULL,
        direction TEXT NOT NULL,
        strength REAL NOT NULL DEFAULT 0,
        confidence REAL NOT NULL DEFAULT 0,
        observed_at TEXT NOT NULL,
        evidence_json TEXT NOT NULL DEFAULT '{}',
        source TEXT NOT NULL DEFAULT 'social_parser',
        parser_version TEXT NOT NULL DEFAULT '1.0',
        status TEXT NOT NULL DEFAULT 'candidate',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(contact_id) REFERENCES contacts(id) ON DELETE CASCADE
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_relationship_signals_contact_time
        ON relationship_state_signals(contact_id, observed_at DESC);
      CREATE INDEX IF NOT EXISTS idx_relationship_signals_message
        ON relationship_state_signals(message_id);
      CREATE INDEX IF NOT EXISTS idx_relationship_signals_message_type
        ON relationship_state_signals(message_id, signal_type);
      CREATE INDEX IF NOT EXISTS idx_relationship_signals_type
        ON relationship_state_signals(signal_type, observed_at DESC);

      CREATE TABLE IF NOT EXISTS relationship_timeline_events (
        event_id TEXT PRIMARY KEY,
        idempotency_key TEXT NOT NULL DEFAULT '',
        platform TEXT NOT NULL DEFAULT '',
        source_account_id TEXT NOT NULL DEFAULT '',
        platform_message_id TEXT NOT NULL DEFAULT '',
        projection_version TEXT NOT NULL DEFAULT '1.0',
        contact_id TEXT NOT NULL,
        conversation_id TEXT NOT NULL DEFAULT '',
        event_type TEXT NOT NULL,
        started_at TEXT NOT NULL,
        confirmed_at TEXT NOT NULL,
        before_json TEXT NOT NULL DEFAULT '{}',
        after_json TEXT NOT NULL DEFAULT '{}',
        interpretation TEXT NOT NULL DEFAULT '',
        evidence_message_ids_json TEXT NOT NULL DEFAULT '[]',
        source_signal_ids_json TEXT NOT NULL DEFAULT '[]',
        confidence REAL NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'candidate',
        engine_version TEXT NOT NULL DEFAULT '1.0',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(contact_id) REFERENCES contacts(id) ON DELETE CASCADE
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_relationship_timeline_contact_time
        ON relationship_timeline_events(contact_id, confirmed_at DESC);
      CREATE INDEX IF NOT EXISTS idx_relationship_timeline_type
        ON relationship_timeline_events(event_type, confirmed_at DESC);

      CREATE TABLE IF NOT EXISTS customer_social_state (
        contact_id TEXT PRIMARY KEY,
        relationship_json TEXT NOT NULL DEFAULT '{}',
        emotion_json TEXT NOT NULL DEFAULT '{}',
        interaction_json TEXT NOT NULL DEFAULT '{}',
        preferences_json TEXT NOT NULL DEFAULT '{}',
        strategy_json TEXT NOT NULL DEFAULT '{}',
        potential_json TEXT NOT NULL DEFAULT '{}',
        version INTEGER NOT NULL DEFAULT 1,
        source_message_id TEXT NOT NULL DEFAULT '',
        source_message_at TEXT NOT NULL DEFAULT '',
        calculated_at TEXT NOT NULL,
        engine_version TEXT NOT NULL DEFAULT '1.0',
        payload_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(contact_id) REFERENCES contacts(id) ON DELETE CASCADE
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_customer_social_state_updated
        ON customer_social_state(updated_at DESC);

      CREATE TABLE IF NOT EXISTS customer_interaction_preferences (
        contact_id TEXT NOT NULL,
        preference_key TEXT NOT NULL,
        value_json TEXT NOT NULL,
        confidence REAL NOT NULL DEFAULT 0,
        evidence_count INTEGER NOT NULL DEFAULT 0,
        evidence_message_ids_json TEXT NOT NULL DEFAULT '[]',
        source TEXT NOT NULL DEFAULT 'inferred',
        first_observed_at TEXT NOT NULL DEFAULT '',
        last_confirmed_at TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL,
        PRIMARY KEY(contact_id, preference_key),
        FOREIGN KEY(contact_id) REFERENCES contacts(id) ON DELETE CASCADE
      ) STRICT;

      CREATE TABLE IF NOT EXISTS interaction_policies (
        contact_id TEXT PRIMARY KEY,
        policy TEXT NOT NULL DEFAULT 'reply_normally',
        allow_replies INTEGER NOT NULL DEFAULT 1,
        allow_proactive INTEGER NOT NULL DEFAULT 0,
        blocked INTEGER NOT NULL DEFAULT 0,
        block_reason TEXT NOT NULL DEFAULT '',
        proactive_budget_7d INTEGER NOT NULL DEFAULT 0,
        used_this_week INTEGER NOT NULL DEFAULT 0,
        unanswered_limit INTEGER NOT NULL DEFAULT 1,
        minimum_interval_hours REAL NOT NULL DEFAULT 18,
        next_allowed_proactive_at TEXT NOT NULL DEFAULT '',
        reply_strategy_json TEXT NOT NULL DEFAULT '{}',
        config_json TEXT NOT NULL DEFAULT '{}',
        version INTEGER NOT NULL DEFAULT 1,
        calculated_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(contact_id) REFERENCES contacts(id) ON DELETE CASCADE
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_interaction_policies_policy
        ON interaction_policies(policy, updated_at DESC);

      CREATE TABLE IF NOT EXISTS ai_context_snapshots (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL DEFAULT '',
        contact_id TEXT NOT NULL,
        conversation_id TEXT NOT NULL DEFAULT '',
        state_version INTEGER NOT NULL,
        entity_versions_json TEXT NOT NULL DEFAULT '{}',
        context_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(contact_id) REFERENCES contacts(id) ON DELETE CASCADE
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_ai_context_snapshots_contact
        ON ai_context_snapshots(contact_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS social_inference_corrections (
        id TEXT PRIMARY KEY,
        contact_id TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_id TEXT NOT NULL DEFAULT '',
        correction_json TEXT NOT NULL,
        reason TEXT NOT NULL DEFAULT '',
        corrected_by TEXT NOT NULL DEFAULT 'user',
        created_at TEXT NOT NULL,
        FOREIGN KEY(contact_id) REFERENCES contacts(id) ON DELETE CASCADE
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_social_corrections_contact
        ON social_inference_corrections(contact_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS ai_reply_tasks (
        task_id TEXT PRIMARY KEY,
        contact_id TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        context_version INTEGER NOT NULL DEFAULT 0,
        conversation_revision INTEGER NOT NULL DEFAULT 0,
        performance_mode TEXT NOT NULL DEFAULT 'balanced',
        reply_source TEXT NOT NULL DEFAULT 'local_model',
        entity_versions_json TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'queued',
        cancel_reason TEXT NOT NULL DEFAULT '',
        error_text TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(contact_id) REFERENCES contacts(id) ON DELETE CASCADE
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_ai_reply_tasks_contact
        ON ai_reply_tasks(contact_id, updated_at DESC);

      CREATE TABLE IF NOT EXISTS ai_reply_candidates (
        candidate_id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        contact_id TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        text TEXT NOT NULL,
        original_text TEXT NOT NULL DEFAULT '',
        model_id TEXT NOT NULL DEFAULT '',
        model_name TEXT NOT NULL DEFAULT '',
        context_version INTEGER NOT NULL DEFAULT 0,
        conversation_revision INTEGER NOT NULL DEFAULT 0,
        context_message_ids_json TEXT NOT NULL DEFAULT '[]',
        performance_mode TEXT NOT NULL DEFAULT 'balanced',
        reply_source TEXT NOT NULL DEFAULT 'local_model',
        entity_versions_json TEXT NOT NULL DEFAULT '{}',
        reply_strategy_json TEXT NOT NULL DEFAULT '{}',
        relationship_potential_json TEXT NOT NULL DEFAULT '{}',
        state TEXT NOT NULL DEFAULT 'generated',
        persona_profile_id TEXT NOT NULL DEFAULT 'owner',
        persona_version_id INTEGER NOT NULL DEFAULT 0,
        persona_policy_hash TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(contact_id) REFERENCES contacts(id) ON DELETE CASCADE
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_ai_reply_candidates_contact
        ON ai_reply_candidates(contact_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_ai_reply_candidates_task
        ON ai_reply_candidates(task_id);

      CREATE TABLE IF NOT EXISTS ai_reply_feedback_events (
        id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        candidate_id TEXT NOT NULL DEFAULT '',
        outbox_id TEXT NOT NULL DEFAULT '',
        contact_id TEXT NOT NULL,
        conversation_id TEXT NOT NULL DEFAULT '',
        persona_profile_id TEXT NOT NULL DEFAULT 'owner',
        original_text TEXT NOT NULL DEFAULT '',
        final_text TEXT NOT NULL DEFAULT '',
        rejection_reason TEXT NOT NULL DEFAULT '',
        reply_source TEXT NOT NULL DEFAULT 'local_model',
        context_revision INTEGER NOT NULL DEFAULT 0,
        context_message_ids_json TEXT NOT NULL DEFAULT '[]',
        performance_mode TEXT NOT NULL DEFAULT '',
        signals_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        FOREIGN KEY(contact_id) REFERENCES contacts(id) ON DELETE CASCADE
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_ai_reply_feedback_contact
        ON ai_reply_feedback_events(contact_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_ai_reply_feedback_profile
        ON ai_reply_feedback_events(persona_profile_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS ai_reply_feedback_profiles (
        scope_type TEXT NOT NULL,
        scope_id TEXT NOT NULL,
        profile_json TEXT NOT NULL DEFAULT '{}',
        version INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(scope_type, scope_id),
        CHECK(scope_type IN ('contact', 'persona'))
      ) STRICT;

      CREATE TABLE IF NOT EXISTS ai_reply_feedback_profile_versions (
        scope_type TEXT NOT NULL,
        scope_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        profile_json TEXT NOT NULL DEFAULT '{}',
        reason TEXT NOT NULL DEFAULT 'learned',
        created_at TEXT NOT NULL,
        PRIMARY KEY(scope_type, scope_id, version),
        CHECK(scope_type IN ('contact', 'persona'))
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_ai_reply_feedback_versions_scope
        ON ai_reply_feedback_profile_versions(scope_type, scope_id, version DESC);
      INSERT OR IGNORE INTO ai_reply_feedback_profile_versions(
        scope_type, scope_id, version, profile_json, reason, created_at
      )
      SELECT scope_type, scope_id, version, profile_json, 'snapshot-backfill', updated_at
      FROM ai_reply_feedback_profiles;

      CREATE TABLE IF NOT EXISTS ai_reply_outbox (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        candidate_id TEXT NOT NULL,
        contact_id TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        account_id TEXT NOT NULL DEFAULT '',
        platform TEXT NOT NULL DEFAULT '',
        text TEXT NOT NULL,
        original_text TEXT NOT NULL DEFAULT '',
        state TEXT NOT NULL DEFAULT 'draft',
        user_approved INTEGER NOT NULL DEFAULT 0,
        approved_at TEXT NOT NULL DEFAULT '',
        approved_by TEXT NOT NULL DEFAULT '',
        send_queue_id TEXT NOT NULL DEFAULT '',
        context_version INTEGER NOT NULL DEFAULT 0,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        persona_profile_id TEXT NOT NULL DEFAULT 'owner',
        persona_version_id INTEGER NOT NULL DEFAULT 0,
        persona_policy_hash TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(contact_id) REFERENCES contacts(id) ON DELETE CASCADE
      ) STRICT;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_reply_outbox_candidate
        ON ai_reply_outbox(candidate_id);
      CREATE INDEX IF NOT EXISTS idx_ai_reply_outbox_state
        ON ai_reply_outbox(state, updated_at DESC);

      CREATE TABLE IF NOT EXISTS store_event_log (
        event_id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        domain TEXT NOT NULL DEFAULT '',
        entity_id TEXT NOT NULL DEFAULT '',
        previous_version INTEGER NOT NULL DEFAULT 0,
        state_version INTEGER NOT NULL DEFAULT 0,
        occurred_at TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT '',
        command_type TEXT NOT NULL DEFAULT '',
        command_id TEXT NOT NULL DEFAULT '',
        correlation_id TEXT NOT NULL DEFAULT '',
        payload_json TEXT NOT NULL DEFAULT '{}',
        changed_paths_json TEXT NOT NULL DEFAULT '[]'
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_store_event_log_version
        ON store_event_log(state_version, occurred_at);
      CREATE INDEX IF NOT EXISTS idx_store_event_log_domain
        ON store_event_log(domain, occurred_at DESC);

      CREATE TABLE IF NOT EXISTS background_job_state (
        job_id TEXT PRIMARY KEY,
        idempotency_key TEXT NOT NULL UNIQUE,
        job_type TEXT NOT NULL,
        platform TEXT NOT NULL DEFAULT '',
        source_account_id TEXT NOT NULL DEFAULT '',
        conversation_id TEXT NOT NULL DEFAULT '',
        entity_id TEXT NOT NULL DEFAULT '',
        revision TEXT NOT NULL DEFAULT 'v1',
        state TEXT NOT NULL DEFAULT 'PENDING',
        attempt INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 1,
        next_retry_at TEXT NOT NULL DEFAULT '',
        lock_token TEXT NOT NULL DEFAULT '',
        last_error_code TEXT NOT NULL DEFAULT '',
        retryable INTEGER NOT NULL DEFAULT 0,
        first_started_at TEXT NOT NULL DEFAULT '',
        last_started_at TEXT NOT NULL DEFAULT '',
        finished_at TEXT NOT NULL DEFAULT '',
        payload_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK(state IN ('PENDING','RUNNING','SUCCEEDED','RETRY_WAIT','FAILED_FINAL','CANCELLED','SUPERSEDED'))
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_background_job_state_claim
        ON background_job_state(job_type, state, next_retry_at, updated_at);
      CREATE INDEX IF NOT EXISTS idx_background_job_state_scope
        ON background_job_state(platform, source_account_id, conversation_id, entity_id);

      CREATE TABLE IF NOT EXISTS r32_send_queue (
        id TEXT PRIMARY KEY,
        idempotency_key TEXT NOT NULL UNIQUE,
        account_id TEXT NOT NULL,
        session_key TEXT NOT NULL,
        message_type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TEXT NOT NULL,
        locked_at TEXT NOT NULL DEFAULT '',
        last_error TEXT NOT NULL DEFAULT '',
        platform_message_id TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_r32_send_queue_claim
        ON r32_send_queue(state, next_attempt_at, created_at);
    `);

    const relationshipSignalColumns = this.db.prepare('PRAGMA table_info(relationship_state_signals)').all();
    for (const [name, definition] of [
      ['idempotency_key', "TEXT NOT NULL DEFAULT ''"],
      ['platform', "TEXT NOT NULL DEFAULT ''"],
      ['source_account_id', "TEXT NOT NULL DEFAULT ''"],
      ['platform_message_id', "TEXT NOT NULL DEFAULT ''"],
      ['projection_version', "TEXT NOT NULL DEFAULT '1.0'"]
    ]) {
      if (!relationshipSignalColumns.some(column => column.name === name)) {
        this.db.exec(`ALTER TABLE relationship_state_signals ADD COLUMN ${name} ${definition}`);
      }
    }
    const relationshipTimelineColumns = this.db.prepare('PRAGMA table_info(relationship_timeline_events)').all();
    for (const [name, definition] of [
      ['idempotency_key', "TEXT NOT NULL DEFAULT ''"],
      ['platform', "TEXT NOT NULL DEFAULT ''"],
      ['source_account_id', "TEXT NOT NULL DEFAULT ''"],
      ['platform_message_id', "TEXT NOT NULL DEFAULT ''"],
      ['projection_version', "TEXT NOT NULL DEFAULT '1.0'"]
    ]) {
      if (!relationshipTimelineColumns.some(column => column.name === name)) {
        this.db.exec(`ALTER TABLE relationship_timeline_events ADD COLUMN ${name} ${definition}`);
      }
    }
    this.db.exec('DROP INDEX IF EXISTS idx_relationship_signals_message_type');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_relationship_signals_message_type ON relationship_state_signals(message_id, signal_type)');
    this.db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_relationship_signals_idempotency ON relationship_state_signals(idempotency_key) WHERE idempotency_key <> ''");
    this.db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_relationship_timeline_idempotency ON relationship_timeline_events(idempotency_key) WHERE idempotency_key <> ''");
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_relationship_signals_scope ON relationship_state_signals(platform, source_account_id, conversation_id, platform_message_id)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_relationship_timeline_scope ON relationship_timeline_events(platform, source_account_id, conversation_id, platform_message_id)');

    const conversationColumns = this.db.prepare('PRAGMA table_info(r32_conversations)').all();
    if (!conversationColumns.some(column => column.name === 'avatar_url')) {
      this.db.exec("ALTER TABLE r32_conversations ADD COLUMN avatar_url TEXT NOT NULL DEFAULT ''");
    }
    for (const [name, definition] of [
      ['avatar_updated_at', "TEXT NOT NULL DEFAULT ''"],
      ['avatar_status', "TEXT NOT NULL DEFAULT ''"],
      ['archived_at', "TEXT NOT NULL DEFAULT ''"],
      ['archive_reason', "TEXT NOT NULL DEFAULT ''"],
      ['archived_by', "TEXT NOT NULL DEFAULT ''"],
      ['merged_into', "TEXT NOT NULL DEFAULT ''"],
      ['merged_at', "TEXT NOT NULL DEFAULT ''"],
      ['merge_reason', "TEXT NOT NULL DEFAULT ''"]
    ]) {
      if (!conversationColumns.some(column => column.name === name)) {
        this.db.exec(`ALTER TABLE r32_conversations ADD COLUMN ${name} ${definition}`);
      }
    }
    const contactColumns = this.db.prepare('PRAGMA table_info(contacts)').all();
    for (const [name, definition] of [
      ['avatar_updated_at', "TEXT NOT NULL DEFAULT ''"],
      ['avatar_status', "TEXT NOT NULL DEFAULT ''"],
      ['archived_at', "TEXT NOT NULL DEFAULT ''"],
      ['archive_reason', "TEXT NOT NULL DEFAULT ''"],
      ['archived_by', "TEXT NOT NULL DEFAULT ''"]
    ]) {
      if (!contactColumns.some(column => column.name === name)) {
        this.db.exec(`ALTER TABLE contacts ADD COLUMN ${name} ${definition}`);
      }
    }
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_contacts_archived ON contacts(archived_at)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_r32_conversations_archived ON r32_conversations(archived_at)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_r32_conversations_merged ON r32_conversations(merged_into, merged_at)');

    const taskColumns = this.db.prepare('PRAGMA table_info(ai_reply_tasks)').all();
    for (const [name, definition] of [
      ['conversation_revision', 'INTEGER NOT NULL DEFAULT 0'],
      ['performance_mode', "TEXT NOT NULL DEFAULT 'balanced'"],
      ['reply_source', "TEXT NOT NULL DEFAULT 'local_model'"]
    ]) {
      if (!taskColumns.some(column => column.name === name)) {
        this.db.exec(`ALTER TABLE ai_reply_tasks ADD COLUMN ${name} ${definition}`);
      }
    }

    const candidateColumns = this.db.prepare('PRAGMA table_info(ai_reply_candidates)').all();
    for (const [name, definition] of [
      ['persona_profile_id', "TEXT NOT NULL DEFAULT 'owner'"],
      ['persona_version_id', 'INTEGER NOT NULL DEFAULT 0'],
      ['persona_policy_hash', "TEXT NOT NULL DEFAULT ''"],
      ['conversation_revision', 'INTEGER NOT NULL DEFAULT 0'],
      ['context_message_ids_json', "TEXT NOT NULL DEFAULT '[]'"],
      ['performance_mode', "TEXT NOT NULL DEFAULT 'balanced'"],
      ['reply_source', "TEXT NOT NULL DEFAULT 'local_model'"]
    ]) {
      if (!candidateColumns.some(column => column.name === name)) {
        this.db.exec(`ALTER TABLE ai_reply_candidates ADD COLUMN ${name} ${definition}`);
      }
    }

    const feedbackEventColumns = this.db.prepare('PRAGMA table_info(ai_reply_feedback_events)').all();
    for (const [name, definition] of [
      ['reply_source', "TEXT NOT NULL DEFAULT 'local_model'"],
      ['context_revision', 'INTEGER NOT NULL DEFAULT 0'],
      ['context_message_ids_json', "TEXT NOT NULL DEFAULT '[]'"],
      ['performance_mode', "TEXT NOT NULL DEFAULT ''"],
      ['platform', "TEXT NOT NULL DEFAULT ''"],
      ['source_account_id', "TEXT NOT NULL DEFAULT ''"],
      ['platform_contact_identity', "TEXT NOT NULL DEFAULT ''"],
      ['canonical_contact_id', "TEXT NOT NULL DEFAULT ''"],
      ['learning_mode', "TEXT NOT NULL DEFAULT ''"],
      ['target_language', "TEXT NOT NULL DEFAULT ''"],
      ['translated_zh', "TEXT NOT NULL DEFAULT ''"],
      ['translation_model', "TEXT NOT NULL DEFAULT ''"],
      ['model_id', "TEXT NOT NULL DEFAULT ''"],
      ['model_name', "TEXT NOT NULL DEFAULT ''"],
      ['reply_task', "TEXT NOT NULL DEFAULT ''"],
      ['style_variant', "TEXT NOT NULL DEFAULT ''"],
      ['generation_metadata_json', "TEXT NOT NULL DEFAULT '{}'"]
    ]) {
      if (!feedbackEventColumns.some(column => column.name === name)) {
        this.db.exec(`ALTER TABLE ai_reply_feedback_events ADD COLUMN ${name} ${definition}`);
      }
    }

    const outboxColumns = this.db.prepare('PRAGMA table_info(ai_reply_outbox)').all();
    for (const [name, definition] of [
      ['persona_profile_id', "TEXT NOT NULL DEFAULT 'owner'"],
      ['persona_version_id', 'INTEGER NOT NULL DEFAULT 0'],
      ['persona_policy_hash', 'TEXT NOT NULL DEFAULT \'\'']
    ]) {
      if (!outboxColumns.some(column => column.name === name)) {
        this.db.exec(`ALTER TABLE ai_reply_outbox ADD COLUMN ${name} ${definition}`);
      }
    }

    const legacyContactsTable = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='r32_contacts'").get();
    if (legacyContactsTable) {
      this.db.exec(`
        INSERT OR IGNORE INTO contacts(
          id, platform, account_id, external_id, display_name, phone, avatar_url,
          tags_json, aliases_json, source, last_seen_at, payload_json, created_at, updated_at
        )
        SELECT id, platform, '', external_id, display_name, phone, avatar_url,
               '[]', '[]', 'r32_contacts_legacy_migration', '', payload_json, created_at, updated_at
        FROM r32_contacts;
      `);
    }

    applyStage634ArchitectureClosure(this.db);
    applyRound12PlatformCoreUnification(this.db);
    applyRound12Round13SelfCheckHardening(this.db);
    applyRound12Round13RemainingClosure(this.db);
    applyRound12Round13FinalGovernanceClosure(this.db);
    applyRound12Round13FinalSevenClosure(this.db);
    applyBatch22IdentityRouteAuthority(this.db);
    applyBatch24StateTransactionConsistency(this.db);
    applyBatch26PlatformAiLearningClosure(this.db);
    applyBatch27DeveloperHandoffV2Closure(this.db);
    applyBatch41Fix6MArchitectureReferenceClosure(this.db);
    applyBatch42Fix6OScopedSafetyAndOmnichannelRuntime(this.db);
    if (isArchitectureClosureV2DomainEventProjectionJobsCanonicalApplied(this.db)) {
      ensureArchitectureClosureV2WpABaseForSchema23Reentry(this.db);
    } else {
      applyArchitectureClosureV2WpA(this.db);
    }
    applyArchitectureClosureV2DomainEventProjectionJobsCanonical(this.db);
    ensureCanonicalProjectionReceiptSchema(this.db);
  }

  transaction(callback) {
    this.assertOwnership();
    return this.transactions.runSync(() => {
      assertCurrentAuthorityWriteHostToken(this.authorityWriteHostCapability, this.db);
      return callback(this);
    });
  }

  transactionAsync(callback) {
    this.assertOwnership();
    return this.transactions.runAsync(() => {
      assertCurrentAuthorityWriteHostToken(this.authorityWriteHostCapability, this.db);
      return callback(this);
    });
  }

  setMeta(key, value) {
    this.db.prepare(`
      INSERT INTO r32_meta(key, value_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_at=excluded.updated_at
    `).run(clean(key), json(value), nowIso());
  }

  getMeta(key, fallback = null) {
    const row = this.db.prepare('SELECT value_json FROM r32_meta WHERE key=?').get(clean(key));
    return row ? parseJson(row.value_json, fallback) : fallback;
  }

  upsertAccount(input = {}) {
    const platform = clean(first(input, ['platform', 'channel', 'provider'])).toLowerCase();
    const adapterAccountId = clean(first(input, ['adapterAccountId', 'adapter_account_id', 'externalAccountId', 'external_account_id', 'accountId']));
    const id = clean(first(input, ['id', 'accountId', 'account_id'])) || stableId('acct', [platform, adapterAccountId, first(input, ['displayName', 'name'])]);
    const timestamp = clean(first(input, ['updatedAt', 'updated_at', 'createdAt', 'created_at'])) || nowIso();
    this.db.prepare(`
      INSERT INTO r32_accounts(
        id, platform, adapter_account_id, display_name, identity_label, state,
        can_send, can_receive, canonical_account_id, lifecycle_state, merged_into_id,
        tombstoned_at, payload_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        platform=excluded.platform,
        adapter_account_id=excluded.adapter_account_id,
        display_name=excluded.display_name,
        identity_label=excluded.identity_label,
        state=excluded.state,
        can_send=CASE WHEN excluded.can_send IS NULL THEN r32_accounts.can_send ELSE excluded.can_send END,
        can_receive=CASE WHEN excluded.can_receive IS NULL THEN r32_accounts.can_receive ELSE excluded.can_receive END,
        canonical_account_id=CASE WHEN excluded.canonical_account_id<>'' THEN excluded.canonical_account_id ELSE r32_accounts.canonical_account_id END,
        lifecycle_state=excluded.lifecycle_state,
        merged_into_id=excluded.merged_into_id,
        tombstoned_at=excluded.tombstoned_at,
        payload_json=excluded.payload_json,
        updated_at=excluded.updated_at
    `).run(
      id,
      platform,
      adapterAccountId,
      clean(first(input, ['displayName', 'display_name', 'name', 'title'])),
      clean(first(input, ['identityLabel', 'identity_label', 'phone', 'username'])),
      clean(first(input, ['state', 'status'])),
      boolInt(first(input, ['canSend', 'can_send'], null)),
      boolInt(first(input, ['canReceive', 'can_receive'], null)),
      clean(first(input, ['canonicalAccountId', 'canonical_account_id'])) || id,
      clean(first(input, ['lifecycleState', 'lifecycle_state'])) || (input.paused ? 'paused' : 'active'),
      clean(first(input, ['mergedIntoId', 'merged_into_id'])),
      clean(first(input, ['tombstonedAt', 'tombstoned_at'])),
      json(input),
      clean(first(input, ['createdAt', 'created_at'])) || timestamp,
      timestamp
    );
    return id;
  }

  upsertContact(input = {}) {
    const platform = clean(first(input, ['platform', 'channel', 'provider'])).toLowerCase();
    const accountId = clean(first(input, ['accountId', 'account_id']));
    const externalId = clean(first(input, ['externalId', 'external_id', 'jid', 'remoteJid', 'remote_jid', 'phone', 'username']));
    const requestedId = clean(first(input, ['id', 'contactId', 'contact_id', 'contactKey', 'contact_key'])) || stableId('contact', [platform, externalId, first(input, ['displayName', 'name', 'title'])]);

    // The authoritative contact identity is the account-scoped natural key.
    // Older builds generated several different primary-key formats for the
    // same Facebook PSID. Reusing the existing natural-key row prevents a
    // second INSERT from violating idx_contacts_external and preserves all
    // foreign-key references to the original contact id.
    const natural = externalId
      ? this.db.prepare(`
          SELECT * FROM contacts
          WHERE platform=? AND account_id=? AND external_id=?
          LIMIT 1
        `).get(platform, accountId, externalId)
      : null;
    const existing = natural || this.db.prepare('SELECT * FROM contacts WHERE id=?').get(requestedId) || null;
    const id = clean(existing?.id) || requestedId;
    const existingPayload = parseJson(existing?.payload_json, {}) || {};
    const normalizedInput = {
      ...existingPayload,
      ...input,
      id,
      contactId: id,
      platform,
      accountId,
      externalId
    };
    const timestamp = clean(first(input, ['updatedAt', 'updated_at', 'createdAt', 'created_at'])) || nowIso();
    const tags = Array.isArray(input.tags) ? input.tags : parseJson(existing?.tags_json, []);
    const aliases = Array.isArray(input.aliases) ? input.aliases : parseJson(existing?.aliases_json, []);
    this.db.prepare(`
      INSERT INTO contacts(
        id, platform, account_id, external_id, display_name, phone, avatar_url, avatar_updated_at, avatar_status,
        tags_json, aliases_json, source, last_seen_at, canonical_contact_id,
        merged_into_id, tombstoned_at, payload_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        platform=excluded.platform,
        account_id=CASE WHEN excluded.account_id <> '' THEN excluded.account_id ELSE contacts.account_id END,
        external_id=CASE WHEN excluded.external_id <> '' THEN excluded.external_id ELSE contacts.external_id END,
        display_name=CASE WHEN excluded.display_name <> '' THEN excluded.display_name ELSE contacts.display_name END,
        phone=CASE WHEN excluded.phone <> '' THEN excluded.phone ELSE contacts.phone END,
        avatar_url=CASE WHEN excluded.avatar_url <> '' THEN excluded.avatar_url ELSE contacts.avatar_url END,
        avatar_updated_at=CASE WHEN excluded.avatar_updated_at <> '' THEN excluded.avatar_updated_at ELSE contacts.avatar_updated_at END,
        avatar_status=CASE WHEN excluded.avatar_status <> '' THEN excluded.avatar_status ELSE contacts.avatar_status END,
        tags_json=excluded.tags_json,
        aliases_json=excluded.aliases_json,
        source=CASE WHEN excluded.source <> '' THEN excluded.source ELSE contacts.source END,
        last_seen_at=CASE WHEN excluded.last_seen_at <> '' THEN excluded.last_seen_at ELSE contacts.last_seen_at END,
        canonical_contact_id=CASE WHEN excluded.canonical_contact_id<>'' THEN excluded.canonical_contact_id ELSE contacts.canonical_contact_id END,
        merged_into_id=excluded.merged_into_id,
        tombstoned_at=excluded.tombstoned_at,
        payload_json=excluded.payload_json,
        updated_at=excluded.updated_at
    `).run(
      id,
      platform,
      accountId,
      externalId,
      clean(first(input, ['displayName', 'display_name', 'name', 'title'])),
      clean(first(input, ['phone', 'phoneNumber', 'phone_number'])),
      clean(first(input, ['avatarUrl', 'avatar_url', 'avatar', 'photoUrl', 'photo_url'])),
      clean(first(input, ['avatarUpdatedAt', 'avatar_updated_at'])),
      clean(first(input, ['avatarStatus', 'avatar_status'])),
      json(Array.isArray(tags) ? tags : []),
      json(Array.isArray(aliases) ? aliases : []),
      clean(first(input, ['source'])),
      clean(first(input, ['lastSeenAt', 'last_seen_at'])),
      clean(first(input, ['canonicalContactId', 'canonical_contact_id'])) || clean(existing?.canonical_contact_id) || id,
      clean(first(input, ['mergedIntoId', 'merged_into_id'])) || clean(existing?.merged_into_id),
      clean(first(input, ['tombstonedAt', 'tombstoned_at'])) || clean(existing?.tombstoned_at),
      json(normalizedInput),
      clean(existing?.created_at) || clean(first(input, ['createdAt', 'created_at'])) || timestamp,
      timestamp
    );
    return id;
  }

  upsertConversation(input = {}) {
    const sessionKey = clean(first(input, ['sessionKey', 'session_key', 'conversationKey', 'conversation_key', 'id', 'key']));
    if (!sessionKey) throw new Error('Conversation sessionKey is required');
    const timestamp = clean(first(input, ['updatedAt', 'updated_at', 'lastMessageAt', 'last_message_at', 'createdAt', 'created_at'])) || nowIso();
    this.db.prepare(`
      INSERT INTO r32_conversations(
        session_key, account_id, contact_id, platform, title, avatar_url, avatar_updated_at, avatar_status, last_message,
        last_message_at, unread_count, route_state, payload_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_key) DO UPDATE SET
        account_id=excluded.account_id,
        contact_id=excluded.contact_id,
        platform=excluded.platform,
        title=excluded.title,
        avatar_url=CASE
          WHEN excluded.avatar_url <> '' THEN excluded.avatar_url
          ELSE r32_conversations.avatar_url
        END,
        avatar_updated_at=CASE WHEN excluded.avatar_updated_at <> '' THEN excluded.avatar_updated_at ELSE r32_conversations.avatar_updated_at END,
        avatar_status=CASE WHEN excluded.avatar_status <> '' THEN excluded.avatar_status ELSE r32_conversations.avatar_status END,
        last_message=excluded.last_message,
        last_message_at=excluded.last_message_at,
        unread_count=excluded.unread_count,
        route_state=excluded.route_state,
        payload_json=excluded.payload_json,
        updated_at=excluded.updated_at
    `).run(
      sessionKey,
      clean(first(input, ['accountId', 'account_id'])),
      clean(first(input, ['contactId', 'contact_id', 'contactKey', 'contact_key'])),
      clean(first(input, ['platform', 'channel', 'provider'])).toLowerCase(),
      clean(first(input, ['title', 'displayName', 'display_name', 'contactName', 'contact_name', 'name'])),
      clean(first(input, ['avatarUrl', 'avatar_url', 'avatar', 'photoUrl', 'photo_url'])),
      clean(first(input, ['avatarUpdatedAt', 'avatar_updated_at'])),
      clean(first(input, ['avatarStatus', 'avatar_status'])),
      clean(first(input, ['lastMessage', 'last_message', 'preview', 'snippet'])),
      clean(first(input, ['lastMessageAt', 'last_message_at', 'timestamp', 'time'])) || timestamp,
      Math.max(0, integer(first(input, ['unreadCount', 'unread_count', 'unread'], 0))),
      clean(first(input, ['routeState', 'route_state', 'state'])),
      json(input),
      clean(first(input, ['createdAt', 'created_at'])) || timestamp,
      timestamp
    );
    return sessionKey;
  }

  touchConversationFromMessage(input = {}) {
    const sessionKey = clean(first(input, ['sessionKey', 'session_key', 'conversationKey', 'conversation_key', 'conversationId', 'conversation_id']));
    if (!sessionKey) throw new Error('Message sessionKey is required');
    const sentAt = clean(first(input, ['sentAt', 'sent_at', 'timestamp', 'time', 'createdAt', 'created_at'])) || nowIso();
    const accountId = clean(first(input, ['accountId', 'account_id']));
    const title = clean(first(input, ['contactName', 'contact_name', 'senderName', 'sender_name', 'title']));
    const lastMessage = clean(first(input, ['text', 'content', 'body', 'message', 'messageText', 'message_text']));
    const avatarUrl = clean(first(input, ['avatarUrl', 'avatar_url', 'avatar', 'photoUrl', 'photo_url']));
    const payload = { sessionKey, accountId, title, avatarUrl, avatar_url: avatarUrl, avatar: avatarUrl, photo_url: avatarUrl, lastMessage, lastMessageAt: sentAt };
    this.db.prepare(`
      INSERT INTO r32_conversations(
        session_key, account_id, contact_id, platform, title, avatar_url, last_message,
        last_message_at, unread_count, route_state, payload_json, created_at, updated_at
      ) VALUES (?, ?, '', '', ?, ?, ?, ?, 0, '', ?, ?, ?)
      ON CONFLICT(session_key) DO UPDATE SET
        account_id=CASE WHEN excluded.account_id <> '' THEN excluded.account_id ELSE r32_conversations.account_id END,
        title=CASE WHEN excluded.title <> '' THEN excluded.title ELSE r32_conversations.title END,
        avatar_url=CASE WHEN excluded.avatar_url <> '' THEN excluded.avatar_url ELSE r32_conversations.avatar_url END,
        last_message=CASE
          WHEN excluded.last_message_at >= r32_conversations.last_message_at THEN excluded.last_message
          ELSE r32_conversations.last_message
        END,
        last_message_at=CASE
          WHEN excluded.last_message_at >= r32_conversations.last_message_at THEN excluded.last_message_at
          ELSE r32_conversations.last_message_at
        END,
        updated_at=CASE
          WHEN excluded.updated_at >= r32_conversations.updated_at THEN excluded.updated_at
          ELSE r32_conversations.updated_at
        END
    `).run(sessionKey, accountId, title, avatarUrl, lastMessage, sentAt, json(payload), sentAt, sentAt);
    return sessionKey;
  }

  upsertMessage(input = {}) {
    const sessionKey = clean(first(input, ['sessionKey', 'session_key', 'conversationKey', 'conversation_key', 'conversationId', 'conversation_id']));
    if (!sessionKey) throw new Error('Message sessionKey is required');
    const text = clean(first(input, ['text', 'content', 'body', 'message', 'messageText', 'message_text']));
    const sentAt = clean(first(input, ['sentAt', 'sent_at', 'timestamp', 'time', 'createdAt', 'created_at'])) || nowIso();
    const id = clean(first(input, ['dedupeKey', 'dedupe_key', 'id', 'messageId', 'message_id', 'platformMessageId', 'platform_message_id'])) || stableId('msg', [sessionKey, sentAt, first(input, ['senderId', 'sender_id', 'from']), text]);
    const timestamp = clean(first(input, ['updatedAt', 'updated_at'])) || sentAt;
    const role = clean(first(input, ['role', 'senderType', 'sender_type']));
    const direction = clean(first(input, ['direction']));
    const existingRow = this.db.prepare('SELECT text, payload_json AS payloadJson FROM r32_messages WHERE id=?').get(id);
    const existingPayload = parseJson(existingRow?.payloadJson, {}) || {};
    const persistedInput = mergeMessagePayload(existingPayload, input, existingRow?.text, text);
    this.db.prepare(`
      INSERT INTO r32_messages(
        id, session_key, account_id, sender_id, role, direction, message_type,
        text, media_url, media_path, quoted_message_id, delivery_status,
        sent_at, external_identity_id, payload_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        session_key=excluded.session_key,
        account_id=excluded.account_id,
        sender_id=excluded.sender_id,
        role=excluded.role,
        direction=excluded.direction,
        message_type=excluded.message_type,
        text=excluded.text,
        media_url=excluded.media_url,
        media_path=excluded.media_path,
        quoted_message_id=excluded.quoted_message_id,
        delivery_status=excluded.delivery_status,
        sent_at=excluded.sent_at,
        external_identity_id=CASE WHEN excluded.external_identity_id<>'' THEN excluded.external_identity_id ELSE r32_messages.external_identity_id END,
        payload_json=excluded.payload_json,
        updated_at=excluded.updated_at
    `).run(
      id,
      sessionKey,
      clean(first(input, ['accountId', 'account_id'])),
      clean(first(input, ['senderId', 'sender_id', 'sender', 'from', 'author'])),
      role,
      direction,
      clean(first(input, ['messageType', 'message_type', 'mediaType', 'media_type', 'type'])) || 'text',
      text,
      clean(first(input, ['mediaUrl', 'media_url', 'url'])),
      clean(first(input, ['mediaPath', 'media_path', 'filePath', 'file_path'])),
      clean(first(input, ['quotedMessageId', 'quoted_message_id', 'replyTo', 'reply_to'])),
      clean(first(input, ['deliveryStatus', 'delivery_status', 'status'])),
      sentAt,
      clean(first(input, ['externalIdentityId', 'external_identity_id'])),
      json(persistedInput),
      clean(first(input, ['createdAt', 'created_at'])) || sentAt,
      timestamp
    );
    this.db.prepare('DELETE FROM r32_messages_fts WHERE message_id=?').run(id);
    const translatedZh = clean(first(persistedInput, ['translatedZh', 'translationZh', 'translationZH', 'chineseTranslation', 'chinese']));
    const searchableText = [text, translatedZh].filter(Boolean).join('\n');
    if (searchableText) this.db.prepare('INSERT INTO r32_messages_fts(message_id, session_key, text) VALUES (?, ?, ?)').run(id, sessionKey, searchableText);
    return id;
  }

  setSetting(namespace, key, value) {
    this.db.prepare(`
      INSERT INTO r32_settings(namespace, key, value_json, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(namespace, key) DO UPDATE SET value_json=excluded.value_json, updated_at=excluded.updated_at
    `).run(clean(namespace), clean(key), json(value), nowIso());
  }

  getSetting(namespace, key, fallback = null) {
    const row = this.db.prepare('SELECT value_json FROM r32_settings WHERE namespace=? AND key=?').get(clean(namespace), clean(key));
    return row ? parseJson(row.value_json, fallback) : fallback;
  }

  listConversations(options = {}) {
    const limit = Math.min(2001, Math.max(1, integer(options.limit, 100)));
    const offset = Math.max(0, integer(options.offset, 0));
    return this.db.prepare(`
      SELECT conv.session_key AS sessionKey, conv.account_id AS accountId, conv.contact_id AS contactId,
             conv.platform, conv.title, conv.avatar_url AS conversationAvatarUrl,
             conv.avatar_updated_at AS conversationAvatarUpdatedAt, conv.avatar_status AS conversationAvatarStatus,
             contact.avatar_url AS contactAvatarUrl, contact.avatar_updated_at AS contactAvatarUpdatedAt,
             contact.avatar_status AS contactAvatarStatus, contact.payload_json AS contactPayloadJson,
             contact.archived_at AS contactArchivedAt, contact.archive_reason AS contactArchiveReason,
             contact.archived_by AS contactArchivedBy,
             conv.last_message AS lastMessage, conv.last_message_at AS lastMessageAt,
             conv.unread_count AS unreadCount, conv.route_state AS routeState,
             conv.archived_at AS conversationArchivedAt, conv.archive_reason AS conversationArchiveReason,
             conv.archived_by AS conversationArchivedBy, conv.merged_into AS mergedInto,
             conv.merged_at AS mergedAt, conv.merge_reason AS mergeReason, conv.payload_json AS payloadJson
      FROM r32_conversations conv
      LEFT JOIN contacts contact ON contact.id = conv.contact_id
      LEFT JOIN r32_accounts account ON account.id = conv.account_id
      WHERE NULLIF(conv.merged_into, '') IS NULL
        AND COALESCE(conv.archive_reason, '') <> 'synthetic-mobile-voice-echo'
        AND COALESCE(contact.archive_reason, '') <> 'synthetic-mobile-voice-echo'
        AND COALESCE(NULLIF(contact.merged_into_id, ''), NULLIF(contact.tombstoned_at, '')) IS NULL
        AND COALESCE(NULLIF(account.merged_into_id, ''), NULLIF(account.tombstoned_at, '')) IS NULL
      ORDER BY CASE WHEN COALESCE(NULLIF(conv.archived_at, ''), NULLIF(contact.archived_at, '')) IS NULL THEN 0 ELSE 1 END ASC,
               COALESCE(NULLIF(conv.last_message_at, ''), conv.updated_at) DESC,
               conv.session_key ASC
      LIMIT ? OFFSET ?
    `).all(limit, offset).map(row => {
      const payload = parseJson(row.payloadJson, {}) || {};
      const contactPayload = parseJson(row.contactPayloadJson, {}) || {};
      const avatarUrl = clean(first({
        avatarUrl: row.conversationAvatarUrl,
        avatar_url: payload.avatar_url,
        avatar: payload.avatar,
        photo_url: payload.photo_url,
        payloadAvatarUrl: payload.avatarUrl,
        payloadPhotoUrl: payload.photoUrl,
        contactAvatarUrl: row.contactAvatarUrl,
        contactPayloadAvatarUrl: first(contactPayload, ['avatarUrl', 'avatar_url', 'avatar', 'photoUrl', 'photo_url'])
      }, ['avatarUrl', 'avatar_url', 'avatar', 'photo_url', 'payloadAvatarUrl', 'payloadPhotoUrl', 'contactAvatarUrl', 'contactPayloadAvatarUrl']));
      const result = {
        ...contactPayload,
        ...payload,
        ...row,
        avatarUrl,
        avatar_url: avatarUrl,
        avatar: avatarUrl,
        photo_url: avatarUrl,
        avatarUpdatedAt: row.conversationAvatarUpdatedAt || row.contactAvatarUpdatedAt || payload.avatarUpdatedAt || contactPayload.avatarUpdatedAt || '',
        avatar_updated_at: row.conversationAvatarUpdatedAt || row.contactAvatarUpdatedAt || payload.avatar_updated_at || contactPayload.avatar_updated_at || '',
        avatarStatus: row.conversationAvatarStatus || row.contactAvatarStatus || payload.avatarStatus || contactPayload.avatarStatus || '',
        avatar_status: row.conversationAvatarStatus || row.contactAvatarStatus || payload.avatar_status || contactPayload.avatar_status || '',
        unread: row.unreadCount,
        archived: Boolean(row.conversationArchivedAt || row.contactArchivedAt),
        archivedAt: row.conversationArchivedAt || row.contactArchivedAt || '',
        archiveReason: row.conversationArchiveReason || row.contactArchiveReason || '',
        archivedBy: row.conversationArchivedBy || row.contactArchivedBy || '',
        updatedAt: row.lastMessageAt || payload.updatedAt || payload.updated_at || '',
        lastText: row.lastMessage
      };
      delete result.contactPayloadJson;
      return { ...result, payload: { ...contactPayload, ...payload, avatarUrl, avatar_url: avatarUrl, avatar: avatarUrl, photo_url: avatarUrl, avatarUpdatedAt: result.avatarUpdatedAt, avatar_updated_at: result.avatar_updated_at, avatarStatus: result.avatarStatus, avatar_status: result.avatar_status } };
    });
  }

  listMessages(sessionKey, options = {}) {
    const limit = Math.min(5001, Math.max(1, integer(options.limit, 1000)));
    const before = options.before && typeof options.before === 'object' ? options.before : null;
    const after = options.after && typeof options.after === 'object' ? options.after : null;
    const sortExpr = "COALESCE(NULLIF(sent_at, ''), created_at)";
    const where = ['session_key=?'];
    const params = [clean(sessionKey)];
    let descending = true;
    if (before?.time) {
      where.push(`(${sortExpr} < ? OR (${sortExpr} = ? AND id < ?))`);
      params.push(clean(before.time), clean(before.time), clean(before.id));
    } else if (after?.time) {
      where.push(`(${sortExpr} > ? OR (${sortExpr} = ? AND id > ?))`);
      params.push(clean(after.time), clean(after.time), clean(after.id));
      descending = false;
    }
    params.push(limit);
    let rows = this.db.prepare(`
      SELECT id, session_key AS sessionKey, account_id AS accountId, sender_id AS senderId,
             role, direction, message_type AS messageType, text, media_url AS mediaUrl,
             media_path AS mediaPath, quoted_message_id AS quotedMessageId,
             delivery_status AS deliveryStatus, sent_at AS sentAt, created_at AS createdAt,
             payload_json AS payloadJson
      FROM r32_messages
      WHERE ${where.join(' AND ')}
      ORDER BY ${sortExpr} ${descending ? 'DESC' : 'ASC'}, id ${descending ? 'DESC' : 'ASC'}
      LIMIT ?
    `).all(...params);
    if (descending) rows = rows.reverse();
    return rows.map(row => {
      const payload = parseJson(row.payloadJson, {}) || {};
      return { ...payload, ...row, timestamp: row.sentAt || row.createdAt || payload.timestamp || payload.createdAt || '', type: row.messageType, status: row.deliveryStatus, payload };
    });
  }

  getMessage(id) {
    const row = this.db.prepare(`
      SELECT id, session_key AS sessionKey, account_id AS accountId, sender_id AS senderId,
             role, direction, message_type AS messageType, text, media_url AS mediaUrl,
             media_path AS mediaPath, quoted_message_id AS quotedMessageId,
             delivery_status AS deliveryStatus, sent_at AS sentAt, created_at AS createdAt,
             payload_json AS payloadJson
      FROM r32_messages WHERE id=?
    `).get(clean(id));
    if (!row) return null;
    const payload = parseJson(row.payloadJson, {}) || {};
    return { ...payload, ...row, timestamp: row.sentAt || row.createdAt || payload.timestamp || payload.createdAt || '', type: row.messageType, status: row.deliveryStatus, payload };
  }

  searchMessages(query, options = {}) {
    const term = clean(query);
    if (!term) return [];
    const limit = Math.min(500, Math.max(1, integer(options.limit, 100)));
    let rows = [];
    try {
      rows = this.db.prepare(`
        SELECT m.id, m.session_key AS sessionKey, m.role, m.direction, m.message_type AS messageType,
               m.text, m.sent_at AS sentAt, bm25(r32_messages_fts) AS rank
        FROM r32_messages_fts
        JOIN r32_messages m ON m.id=r32_messages_fts.message_id
        WHERE r32_messages_fts MATCH ?
        ORDER BY rank, m.sent_at DESC
        LIMIT ?
      `).all(term, limit);
    } catch (_) {
      rows = [];
    }
    if (rows.length) return rows;
    return this.db.prepare(`
      SELECT id, session_key AS sessionKey, role, direction, message_type AS messageType,
             text, sent_at AS sentAt, 0 AS rank
      FROM r32_messages
      WHERE instr(COALESCE(text, ''), ?) > 0
         OR instr(COALESCE(json_extract(payload_json, '$.translatedZh'), ''), ?) > 0
         OR instr(COALESCE(json_extract(payload_json, '$.translationZh'), ''), ?) > 0
         OR instr(COALESCE(json_extract(payload_json, '$.chineseTranslation'), ''), ?) > 0
      ORDER BY sent_at DESC
      LIMIT ?
    `).all(term, term, term, term, limit);
  }

  enqueueSend(input = {}) {
    const idempotencyKey = clean(input.idempotencyKey || input.idempotency_key);
    if (!idempotencyKey) throw new Error('idempotencyKey is required');
    const id = clean(input.id) || stableId('send', [idempotencyKey]);
    const timestamp = nowIso();
    const accountId = clean(input.accountId || input.account_id);
    const sessionKey = clean(input.sessionKey || input.session_key);
    const messageType = clean(input.messageType || input.message_type) || 'text';
    const payload = input.payload ?? input;
    const outboxId = clean(input.outboxId || input.outbox_id);
    const sendPolicy = input.sendPolicy || input.send_policy || {};
    const capabilitySnapshotId = clean(input.capabilitySnapshotId || input.capability_snapshot_id);
    const qualityTier = clean(input.qualityTier || input.quality_tier);
    const emergencyMode = input.emergencyMode === true || Number(input.emergency_mode || 0) === 1 ? 1 : 0;
    const outboxRouteId = clean(input.outboxRouteId || input.outbox_route_id);
    const outboxRouteVersionId = clean(input.outboxRouteVersionId || input.outbox_route_version_id);
    const existing = this.db.prepare('SELECT * FROM r32_send_queue WHERE idempotency_key=?').get(idempotencyKey);
    if (existing) {
      const same = clean(existing.id) === id
        && clean(existing.account_id) === accountId
        && clean(existing.session_key) === sessionKey
        && clean(existing.message_type) === messageType
        && canonicalJson(parseJson(existing.payload_json, null)) === canonicalJson(payload)
        && clean(existing.outbox_id) === outboxId
        && canonicalJson(parseJson(existing.send_policy_json, {})) === canonicalJson(sendPolicy)
        && clean(existing.capability_snapshot_id) === capabilitySnapshotId
        && clean(existing.quality_tier) === qualityTier
        && Number(existing.emergency_mode || 0) === emergencyMode
        && clean(existing.outbox_route_id) === outboxRouteId
        && clean(existing.outbox_route_version_id) === outboxRouteVersionId;
      if (!same) {
        throw Object.assign(new Error('相同幂等键对应了不同的发送队列命令，已阻止静默复用。'), {
          code: 'SEND_QUEUE_IDEMPOTENCY_CONFLICT', status: 409, idempotencyKey, existingQueueId: clean(existing.id), incomingQueueId: id
        });
      }
      return existing;
    }
    this.db.prepare(`
      INSERT INTO r32_send_queue(
        id, idempotency_key, account_id, session_key, message_type, payload_json,
        outbox_id, send_policy_json, capability_snapshot_id, quality_tier, emergency_mode,
        outbox_route_id, outbox_route_version_id,
        state, attempts, next_attempt_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?)
    `).run(
      id, idempotencyKey, accountId, sessionKey, messageType, json(payload), outboxId, json(sendPolicy),
      capabilitySnapshotId, qualityTier, emergencyMode, outboxRouteId, outboxRouteVersionId,
      clean(input.nextAttemptAt || input.next_attempt_at) || timestamp, timestamp, timestamp
    );
    return this.db.prepare('SELECT * FROM r32_send_queue WHERE idempotency_key=?').get(idempotencyKey);
  }

  persistSendQueueOutboxCommand(id, command = {}, metadata = {}, claimInput = {}) {
    const queueId = clean(id);
    if (!queueId) throw Object.assign(new Error('发送队列缺少任务 ID'), { code: 'SEND_QUEUE_ID_REQUIRED' });
    return this.transaction(() => {
      const current = this.db.prepare('SELECT * FROM r32_send_queue WHERE id=?').get(queueId);
      if (!current) throw Object.assign(new Error('发送队列任务不存在'), { code: 'SEND_QUEUE_ITEM_NOT_FOUND' });
      if (current.state !== 'sending') throw Object.assign(new Error('仅已领取的发送任务可以固化 OutboxCommand'), { code: 'SEND_QUEUE_NOT_CLAIMED', state: current.state });
      const claim = this._assertQueueClaim(current, claimInput, 'SEND_QUEUE_OUTBOX_COMMAND_STALE');
      const payload = parseJson(current.payload_json, {}) || {};
      payload.outboxCommand = command;
      const timestamp = nowIso();
      this.db.prepare(`
        UPDATE r32_send_queue
        SET payload_json=?, outbox_id=?, send_policy_json=?, capability_snapshot_id=?, quality_tier=?, emergency_mode=?, updated_at=?
        WHERE id=? AND state='sending' AND claim_generation=? AND claim_token=?
      `).run(
        json(payload), clean(metadata.outboxId || command.outboxId), json(metadata.sendPolicy || {}),
        clean(metadata.capabilitySnapshotId || command.capabilitySnapshotId), clean(metadata.qualityTier || command.qualityTier),
        metadata.emergencyMode === true || command.emergencyMode === true ? 1 : 0, timestamp, queueId,
        Number(claim.generation), clean(claim.token)
      );
      const persisted = this.getSendQueueItem(queueId);
      if (!persisted || persisted.payload?.outboxCommand == null) throw staleQueueCompletion(queueId,current,claim,'SEND_QUEUE_OUTBOX_COMMAND_STALE');
      return persisted;
    });
  }

  claimNextSend() {
    return this.transaction(() => {
      const row = this.db.prepare(`
        SELECT * FROM r32_send_queue
        WHERE state IN ('pending', 'retry') AND next_attempt_at <= ?
          AND outbox_route_version_id<>''
          AND EXISTS(SELECT 1 FROM outbox_route_versions v
            WHERE v.route_version_id=r32_send_queue.outbox_route_version_id
              AND v.account_id=r32_send_queue.account_id
              AND v.conversation_id=r32_send_queue.session_key)
          AND NOT EXISTS(
            SELECT 1
            FROM r32_send_queue unresolved
            WHERE unresolved.state='send_outcome_unknown'
              AND unresolved.unknown_scope='account'
              AND LOWER(TRIM(
                CASE
                  WHEN TRIM(unresolved.unknown_lane)<>'' THEN unresolved.unknown_lane
                  ELSE COALESCE(json_extract(unresolved.payload_json,'$.platform'),'unknown')
                    ||':'||COALESCE(NULLIF(TRIM(unresolved.account_id),''),'unknown')
                END
              ))=LOWER(
                TRIM(COALESCE(json_extract(r32_send_queue.payload_json,'$.platform'),'unknown'))
                ||':'||COALESCE(NULLIF(TRIM(r32_send_queue.account_id),''),'unknown')
              )
          )
        ORDER BY created_at ASC
        LIMIT 1
      `).get(nowIso());
      if (!row) return null;
      const lockedAt = nowIso();
      const token = crypto.randomUUID();
      const executionGeneration = crypto.randomUUID();
      const payload = parseJson(row.payload_json, {}) || {};
      const lane = `${clean(payload.platform, 'unknown').toLowerCase()}:${clean(row.account_id, 'unknown')}`;
      const leaseExpiresAt = new Date(Date.now() + 120000).toISOString();
      const result = this.db.prepare(`
        UPDATE r32_send_queue
        SET state='sending', attempts=attempts+1, claim_generation=claim_generation+1,
            claim_token=?, locked_at=?, lease_expires_at=?, execution_generation=?,
            unknown_scope='command', unknown_lane=?, unknown_reason='', unknown_recorded_at='',
            row_version=row_version+1, updated_at=?
        WHERE id=? AND state IN ('pending', 'retry') AND row_version=?
      `).run(token, lockedAt, leaseExpiresAt, executionGeneration, lane, lockedAt, row.id, Number(row.row_version || 0));
      if (Number(result.changes || 0) !== 1) return null;
      return this.getSendQueueItem(row.id);
    });
  }

  _assertQueueClaim(current, claimInput = {}, code = 'SEND_QUEUE_STALE_COMPLETION') {
    const claim = queueClaim(claimInput);
    const persistedToken = clean(current?.claim_token);
    if (!persistedToken) return { generation: Number(current?.claim_generation || 0), token: '' };
    if (!claim.token || claim.token !== persistedToken || Number(claim.generation) !== Number(current.claim_generation || 0)) {
      throw staleQueueCompletion(current?.id, current, claim, code);
    }
    return claim;
  }

  markSendResult(id, result = {}, claimInput = {}) {
    const current = this.getSendQueueItem(id);
    if (!current) return null;
    const expectedState = clean(result.expectedState) || current.state;
    if (!['sending','platform_accepted_local_pending'].includes(expectedState)) {
      const staleSafetyStates = new Set(['send_outcome_unknown','sent','failed','cancelled']);
      throw Object.assign(new Error(`Queue cannot be completed from ${expectedState}`), {
        code: staleSafetyStates.has(expectedState) ? 'SEND_QUEUE_STALE_COMPLETION' : 'SEND_QUEUE_COMPLETION_STATE_INVALID',
        status: 409, queueId: clean(id), state: expectedState
      });
    }
    const claim = this._assertQueueClaim(current, claimInput, 'SEND_QUEUE_STALE_COMPLETION');
    const success = result.success === true;
    const state = success ? 'sent' : (result.retry === false ? 'failed' : 'retry');
    const nextAttemptAt = success ? nowIso() : clean(result.nextAttemptAt) || new Date(Date.now() + 30000).toISOString();
    const timestamp = nowIso();
    const update = this.db.prepare(`
      UPDATE r32_send_queue
      SET state=?, next_attempt_at=?, locked_at='', lease_expires_at='', claim_token='',
          last_error=?, platform_message_id=?, unknown_scope='',unknown_reason='',unknown_lane='',unknown_recorded_at='',
          row_version=row_version+1, updated_at=?
      WHERE id=? AND state=? AND claim_generation=? AND claim_token=?
    `).run(state,nextAttemptAt,clean(result.error).slice(0,2000),clean(result.platformMessageId || result.platform_message_id),timestamp,
      clean(id),expectedState,Number(claim.generation),clean(claim.token));
    if (Number(update.changes || 0) !== 1) throw staleQueueCompletion(id,current,claim,'SEND_QUEUE_STALE_COMPLETION');
    return this.getSendQueueItem(id);
  }

  markPlatformAcceptedLocalPending(id, result = {}, claimInput = {}) {
    const current = this.getSendQueueItem(id);
    if (!current) return null;
    const payload = {
      ...(current.payload || {}),
      _localPersistencePlans: Array.isArray(result.localPersistencePlans) ? result.localPersistencePlans : [],
      _platformAcceptedAt: clean(result.platformAcceptedAt) || nowIso()
    };
    const timestamp = nowIso();
    let claim;
    if (current.state === 'send_outcome_unknown') {
      claim = { generation: Number(current.claim_generation || 0) + 1, token: crypto.randomUUID() };
      const update = this.db.prepare(`UPDATE r32_send_queue SET state='platform_accepted_local_pending',payload_json=?,next_attempt_at=?,
        locked_at=?,lease_expires_at=?,claim_generation=?,claim_token=?,last_error=?,platform_message_id=?,
        unknown_scope='',unknown_reason='',unknown_lane='',unknown_recorded_at='',row_version=row_version+1,updated_at=?
        WHERE id=? AND state='send_outcome_unknown' AND row_version=?`).run(
          json(payload),timestamp,timestamp,new Date(Date.now()+600000).toISOString(),claim.generation,claim.token,
          clean(result.error).slice(0,2000),clean(result.platformMessageId || result.platform_message_id),timestamp,clean(id),Number(current.row_version||0));
      if (Number(update.changes || 0) !== 1) throw staleQueueCompletion(id,current,claim,'SEND_QUEUE_RECONCILIATION_STALE');
      return this.getSendQueueItem(id);
    }
    if (current.state === 'platform_accepted_local_pending') {
      claim = this._assertQueueClaim(current, claimInput, 'SEND_QUEUE_LOCAL_CHECKPOINT_STALE');
      const update = this.db.prepare(`UPDATE r32_send_queue SET payload_json=?,next_attempt_at=?,last_error=?,platform_message_id=?,
        lease_expires_at=?,row_version=row_version+1,updated_at=? WHERE id=? AND state='platform_accepted_local_pending' AND claim_generation=? AND claim_token=?`)
        .run(json(payload),timestamp,clean(result.error).slice(0,2000),clean(result.platformMessageId || result.platform_message_id),
          new Date(Date.now()+600000).toISOString(),timestamp,clean(id),Number(claim.generation),clean(claim.token));
      if (Number(update.changes || 0) !== 1) throw staleQueueCompletion(id,current,claim,'SEND_QUEUE_LOCAL_CHECKPOINT_STALE');
      return this.getSendQueueItem(id);
    }
    if (current.state !== 'sending') {
      throw Object.assign(new Error(`Queue cannot enter platform accepted checkpoint from ${current.state}`), { code: 'SEND_QUEUE_ACCEPTED_STATE_INVALID', status: 409 });
    }
    claim = this._assertQueueClaim(current, claimInput, 'SEND_QUEUE_ACCEPTED_STALE_COMPLETION');
    const update = this.db.prepare(`UPDATE r32_send_queue SET state='platform_accepted_local_pending',payload_json=?,next_attempt_at=?,
      locked_at=?,lease_expires_at=?,last_error=?,platform_message_id=?,unknown_scope='',unknown_reason='',unknown_lane='',unknown_recorded_at='',
      row_version=row_version+1,updated_at=?
      WHERE id=? AND state='sending' AND claim_generation=? AND claim_token=?`).run(
        json(payload),timestamp,timestamp,new Date(Date.now()+600000).toISOString(),clean(result.error).slice(0,2000),
        clean(result.platformMessageId || result.platform_message_id),timestamp,clean(id),Number(claim.generation),clean(claim.token));
    if (Number(update.changes || 0) !== 1) throw staleQueueCompletion(id,current,claim,'SEND_QUEUE_ACCEPTED_STALE_COMPLETION');
    return this.getSendQueueItem(id);
  }

  markSendOutcomeUnknown(id, result = {}, claimInput = {}) {
    const current = this.getSendQueueItem(id);
    if (!current) return null;
    const timestamp = nowIso();
    const scope = ['command','account','global'].includes(clean(result.unknownScope || result.unknown_scope).toLowerCase())
      ? clean(result.unknownScope || result.unknown_scope).toLowerCase()
      : clean(current.unknown_scope || 'account').toLowerCase();
    const payload = current.payload || parseJson(current.payload_json, {}) || {};
    const lane = clean(result.unknownLane || result.unknown_lane || current.unknown_lane)
      || `${clean(payload.platform, 'unknown').toLowerCase()}:${clean(current.account_id, 'unknown')}`;
    const reason = clean(result.unknownReason || result.unknown_reason || result.error || current.unknown_reason || 'SEND_OUTCOME_UNKNOWN').slice(0, 2000);
    const executionGeneration = clean(result.executionGeneration || result.execution_generation || current.execution_generation);
    if (current.state === 'send_outcome_unknown') {
      const persistedGeneration = clean(current.execution_generation);
      if (persistedGeneration && executionGeneration && persistedGeneration !== executionGeneration) {
        throw Object.assign(new Error('发送结果不确定状态的执行代次已变化，拒绝过期覆盖'), {
          code: 'SEND_QUEUE_UNKNOWN_GENERATION_STALE', status: 409, queueId: clean(id),
          expectedGeneration: persistedGeneration, actualGeneration: executionGeneration
        });
      }
      const update = this.db.prepare(`UPDATE r32_send_queue SET next_attempt_at=?,
        platform_message_id=CASE WHEN platform_message_id='' AND ?<>'' THEN ? ELSE platform_message_id END,
        unknown_scope=CASE WHEN unknown_scope='' THEN ? ELSE unknown_scope END,
        unknown_reason=CASE WHEN unknown_reason='' THEN ? ELSE unknown_reason END,
        unknown_lane=CASE WHEN unknown_lane='' THEN ? ELSE unknown_lane END,
        execution_generation=CASE WHEN execution_generation='' THEN ? ELSE execution_generation END,
        unknown_recorded_at=CASE WHEN unknown_recorded_at='' THEN ? ELSE unknown_recorded_at END,
        row_version=row_version+1,updated_at=? WHERE id=? AND state='send_outcome_unknown' AND row_version=?`)
        .run(timestamp,clean(result.platformMessageId || result.platform_message_id),clean(result.platformMessageId || result.platform_message_id),
          scope,reason,lane,executionGeneration,timestamp,timestamp,clean(id),Number(current.row_version || 0));
      if (Number(update.changes || 0) !== 1) {
        throw Object.assign(new Error('发送结果不确定状态已被其他权威更新'), { code: 'SEND_QUEUE_UNKNOWN_ROW_STALE', status: 409, queueId: clean(id) });
      }
      return this.getSendQueueItem(id);
    }
    if (current.state !== 'sending') return current;
    const claim = this._assertQueueClaim(current, claimInput, 'SEND_QUEUE_UNKNOWN_STALE_COMPLETION');
    const update = this.db.prepare(`UPDATE r32_send_queue SET state='send_outcome_unknown',locked_at='',lease_expires_at='',claim_token='',next_attempt_at=?,
      last_error=?,platform_message_id=?,unknown_scope=?,unknown_reason=?,unknown_lane=?,execution_generation=CASE WHEN ?='' THEN execution_generation ELSE ? END,
      unknown_recorded_at=?,row_version=row_version+1,updated_at=?
      WHERE id=? AND state='sending' AND claim_generation=? AND claim_token=?`).run(
        timestamp,clean(result.error || 'SEND_OUTCOME_UNKNOWN: 发送结果不确定，已禁止自动重发').slice(0,2000),
        clean(result.platformMessageId || result.platform_message_id),scope,reason,lane,executionGeneration,executionGeneration,
        timestamp,timestamp,clean(id),Number(claim.generation),clean(claim.token));
    if (Number(update.changes || 0) !== 1) throw staleQueueCompletion(id,current,claim,'SEND_QUEUE_UNKNOWN_STALE_COMPLETION');
    return this.getSendQueueItem(id);
  }

  checkpointLocalDeliveryTx(input = {}) {
    return this.transaction(() => {
      const current = this.getSendQueueItem(input.queueId);
      if (!current) throw Object.assign(new Error('Send queue item not found'), { code: 'SEND_QUEUE_ITEM_NOT_FOUND', status: 404 });
      const claim = this._assertQueueClaim(current, input, 'SEND_QUEUE_CHECKPOINT_STALE');
      const expectedState = clean(input.expectedQueueState) || current.state;
      const queueState = clean(input.queueState) || 'sent';
      const timestamp = nowIso();
      const update = this.db.prepare(`UPDATE r32_send_queue SET state=?,platform_message_id=?,last_error=?,next_attempt_at=?,
        attempts=CASE WHEN ?=1 AND attempts>0 THEN attempts-1 ELSE attempts END,
        claim_token='',lease_expires_at='',locked_at='',row_version=row_version+1,updated_at=?
        WHERE id=? AND state=? AND claim_generation=? AND claim_token=?`).run(
          queueState,clean(input.platformMessageId),clean(input.error).slice(0,2000),clean(input.nextAttemptAt)||timestamp,
          input.decrementAttempt === true ? 1 : 0,
          timestamp,clean(input.queueId),expectedState,Number(claim.generation),clean(claim.token));
      if (Number(update.changes || 0) !== 1) throw staleQueueCompletion(input.queueId,current,claim,'SEND_QUEUE_CHECKPOINT_STALE');
      let message = null;
      if (input.requireMessage !== false) {
        const messageId = clean(input.messageId || input.queueId);
        const receipt = this.db.prepare(`UPDATE r32_messages SET delivery_status=?,payload_json=json_set(payload_json,'$.deliveryStatus',?,'$.status',?,'$.platformMessageId',?),updated_at=? WHERE id=?`)
          .run(clean(input.messageDeliveryStatus || queueState),clean(input.messageDeliveryStatus || queueState),clean(input.messageDeliveryStatus || queueState),clean(input.platformMessageId),timestamp,messageId);
        if (Number(receipt.changes || 0) !== 1) {
          throw Object.assign(new Error('Outbound message projection is missing for queue checkpoint'), { code: 'SEND_QUEUE_MESSAGE_PROJECTION_MISSING', status: 409, queueId: clean(input.queueId), messageId });
        }
        message = this.getMessage(messageId);
      }
      return { queue: this.getSendQueueItem(input.queueId), message };
    });
  }

  _updateOutboundMessageReceiptWithinTransaction(input = {}) {
    if (input.requireMessage !== true) return null;
    const messageId = clean(input.messageId || input.queueId);
    const status = clean(input.messageDeliveryStatus || input.status);
    const platformMessageId = clean(input.platformMessageId);
    const timestamp = clean(input.updatedAt) || nowIso();
    const receipt = this.db.prepare(`
      UPDATE r32_messages
      SET delivery_status=?,
          payload_json=json_set(payload_json,'$.deliveryStatus',?,'$.status',?,'$.platformMessageId',?),
          updated_at=?
      WHERE id=?
    `).run(status, status, status, platformMessageId, timestamp, messageId);
    if (Number(receipt.changes || 0) !== 1) {
      throw Object.assign(new Error('Outbound message projection is missing for queue transition'), {
        code: 'SEND_QUEUE_MESSAGE_PROJECTION_MISSING', status: 409,
        queueId: clean(input.queueId), messageId
      });
    }
    return this.getMessage(messageId);
  }

  resolveSendOutcomeUnknown(id, resolution, result = {}) {
    const normalized = clean(resolution).toLowerCase();
    if (!['confirmed_sent', 'confirmed_not_sent', 'cancelled'].includes(normalized)) {
      throw Object.assign(new Error('发送结果不确定任务的对账结论无效'), { code: 'SEND_OUTCOME_RESOLUTION_INVALID' });
    }
    return this.transaction(() => {
      const queueId = clean(id);
      const current = this.db.prepare('SELECT * FROM r32_send_queue WHERE id=?').get(queueId);
      if (!current) throw Object.assign(new Error('发送队列任务不存在'), { code: 'SEND_QUEUE_ITEM_NOT_FOUND', status: 404 });
      if (current.state !== 'send_outcome_unknown') {
        throw Object.assign(new Error('该任务当前不是发送结果不确定状态'), {
          code: 'SEND_OUTCOME_NOT_UNKNOWN', status: 409, queueId, state: current.state
        });
      }
      const timestamp = nowIso();
      const state = normalized === 'confirmed_sent' ? 'sent' : (normalized === 'confirmed_not_sent' ? 'retry' : 'cancelled');
      const platformMessageId = clean(result.platformMessageId || result.platform_message_id);
      const clearPlatformMessageId = normalized === 'confirmed_not_sent' ? 1 : 0;
      const note = clean(result.note || (
        normalized === 'confirmed_sent'
          ? 'SEND_OUTCOME_RECONCILED: 人工确认平台已发送'
          : normalized === 'confirmed_not_sent'
            ? 'SEND_OUTCOME_RECONCILED: 人工确认平台未发送，允许重新发送'
            : 'SEND_OUTCOME_RECONCILED: 人工确认取消'
      )).slice(0, 2000);
      const update = this.db.prepare(`
        UPDATE r32_send_queue
        SET state=?, locked_at='', lease_expires_at='', claim_token='', next_attempt_at=?, last_error=?,
            platform_message_id=CASE WHEN ?=1 THEN '' WHEN ?='' THEN platform_message_id ELSE ? END,
            unknown_scope='',unknown_reason='',unknown_lane='',unknown_recorded_at='',
            row_version=row_version+1, updated_at=?
        WHERE id=? AND state='send_outcome_unknown' AND row_version=?
      `).run(state, timestamp, note, clearPlatformMessageId, platformMessageId, platformMessageId, timestamp, queueId, Number(current.row_version || 0));
      if (Number(update.changes || 0) !== 1) {
        throw Object.assign(new Error('发送结果不确定任务已被其他操作处理'), {
          code: 'SEND_OUTCOME_STALE_RESOLUTION', status: 409, queueId
        });
      }
      this._updateOutboundMessageReceiptWithinTransaction({
        queueId,
        messageId: result.messageId || queueId,
        messageDeliveryStatus: result.messageDeliveryStatus || (normalized === 'confirmed_not_sent' ? 'queued' : state),
        platformMessageId: normalized === 'confirmed_not_sent' ? '' : platformMessageId,
        requireMessage: result.requireMessage,
        updatedAt: timestamp
      });
      return this.getSendQueueItem(queueId);
    });
  }

  deferSend(id, result = {}, claimInput = {}) {
    const current = this.getSendQueueItem(id);
    if (!current) return null;
    const claim = this._assertQueueClaim(current, claimInput, 'SEND_QUEUE_DEFER_STALE_COMPLETION');
    const timestamp = nowIso();
    const nextAttemptAt = clean(result.nextAttemptAt) || new Date(Date.now() + 5000).toISOString();
    const update = this.db.prepare(`
      UPDATE r32_send_queue
      SET state='retry', attempts=CASE WHEN attempts>0 THEN attempts-1 ELSE 0 END,
          next_attempt_at=?, locked_at='', lease_expires_at='', claim_token='', last_error=?, row_version=row_version+1, updated_at=?
      WHERE id=? AND state='sending' AND claim_generation=? AND claim_token=?
    `).run(nextAttemptAt, clean(result.error).slice(0, 2000), timestamp, clean(id), Number(claim.generation), clean(claim.token));
    if (Number(update.changes || 0) !== 1) throw staleQueueCompletion(id,current,claim,'SEND_QUEUE_DEFER_STALE_COMPLETION');
    return this.getSendQueueItem(id);
  }

  getSendQueueItem(id) {
    const row = this.db.prepare('SELECT * FROM r32_send_queue WHERE id=?').get(clean(id));
    if (!row) return null;
    return { ...row, payload: parseJson(row.payload_json, {}) || {} };
  }

  listSendQueue(options = {}) {
    const state = clean(options.state);
    const limit = Math.min(1000, Math.max(1, integer(options.limit, 200)));
    const order = clean(options.order).toLowerCase() === 'oldest' ? 'ASC' : 'DESC';
    const cursor = options.cursor && typeof options.cursor === 'object' ? options.cursor : {};
    const cursorAt = clean(cursor.createdAt || cursor.created_at);
    const cursorId = clean(cursor.id || cursor.queueId || cursor.queue_id);
    const clauses = [];
    const params = [];
    if (state) { clauses.push('state=?'); params.push(state); }
    if (cursorAt && cursorId) {
      clauses.push(order === 'ASC'
        ? '(created_at>? OR (created_at=? AND id>?))'
        : '(created_at<? OR (created_at=? AND id<?))');
      params.push(cursorAt, cursorAt, cursorId);
    }
    const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.db.prepare(`SELECT * FROM r32_send_queue${where} ORDER BY created_at ${order},id ${order} LIMIT ?`).all(...params, limit);
    return rows.map(row => ({ ...row, payload: parseJson(row.payload_json, {}) || {} }));
  }

  summarizeSendQueue(options = {}) {
    const accountId = clean(options.accountId || options.account_id);
    const row = this.db.prepare(`SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN state NOT IN ('sent','failed','cancelled') THEN 1 ELSE 0 END) AS active,
      SUM(CASE WHEN state='send_outcome_unknown' THEN 1 ELSE 0 END) AS outcome_unknown,
      SUM(CASE WHEN state='send_outcome_unknown' AND unknown_scope='global' THEN 1 ELSE 0 END) AS global_outcome_unknown,
      SUM(CASE WHEN state='send_outcome_unknown' AND unknown_scope='account' THEN 1 ELSE 0 END) AS all_account_outcome_unknown,
      SUM(CASE WHEN state='send_outcome_unknown' AND unknown_scope='command' THEN 1 ELSE 0 END) AS command_outcome_unknown,
      SUM(CASE WHEN state='send_outcome_unknown' AND unknown_scope='account' AND (?='' OR account_id=?) THEN 1 ELSE 0 END) AS account_outcome_unknown
      FROM r32_send_queue`).get(accountId, accountId) || {};
    return {
      total: Number(row.total || 0),
      active: Number(row.active || 0),
      outcomeUnknown: Number(row.outcome_unknown || 0),
      globalOutcomeUnknown: Number(row.global_outcome_unknown || 0),
      allAccountOutcomeUnknown: Number(row.all_account_outcome_unknown || 0),
      commandOutcomeUnknown: Number(row.command_outcome_unknown || 0),
      accountOutcomeUnknown: Number(row.account_outcome_unknown || 0),
      accountId
    };
  }

  retrySend(id, options = {}) {
    return this.transaction(() => {
      const queueId = clean(id);
      const current = this.db.prepare('SELECT * FROM r32_send_queue WHERE id=?').get(queueId);
      if (!current) return null;
      if (!['failed', 'retry', 'pending'].includes(current.state)) return this.getSendQueueItem(queueId);
      const timestamp = nowIso();
      const update = this.db.prepare(`
        UPDATE r32_send_queue
        SET state='retry', next_attempt_at=?, locked_at='', lease_expires_at='', claim_token='', last_error='',
            row_version=row_version+1, updated_at=?
        WHERE id=? AND state=? AND row_version=?
      `).run(timestamp, timestamp, queueId, current.state, Number(current.row_version || 0));
      if (Number(update.changes || 0) !== 1) {
        throw Object.assign(new Error('发送队列重试请求已过期'), { code: 'SEND_QUEUE_RETRY_STALE', status: 409, queueId });
      }
      this._updateOutboundMessageReceiptWithinTransaction({
        queueId,
        messageId: options.messageId || queueId,
        messageDeliveryStatus: options.messageDeliveryStatus || 'queued',
        platformMessageId: '',
        requireMessage: options.requireMessage,
        updatedAt: timestamp
      });
      return this.getSendQueueItem(queueId);
    });
  }

  cancelSend(id, options = {}) {
    return this.transaction(() => {
      const queueId = clean(id);
      const current = this.db.prepare('SELECT * FROM r32_send_queue WHERE id=?').get(queueId);
      if (!current) return null;
      if (!['pending', 'retry', 'failed'].includes(current.state)) return this.getSendQueueItem(queueId);
      const timestamp = nowIso();
      const update = this.db.prepare(`
        UPDATE r32_send_queue
        SET state='cancelled', locked_at='', lease_expires_at='', claim_token='', row_version=row_version+1, updated_at=?
        WHERE id=? AND state=? AND row_version=?
      `).run(timestamp, queueId, current.state, Number(current.row_version || 0));
      if (Number(update.changes || 0) !== 1) {
        throw Object.assign(new Error('发送队列取消请求已过期'), { code: 'SEND_QUEUE_CANCEL_STALE', status: 409, queueId });
      }
      this._updateOutboundMessageReceiptWithinTransaction({
        queueId,
        messageId: options.messageId || queueId,
        messageDeliveryStatus: options.messageDeliveryStatus || 'cancelled',
        platformMessageId: clean(current.platform_message_id),
        requireMessage: options.requireMessage,
        updatedAt: timestamp
      });
      return this.getSendQueueItem(queueId);
    });
  }

  recoverStaleSends(maxAgeMs = 120000) {
    const cutoff = new Date(Date.now() - Math.max(1000, integer(maxAgeMs, 120000))).toISOString();
    const timestamp = nowIso();
    const result = this.db.prepare(`
      UPDATE r32_send_queue
      SET state='send_outcome_unknown', locked_at='', lease_expires_at='', claim_token='', next_attempt_at=?,
          last_error=CASE WHEN last_error='' THEN 'SEND_OUTCOME_UNKNOWN: 进程中断时远端发送结果不确定，已禁止自动重发' ELSE last_error END,
          unknown_scope=CASE WHEN unknown_scope='' THEN 'account' ELSE unknown_scope END,
          unknown_reason=CASE WHEN unknown_reason='' THEN 'STALE_SEND_RECOVERY' ELSE unknown_reason END,
          unknown_lane=CASE WHEN unknown_lane='' THEN COALESCE(json_extract(payload_json,'$.platform'),'unknown')||':'||account_id ELSE unknown_lane END,
          unknown_recorded_at=CASE WHEN unknown_recorded_at='' THEN ? ELSE unknown_recorded_at END,
          row_version=row_version+1, updated_at=?
      WHERE state='sending' AND (locked_at='' OR locked_at<?)
    `).run(timestamp, timestamp, timestamp, cutoff);
    return Number(result.changes || 0);
  }

  recoverInterruptedSends() {
    const timestamp = nowIso();
    const result = this.db.prepare(`
      UPDATE r32_send_queue
      SET state='send_outcome_unknown', locked_at='', lease_expires_at='', claim_token='', next_attempt_at=?,
          last_error=CASE WHEN last_error='' THEN 'SEND_OUTCOME_UNKNOWN: 应用重启时发现未完成的远端发送，已禁止自动重发' ELSE last_error END,
          unknown_scope=CASE WHEN unknown_scope='' THEN 'account' ELSE unknown_scope END,
          unknown_reason=CASE WHEN unknown_reason='' THEN 'PROCESS_RESTART_RECOVERY' ELSE unknown_reason END,
          unknown_lane=CASE WHEN unknown_lane='' THEN COALESCE(json_extract(payload_json,'$.platform'),'unknown')||':'||account_id ELSE unknown_lane END,
          unknown_recorded_at=CASE WHEN unknown_recorded_at='' THEN ? ELSE unknown_recorded_at END,
          row_version=row_version+1, updated_at=?
      WHERE state='sending'
    `).run(timestamp, timestamp, timestamp);
    return Number(result.changes || 0);
  }

  findCompletedMigration(sourceFingerprint) {
    const fingerprint = clean(sourceFingerprint);
    if (!fingerprint) return null;
    return this.db.prepare(`
      SELECT id, source_root AS sourceRoot, source_fingerprint AS sourceFingerprint,
             status, report_json AS reportJson, started_at AS startedAt, completed_at AS completedAt
      FROM r32_migration_runs
      WHERE source_fingerprint=? AND status='completed'
      ORDER BY completed_at DESC
      LIMIT 1
    `).get(fingerprint) || null;
  }

  createMigrationRun(input = {}) {
    const id = clean(input.id) || stableId('migration', [input.sourceRoot, input.sourceFingerprint, nowIso()]);
    this.db.prepare(`
      INSERT INTO r32_migration_runs(id, source_root, source_fingerprint, status, report_json, started_at, completed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      clean(input.sourceRoot),
      clean(input.sourceFingerprint),
      clean(input.status) || 'running',
      json(input.report || {}),
      clean(input.startedAt) || nowIso(),
      clean(input.completedAt)
    );
    return id;
  }

  finishMigrationRun(id, status, report) {
    this.db.prepare(`
      UPDATE r32_migration_runs
      SET status=?, report_json=?, completed_at=?
      WHERE id=?
    `).run(clean(status), json(report || {}), nowIso(), clean(id));
  }

  close() {
    // Keep ownership until SQLite has actually released the file handles. This
    // prevents another process from acquiring the sidecar during the small
    // window in which the previous connection is still open.
    if (this.ownershipHeartbeatTimer) clearInterval(this.ownershipHeartbeatTimer);
    this.ownershipHeartbeatTimer = null;
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    try { this.ownership?.release(); } catch (_) {}
    try { this.ownedAuthorityWriteHost?.close(); } catch (_) {}
    try { this.authorityWriteHostCapability?.close(); } catch (_) {}
  }
}

module.exports = {
  R32SqliteStore,
  SCHEMA_VERSION,
  stableId,
  parseJson
};
