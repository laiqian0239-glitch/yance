'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { afterEach, test } = require('node:test');
const WebSocket = require('ws');

const { loadConfig } = require('../config');
const { EncryptedStore } = require('../encryptedStore');
const { SUBSCRIBED_FIELDS, createFacebookGateway, relayEnvelope, sha256Base64Url } = require('../gateway');
const relayClient = require('../../../backend/services/facebookRelayClient');
const { verifyEnvelope, relayManagementUrl } = relayClient;

const temporaryRoots = [];
afterEach(() => {
  while (temporaryRoots.length) fs.rmSync(temporaryRoots.pop(), { recursive: true, force: true });
});

function temporaryDirectory() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-facebook-gateway-'));
  temporaryRoots.push(root);
  return root;
}

function baseEnvironment(overrides = {}) {
  return {
    NODE_ENV: 'test',
    YANCE_FACEBOOK_GATEWAY_APP_ID: '123456789012345',
    YANCE_FACEBOOK_GATEWAY_APP_SECRET: 'test-app-secret-at-least-sixteen',
    YANCE_FACEBOOK_GATEWAY_PUBLIC_BASE_URL: 'http://127.0.0.1:8787',
    YANCE_FACEBOOK_GATEWAY_REDIRECT_URI: 'http://127.0.0.1:8787/oauth/facebook/callback',
    YANCE_FACEBOOK_GATEWAY_WEBHOOK_VERIFY_TOKEN: 'test-webhook-verify-token-123456',
    YANCE_FACEBOOK_GATEWAY_MASTER_KEY: Buffer.alloc(32, 7).toString('base64'),
    YANCE_FACEBOOK_GATEWAY_DATA_FILE: path.join(temporaryDirectory(), 'gateway.enc.json'),
    YANCE_FACEBOOK_GRAPH_VERSION: 'v25.0',
    ...overrides
  };
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address()));
  });
}

function closeServer(server) {
  return new Promise(resolve => server.close(() => resolve()));
}

function websocketOpen(url, headers) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { headers });
    const timer = setTimeout(() => reject(new Error('WebSocket open timed out')), 3000);
    socket.once('open', () => { clearTimeout(timer); resolve(socket); });
    socket.once('error', error => { clearTimeout(timer); reject(error); });
  });
}

function websocketMessage(socket) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WebSocket message timed out')), 3000);
    socket.once('message', data => { clearTimeout(timer); resolve(JSON.parse(String(data))); });
    socket.once('error', error => { clearTimeout(timer); reject(error); });
  });
}

function websocketClose(socket) {
  return new Promise(resolve => {
    if (socket.readyState === WebSocket.CLOSED) return resolve();
    const timer = setTimeout(() => { try { socket.terminate(); } catch (_) {} resolve(); }, 3000);
    socket.once('close', (code, reason) => { clearTimeout(timer); resolve({ code, reason: String(reason) }); });
  });
}

test('gateway config requires production HTTPS and accepts an exact 32-byte master key', () => {
  assert.throws(
    () => loadConfig({ ...baseEnvironment(), NODE_ENV: 'production' }),
    error => error.code === 'FACEBOOK_GATEWAY_HTTPS_REQUIRED'
  );
  const config = loadConfig(baseEnvironment());
  assert.equal(config.graphVersion, 'v25.0');
  assert.equal(config.masterKey.length, 32);
  assert.equal(config.publicBaseUrl, 'http://127.0.0.1:8787');
  assert.throws(
    () => loadConfig(baseEnvironment({ YANCE_FACEBOOK_GRAPH_VERSION: 'v23.0' })),
    error => error.code === 'FACEBOOK_GATEWAY_GRAPH_VERSION_UNSUPPORTED'
  );
});

test('encrypted store round-trips without writing secrets as plaintext and rejects a wrong key', () => {
  const root = temporaryDirectory();
  const filePath = path.join(root, 'state.enc.json');
  const key = crypto.randomBytes(32);
  const store = new EncryptedStore({ filePath, key });
  store.save({ schemaVersion: 1, flows: { flow: { secret: 'never-write-this-plaintext' } }, relays: {} });
  const bytes = fs.readFileSync(filePath, 'utf8');
  assert.equal(bytes.includes('never-write-this-plaintext'), false);
  assert.equal(new EncryptedStore({ filePath, key }).snapshot().flows.flow.secret, 'never-write-this-plaintext');
  assert.throws(
    () => new EncryptedStore({ filePath, key: crypto.randomBytes(32) }),
    error => error.code === 'FACEBOOK_GATEWAY_STORE_AUTH_FAILED'
  );
});

test('gateway subscribes to ad referral events as well as message delivery events', () => {
  assert.equal(SUBSCRIBED_FIELDS.includes('messages'), true);
  assert.equal(SUBSCRIBED_FIELDS.includes('messaging_referrals'), true);
});

test('gateway relay envelopes are compatible with the desktop verifier', () => {
  const secret = crypto.randomBytes(32).toString('base64url');
  const envelope = relayEnvelope({ object: 'page', entry: [{ id: 'page-1' }] }, secret);
  assert.equal(verifyEnvelope(envelope, secret), true);
  assert.equal(verifyEnvelope({ ...envelope, body: { object: 'page', entry: [] } }, secret), false);
  assert.equal(relayManagementUrl('wss://gateway.example.com/relay/facebook', '123'), 'https://gateway.example.com/relay/facebook/credentials/123');
});

test('OAuth, Page subscription, signed webhook relay, and remote credential revocation work end to end', async () => {
  const root = temporaryDirectory();
  const appSecret = 'test-app-secret-at-least-sixteen';
  const config = {
    appId: '123456789012345',
    appSecret,
    publicBaseUrl: 'http://127.0.0.1',
    redirectUri: 'http://127.0.0.1/oauth/facebook/callback',
    verifyToken: 'test-webhook-verify-token-123456',
    masterKey: crypto.randomBytes(32),
    graphVersion: 'v25.0',
    dataFile: path.join(root, 'gateway.enc.json'),
    flowTtlMs: 10 * 60 * 1000,
    maxBodyBytes: 2 * 1024 * 1024,
    trustProxy: false
  };
  const calls = [];
  const fakeFetch = async (input, options = {}) => {
    const url = new URL(String(input));
    calls.push({ url: url.toString(), method: options.method || 'GET', authorization: options.headers?.Authorization || options.headers?.authorization || '' });
    let data;
    if (url.pathname.endsWith('/oauth/access_token') && url.searchParams.get('grant_type') === 'fb_exchange_token') {
      data = { access_token: 'long-user-token' };
    } else if (url.pathname.endsWith('/oauth/access_token')) {
      data = { access_token: 'short-user-token' };
    } else if (url.pathname.endsWith('/me/permissions')) {
      data = { data: [
        { permission: 'pages_show_list', status: 'granted' },
        { permission: 'pages_messaging', status: 'granted' },
        { permission: 'pages_manage_metadata', status: 'granted' }
      ] };
    } else if (url.pathname.endsWith('/me/accounts')) {
      data = { data: [{ id: '100200300', name: 'Yance Test Page', username: 'yance-test', access_token: 'page-access-token', tasks: ['MESSAGING'] }] };
    } else if (url.pathname.endsWith('/100200300/subscribed_apps') && options.method === 'POST') {
      data = { success: true };
    } else {
      return new Response(JSON.stringify({ error: { message: `unexpected graph request ${url}` } }), { status: 404, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const logger = { info() {}, warn() {}, error() {} };
  const store = new EncryptedStore({ filePath: config.dataFile, key: config.masterKey });
  const gateway = createFacebookGateway({ config, store, fetchImpl: fakeFetch, logger });
  const server = http.createServer(gateway.app);
  server.on('upgrade', gateway.handleUpgrade);
  const address = await listen(server);
  const base = `http://127.0.0.1:${address.port}`;
  const flowId = crypto.randomUUID();
  const desktopState = crypto.randomBytes(24).toString('base64url');
  const clientSecret = crypto.randomBytes(32).toString('base64url');
  const startUrl = new URL(`${base}/oauth/facebook/start`);
  startUrl.searchParams.set('flow_id', flowId);
  startUrl.searchParams.set('state', desktopState);
  startUrl.searchParams.set('client_proof', sha256Base64Url(clientSecret));
  startUrl.searchParams.set('app_id', config.appId);
  startUrl.searchParams.set('graph_version', config.graphVersion);

  try {
    const startResponse = await fetch(startUrl, { redirect: 'manual' });
    assert.equal(startResponse.status, 302);
    const metaAuthorization = new URL(startResponse.headers.get('location'));
    assert.equal(metaAuthorization.hostname, 'www.facebook.com');
    assert.equal(metaAuthorization.searchParams.get('client_id'), config.appId);
    const oauthState = metaAuthorization.searchParams.get('state');
    assert.ok(oauthState);

    const callbackResponse = await fetch(`${base}/oauth/facebook/callback?state=${encodeURIComponent(oauthState)}&code=authorization-code`);
    assert.equal(callbackResponse.status, 200);
    assert.match(await callbackResponse.text(), /Facebook 授权完成/);
    assert.equal(calls.some(call => call.url.includes('/100200300/subscribed_apps') && call.method === 'POST'), true);
    const protectedGraphCalls = calls.filter(call => !new URL(call.url).pathname.endsWith('/oauth/access_token'));
    assert.equal(protectedGraphCalls.every(call => !new URL(call.url).searchParams.has('access_token')), true);
    assert.equal(protectedGraphCalls.find(call => call.url.includes('/me/permissions'))?.authorization, 'Bearer long-user-token');
    assert.equal(protectedGraphCalls.find(call => call.url.includes('/me/accounts'))?.authorization, 'Bearer long-user-token');
    assert.equal(protectedGraphCalls.find(call => call.url.includes('/100200300/subscribed_apps'))?.authorization, 'Bearer page-access-token');

    const deniedResult = await fetch(`${base}/oauth/facebook/result/${flowId}`, { headers: { authorization: 'Bearer wrong-secret' } });
    assert.equal(deniedResult.status, 401);

    const resultResponse = await fetch(`${base}/oauth/facebook/result/${flowId}`, { headers: { authorization: `Bearer ${clientSecret}` } });
    assert.equal(resultResponse.status, 200);
    const result = await resultResponse.json();
    assert.equal(result.status, 'authorized');
    assert.equal(result.clientState, desktopState);
    assert.equal(result.pages.length, 1);
    const page = result.pages[0];
    assert.equal(page.id, '100200300');
    assert.equal(page.subscriptionReady, true);
    assert.equal(page.permissions.includes('pages_messaging'), true);
    assert.ok(page.relayToken);
    assert.ok(page.relaySecret);

    const wsUrl = `ws://127.0.0.1:${address.port}/relay/facebook`;
    const socket = await websocketOpen(wsUrl, { authorization: `Bearer ${page.relayToken}`, 'x-yance-page-id': page.id });
    const received = websocketMessage(socket);
    const webhookBody = { object: 'page', entry: [{ id: page.id, time: Date.now(), messaging: [{ sender: { id: 'user-1' }, recipient: { id: page.id }, timestamp: Date.now(), message: { mid: 'm-1', text: 'hello' } }] }] };
    const rawBody = JSON.stringify(webhookBody);
    const signature = `sha256=${crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
    const webhookResponse = await fetch(`${base}/webhooks/facebook`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature }, body: rawBody });
    assert.equal(webhookResponse.status, 200);
    const delivery = await webhookResponse.json();
    assert.equal(delivery.delivered, 1);
    const envelope = await received;
    assert.equal(envelope.body.entry[0].messaging[0].message.text, 'hello');
    assert.equal(verifyEnvelope(envelope, page.relaySecret), true);

    const invalidWebhook = await fetch(`${base}/webhooks/facebook`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=bad' }, body: rawBody });
    assert.equal(invalidWebhook.status, 401);

    const closing = websocketClose(socket);
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';
    let revoke;
    try { revoke = await relayClient.revoke('desktop-account', { ...page, pageId: page.id, relayUrl: wsUrl }); }
    finally { if (previousNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousNodeEnv; }
    assert.deepEqual(revoke, { revoked: true, skipped: false });
    const closed = await closing;
    assert.equal(closed.code, 4001);
    assert.equal(gateway.snapshot().relays[page.id], undefined);
    assert.equal(gateway.snapshot().flows[flowId].pages.length, 0);
    assert.equal(gateway.snapshot().flows[flowId].status, 'revoked');
    assert.equal(new EncryptedStore({ filePath: config.dataFile, key: config.masterKey }).snapshot().relays[page.id], undefined);

    const repeatedRevoke = await fetch(`${base}/relay/facebook/credentials/${page.id}`, { method: 'DELETE', headers: { authorization: `Bearer ${page.relayToken}` } });
    assert.equal(repeatedRevoke.status, 401);

    const consumeResponse = await fetch(`${base}/oauth/facebook/result/${flowId}`, { method: 'DELETE', headers: { authorization: `Bearer ${clientSecret}` } });
    assert.equal(consumeResponse.status, 200);
    assert.deepEqual(await consumeResponse.json(), { ok: true, consumed: true, flowId });
    assert.equal(gateway.snapshot().flows[flowId], undefined);
  } finally {
    gateway.close();
    await closeServer(server);
  }
});
