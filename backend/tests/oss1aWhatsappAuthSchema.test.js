'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { R32SqliteStore, SCHEMA_VERSION } = require('../lib/r32SqliteStore');

function withStore(callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-oss1a-schema23-red-'));
  const dbPath = path.join(root, 'database', 'yance.db');
  let store;
  try {
    store = new R32SqliteStore({ dbPath });
    return callback(store);
  } finally {
    try { store?.close(); } catch (_) {}
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
}

test('R32SqliteStore advances to Schema 23 and installs the encrypted WhatsApp authority tables', () => {
  withStore(store => {
    assert.equal(SCHEMA_VERSION, 23);
    assert.equal(store.getMeta('schema_version', 0), 23);
    assert.equal(store.getMeta('schemaVersion', 0), 23);

    const tables = new Set(
      store.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()
        .map(row => String(row.name || ''))
    );
    for (const table of [
      'whatsapp_auth_accounts',
      'whatsapp_auth_keys',
      'whatsapp_auth_import_receipts',
      'whatsapp_message_retry_counters',
      'whatsapp_message_key_index',
      'whatsapp_message_retry_payloads'
    ]) {
      assert.equal(tables.has(table), true, table);
    }
  });
});
