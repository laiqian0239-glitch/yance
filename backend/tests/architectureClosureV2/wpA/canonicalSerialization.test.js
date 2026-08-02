'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
const modulePath = path.join(repoRoot, 'backend', 'services', 'canonicalSerialization.js');

function loadCanonicalSerialization() {
  assert.ok(fs.existsSync(modulePath), 'backend/services/canonicalSerialization.js must exist before A2 can be green');
  delete require.cache[require.resolve(modulePath)];
  return require(modulePath);
}

test('canonical serialization v1 normalizes object order, timestamps and negative zero deterministically', () => {
  const { CANONICALIZATION_VERSION, canonicalSerialize, canonicalHash } = loadCanonicalSerialization();
  assert.equal(CANONICALIZATION_VERSION, 1);

  const left = {
    z: null,
    occurredAt: '2026-08-02T01:02:03+07:00',
    amount: -0,
    nested: { beta: 2, alpha: 1 }
  };
  const right = {
    nested: { alpha: 1, beta: 2 },
    amount: 0,
    occurredAt: '2026-08-01T18:02:03.000Z',
    z: null
  };
  const options = { timestampPaths: ['$.occurredAt'] };

  assert.equal(canonicalSerialize(left, options), canonicalSerialize(right, options));
  assert.equal(canonicalHash(left, options), canonicalHash(right, options));
  assert.match(canonicalHash(left, options), /^[a-f0-9]{64}$/);
});

test('ordinary arrays preserve order while declared set-like arrays sort and deduplicate by canonical value', () => {
  const { canonicalSerialize } = loadCanonicalSerialization();
  const orderedA = canonicalSerialize({ values: ['b', 'a'] });
  const orderedB = canonicalSerialize({ values: ['a', 'b'] });
  assert.notEqual(orderedA, orderedB);

  const setA = canonicalSerialize(
    { tags: [{ b: 2, a: 1 }, 'z', 'a', 'z'] },
    { setLikePaths: ['$.tags'] }
  );
  const setB = canonicalSerialize(
    { tags: ['a', { a: 1, b: 2 }, 'z'] },
    { setLikePaths: ['$.tags'] }
  );
  assert.equal(setA, setB);
});

test('Date values use UTC ISO form and invalid timestamp strings fail closed', () => {
  const { canonicalSerialize } = loadCanonicalSerialization();
  assert.equal(
    canonicalSerialize({ at: new Date('2026-08-02T01:02:03+07:00') }),
    canonicalSerialize({ at: '2026-08-01T18:02:03.000Z' }, { timestampPaths: ['$.at'] })
  );
  assert.throws(
    () => canonicalSerialize({ at: 'not-a-time' }, { timestampPaths: ['$.at'] }),
    error => error?.code === 'CANONICAL_TIMESTAMP_INVALID'
  );
});

test('non-finite and unsafe numbers fail closed instead of receiving host-dependent encodings', () => {
  const { canonicalSerialize } = loadCanonicalSerialization();
  for (const value of [NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(
      () => canonicalSerialize({ value }),
      error => ['CANONICAL_NUMBER_NON_FINITE', 'CANONICAL_INTEGER_UNSAFE'].includes(error?.code)
    );
  }
});

test('cycles, accessors, executable values and non-plain objects are rejected', () => {
  const { canonicalSerialize } = loadCanonicalSerialization();
  const cycle = {}; cycle.self = cycle;
  const accessor = {}; Object.defineProperty(accessor, 'secret', { enumerable: true, get() { return 'x'; } });
  for (const value of [cycle, accessor, { fn() {} }, new Map([['a', 1]])]) {
    assert.throws(
      () => canonicalSerialize(value),
      error => String(error?.code || '').startsWith('CANONICAL_')
    );
  }
});

test('canonicalization input is not mutated and version participates in the hash domain', () => {
  const { canonicalSerialize, canonicalHash } = loadCanonicalSerialization();
  const input = { tags: ['b', 'a', 'b'], nested: { y: 2, x: 1 } };
  const before = JSON.stringify(input);
  canonicalSerialize(input, { setLikePaths: ['$.tags'] });
  assert.equal(JSON.stringify(input), before);
  assert.notEqual(
    canonicalHash(input, { version: 1, setLikePaths: ['$.tags'] }),
    canonicalHash(input, { version: 2, setLikePaths: ['$.tags'] })
  );
});

test('canonical key and set ordering is independent of host localeCompare behavior', () => {
  const { canonicalSerialize } = loadCanonicalSerialization();
  const input = { z: 1, a: 2, tags: ['z', 'a', 'm'] };
  const options = { setLikePaths: ['$.tags'] };
  const baseline = canonicalSerialize(input, options);
  const original = String.prototype.localeCompare;
  try {
    String.prototype.localeCompare = function reverseLocaleCompare(other) {
      const left = String(this);
      const right = String(other);
      return left < right ? 1 : left > right ? -1 : 0;
    };
    assert.equal(canonicalSerialize(input, options), baseline);
  } finally {
    String.prototype.localeCompare = original;
  }
});

test('symbol keys, sparse arrays and custom array properties fail closed instead of disappearing from the hash', () => {
  const { canonicalSerialize } = loadCanonicalSerialization();
  const withSymbol = { visible: true };
  withSymbol[Symbol('hidden')] = 'secret';
  const sparse = [];
  sparse[1] = 'value';
  const decorated = ['value'];
  decorated.extra = 'hidden';

  for (const value of [withSymbol, sparse, decorated]) {
    assert.throws(
      () => canonicalSerialize(value),
      error => ['CANONICAL_SYMBOL_KEY_FORBIDDEN', 'CANONICAL_SPARSE_ARRAY_FORBIDDEN', 'CANONICAL_ARRAY_PROPERTY_FORBIDDEN'].includes(error?.code)
    );
  }
});
