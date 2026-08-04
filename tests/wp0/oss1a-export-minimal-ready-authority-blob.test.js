'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const {
  generatePatchedBackendProcessHost
} = require('./oss1a-generate-minimal-ready-authority-blob.test');

test('export audited BackendProcessHost blob for Git tree ingestion', () => {
  const result = generatePatchedBackendProcessHost();
  assert.match(result.sha256, /^[a-f0-9]{64}$/u);
  assert.ok(result.base64.length > 1000);
  assert.equal(crypto.createHash('sha256').update(result.code).digest('hex'), result.sha256);
  const gzipBase64 = zlib.gzipSync(result.code, { level: 9 }).toString('base64');
  assert.fail(`OSS1A_PATCH_SHA256=${result.sha256}\nOSS1A_PATCH_GZIP_BASE64=${gzipBase64}`);
});
