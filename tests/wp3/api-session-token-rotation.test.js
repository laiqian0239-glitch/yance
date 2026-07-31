'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { createApiHarness, request, token } = require('./helpers');
test('backend restart rotates API session token and immediately rejects the old token', async () => {
  const rootToken = token('a'); const h1 = await createApiHarness({ token: rootToken }); const root = h1.root;
  assert.equal((await request(h1.port, { token: rootToken })).statusCode, 200); await h1.close({ removeRoot: false });
  const newToken = token('b'); const h2 = await createApiHarness({ root, token: newToken });
  const stale = await request(h2.port, { token: rootToken }); const current = await request(h2.port, { token: newToken });
  assert.equal(stale.statusCode, 401); assert.equal(stale.body.reasonCode, 'API_SESSION_UNAUTHORIZED'); assert.equal(current.statusCode, 200);
  await h2.close();
});
