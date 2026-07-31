import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { route } from '../src/index.js';
import { seedAccountDevice, testEnv, waitContext } from './testHarness.js';

const require = createRequire(import.meta.url);
const relayModule = require('../../../backend/services/facebookRelayClient.js');

function desktopRequest(secret, path, { method = 'GET', body = null, idempotencyKey = '' } = {}) {
  const url = new URL(path, secret.workerBaseUrl).toString();
  const bodyText = body == null ? '' : JSON.stringify(body);
  const headers = {
    accept: 'application/json',
    ...relayModule.signedHeaders(secret, url, method, bodyText, idempotencyKey),
    ...(bodyText ? { 'content-type': 'application/json' } : {})
  };
  return new Request(url, { method, headers, body: bodyText || undefined });
}

test('Desktop CommonJS signer is accepted by Worker and account response contains no Page Token', async t => {
  const env = testEnv();
  t.after(() => env.DB.close());
  const identity = relayModule.generateDeviceIdentity();
  await seedAccountDevice(env, { deviceId: identity.deviceId, publicKeySpki: identity.publicKeySpki, pageToken: 'worker-only-page-token' });
  const secret = { workerBaseUrl: env.WORKER_BASE_URL, deviceId: identity.deviceId, devicePrivateKeyPkcs8: identity.privateKeyPkcs8 };
  const response = await route(desktopRequest(secret, '/api/desktop/accounts'), env, waitContext());
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.ok, true);
  assert.equal(data.accounts.length, 1);
  assert.equal(data.accounts[0].pageId, 'page-100');
  assert.equal(data.accounts[0].pagePicture, 'https://scontent.fbcdn.net/page-avatar.jpg');
  assert.equal(JSON.stringify(data).includes('worker-only-page-token'), false);
  assert.equal(Object.hasOwn(data.accounts[0], 'accessToken'), false);
});

test('Desktop history, message pagination and profile contract use Worker-owned Page Token', async t => {
  const env = testEnv();
  t.after(() => env.DB.close());
  const identity = relayModule.generateDeviceIdentity();
  await seedAccountDevice(env, { deviceId: identity.deviceId, publicKeySpki: identity.publicKeySpki, pageToken: 'worker-only-page-token' });
  const secret = { workerBaseUrl: env.WORKER_BASE_URL, deviceId: identity.deviceId, devicePrivateKeyPkcs8: identity.privateKeyPkcs8 };
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(String(input));
    calls.push({ url: url.toString(), authorization: options.headers?.authorization || options.headers?.Authorization || '' });
    if (url.pathname.endsWith('/page-100/conversations')) return new Response(JSON.stringify({ data: [{ id: 't_conversation-1', messages: { data: [] } }], paging: { cursors: { after: 'next-conversations' }, next: 'https://graph.facebook.com/next' } }), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url.pathname.endsWith('/t_conversation-1/messages')) return new Response(JSON.stringify({ data: [{ id: 'mid-1', message: 'hello' }], paging: { cursors: { after: 'next-messages' }, next: 'https://graph.facebook.com/next' } }), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url.pathname.endsWith('/123456')) return new Response(JSON.stringify({ first_name: 'Ada', last_name: 'Lovelace', profile_pic: 'https://scontent.fbcdn.net/avatar.jpg' }), { status: 200, headers: { 'content-type': 'application/json' } });
    throw new Error(`unexpected Meta URL: ${url}`);
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const history = await (await route(desktopRequest(secret, '/api/desktop/history?limit=20&messages_limit=10'), env, waitContext())).json();
  assert.equal(history.data[0].id, 't_conversation-1');
  assert.equal(history.paging.cursors.after, 'next-conversations');

  const messages = await (await route(desktopRequest(secret, '/api/desktop/history/messages?conversation_id=t_conversation-1&limit=10&after=cursor'), env, waitContext())).json();
  assert.equal(messages.data[0].id, 'mid-1');
  assert.equal(messages.paging.cursors.after, 'next-messages');

  const profile = await (await route(desktopRequest(secret, '/api/desktop/profile?psid=123456'), env, waitContext())).json();
  assert.equal(profile.firstName, 'Ada');
  assert.equal(profile.lastName, 'Lovelace');
  assert.equal(profile.profilePicture, 'https://scontent.fbcdn.net/avatar.jpg');

  assert.equal(calls.length, 3);
  assert.ok(calls.every(call => call.authorization === 'Bearer worker-only-page-token'));
  assert.equal(JSON.stringify({ history, messages, profile }).includes('worker-only-page-token'), false);
});

test('Desktop signed avatar routes proxy Page and contact images without exposing the Page Token', async t => {
  const env = testEnv();
  t.after(() => env.DB.close());
  const identity = relayModule.generateDeviceIdentity();
  await seedAccountDevice(env, { deviceId: identity.deviceId, publicKeySpki: identity.publicKeySpki, pageToken: 'worker-only-page-token' });
  const secret = { workerBaseUrl: env.WORKER_BASE_URL, deviceId: identity.deviceId, devicePrivateKeyPkcs8: identity.privateKeyPkcs8 };
  const originalFetch = globalThis.fetch;
  const calls = [];
  const pageBytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);
  const profileBytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47]);
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(String(input));
    const authorization = options.headers?.authorization || options.headers?.Authorization || '';
    calls.push({ url: url.toString(), authorization });
    if (url.pathname.endsWith('/123456')) {
      assert.equal(authorization, 'Bearer worker-only-page-token');
      return new Response(JSON.stringify({ first_name: 'Ada', last_name: 'Lovelace', profile_pic: 'https://scontent.fbcdn.net/contact-avatar.png' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.hostname === 'scontent.fbcdn.net' && url.pathname === '/page-avatar.jpg') {
      assert.equal(authorization, '');
      return new Response(pageBytes, { status: 200, headers: { 'content-type': 'image/jpeg', 'content-length': String(pageBytes.length) } });
    }
    if (url.hostname === 'scontent.fbcdn.net' && url.pathname === '/contact-avatar.png') {
      assert.equal(authorization, '');
      return new Response(profileBytes, { status: 200, headers: { 'content-type': 'image/png', 'content-length': String(profileBytes.length) } });
    }
    throw new Error(`unexpected avatar URL: ${url}`);
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const pageResponse = await route(desktopRequest(secret, '/api/desktop/avatar/page'), env, waitContext());
  assert.equal(pageResponse.status, 200);
  assert.equal(pageResponse.headers.get('content-type'), 'image/jpeg');
  assert.deepEqual(new Uint8Array(await pageResponse.arrayBuffer()), pageBytes);

  const profileResponse = await route(desktopRequest(secret, '/api/desktop/avatar/profile?psid=123456'), env, waitContext());
  assert.equal(profileResponse.status, 200);
  assert.equal(profileResponse.headers.get('content-type'), 'image/png');
  assert.deepEqual(new Uint8Array(await profileResponse.arrayBuffer()), profileBytes);

  assert.equal(calls.length, 3);
  assert.equal(calls.some(call => call.url.includes('worker-only-page-token')), false);
});

test('Desktop avatar routes fall back to the official Graph picture edge when profile fields are unavailable', async t => {
  const env = testEnv();
  t.after(() => env.DB.close());
  const identity = relayModule.generateDeviceIdentity();
  await seedAccountDevice(env, {
    deviceId: identity.deviceId,
    publicKeySpki: identity.publicKeySpki,
    pageToken: 'worker-only-page-token',
    pagePicture: ''
  });
  const secret = { workerBaseUrl: env.WORKER_BASE_URL, deviceId: identity.deviceId, devicePrivateKeyPkcs8: identity.privateKeyPkcs8 };
  const originalFetch = globalThis.fetch;
  const imageBytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);
  const calls = [];
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(String(input));
    const authorization = options.headers?.authorization || options.headers?.Authorization || '';
    calls.push({ url: url.toString(), authorization });
    if (url.pathname.endsWith('/page-100') || url.pathname.endsWith('/123456')) {
      return new Response(JSON.stringify({ error: { message: 'profile fields unavailable', code: 100 } }), { status: 400, headers: { 'content-type': 'application/json' } });
    }
    if (url.pathname.endsWith('/page-100/picture') || url.pathname.endsWith('/123456/picture')) {
      assert.equal(authorization, 'Bearer worker-only-page-token');
      return new Response(null, { status: 302, headers: { location: 'https://scontent.fbcdn.net/fallback-avatar.jpg' } });
    }
    if (url.hostname === 'scontent.fbcdn.net' && url.pathname === '/fallback-avatar.jpg') {
      assert.equal(authorization, '');
      return new Response(imageBytes, { status: 200, headers: { 'content-type': 'image/jpeg', 'content-length': String(imageBytes.length) } });
    }
    throw new Error(`unexpected avatar URL: ${url}`);
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const pageResponse = await route(desktopRequest(secret, '/api/desktop/avatar/page'), env, waitContext());
  assert.equal(pageResponse.status, 200);
  assert.deepEqual(new Uint8Array(await pageResponse.arrayBuffer()), imageBytes);

  const profileResponse = await route(desktopRequest(secret, '/api/desktop/avatar/profile?psid=123456'), env, waitContext());
  assert.equal(profileResponse.status, 200);
  assert.deepEqual(new Uint8Array(await profileResponse.arrayBuffer()), imageBytes);
  assert.equal(calls.some(call => call.url.includes('worker-only-page-token')), false);
});


test('Desktop contact avatar denial is classified separately from account health and exposes only non-secret diagnostics', async t => {
  const env = testEnv();
  t.after(() => env.DB.close());
  const identity = relayModule.generateDeviceIdentity();
  await seedAccountDevice(env, { deviceId: identity.deviceId, publicKeySpki: identity.publicKeySpki, pageToken: 'worker-only-page-token' });
  const secret = { workerBaseUrl: env.WORKER_BASE_URL, deviceId: identity.deviceId, devicePrivateKeyPkcs8: identity.privateKeyPkcs8 };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/123456') || url.pathname.endsWith('/123456/picture')) {
      return new Response(JSON.stringify({ error: { message: 'Missing permission to load this user profile', code: 100, error_subcode: 33 } }), { status: 400, headers: { 'content-type': 'application/json' } });
    }
    throw new Error(`unexpected Meta URL: ${url}`);
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  await assert.rejects(
    () => route(desktopRequest(secret, '/api/desktop/avatar/profile?psid=123456'), env, waitContext()),
    error => {
      assert.equal(error.status, 409);
      assert.equal(error.code, 'FACEBOOK_CONTACT_PROFILE_ACCESS_DENIED');
      assert.equal(error.details.diagnosis, 'meta-contact-profile-access-denied');
      assert.equal(error.details.tokenType, 'page_access_token');
      assert.equal(error.details.profileMetaReason, 'missing_permission');
      assert.equal(error.details.identityPictureMetaReason, 'missing_permission');
      assert.equal(error.details.pictureEdgeMetaReason, 'missing_permission');
      assert.equal(JSON.stringify(error.details).includes('worker-only-page-token'), false);
      return true;
    }
  );
});

test('Desktop exposes new-message readiness but rejects history when pages_read_engagement is absent', async t => {
  const env = testEnv();
  t.after(() => env.DB.close());
  const identity = relayModule.generateDeviceIdentity();
  await seedAccountDevice(env, { deviceId: identity.deviceId, publicKeySpki: identity.publicKeySpki, pageToken: 'worker-only-page-token' });
  env.DB.database.prepare('UPDATE facebook_accounts SET permissions_json=? WHERE id=?').run(JSON.stringify(['pages_show_list','pages_messaging','pages_manage_metadata']), 'fbacct_test');
  const secret = { workerBaseUrl: env.WORKER_BASE_URL, deviceId: identity.deviceId, devicePrivateKeyPkcs8: identity.privateKeyPkcs8 };
  const accounts = await (await route(desktopRequest(secret, '/api/desktop/accounts'), env, waitContext())).json();
  assert.equal(accounts.accounts[0].capabilities.newMessagingReady, true);
  assert.equal(accounts.accounts[0].capabilities.historySyncAvailable, false);
  await assert.rejects(route(desktopRequest(secret, '/api/desktop/history'), env, waitContext()), error => (
    error.code === 'FACEBOOK_HISTORY_PERMISSION_MISSING' && error.details.missingPermission === 'pages_read_engagement'
  ));
});

test('Desktop send contract returns Meta message ID, is idempotent, and ignores arbitrary Graph path input', async t => {
  const env = testEnv();
  t.after(() => env.DB.close());
  const identity = relayModule.generateDeviceIdentity();
  await seedAccountDevice(env, { deviceId: identity.deviceId, publicKeySpki: identity.publicKeySpki, pageToken: 'worker-only-page-token' });
  const secret = { workerBaseUrl: env.WORKER_BASE_URL, deviceId: identity.deviceId, devicePrivateKeyPkcs8: identity.privateKeyPkcs8 };
  const originalFetch = globalThis.fetch;
  let metaCalls = 0;
  globalThis.fetch = async (input, options = {}) => {
    metaCalls += 1;
    assert.match(String(input), /\/v25\.0\/me\/messages$/);
    assert.equal(options.headers.authorization, 'Bearer worker-only-page-token');
    const payload = JSON.parse(options.body);
    assert.equal(Object.hasOwn(payload, 'graphPath'), false);
    return new Response(JSON.stringify({ message_id: 'meta-mid-1', recipient_id: '123456' }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const body = { kind: 'text', recipientId: '123456', text: '你好', graphPath: '/me/accounts' };
  const firstData = await (await route(desktopRequest(secret, '/api/desktop/send', { method: 'POST', body, idempotencyKey: 'local-message-1' }), env, waitContext())).json();
  const secondData = await (await route(desktopRequest(secret, '/api/desktop/send', { method: 'POST', body, idempotencyKey: 'local-message-1' }), env, waitContext())).json();

  assert.equal(firstData.messageId, 'meta-mid-1');
  assert.equal(secondData.messageId, 'meta-mid-1');
  assert.equal(metaCalls, 1);
  assert.equal(JSON.stringify(firstData).includes('worker-only-page-token'), false);
});

test('Device-local disconnect keeps the Page account and other desktop device active', async t => {
  const env = testEnv();
  t.after(() => env.DB.close());
  const firstIdentity = relayModule.generateDeviceIdentity();
  const secondIdentity = relayModule.generateDeviceIdentity();
  await seedAccountDevice(env, { deviceId: firstIdentity.deviceId, publicKeySpki: firstIdentity.publicKeySpki, pageToken: 'worker-only-page-token' });
  const now = new Date().toISOString();
  env.DB.database.prepare(`INSERT INTO facebook_desktop_devices(id,account_id,page_id,public_key_spki,status,display_name,registration_proof,created_at,updated_at) VALUES(?,?,?,?,'active','Second Device','proof-2',?,?)`).run(secondIdentity.deviceId, 'fbacct_test', 'page-100', secondIdentity.publicKeySpki, now, now);
  const secret = { workerBaseUrl: env.WORKER_BASE_URL, deviceId: firstIdentity.deviceId, devicePrivateKeyPkcs8: firstIdentity.privateKeyPkcs8 };
  const response = await route(desktopRequest(secret, '/api/desktop/disconnect', { method: 'POST', body: { unsubscribe: false, disconnectAccount: false } }), env, waitContext());
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.disconnected, true);
  assert.equal(data.accountDisconnected, false);
  const first = env.DB.database.prepare(`SELECT status FROM facebook_desktop_devices WHERE id=?`).get(firstIdentity.deviceId);
  const second = env.DB.database.prepare(`SELECT status FROM facebook_desktop_devices WHERE id=?`).get(secondIdentity.deviceId);
  const account = env.DB.database.prepare(`SELECT disconnected_at,token_status,webhook_status FROM facebook_accounts WHERE id='fbacct_test'`).get();
  assert.equal(first.status, 'disabled');
  assert.equal(second.status, 'active');
  assert.equal(account.disconnected_at, null);
  assert.equal(account.token_status, 'active');
  assert.equal(account.webhook_status, 'subscribed');
});

test('Last active desktop device disconnects the cloud account and revokes the Worker-held Page Token', async t => {
  const env = testEnv();
  t.after(() => env.DB.close());
  const identity = relayModule.generateDeviceIdentity();
  await seedAccountDevice(env, { deviceId: identity.deviceId, publicKeySpki: identity.publicKeySpki, pageToken: 'worker-only-page-token' });
  const secret = { workerBaseUrl: env.WORKER_BASE_URL, deviceId: identity.deviceId, devicePrivateKeyPkcs8: identity.privateKeyPkcs8 };
  const originalFetch = globalThis.fetch;
  const metaCalls = [];
  globalThis.fetch = async (input, options = {}) => {
    metaCalls.push({ url: String(input), method: options.method, authorization: options.headers?.authorization || options.headers?.Authorization || '' });
    return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const response = await route(desktopRequest(secret, '/api/desktop/disconnect', { method: 'POST', body: { disconnectAccount: false } }), env, waitContext());
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.disconnected, true);
  assert.equal(data.accountDisconnected, true);
  assert.equal(data.remainingDevices, 0);
  assert.equal(metaCalls.length, 1);
  assert.match(metaCalls[0].url, /\/page-100\/subscribed_apps$/);
  assert.equal(metaCalls[0].method, 'DELETE');
  assert.equal(metaCalls[0].authorization, 'Bearer worker-only-page-token');

  const device = env.DB.database.prepare(`SELECT status FROM facebook_desktop_devices WHERE id=?`).get(identity.deviceId);
  const account = env.DB.database.prepare(`SELECT disconnected_at,token_status,webhook_status FROM facebook_accounts WHERE id='fbacct_test'`).get();
  const token = env.DB.database.prepare(`SELECT token_status,revoked_at FROM facebook_page_tokens WHERE account_id='fbacct_test'`).get();
  assert.equal(device.status, 'disabled');
  assert.ok(account.disconnected_at);
  assert.equal(account.token_status, 'revoked');
  assert.equal(account.webhook_status, 'unsubscribed');
  assert.equal(token.token_status, 'revoked');
  assert.ok(token.revoked_at);
});

test('Desktop polling does not ACK when local adapter or SQLite processing fails', async t => {
  const originalNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';
  t.after(() => {
    if (originalNodeEnv == null) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  });
  const identity = relayModule.generateDeviceIdentity();
  const secret = { workerBaseUrl: 'https://worker.test', deviceId: identity.deviceId, devicePrivateKeyPkcs8: identity.privateKeyPkcs8 };
  const account = { id: 'local-facebook-account' };
  const client = new relayModule.FacebookRelayClient();
  const originalFetch = globalThis.fetch;
  const paths = [];
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    paths.push(url.pathname);
    if (url.pathname === '/api/desktop/events') return new Response(JSON.stringify({ ok: true, events: [{ delivery_id: 'delivery-1', event_id: 'event-1', lease_token: 'lease-1', payload: { object: 'page', entry: [] } }], has_more: false }), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url.pathname === '/api/desktop/ack') throw new Error('ACK must not be called');
    throw new Error(`unexpected URL ${url}`);
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  const result = await client.syncOnce(account, secret, async () => { throw Object.assign(new Error('SQLite write failed'), { code: 'SQLITE_WRITE_FAILED' }); });
  assert.deepEqual(result, { received: 1, acked: 0, hasMore: false, syncedAt: result.syncedAt });
  assert.deepEqual(paths, ['/api/desktop/events']);
});

test('Desktop deterministic unsupported_get contact avatar failures are non-retryable and do not downgrade account health', async t => {
  const env = testEnv();
  t.after(() => env.DB.close());
  const identity = relayModule.generateDeviceIdentity();
  await seedAccountDevice(env, { deviceId: identity.deviceId, publicKeySpki: identity.publicKeySpki, pageToken: 'worker-only-page-token' });
  const secret = { workerBaseUrl: env.WORKER_BASE_URL, deviceId: identity.deviceId, devicePrivateKeyPkcs8: identity.privateKeyPkcs8 };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/123456') || url.pathname.endsWith('/123456/picture')) {
      return new Response(JSON.stringify({
        error: { message: 'Unsupported get request. Object cannot be loaded.', code: 100, error_subcode: 33 }
      }), { status: 400, headers: { 'content-type': 'application/json' } });
    }
    throw new Error(`unexpected Meta URL: ${url}`);
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  await assert.rejects(
    () => route(desktopRequest(secret, '/api/desktop/avatar/profile?psid=123456'), env, waitContext()),
    error => {
      assert.equal(error.status, 409);
      assert.equal(error.code, 'FACEBOOK_CONTACT_AVATAR_UNSUPPORTED_GET');
      assert.equal(error.details.diagnosis, 'meta-contact-avatar-unsupported-get');
      assert.equal(error.details.deterministic, true);
      assert.equal(error.details.retryable, false);
      assert.equal(error.details.profileMetaReason, 'unsupported_get');
      assert.equal(error.details.identityPictureMetaReason, 'unsupported_get');
      assert.equal(error.details.pictureEdgeMetaReason, 'unsupported_get');
      assert.equal(JSON.stringify(error.details).includes('worker-only-page-token'), false);
      return true;
    }
  );
});
