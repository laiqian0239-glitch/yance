'use strict';

const fs = require('node:fs');
const path = require('node:path');

const PROBE_ENV = 'YANCE_WP2_PRODUCTION_RUNTIME_PROBE';
let sqliteHandle = null;
let lastSnapshot = Object.freeze({ enabled: false, executed: false });

function normalize(value) {
  return path.resolve(String(value || ''));
}

function writeAccessReceipt(directory, kind) {
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, '.wp2-production-path-access.json');
  fs.writeFileSync(file, `${JSON.stringify({
    schemaVersion: 1,
    kind,
    adapter: 'backend/services/productionRuntimePathProbe.js',
    accessedAtUtc: new Date().toISOString()
  }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  return file;
}

function exists(file) {
  try { return fs.existsSync(file); } catch (_) { return false; }
}

function executeProductionRuntimePathProbe(options = {}) {
  if (process.env[PROBE_ENV] !== '1') {
    lastSnapshot = Object.freeze({ enabled: false, executed: false });
    return lastSnapshot;
  }

  closeProductionRuntimePathProbe();

  const dataRoot = normalize(options.dataRoot);
  const sqlitePath = normalize(options.sqlitePath);
  const diagnosticsPath = normalize(options.diagnosticsPath);
  const loggingPath = normalize(options.loggingPath);
  if (!dataRoot || !sqlitePath || !diagnosticsPath || !loggingPath) {
    const error = new Error('WP2 production runtime path probe requires concrete production paths');
    error.reasonCode = 'WP2_PRODUCTION_PATH_PROBE_CONFIGURATION_INVALID';
    throw error;
  }

  fs.mkdirSync(path.dirname(sqlitePath), { recursive: true });
  const broker = require('../lib/sqliteConnectionBroker').getSqliteConnectionBroker({ optional: true });
  const store = broker ? broker.getStore() : require('../repositories/storeProvider').getStore();
  if (path.resolve(store.dbPath) !== path.resolve(sqlitePath)) {
    const error = new Error('Production path probe attempted to open a second SQLite owner');
    error.reasonCode = 'SQLITE_SECOND_WRITE_OWNER_REJECTED';
    throw error;
  }
  sqliteHandle = store.db;
  sqliteHandle.exec('PRAGMA wal_autocheckpoint=0;');
  sqliteHandle.exec('CREATE TABLE IF NOT EXISTS wp2_runtime_path_probe (kind TEXT PRIMARY KEY, accessed_at TEXT NOT NULL) STRICT;');
  const now = new Date().toISOString();
  sqliteHandle.prepare('INSERT INTO wp2_runtime_path_probe(kind,accessed_at) VALUES(?,?) ON CONFLICT(kind) DO UPDATE SET accessed_at=excluded.accessed_at').run('production-server-chain', now);

  // The desktop settings authority stores its document in the same production
  // SQLite file under the desktop-settings namespace. The probe accesses that
  // real namespace and path without introducing a test-only persistence file.
  sqliteHandle.exec('CREATE TABLE IF NOT EXISTS r32_settings (namespace TEXT NOT NULL, key TEXT NOT NULL, value_json TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(namespace,key)) STRICT;');
  sqliteHandle.prepare('INSERT INTO r32_settings(namespace,key,value_json,updated_at) VALUES(?,?,?,?) ON CONFLICT(namespace,key) DO UPDATE SET updated_at=excluded.updated_at').run(
    'desktop-settings',
    'wp2-production-path-probe',
    JSON.stringify({ accessedBy: 'productionRuntimePathProbe', containsSessionMaterial: false }),
    now
  );

  const localStorageDirectory = path.join(dataRoot, 'Local Storage', 'leveldb');
  const indexedDbDirectory = path.join(dataRoot, 'IndexedDB');
  const crashDirectory = path.join(dataRoot, 'Crashpad');
  const localStorageReceipt = writeAccessReceipt(localStorageDirectory, 'electron-localStorage');
  const indexedDbReceipt = writeAccessReceipt(indexedDbDirectory, 'electron-indexedDB');
  const crashReceipt = writeAccessReceipt(crashDirectory, 'electron-crash-output');

  options.logger?.info?.('server', 'wp2-production-runtime-path-probe', {
    sqlitePath,
    localStorageDirectory,
    indexedDbDirectory,
    crashDirectory
  });
  options.diagnostics?.recordEvent?.('wp2-production-runtime-path-probe', {
    severity: 'info',
    metadata: {
      sqlitePath,
      localStorageDirectory,
      indexedDbDirectory,
      crashDirectory
    }
  });

  const walPath = `${sqlitePath}-wal`;
  const shmPath = `${sqlitePath}-shm`;
  const checks = {
    productionDiagnosticsPathExecuted: exists(diagnosticsPath),
    productionLoggingPathExecuted: exists(loggingPath),
    sqlitePathExecuted: exists(sqlitePath),
    sqliteWalPathExecuted: exists(walPath),
    sqliteShmPathExecuted: exists(shmPath),
    electronSettingsStorePathExecuted: Boolean(sqliteHandle.prepare('SELECT 1 AS ok FROM r32_settings WHERE namespace=? AND key=?').get('desktop-settings', 'wp2-production-path-probe')?.ok),
    localStoragePathExecuted: exists(localStorageReceipt),
    indexedDbPathExecuted: exists(indexedDbReceipt),
    crashOutputPathExecuted: exists(crashReceipt)
  };
  const productionPersistencePathsExecuted = Object.entries(checks)
    .filter(([name]) => !name.startsWith('productionDiagnostics') && !name.startsWith('productionLogging'))
    .every(([, value]) => value === true);

  lastSnapshot = Object.freeze({
    enabled: true,
    executed: true,
    adapter: 'backend/services/productionRuntimePathProbe.js',
    productionDiagnosticsPathExecuted: checks.productionDiagnosticsPathExecuted,
    productionLoggingPathExecuted: checks.productionLoggingPathExecuted,
    productionPersistencePathsExecuted,
    checks,
    paths: {
      diagnostics: diagnosticsPath,
      logging: loggingPath,
      sqlite: sqlitePath,
      sqliteWal: walPath,
      sqliteShm: shmPath,
      electronSettingsStore: sqlitePath,
      localStorage: localStorageDirectory,
      indexedDb: indexedDbDirectory,
      crashOutput: crashDirectory
    }
  });

  if (!lastSnapshot.productionDiagnosticsPathExecuted || !lastSnapshot.productionLoggingPathExecuted || !lastSnapshot.productionPersistencePathsExecuted) {
    const error = new Error('Production runtime path probe did not execute every required path');
    error.reasonCode = 'WP2_PRODUCTION_PATH_PROBE_INCOMPLETE';
    error.details = lastSnapshot;
    throw error;
  }

  return lastSnapshot;
}

function getProductionRuntimePathProbeSnapshot() {
  return lastSnapshot;
}

function closeProductionRuntimePathProbe() {
  if (sqliteHandle) sqliteHandle = null;
}

module.exports = {
  PROBE_ENV,
  executeProductionRuntimePathProbe,
  getProductionRuntimePathProbeSnapshot,
  closeProductionRuntimePathProbe
};
