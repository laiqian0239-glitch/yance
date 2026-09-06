'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const { NamedRuntimeMutex } = require('./NamedRuntimeMutex');
const { RuntimeStateStore } = require('./RuntimeStateStore');
const { normalizeRuntimeError } = require('./errors');
const { canonicalizeRuntimePaths } = require('./RuntimePathIdentity');
const {
  acquireAuthorityWriteHost,
  requireAuthorityWriteHostCapability
} = require('../services/authorityWriteHost');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, Number(ms || 0))));
}

function sqliteOwnershipFailure(error, failedPhase = 'ownership_store_open') {
  const code = String(error?.code || error?.reasonCode || '');
  const errcode = Number(error?.errcode);
  const message = String(error?.message || '').toLowerCase();
  let reasonCode = '';

  if (code === 'ERR_SQLITE_ERROR' || Number.isInteger(errcode)) {
    if ([5, 6].includes(errcode) || /database is locked|database table is locked|\bbusy\b/.test(message)) {
      reasonCode = 'BOOT_SQLITE_BUSY_OR_LOCKED';
    } else if (errcode === 14 || /unable to open database file|cannot open/.test(message)) {
      reasonCode = 'BOOT_SQLITE_CANNOT_OPEN';
    } else if (errcode === 8 || /readonly|read-only/.test(message)) {
      reasonCode = 'BOOT_SQLITE_READ_ONLY';
    } else if (errcode === 10 || /disk i\/o error|ioerr/.test(message)) {
      reasonCode = 'BOOT_SQLITE_IO_FAILED';
    } else if (errcode === 11 || /malformed|corrupt/.test(message)) {
      reasonCode = 'BOOT_SQLITE_CORRUPT';
    } else if (errcode === 13 || /database or disk is full|disk full/.test(message)) {
      reasonCode = 'BOOT_SQLITE_DISK_FULL';
    } else if (errcode === 19 || /constraint failed/.test(message)) {
      reasonCode = 'BOOT_SQLITE_CONSTRAINT_FAILED';
    } else if (/no such table|no such column/.test(message)) {
      reasonCode = 'BOOT_SQLITE_SCHEMA_MISSING';
    } else if (/duplicate column|already exists|malformed database schema/.test(message)) {
      reasonCode = 'BOOT_SQLITE_SCHEMA_MISMATCH';
    } else if (/transaction within a transaction|no transaction is active|cannot commit|cannot rollback/.test(message)) {
      reasonCode = 'BOOT_SQLITE_TRANSACTION_STATE_INVALID';
    } else {
      reasonCode = 'BOOT_SQLITE_LOGIC_FAILED';
    }
  }

  if (!reasonCode) return normalizeRuntimeError(error, 'BOOT_RUNTIME_OWNERSHIP_FAILED');
  const wrapped = new (require('./errors').AppRuntimeError)(reasonCode, 'SQLite runtime ownership initialization failed', {
    status: 500,
    failedPhase,
    details: {
      sqliteErrcode: Number.isInteger(errcode) ? errcode : null,
      sqliteErrstr: typeof error?.errstr === 'string' ? error.errstr : ''
    }
  });
  wrapped.cause = error;
  return wrapped;
}

function retryableSqliteOwnershipFailure(error) {
  const code = String(error?.reasonCode || error?.code || '');
  return code === 'BOOT_SQLITE_BUSY_OR_LOCKED';
}

class RuntimeOwnership {
  constructor(options = {}) {
    if (!options.dataRoot) throw new TypeError('dataRoot is required');
    if (!options.buildId) throw new TypeError('buildId is required');
    const runtimePaths = options.runtimePaths || canonicalizeRuntimePaths({ dataRoot: options.dataRoot, dbPath: options.dbPath, platform: options.platform });
    this.runtimePaths = runtimePaths;
    this.options = options;
    this.dataRoot = runtimePaths.dataRoot;
    this.dbPath = runtimePaths.dbPath;
    this.buildId = String(options.buildId);
    this.ownerPid = Number(options.ownerPid || process.pid);
    this.ownerInstanceId = options.ownerInstanceId || crypto.randomUUID();
    this.bootAttemptId = options.bootAttemptId || crypto.randomUUID();
    this.leaseName = options.leaseName || 'app-runtime';
    this.leaseDurationMs = Math.max(3000, Number(options.leaseDurationMs || 15000));
    this.heartbeatIntervalMs = Math.max(500, Math.min(this.leaseDurationMs / 3, Number(options.heartbeatIntervalMs || 4000)));
    this.authorityWriteHostCapability =
      options.authorityWriteHostCapability
        ? requireAuthorityWriteHostCapability(
            options.authorityWriteHostCapability
          )
        : null;

    if (this.authorityWriteHostCapability) {
      const authorityDbPath =
        path.resolve(
          String(
            this.authorityWriteHostCapability.dbPath ||
            ''
          )
        );

      if (authorityDbPath !== this.dbPath) {
        const error =
          new Error(
            'AuthorityWriteHost capability does not match runtime ownership dbPath'
          );

        error.code =
          'RUNTIME_AUTHORITY_WRITE_HOST_PATH_MISMATCH';

        error.reasonCode =
          error.code;

        throw error;
      }

      if (options.mutex) {
        const error =
          new Error(
            'RuntimeOwnership cannot combine AuthorityWriteHost with a second process mutex'
          );

        error.code =
          'RUNTIME_PROCESS_EXCLUSION_AUTHORITY_CONFLICT';

        error.reasonCode =
          error.code;

        throw error;
      }
    }

    this.mutex =
      this.authorityWriteHostCapability
        ? null
        : (
            options.mutex ||
            new NamedRuntimeMutex({
              lockTarget: runtimePaths.dbPath,
              acquireTimeoutMs:
                options.acquireTimeoutMs
            })
          );
    this._ownedSqliteBroker = null;
    this._ownedAuthorityWriteHost = null;
    this.authorityWriteHostFactory = options.authorityWriteHostFactory || acquireAuthorityWriteHost;
    this.storeFactory = options.storeFactory || (storeOptions => {
      if (options.db) return new RuntimeStateStore({ ...storeOptions, db: options.db });
      // RuntimeOwnership is path-scoped. Falling back to the process-global
      // repository singleton silently redirects authority writes to whichever
      // database was initialized first, splitting dataRoot/dbPath identity from
      // the actual runtime_state authority. Production BootCoordinator injects
      // its primary broker; direct ownership users receive a private broker for
      // the exact canonical dbPath and RuntimeOwnership closes it on release.
      const { SqliteConnectionBroker } = require('../lib/sqliteConnectionBroker');
      if ((this._ownedSqliteBroker && !this._ownedSqliteBroker.closed) || this._ownedAuthorityWriteHost) {
        const error = new Error('Runtime ownership SQLite authority is already open');
        error.code = 'RUNTIME_SQLITE_AUTHORITY_ALREADY_OPEN';
        throw error;
      }
      const host = this.authorityWriteHostFactory({
        dbPath: storeOptions.dbPath,
        instanceId: `runtime-ownership:${this.ownerInstanceId}`
      });
      this._ownedAuthorityWriteHost = host;
      try {
        this._ownedSqliteBroker = new SqliteConnectionBroker({
          dbPath: storeOptions.dbPath,
          authorityWriteHostCapability: host.capability
        });
        return new RuntimeStateStore({ ...storeOptions, db: this._ownedSqliteBroker.open().db });
      } catch (error) {
        try { this._ownedSqliteBroker?.close(); } catch (_) {}
        this._ownedSqliteBroker = null;
        try { host.release(); } catch (_) {}
        this._ownedAuthorityWriteHost = null;
        throw error;
      }
    });
    this.initializeRuntimeState = options.initializeRuntimeState !== false;
    this.store = null;
    this.lease = null;
    this._heartbeatTimer = null;
    this._acquired = false;
    // --- M3: runtime lease-liveness watchdog (P0: orphan/zombie backend) ---
    this.onLeaseLost = options.onLeaseLost || this._defaultOnLeaseLost.bind(this);
    this.exitOnLeaseLost = options.exitOnLeaseLost !== false;
    this.leaseLostThreshold = Math.max(1, Number(options.leaseLostThreshold || 3));
    this.clock = options.clock || (() => Date.now());
    this._consecutiveHeartbeatFailures = 0;
    this._leaseLost = false;
    this._exitGuardHandler = null;
  }

  _closeOwnedSqliteAuthority() {
    try { this._ownedSqliteBroker?.close(); } catch (_) {}
    this._ownedSqliteBroker = null;
    try { this._ownedAuthorityWriteHost?.release(); } catch (_) {}
    this._ownedAuthorityWriteHost = null;
  }

  _defaultOnLeaseLost(reason, detail = {}) {
    // Production default: a backend that can no longer prove ownership must not keep holding
    // runtime resources (HTTP port, SQLite lease, FD6 custody pipe). Best-effort release, then exit.
    try { this.release().catch(() => {}); } catch (_) {}
    if (this.exitOnLeaseLost) {
      try { process.exit(1); } catch (_) {}
    }
  }

  async acquire() {
    if (this._acquired) return this.snapshot();
    if (this.mutex) {
      await this.mutex.acquire();
    }
    const retryDelaysMs = Array.isArray(this.options?.sqliteAcquireRetryDelaysMs)
      ? this.options.sqliteAcquireRetryDelaysMs
      : [50, 150, 300];
    let failedPhase = 'ownership_store_open';
    try {
      for (let attempt = 0; ; attempt += 1) {
        try {
          // Writable SQLite is deliberately opened only after the process-wide lock.
          failedPhase = 'ownership_store_open';
          this.store = this.storeFactory({ dbPath: this.dbPath });
          failedPhase = 'ownership_lease_acquire';
          this.lease = this.store.acquireLease({
            leaseName: this.leaseName,
            ownerInstanceId: this.ownerInstanceId,
            ownerPid: this.ownerPid,
            buildId: this.buildId,
            bootAttemptId: this.bootAttemptId,
            leaseDurationMs: this.leaseDurationMs,
            initializeRuntimeState: this.initializeRuntimeState
          });
          break;
        } catch (error) {
          const normalized = sqliteOwnershipFailure(error, failedPhase);
          if (!retryableSqliteOwnershipFailure(normalized) || attempt >= retryDelaysMs.length) throw normalized;
          // A constructor failure must not retain a half-open private broker.
          // Shared brokers leave `store` unset when construction throws and can
          // be retried safely while the process mutex remains held.
          if (failedPhase === 'ownership_store_open') {
            try { this.store?.close(); } catch (_) {}
            this.store = null;
            this._closeOwnedSqliteAuthority();
          }
          await sleep(retryDelaysMs[attempt]);
        }
      }
      this._acquired = true;
      this.installProcessGuards();
      return this.snapshot();
    } catch (error) {
      try { this.store?.close(); } catch (_) {}
      this.store = null;
      this._closeOwnedSqliteAuthority();
      if (this.mutex) {
        await this.mutex
          .release()
          .catch(() => {});
      }
      throw sqliteOwnershipFailure(error, failedPhase);
    }
  }

  startHeartbeat() {
    if (!this._acquired || !this.store || !this.lease) throw new Error('Runtime ownership has not been acquired');
    if (this._heartbeatTimer) return;
    this._heartbeatTimer = setInterval(() => {
      if (this._leaseLost) return;
      try {
        const update = this.store.heartbeat({
          leaseName: this.leaseName,
          ownerInstanceId: this.ownerInstanceId,
          fencingToken: this.lease.fencingToken,
          leaseDurationMs: this.leaseDurationMs
        });
        this._consecutiveHeartbeatFailures = 0;
        Object.assign(this.lease, update);
        // Proactive liveness: even if the DB accepted the heartbeat, retire this owner when the
        // lease has lapsed (clock skew / short lease / process was suspended). Keeps a zombie from
        // holding the HTTP port after another boot has reclaimed ownership via the fencing token.
        if (this.clock() >= Date.parse(this.lease.leaseExpiresAtUtc || 0)) {
          this._fireLeaseLost('RUNTIME_LEASE_EXPIRED', { leaseExpiresAtUtc: this.lease.leaseExpiresAtUtc });
        }
      } catch (error) {
        this._consecutiveHeartbeatFailures += 1;
        const stale = Boolean(error) && (error.code === 'STALE_FENCING_TOKEN' || error.reasonCode === 'STALE_FENCING_TOKEN');
        if (stale) {
          // Another boot advanced the fencing token and reclaimed the lease. We are now a zombie.
          this._fireLeaseLost('RUNTIME_LEASE_STALE', { code: error.code, message: error.message });
        } else if (this._consecutiveHeartbeatFailures >= this.leaseLostThreshold) {
          // Sustained inability to refresh the lease (DB unreachable, etc.). Do not keep holding
          // runtime resources on a lease we can no longer prove we own.
          this._fireLeaseLost('RUNTIME_LEASE_HEARTBEAT_FAILED', {
            consecutiveFailures: this._consecutiveHeartbeatFailures,
            lastError: error ? error.message : 'unknown'
          });
        }
      }
    }, this.heartbeatIntervalMs);
    this._heartbeatTimer.unref?.();
  }

  _fireLeaseLost(reason, detail = {}) {
    if (this._leaseLost) return;
    this._leaseLost = true;
    this.stopHeartbeat();
    try {
      this.onLeaseLost(reason, Object.assign({
        ownerInstanceId: this.ownerInstanceId,
        ownerPid: this.ownerPid,
        fencingToken: Number(this.lease ? this.lease.fencingToken : 0),
        dataRoot: this.dataRoot
      }, detail));
    } catch (_) {
      // A custom onLeaseLost must never throw into the heartbeat timer.
    }
  }

  installProcessGuards() {
    if (this._exitGuardHandler) return;
    this._exitGuardHandler = () => {
      if (!this._acquired) return;
      // Best-effort synchronous cleanup so a crash cannot strand the next boot:
      //  - releaseLease is a synchronous SQLite write that clears the lease row
      //  - proper-lockfile owns process exclusion and performs its own process-exit cleanup
      try { this.store?.releaseLease(this.guard()); } catch (_) {}
      try { this.mutex?.release?.(); } catch (_) {}
      this._acquired = false;
      this._leaseLost = false;
    };
    process.on('exit', this._exitGuardHandler);
  }

  stopHeartbeat() {
    if (this._heartbeatTimer) clearInterval(this._heartbeatTimer);
    this._heartbeatTimer = null;
  }

  uninstallProcessGuards() {
    if (!this._exitGuardHandler) return;
    process.removeListener('exit', this._exitGuardHandler);
    this._exitGuardHandler = null;
  }

  guard() {
    if (!this._acquired || !this.store || !this.lease) throw new Error('Runtime ownership has not been acquired');
    return Object.freeze({
      leaseName: this.leaseName,
      ownerInstanceId: this.ownerInstanceId,
      fencingToken: Number(this.lease.fencingToken)
    });
  }

  async release(options = {}) {
    this.stopHeartbeat();
    this.uninstallProcessGuards();
    this._leaseLost = false;
    this._consecutiveHeartbeatFailures = 0;
    if (this._acquired && this.store && this.lease && options.releaseLease !== false) {
      try { this.store.releaseLease(this.guard()); } catch (_) {}
    }
    this._acquired = false;
    if (options.closeStore !== false) {
      try { this.store?.close(); } catch (_) {}
      this.store = null;
      this._closeOwnedSqliteAuthority();
    }
    if (this.mutex) {
      await this.mutex
        .release()
        .catch(() => {});
    }
  }

  snapshot() {
    return Object.freeze({
      acquired: this._acquired,
      ownerInstanceId: this.ownerInstanceId,
      ownerPid: this.ownerPid,
      bootAttemptId: this.bootAttemptId,
      leaseName: this.leaseName,
      fencingToken: Number(this.lease?.fencingToken || 0),
      buildId: this.buildId,
      dataRoot: this.dataRoot,
      dbPath: this.dbPath,
      dataRootIdentity: this.runtimePaths.dataRootIdentity,
      dbPathIdentity: this.runtimePaths.dbPathIdentity,
      mutexIdentityKind: this.runtimePaths.mutexIdentityKind,
      mutexIdentity: this.runtimePaths.mutexIdentity,
      mutexProvider:
        this.mutex?.provider ||
        'AUTHORITY_WRITE_HOST',

      mutex:
        this.mutex?.snapshot?.() ||
        Object.freeze({
          name: this.dbPath,
          target: this.dbPath,
          provider:
            'AUTHORITY_WRITE_HOST',
          held: this._acquired
        }),
      heartbeatAtUtc: this.lease?.heartbeatAtUtc || '',
      leaseExpiresAtUtc: this.lease?.leaseExpiresAtUtc || ''
    });
  }
}

module.exports = { RuntimeOwnership };
