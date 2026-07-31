'use strict';

const path = require('node:path');
const { R32SqliteStore } = require('./r32SqliteStore');

class SqliteConnectionBroker {
  constructor(options = {}) {
    if (!options.dbPath) throw new TypeError('SqliteConnectionBroker requires dbPath');
    this.dbPath = path.resolve(options.dbPath);
    this.storeOptions = { ...(options.storeOptions || {}) };
    this.store = null;
    this.closed = false;
  }

  open() {
    if (this.closed) {
      const error = new Error('SQLite broker is closed');
      error.code = 'SQLITE_BROKER_CLOSED';
      throw error;
    }
    if (!this.store) this.store = new R32SqliteStore({ ...this.storeOptions, dbPath: this.dbPath });
    return this.store;
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
    if (this.store) {
      try { this.store.close(); } finally { this.store = null; }
    }
  }

  snapshot() {
    return Object.freeze({ dbPath: this.dbPath, open: this.isOpen(), closed: this.closed, owner: 'SqliteConnectionBroker' });
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
  if (process.env.NODE_ENV !== 'test' && process.env.YANCE_TEST_ONLY_SQLITE_BROKER_RESET !== '1') {
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
