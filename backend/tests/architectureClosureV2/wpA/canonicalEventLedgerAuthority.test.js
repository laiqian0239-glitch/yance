'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
const authorityPath = path.join(repoRoot, 'backend', 'services', 'canonicalEventLedgerAuthority.js');
const { acquireAuthorityWriteHost } = require('../../../services/authorityWriteHost');
const { AuthorityTransactionCoordinator } = require('../../../services/authorityTransactionCoordinator');
const { SqliteConnectionBroker } = require('../../../lib/sqliteConnectionBroker');
const { createPlatformCoreRepository } = require('../../../repositories/platformCoreRepository');

function loadA4() {
  assert.ok(
    fs.existsSync(authorityPath),
    'backend/services/canonicalEventLedgerAuthority.js must exist before A4 can be green'
  );
  delete require.cache[require.resolve(authorityPath)];
  const loaded = require(authorityPath);
  assert.equal(
    typeof loaded.CanonicalEventLedgerAuthority,
    'function',
    'canonicalEventLedgerAuthority.js must export CanonicalEventLedgerAuthority'
  );
  return loaded;
}

function createHarness(prefix = 'yance-acv2-a4-') {
  const { CanonicalEventLedgerAuthority } = loadA4();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const dbPath = path.join(root, 'yance-r32.db');
  const host = acquireAuthorityWriteHost({ dbPath, instanceId: 'a4-ledger-host' });
  const broker = new SqliteConnectionBroker({ dbPath, authorityWriteHostCapability: host.capability });
  const store = broker.open();
  const published = [];
  const evidence = [];
  const coordinator = new AuthorityTransactionCoordinator({
    store,
    clock: () => 1_700_000_000_000,
    eventBus: { publish: (type, payload) => published.push({ type, payload }) }
  });
  const authority = new CanonicalEventLedgerAuthority({
    coordinator,
    store,
    clock: () => 1_700_000_000_000,
    evidenceRecorder: record => evidence.push(record)
  });
  const repository = createPlatformCoreRepository({ storeProvider: () => store });

  return {
    root,
    dbPath,
    host,
    broker,
    store,
    authority,
    repository,
    evidence,
    published,
    close() {
      try { broker.checkpointAndClose(); } catch (_) {}
      try { host.release(); } catch (_) {}
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  };
}

function appendInput(overrides = {}) {
  return {
    commandId: 'command:a4:1',
    idempotencyKey: 'idempotency:a4:1',
    aggregateType: 'DomainEvent',
    aggregateId: 'conversation:1',
    expectedVersion: 0,
    actor: { actorType: 'system', actorId: 'a4-test' },
    traceId: 'trace:a4:1',
    correlationId: '',
    causationId: '',
    eventId: 'event:a4:1',
    eventType: 'message.received',
    schemaVersion: 1,
    payloadClassification: 'BUSINESS_CONTENT',
    occurredAt: '2026-08-02T09:00:00.000Z',
    payload: { text: 'private business body', metadata: { locale: 'de' } },
    platform: 'telegram',
    sourceAccountId: 'tg-1',
    generation: 1,
    redactionVersion: 'classification-v1',
    retentionClass: 'ACTIVE_REPLAY',
    ledgerSegmentId: 'segment-active-v1',
    ...overrides
  };
}

function count(db, table) {
  return Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()?.count || 0);
}

test('canonical authority is the only append path and keeps business payload replayable without copying it into Evidence', () => {
  const harness = createHarness();
  try {
    const input = appendInput();
    const result = harness.authority.append(input);

    assert.equal(result.authority, 'CanonicalEventLedgerAuthority');
    assert.equal(result.created, true);
    assert.equal(result.event.eventId, input.eventId);
    assert.equal(count(harness.store.db, 'canonical_event_headers'), 1);
    assert.equal(count(harness.store.db, 'authority_payload_store'), 1);
    assert.equal(count(harness.store.db, 'authority_command_receipts'), 1);
    assert.equal(count(harness.store.db, 'domain_events'), 0, 'legacy domain_events is not a second ledger');

    const replayable = harness.authority.readEvent(input.eventId);
    assert.deepEqual(replayable.payload, input.payload);
    assert.equal(Object.isFrozen(replayable.payload), true);
    assert.equal(Object.isFrozen(replayable.payload.metadata), true);
    assert.throws(() => { replayable.payload.metadata.locale = 'en'; }, TypeError);
    assert.match(replayable.payloadSha256, /^[a-f0-9]{64}$/);

    assert.equal(harness.evidence.length, 1);
    const evidenceText = JSON.stringify(harness.evidence[0]);
    assert.equal(evidenceText.includes('private business body'), false);
    assert.equal(Object.hasOwn(harness.evidence[0], 'payload'), false);
    assert.equal(Object.hasOwn(harness.evidence[0], 'canonicalJson'), false);
    assert.equal(harness.evidence[0].eventId, input.eventId);
    assert.equal(harness.evidence[0].payloadSha256, replayable.payloadSha256);
  } finally {
    harness.close();
  }
});

test('caller-supplied payload hash mismatch fails before any authoritative mutation', () => {
  const harness = createHarness('yance-acv2-a4-hash-');
  try {
    assert.throws(
      () => harness.authority.append(appendInput({ payloadSha256: '0'.repeat(64) })),
      error => error?.code === 'CANONICAL_EVENT_PAYLOAD_HASH_MISMATCH'
    );
    assert.equal(count(harness.store.db, 'canonical_event_headers'), 0);
    assert.equal(count(harness.store.db, 'authority_payload_store'), 0);
    assert.equal(count(harness.store.db, 'authority_command_receipts'), 0);
  } finally {
    harness.close();
  }
});

test('duplicate aggregate version and committed header or payload mutation fail closed', () => {
  const harness = createHarness('yance-acv2-a4-version-');
  try {
    harness.authority.append(appendInput());
    assert.throws(
      () => harness.authority.append(appendInput({
        commandId: 'command:a4:2',
        idempotencyKey: 'idempotency:a4:2',
        eventId: 'event:a4:2'
      })),
      error => error?.code === 'AUTHORITY_AGGREGATE_VERSION_CONFLICT'
    );
    assert.equal(count(harness.store.db, 'canonical_event_headers'), 1);

    assert.throws(
      () => harness.store.db.prepare(
        "UPDATE canonical_event_headers SET event_type='message.changed' WHERE event_id=?"
      ).run('event:a4:1'),
      /append-only/i
    );
    assert.throws(
      () => harness.store.db.prepare(
        "UPDATE authority_payload_store SET canonical_json='{}' WHERE payload_id=?"
      ).run('payload:event:a4:1'),
      /append-only|active payload|CANONICAL_EVENT/i
    );
  } finally {
    harness.close();
  }
});

test('legacy repository exposes no direct event append surface after canonical closure', () => {
  const harness = createHarness('yance-acv2-a4-direct-');
  try {
    assert.equal(typeof harness.repository.insertDomainEvent, 'undefined');
    assert.equal(count(harness.store.db, 'domain_events'), 0);
    assert.equal(count(harness.store.db, 'canonical_event_headers'), 0);
  } finally {
    harness.close();
  }
});

test('authority input rejects unknown, symbol and accessor fields without executing getters', () => {
  const harness = createHarness('yance-acv2-a4-shape-');
  try {
    let getterExecuted = false;
    const accessorInput = appendInput();
    Object.defineProperty(accessorInput, 'payload', {
      enumerable: true,
      get() {
        getterExecuted = true;
        return { text: 'must not execute' };
      }
    });
    assert.throws(
      () => harness.authority.append(accessorInput),
      error => error?.code === 'CANONICAL_EVENT_INPUT_ACCESSOR_FORBIDDEN'
    );
    assert.equal(getterExecuted, false);

    assert.throws(
      () => harness.authority.append({ ...appendInput(), unexpectedAuthorityField: true }),
      error => error?.code === 'CANONICAL_EVENT_INPUT_FIELD_UNREGISTERED'
    );

    const symbolInput = appendInput();
    symbolInput[Symbol('hidden')] = 'hidden-state';
    assert.throws(
      () => harness.authority.append(symbolInput),
      error => error?.code === 'CANONICAL_EVENT_INPUT_SYMBOL_KEY_FORBIDDEN'
    );
    assert.equal(count(harness.store.db, 'canonical_event_headers'), 0);
  } finally {
    harness.close();
  }
});

test('scoped external event identity cannot be bypassed with different explicit idempotency and aggregate ids', () => {
  const harness = createHarness('yance-acv2-a4-external-');
  try {
    harness.authority.append(appendInput({
      commandId: 'command:a4:external:1',
      idempotencyKey: 'idempotency:a4:external:1',
      aggregateId: 'caller-aggregate:one',
      eventId: 'event:a4:external:1',
      externalEventId: 'telegram-update-77'
    }));
    assert.throws(
      () => harness.authority.append(appendInput({
        commandId: 'command:a4:external:2',
        idempotencyKey: 'idempotency:a4:external:2',
        aggregateId: 'caller-aggregate:two',
        eventId: 'event:a4:external:2',
        externalEventId: 'telegram-update-77'
      })),
      error => error?.code === 'CANONICAL_EVENT_EXTERNAL_IDENTITY_CONFLICT'
        || error?.code === 'AUTHORITY_AGGREGATE_VERSION_CONFLICT'
    );
    assert.equal(count(harness.store.db, 'canonical_event_headers'), 1);
  } finally {
    harness.close();
  }
});
