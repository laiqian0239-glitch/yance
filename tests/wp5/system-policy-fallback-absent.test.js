'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

test('system policy service strips legacy safeMode and rejects direct writes', async () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../backend/services/systemPolicy.js'), 'utf8');
  assert.match(source, /const \{ safeMode: _legacySafeMode, \.\.\.value \}/);
  assert.match(source, /SYSTEM_POLICY_OPERATING_MODE_FORBIDDEN/);
  assert.equal(source.includes("allowed = ['safeMode'"), false);
  const service = require('../../backend/services/systemPolicy');
  await assert.rejects(service.update({ safeMode: true }, 'wp5-test'), error => error.code === 'SYSTEM_POLICY_OPERATING_MODE_FORBIDDEN');
  assert.equal(Object.prototype.hasOwnProperty.call(service.read(), 'safeMode'), false);
});
