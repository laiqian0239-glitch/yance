'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { command, createApiHarness, request } = require('./helpers');
test('same commandId and envelope returns original result without duplicate side effect', async () => {
  const h = await createApiHarness(); const snapshot = (await request(h.port, { token: h.token })).body; const body = command(snapshot);
  const first = await request(h.port, { token: h.token, method: 'POST', path: '/api/app/v2/commands', body });
  const duplicate = await request(h.port, { token: h.token, method: 'POST', path: '/api/app/v2/commands', body });
  assert.equal(first.statusCode, 200); assert.equal(first.body.duplicate, false); assert.equal(duplicate.body.duplicate, true);
  assert.equal(duplicate.body.stateVersion, first.body.stateVersion); assert.equal(duplicate.body.resultingEventSequence, first.body.resultingEventSequence);
  const after = (await request(h.port, { token: h.token })).body; assert.equal(after.stateVersion, first.body.stateVersion);
  await h.close();
});
