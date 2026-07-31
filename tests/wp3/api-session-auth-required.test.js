'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { createApiHarness, request } = require('./helpers');
test('snapshot commands and events all require the current Bearer apiSessionToken', async () => {
  const h = await createApiHarness();
  const endpoints = [
    { path: '/api/app/v2/snapshot' },
    { path: '/api/app/v2/commands', method: 'POST', body: {} },
    { path: '/api/app/v2/events?afterSequence=0&limit=10' }
  ];
  for (const endpoint of endpoints) {
    for (const supplied of [null, 'wrong-token']) {
      const result = await request(h.port, { ...endpoint, token: supplied });
      assert.equal(result.statusCode, 401); assert.equal(result.body.reasonCode, 'API_SESSION_UNAUTHORIZED');
    }
  }
  await h.close();
});
