'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const path = require('node:path');
const zlib = require('node:zlib');

const generator = path.resolve(__dirname, 'oss1a-generate-minimal-ready-authority-blob.test.js');

test('export audited BackendProcessHost blob for Git tree ingestion', () => {
  const result = childProcess.spawnSync(process.execPath, ['--test', '--test-concurrency=1', generator], {
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const sha = /OSS1A_PATCH_BLOB_SHA256=([a-f0-9]{64})/u.exec(result.stdout)?.[1] || '';
  const base64 = /OSS1A_PATCH_BASE64=([A-Za-z0-9+/=]+)/u.exec(result.stdout)?.[1] || '';
  assert.match(sha, /^[a-f0-9]{64}$/u);
  assert.ok(base64.length > 1000, 'generator base64 output is missing');
  const code = Buffer.from(base64, 'base64');
  assert.equal(crypto.createHash('sha256').update(code).digest('hex'), sha);
  const gzipBase64 = zlib.gzipSync(code, { level: 9 }).toString('base64');
  assert.fail(`OSS1A_PATCH_SHA256=${sha}\nOSS1A_PATCH_GZIP_BASE64=${gzipBase64}`);
});
