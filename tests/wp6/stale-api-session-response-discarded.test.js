'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { ApiV2RuntimeClient } = require('../../electron/desktopHost/ApiV2RuntimeClient');
const { backendBinding, jsonResponse, runtimeSnapshot } = require('./helpers');

test('response from a replaced backend API session is rejected', async () => {
  let binding = backendBinding({ ownerTrusted: true });
  let release;
  const fetch = async () => { await new Promise(r => { release = r; }); return jsonResponse(runtimeSnapshot()); };
  const client = new ApiV2RuntimeClient({ baseURL: 'http://127.0.0.1:3000', fetch, sessionProvider: () => ({ ...binding }), expectedBuildId: 'wp6-test-build', timeoutMs: 1000 });
  const pending = client.getSnapshot({ requireTrusted: true });
  while (!release) await new Promise(r => setImmediate(r));
  binding = backendBinding({ ownerTrusted: true, backendPid: 2200, backendSessionId: 'session-2', startupNonce: 'nonce-2', apiSessionToken: 'token-2' });
  release();
  await assert.rejects(() => pending, error => error.reasonCode === 'WP6_STALE_API_SESSION_RESPONSE');
});
