'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const bridgePath = require.resolve('../services/facebookChatwootMatrixBridge');

function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

test('Facebook Page discovery accepts Chatwoot secrets by *_FILE without raw secret env', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-chatwoot-secret-file-'));
  const tokenFile = path.join(dir, 'api-token');
  const webhookFile = path.join(dir, 'webhook-secret');
  const matrixSecretFile = path.join(dir, 'matrix-registration-secret');
  fs.writeFileSync(tokenFile, 'chatwoot-file-token\n', { mode: 0o600 });
  fs.writeFileSync(webhookFile, 'chatwoot-file-webhook-secret\n', { mode: 0o600 });
  fs.writeFileSync(matrixSecretFile, 'matrix-registration-secret\n', { mode: 0o600 });
  const saved = { ...process.env };
  t.after(() => {
    process.env = saved;
    delete require.cache[bridgePath];
    fs.rmSync(dir, { recursive: true, force: true });
  });

  Object.assign(process.env, {
    CHATWOOT_BASE_URL: 'http://chatwoot.test',
    CHATWOOT_ACCOUNT_ID: '2',
    CHATWOOT_API_ACCESS_TOKEN_FILE: tokenFile,
    CHATWOOT_WEBHOOK_SECRET_FILE: webhookFile,
    YANCE_MATRIX_BASE_URL: 'http://matrix.test',
    YANCE_MATRIX_REGISTRATION_SHARED_SECRET_FILE: matrixSecretFile
  });
  delete process.env.CHATWOOT_API_ACCESS_TOKEN;
  delete process.env.CHATWOOT_WEBHOOK_SECRET;
  delete require.cache[bridgePath];

  let seenToken = '';
  const originalFetch = global.fetch;
  global.fetch = async (_url, options = {}) => {
    seenToken = String(options.headers?.api_access_token || '');
    return response({ payload: [{ id: 7, channel_type: 'Channel::FacebookPage', page_id: '123', name: 'Page 123' }] });
  };
  t.after(() => { global.fetch = originalFetch; });

  const bridge = require(bridgePath);
  const inboxes = await bridge.discoverFacebookPageInboxes();
  assert.equal(inboxes.length, 1);
  assert.equal(inboxes[0].pageId, '123');
  assert.equal(seenToken, 'chatwoot-file-token');
  assert.equal(bridge.enabled(), true);
});

test('Electron backend env forwards only Chatwoot public values and secret file references', () => {
  const main = fs.readFileSync(path.resolve(__dirname, '../../electron/main.js'), 'utf8');
  const fnStart = main.indexOf('async function backendEnvironment');
  const deleteLine = main.indexOf('delete env.ELECTRON_RUN_AS_NODE;', fnStart);
  assert.ok(fnStart >= 0 && deleteLine > fnStart);
  const body = main.slice(fnStart, deleteLine);
  for (const key of ['CHATWOOT_BASE_URL', 'CHATWOOT_ACCOUNT_ID', 'CHATWOOT_API_ACCESS_TOKEN_FILE', 'CHATWOOT_WEBHOOK_SECRET_FILE', 'MATRIX_INVITE_USER']) {
    assert.ok(body.includes(`'${key}'`) || body.includes(`\"${key}\"`), `backendEnvironment must forward ${key}`);
  }
  assert.equal(body.includes("'CHATWOOT_API_ACCESS_TOKEN'") || body.includes('\"CHATWOOT_API_ACCESS_TOKEN\"'), false, 'raw Chatwoot API token must not be forwarded');
  assert.equal(body.includes("'CHATWOOT_WEBHOOK_SECRET'") || body.includes('\"CHATWOOT_WEBHOOK_SECRET\"'), false, 'raw Chatwoot webhook secret must not be forwarded');
});
