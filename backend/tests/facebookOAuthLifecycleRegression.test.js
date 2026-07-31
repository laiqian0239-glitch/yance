'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const accountStore = require('../services/accountStore');
const platformAuthConfig = require('../services/platformAuthConfig');
const facebookOAuthService = require('../services/facebookOAuthService');
const relayClient = require('../services/facebookRelayClient');
const { getSecurityGuard } = require('../core/securityGuardSingleton');

const securityGuard = getSecurityGuard();

function patch(t, object, key, value) {
  const original = object[key];
  object[key] = value;
  t.after(() => { object[key] = original; });
}

function fakeAccount() {
  return {
    id: 'facebook-oauth-account',
    platform: 'facebook',
    displayName: 'Facebook',
    identityLabel: '待授权',
    credentialRef: 'facebook-oauth-credential',
    metadata: {}
  };
}

async function installBeginHarness(t) {
  const account = fakeAccount();
  let vault = {};
  patch(t, accountStore, 'get', () => account);
  patch(t, platformAuthConfig, 'facebook', () => ({
    configured: true,
    workerBaseUrl: 'https://yance-facebook.example.workers.dev',
    graphVersion: 'v25.0'
  }));
  patch(t, platformAuthConfig, 'randomSecret', bytes => `secret-${bytes}-${'x'.repeat(bytes)}`);
  patch(t, platformAuthConfig, 'sha256Base64Url', () => 'p'.repeat(43));
  patch(t, relayClient, 'generateDeviceIdentity', () => ({
    deviceId: 'fbdev-test',
    publicKeySpki: 'public-key-spki',
    privateKeyPkcs8: 'private-key-pkcs8'
  }));
  patch(t, securityGuard, 'readCredential', () => vault);
  patch(t, securityGuard, 'persistCredential', async (_ref, value) => { vault = value; return true; });
  patch(t, global, 'fetch', async url => response(200, {
    ok: true, service: 'yance-facebook-gateway', graphVersion: 'v25.0',
    oauthContract: {
      version: 5, authorizationMode: 'business-login-configuration', legacyScopeParameter: false,
      callbackUrl: 'https://yance-facebook.example.workers.dev/oauth/facebook/callback',
      requiredPermissions: ['pages_show_list','pages_messaging','pages_manage_metadata'],
      optionalPermissions: ['pages_read_engagement'],
        pageDiscovery: {
          primary: '/me/accounts', tokenRecovery: ['/{debug_token.user_id}/accounts', '/{granular_target_id}?fields=access_token'],
          selectionEvidence: 'debug_token.granular_scopes.target_ids', directPageProfileProbe: true,
          directPageTokenRecovery: true, directPageTokenFields: ['id,access_token', 'access_token'],
          profileHydration: 'page-access-token', diagnosticsPersistedWithoutTokens: true
        }
    }
  }));
  t.after(() => facebookOAuthService._flows.clear());
  const started = await facebookOAuthService.begin(account.id);
  return { account, started, flow: facebookOAuthService._flows.get(started.flowId), credential: () => vault };
}

function response(status, data) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return data; }
  };
}

test('Facebook OAuth starts only against sealed Worker URL and registers a public device identity', async t => {
  const { started, flow } = await installBeginHarness(t);
  const url = new URL(started.authorizationUrl);
  assert.equal(url.origin, 'https://yance-facebook.example.workers.dev');
  assert.equal(url.pathname, '/oauth/facebook/start');
  assert.equal(url.searchParams.get('flow_id'), started.flowId);
  assert.equal(url.searchParams.get('device_id'), 'fbdev-test');
  assert.equal(url.searchParams.get('public_key'), 'public-key-spki');
  assert.equal(url.searchParams.has('app_id'), false);
  assert.equal(flow.identity.privateKeyPkcs8, 'private-key-pkcs8');
});

test('Facebook OAuth refuses to open a stale Worker that does not publish the no-legacy-scope contract', async t => {
  const account = fakeAccount();
  patch(t, accountStore, 'get', () => account);
  patch(t, platformAuthConfig, 'facebook', () => ({ configured: true, workerBaseUrl: 'https://yance-facebook.example.workers.dev', graphVersion: 'v25.0' }));
  patch(t, global, 'fetch', async () => response(200, { ok: true, service: 'yance-facebook-gateway' }));
  await assert.rejects(
    facebookOAuthService.begin(account.id),
    error => error.code === 'FACEBOOK_WORKER_OAUTH_CONTRACT_STALE'
  );
});

test('Facebook OAuth polling ignores any injected Page Token and exposes only safe Page metadata', async t => {
  const { account, started } = await installBeginHarness(t);
  patch(t, global, 'fetch', async () => response(200, {
    ok: true,
    status: 'authorized',
    pages: [{
      id: 'page-1',
      name: '广告客户收件箱',
      accessToken: 'must-never-reach-desktop',
      permissions: ['pages_show_list', 'pages_messaging', 'pages_manage_metadata', 'pages_read_engagement'],
      tokenStatus: 'active',
      webhookStatus: 'subscribed'
    }]
  }));

  const result = await facebookOAuthService.poll('facebook-oauth-account', started.flowId);
  assert.equal(result.status, 'authorized');
  assert.equal(result.pages[0].id, 'page-1');
  assert.equal(Object.hasOwn(result.pages[0], 'accessToken'), false);
  assert.equal(JSON.stringify(result).includes('must-never-reach-desktop'), false);
});

test('Facebook OAuth polling recovers an authorized flow after the in-memory service state is lost', async t => {
  const { account, started, credential } = await installBeginHarness(t);
  assert.equal(credential().pendingFacebookOAuth.flowId, started.flowId);
  facebookOAuthService._flows.clear();
  patch(t, global, 'fetch', async () => response(200, {
    ok: true,
    status: 'authorized',
    pages: [{ id: 'page-recovered', name: 'Recovered Page', permissions: ['pages_show_list','pages_messaging','pages_manage_metadata'] }]
  }));
  const recovered = await facebookOAuthService.poll(account.id, started.flowId);
  assert.equal(recovered.status, 'authorized');
  assert.equal(recovered.pages[0].id, 'page-recovered');
  assert.equal(credential().pendingFacebookOAuth.status, 'authorized');
});

test('Facebook Page selection completes credential replacement when history permission is absent', async t => {
  const { account, started } = await installBeginHarness(t);
  let selectCalls = 0;
  patch(t, global, 'fetch', async (_url, options = {}) => {
    if ((options.method || 'GET') === 'POST') {
      selectCalls += 1;
      return response(200, { ok: true, cloudAccountId: 'fbacct-limited', workerBaseUrl: 'https://yance-facebook.example.workers.dev', graphVersion: 'v25.0', page: { id: 'page-no-history', name: 'Limited Page', permissions: ['pages_show_list','pages_messaging','pages_manage_metadata'], missingOptionalPermissions: ['pages_read_engagement'], historySyncAvailable: false, historySyncReason: 'pages_read_engagement missing', tokenStatus: 'active', webhookStatus: 'subscribed' } });
    }
    return response(200, {
      ok: true,
      status: 'authorized',
      pages: [{
        id: 'page-no-history',
        name: '缺少历史权限的主页',
        permissions: ['pages_show_list', 'pages_messaging', 'pages_manage_metadata'],
        tokenStatus: 'active',
        webhookStatus: 'subscribed'
      }]
    });
  });

  const authorized = await facebookOAuthService.poll(account.id, started.flowId);
  assert.equal(authorized.status, 'authorized');
  assert.equal(authorized.pages[0].historySyncAvailable, false);
  assert.deepEqual(authorized.pages[0].missingOptionalPermissions, ['pages_read_engagement']);
  patch(t, accountStore, 'update', async (_id, value) => value);
  const selected = await facebookOAuthService.selectPage(account.id, started.flowId, 'page-no-history');
  assert.equal(selected.page.historySyncAvailable, false);
  assert.equal(selectCalls, 1, 'limited history permission must not prevent Page/token/device replacement');
});


test('Facebook Page selection persists cloud account and device identity without Page Token', async t => {
  const { account, started, flow, credential } = await installBeginHarness(t);
  const calls = [];
  patch(t, global, 'fetch', async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || 'GET', authorization: options.headers?.authorization || '', body: options.body || '' });
    if ((options.method || 'GET') === 'POST') return response(200, {
      ok: true,
      cloudAccountId: 'fbacct-cloud-1',
      workerBaseUrl: 'https://yance-facebook.example.workers.dev',
      graphVersion: 'v25.0',
      page: {
        id: 'page-1',
        name: '广告客户收件箱',
        username: 'ad-inbox',
        permissions: ['pages_show_list', 'pages_messaging', 'pages_manage_metadata', 'pages_read_engagement'],
        tokenStatus: 'active',
        webhookStatus: 'subscribed'
      }
    });
    return response(200, {
      ok: true,
      status: 'authorized',
      pages: [{
        id: 'page-1',
        name: '广告客户收件箱',
        permissions: ['pages_show_list', 'pages_messaging', 'pages_manage_metadata', 'pages_read_engagement']
      }]
    });
  });
  let persisted = null;
  let currentCredential = credential();
  patch(t, securityGuard, 'readCredential', () => currentCredential);
  patch(t, securityGuard, 'persistCredential', async (ref, value) => { currentCredential = value; persisted = { ref, value }; return true; });
  let updated = null;
  patch(t, accountStore, 'update', async (_id, value) => { updated = value; return { ...account, ...value }; });
  patch(t, accountStore, 'get', () => ({ ...account, ...(updated || {}) }));

  const authorized = await facebookOAuthService.poll(account.id, started.flowId);
  assert.equal(authorized.status, 'authorized');
  const selected = await facebookOAuthService.selectPage(account.id, started.flowId, 'page-1');

  assert.equal(persisted.ref, account.credentialRef);
  assert.equal(persisted.value.authorizationMode, 'cloudflare-worker');
  assert.equal(persisted.value.cloudAccountId, 'fbacct-cloud-1');
  assert.equal(persisted.value.pageId, 'page-1');
  assert.equal(persisted.value.workerBaseUrl, 'https://yance-facebook.example.workers.dev');
  assert.equal(persisted.value.deviceId, 'fbdev-test');
  assert.equal(persisted.value.devicePrivateKeyPkcs8, 'private-key-pkcs8');
  assert.equal(Object.hasOwn(persisted.value, 'pageAccessToken'), false);
  assert.equal(JSON.stringify(persisted.value).includes('access_token'), false);
  assert.equal(selected.page.permissionReady, true);
  assert.equal(flow.status, 'completed');
  assert.deepEqual(flow.pages, []);
  const selectCall = calls.find(call => call.method === 'POST');
  assert.ok(selectCall);
  assert.match(selectCall.url, new RegExp(`/oauth/facebook/result/${started.flowId}/select$`));
  assert.equal(selectCall.authorization, `Bearer ${flow.clientSecret}`);
  assert.deepEqual(JSON.parse(selectCall.body), { pageId: 'page-1' });
});


test('Facebook OAuth UI stops cancelled flows and reports Page discovery evidence without blaming App Domains', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../frontend/r32-account-center.js'), 'utf8');
  assert.match(source, /\['denied','error','cancelled'\]/u);
  assert.match(source, /\/me\/accounts/u);
  assert.match(source, /target_ids/u);
  assert.match(source, /不要反复修改 App Domains/u);
  assert.doesNotMatch(source, /请检查 Meta 应用域名、精确 OAuth 回调/u);
  assert.match(source, /elapsed < 15000 \? 1300 : elapsed < 60000 \? 2500 : 5000/u);
  assert.match(source, /缺少 pages_read_engagement 时历史对账受限/u);
  assert.match(source, /data-panel-action="facebook-sync-now"/u);
  assert.match(source, /立即执行会话对账/u);
});
