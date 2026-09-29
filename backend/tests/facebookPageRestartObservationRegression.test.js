'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ENV_KEYS = [
  'CHATWOOT_BASE_URL', 'CHATWOOT_ACCOUNT_ID', 'CHATWOOT_API_ACCESS_TOKEN',
  'CHATWOOT_WEBHOOK_SECRET', 'MATRIX_BASE_URL', 'MATRIX_ACCESS_TOKEN'
];

function responseJson(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}

test('Facebook Page live observation restores connected state after process restart', async () => {
  const savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  const savedFetch = global.fetch;
  Object.assign(process.env, {
    CHATWOOT_BASE_URL: 'http://chatwoot.test', CHATWOOT_ACCOUNT_ID: '1',
    CHATWOOT_API_ACCESS_TOKEN: 'token', CHATWOOT_WEBHOOK_SECRET: 'secret',
    MATRIX_BASE_URL: 'http://matrix.test', MATRIX_ACCESS_TOKEN: 'matrix-token'
  });
  try {
    global.fetch = async (url) => {
      const value = String(url);
      if (value === 'http://chatwoot.test/api/v1/accounts/1/inboxes') {
        return responseJson([{ id: 7, channel_type: 'Channel::FacebookPage', page_id: '1203748086150141', name: 'Yeonhee Kim' }]);
      }
      if (value === 'http://matrix.test/_matrix/client/v3/account/whoami') {
        return responseJson({ user_id: '@yance_chatwoot:yance.local' });
      }
      throw new Error(`unexpected fetch ${value}`);
    };
    delete require.cache[require.resolve('../services/facebookChatwootMatrixBridge')];
    const bridge = require('../services/facebookChatwootMatrixBridge');
    assert.equal(typeof bridge.observe, 'function');
    const observed = await bridge.observe({ metadata: { pageId: '1203748086150141' } });
    assert.equal(observed.state, 'connected');
    assert.equal(observed.canSend, true);
    assert.equal(observed.canReceive, true);
    assert.equal(observed.chatwootInboxId, '7');
  } finally {
    global.fetch = savedFetch;
    for (const key of ENV_KEYS) savedEnv[key] === undefined ? delete process.env[key] : process.env[key] = savedEnv[key];
  }
});
test('AccountManager observes Facebook Page live authority even though it is not a mautrix driver', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../services/accountManagerCore.js'), 'utf8');
  assert.match(source, /facebook-page-official/u);
  assert.match(source, /driver\.observe\(account/u);
  assert.match(source, /pageObservation/u);
});
