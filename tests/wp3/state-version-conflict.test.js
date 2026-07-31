'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { command, createApiHarness, request } = require('./helpers');
test('expectedStateVersion conflict is stable and produces no side effect', async () => {
  const h = await createApiHarness(); const before = (await request(h.port, { token: h.token })).body;
  const conflict = await request(h.port, { token: h.token, method: 'POST', path: '/api/app/v2/commands', body: command(before, { expectedStateVersion: before.stateVersion + 99 }) });
  assert.equal(conflict.statusCode, 409); assert.equal(conflict.body.reasonCode, 'STATE_VERSION_CONFLICT');
  const after = (await request(h.port, { token: h.token })).body; assert.equal(after.stateVersion, before.stateVersion); assert.equal(after.lastEventSequence, before.lastEventSequence);
  await h.close();
});
