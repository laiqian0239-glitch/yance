'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { R32SqliteStore, SCHEMA_VERSION } = require('../../backend/lib/r32SqliteStore');
const { DatabaseSync } = require('node:sqlite');
const { SqliteOwnershipError } = require('../../backend/lib/sqliteOwnership');
const { removePathWithRetries } = require('../test-support/windows-cleanup');

function tmpDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'm5-sqlite-'));
  return { dir, dbPath: path.join(dir, 'yance-r32.db') };
}

function cleanup(dir) { removePathWithRetries(dir); }

test('R32SqliteStore claims ownership and rejects a second live instance (different pid)', () => {
  const { dir, dbPath } = tmpDb();
  let store1 = null;
  let unexpectedStore = null;
  try {
    store1 = new R32SqliteStore({ dbPath, ownershipPid: 9101, ownershipPidAlive: () => true });
    assert.ok(store1.ownership, 'ownership handle present');
    assert.strictEqual(store1.ownership.isReleased(), false);
    assert.strictEqual(store1.getMeta('schema_version', null), SCHEMA_VERSION, 'schema_version recorded');
    assert.strictEqual(store1.getMeta('schemaVersion', null), SCHEMA_VERSION, 'legacy schemaVersion converged');
    assert.throws(
      () => { unexpectedStore = new R32SqliteStore({ dbPath, ownershipPid: 9102, ownershipPidAlive: () => true }); },
      (e) => e instanceof SqliteOwnershipError && e.reasonCode === 'SQLITE_OWNERSHIP_CONFLICT'
    );
    store1.close();
    const released = store1.ownership.isReleased();
    store1 = null;
    assert.strictEqual(released, true, 'lock released on close');
  } finally {
    if (unexpectedStore) unexpectedStore.close();
    if (store1) store1.close();
    cleanup(dir);
  }
});

test('same-process re-entrant open (same pid) is benign and does NOT throw', () => {
  const { dir, dbPath } = tmpDb();
  let store1 = null;
  let store2 = null;
  let unexpectedStore = null;
  try {
    store1 = new R32SqliteStore({ dbPath, ownershipPid: 9201, ownershipPidAlive: () => true });
    assert.ok(store1.ownership, 'first ownership handle present');
    store2 = new R32SqliteStore({ dbPath, ownershipPid: 9201, ownershipPidAlive: () => true });
    assert.ok(store2.ownership, 're-entrant ownership handle present');
    assert.strictEqual(store2.ownership.isReentrant, true, 'marked as re-entrant');
    store1.close(); store1 = null;
    assert.strictEqual(fs.existsSync(`${dbPath}.ownership.json`), true, 'shared lock survives first close');
    assert.strictEqual(store2.ownership.heartbeat(), true, 'remaining store keeps ownership alive');
    assert.throws(
      () => { unexpectedStore = new R32SqliteStore({ dbPath, ownershipPid: 9202, ownershipPidAlive: pid => pid === 9201 }); },
      (e) => e instanceof SqliteOwnershipError && e.reasonCode === 'SQLITE_OWNERSHIP_CONFLICT'
    );
    store2.close(); store2 = null;
    assert.strictEqual(fs.existsSync(`${dbPath}.ownership.json`), false, 'final close releases shared lock');
  } finally {
    if (store2) store2.close();
    if (store1) store1.close();
    cleanup(dir);
  }
});

test('after close, a new instance can re-acquire the same db path', () => {
  const { dir, dbPath } = tmpDb();
  let store = null;
  try {
    store = new R32SqliteStore({ dbPath });
    store.close(); store = null;
    store = new R32SqliteStore({ dbPath });
    assert.ok(store.ownership);
    store.close(); store = null;
  } finally {
    if (store) store.close();
    cleanup(dir);
  }
});

test('opening a newer-schema DB with an older binary fails with SCHEMA_VERSION_AHEAD', () => {
  const { dir, dbPath } = tmpDb();
  let store = null;
  let unexpectedStore = null;
  try {
    store = new R32SqliteStore({ dbPath });
    store.setMeta('schema_version', SCHEMA_VERSION + 1);
    store.close(); store = null;
    assert.throws(
      () => { unexpectedStore = new R32SqliteStore({ dbPath }); },
      (e) => e instanceof SqliteOwnershipError && e.reasonCode === 'SCHEMA_VERSION_AHEAD'
    );
    assert.equal(fs.existsSync(`${dbPath}.ownership.json`), false);
  } finally {
    if (unexpectedStore) unexpectedStore.close();
    if (store) store.close();
    cleanup(dir);
  }
});


test('unversioned existing database is backed up and records a committed migration receipt before schema adoption', () => {
  const { dir, dbPath } = tmpDb();
  let store = null;
  const legacy = new DatabaseSync(dbPath);
  legacy.exec("CREATE TABLE legacy_contact(id TEXT PRIMARY KEY, name TEXT); INSERT INTO legacy_contact VALUES('1','Kurt');");
  legacy.close();
  try {
    store = new R32SqliteStore({ dbPath });
    const receipt = store.getMeta('schema_migration_last_receipt', null);
    assert.equal(receipt.status, 'COMMITTED');
    assert.equal(receipt.fromVersion, null);
    assert.equal(receipt.toVersion, SCHEMA_VERSION);
    assert.ok(receipt.backupPath.endsWith('.bak'));
    assert.ok(fs.existsSync(receipt.backupPath));
    const backup = new DatabaseSync(receipt.backupPath, { readOnly: true });
    try {
      assert.equal(backup.prepare('SELECT name FROM legacy_contact WHERE id=?').get('1').name, 'Kurt');
      assert.equal(backup.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    } finally { backup.close(); }
  } finally {
    if (store) store.close();
    cleanup(dir);
  }
});
