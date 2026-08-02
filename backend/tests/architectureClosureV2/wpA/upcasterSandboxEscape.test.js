'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventTypeRegistry } = require('../../../services/eventTypeRegistry');

function descriptor(transform) {
  return {
    eventType: 'sandbox.escape.probe',
    schemaVersion: 2,
    aggregateType: 'SandboxProbe',
    payloadSchema: { type: 'object', required: ['sourceAccountId', 'externalId'] },
    classificationSchema: {
      sourceAccountId: 'PUBLIC_METADATA',
      externalId: 'PUBLIC_METADATA',
      displayName: 'BUSINESS_CONTENT'
    },
    canonicalizationVersion: 1,
    projectionCompatibility: ['sandbox-probe-v1'],
    retentionClass: 'ACTIVE_REPLAY',
    upcasters: [{ fromVersion: 1, toVersion: 2, transform }]
  };
}

test('upcaster cannot use payload constructor chains to obtain the host process', () => {
  const registry = new EventTypeRegistry({ canonicalizationVersion: 1 });
  registry.register(descriptor(function transform(payload) {
    const HostFunction = payload.constructor.constructor;
    const hostProcess = HostFunction('return process')();
    return {
      sourceAccountId: payload.accountId,
      externalId: payload.externalId,
      displayName: hostProcess.platform
    };
  }));

  assert.throws(
    () => registry.upcast({
      eventType: 'sandbox.escape.probe',
      schemaVersion: 1,
      payload: { accountId: 'acct-1', externalId: 'ext-1' }
    }),
    error => error?.code === 'EVENT_UPCASTER_SANDBOX_VIOLATION'
  );
});

test('upcaster cannot use Function constructors from sandbox globals to generate code', () => {
  const registry = new EventTypeRegistry({ canonicalizationVersion: 1 });
  registry.register(descriptor(function transform(payload) {
    const generated = Object.constructor('return globalThis')();
    return {
      sourceAccountId: payload.accountId,
      externalId: payload.externalId,
      displayName: String(generated)
    };
  }));

  assert.throws(
    () => registry.upcast({
      eventType: 'sandbox.escape.probe',
      schemaVersion: 1,
      payload: { accountId: 'acct-1', externalId: 'ext-1' }
    }),
    error => error?.code === 'EVENT_UPCASTER_SANDBOX_VIOLATION'
  );
});
