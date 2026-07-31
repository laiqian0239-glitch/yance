'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
test('production server has no Ready-after credential recovery branch', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../backend/server.js'), 'utf8');
  assert.doesNotMatch(source, /credentialRecovery\.recoverAtStartup/);
  assert.doesNotMatch(source, /completedAfterReady\s*:\s*true/);
  assert.match(source, /completedBeforeReady\s*:\s*true/);
});
