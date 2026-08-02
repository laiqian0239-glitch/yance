'use strict';

const path = require('node:path');
const { R32SqliteStore } = require('./r32SqliteStore');
const {
  acquireAuthorityWriteHost,
  isAuthorityWriteHostCapability,
  requireAuthorityWriteHostCapability
} = require('../services/authorityWriteHost');

class SqliteConnectionBroker {
  constructor(options = {}) {
    if (!options.dbPath) throw new TypeError('SqliteConnectionBroker requires dbPath');
    this.dbPath = path.resolve(options.dbPath);
    this.storeOptions = { ...(options.storeOptions || {}) };
    this.store = null;
    this.closed = false;
    this.heartbeatTimer = null;
    this.ownedAuthorityHost = null;

    if (options.authorityWriteHostCapability) {
      this.authorityWriteHostCapability = requireAuthorityWriteHostCapability(options.authorityWriteHostCapability);
    } else {
      this.ownedAuthorityHost = acquireAuthorityWriteHost({
        dbPath: this.dbPath,
        instanceId: options.instanceId,
        startupNonce: options.startupNonce,
        ownershipStaleMs: options.ownershipStaleMs,
        ownershipPid: options.ownershipPid,
        ownershipPidAlive: options.ownershipPidAlive,
        ownershipProcessIdentity: options.ownershipProcessIdentity,
        ownershipCapturePidIdentity: options.ownershipCapturePidIdentity,
        ownershipFsProvider: options.ownershipFsProvider,
        clock: options.ownershipClock || options.clock
      });
      this.authorityWriteHostCapability = this.ownedAuthorityHost.capability;
    }
    if (!isAuthorityWriteHostCapability(this.authorityWriteHostCapability)) {
      throw Object.assign(new Error('AuthorityWriteHost capability is invalid'), {
        code: 'AUTHORITY_WRITE_HOST_CAPABILITY_INVALID'
      });
    }
    if (path.resolve(this.authorityWriteHostCapability.dbPath) !== this.dbPath) {
      try { this.ownedAuthorityHost?.close(); } catch (_) {}
      throw Object.assign(new Error('AuthorityWriteHost capability database path does not match broker path'), {
        code: 'AUTHORITY_WRITE_HOST_CAPABILITY_PATH_MISMATCH'
      });
    }
  }

  open() {
    if (this.closed) {
      const error = new Error('SQLite broker is closed');
      error.code = 'SQLITE_BROKER_CLOSED';
      throw error;
    }
    if (!this.store) {
      try {
        const ownership = this.authorityWriteHostCapability.ownershipOptions || {};
        this.store = new R32SqliteStore({
          ...this.storeOptions,
          dbPath: this.dbPath,
          authorityWriteHostCapability: this.authorityWriteHostCapability,
          ownershipPid: ownership.pid,
          ownershipPidAlive: ownership.pidAlive,
          ownershipClock: ownership.clock,
          ownershipFsProvider: ownership.fsProvider,
          ownershipCapturePidIdentity: ownership.capturePidIdentity
        });
        this.authorityWriteHostCapability.attachStore(this.store);
        this.startHeartbeat();
      } catch (error) {
        try { this.store?.close(); } catch (_) {}
        this.store = null;
        try { this.ownedAuthorityHost?.close(); } catch (_) {}
        throw error;
      }
    }
    return this.store;
  }

  startHeartbeat() {
    if (this.heartbeatTimer || this.closed) return;
    this.heartbeatTimer = setInterval(() => {
      try {
        this.authorityWriteHostCapability.heartbeat();
      } catch (error) {
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = null;
        try { this.store?.db?.exec('PRAGMA query_only = ON'); } catch (_) {}
        if (this.store && !this.store.ownershipLostError) this.store.ownershipLostError = error;
      }
    }, Math.max(250, Number(this.storeOptions.authorityHeartbeatMs || 1000)));
    this.heartbeatTimer.unref?.();
  }

  isOpen() { return Boolean(this.store && !this.closed); }
  getStore() { return this.open(); }
  getDb() { return this.open().db; }
  transaction(fn) { return this.open().transaction(fn); }
  transactionAsync(fn) { return this.open().transactionAsync(fn); }

  checkpointAndClose() {
    if (!this.store || this.closed) return;
    try { this.store.db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch (_) {}
    this.close();
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    try { this.authorityWriteHostCapability?.markReleased(); } catch (_) {}
    if (this.store) {
      try { this.store.close(); } finally { this.store = null; }
    }
    try { this.ownedAuthorityHost?.close(); } catch (_) {}
    try { this.authorityWriteHostCapability?.close(); } catch (_) {}
  }

  snapshot() {
    return Object.freeze({
      dbPath: this.dbPath,
      open: this.isOpen(),
      closed: this.closed,
      owner: 'AuthorityWriteHost',
      authorityWriteHostCapability: this.authorityWriteHostCapability.tokenSnapshot()
    });
  }
}

let singleton = null;
function createSqliteConnectionBroker(options = {}) {
  if (singleton && !singleton.closed) {
    const error = new Error('A second SQLite write owner was requested');
    error.code = 'SQLITE_SECOND_WRITE_OWNER_REJECTED';
    throw error;
  }
  singleton = new SqliteConnectionBroker(options);
  return singleton;
}
function configureSqliteConnectionBroker(broker) {
  if (!(broker instanceof SqliteConnectionBroker)) throw new TypeError('A SqliteConnectionBroker instance is required');
  if (singleton && singleton !== broker && !singleton.closed) {
    const error = new Error('A second SQLite write owner was requested');
    error.code = 'SQLITE_SECOND_WRITE_OWNER_REJECTED';
    throw error;
  }
  singleton = broker;
  return singleton;
}
function getSqliteConnectionBroker(options = {}) {
  if (!singleton) {
    if (options.optional === true) return null;
    const error = new Error('SQLite broker is not initialized');
    error.code = 'SQLITE_BROKER_NOT_READY';
    throw error;
  }
  return singleton;
}
function resetSqliteConnectionBrokerForTests() {
  if (!process.env.NODE_TEST_CONTEXT && process.env.NODE_ENV !== 'test' && process.env.YANCE_TEST_ONLY_SQLITE_BROKER_RESET !== '1') {
    const error = new Error('SQLite broker reset is test-only');
    error.code = 'SQLITE_BROKER_RESET_FORBIDDEN';
    throw error;
  }
  try { singleton?.close(); } catch (_) {}
  singleton = null;
}

module.exports = {
  SqliteConnectionBroker,
  createSqliteConnectionBroker,
  configureSqliteConnectionBroker,
  getSqliteConnectionBroker,
  resetSqliteConnectionBrokerForTests
};
