'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { acquireAuthorityWriteHost } = require('../../../backend/services/authorityWriteHost');
const {
  createSqliteConnectionBroker,
  resetSqliteConnectionBrokerForTests
} = require('../../../backend/lib/sqliteConnectionBroker');

function restoreEnvironment(previous) {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function installAuthoritySqliteTestHost(name) {
  const normalizedName = String(name || 'uat').replace(/[^a-z0-9-]+/giu, '-').toLowerCase();
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), `yance-${normalizedName}-`));
  const dbPath = path.join(dataRoot, 'store', 'yance-r32.db');
  const previousEnvironment = {
    YANCE_DATA_DIR: process.env.YANCE_DATA_DIR,
    YANCE_PRIMARY_SQLITE_PATH: process.env.YANCE_PRIMARY_SQLITE_PATH,
    YANCE_TEST_ONLY_SQLITE_BROKER_RESET: process.env.YANCE_TEST_ONLY_SQLITE_BROKER_RESET
  };
  process.env.YANCE_DATA_DIR = dataRoot;
  process.env.YANCE_PRIMARY_SQLITE_PATH = dbPath;
  process.env.YANCE_TEST_ONLY_SQLITE_BROKER_RESET = '1';

  let host = null;
  let broker = null;
  try {
    resetSqliteConnectionBrokerForTests();
    host = acquireAuthorityWriteHost({
      dbPath,
      instanceId: `uat-diagnostics:${normalizedName}:${process.pid}`
    });
    broker = createSqliteConnectionBroker({
      dbPath,
      authorityWriteHostCapability: host.capability
    });
    const store = broker.open();
    let closed = false;
    return Object.freeze({
      dataRoot,
      dbPath,
      store,
      broker,
      close() {
        if (closed) return false;
        closed = true;
        try { broker.checkpointAndClose(); } finally {
          try { resetSqliteConnectionBrokerForTests(); } catch (_) {}
          restoreEnvironment(previousEnvironment);
          fs.rmSync(dataRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
        }
        return true;
      }
    });
  } catch (error) {
    try { broker?.close(); } catch (_) {}
    try { host?.close(); } catch (_) {}
    try { resetSqliteConnectionBrokerForTests(); } catch (_) {}
    restoreEnvironment(previousEnvironment);
    fs.rmSync(dataRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    throw error;
  }
}

module.exports = { installAuthoritySqliteTestHost };
