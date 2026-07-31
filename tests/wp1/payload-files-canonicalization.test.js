'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { applicationPayloadSha256, canonicalJsonBuffer, canonicalizePayloadRecords, payloadFilesDocument, sha256Buffer } = require('../../tools/wp1/lib');

test('payload-files records use NFC paths, UTF-8 byte order, and deterministic canonical bytes', () => {
  const records = canonicalizePayloadRecords([
    { path: 'z/file.js', sizeBytes: 2, sha256: 'b'.repeat(64) },
    { path: 'a/cafe\u0301.js', sizeBytes: 1, sha256: 'a'.repeat(64) }
  ]);
  assert.deepEqual(records.map(item => item.path), ['a/café.js', 'z/file.js']);
  const first = canonicalJsonBuffer(payloadFilesDocument(records));
  const second = canonicalJsonBuffer(payloadFilesDocument([...records].reverse()));
  assert.deepEqual(first, second);
  assert.equal(sha256Buffer(first).length, 64);
  assert.equal(applicationPayloadSha256(records), applicationPayloadSha256([...records].reverse()));
});
