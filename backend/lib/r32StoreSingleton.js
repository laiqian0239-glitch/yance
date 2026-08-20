'use strict';

const { assertStorageAccess } = require('./runtimeRoleGuard');

function getR32Store() {
  // Importing the singleton module must remain side-effect free for non-storage
  // processes such as the Electron parent. The role boundary is enforced at
  // the capability-use point, not while CommonJS resolves dependency graphs.
  assertStorageAccess('getR32Store');
  const { getSqliteConnectionBroker } = require('./sqliteConnectionBroker');
  const broker = getSqliteConnectionBroker();
  if (!broker) {
    const error = new Error('SQLite broker is not initialized');
    error.code = 'SQLITE_BROKER_NOT_READY';
    throw error;
  }
  return broker.getStore();
}

function closeR32Store() {
  assertStorageAccess('closeR32Store');
  const { getSqliteConnectionBroker } = require('./sqliteConnectionBroker');
  const broker = getSqliteConnectionBroker({ optional: true });
  if (!broker) return;
  broker.checkpointAndClose();
}

module.exports = { getR32Store, closeR32Store };
