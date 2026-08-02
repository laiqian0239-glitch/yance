'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
const hostModulePath = path.join(repoRoot, 'backend', 'services', 'authorityWriteHost.js');
const migrationPath = path.join(repoRoot, 'backend', 'migrations', 'architectureClosureV2WpA.js');
const { SqliteConnectionBroker } = require('../../../lib/sqliteConnectionBroker');
const roleGuard = require('../../../lib/runtimeRoleGuard');
const { SCHEMA_VERSION } = require('../../../lib/r32SqliteStore');

function tempDb(prefix = 'yance-acv2-a1-') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return { root, dbPath: path.join(root, 'yance-r32.db') };
}

function cleanup(root) {
  fs.rmSync(root, { recursive: true, force: true });
}

function loadHostModule() {
  if (!fs.existsSync(hostModulePath)) return null;
  return require(hostModulePath);
}

function tableNames(db) {
  return new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => String(row.name)));
}

function withEnv(values, work) {
  const previous = {};
  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key];
    if (value == null) delete process.env[key];
    else process.env[key] = String(value);
  }
  try { return work(); }
  finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function requireA1() {
  const authority = loadHostModule();
  assert.ok(authority, 'backend/services/authorityWriteHost.js must exist before A1 can be green');
  assert.equal(typeof authority.acquireAuthorityWriteHost, 'function');
  assert.equal(typeof authority.assertCurrentAuthorityWriteHostToken, 'function');
  return authority;
}

test('A1 registers Schema 21 and the AuthorityWriteHost public boundary', () => {
  const authority = loadHostModule();
  assert.ok(fs.existsSync(migrationPath), 'Schema 21 migration is missing');
  assert.ok(authority, 'AuthorityWriteHost service is missing');
  assert.equal(SCHEMA_VERSION, 21);
  assert.equal(typeof authority?.acquireAuthorityWriteHost, 'function');
  assert.equal(typeof authority?.assertCurrentAuthorityWriteHostToken, 'function');
});

test('primary SQLite process roles fail closed for workers, probes, utilities and unknown roles', () => {
  assert.equal(typeof roleGuard.assertPrimarySqliteHost, 'function');
  for (const role of [
    'model-execution-worker',
    'channel-protocol-worker',
    'media-worker',
    'uat-probe',
    'utility-process',
    'renderer',
    'secondary-backend',
    'unknown-role'
  ]) {
    withEnv({ YANCE_PROCESS_ROLE: role, YANCE_SQLITE_ACCESS: null }, () => {
      assert.throws(
        () => roleGuard.assertPrimarySqliteHost(`test:${role}`),
        error => error?.code === 'PRIMARY_SQLITE_HOST_ROLE_FORBIDDEN'
      );
    });
  }
});

test('SqliteConnectionBroker requires a genuine externally acquired host capability', () => {
  const authority = requireA1();
  const { root, dbPath } = tempDb();
  let host;
  let broker;
  try {
    assert.throws(
      () => new SqliteConnectionBroker({ dbPath }),
      error => error?.code === 'AUTHORITY_WRITE_HOST_CAPABILITY_REQUIRED'
    );
    assert.throws(
      () => new SqliteConnectionBroker({ dbPath, authorityWriteHostCapability: Object.freeze({}) }),
      error => error?.code === 'AUTHORITY_WRITE_HOST_CAPABILITY_INVALID'
    );
    host = authority.acquireAuthorityWriteHost({ dbPath, instanceId: 'a1-explicit-host' });
    broker = new SqliteConnectionBroker({ dbPath, authorityWriteHostCapability: host.capability });
    const snapshot = broker.snapshot();
    assert.equal(snapshot.owner, 'AuthorityWriteHost');
    assert.equal(snapshot.authorityWriteHostCapability.hostGeneration, 1);
    assert.equal(snapshot.authorityWriteHostCapability.fencingToken, 1);
  } finally {
    try { broker?.close(); } catch (_) {}
    try { host?.close(); } catch (_) {}
    cleanup(root);
  }
});

test('fresh database bootstrap and Schema 20 upgrade both converge to the complete Schema 21 object set', () => {
  const authority = requireA1();
  const required = new Set([
    'authority_write_host_lease',
    'canonical_event_headers',
    'authority_payload_store',
    'event_type_registry',
    'authority_command_receipts',
    'projection_checkpoints_v2',
    'ledger_segments',
    'ledger_snapshots'
  ]);

  for (const mode of ['fresh', 'schema20']) {
    const { root, dbPath } = tempDb(`yance-acv2-a1-${mode}-`);
    let host;
    let broker;
    try {
      if (mode === 'schema20') {
        const seed = new DatabaseSync(dbPath);
        seed.exec(`
          CREATE TABLE r32_meta(key TEXT PRIMARY KEY,value_json TEXT NOT NULL,updated_at TEXT NOT NULL) STRICT;
          INSERT INTO r32_meta(key,value_json,updated_at) VALUES
            ('schema_version','20','2026-08-02T00:00:00.000Z'),
            ('schemaVersion','20','2026-08-02T00:00:00.000Z');
          CREATE TABLE r32_schema_migrations(
            migration_id TEXT PRIMARY KEY,target_schema_version INTEGER NOT NULL,status TEXT NOT NULL,
            checksum TEXT NOT NULL DEFAULT '',started_at TEXT NOT NULL,completed_at TEXT NOT NULL DEFAULT '',
            report_json TEXT NOT NULL DEFAULT '{}'
          ) STRICT;
        `);
        seed.close();
      }
      host = authority.acquireAuthorityWriteHost({ dbPath, instanceId: `host-${mode}` });
      broker = new SqliteConnectionBroker({ dbPath, authorityWriteHostCapability: host.capability });
      const store = broker.open();
      assert.equal(store.getMeta('schema_version'), 21);
      const names = tableNames(store.db);
      for (const name of required) assert.equal(names.has(name), true, `${mode}:${name}`);
      const migration = store.db.prepare("SELECT status,checksum FROM r32_schema_migrations WHERE migration_id='021_architecture_closure_v2_wp_a'").get();
      assert.equal(migration?.status, 'completed');
      assert.match(String(migration?.checksum || ''), /^[a-f0-9]{64}$/);
    } finally {
      try { broker?.close(); } catch (_) {}
      try { host?.close(); } catch (_) {}
      cleanup(root);
    }
  }
});

test('takeover increments host generation and fencing token and rejects the old host inside BEGIN IMMEDIATE', () => {
  const authority = requireA1();
  const { root, dbPath } = tempDb();
  let hostA;
  let hostB;
  let brokerA;
  let brokerB;
  try {
    hostA = authority.acquireAuthorityWriteHost({
      dbPath,
      instanceId: 'host-a',
      ownershipPid: 41001,
      ownershipProcessIdentity: 'test-host-a',
      ownershipPidAlive: pid => pid === 41001
    });
    brokerA = new SqliteConnectionBroker({ dbPath, authorityWriteHostCapability: hostA.capability });
    const storeA = brokerA.open();
    const tokenA = hostA.tokenSnapshot();

    hostA.releaseStartupClaimForTests();
    hostB = authority.acquireAuthorityWriteHost({
      dbPath,
      instanceId: 'host-b',
      ownershipPid: 41002,
      ownershipProcessIdentity: 'test-host-b',
      ownershipPidAlive: () => false
    });
    brokerB = new SqliteConnectionBroker({ dbPath, authorityWriteHostCapability: hostB.capability });
    brokerB.open();
    const tokenB = hostB.tokenSnapshot();

    assert.equal(tokenB.hostGeneration, tokenA.hostGeneration + 1);
    assert.equal(tokenB.fencingToken, tokenA.fencingToken + 1);
    assert.throws(
      () => storeA.transaction(() => storeA.setMeta('stale_write_must_not_commit', true)),
      error => error?.code === 'AUTHORITY_WRITE_HOST_FENCED'
    );
    assert.equal(storeA.getMeta('stale_write_must_not_commit', null), null);
  } finally {
    try { brokerB?.close(); } catch (_) {}
    try { hostB?.close(); } catch (_) {}
    try { brokerA?.close(); } catch (_) {}
    try { hostA?.close(); } catch (_) {}
    cleanup(root);
  }
});

test('clock forward and backward jumps never restore an old host token', () => {
  const authority = requireA1();
  const { root, dbPath } = tempDb();
  let logicalClock = 1_700_000_000_000;
  let hostA;
  let hostB;
  let brokerA;
  try {
    hostA = authority.acquireAuthorityWriteHost({
      dbPath,
      instanceId: 'clock-a',
      clock: () => logicalClock,
      ownershipPid: 42001,
      ownershipProcessIdentity: 'clock-a',
      ownershipPidAlive: pid => pid === 42001
    });
    brokerA = new SqliteConnectionBroker({ dbPath, authorityWriteHostCapability: hostA.capability });
    const storeA = brokerA.open();
    hostA.releaseStartupClaimForTests();

    logicalClock += 86_400_000 * 30;
    hostB = authority.acquireAuthorityWriteHost({
      dbPath,
      instanceId: 'clock-b',
      clock: () => logicalClock,
      ownershipPid: 42002,
      ownershipProcessIdentity: 'clock-b',
      ownershipPidAlive: () => false
    });
    logicalClock -= 86_400_000 * 365;

    assert.throws(
      () => storeA.transaction(() => storeA.setMeta('clock_jump_stale_write', true)),
      error => error?.code === 'AUTHORITY_WRITE_HOST_FENCED'
    );
  } finally {
    try { hostB?.close(); } catch (_) {}
    try { brokerA?.close(); } catch (_) {}
    try { hostA?.close(); } catch (_) {}
    cleanup(root);
  }
});

test('bootstrap checksum corruption and pre-CAS faults fail closed and release startup ownership', () => {
  const authority = requireA1();
  const corrupt = tempDb('yance-acv2-a1-corrupt-');
  try {
    const db = new DatabaseSync(corrupt.dbPath);
    db.exec(`
      CREATE TABLE authority_write_host_bootstrap_metadata(
        singleton_id INTEGER PRIMARY KEY CHECK(singleton_id=1),
        checksum TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;
      INSERT INTO authority_write_host_bootstrap_metadata(singleton_id,checksum,created_at)
      VALUES(1,'corrupt-checksum','2026-08-02T00:00:00.000Z');
    `);
    db.close();
    assert.throws(
      () => authority.acquireAuthorityWriteHost({ dbPath: corrupt.dbPath, instanceId: 'corrupt' }),
      error => error?.code === 'AUTHORITY_WRITE_HOST_BOOTSTRAP_CHECKSUM_MISMATCH'
    );
  } finally { cleanup(corrupt.root); }

  const fault = tempDb('yance-acv2-a1-fault-');
  let recovered;
  try {
    assert.throws(
      () => authority.acquireAuthorityWriteHost({
        dbPath: fault.dbPath,
        instanceId: 'faulting-host',
        testFaultAt: 'AFTER_DB_OPEN_BEFORE_HOST_CAS'
      }),
      error => error?.code === 'AUTHORITY_WRITE_HOST_TEST_FAULT'
    );
    recovered = authority.acquireAuthorityWriteHost({ dbPath: fault.dbPath, instanceId: 'recovered-host' });
    assert.equal(recovered.tokenSnapshot().hostGeneration, 1);
  } finally {
    try { recovered?.close(); } catch (_) {}
    cleanup(fault.root);
  }
});
