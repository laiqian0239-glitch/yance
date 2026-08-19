'use strict';

const { assertStorageAccess } = require('./runtimeRoleGuard');
assertStorageAccess('R32SqliteStore');

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const legacy = require('./r32SqliteStoreEngineLegacy');
const { createCompactSnapshotTarget } = require('../migrations/migrationSnapshotManifest');
const { applyArchitectureClosureV2WpA } = require('../migrations/architectureClosureV2WpA');
const {
  applyArchitectureClosureV2DomainEventProjectionJobsCanonical,
  isArchitectureClosureV2DomainEventProjectionJobsCanonicalApplied,
  ensureArchitectureClosureV2WpABaseForSchema23Reentry,
  TARGET_SCHEMA_VERSION: ACV2_DOMAIN_EVENT_PROJECTION_JOBS_CANONICAL_SCHEMA_VERSION
} = require('../migrations/architectureClosureV2DomainEventProjectionJobsCanonical');
const { ensureCanonicalProjectionReceiptSchema } = require('../migrations/projectionReceiptSchemaAuthority');
const {
  applyV21FacebookPersonalMessengerMautrixMetaProductionClosure,
  TARGET_SCHEMA_VERSION: FACEBOOK_PERSONAL_MESSENGER_SCHEMA_VERSION
} = require('../migrations/v21FacebookPersonalMessengerMautrixMetaProductionClosure');
const {
  acquireAuthorityWriteHost,
  assertCurrentAuthorityWriteHostToken,
  requireAuthorityWriteHostCapability
} = require('../services/authorityWriteHost');
const { claimOwnership, SqliteOwnershipError } = require('./sqliteOwnership');
const { SqliteTransactionCoordinator } = require('../store/sqliteTransactionCoordinator');

const SCHEMA_VERSION = Math.max(legacy.SCHEMA_VERSION, ACV2_DOMAIN_EVENT_PROJECTION_JOBS_CANONICAL_SCHEMA_VERSION, FACEBOOK_PERSONAL_MESSENGER_SCHEMA_VERSION);
const LEGACY_ENGINE_PROTOTYPE = legacy.R32SqliteStoreOperations.prototype;

function nowIso() {
  return new Date().toISOString();
}

function supportedSchemaVersion(store) {
  const target = Number(store.supportedSchemaVersion());
  if (!Number.isInteger(target) || target < SCHEMA_VERSION) {
    throw Object.assign(
      new Error(`SQLite supported schema version must be an integer >= ${SCHEMA_VERSION}`),
      {
        code: 'SQLITE_SUPPORTED_SCHEMA_VERSION_INVALID',
        minimumVersion: SCHEMA_VERSION,
        supportedVersion: target,
        dbPath: store.dbPath
      }
    );
  }
  return target;
}

function preflightSchemaVersion(store) {
  const target = supportedSchemaVersion(store);
  const current = existingSchemaVersion(store);
  if (current != null && current > target) {
    throw new SqliteOwnershipError(
      'SCHEMA_VERSION_AHEAD',
      `Database schema version ${current} is newer than supported version ${target}; refusing to open (downgrade risk)`,
      { databaseVersion: current, supportedVersion: target, dbPath: store.dbPath }
    );
  }
  const userTables = store.db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
  ).all().map(row => String(row.name || ''));
  return Object.freeze({
    current,
    target,
    needsMigration: current == null ? userTables.length > 0 : current < target,
    userTables
  });
}

function prepareSchemaMigrationBackup(store, preflight = {}) {
  if (!preflight.needsMigration) return null;
  const target = supportedSchemaVersion(store);
  if (Number(preflight.target) !== target) {
    throw Object.assign(
      new Error('Schema preflight target changed before backup'),
      {
        code: 'SQLITE_SCHEMA_PREFLIGHT_TARGET_CHANGED',
        preflightTarget: preflight.target,
        supportedVersion: target,
        dbPath: store.dbPath
      }
    );
  }
  const from = preflight.current == null ? 'unversioned' : `v${preflight.current}`;
  const generation = crypto.randomUUID();
  const { targetPath: backupPath } = createCompactSnapshotTarget({
    root: path.dirname(store.dbPath),
    dbPath: store.dbPath,
    migrationId: `schema-adoption-${from}-to-v${target}`,
    processGeneration: generation,
    extension: 'bak'
  });
  const escaped = backupPath.replace(/'/gu, "''");
  store.db.exec(`PRAGMA wal_checkpoint(FULL); VACUUM INTO '${escaped}';`);
  const stat = fs.statSync(backupPath);
  if (!stat.isFile() || stat.size <= 0) {
    throw new SqliteOwnershipError(
      'SCHEMA_MIGRATION_BACKUP_FAILED',
      'Database pre-migration backup is empty',
      { backupPath, dbPath: store.dbPath }
    );
  }
  const verification = new DatabaseSync(backupPath, { readOnly: true });
  try {
    const integrity = String(verification.prepare('PRAGMA integrity_check').get()?.integrity_check || '');
    if (integrity.toLowerCase() !== 'ok') throw new Error(`integrity_check=${integrity}`);
  } finally {
    verification.close();
  }
  return Object.freeze({
    path: backupPath,
    from: preflight.current,
    to: target,
    createdAt: nowIso(),
    size: stat.size
  });
}

function governSchemaVersion(store, preflight = {}) {
  const target = supportedSchemaVersion(store);
  const current = preflight.current ?? store.getMeta('schema_version', null);
  if (current != null && Number(current) > target) {
    throw new SqliteOwnershipError(
      'SCHEMA_VERSION_AHEAD',
      `Database schema version ${current} is newer than supported version ${target}; refusing to open (downgrade risk)`,
      { databaseVersion: Number(current), supportedVersion: target, dbPath: store.dbPath }
    );
  }
  store.setMeta('schema_version', target);
  store.setMeta('schemaVersion', target);
}

function commitSchemaMigrationReceipt(store, preflight = {}) {
  if (!preflight.needsMigration) return;
  const target = supportedSchemaVersion(store);
  store.setMeta('schema_migration_last_receipt', {
    status: 'COMMITTED',
    fromVersion: preflight.current,
    toVersion: target,
    backupPath: store.schemaMigrationBackup?.path || '',
    backupSize: Number(store.schemaMigrationBackup?.size || 0),
    completedAt: nowIso()
  });
}

function restoreMigrationBackup(store, error) {
  if (!store.schemaMigrationBackup?.path) return;
  try {
    for (const suffix of ['-wal', '-shm']) fs.rmSync(`${store.dbPath}${suffix}`, { force: true });
    fs.copyFileSync(store.schemaMigrationBackup.path, store.dbPath);
    error.schemaMigrationRollback = {
      restored: true,
      backupPath: store.schemaMigrationBackup.path
    };
  } catch (rollbackError) {
    error.schemaMigrationRollback = {
      restored: false,
      backupPath: store.schemaMigrationBackup.path,
      error: rollbackError.message || String(rollbackError)
    };
  }
}

function startOwnershipHeartbeat(store) {
  if (!store.ownership || store.ownershipHeartbeatTimer) return;
  const loseOwnership = () => {
    if (store.ownershipLostError) return;
    store.ownershipLostError = Object.assign(
      new Error('SQLite write ownership heartbeat was lost; store is fail-closed'),
      { code: 'SQLITE_OWNERSHIP_HEARTBEAT_LOST', dbPath: store.dbPath }
    );
    if (store.ownershipHeartbeatTimer) clearInterval(store.ownershipHeartbeatTimer);
    store.ownershipHeartbeatTimer = null;
    try { store.db?.exec('PRAGMA query_only = ON'); } catch (_) {}
    try { store.db?.close(); store.db = null; } catch (_) {}
  };
  store.ownershipHeartbeatTimer = setInterval(() => {
    let ok = false;
    try {
      ok = store.authorityWriteHostCapability.heartbeat() === true;
    } catch (error) {
      store.ownershipLostError = error;
      ok = false;
    }
    if (!ok) loseOwnership();
  }, store.ownershipHeartbeatMs);
  store.ownershipHeartbeatTimer.unref?.();
}

function assertOwnership(store) {
  if (store.ownershipLostError) throw store.ownershipLostError;
  if (!store.db) {
    throw Object.assign(
      new Error('SQLite store is closed'),
      { code: 'SQLITE_STORE_CLOSED', dbPath: store.dbPath }
    );
  }
  assertCurrentAuthorityWriteHostToken(store.authorityWriteHostCapability, store.db);
  return true;
}

function existingSchemaVersion(store) {
  const tables = new Set(
    store.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()
      .map(row => String(row.name || ''))
  );
  if (!tables.has('r32_meta')) return null;
  const rows = store.db.prepare(
    "SELECT key, value_json FROM r32_meta WHERE key IN ('schema_version','schemaVersion')"
  ).all();
  if (!rows.length) return null;
  const versions = [];
  for (const row of rows) {
    const parsed = legacy.parseJson(row.value_json, row.value_json);
    const number = Number(parsed);
    if (!Number.isInteger(number) || number < 0) {
      throw new SqliteOwnershipError(
        'SCHEMA_VERSION_INVALID',
        `Database schema version metadata ${row.key} is invalid`,
        { key: row.key, value: row.value_json, dbPath: store.dbPath }
      );
    }
    versions.push(number);
  }
  return Math.max(...versions);
}

function closeStore(store) {
  if (store.ownershipHeartbeatTimer) clearInterval(store.ownershipHeartbeatTimer);
  store.ownershipHeartbeatTimer = null;
  if (store.db) {
    store.db.close();
    store.db = null;
  }
  try { store.ownership?.release(); } catch (_) {}
  try { store.ownedAuthorityWriteHost?.close(); } catch (_) {}
  try { store.authorityWriteHostCapability?.close(); } catch (_) {}
}

function initializeStore(store, options = {}) {
  const dbPath = path.resolve(options.dbPath || path.join(process.cwd(), 'data', 'database', 'yance-r32.db'));
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  store.dbPath = dbPath;
  store.ownership = null;
  store.db = null;
  store.transactions = null;
  store.ownershipHeartbeatTimer = null;
  store.ownershipLostError = null;
  store.ownedAuthorityWriteHost = null;
  store.schemaMigrationBackup = null;

  if (options.authorityWriteHostCapability) {
    store.authorityWriteHostCapability = requireAuthorityWriteHostCapability(options.authorityWriteHostCapability);
  } else {
    store.ownedAuthorityWriteHost = acquireAuthorityWriteHost({
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
    store.authorityWriteHostCapability = store.ownedAuthorityWriteHost.capability;
  }
  if (path.resolve(store.authorityWriteHostCapability.dbPath) !== dbPath) {
    throw Object.assign(
      new Error('AuthorityWriteHost capability path mismatch'),
      { code: 'AUTHORITY_WRITE_HOST_CAPABILITY_PATH_MISMATCH' }
    );
  }

  store.ownershipStaleMs = Math.max(1000, Number(options.ownershipStaleMs || 30000));
  store.ownershipHeartbeatMs = Math.max(250, Math.min(
    Math.floor(store.ownershipStaleMs / 3),
    Number(options.ownershipHeartbeatMs || Math.floor(store.ownershipStaleMs / 4))
  ));

  try {
    const targetSchemaVersion = supportedSchemaVersion(store);
    store.ownership = claimOwnership({
      dbPath,
      staleMs: store.ownershipStaleMs,
      schemaVersion: targetSchemaVersion,
      pid: options.ownershipPid,
      pidAlive: options.ownershipPidAlive,
      clock: options.ownershipClock,
      fsProvider: options.ownershipFsProvider,
      capturePidIdentity: options.ownershipCapturePidIdentity
    });
    store.db = new DatabaseSync(dbPath);
    store.transactions = new SqliteTransactionCoordinator(store.db);
    store.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 8000;
      PRAGMA temp_store = MEMORY;
    `);

    const schemaPreflight = store.preflightSchemaVersion();
    store.schemaMigrationBackup = store.prepareSchemaMigrationBackup(schemaPreflight);
    store.ensureSchema();
    store.governSchemaVersion(schemaPreflight);
    store.commitSchemaMigrationReceipt(schemaPreflight);
    store.authorityWriteHostCapability.attachStore(store);
    store.startOwnershipHeartbeat();
    return store;
  } catch (error) {
    let closeError = null;
    if (store.db) {
      try {
        store.db.close();
        store.db = null;
      } catch (candidate) {
        closeError = candidate;
      }
    }
    if (!closeError) {
      try { store.ownership?.release(); } catch (_) {}
    }
    if (!closeError) restoreMigrationBackup(store, error);
    if (closeError && error && typeof error === 'object') {
      error.sqliteCloseError = {
        code: closeError.code || '',
        message: closeError.message || String(closeError)
      };
    }
    try { store.ownedAuthorityWriteHost?.close(); } catch (_) {}
    try { store.authorityWriteHostCapability?.close(); } catch (_) {}
    throw error;
  }
}

function R32SqliteStore(options = {}) {
  if (!(this instanceof R32SqliteStore)) return new R32SqliteStore(options);
  return initializeStore(this, options);
}

R32SqliteStore.prototype = Object.create(LEGACY_ENGINE_PROTOTYPE);
Object.defineProperty(R32SqliteStore.prototype, 'constructor', {
  value: R32SqliteStore,
  enumerable: false,
  writable: true,
  configurable: true
});

R32SqliteStore.prototype.supportedSchemaVersion = function supportedSchemaVersionMethod() {
  return SCHEMA_VERSION;
};
R32SqliteStore.prototype.startOwnershipHeartbeat = function startOwnershipHeartbeatMethod() {
  return startOwnershipHeartbeat(this);
};
R32SqliteStore.prototype.assertOwnership = function assertOwnershipMethod() {
  return assertOwnership(this);
};
R32SqliteStore.prototype.existingSchemaVersion = function existingSchemaVersionMethod() {
  return existingSchemaVersion(this);
};
R32SqliteStore.prototype.close = function closeMethod() {
  return closeStore(this);
};
R32SqliteStore.prototype.preflightSchemaVersion = function preflightSchemaVersionMethod() {
  return preflightSchemaVersion(this);
};
R32SqliteStore.prototype.prepareSchemaMigrationBackup = function prepareSchemaMigrationBackupMethod(preflight) {
  return prepareSchemaMigrationBackup(this, preflight);
};
R32SqliteStore.prototype.ensureSchema = function ensureSchema() {
  LEGACY_ENGINE_PROTOTYPE.ensureSchema.call(this);
  if (isArchitectureClosureV2DomainEventProjectionJobsCanonicalApplied(this.db)) {
    ensureArchitectureClosureV2WpABaseForSchema23Reentry(this.db);
  } else {
    applyArchitectureClosureV2WpA(this.db);
  }
  applyArchitectureClosureV2DomainEventProjectionJobsCanonical(this.db);
  applyV21FacebookPersonalMessengerMautrixMetaProductionClosure(this.db);
  ensureCanonicalProjectionReceiptSchema(this.db);
};
R32SqliteStore.prototype.governSchemaVersion = function governSchemaVersionMethod(preflight) {
  return governSchemaVersion(this, preflight);
};
R32SqliteStore.prototype.commitSchemaMigrationReceipt = function commitSchemaMigrationReceiptMethod(preflight) {
  return commitSchemaMigrationReceipt(this, preflight);
};

module.exports = Object.freeze({
  ...legacy,
  R32SqliteStore,
  SCHEMA_VERSION
});
