'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
const modulePath = path.join(repoRoot, 'backend', 'services', 'dataClassificationRegistry.js');

function loadRegistryModule() {
  assert.ok(fs.existsSync(modulePath), 'backend/services/dataClassificationRegistry.js must exist before A2 can be green');
  delete require.cache[require.resolve(modulePath)];
  return require(modulePath);
}

function buildRegistry() {
  const { DataClassificationRegistry, CLASSIFICATIONS } = loadRegistryModule();
  const registry = new DataClassificationRegistry();
  registry.registerEvent({
    eventType: 'message.received',
    fields: {
      eventId: { classification: CLASSIFICATIONS.PUBLIC_METADATA, type: 'string' },
      body: { classification: CLASSIFICATIONS.BUSINESS_CONTENT, type: 'string' },
      credential: { classification: CLASSIFICATIONS.SECRET_REFERENCE, type: 'object' },
      media: { classification: CLASSIFICATIONS.BINARY_REFERENCE, type: 'object' }
    }
  });
  return registry;
}

test('the classification vocabulary is exact and immutable', () => {
  const { CLASSIFICATIONS } = loadRegistryModule();
  assert.deepEqual(Object.values(CLASSIFICATIONS).sort(), [
    'BINARY_REFERENCE',
    'BUSINESS_CONTENT',
    'PUBLIC_METADATA',
    'SECRET_REFERENCE'
  ]);
  assert.equal(Object.isFrozen(CLASSIFICATIONS), true);
});

test('registered payload fields validate without copying business content into metadata', () => {
  const registry = buildRegistry();
  const result = registry.validateEventPayload('message.received', {
    eventId: 'evt-1',
    body: 'private message body',
    credential: {
      credentialRef: 'vault://provider/openrouter',
      generation: 7,
      receiptId: 'credential-receipt-1',
      scope: 'provider:openrouter'
    },
    media: {
      binaryRef: 'managed://media/sha256/abc',
      sha256: 'a'.repeat(64),
      size: 123,
      mime: 'image/png',
      lifecycleState: 'AVAILABLE'
    }
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.classifications, {
    eventId: 'PUBLIC_METADATA',
    body: 'BUSINESS_CONTENT',
    credential: 'SECRET_REFERENCE',
    media: 'BINARY_REFERENCE'
  });
  assert.equal(JSON.stringify(result.metadata).includes('private message body'), false);
});

test('unknown payload fields and schema fields without a classification fail closed', () => {
  const { DataClassificationRegistry } = loadRegistryModule();
  const registry = new DataClassificationRegistry();
  assert.throws(
    () => registry.registerEvent({ eventType: 'invalid.event', fields: { value: { type: 'string' } } }),
    error => error?.code === 'DATA_CLASSIFICATION_REQUIRED'
  );

  const valid = buildRegistry();
  assert.throws(
    () => valid.validateEventPayload('message.received', { eventId: 'evt-1', body: 'x', credential: {}, media: {}, extra: true }),
    error => error?.code === 'DATA_CLASSIFICATION_FIELD_UNREGISTERED' && error?.fieldPath === '$.extra'
  );
});

test('secret references reject raw API keys, tokens, cookies, QR material and arbitrary secret fields', () => {
  const registry = buildRegistry();
  const forbidden = [
    { apiKey: 'sk-secret' },
    { token: 'raw-token' },
    { cookie: 'session=x' },
    { qrCode: 'raw-qr' },
    { credentialRef: 'vault://x', generation: 1, receiptId: 'r', secret: 'x' }
  ];
  for (const credential of forbidden) {
    assert.throws(
      () => registry.validateEventPayload('message.received', { eventId: 'e', body: 'b', credential, media: { binaryRef: 'managed://m', sha256: 'a'.repeat(64), size: 1, mime: 'x', lifecycleState: 'AVAILABLE' } }),
      error => error?.code === 'SECRET_REFERENCE_MATERIAL_FORBIDDEN'
    );
  }
});

test('secret references require a stable reference, positive generation and custody receipt', () => {
  const registry = buildRegistry();
  for (const credential of [
    {},
    { credentialRef: 'vault://x', generation: 0, receiptId: 'r' },
    { credentialRef: 'vault://x', generation: 1 },
    { generation: 1, receiptId: 'r' }
  ]) {
    assert.throws(
      () => registry.validateEventPayload('message.received', { eventId: 'e', body: 'b', credential, media: { binaryRef: 'managed://m', sha256: 'a'.repeat(64), size: 1, mime: 'x', lifecycleState: 'AVAILABLE' } }),
      error => error?.code === 'SECRET_REFERENCE_INCOMPLETE'
    );
  }
});

test('binary references reject embedded Buffer, Uint8Array and base64 bodies', () => {
  const registry = buildRegistry();
  const forbidden = [
    { binaryRef: 'managed://m', sha256: 'a'.repeat(64), size: 1, mime: 'x', lifecycleState: 'AVAILABLE', bytes: Buffer.from('x') },
    { binaryRef: 'managed://m', sha256: 'a'.repeat(64), size: 1, mime: 'x', lifecycleState: 'AVAILABLE', data: new Uint8Array([1]) },
    { binaryRef: 'managed://m', sha256: 'a'.repeat(64), size: 1, mime: 'x', lifecycleState: 'AVAILABLE', base64: 'eA==' }
  ];
  for (const media of forbidden) {
    assert.throws(
      () => registry.validateEventPayload('message.received', { eventId: 'e', body: 'b', credential: { credentialRef: 'vault://x', generation: 1, receiptId: 'r' }, media }),
      error => error?.code === 'BINARY_REFERENCE_INLINE_DATA_FORBIDDEN'
    );
  }
});

test('duplicate event registration with a conflicting classification schema is rejected', () => {
  const { CLASSIFICATIONS } = loadRegistryModule();
  const registry = buildRegistry();
  assert.throws(
    () => registry.registerEvent({
      eventType: 'message.received',
      fields: { eventId: { classification: CLASSIFICATIONS.BUSINESS_CONTENT, type: 'string' } }
    }),
    error => error?.code === 'DATA_CLASSIFICATION_SCHEMA_CONFLICT'
  );
});
