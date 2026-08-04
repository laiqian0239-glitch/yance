'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

function freezeModule() {
  return require('../../../lib/deepFreeze');
}
function timestampModule() {
  return require('../../../services/authorityTimestamp');
}

test('public authority values are recursively frozen through arrays and nested objects', () => {
  const { deepFreeze } = freezeModule();
  const value = deepFreeze({ nested: { items: [{ state: 'CREATED' }] } });
  assert.equal(Object.isFrozen(value), true);
  assert.equal(Object.isFrozen(value.nested), true);
  assert.equal(Object.isFrozen(value.nested.items), true);
  assert.equal(Object.isFrozen(value.nested.items[0]), true);
  assert.throws(() => { value.nested.items[0].state = 'FAILED'; }, TypeError);
});

test('deep freeze handles repeated and cyclic references without weakening immutability', () => {
  const { deepFreeze } = freezeModule();
  const shared = { value: 1 };
  const value = { left: shared, right: shared };
  value.self = value;
  deepFreeze(value);
  assert.equal(value.left, value.right);
  assert.equal(value.self, value);
  assert.equal(Object.isFrozen(shared), true);
  assert.throws(() => { shared.value = 2; }, TypeError);
});

test('authority timestamp is explicit, normalized and deeply immutable', () => {
  const { issueAuthorityTimestamp } = timestampModule();
  const issued = issueAuthorityTimestamp({
    clock: () => Date.parse('2026-08-03T01:30:00.000Z'),
    purpose: 'CREATE_EXECUTION'
  });
  assert.deepEqual(issued, {
    schemaVersion: 1,
    authority: 'AuthorityClock',
    purpose: 'CREATE_EXECUTION',
    iso: '2026-08-03T01:30:00.000Z',
    epochMs: 1785720600000
  });
  assert.equal(Object.isFrozen(issued), true);
});

test('authority timestamp rejects rollback against an explicit previous timestamp', () => {
  const { issueAuthorityTimestamp } = timestampModule();
  assert.throws(() => issueAuthorityTimestamp({
    clock: () => Date.parse('2026-08-03T01:29:59.999Z'),
    previousIso: '2026-08-03T01:30:00.000Z',
    purpose: 'HEARTBEAT'
  }), error => error?.code === 'WP_B_AUTHORITY_TIME_ROLLBACK');
});
