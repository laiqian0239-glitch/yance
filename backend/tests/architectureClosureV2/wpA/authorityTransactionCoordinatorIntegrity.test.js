'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { acquireAuthorityWriteHost } = require('../../../services/authorityWriteHost');
const { SqliteConnectionBroker } = require('../../../lib/sqliteConnectionBroker');
const {
  AuthorityTransactionCoordinator,
  createProjectorDatabaseCapability,
  eventContentSha256
} = require('../../../services/authorityTransactionCoordinator');
const { createAuthorityCommandEnvelope } = require('../../../services/authorityCommandProtocol');

function tempDb() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-acv2-a3-integrity-'));
  return { root, dbPath: path.join(root, 'yance-r32.db') };
}

function command() {
  return createAuthorityCommandEnvelope({
    commandId: 'cmd-integrity-1',
    authorityScope: 'IntegrityAuthority',
    commandType: 'integrity.aggregate.update',
    idempotencyKey: 'integrity:aggregate-1:update-1',
    aggregateType: 'IntegrityAggregate',
    aggregateId: 'aggregate-1',
    expectedVersion: 0,
    actor: { actorType: 'reviewer', actorId: 'independent-review' },
    traceId: 'trace-integrity-1',
    correlationId: 'correlation-integrity-1',
    causationId: '',
    payload: { requested: true }
  });
}

function event(overrides = {}) {
  return {
    eventId: 'event-integrity-1',
    eventType: 'integrity.aggregate.updated',
    schemaVersion: 1,
    payloadClassification: 'BUSINESS_CONTENT',
    occurredAt: '2026-08-02T00:00:00.000Z',
    platform: 'integrity-platform',
    sourceAccountId: 'source-integrity-1',
    generation: 1,
    redactionVersion: 'classification-v1',
    retentionClass: 'ACTIVE_REPLAY',
    ledgerSegmentId: 'segment-active-v1',
    payload: { value: 'stable' },
    ...overrides
  };
}

function projector() {
  return {
    projectorId: 'integrity-projector',
    projectorVersion: 'v1',
    apply({ db, aggregateId, aggregateVersion, payload }) {
      db.prepare(`INSERT INTO acv2_integrity_projection(
        aggregate_id,aggregate_version,value
      ) VALUES(?,?,?)`).run(aggregateId, aggregateVersion, payload.value);
      return { stateHash: 'f'.repeat(64), result: { value: payload.value } };
    }
  };
}

function harness(options = {}) {
  const { root, dbPath } = tempDb();
  const host = acquireAuthorityWriteHost({ dbPath, instanceId: 'integrity-host' });
  const broker = new SqliteConnectionBroker({ dbPath, authorityWriteHostCapability: host.capability });
  const store = broker.open();
  store.db.exec(`CREATE TABLE acv2_integrity_projection(
    aggregate_id TEXT PRIMARY KEY,
    aggregate_version INTEGER NOT NULL,
    value TEXT NOT NULL
  ) STRICT;`);
  const observations = [];
  const coordinator = new AuthorityTransactionCoordinator({
    store,
    clock: () => 1_700_000_000_000,
    eventBus: options.eventBus,
    onTransactionTelemetry: observation => observations.push(observation)
  });
  return {
    root,
    host,
    broker,
    store,
    coordinator,
    observations,
    close() {
      try { broker.close(); } catch (_) {}
      try { host.close(); } catch (_) {}
      fs.rmSync(root, { recursive: true, force: true });
    }
  };
}

test('event classification and retention policy are part of the idempotent event content hash', () => {
  const h = harness();
  try {
    const first = h.coordinator.execute({ command: command(), event: event(), projector: projector() });
    assert.equal(first.replayed, false);
    const receipt = h.store.db.prepare('SELECT command_content_sha256,event_content_sha256,content_hash_version FROM authority_command_receipts WHERE command_id=?').get('cmd-integrity-1');
    assert.match(receipt.command_content_sha256, /^[a-f0-9]{64}$/);
    assert.match(receipt.event_content_sha256, /^[a-f0-9]{64}$/);
    assert.equal(receipt.content_hash_version, 1);

    for (const changedEvent of [
      event({ payloadClassification: 'PUBLIC_METADATA' }),
      event({ retentionClass: 'SHORT_LIVED' })
    ]) {
      assert.throws(
        () => h.coordinator.execute({ command: command(), event: changedEvent, projector: projector() }),
        error => error?.code === 'AUTHORITY_COMMAND_IDEMPOTENCY_CONFLICT'
          && error?.existingEventContentSha256 !== error?.incomingEventContentSha256
      );
    }
    assert.equal(h.store.db.prepare('SELECT COUNT(*) AS count FROM canonical_event_headers').get().count, 1);
  } finally { h.close(); }
});

test('legacy receipts without a versioned event content hash fail closed instead of guessing historical semantics', () => {
  const h = harness();
  try {
    const envelope = command();
    const existing = {
      command_id: envelope.commandId,
      authority_scope: envelope.authorityScope,
      idempotency_key: envelope.idempotencyKey,
      command_content_sha256: envelope.contentSha256,
      event_content_sha256: '',
      content_hash_version: 0,
      result_json: JSON.stringify({ commandContentSha256: envelope.contentSha256, receipt: { status: 'COMMITTED' } })
    };
    assert.throws(
      () => h.coordinator.assertIdempotency(existing, envelope, 'c'.repeat(64)),
      error => error?.code === 'AUTHORITY_COMMAND_EVENT_CONTENT_UNVERIFIABLE'
        && error?.existingEventContentSha256 === ''
        && error?.existingContentHashVersion === 0
        && error?.incomingEventContentSha256 === 'c'.repeat(64)
    );
    assert.equal(h.store.db.prepare('SELECT COUNT(*) AS count FROM canonical_event_headers').get().count, 0);
  } finally { h.close(); }
});

test('authority-assigned event time has stable idempotent semantics across concurrent clock values', () => {
  const base = {
    eventId: 'event-time-stability',
    eventType: 'integrity.time.assigned',
    schemaVersion: 1,
    payloadClassification: 'BUSINESS_CONTENT',
    payloadSha256: 'd'.repeat(64),
    platform: 'integrity-platform',
    sourceAccountId: 'source-integrity-1',
    generation: 1,
    redactionVersion: 'classification-v1',
    retentionClass: 'ACTIVE_REPLAY',
    ledgerSegmentId: 'segment-active-v1'
  };
  const first = eventContentSha256({
    ...base,
    occurredAt: '2026-08-03T00:00:00.000Z',
    occurredAtAuthorityAssigned: true
  });
  const concurrent = eventContentSha256({
    ...base,
    occurredAt: '2026-08-03T00:00:01.000Z',
    occurredAtAuthorityAssigned: true
  });
  const explicit = eventContentSha256({
    ...base,
    occurredAt: '2026-08-03T00:00:01.000Z',
    occurredAtAuthorityAssigned: false
  });
  assert.equal(concurrent, first);
  assert.notEqual(explicit, first);
});

test('projector SQL capability rejects nondeterministic functions extension loading and SQLite internal tables', () => {
  let prepared = 0;
  const capability = createProjectorDatabaseCapability({
    prepare() {
      prepared += 1;
      return { run() {}, get() {}, all() {} };
    }
  });
  const forbidden = [
    'SELECT random()',
    'SELECT randomblob(16)',
    'SELECT CURRENT_TIMESTAMP',
    "SELECT datetime('now')",
    "SELECT load_extension('evil')",
    'SELECT * FROM sqlite_sequence'
  ];
  for (const sql of forbidden) {
    assert.throws(
      () => capability.facade.prepare(sql),
      error => error?.code === 'AUTHORITY_PROJECTOR_SQL_NONDETERMINISTIC'
        || error?.code === 'AUTHORITY_PROJECTOR_SQL_FORBIDDEN'
    );
  }
  assert.equal(prepared, 0);
});

test('post-commit notification failure cannot roll back or reinterpret the committed receipt', () => {
  const h = harness({
    eventBus: {
      publish() {
        throw Object.assign(new Error('notification-failure'), { code: 'TEST_NOTIFICATION_FAILURE' });
      }
    }
  });
  try {
    const result = h.coordinator.execute({ command: command(), event: event(), projector: projector() });
    assert.equal(result.status, 'COMMITTED');
    assert.equal(result.notificationPublished, false);
    assert.equal(h.store.db.prepare('SELECT COUNT(*) AS count FROM canonical_event_headers').get().count, 1);
    assert.equal(h.store.db.prepare('SELECT COUNT(*) AS count FROM authority_command_receipts').get().count, 1);
    assert.equal(h.observations.some(row => row.status === 'POST_COMMIT_NOTIFICATION_FAILED' && row.reasonCode === 'TEST_NOTIFICATION_FAILURE'), true);
  } finally { h.close(); }
});
