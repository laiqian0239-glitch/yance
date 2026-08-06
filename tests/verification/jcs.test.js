'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  canonicalizeBytes,
  canonicalSha256
} = require('../../shared/verification/jcs');
const {
  verifyJcsDependency
} = require('../../tools/verification/verify-jcs-dependency');

test('RFC 8785 sample canonicalizes byte-for-byte', () => {
  const input = {
    numbers: [333333333.33333329, 1E30, 4.50, 2e-3, 1e-27],
    string: "€$\u000f\nA'B\"\\\"/",
    literals: [null, true, false]
  };
  const expected = `{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$\\u000f\\nA'B\\\"\\\\\\\"/"}`;
  assert.equal(canonicalizeBytes(input).toString('utf8'), expected);
});

test('canonical object order changes neither bytes nor digest', () => {
  assert.deepEqual(
    canonicalizeBytes({ b: 2, a: 1 }),
    canonicalizeBytes({ a: 1, b: 2 })
  );
  assert.equal(
    canonicalSha256({ b: 2, a: 1 }),
    canonicalSha256({ a: 1, b: 2 })
  );
});

test('non-I-JSON values fail closed', () => {
  for (const invalid of [NaN, Infinity, -Infinity, undefined, 1n]) {
    assert.throws(
      () => canonicalizeBytes({ value: invalid }),
      (error) => error?.code === 'EVIDENCE_SCHEMA_INVALID'
    );
  }
  assert.throws(
    () => canonicalizeBytes({ value: '\ud800' }),
    (error) => error?.code === 'EVIDENCE_SCHEMA_INVALID'
  );
});

test('canonicalize implementation is exact provenance-bound', () => {
  const result = verifyJcsDependency({
    repoRoot: path.resolve(__dirname, '..', '..')
  });
  assert.equal(result.pass, true);
  assert.equal(result.packageVersion, '2.1.0');
  assert.match(result.integrity, /^sha512-/u);
  assert.equal(result.sourceMode, 'vendored-upstream-tag');
});
