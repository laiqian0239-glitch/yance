'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { canonicalizePayloadRecords } = require('../../tools/wp1/lib');

test('Windows case-insensitive payload path collisions are rejected', () => {
  assert.throws(() => canonicalizePayloadRecords([
    { path: 'Backend/App.js', sizeBytes: 1, sha256: 'a'.repeat(64) },
    { path: 'backend/app.js', sizeBytes: 1, sha256: 'b'.repeat(64) }
  ]), error => error.reasonCode === 'WP1_PAYLOAD_WINDOWS_CASE_COLLISION');
});
