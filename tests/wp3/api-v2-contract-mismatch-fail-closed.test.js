'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { command, createApiHarness, request } = require('./helpers');
test('API v2 contract mismatch fails closed before command side effects', async () => {
  const h = await createApiHarness(); const before = (await request(h.port, { token: h.token })).body;
  const result = await request(h.port, { token: h.token, method: 'POST', path: '/api/app/v2/commands', contractVersion: 1, body: command(before) });
  assert.equal(result.statusCode, 426); assert.equal(result.body.reasonCode, 'API_CONTRACT_MISMATCH');
  const after = (await request(h.port, { token: h.token })).body; assert.equal(after.stateVersion, before.stateVersion); assert.equal(after.lastEventSequence, before.lastEventSequence);
  await h.close();
});
