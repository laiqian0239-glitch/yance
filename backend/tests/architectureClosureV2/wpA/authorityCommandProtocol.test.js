'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
const modulePath = path.join(repoRoot, 'backend', 'services', 'authorityCommandProtocol.js');

function loadProtocol() {
  assert.ok(fs.existsSync(modulePath), 'backend/services/authorityCommandProtocol.js must exist before A3 can be green');
  delete require.cache[require.resolve(modulePath)];
  return require(modulePath);
}

function command(overrides = {}) {
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
    payload: { nested: { beta: 2, alpha: 1 }, value: 'first' },
    ...overrides
  };
}

test('authority command envelope is exact, deeply frozen and content-addressed', () => {
  const { COMMAND_PROTOCOL_VERSION, createAuthorityCommandEnvelope, assertAuthorityCommandEnvelope } = loadProtocol();
  const envelope = createAuthorityCommandEnvelope(command());
  assert.equal(COMMAND_PROTOCOL_VERSION, 1);
  assert.equal(envelope.protocolVersion, 1);
  assert.match(envelope.contentSha256, /^[a-f0-9]{64}$/);
  assert.equal(Object.isFrozen(envelope), true);
  assert.equal(Object.isFrozen(envelope.actor), true);
  assert.equal(Object.isFrozen(envelope.payload), true);
  assert.equal(Object.isFrozen(envelope.payload.nested), true);
  assert.equal(assertAuthorityCommandEnvelope(envelope), envelope);
});

test('command fingerprint is deterministic across object key order but changes with semantic content', () => {
  const { createAuthorityCommandEnvelope, commandFingerprint } = loadProtocol();
  const left = command({ payload: { z: null, nested: { beta: 2, alpha: 1 }, value: 'first' } });
  const right = command({ payload: { value: 'first', nested: { alpha: 1, beta: 2 }, z: null } });
  assert.equal(commandFingerprint(left), commandFingerprint(right));
  assert.equal(createAuthorityCommandEnvelope(left).contentSha256, createAuthorityCommandEnvelope(right).contentSha256);
  assert.notEqual(commandFingerprint(left), commandFingerprint(command({ payload: { value: 'changed' } })));
});

test('unknown, symbol, accessor and prototype-mutation fields fail closed without getter execution', () => {
  const { createAuthorityCommandEnvelope } = loadProtocol();
  assert.throws(
    () => createAuthorityCommandEnvelope(command({ temporaryBypass: true })),
    error => error?.code === 'AUTHORITY_COMMAND_FIELD_UNREGISTERED' && error?.field === 'temporaryBypass'
  );

  const symbol = command();
  symbol[Symbol('hidden')] = true;
  assert.throws(
    () => createAuthorityCommandEnvelope(symbol),
    error => error?.code === 'AUTHORITY_COMMAND_SYMBOL_KEY_FORBIDDEN'
  );

  let reads = 0;
  const accessor = command();
  Object.defineProperty(accessor, 'payload', {
    enumerable: true,
    get() { reads += 1; throw new Error('must not execute'); }
  });
  assert.throws(
    () => createAuthorityCommandEnvelope(accessor),
    error => error?.code === 'AUTHORITY_COMMAND_ACCESSOR_FORBIDDEN'
  );
  assert.equal(reads, 0);

  const pollutedPayload = { value: 'safe' };
  Object.defineProperty(pollutedPayload, '__proto__', { enumerable: true, value: { polluted: true } });
  assert.throws(
    () => createAuthorityCommandEnvelope(command({ payload: pollutedPayload })),
    error => error?.code === 'AUTHORITY_COMMAND_PAYLOAD_INVALID'
  );
  assert.equal(Object.prototype.polluted, undefined);
});

test('required identifiers and aggregate version are fail-closed and bounded', () => {
  const { createAuthorityCommandEnvelope } = loadProtocol();
  for (const field of ['commandId', 'authorityScope', 'commandType', 'idempotencyKey', 'aggregateType', 'aggregateId', 'traceId']) {
    assert.throws(
      () => createAuthorityCommandEnvelope(command({ [field]: '' })),
      error => error?.code === 'AUTHORITY_COMMAND_FIELD_REQUIRED' && error?.field === field
    );
  }
  for (const expectedVersion of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(
      () => createAuthorityCommandEnvelope(command({ expectedVersion })),
      error => error?.code === 'AUTHORITY_COMMAND_EXPECTED_VERSION_INVALID'
    );
  }
  assert.throws(
    () => createAuthorityCommandEnvelope(command({ idempotencyKey: 'x'.repeat(2049) })),
    error => error?.code === 'AUTHORITY_COMMAND_FIELD_TOO_LONG' && error?.field === 'idempotencyKey'
  );
});

test('a forged envelope with a recomputed-looking digest is rejected', () => {
  const { createAuthorityCommandEnvelope, assertAuthorityCommandEnvelope } = loadProtocol();
  const envelope = createAuthorityCommandEnvelope(command());
  const forged = Object.freeze({ ...envelope, payload: Object.freeze({ value: 'forged' }) });
  assert.throws(
    () => assertAuthorityCommandEnvelope(forged),
    error => error?.code === 'AUTHORITY_COMMAND_CONTENT_HASH_MISMATCH'
  );
});
