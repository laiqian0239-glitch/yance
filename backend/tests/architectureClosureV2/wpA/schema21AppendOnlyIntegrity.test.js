'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { acquireAuthorityWriteHost } = require('../../../services/authorityWriteHost');
const { SqliteConnectionBroker } = require('../../../lib/sqliteConnectionBroker');

function withDatabase(work) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-acv2-schema21-integrity-'));
  const dbPath = path.join(root, 'yance-r32.db');
  let host;
  let broker;
  try {
    host = acquireAuthorityWriteHost({ dbPath, instanceId: `schema21-integrity-${process.pid}-${Date.now()}` });
    broker = new SqliteConnectionBroker({ dbPath, authorityWriteHostCapability: host.capability });
    return work(broker.open().db);
  } finally {
    try { broker?.close(); } catch (_) {}
    try { host?.close(); } catch (_) {}
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function uniqueIndexColumns(db, table) {
  return db.prepare(`PRAGMA index_list(${table})`).all()
    .filter(index => Number(index.unique) === 1)
    .map(index => db.prepare(`PRAGMA index_info(${String(index.name)})`).all().map(row => String(row.name)));
}

function triggerNames(db, table) {
  return db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name=? ORDER BY name").all(table)
    .map(row => String(row.name));
}

test('canonical event header enforces a one-to-one payload identifier', () => withDatabase(db => {
  const unique = uniqueIndexColumns(db, 'canonical_event_headers');
  assert.equal(unique.some(columns => columns.length === 1 && columns[0] === 'payload_id'), true);
}));

test('event type registry is append-only and cannot rewrite historical schema descriptors', () => withDatabase(db => {
  const names = triggerNames(db, 'event_type_registry');
  assert.ok(names.some(name => name.includes('append_only_update')));
  assert.ok(names.some(name => name.includes('append_only_delete')));
}));

test('all immutable Schema 21 authorities have both update and delete blockers', () => withDatabase(db => {
  for (const table of [
    'canonical_event_headers',
    'authority_payload_store',
    'event_type_registry',
    'authority_command_receipts'
  ]) {
    const names = triggerNames(db, table);
    assert.ok(names.some(name => name.includes('append_only_update')), `${table}:update`);
    assert.ok(names.some(name => name.includes('append_only_delete')), `${table}:delete`);
  }
}));
