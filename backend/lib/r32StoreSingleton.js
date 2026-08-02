'use strict';

const { assertStorageAccess } = require('./runtimeRoleGuard');
assertStorageAccess('getR32Store');

function getR32Store() {
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
  const { getSqliteConnectionBroker } = require('./sqliteConnectionBroker');
  const broker = getSqliteConnectionBroker({ optional: true });
  if (!broker) return;
  broker.checkpointAndClose();
}

module.exports = { getR32Store, closeR32Store };
