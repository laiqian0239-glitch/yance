'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('cloud configuration is verified before it is persisted', () => {
  const route = read('backend/routes/models.js');
  const verifyAt = route.indexOf('verification = await verifyCloudCredential');
  const persistAt = route.indexOf('let state = await registry.upsertCloudModel');
  assert.ok(verifyAt > 0 && persistAt > verifyAt);
  assert.match(route, /CLOUD_MODEL_TEST_REQUIRED/);
  assert.match(route, /persisted:\s*false/);
});
