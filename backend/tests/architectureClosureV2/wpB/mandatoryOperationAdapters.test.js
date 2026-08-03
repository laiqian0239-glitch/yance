'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const registryPath = path.join(__dirname, '..', '..', '..', 'services', 'durableOperationRegistry.js');
const EXPECTED_KINDS = Object.freeze({
  AI_PROVIDER_EXECUTION: 'AI_PROVIDER_EXECUTION',
  OUTBOUND_MESSAGE_SEND: 'OUTBOUND_MESSAGE_SEND',
  DELIVERY_RECEIPT_RECONCILIATION: 'DELIVERY_RECEIPT_RECONCILIATION',
  MEDIA_TRANSFER: 'MEDIA_TRANSFER',
  HISTORY_SYNCHRONIZATION: 'HISTORY_SYNCHRONIZATION',
  SESSION_RESTORE: 'SESSION_RESTORE'
});

function registryModule() {
  assert.equal(fs.existsSync(registryPath), true, 'WP_B_M2_OPERATION_REGISTRY_REQUIRED');
  delete require.cache[require.resolve(registryPath)];
  return require(registryPath);
}

function frozenAdapter(operationKind) {
  return Object.freeze({
    operationKind,
    async perform() { return Object.freeze({ status: 'performed' }); },
    async reconcile() { return Object.freeze({ outcome: 'REMOTE_RESULT_UNKNOWN' }); }
  });
}

test('M2-REG-001 registry exports the exact deeply frozen six-kind vocabulary', () => {
  const { OPERATION_KINDS } = registryModule();
  assert.deepEqual(OPERATION_KINDS, EXPECTED_KINDS);
  assert.equal(Object.isFrozen(OPERATION_KINDS), true);
  assert.equal(Object.keys(OPERATION_KINDS).length, 6);
});

test('M2-REG-002 registry is fail-closed for invalid, duplicate, unknown and post-seal mutations', () => {
  const { OPERATION_KINDS, createDurableOperationRegistry } = registryModule();
  const registry = createDurableOperationRegistry();
  assert.equal(Object.getPrototypeOf(registry), null);
  for (const method of ['register', 'require', 'list', 'seal']) {
    assert.equal(typeof registry[method], 'function', method);
  }

  assert.throws(
    () => registry.register(OPERATION_KINDS.AI_PROVIDER_EXECUTION, {
      operationKind: OPERATION_KINDS.AI_PROVIDER_EXECUTION,
      perform() {},
      reconcile() {}
    }),
    error => error?.code === 'WP_B_OPERATION_ADAPTER_INVALID'
  );

  const adapter = frozenAdapter(OPERATION_KINDS.AI_PROVIDER_EXECUTION);
  assert.equal(registry.register(OPERATION_KINDS.AI_PROVIDER_EXECUTION, adapter), adapter);
  assert.equal(registry.require(OPERATION_KINDS.AI_PROVIDER_EXECUTION), adapter);
  assert.deepEqual(registry.list(), [OPERATION_KINDS.AI_PROVIDER_EXECUTION]);

  assert.throws(
    () => registry.register(OPERATION_KINDS.AI_PROVIDER_EXECUTION, adapter),
    error => error?.code === 'WP_B_OPERATION_ADAPTER_DUPLICATE'
  );
  assert.throws(
    () => registry.require(OPERATION_KINDS.OUTBOUND_MESSAGE_SEND),
    error => error?.code === 'WP_B_OPERATION_ADAPTER_NOT_REGISTERED'
  );
  assert.throws(
    () => registry.register('UNAUTHORIZED_OPERATION', frozenAdapter('UNAUTHORIZED_OPERATION')),
    error => error?.code === 'WP_B_OPERATION_KIND_INVALID'
  );

  const sealed = registry.seal();
  assert.equal(sealed, registry);
  assert.equal(Object.isFrozen(registry.list()), true);
  assert.throws(
    () => registry.register(OPERATION_KINDS.OUTBOUND_MESSAGE_SEND, frozenAdapter(OPERATION_KINDS.OUTBOUND_MESSAGE_SEND)),
    error => error?.code === 'WP_B_OPERATION_REGISTRY_SEALED'
  );
});

test('M2-REG-003 reference-only attempt envelopes are recursively frozen and reject persisted secrets or business bodies', () => {
  const { assertReferenceOnlyEnvelope } = registryModule();
  const valid = Object.freeze({
    executionId: 'execution-1',
    intentId: 'intent-1',
    attemptId: 'attempt-1',
    idempotencyKey: 'idempotency-1',
    request: Object.freeze({
      modelReference: 'model-ref-1',
      promptReference: 'prompt-ref-1',
      credentialReference: 'credential-ref-1',
      requestContentSha256: 'a'.repeat(64)
    })
  });
  assert.equal(assertReferenceOnlyEnvelope(valid), valid);

  const notFrozen = { ...valid };
  assert.throws(
    () => assertReferenceOnlyEnvelope(notFrozen),
    error => error?.code === 'WP_B_REFERENCE_ONLY_ENVELOPE_NOT_FROZEN'
  );

  for (const [field, value] of [
    ['apiKey', 'secret'],
    ['oauthToken', 'secret'],
    ['accessToken', 'secret'],
    ['refreshToken', 'secret'],
    ['cookie', 'secret'],
    ['sessionMaterial', 'secret'],
    ['messageBody', 'private message'],
    ['promptBody', 'private prompt'],
    ['binaryPayload', 'private bytes']
  ]) {
    const invalid = Object.freeze({ ...valid, request: Object.freeze({ ...valid.request, [field]: value }) });
    assert.throws(
      () => assertReferenceOnlyEnvelope(invalid),
      error => error?.code === 'WP_B_REFERENCE_ONLY_ENVELOPE_FORBIDDEN_FIELD' && error?.field === field,
      field
    );
  }
});
