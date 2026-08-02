'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
const desktopEntryPath = path.join(repoRoot, 'backend', 'desktopHostedEntry.js');
const {
  SqliteConnectionBroker
} = require('../../../lib/sqliteConnectionBroker');
const {
  acquireAuthorityWriteHost
} = require('../../../services/authorityWriteHost');

function tempDb() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-a8-boot-authority-'));
  return { root, dbPath: path.join(root, 'store', 'yance-r32.db') };
}

test('A8 desktop boot acquires AuthorityWriteHost before constructing the SQLite broker', () => {
  const source = fs.readFileSync(desktopEntryPath, 'utf8');
  const acquireIndex = source.indexOf('acquireAuthorityWriteHost');
  const brokerIndex = source.indexOf('createSqliteConnectionBroker');

  assert.ok(acquireIndex >= 0, 'desktop boot must import and call acquireAuthorityWriteHost');
  assert.ok(brokerIndex > acquireIndex, 'desktop boot must acquire the host before constructing the broker');
  assert.equal(
    source.includes('createSqliteConnectionBroker({ dbPath: primarySqlitePath })'),
    false,
    'desktop boot must pass the genuine host capability into the broker'
  );
  assert.match(source, /authorityWriteHostCapability\s*:\s*authorityWriteHost\.capability/);
});

test('A8 SQLite broker rejects construction without an externally acquired genuine host capability', () => {
  const { root, dbPath } = tempDb();
  let authorityWriteHost;
  let broker;
  try {
    assert.throws(
      () => new SqliteConnectionBroker({ dbPath }),
      error => error?.code === 'AUTHORITY_WRITE_HOST_CAPABILITY_REQUIRED'
    );

    authorityWriteHost = acquireAuthorityWriteHost({ dbPath, instanceId: 'a8-boot-contract' });
    broker = new SqliteConnectionBroker({
      dbPath,
      authorityWriteHostCapability: authorityWriteHost.capability
    });
    assert.equal(broker.snapshot().owner, 'AuthorityWriteHost');
  } finally {
    try { broker?.close(); } catch (_) {}
    try { authorityWriteHost?.close(); } catch (_) {}
    fs.rmSync(root, { recursive: true, force: true });
  }
});
