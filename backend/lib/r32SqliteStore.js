'use strict';

const { assertStorageAccess } = require('./runtimeRoleGuard');
assertStorageAccess('R32SqliteStore');

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const engine = require('./r32SqliteStoreEngine');
const { createCompactSnapshotTarget } = require('../migrations/migrationSnapshotManifest');
const {
  applyArchitectureClosureV2WpB,
  TARGET_SCHEMA_VERSION: ACV2_WP_B_SCHEMA_VERSION
} = require('../migrations/architectureClosureV2WpB');
const { ensureCanonicalProjectionReceiptSchema } = require('../migrations/projectionReceiptSchemaAuthority');
const {
  requireSchema23StartupRegistration
} = require('../../shared/release/wpBM1RedEvidenceAuthority');
const {
  acquireAuthorityWriteHost,
  assertCurrentAuthorityWriteHostToken,
  requireAuthorityWriteHostCapability
} = require('../services/authorityWriteHost');
const { claimOwnership, SqliteOwnershipError } = require('./sqliteOwnership');
const { SqliteTransactionCoordinator } = require('../store/sqliteTransactionCoordinator');

const SCHEMA_VERSION = Math.max(engine.SCHEMA_VERSION, ACV2_WP_B_SCHEMA_VERSION);
const ENGINE_PROTOTYPE = engine.R32SqliteStore.prototype;

function nowIso() {
  return new Date().toISOString();
}

function preflightSchemaVersion(store) {
  const current = ENGINE_PROTOTYPE.existingSchemaVersion.call(store);
  if (current != null && current > SCHEMA_VERSION) {
    throw new SqliteOwnershipError(
      'SCHEMA_VERSION_AHEAD',
      `Database schema version ${current} is newer than supported version ${SCHEMA_VERSION}; refusing to open (downgrade risk)`,
      { databaseVersion: current, supportedVersion: SCHEMA_VERSION, dbPath: store.dbPath }
    );
  }
  const userTables = store.db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
  ).all().map(row => String(row.name || ''));
  return Object.freeze({
    current,
    target: SCHEMA_VERSION,
    needsMigration: current == null ? userTables.length > 0 : current < SCHEMA_VERSION,
    userTables
  });
}

function prepareSchemaMigrationBackup(store, preflight = {}) {
  if (!preflight.needsMigration) return null;
  const from = preflight.current == null ? 'unversioned' : `v${preflight.current}`;
  const generation = crypto.randomUUID();
  const { targetPath: backupPath } = createCompactSnapshotTarget({
    root: path.dirname(store.dbPath),
    dbPath: store.dbPath,
    migrationId: `schema-adoption-${from}-to-v${SCHEMA_VERSION}`,
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
    to: SCHEMA_VERSION,
    createdAt: nowIso(),
    size: stat.size
  });
}

function governSchemaVersion(store, preflight = {}) {
  const current = preflight.current ?? store.getMeta('schema_version', null);
  if (current != null && Number(current) > SCHEMA_VERSION) {
    throw new SqliteOwnershipError(
      'SCHEMA_VERSION_AHEAD',
      `Database schema version ${current} is newer than supported version ${SCHEMA_VERSION}; refusing to open (downgrade risk)`,
      { databaseVersion: Number(current), supportedVersion: SCHEMA_VERSION, dbPath: store.dbPath }
    );
  }
  store.setMeta('schema_version', SCHEMA_VERSION);
  store.setMeta('schemaVersion', SCHEMA_VERSION);
}

function commitSchemaMigrationReceipt(store, preflight = {}) {
  if (!preflight.needsMigration) return;
  store.setMeta('schema_migration_last_receipt', {
    status: 'COMMITTED',
    fromVersion: preflight.current,
    toVersion: SCHEMA_VERSION,
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
    store.ownership = claimOwnership({
      dbPath,
      staleMs: store.ownershipStaleMs,
      schemaVersion: SCHEMA_VERSION,
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

    const schemaPreflight = preflightSchemaVersion(store);
    store.schemaMigrationBackup = prepareSchemaMigrationBackup(store, schemaPreflight);

    ENGINE_PROTOTYPE.ensureSchema.call(store);
    requireSchema23StartupRegistration();
    applyArchitectureClosureV2WpB(store.db, { at: nowIso() });
    ensureCanonicalProjectionReceiptSchema(store.db);

    governSchemaVersion(store, schemaPreflight);
    commitSchemaMigrationReceipt(store, schemaPreflight);
    store.authorityWriteHostCapability.attachStore(store);
    ENGINE_PROTOTYPE.startOwnershipHeartbeat.call(store);
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

R32SqliteStore.prototype = Object.create(ENGINE_PROTOTYPE);
Object.defineProperty(R32SqliteStore.prototype, 'constructor', {
  value: R32SqliteStore,
  enumerable: false,
  writable: true,
  configurable: true
});

R32SqliteStore.prototype.preflightSchemaVersion = function preflightSchemaVersionMethod() {
  return preflightSchemaVersion(this);
};
R32SqliteStore.prototype.prepareSchemaMigrationBackup = function prepareSchemaMigrationBackupMethod(preflight) {
  return prepareSchemaMigrationBackup(this, preflight);
};
R32SqliteStore.prototype.governSchemaVersion = function governSchemaVersionMethod(preflight) {
  return governSchemaVersion(this, preflight);
};
R32SqliteStore.prototype.commitSchemaMigrationReceipt = function commitSchemaMigrationReceiptMethod(preflight) {
  return commitSchemaMigrationReceipt(this, preflight);
};
R32SqliteStore.prototype.assertOwnership = function assertOwnership() {
  if (this.ownershipLostError) throw this.ownershipLostError;
  if (!this.db) {
    throw Object.assign(
      new Error('SQLite store is closed'),
      { code: 'SQLITE_STORE_CLOSED', dbPath: this.dbPath }
    );
  }
  assertCurrentAuthorityWriteHostToken(this.authorityWriteHostCapability, this.db);
  return true;
};

module.exports = Object.freeze({
  ...engine,
  R32SqliteStore,
  SCHEMA_VERSION
});
