'use strict';

const { SqliteDocumentStore } = require('../lib/sqliteDocumentStore');

const store = new SqliteDocumentStore('system-policy', {
  schemaVersion: 1,
  emergencyStop: false,
  privacyMode: true,
  reason: '',
  updatedAt: '',
  updatedBy: 'system'
});

function read() {
  const { safeMode: _legacySafeMode, ...value } = store.read();
  return value;
}

function update(patch = {}, actor = 'desktop-user') {
  return store.update(current => ({
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
    updatedBy: String(actor || 'desktop-user').slice(0, 80)
  }));
}

module.exports = { read, update };
