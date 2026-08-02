'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { claimOwnership } = require('../lib/sqliteOwnership');
const { assertPrimarySqliteHost } = require('../lib/runtimeRoleGuard');
const {
  BOOTSTRAP_CHECKSUM,
  ensureAuthorityWriteHostBootstrapObjects
} = require('../migrations/architectureClosureV2WpA');

const CAPABILITIES = new WeakSet();

function hostError(code, message, details = {}) {
  const error = new Error(message);
  error.name = 'AuthorityWriteHostError';
  error.code = code;
  error.reasonCode = code;
  Object.assign(error, details);
  return error;
}

function normalizeDbPath(value) {
  const dbPath = path.resolve(String(value || '').trim());
  if (!String(value || '').trim()) {
    throw hostError('AUTHORITY_WRITE_HOST_PATH_REQUIRED', 'AuthorityWriteHost requires dbPath');
  }
  return dbPath;
}

function nowIso(clock) {
  return new Date(Number(clock())).toISOString();
}

function isAuthorityWriteHostCapability(value) {
  return Boolean(value && typeof value === 'object' && CAPABILITIES.has(value));
}

function requireCapability(value) {
  if (!value) {
    throw hostError('AUTHORITY_WRITE_HOST_CAPABILITY_REQUIRED', 'A current AuthorityWriteHost capability is required');
  }
  if (!isAuthorityWriteHostCapability(value)) {
    throw hostError('AUTHORITY_WRITE_HOST_CAPABILITY_INVALID', 'AuthorityWriteHost capability is invalid or forged');
  }
  return value;
}

function leaseRow(db) {
  return db.prepare(`SELECT
      owner_instance_id AS instanceId,
      owner_pid AS pid,
      owner_process_identity AS processIdentity,
      startup_nonce AS startupNonce,
      host_generation AS hostGeneration,
      fencing_token AS fencingToken,
      state,
      acquired_at_ms AS acquiredAtMs,
      heartbeat_at_ms AS heartbeatAtMs,
      acquired_at AS acquiredAt,
      heartbeat_at AS heartbeatAt,
      updated_at AS updatedAt
    FROM authority_write_host_lease WHERE singleton_id=1`).get() || null;
}

function assertCurrentAuthorityWriteHostToken(capabilityValue, dbValue) {
  const capability = requireCapability(capabilityValue);
  const db = dbValue || capability.currentDb();
  if (!db || typeof db.prepare !== 'function') {
    throw hostError('AUTHORITY_WRITE_HOST_DATABASE_UNAVAILABLE', 'AuthorityWriteHost database is unavailable');
  }
  const current = leaseRow(db);
  const token = capability.tokenSnapshot();
  const matches = current
    && current.state === 'ACTIVE'
    && current.instanceId === token.instanceId
    && Number(current.hostGeneration) === Number(token.hostGeneration)
    && Number(current.fencingToken) === Number(token.fencingToken);
  if (!matches) {
    throw hostError('AUTHORITY_WRITE_HOST_FENCED', 'AuthorityWriteHost token is no longer current', {
      expectedToken: token,
      currentToken: current
    });
  }
  return true;
}

function acquireAuthorityWriteHost(options = {}) {
  assertPrimarySqliteHost('acquireAuthorityWriteHost');
  const dbPath = normalizeDbPath(options.dbPath);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const clock = typeof options.clock === 'function' ? options.clock : () => Date.now();
  const pid = Number(options.ownershipPid || process.pid);
  const instanceId = String(options.instanceId || crypto.randomUUID());
  const processIdentity = String(options.ownershipProcessIdentity || '');
  const startupNonce = String(options.startupNonce || crypto.randomUUID());
  const ownershipOptions = Object.freeze({
    pid,
    pidAlive: options.ownershipPidAlive,
    clock,
    fsProvider: options.ownershipFsProvider,
    capturePidIdentity: options.ownershipCapturePidIdentity || (processIdentity ? (() => processIdentity) : undefined),
    processIdentity
  });

  let ownership = null;
  let bootstrapDb = null;
  let committed = false;
  try {
    ownership = claimOwnership({
      dbPath,
      instanceId,
      staleMs: Math.max(1000, Number(options.ownershipStaleMs || 30000)),
      schemaVersion: 21,
      pid: ownershipOptions.pid,
      pidAlive: ownershipOptions.pidAlive,
      clock: ownershipOptions.clock,
      fsProvider: ownershipOptions.fsProvider,
      capturePidIdentity: ownershipOptions.capturePidIdentity,
      processIdentity: ownershipOptions.processIdentity
    });
    bootstrapDb = new DatabaseSync(dbPath);
    bootstrapDb.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 8000;
    `);
    if (options.testFaultAt === 'AFTER_DB_OPEN_BEFORE_HOST_CAS') {
      throw hostError('AUTHORITY_WRITE_HOST_TEST_FAULT', 'Injected AuthorityWriteHost pre-CAS fault');
    }

    bootstrapDb.exec('BEGIN IMMEDIATE');
    try {
      ensureAuthorityWriteHostBootstrapObjects(bootstrapDb, { at: nowIso(clock) });
      const previous = leaseRow(bootstrapDb);
      const hostGeneration = Number(previous?.hostGeneration || 0) + 1;
      const fencingToken = Number(previous?.fencingToken || 0) + 1;
      const atMs = Number(clock());
      const at = new Date(atMs).toISOString();
      let changes;
      if (!previous) {
        changes = bootstrapDb.prepare(`INSERT INTO authority_write_host_lease(
          singleton_id,owner_instance_id,owner_pid,owner_process_identity,startup_nonce,
          host_generation,fencing_token,state,acquired_at_ms,heartbeat_at_ms,
          acquired_at,heartbeat_at,updated_at
        ) VALUES(1,?,?,?,?,?,?,'ACTIVE',?,?,?,?,?)`).run(
          instanceId,pid,processIdentity,startupNonce,hostGeneration,fencingToken,
          atMs,atMs,at,at,at
        );
      } else {
        changes = bootstrapDb.prepare(`UPDATE authority_write_host_lease SET
          owner_instance_id=?,owner_pid=?,owner_process_identity=?,startup_nonce=?,
          host_generation=?,fencing_token=?,state='ACTIVE',acquired_at_ms=?,heartbeat_at_ms=?,
          acquired_at=?,heartbeat_at=?,updated_at=?
          WHERE singleton_id=1 AND host_generation=? AND fencing_token=?`).run(
          instanceId,pid,processIdentity,startupNonce,hostGeneration,fencingToken,
          atMs,atMs,at,at,at,Number(previous.hostGeneration),Number(previous.fencingToken)
        );
      }
      if (Number(changes.changes || 0) !== 1) {
        throw hostError('AUTHORITY_WRITE_HOST_CAS_CONFLICT', 'AuthorityWriteHost lease compare-and-swap failed');
      }
      bootstrapDb.exec('COMMIT');
      committed = true;

      const token = Object.freeze({
        instanceId,
        pid,
        processIdentity,
        startupNonce,
        hostGeneration,
        fencingToken,
        dbPath,
        bootstrapChecksum: BOOTSTRAP_CHECKSUM
      });
      let attachedStore = null;
      let closed = false;
      let startupClaimReleasedForTests = false;

      const capability = {
        dbPath,
        ownershipOptions,
        tokenSnapshot() { return token; },
        currentDb() { return attachedStore?.db || null; },
        attachStore(store) {
          if (closed) throw hostError('AUTHORITY_WRITE_HOST_CLOSED', 'AuthorityWriteHost capability is closed');
          if (attachedStore && attachedStore !== store) {
            throw hostError('AUTHORITY_WRITE_HOST_CAPABILITY_ALREADY_ATTACHED', 'AuthorityWriteHost capability is already attached');
          }
          if (!store || path.resolve(store.dbPath || '') !== dbPath || !store.db) {
            throw hostError('AUTHORITY_WRITE_HOST_STORE_INVALID', 'AuthorityWriteHost store attachment is invalid');
          }
          attachedStore = store;
          // The store's ownership claim is a same-process re-entrant reference.
          // Transfer the startup claim after the writable connection exists so
          // there is never an unowned file-handle window.
          try { ownership?.release(); } catch (_) {}
          ownership = store.ownership || ownership;
          assertCurrentAuthorityWriteHostToken(capability, store.db);
          return true;
        },
        heartbeat() {
          if (closed || startupClaimReleasedForTests) return false;
          const db = attachedStore?.db;
          if (!db) return Boolean(ownership?.heartbeat?.());
          assertCurrentAuthorityWriteHostToken(capability, db);
          const atMs = Number(clock());
          const at = new Date(atMs).toISOString();
          const result = db.prepare(`UPDATE authority_write_host_lease
            SET heartbeat_at_ms=?,heartbeat_at=?,updated_at=?
            WHERE singleton_id=1 AND state='ACTIVE' AND owner_instance_id=?
              AND host_generation=? AND fencing_token=?`).run(
            atMs,at,at,instanceId,hostGeneration,fencingToken
          );
          if (Number(result.changes || 0) !== 1) {
            throw hostError('AUTHORITY_WRITE_HOST_FENCED', 'AuthorityWriteHost heartbeat was fenced');
          }
          return ownership?.heartbeat?.() !== false;
        },
        markReleased() {
          if (closed) return false;
          const db = attachedStore?.db;
          if (!db) return false;
          const at = nowIso(clock);
          const result = db.prepare(`UPDATE authority_write_host_lease
            SET state='RELEASED',updated_at=?
            WHERE singleton_id=1 AND state='ACTIVE' AND owner_instance_id=?
              AND host_generation=? AND fencing_token=?`).run(at,instanceId,hostGeneration,fencingToken);
          return Number(result.changes || 0) === 1;
        },
        releaseStartupClaimForTests() {
          if (!process.env.NODE_TEST_CONTEXT && process.env.NODE_ENV !== 'test' && process.env.YANCE_TEST_ONLY_RUNTIME_RESET !== '1') {
            throw hostError('AUTHORITY_WRITE_HOST_TEST_RELEASE_FORBIDDEN', 'Test-only startup-claim release is unavailable in production');
          }
          startupClaimReleasedForTests = true;
          if (attachedStore?.ownershipHeartbeatTimer) {
            clearInterval(attachedStore.ownershipHeartbeatTimer);
            attachedStore.ownershipHeartbeatTimer = null;
          }
          try { attachedStore?.ownership?.release(); } catch (_) {}
          try { ownership?.release(); } catch (_) {}
          return true;
        },
        close() {
          if (closed) return false;
          closed = true;
          try { ownership?.release(); } catch (_) {}
          return true;
        },
        isClosed() { return closed; }
      };
      CAPABILITIES.add(capability);
      Object.freeze(capability);

      bootstrapDb.close();
      bootstrapDb = null;

      const host = Object.freeze({
        capability,
        tokenSnapshot: () => capability.tokenSnapshot(),
        heartbeat: () => capability.heartbeat(),
        releaseStartupClaimForTests: () => capability.releaseStartupClaimForTests(),
        close: () => capability.close()
      });
      return host;
    } catch (error) {
      try { bootstrapDb.exec('ROLLBACK'); } catch (_) {}
      throw error;
    }
  } catch (error) {
    try { bootstrapDb?.close(); } catch (_) {}
    try { ownership?.release(); } catch (_) {}
    if (committed && error && typeof error === 'object') error.authorityHostLeaseCommitted = true;
    throw error;
  }
}

module.exports = {
  acquireAuthorityWriteHost,
  assertCurrentAuthorityWriteHostToken,
  isAuthorityWriteHostCapability,
  requireAuthorityWriteHostCapability: requireCapability,
  hostError
};
