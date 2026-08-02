'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { canonicalSerialize } = require('../../../services/canonicalSerialization');
const { DataClassificationRegistry, CLASSIFICATIONS } = require('../../../services/dataClassificationRegistry');
const { EventTypeRegistry } = require('../../../services/eventTypeRegistry');

function ownReservedKey(key, value) {
  const object = {};
  Object.defineProperty(object, key, { enumerable: true, configurable: true, writable: true, value });
  return object;
}

test('canonical serialization rejects prototype mutation keys at any depth', () => {
  for (const key of ['__proto__', 'prototype', 'constructor']) {
    assert.throws(
      () => canonicalSerialize({ safe: ownReservedKey(key, { polluted: true }) }),
      error => error?.code === 'CANONICAL_FORBIDDEN_OBJECT_KEY' && error?.fieldPath === `$.safe.${key}`
    );
  }
  assert.equal(Object.prototype.polluted, undefined);
});

test('classification registration and payload validation reject prototype mutation keys', () => {
  const registry = new DataClassificationRegistry();
  const fields = {
    eventId: { classification: CLASSIFICATIONS.PUBLIC_METADATA, type: 'string' }
  };
  Object.defineProperty(fields, '__proto__', {
    enumerable: true,
    configurable: true,
    writable: true,
    value: { classification: CLASSIFICATIONS.BUSINESS_CONTENT, type: 'object' }
  });
  assert.throws(
    () => registry.registerEvent({ eventType: 'prototype.schema', fields }),
    error => error?.code === 'DATA_CLASSIFICATION_FORBIDDEN_KEY' && error?.fieldPath === '$.fields.__proto__'
  );

  const valid = new DataClassificationRegistry();
  valid.registerEvent({
    eventType: 'prototype.payload',
    fields: { eventId: { classification: CLASSIFICATIONS.PUBLIC_METADATA, type: 'string' } }
  });
  const payload = { eventId: 'evt-1' };
  Object.defineProperty(payload, '__proto__', {
    enumerable: true,
    configurable: true,
    writable: true,
    value: { polluted: true }
  });
  assert.throws(
    () => valid.validateEventPayload('prototype.payload', payload),
    error => error?.code === 'DATA_CLASSIFICATION_FORBIDDEN_KEY' && error?.fieldPath === '$.__proto__'
  );
  assert.equal(Object.prototype.polluted, undefined);
});

test('event descriptor, schema and upcaster payload reject prototype mutation keys without pollution', () => {
  const registry = new EventTypeRegistry({ canonicalizationVersion: 1 });
  const classificationSchema = {
    sourceAccountId: 'PUBLIC_METADATA',
    externalId: 'PUBLIC_METADATA'
  };
  Object.defineProperty(classificationSchema, '__proto__', {
    enumerable: true,
    configurable: true,
    writable: true,
    value: 'BUSINESS_CONTENT'
  });
  assert.throws(
    () => registry.register({
      eventType: 'prototype.event',
      schemaVersion: 2,
      aggregateType: 'PrototypeProbe',
      payloadSchema: { type: 'object', required: ['sourceAccountId', 'externalId'] },
      classificationSchema,
      canonicalizationVersion: 1,
      projectionCompatibility: ['probe-v1'],
      retentionClass: 'ACTIVE_REPLAY',
      upcasters: [{
        fromVersion: 1,
        toVersion: 2,
        transform(payload) {
          return { sourceAccountId: payload.accountId, externalId: payload.externalId };
        }
      }]
    }),
    error => error?.code === 'EVENT_DESCRIPTOR_FORBIDDEN_KEY' && error?.fieldPath === '$.classificationSchema.__proto__'
  );

  const clean = new EventTypeRegistry({ canonicalizationVersion: 1 });
  clean.register({
    eventType: 'prototype.payload',
    schemaVersion: 2,
    aggregateType: 'PrototypeProbe',
    payloadSchema: { type: 'object', required: ['sourceAccountId', 'externalId'] },
    classificationSchema: {
      sourceAccountId: 'PUBLIC_METADATA',
      externalId: 'PUBLIC_METADATA'
    },
    canonicalizationVersion: 1,
    projectionCompatibility: ['probe-v1'],
    retentionClass: 'ACTIVE_REPLAY',
    upcasters: [{
      fromVersion: 1,
      toVersion: 2,
      transform(payload) {
        return { sourceAccountId: payload.accountId, externalId: payload.externalId };
      }
    }]
  });
  const historical = { accountId: 'acct-1', externalId: 'ext-1' };
  Object.defineProperty(historical, '__proto__', {
    enumerable: true,
    configurable: true,
    writable: true,
    value: { polluted: true }
  });
  assert.throws(
    () => clean.upcast({ eventType: 'prototype.payload', schemaVersion: 1, payload: historical }),
    error => error?.code === 'EVENT_DESCRIPTOR_FORBIDDEN_KEY' && error?.fieldPath === '$.payload.__proto__'
  );
  assert.equal(Object.prototype.polluted, undefined);
});
