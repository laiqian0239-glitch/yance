'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { canonicalizePayloadRecords } = require('../../tools/wp1/lib');

test('Unicode NFC normalized duplicate payload paths are rejected', () => {
  assert.throws(() => canonicalizePayloadRecords([
    { path: 'a/café.js', sizeBytes: 1, sha256: 'a'.repeat(64) },
    { path: 'a/cafe\u0301.js', sizeBytes: 1, sha256: 'b'.repeat(64) }
  ]), error => error.reasonCode === 'WP1_PAYLOAD_UNICODE_NORMALIZATION_COLLISION');
});
