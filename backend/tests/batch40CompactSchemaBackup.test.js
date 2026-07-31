'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { R32SqliteStore } = require('../lib/r32SqliteStore');


test('schema adoption backup uses a bounded filename instead of embedding migration metadata', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-b40-schema-backup-budget-'));
  const dbPath = path.join(root, 'store', 'yance-r32.db');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const legacy = new DatabaseSync(dbPath);
  legacy.exec("CREATE TABLE legacy_contact(id TEXT PRIMARY KEY, name TEXT); INSERT INTO legacy_contact VALUES('1','Kurt');");
  legacy.close();
  let store;
  t.after(() => {
    if (store) store.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  store = new R32SqliteStore({ dbPath });
  const receipt = store.getMeta('schema_migration_last_receipt', null);
  assert.equal(receipt.status, 'COMMITTED');
  assert.ok(path.basename(receipt.backupPath).length <= 72,
    `schema backup filename exceeded the Windows path budget: ${path.basename(receipt.backupPath)}`);
  assert.match(path.basename(receipt.backupPath), /^[a-f0-9]{64}\.bak$/u);
});
