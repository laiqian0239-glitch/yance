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

function response(status, data) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return data; }
  };
}

test('Facebook Page OAuth begin fails closed to Chatwoot before any Worker or device authority is touched', async t => {
  const account = fakeAccount();
  let configCalls = 0;
  let deviceCalls = 0;
  let fetchCalls = 0;

  patch(t, accountStore, 'get', () => account);
  patch(t, platformAuthConfig, 'facebook', () => {
    configCalls += 1;
    return {
      configured: true,
      workerBaseUrl: 'https://yance-facebook.example.workers.dev',
      graphVersion: 'v25.0'
    };
  });
  patch(t, relayClient, 'generateDeviceIdentity', () => {
    deviceCalls += 1;
    return {
      deviceId: 'must-not-be-created',
      publicKeySpki: 'must-not-be-created',
      privateKeyPkcs8: 'must-not-be-created'
    };
  });
  patch(t, global, 'fetch', async () => {
    fetchCalls += 1;
    throw new Error('Page OAuth must not call the legacy Worker');
  });

  await assert.rejects(
    facebookOAuthService.begin(account.id),
    error => error.code === 'FACEBOOK_PAGE_OAUTH_OWNED_BY_CHATWOOT' && error.status === 409
  );

  assert.equal(configCalls, 0, 'Page cutover must happen before legacy Worker configuration is read');
  assert.equal(deviceCalls, 0, 'Page cutover must not generate a Worker device identity');
  assert.equal(fetchCalls, 0, 'Page cutover must not call the legacy Worker');
  assert.equal(facebookOAuthService._flows.size, 0, 'Page cutover must not create a legacy Worker flow');
});

test('Facebook Page polling cannot resume a legacy Worker flow after Chatwoot becomes authority', async t => {
  const account = fakeAccount();
  const flowId = 'legacy-page-flow';
  let fetchCalls = 0;

  patch(t, accountStore, 'get', () => account);
  patch(t, global, 'fetch', async () => {
    fetchCalls += 1;
    throw new Error('Legacy Page polling must remain unreachable');
  });
  facebookOAuthService._flows.set(flowId, {
    flowId,
    accountId: account.id,
    clientSecret: 'legacy-secret',
    createdAt: new Date().toISOString(),
    createdMs: Date.now(),
    status: 'pending',
    mode: 'page',
    pages: [],
    workerBaseUrl: 'https://yance-facebook.example.workers.dev',
    graphVersion: 'v25.0'
  });
  t.after(() => facebookOAuthService._flows.delete(flowId));

  await assert.rejects(
    facebookOAuthService.poll(account.id, flowId),
    error => error.code === 'FACEBOOK_PAGE_OAUTH_OWNED_BY_CHATWOOT' && error.status === 409
  );
  assert.equal(fetchCalls, 0, 'legacy Page polling must fail before any Worker request');
});

test('Facebook Page selection is retired and cannot persist legacy Worker Page authority', async () => {
  await assert.rejects(
    facebookOAuthService.selectPage('facebook-oauth-account', 'legacy-page-flow', 'page-1'),
    error => error.code === 'FACEBOOK_PAGE_OAUTH_OWNED_BY_CHATWOOT' && error.status === 409
  );
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

test('official Facebook personal identity login completes without Page selection and never grants Messenger capability', async t => {
  const account = {
    ...fakeAccount(),
    id: 'facebook-personal-identity-account',
    credentialRef: 'facebook-personal-identity-credential',
    metadata: { accountKind: 'personal-identity', driverId: 'facebook-personal-identity-official', authorizationPending: true }
  };
  let vault = {
    pageId: 'old-page',
    cloudAccountId: 'old-cloud',
    workerBaseUrl: 'https://old-worker.example',
    devicePrivateKeyPkcs8: 'old-private',
    authorizationMode: 'cloudflare-worker'
  };
  let updated = null;
  patch(t, accountStore, 'get', () => ({ ...account, ...(updated || {}) }));
  patch(t, accountStore, 'update', async (_id, value) => {
    updated = value;
    return { ...account, ...value };
  });
  patch(t, platformAuthConfig, 'facebook', () => ({
    configured: true,
    workerBaseUrl: 'https://yance-facebook.example.workers.dev',
    graphVersion: 'v25.0'
  }));
  patch(t, platformAuthConfig, 'randomSecret', bytes => `secret-${bytes}-${'x'.repeat(bytes)}`);
  patch(t, platformAuthConfig, 'sha256Base64Url', () => 'p'.repeat(43));
  patch(t, relayClient, 'generateDeviceIdentity', () => ({
    deviceId: 'fbdev-identity',
    publicKeySpki: 'identity-public-key',
    privateKeyPkcs8: 'identity-private-key'
  }));
  patch(t, securityGuard, 'readCredential', () => vault);
  patch(t, securityGuard, 'persistCredential', async (_ref, value) => {
    vault = value;
    return true;
  });
  patch(t, global, 'fetch', async url => {
    const target = String(url);
    if (target.endsWith('/healthz')) return response(200, {
      ok: true,
      service: 'yance-facebook-gateway',
      graphVersion: 'v25.0',
      oauthContract: {
        version: 6,
        supportedModes: ['page', 'identity'],
        personalIdentity: { messagingSupported: false, tokenReturnedToDesktop: false },
        authorizationMode: 'business-login-configuration',
        legacyScopeParameter: false,
        callbackUrl: 'https://yance-facebook.example.workers.dev/oauth/facebook/callback',
        requiredPermissions: ['pages_show_list', 'pages_messaging', 'pages_manage_metadata'],
        optionalPermissions: ['pages_read_engagement'],
        pageDiscovery: {
          primary: '/me/accounts',
          tokenRecovery: ['/{debug_token.user_id}/accounts', '/{granular_target_id}?fields=access_token'],
          selectionEvidence: 'debug_token.granular_scopes.target_ids',
          directPageProfileProbe: true,
          directPageTokenRecovery: true,
          directPageTokenFields: ['id,access_token', 'access_token'],
          profileHydration: 'page-access-token',
          diagnosticsPersistedWithoutTokens: true
        }
      }
    });
    return response(200, {
      ok: true,
      mode: 'identity',
      status: 'authorized',
      pages: [],
      identity: {
        userId: 'user-identity-1',
        displayName: 'Identity User',
        avatarUrl: 'https://example.test/identity.png',
        messagingSupported: false
      }
    });
  });
  t.after(() => facebookOAuthService._flows.clear());

  const started = await facebookOAuthService.begin(account.id);
  assert.equal(started.mode, 'identity');
  assert.equal(new URL(started.authorizationUrl).searchParams.get('mode'), 'identity');
  const completed = await facebookOAuthService.poll(account.id, started.flowId);
  assert.equal(completed.status, 'completed');
  assert.equal(completed.mode, 'identity');
  assert.equal(completed.identity.messagingSupported, false);
  assert.equal(vault.userId, 'user-identity-1');
  assert.match(vault.identityReceipt, /^[a-f0-9]{64}$/u);
  assert.equal(vault.messagingSupported, false);
  assert.equal(Object.hasOwn(vault, 'accessToken'), false);
  for (const forbidden of ['pageId', 'cloudAccountId', 'workerBaseUrl', 'devicePrivateKeyPkcs8']) {
    assert.equal(Object.hasOwn(vault, forbidden), false, forbidden);
  }
  assert.equal(updated.metadata.accountKind, 'personal-identity');
  assert.equal(updated.metadata.driverId, 'facebook-personal-identity-official');
  assert.equal(updated.metadata.messagingSupported, false);
});
