'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { acquireAuthorityWriteHost } = require('../../../services/authorityWriteHost');
const { SqliteConnectionBroker } = require('../../../lib/sqliteConnectionBroker');
const { AuthorityTransactionCoordinator } = require('../../../services/authorityTransactionCoordinator');
const { createAuthorityCommandEnvelope } = require('../../../services/authorityCommandProtocol');

function tempDb() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-acv2-a3-review-'));
  return { root, dbPath: path.join(root, 'yance-r32.db') };
}

function command(overrides = {}) {
  return createAuthorityCommandEnvelope({
    commandId: 'cmd-review-1',
    authorityScope: 'ReviewAuthority',
    commandType: 'review.aggregate.update',
    idempotencyKey: 'review:aggregate-1:update-1',
    aggregateType: 'ReviewAggregate',
    aggregateId: 'aggregate-1',
    expectedVersion: 0,
    actor: { actorType: 'reviewer', actorId: 'independent-source-review' },
    traceId: 'trace-review-1',
    correlationId: 'correlation-review-1',
    causationId: 'cause-review-1',
    payload: { requested: true },
    ...overrides
  });
}

function event(overrides = {}) {
  return {
    eventId: 'event-review-1',
    eventType: 'review.aggregate.updated',
    schemaVersion: 1,
    payloadClassification: 'BUSINESS_CONTENT',
    occurredAt: '2026-08-02T00:00:00.000Z',
    platform: 'review-platform',
    sourceAccountId: 'source-account-review',
    generation: 3,
    redactionVersion: 'review-redaction-v1',
    retentionClass: 'ACTIVE_REPLAY',
    ledgerSegmentId: 'segment-active-v1',
    payload: { value: 'original', nested: { immutable: true } },
    ...overrides
  };
}

function createHarness() {
  const { root, dbPath } = tempDb();
  const host = acquireAuthorityWriteHost({ dbPath, instanceId: 'a3-review-host' });
  const broker = new SqliteConnectionBroker({ dbPath, authorityWriteHostCapability: host.capability });
  const store = broker.open();
  store.db.exec(`CREATE TABLE IF NOT EXISTS acv2_review_projection(
    aggregate_id TEXT PRIMARY KEY,
    aggregate_version INTEGER NOT NULL,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;`);
  const coordinator = new AuthorityTransactionCoordinator({ store, clock: () => 1_700_000_000_000 });
  return {
    root,
    dbPath,
    host,
    broker,
    store,
    coordinator,
    close() {
      try { broker.close(); } catch (_) {}
      try { host.close(); } catch (_) {}
      fs.rmSync(root, { recursive: true, force: true });
    }
  };
}

function successfulProjection(projectorApply) {
  return {
    projectorId: 'review-projector',
    projectorVersion: 'v1',
    apply: projectorApply
  };
}

test('projector receives a transaction-scoped database capability, not the raw primary database', () => {
  const h = createHarness();
  let retainedDb;
  try {
    h.coordinator.execute({
      command: command(),
      event: event(),
      projector: successfulProjection(({ db, aggregateId, aggregateVersion, payload }) => {
        retainedDb = db;
        assert.notEqual(db, h.store.db);
        assert.equal(Object.isFrozen(payload), true);
        assert.equal(Object.isFrozen(payload.nested), true);
        assert.throws(
          () => db.exec('COMMIT'),
          error => error?.code === 'AUTHORITY_PROJECTOR_SQL_FORBIDDEN'
        );
        db.prepare(`INSERT INTO acv2_review_projection(
          aggregate_id,aggregate_version,value,updated_at
        ) VALUES(?,?,?,?)`).run(aggregateId, aggregateVersion, payload.value, '2026-08-02T00:00:00.000Z');
        return { stateHash: 'b'.repeat(64), result: { projected: true } };
      })
    });
    assert.throws(
      () => retainedDb.prepare('SELECT 1'),
      error => error?.code === 'AUTHORITY_PROJECTOR_CAPABILITY_EXPIRED'
    );
  } finally { h.close(); }
});

test('retained projector capability cannot perform a fire-and-forget write after the transaction commits', async () => {
  const h = createHarness();
  let retainedDb;
  try {
    h.coordinator.execute({
      command: command(),
      event: event(),
      projector: successfulProjection(({ db, aggregateId, aggregateVersion, payload }) => {
        retainedDb = db;
        db.prepare(`INSERT INTO acv2_review_projection(
          aggregate_id,aggregate_version,value,updated_at
        ) VALUES(?,?,?,?)`).run(aggregateId, aggregateVersion, payload.value, '2026-08-02T00:00:00.000Z');
        return { stateHash: 'c'.repeat(64), result: {} };
      })
    });

    const error = await new Promise(resolve => {
      setImmediate(() => {
        try {
          retainedDb.prepare("UPDATE acv2_review_projection SET value='late'").run();
          resolve(null);
        } catch (candidate) { resolve(candidate); }
      });
    });
    assert.equal(error?.code, 'AUTHORITY_PROJECTOR_CAPABILITY_EXPIRED');
    assert.equal(h.store.db.prepare('SELECT value FROM acv2_review_projection WHERE aggregate_id=?').get('aggregate-1').value, 'original');
  } finally { h.close(); }
});

test('projector cannot mutate the immutable ledger payload before writing its projection', () => {
  const h = createHarness();
  try {
    assert.throws(
      () => h.coordinator.execute({
        command: command(),
        event: event(),
        projector: successfulProjection(({ payload }) => {
          payload.nested.immutable = false;
          return { stateHash: 'd'.repeat(64), result: {} };
        })
      }),
      error => error instanceof TypeError || error?.code === 'AUTHORITY_TRANSACTION_PAYLOAD_IMMUTABLE'
    );
    assert.equal(h.store.db.prepare('SELECT COUNT(*) AS count FROM canonical_event_headers').get().count, 0);
    assert.equal(h.store.db.prepare('SELECT COUNT(*) AS count FROM authority_payload_store').get().count, 0);
  } finally { h.close(); }
});

test('coordinator persists complete trace, source, payload hash and projector fencing metadata', () => {
  const h = createHarness();
  try {
    const receipt = h.coordinator.execute({
      command: command(),
      event: event(),
      projector: successfulProjection(({ db, aggregateId, aggregateVersion, payload }) => {
        db.prepare(`INSERT INTO acv2_review_projection(
          aggregate_id,aggregate_version,value,updated_at
        ) VALUES(?,?,?,?)`).run(aggregateId, aggregateVersion, payload.value, '2026-08-02T00:00:00.000Z');
        return { stateHash: 'e'.repeat(64), result: {} };
      })
    });
    const header = h.store.db.prepare(`SELECT * FROM canonical_event_headers WHERE event_id=?`).get(receipt.eventId);
    assert.equal(header.trace_id, 'trace-review-1');
    assert.equal(header.platform, 'review-platform');
    assert.equal(header.source_account_id, 'source-account-review');
    assert.equal(header.generation, 3);
    assert.equal(header.redaction_version, 'review-redaction-v1');
    assert.equal(header.canonicalization_version, 1);
    assert.equal(header.writer_authority, 'ReviewAuthority');
    assert.match(header.payload_sha256, /^[a-f0-9]{64}$/);
    assert.ok(Number(header.ledger_sequence) > 0);

    const checkpoint = h.store.db.prepare('SELECT * FROM projection_checkpoints_v2 WHERE projector_id=?').get('review-projector');
    assert.equal(checkpoint.ledger_sequence, header.ledger_sequence);
    assert.equal(checkpoint.lease_owner, h.host.tokenSnapshot().instanceId);
    assert.equal(checkpoint.generation, h.host.tokenSnapshot().hostGeneration);
    assert.equal(checkpoint.fencing_token, h.host.tokenSnapshot().fencingToken);
    assert.equal(checkpoint.output_hash, 'e'.repeat(64));
    assert.equal(checkpoint.lag, 0);
  } finally { h.close(); }
});
