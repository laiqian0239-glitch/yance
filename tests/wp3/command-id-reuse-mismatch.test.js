'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { command, createApiHarness, request } = require('./helpers');
test('same commandId with a different envelope is rejected', async () => {
  const h = await createApiHarness(); const snapshot = (await request(h.port, { token: h.token })).body; const id = '22222222-2222-4222-8222-222222222222';
  const firstBody = command(snapshot, { commandId: id });
  assert.equal((await request(h.port, { token: h.token, method: 'POST', path: '/api/app/v2/commands', body: firstBody })).statusCode, 200);
  const mismatch = await request(h.port, { token: h.token, method: 'POST', path: '/api/app/v2/commands', body: { ...firstBody, payload: { changed: true } } });
  assert.equal(mismatch.statusCode, 409); assert.equal(mismatch.body.reasonCode, 'COMMAND_ID_REUSE_MISMATCH');
  await h.close();
});
