'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
const coordinatorPath = path.join(repoRoot, 'backend', 'services', 'authorityTransactionCoordinator.js');
const protocolPath = path.join(repoRoot, 'backend', 'services', 'authorityCommandProtocol.js');
const guardPath = path.join(repoRoot, 'backend', 'services', 'externalIoBoundaryGuard.js');
const { acquireAuthorityWriteHost } = require('../../../services/authorityWriteHost');
const { SqliteConnectionBroker } = require('../../../lib/sqliteConnectionBroker');

function loadA3() {
  assert.ok(fs.existsSync(coordinatorPath), 'backend/services/authorityTransactionCoordinator.js must exist before A3 can be green');
  assert.ok(fs.existsSync(protocolPath), 'backend/services/authorityCommandProtocol.js must exist before A3 can be green');
  assert.ok(fs.existsSync(guardPath), 'backend/services/externalIoBoundaryGuard.js must exist before A3 can be green');
  delete require.cache[require.resolve(coordinatorPath)];
  delete require.cache[require.resolve(protocolPath)];
  delete require.cache[require.resolve(guardPath)];
  return {
    ...require(coordinatorPath),
    protocol: require(protocolPath),
    guard: require(guardPath)
  };
}

function tempDb(prefix = 'yance-acv2-a3-') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return { root, dbPath: path.join(root, 'yance-r32.db') };
}

function count(db, table) {
  return Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()?.count || 0);
}

function createHarness(options = {}) {
  const a3 = loadA3();
  const { root, dbPath } = tempDb(options.prefix);
  const host = acquireAuthorityWriteHost({
    dbPath,
    instanceId: options.instanceId || 'coordinator-host',
    ownershipPid: options.ownershipPid,
    ownershipProcessIdentity: options.ownershipProcessIdentity,
    ownershipPidAlive: options.ownershipPidAlive
  });
  const broker = new SqliteConnectionBroker({ dbPath, authorityWriteHostCapability: host.capability });
  const store = broker.open();
  store.db.exec(`CREATE TABLE IF NOT EXISTS acv2_test_projection(
    aggregate_id TEXT PRIMARY KEY,
    aggregate_version INTEGER NOT NULL,
    value TEXT NOT NULL,
    event_id TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;`);
  const published = [];
  const eventBus = {
    publish(type, payload) {
      const receiptExists = Boolean(store.db.prepare('SELECT 1 FROM authority_command_receipts WHERE command_id=?').get(payload.commandId));
      published.push({ type, payload, receiptExistsAtPublish: receiptExists });
      return { type, payload };
    }
  };
  const telemetry = [];
  const coordinator = new a3.AuthorityTransactionCoordinator({
    store,
    eventBus,
    clock: options.clock || (() => 1_700_000_000_000),
    onTransactionTelemetry: observation => telemetry.push(observation)
  });
  return {
    ...a3,
    root,
    dbPath,
    host,
    broker,
    store,
    published,
    telemetry,
    coordinator,
    close() {
      try { broker.close(); } catch (_) {}
      try { host.close(); } catch (_) {}
      fs.rmSync(root, { recursive: true, force: true });
    }
  };
}

function commandInput(overrides = {}) {
  return {
    commandId: 'cmd-1',
    authorityScope: 'TestAuthority',
    commandType: 'test.aggregate.update',
    idempotencyKey: 'test:aggregate-1:update-1',
    aggregateType: 'TestAggregate',
    aggregateId: 'aggregate-1',
    expectedVersion: 0,
    actor: { actorType: 'user', actorId: 'owner' },
    traceId: 'trace-1',
    correlationId: 'correlation-1',
    causationId: '',
    payload: { value: 'first' },
    ...overrides
  };
}

function execution(a3, overrides = {}) {
  const eventPayload = overrides.eventPayload || { value: 'first' };
  const command = a3.protocol.createAuthorityCommandEnvelope(commandInput(overrides.command || {}));
  const event = {
    eventId: overrides.eventId || 'event-1',
    eventType: overrides.eventType || 'test.aggregate.updated',
    schemaVersion: 1,
    payloadClassification: 'BUSINESS_CONTENT',
    occurredAt: '2026-08-02T00:00:00.000Z',
    payload: eventPayload
  };
  const projector = {
    projectorId: 'test-projection',
    projectorVersion: 'v1',
    apply({ db, eventId, aggregateId, aggregateVersion, payload }) {
      if (overrides.externalIoKind) a3.guard.assertExternalIoAllowed(overrides.externalIoKind);
      if (overrides.projectorError) throw overrides.projectorError;
      if (overrides.returnPromise) return Promise.resolve({ stateHash: 'a'.repeat(64) });
      db.prepare(`INSERT INTO acv2_test_projection(
        aggregate_id,aggregate_version,value,event_id,updated_at
      ) VALUES(?,?,?,?,?)
      ON CONFLICT(aggregate_id) DO UPDATE SET
        aggregate_version=excluded.aggregate_version,
        value=excluded.value,
        event_id=excluded.event_id,
        updated_at=excluded.updated_at`).run(
        aggregateId,
        aggregateVersion,
        String(payload.value || ''),
        eventId,
        '2026-08-02T00:00:00.000Z'
      );
      return {
        stateHash: 'a'.repeat(64),
        result: { value: String(payload.value || '') }
      };
    }
  };
  return { command, event, projector };
}

test('one command atomically commits event, payload, projection, checkpoint and receipt before publish', () => {
  const h = createHarness();
  try {
    const result = h.coordinator.execute(execution(h));
    assert.equal(result.status, 'COMMITTED');
    assert.equal(result.replayed, false);
    assert.equal(result.commandId, 'cmd-1');
    assert.equal(result.eventId, 'event-1');
    assert.equal(result.aggregateVersion, 1);
    for (const table of [
      'canonical_event_headers',
      'authority_payload_store',
      'authority_command_receipts',
      'projection_checkpoints_v2',
      'acv2_test_projection'
    ]) assert.equal(count(h.store.db, table), 1, table);
    assert.equal(h.published.length, 1);
    assert.equal(h.published[0].type, 'canonical-event:committed');
    assert.equal(h.published[0].receiptExistsAtPublish, true);

    const token = h.host.tokenSnapshot();
    const header = h.store.db.prepare('SELECT host_generation,fencing_token FROM canonical_event_headers WHERE event_id=?').get('event-1');
    const receipt = h.store.db.prepare('SELECT host_generation,fencing_token FROM authority_command_receipts WHERE command_id=?').get('cmd-1');
    assert.deepEqual([header.host_generation, header.fencing_token], [token.hostGeneration, token.fencingToken]);
    assert.deepEqual([receipt.host_generation, receipt.fencing_token], [token.hostGeneration, token.fencingToken]);
    assert.equal(h.telemetry.length, 1);
    assert.equal(h.telemetry[0].status, 'COMMITTED');
  } finally { h.close(); }
});

test('same idempotency and same content returns the original receipt without projection or publish duplication', () => {
  const h = createHarness();
  try {
    const first = h.coordinator.execute(execution(h));
    const second = h.coordinator.execute(execution(h));
    assert.equal(first.replayed, false);
    assert.equal(second.replayed, true);
    assert.equal(second.commandId, first.commandId);
    assert.equal(second.eventId, first.eventId);
    assert.equal(second.aggregateVersion, first.aggregateVersion);
    for (const table of ['canonical_event_headers', 'authority_payload_store', 'authority_command_receipts', 'projection_checkpoints_v2', 'acv2_test_projection']) {
      assert.equal(count(h.store.db, table), 1, table);
    }
    assert.equal(h.published.length, 1);
  } finally { h.close(); }
});

test('same idempotency key with different command content fails closed and preserves the first fact', () => {
  const h = createHarness();
  try {
    h.coordinator.execute(execution(h));
    assert.throws(
      () => h.coordinator.execute(execution(h, {
        command: { payload: { value: 'different' } },
        eventId: 'event-2',
        eventPayload: { value: 'different' }
      })),
      error => error?.code === 'AUTHORITY_COMMAND_IDEMPOTENCY_CONFLICT'
    );
    assert.equal(count(h.store.db, 'canonical_event_headers'), 1);
    assert.equal(h.store.db.prepare('SELECT value FROM acv2_test_projection WHERE aggregate_id=?').get('aggregate-1').value, 'first');
    assert.equal(h.published.length, 1);
  } finally { h.close(); }
});

test('aggregate expected-version conflict is rejected by a conditional SQL mutation', () => {
  const h = createHarness();
  try {
    h.coordinator.execute(execution(h));
    assert.throws(
      () => h.coordinator.execute(execution(h, {
        command: {
          commandId: 'cmd-2',
          idempotencyKey: 'test:aggregate-1:update-2',
          expectedVersion: 0,
          payload: { value: 'second' }
        },
        eventId: 'event-2',
        eventPayload: { value: 'second' }
      })),
      error => error?.code === 'AUTHORITY_AGGREGATE_VERSION_CONFLICT'
        && error?.expectedVersion === 0
        && error?.currentVersion === 1
    );
    assert.equal(count(h.store.db, 'canonical_event_headers'), 1);
    assert.equal(count(h.store.db, 'authority_command_receipts'), 1);
  } finally { h.close(); }
});

test('projector failure rolls back all authoritative rows and publishes no process event', () => {
  const h = createHarness();
  try {
    assert.throws(
      () => h.coordinator.execute(execution(h, { projectorError: new Error('projection-failure') })),
      /projection-failure/
    );
    for (const table of ['canonical_event_headers', 'authority_payload_store', 'authority_command_receipts', 'projection_checkpoints_v2', 'acv2_test_projection']) {
      assert.equal(count(h.store.db, table), 0, table);
    }
    assert.equal(h.published.length, 0);
    assert.equal(h.telemetry.at(-1)?.status, 'ROLLED_BACK');
  } finally { h.close(); }
});

test('async projector callbacks are rejected and cannot commit after transaction return', async () => {
  const h = createHarness();
  try {
    assert.throws(
      () => h.coordinator.execute(execution(h, { returnPromise: true })),
      error => error?.code === 'AUTHORITY_TRANSACTION_ASYNC_CALLBACK_FORBIDDEN'
    );
    await new Promise(resolve => setImmediate(resolve));
    for (const table of ['canonical_event_headers', 'authority_payload_store', 'authority_command_receipts', 'projection_checkpoints_v2', 'acv2_test_projection']) {
      assert.equal(count(h.store.db, table), 0, table);
    }
    assert.equal(h.published.length, 0);
  } finally { h.close(); }
});

test('external IO guard aborts the same write transaction without partial rows', () => {
  const h = createHarness();
  try {
    assert.throws(
      () => h.coordinator.execute(execution(h, { externalIoKind: 'network' })),
      error => error?.code === 'AUTHORITY_TRANSACTION_EXTERNAL_IO_FORBIDDEN'
    );
    for (const table of ['canonical_event_headers', 'authority_payload_store', 'authority_command_receipts', 'projection_checkpoints_v2', 'acv2_test_projection']) {
      assert.equal(count(h.store.db, table), 0, table);
    }
    assert.equal(h.published.length, 0);
  } finally { h.close(); }
});

test('an old coordinator is fenced after takeover before any command mutation can commit', () => {
  const h = createHarness({
    instanceId: 'old-host',
    ownershipPid: 51001,
    ownershipProcessIdentity: 'old-host',
    ownershipPidAlive: pid => pid === 51001
  });
  let nextHost;
  let nextBroker;
  try {
    h.host.releaseStartupClaimForTests();
    nextHost = acquireAuthorityWriteHost({
      dbPath: h.dbPath,
      instanceId: 'new-host',
      ownershipPid: 51002,
      ownershipProcessIdentity: 'new-host',
      ownershipPidAlive: () => false
    });
    nextBroker = new SqliteConnectionBroker({ dbPath: h.dbPath, authorityWriteHostCapability: nextHost.capability });
    nextBroker.open();

    assert.throws(
      () => h.coordinator.execute(execution(h)),
      error => error?.code === 'AUTHORITY_WRITE_HOST_FENCED'
    );
    assert.equal(count(nextBroker.getDb(), 'canonical_event_headers'), 0);
    assert.equal(count(nextBroker.getDb(), 'authority_command_receipts'), 0);
    assert.equal(h.published.length, 0);
  } finally {
    try { nextBroker?.close(); } catch (_) {}
    try { nextHost?.close(); } catch (_) {}
    h.close();
  }
});
