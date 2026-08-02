'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
const modulePath = path.join(repoRoot, 'backend', 'services', 'eventTypeRegistry.js');

function loadRegistryModule() {
  assert.ok(fs.existsSync(modulePath), 'backend/services/eventTypeRegistry.js must exist before A2 can be green');
  delete require.cache[require.resolve(modulePath)];
  return require(modulePath);
}

function descriptor(overrides = {}) {
  return {
    eventType: 'account.identity.observed',
    schemaVersion: 2,
    aggregateType: 'ExternalAccountIdentity',
    payloadSchema: { type: 'object', required: ['sourceAccountId', 'externalId'] },
    classificationSchema: {
      sourceAccountId: 'PUBLIC_METADATA',
      externalId: 'PUBLIC_METADATA',
      displayName: 'BUSINESS_CONTENT'
    },
    canonicalizationVersion: 1,
    projectionCompatibility: ['communication-v2'],
    retentionClass: 'ACTIVE_REPLAY',
    upcasters: [
      {
        fromVersion: 1,
        toVersion: 2,
        transform(payload) {
          return {
            sourceAccountId: payload.accountId,
            externalId: payload.externalId,
            displayName: payload.displayName || ''
          };
        }
      }
    ],
    ...overrides
  };
}

function createRegistry() {
  const { EventTypeRegistry } = loadRegistryModule();
  const registry = new EventTypeRegistry({ canonicalizationVersion: 1 });
  registry.register(descriptor());
  return registry;
}

test('event registration requires every frozen replay contract field', () => {
  const { EventTypeRegistry } = loadRegistryModule();
  const required = [
    'eventType',
    'schemaVersion',
    'aggregateType',
    'payloadSchema',
    'classificationSchema',
    'canonicalizationVersion',
    'projectionCompatibility',
    'retentionClass'
  ];
  for (const field of required) {
    const registry = new EventTypeRegistry({ canonicalizationVersion: 1 });
    const value = descriptor();
    delete value[field];
    assert.throws(
      () => registry.register(value),
      error => error?.code === 'EVENT_TYPE_DESCRIPTOR_INCOMPLETE' && error?.field === field
    );
  }
});

test('historical schema payload upcasts through a contiguous pure chain to the current schema', () => {
  const registry = createRegistry();
  const result = registry.upcast({
    eventType: 'account.identity.observed',
    schemaVersion: 1,
    payload: { displayName: 'Alice', externalId: 'ext-1', accountId: 'acct-1' }
  });
  assert.deepEqual(result, {
    eventType: 'account.identity.observed',
    schemaVersion: 2,
    payload: { sourceAccountId: 'acct-1', externalId: 'ext-1', displayName: 'Alice' },
    upcastPath: ['1->2'],
    canonicalizationVersion: 1
  });
});

test('current schema payload is returned without an artificial upcast step', () => {
  const registry = createRegistry();
  const payload = { sourceAccountId: 'acct-1', externalId: 'ext-1', displayName: 'Alice' };
  const result = registry.upcast({ eventType: 'account.identity.observed', schemaVersion: 2, payload });
  assert.deepEqual(result.upcastPath, []);
  assert.deepEqual(result.payload, payload);
  assert.notStrictEqual(result.payload, payload);
});

test('unknown event types and unsupported historical versions fail closed', () => {
  const registry = createRegistry();
  assert.throws(
    () => registry.upcast({ eventType: 'unknown.event', schemaVersion: 1, payload: {} }),
    error => error?.code === 'EVENT_TYPE_UNREGISTERED'
  );
  assert.throws(
    () => registry.upcast({ eventType: 'account.identity.observed', schemaVersion: 0, payload: {} }),
    error => error?.code === 'EVENT_SCHEMA_VERSION_UNSUPPORTED'
  );
});

test('gapped, reversed and duplicate upcaster chains are rejected at registration', () => {
  const { EventTypeRegistry } = loadRegistryModule();
  const invalidChains = [
    [{ fromVersion: 1, toVersion: 3, transform: value => value }],
    [{ fromVersion: 2, toVersion: 1, transform: value => value }],
    [
      { fromVersion: 1, toVersion: 2, transform: value => value },
      { fromVersion: 1, toVersion: 2, transform: value => value }
    ]
  ];
  for (const upcasters of invalidChains) {
    const registry = new EventTypeRegistry({ canonicalizationVersion: 1 });
    assert.throws(
      () => registry.register(descriptor({ schemaVersion: 3, upcasters })),
      error => error?.code === 'EVENT_UPCASTER_CHAIN_INVALID'
    );
  }
});

test('upcasters using time, randomness, environment, filesystem or network primitives are rejected', () => {
  const { EventTypeRegistry } = loadRegistryModule();
  const transforms = [
    payload => ({ ...payload, at: Date.now() }),
    payload => ({ ...payload, nonce: Math.random() }),
    payload => ({ ...payload, home: process.env.HOME }),
    payload => ({ ...payload, file: require('node:fs').readFileSync('/tmp/x') }),
    payload => ({ ...payload, response: fetch('https://example.com') }),
    payload => ({ ...payload, uuid: require('node:crypto').randomUUID() })
  ];
  for (const transform of transforms) {
    const registry = new EventTypeRegistry({ canonicalizationVersion: 1 });
    assert.throws(
      () => registry.register(descriptor({ upcasters: [{ fromVersion: 1, toVersion: 2, transform }] })),
      error => error?.code === 'EVENT_UPCASTER_NONDETERMINISTIC'
    );
  }
});

test('upcasters cannot mutate their input or return a Promise', async () => {
  const { EventTypeRegistry } = loadRegistryModule();
  const mutating = new EventTypeRegistry({ canonicalizationVersion: 1 });
  mutating.register(descriptor({
    upcasters: [{
      fromVersion: 1,
      toVersion: 2,
      transform(payload) {
        payload.accountId = 'mutated';
        return { sourceAccountId: payload.accountId, externalId: payload.externalId, displayName: '' };
      }
    }]
  }));
  assert.throws(
    () => mutating.upcast({ eventType: 'account.identity.observed', schemaVersion: 1, payload: { accountId: 'a', externalId: 'e' } }),
    error => error?.code === 'EVENT_UPCASTER_MUTATED_INPUT'
  );

  const asynchronous = new EventTypeRegistry({ canonicalizationVersion: 1 });
  asynchronous.register(descriptor({
    upcasters: [{ fromVersion: 1, toVersion: 2, transform: async payload => payload }]
  }));
  assert.throws(
    () => asynchronous.upcast({ eventType: 'account.identity.observed', schemaVersion: 1, payload: { accountId: 'a', externalId: 'e' } }),
    error => error?.code === 'EVENT_UPCASTER_ASYNC_FORBIDDEN'
  );
});

test('conflicting duplicate event descriptors are rejected while exact re-registration is idempotent', () => {
  const { EventTypeRegistry } = loadRegistryModule();
  const registry = new EventTypeRegistry({ canonicalizationVersion: 1 });
  const first = registry.register(descriptor());
  const second = registry.register(descriptor());
  assert.equal(second, first);
  assert.throws(
    () => registry.register(descriptor({ aggregateType: 'DifferentAggregate' })),
    error => error?.code === 'EVENT_TYPE_DESCRIPTOR_CONFLICT'
  );
});
