import test from 'node:test';
import assert from 'node:assert/strict';
import { workerConfig } from '../src/config.js';
import { beginOAuth, handleOAuthCallback, pollOAuthResult, selectOAuthPage } from '../src/oauth.js';
import { decryptToken, encryptToken } from '../src/tokenVault.js';
import { deviceKeys, testEnv } from './testHarness.js';
import { sha256Base64Url } from '../src/utils.js';
import { route } from '../src/index.js';

function metaFetch(url, options = {}) {
  const target = String(url);
  if (target.includes('/oauth/access_token')) return Promise.resolve(new Response(JSON.stringify({ access_token: 'user-token-secret', expires_in: 3600 }), { status: 200, headers: { 'content-type': 'application/json' } }));
  if (target.includes('/me/permissions')) return Promise.resolve(new Response(JSON.stringify({ data: [
    { permission: 'pages_show_list', status: 'granted' },
    { permission: 'pages_messaging', status: 'granted' },
    { permission: 'pages_manage_metadata', status: 'granted' },
    { permission: 'pages_read_engagement', status: 'granted' }
  ] }), { status: 200, headers: { 'content-type': 'application/json' } }));
  if (target.includes('/me/accounts')) return Promise.resolve(new Response(JSON.stringify({ data: [{ id: 'page-200', name: 'Yance Page', username: 'yancepage', access_token: 'page-token-very-secret', picture: { data: { url: 'https://example.test/page.png' } } }] }), { status: 200, headers: { 'content-type': 'application/json' } }));
  if (target.includes('/subscribed_apps') && options.method === 'POST') return Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'content-type': 'application/json' } }));
  throw new Error(`unexpected Meta URL ${target}`);
}


function metaFetchWithoutHistoryPermission(url, options = {}) {
  const target = String(url);
  if (target.includes('/me/permissions')) return Promise.resolve(new Response(JSON.stringify({ data: [
    { permission: 'pages_show_list', status: 'granted' },
    { permission: 'pages_messaging', status: 'granted' },
    { permission: 'pages_manage_metadata', status: 'granted' }
  ] }), { status: 200, headers: { 'content-type': 'application/json' } }));
  return metaFetch(url, options);
}

function metaFetchMissingMessaging(url, options = {}) {
  const target = String(url);
  if (target.includes('/me/permissions')) return Promise.resolve(new Response(JSON.stringify({ data: [
    { permission: 'pages_show_list', status: 'granted' },
    { permission: 'pages_manage_metadata', status: 'granted' }
  ] }), { status: 200, headers: { 'content-type': 'application/json' } }));
  return metaFetch(url, options);
}


function metaFetchTargetFallback(url, options = {}) {
  const target = String(url);
  if (target.includes('/oauth/access_token')) return Promise.resolve(new Response(JSON.stringify({ access_token: 'user-token-fallback-secret', expires_in: 3600 }), { status: 200, headers: { 'content-type': 'application/json' } }));
  if (target.includes('/me/permissions')) return Promise.resolve(new Response(JSON.stringify({ data: [
    { permission: 'pages_show_list', status: 'granted' },
    { permission: 'pages_messaging', status: 'granted' },
    { permission: 'pages_manage_metadata', status: 'granted' }
  ] }), { status: 200, headers: { 'content-type': 'application/json' } }));
  if (target.includes('/me/accounts')) return Promise.resolve(new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } }));
  if (target.includes('/debug_token')) return Promise.resolve(new Response(JSON.stringify({ data: {
    app_id: '123456789012345', user_id: 'user-100', is_valid: true,
    scopes: ['pages_show_list','pages_messaging','pages_manage_metadata'],
    granular_scopes: [
      { scope: 'pages_show_list', target_ids: ['page-200'] },
      { scope: 'pages_messaging', target_ids: ['page-200'] },
      { scope: 'pages_manage_metadata', target_ids: ['page-200'] }
    ]
  } }), { status: 200, headers: { 'content-type': 'application/json' } }));
  if (target.includes('/user-100/accounts')) return Promise.resolve(new Response(JSON.stringify({ data: [{ id: 'page-200', name: 'Recovered Page', username: 'recovered', access_token: 'recovered-page-token-secret', tasks: ['MESSAGING'], picture: { data: { url: 'https://example.test/recovered.png' } } }] }), { status: 200, headers: { 'content-type': 'application/json' } }));
  if (target.includes('/subscribed_apps') && options.method === 'POST') return Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'content-type': 'application/json' } }));
  throw new Error(`unexpected Meta URL ${target}`);
}

function metaFetchTargetMissing(url) {
  const target = String(url);
  if (target.includes('/oauth/access_token')) return Promise.resolve(new Response(JSON.stringify({ access_token: 'user-token-missing-secret', expires_in: 3600 }), { status: 200, headers: { 'content-type': 'application/json' } }));
  if (target.includes('/me/permissions')) return Promise.resolve(new Response(JSON.stringify({ data: [
    { permission: 'pages_show_list', status: 'granted' },
    { permission: 'pages_messaging', status: 'granted' },
    { permission: 'pages_manage_metadata', status: 'granted' }
  ] }), { status: 200, headers: { 'content-type': 'application/json' } }));
  if (target.includes('/me/accounts')) return Promise.resolve(new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } }));
  if (target.includes('/debug_token')) return Promise.resolve(new Response(JSON.stringify({ data: {
    app_id: '123456789012345', user_id: 'user-100', is_valid: true,
    scopes: ['pages_show_list','pages_messaging','pages_manage_metadata'],
    granular_scopes: [{ scope: 'pages_show_list', target_ids: [] }]
  } }), { status: 200, headers: { 'content-type': 'application/json' } }));
  if (target.includes('/user-100/accounts')) return Promise.resolve(new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } }));
  throw new Error(`unexpected Meta URL ${target}`);
}

function metaFetchTargetProfileOnly(url) {
  const target = String(url);
  if (target.includes('/oauth/access_token')) return Promise.resolve(new Response(JSON.stringify({ access_token: 'user-token-profile-only-secret', expires_in: 3600 }), { status: 200, headers: { 'content-type': 'application/json' } }));
  if (target.includes('/me/permissions')) return Promise.resolve(new Response(JSON.stringify({ data: [
    { permission: 'pages_show_list', status: 'granted' },
    { permission: 'pages_messaging', status: 'granted' },
    { permission: 'pages_manage_metadata', status: 'granted' }
  ] }), { status: 200, headers: { 'content-type': 'application/json' } }));
  if (target.includes('/me/accounts')) return Promise.resolve(new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } }));
  if (target.includes('/debug_token')) return Promise.resolve(new Response(JSON.stringify({ data: {
    app_id: '123456789012345', user_id: 'user-100', is_valid: true,
    scopes: ['pages_show_list','pages_messaging','pages_manage_metadata'],
    granular_scopes: [
      { scope: 'pages_show_list', target_ids: ['page-200'] },
      { scope: 'pages_messaging', target_ids: ['page-200'] },
      { scope: 'pages_manage_metadata', target_ids: ['page-200'] }
    ]
  } }), { status: 200, headers: { 'content-type': 'application/json' } }));
  if (target.includes('/user-100/accounts')) return Promise.resolve(new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } }));
  if (target.includes('/page-200')) return Promise.resolve(new Response(JSON.stringify({ id: 'page-200', name: 'Visible Page', username: 'visible', picture: { data: { url: 'https://example.test/visible.png' } } }), { status: 200, headers: { 'content-type': 'application/json' } }));
  throw new Error(`unexpected Meta URL ${target}`);
}

function metaFetchDirectPageTokenFallback(url, options = {}) {
  const target = String(url);
  const authorization = String(options?.headers?.authorization || '');
  if (target.includes('/oauth/access_token')) return Promise.resolve(new Response(JSON.stringify({ access_token: 'user-token-direct-secret', expires_in: 3600 }), { status: 200, headers: { 'content-type': 'application/json' } }));
  if (target.includes('/me/permissions')) return Promise.resolve(new Response(JSON.stringify({ data: [
    { permission: 'pages_show_list', status: 'granted' },
    { permission: 'pages_messaging', status: 'granted' },
    { permission: 'pages_manage_metadata', status: 'granted' }
  ] }), { status: 200, headers: { 'content-type': 'application/json' } }));
  if (target.includes('/me/accounts')) return Promise.resolve(new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } }));
  if (target.includes('/debug_token')) return Promise.resolve(new Response(JSON.stringify({ data: {
    app_id: '123456789012345', user_id: 'user-100', is_valid: true,
    scopes: ['pages_show_list','pages_messaging','pages_manage_metadata'],
    granular_scopes: [
      { scope: 'pages_show_list', target_ids: ['page-200'] },
      { scope: 'pages_messaging', target_ids: ['page-200'] },
      { scope: 'pages_manage_metadata', target_ids: ['page-200'] }
    ]
  } }), { status: 200, headers: { 'content-type': 'application/json' } }));
  if (target.includes('/user-100/accounts')) return Promise.resolve(new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } }));
  if (target.includes('/page-200') && authorization === 'Bearer user-token-direct-secret' && target.includes('access_token')) {
    const fields = new URL(target).searchParams.get('fields');
    if (fields === 'id,access_token') {
      return Promise.resolve(new Response(JSON.stringify({ error: { message: '(#100) Tried accessing nonexisting field (id) on node type (Page)', type: 'OAuthException', code: 100 } }), { status: 400, headers: { 'content-type': 'application/json' } }));
    }
    return Promise.resolve(new Response(JSON.stringify({ id: 'page-200', access_token: 'direct-page-token-secret' }), { status: 200, headers: { 'content-type': 'application/json' } }));
  }
  if (target.includes('/page-200') && authorization === 'Bearer direct-page-token-secret') {
    return Promise.resolve(new Response(JSON.stringify({ id: 'page-200', name: 'Direct Token Page', username: 'direct-token-page', picture: { data: { url: 'https://example.test/direct.png' } } }), { status: 200, headers: { 'content-type': 'application/json' } }));
  }
  if (target.includes('/subscribed_apps') && options.method === 'POST') return Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'content-type': 'application/json' } }));
  throw new Error(`unexpected Meta URL ${target}`);
}

async function startFlow(env) {
  const config = workerConfig(env); const keys = await deviceKeys();
  const clientSecret = 'client-secret-for-flow-abcdefghijklmnopqrstuvwxyz';
  const flowId = `flow-${crypto.randomUUID()}`;
  const url = new URL('https://yance-facebook-gateway.example.workers.dev/oauth/facebook/start');
  url.searchParams.set('flow_id', flowId);
  url.searchParams.set('client_proof', await sha256Base64Url(clientSecret));
  url.searchParams.set('device_id', 'device-oauth-1');
  url.searchParams.set('public_key', keys.publicKeySpki);
  url.searchParams.set('device_name', 'Windows Test');
  const response = await beginOAuth(new Request(url), env, config);
  const location = new URL(response.headers.get('location'));
  return { config, keys, clientSecret, flowId, state: location.searchParams.get('state'), location };
}


test('public health endpoint publishes the no-legacy-scope OAuth contract', async () => {
  const env = testEnv({ WORKER_BASE_URL: 'https://yance-facebook-gateway.example.workers.dev' });
  const response = await route(new Request('https://yance-facebook-gateway.example.workers.dev/healthz'), env, { waitUntil() {} });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.ok, true);
  assert.equal(data.graphVersion, 'v25.0');
  assert.equal(data.d1Schema.version, 6);
  assert.equal(data.d1Schema.ready, true);
  assert.equal(data.d1Schema.pagePictureColumn, true);
  assert.equal(data.avatarProxyContract.version, 11);
  assert.equal(data.avatarProxyContract.authentication, 'desktop-device-signature');
  assert.equal(data.avatarProxyContract.pageRoute, '/api/desktop/avatar/page');
  assert.equal(data.avatarProxyContract.profileRoute, '/api/desktop/avatar/profile');
  assert.equal(data.avatarProxyContract.contactAvatarStrategy, 'messenger-profile-then-generic-picture-then-picture-edge');
  assert.equal(data.avatarProxyContract.identityPictureFallback, true);
  assert.equal(data.avatarProxyContract.deterministicPermissionClassification, true);
  assert.equal(data.avatarProxyContract.accountHealthSeparatedFromContactAvatarAccess, true);
  assert.equal(data.avatarProxyContract.deterministicUnsupportedGetClassification, true);
  assert.equal(data.avatarProxyContract.preserveHistoricalAvatarOnDeterministicFailure, true);
  assert.equal(data.avatarProxyContract.evidenceContractVersion, 6);
  assert.equal(data.avatarProxyContract.maximumBytes, 8 * 1024 * 1024);
  assert.deepEqual(data.avatarProxyContract.contentTypes, ['image/*']);
  assert.equal(data.oauthContract.version, 6);
  assert.deepEqual(data.oauthContract.supportedModes, ['page', 'identity']);
  assert.equal(data.oauthContract.personalIdentity.messagingSupported, false);
  assert.equal(data.oauthContract.personalIdentity.tokenReturnedToDesktop, false);
  assert.equal(data.oauthContract.pageDiscovery.primary, '/me/accounts');
  assert.deepEqual(data.oauthContract.pageDiscovery.tokenRecovery, ['/{debug_token.user_id}/accounts', '/{granular_target_id}?fields=access_token']);
  assert.equal(data.oauthContract.pageDiscovery.selectionEvidence, 'debug_token.granular_scopes.target_ids');
  assert.equal(data.oauthContract.pageDiscovery.directPageProfileProbe, true);
  assert.equal(data.oauthContract.pageDiscovery.directPageTokenRecovery, true);
  assert.deepEqual(data.oauthContract.pageDiscovery.directPageTokenFields, ['id,access_token', 'access_token']);
  assert.equal(data.oauthContract.pageDiscovery.profileHydration, 'page-access-token');
  assert.equal(data.oauthContract.pageDiscovery.diagnosticsPersistedWithoutTokens, true);
  assert.equal(data.oauthContract.authorizationMode, 'business-login-configuration');
  assert.equal(data.oauthContract.legacyScopeParameter, false);
  assert.equal(data.oauthContract.callbackUrl, 'https://yance-facebook-gateway.example.workers.dev/oauth/facebook/callback');
  assert.deepEqual(data.oauthContract.requiredPermissions, ['pages_show_list', 'pages_messaging', 'pages_manage_metadata']);
  assert.deepEqual(data.oauthContract.optionalPermissions, ['pages_read_engagement']);
});

test('Business Login authorization URL uses the production config_id and exact callback without legacy scope', async () => {
  const env = testEnv({
    META_APP_ID: '2188542051994811',
    META_BUSINESS_LOGIN_CONFIG_ID: '4234889550142986',
    WORKER_BASE_URL: 'https://yance-facebook-gateway.wangyi198675.workers.dev'
  });
  const flow = await startFlow(env);
  assert.equal(flow.location.origin, 'https://www.facebook.com');
  assert.equal(flow.location.pathname, '/v25.0/dialog/oauth');
  assert.equal(flow.location.searchParams.get('client_id'), '2188542051994811');
  assert.equal(flow.location.searchParams.get('config_id'), '4234889550142986');
  assert.equal(flow.location.searchParams.get('redirect_uri'), 'https://yance-facebook-gateway.wangyi198675.workers.dev/oauth/facebook/callback');
  assert.equal(flow.location.searchParams.get('response_type'), 'code');
  assert.equal(flow.location.searchParams.has('scope'), false);
  assert.ok(flow.location.searchParams.get('state'));
});


test('empty /me/accounts recovers selected Page through explicit debug user accounts filtered by granular target_ids without exposing tokens', async () => {
  const env = testEnv();
  const flow = await startFlow(env);
  await handleOAuthCallback(new Request(`https://yance-facebook-gateway.example.workers.dev/oauth/facebook/callback?state=${encodeURIComponent(flow.state)}&code=abc`), env, flow.config, metaFetchTargetFallback);
  const pollRequest = new Request(`https://worker.test/oauth/facebook/result/${flow.flowId}`, { headers: { authorization: `Bearer ${flow.clientSecret}` } });
  const result = await pollOAuthResult(pollRequest, env, flow.flowId);
  assert.equal(result.status, 'authorized');
  assert.equal(result.pages.length, 1);
  assert.equal(result.pages[0].id, 'page-200');
  assert.equal(result.pages[0].name, 'Recovered Page');
  assert.equal(result.diagnostics.primaryCount, 0);
  assert.equal(result.diagnostics.resolutionSource, 'debug_user_accounts');
  assert.deepEqual(result.diagnostics.debugToken.targetIds, ['page-200']);
  assert.equal(result.diagnostics.debugToken.userIdPresent, true);
  assert.equal(result.diagnostics.explicitUserAccounts.endpoint, '/{debug_token.user_id}/accounts');
  assert.equal(result.diagnostics.explicitUserAccounts.count, 1);
  assert.equal(result.diagnostics.explicitUserAccounts.selectedCount, 1);
  assert.equal(result.diagnostics.recoveredCount, 1);
  assert.equal(JSON.stringify(result).includes('user-100'), false);
  assert.equal(JSON.stringify(result).includes('user-token-fallback-secret'), false);
  assert.equal(JSON.stringify(result).includes('recovered-page-token-secret'), false);
  const diagnosticRow = env.DB.database.prepare('SELECT diagnostics_json FROM facebook_oauth_diagnostics WHERE flow_id=?').get(flow.flowId);
  assert.equal(diagnosticRow.diagnostics_json.includes('user-token-fallback-secret'), false);
  assert.equal(diagnosticRow.diagnostics_json.includes('recovered-page-token-secret'), false);
  const candidate = env.DB.database.prepare('SELECT token_ciphertext FROM facebook_oauth_page_candidates WHERE flow_id=?').get(flow.flowId);
  assert.notEqual(candidate.token_ciphertext, 'recovered-page-token-secret');
});

test('empty accounts edges recover the selected Page through a minimal direct access_token field request without exposing tokens', async () => {
  const env = testEnv();
  const flow = await startFlow(env);
  await handleOAuthCallback(new Request(`https://yance-facebook-gateway.example.workers.dev/oauth/facebook/callback?state=${encodeURIComponent(flow.state)}&code=abc`), env, flow.config, metaFetchDirectPageTokenFallback);
  const pollRequest = new Request(`https://worker.test/oauth/facebook/result/${flow.flowId}`, { headers: { authorization: `Bearer ${flow.clientSecret}` } });
  const result = await pollOAuthResult(pollRequest, env, flow.flowId);
  assert.equal(result.status, 'authorized');
  assert.equal(result.pages.length, 1);
  assert.equal(result.pages[0].id, 'page-200');
  assert.equal(result.pages[0].name, 'Direct Token Page');
  assert.equal(result.diagnostics.resolutionSource, 'granular_target_direct_page_token');
  assert.equal(result.diagnostics.explicitUserAccounts.count, 0);
  assert.equal(result.diagnostics.directPageTokenChecks.length, 1);
  assert.equal(result.diagnostics.directPageTokenChecks[0].tokenAvailable, true);
  assert.equal(result.diagnostics.directPageTokenChecks[0].attempts[0].fields, 'id,access_token');
  assert.equal(result.diagnostics.directPageTokenChecks[0].attempts[0].status, 'meta_error');
  assert.equal(result.diagnostics.directPageTokenChecks[0].attempts[0].error.metaCode, 100);
  assert.equal(result.diagnostics.directPageTokenChecks[0].attempts[0].error.metaReason, 'invalid_field');
  assert.equal(result.diagnostics.directPageTokenChecks[0].attempts[1].fields, 'access_token');
  assert.equal(result.diagnostics.directPageTokenChecks[0].attempts[1].status, 'token_available');
  assert.equal(result.diagnostics.directPageTokenChecks[0].profileStatus, 'loaded_with_page_token');
  assert.equal(result.diagnostics.recoveredCount, 1);
  assert.equal(JSON.stringify(result).includes('user-token-direct-secret'), false);
  assert.equal(JSON.stringify(result).includes('direct-page-token-secret'), false);
  const diagnosticRow = env.DB.database.prepare('SELECT diagnostics_json FROM facebook_oauth_diagnostics WHERE flow_id=?').get(flow.flowId);
  assert.equal(diagnosticRow.diagnostics_json.includes('user-token-direct-secret'), false);
  assert.equal(diagnosticRow.diagnostics_json.includes('direct-page-token-secret'), false);
  const candidate = env.DB.database.prepare('SELECT token_ciphertext FROM facebook_oauth_page_candidates WHERE flow_id=?').get(flow.flowId);
  assert.notEqual(candidate.token_ciphertext, 'direct-page-token-secret');
});

test('selected target with visible Page profile but no accounts edge token fails honestly without treating profile lookup as token recovery', async () => {
  const env = testEnv();
  const flow = await startFlow(env);
  const callback = new Request(`https://yance-facebook-gateway.example.workers.dev/oauth/facebook/callback?state=${encodeURIComponent(flow.state)}&code=abc`);
  await assert.rejects(handleOAuthCallback(callback, env, flow.config, metaFetchTargetProfileOnly), error => (
    error.code === 'FACEBOOK_NO_MANAGED_PAGES'
    && error.details.diagnostics.primaryCount === 0
    && error.details.diagnostics.explicitUserAccounts.count === 0
    && error.details.diagnostics.debugToken.targetIds[0] === 'page-200'
    && error.details.diagnostics.directPageTokenChecks[0].tokenAvailable === false
    && error.details.diagnostics.directPageChecks[0].status === 'profile_visible_page_token_unavailable'
  ));
  const pollRequest = new Request(`https://worker.test/oauth/facebook/result/${flow.flowId}`, { headers: { authorization: `Bearer ${flow.clientSecret}` } });
  const result = await pollOAuthResult(pollRequest, env, flow.flowId);
  assert.equal(result.status, 'error');
  assert.equal(result.diagnostics.explicitUserAccounts.attempted, true);
  assert.equal(result.diagnostics.explicitUserAccounts.count, 0);
  assert.equal(result.diagnostics.directPageTokenChecks[0].tokenAvailable, false);
  assert.equal(result.diagnostics.directPageChecks[0].status, 'profile_visible_page_token_unavailable');
  assert.equal(result.diagnostics.recoveredCount, 0);
  assert.equal(JSON.stringify(result).includes('user-token-profile-only-secret'), false);
});

test('no target_ids returns persisted safe diagnostics and callback HTML evidence', async () => {
  const env = testEnv();
  const flow = await startFlow(env);
  const callback = new Request(`https://yance-facebook-gateway.example.workers.dev/oauth/facebook/callback?state=${encodeURIComponent(flow.state)}&code=abc`);
  await assert.rejects(handleOAuthCallback(callback, env, flow.config, metaFetchTargetMissing), error => (
    error.code === 'FACEBOOK_NO_MANAGED_PAGES'
    && error.details.diagnostics.primaryCount === 0
    && error.details.diagnostics.debugToken.targetIds.length === 0
  ));
  const pollRequest = new Request(`https://worker.test/oauth/facebook/result/${flow.flowId}`, { headers: { authorization: `Bearer ${flow.clientSecret}` } });
  const result = await pollOAuthResult(pollRequest, env, flow.flowId);
  assert.equal(result.status, 'error');
  assert.equal(result.errorCode, 'FACEBOOK_NO_MANAGED_PAGES');
  assert.equal(result.diagnostics.primaryCount, 0);
  assert.equal(result.diagnostics.debugToken.attempted, true);
  assert.equal(JSON.stringify(result).includes('user-token-missing-secret'), false);

  const env2 = testEnv();
  const flow2 = await startFlow(env2);
  const response = await route(new Request(`https://yance-facebook-gateway.example.workers.dev/oauth/facebook/callback?state=${encodeURIComponent(flow2.state)}&code=abc`), env2, { waitUntil() {} }, { fetch: metaFetchTargetMissing });
  assert.equal(response.status, 409);
  const body = await response.text();
  assert.match(body, /\/me\/accounts=0/);
  assert.match(body, /granular target_ids=无/);
  assert.equal(body.includes('user-token-missing-secret'), false);
});

test('pages_read_engagement is an explicit history gap and does not block Page selection or new messaging', async () => {
  const env = testEnv();
  const flow = await startFlow(env);
  await handleOAuthCallback(new Request(`https://yance-facebook-gateway.example.workers.dev/oauth/facebook/callback?state=${encodeURIComponent(flow.state)}&code=abc`), env, flow.config, metaFetchWithoutHistoryPermission);
  const pollRequest = new Request(`https://worker.test/oauth/facebook/result/${flow.flowId}`, { headers: { authorization: `Bearer ${flow.clientSecret}` } });
  const result = await pollOAuthResult(pollRequest, env, flow.flowId);
  assert.equal(result.pages[0].permissionReady, true);
  assert.equal(result.pages[0].newMessagingReady, true);
  assert.equal(result.pages[0].historySyncAvailable, false);
  assert.deepEqual(result.pages[0].missingPermissions, []);
  assert.deepEqual(result.pages[0].missingOptionalPermissions, ['pages_read_engagement']);
  const selectRequest = new Request(`https://worker.test/oauth/facebook/result/${flow.flowId}/select`, { method: 'POST', headers: { authorization: `Bearer ${flow.clientSecret}`, 'content-type': 'application/json' }, body: JSON.stringify({ pageId: 'page-200' }) });
  const selected = await selectOAuthPage(selectRequest, env, flow.config, flow.flowId, { pageId: 'page-200' }, metaFetchWithoutHistoryPermission);
  assert.equal(selected.page.newMessagingReady, true);
  assert.equal(selected.page.historySyncAvailable, false);
  assert.equal(env.DB.database.prepare('SELECT COUNT(*) AS count FROM facebook_accounts').get().count, 1);
  assert.equal(env.DB.database.prepare('SELECT COUNT(*) AS count FROM facebook_page_tokens').get().count, 1);
  assert.equal(env.DB.database.prepare('SELECT COUNT(*) AS count FROM facebook_desktop_devices').get().count, 1);
  const authority = env.DB.database.prepare('SELECT granted_scopes,missing_permissions,history_sync_available,history_sync_reason,last_permission_check_at,permission_source FROM facebook_accounts').get();
  assert.deepEqual(JSON.parse(authority.missing_permissions), ['pages_read_engagement']);
  assert.equal(authority.history_sync_available, 0);
  assert.match(authority.history_sync_reason, /pages_read_engagement/u);
  assert.ok(authority.last_permission_check_at);
  assert.equal(authority.permission_source, 'meta:/me/permissions');
});

test('missing pages_messaging still blocks authorization before Page candidates are persisted', async () => {
  const env = testEnv();
  const flow = await startFlow(env);
  const callback = new Request(`https://yance-facebook-gateway.example.workers.dev/oauth/facebook/callback?state=${encodeURIComponent(flow.state)}&code=abc`);
  await assert.rejects(handleOAuthCallback(callback, env, flow.config, metaFetchMissingMessaging), error => (
    error.code === 'FACEBOOK_REQUIRED_PERMISSIONS_MISSING' && error.details.missingPermissions.includes('pages_messaging')
  ));
  assert.equal(env.DB.database.prepare('SELECT COUNT(*) AS count FROM facebook_oauth_page_candidates').get().count, 0);
});

test('OAuth user cancellation is recorded without exchanging a code', async () => {
  const env = testEnv();
  const flow = await startFlow(env);
  const callback = new Request(`https://yance-facebook-gateway.example.workers.dev/oauth/facebook/callback?state=${encodeURIComponent(flow.state)}&error=access_denied`);
  await assert.rejects(handleOAuthCallback(callback, env, flow.config, () => { throw new Error('Meta must not be called'); }), error => error.code === 'FACEBOOK_OAUTH_DENIED');
  assert.equal(env.DB.database.prepare('SELECT status FROM facebook_oauth_states WHERE flow_id=?').get(flow.flowId).status, 'denied');
});

test('OAuth state is random, single-use, and callback replay is rejected', async () => {
  const env = testEnv(); const flow = await startFlow(env);
  const callback = new Request(`https://yance-facebook-gateway.example.workers.dev/oauth/facebook/callback?state=${encodeURIComponent(flow.state)}&code=abc`);
  const first = await handleOAuthCallback(callback, env, flow.config, metaFetch);
  assert.equal(first.status, 'authorized');
  await assert.rejects(handleOAuthCallback(callback, env, flow.config, metaFetch), error => error.code === 'FACEBOOK_OAUTH_STATE_REPLAYED');
});

test('OAuth polling never returns Page Access Token and D1 candidate stores encrypted token', async () => {
  const env = testEnv(); const flow = await startFlow(env);
  await handleOAuthCallback(new Request(`https://yance-facebook-gateway.example.workers.dev/oauth/facebook/callback?state=${encodeURIComponent(flow.state)}&code=abc`), env, flow.config, metaFetch);
  const pollRequest = new Request(`https://worker.test/oauth/facebook/result/${flow.flowId}`, { headers: { authorization: `Bearer ${flow.clientSecret}` } });
  const result = await pollOAuthResult(pollRequest, env, flow.flowId);
  assert.equal(result.status, 'authorized');
  assert.equal(result.pages.length, 1);
  assert.equal(JSON.stringify(result).includes('page-token-very-secret'), false);
  const candidate = env.DB.database.prepare('SELECT * FROM facebook_oauth_page_candidates').get();
  assert.notEqual(candidate.token_ciphertext, 'page-token-very-secret');
  assert.equal(JSON.stringify(candidate).includes('page-token-very-secret'), false);
});

test('Page selection subscribes webhook, registers device, and persists only encrypted Page Token', async () => {
  const env = testEnv(); const flow = await startFlow(env);
  await handleOAuthCallback(new Request(`https://yance-facebook-gateway.example.workers.dev/oauth/facebook/callback?state=${encodeURIComponent(flow.state)}&code=abc`), env, flow.config, metaFetch);
  const request = new Request(`https://worker.test/oauth/facebook/result/${flow.flowId}/select`, { method: 'POST', headers: { authorization: `Bearer ${flow.clientSecret}`, 'content-type': 'application/json' }, body: JSON.stringify({ pageId: 'page-200' }) });
  const result = await selectOAuthPage(request, env, flow.config, flow.flowId, { pageId: 'page-200' }, metaFetch);
  assert.equal(result.page.id, 'page-200');
  assert.equal(result.deviceId, 'device-oauth-1');
  assert.equal(JSON.stringify(result).includes('page-token-very-secret'), false);
  const tokenRow = env.DB.database.prepare('SELECT * FROM facebook_page_tokens').get();
  assert.equal(await decryptToken(tokenRow, env.TOKEN_ENCRYPTION_KEY), 'page-token-very-secret');
  assert.equal(env.DB.database.prepare('SELECT status FROM facebook_desktop_devices WHERE id=?').get('device-oauth-1').status, 'active');
});

test('Token vault supports key rotation while retaining old decryption key', async () => {
  const oldKey = Buffer.alloc(32, 3).toString('base64');
  const newKey = Buffer.alloc(32, 4).toString('base64');
  const oldRing = JSON.stringify({ active: 'k1', keys: { k1: oldKey } });
  const rotatedRing = JSON.stringify({ active: 'k2', keys: { k1: oldKey, k2: newKey } });
  const oldRecord = await encryptToken('old-token', 'page-1', oldRing);
  assert.equal(await decryptToken(oldRecord, rotatedRing), 'old-token');
  const newRecord = await encryptToken('new-token', 'page-1', rotatedRing);
  assert.equal(newRecord.key_id, 'k2');
  assert.equal(await decryptToken(newRecord, rotatedRing), 'new-token');
});

test('Token vault rejects tampered ciphertext', async () => {
  const env = testEnv(); const record = await encryptToken('secret', 'page-1', env.TOKEN_ENCRYPTION_KEY);
  record.ciphertext = record.ciphertext.slice(0, -2) + 'AA';
  await assert.rejects(decryptToken(record, env.TOKEN_ENCRYPTION_KEY), error => error.code === 'FACEBOOK_TOKEN_DECRYPT_FAILED');
});

test('official personal identity OAuth returns a profile receipt without page permissions or Messenger capability', async () => {
  const env = testEnv();
  const config = workerConfig(env);
  const keys = await deviceKeys();
  const clientSecret = 'client-secret-personal-identity-abcdefghijklmnopqrstuvwxyz';
  const flowId = `identity-${crypto.randomUUID()}`;
  const startUrl = new URL('https://yance-facebook-gateway.example.workers.dev/oauth/facebook/start');
  startUrl.searchParams.set('flow_id', flowId);
  startUrl.searchParams.set('client_proof', await sha256Base64Url(clientSecret));
  startUrl.searchParams.set('device_id', 'device-identity-1');
  startUrl.searchParams.set('public_key', keys.publicKeySpki);
  startUrl.searchParams.set('device_name', 'Windows Identity Test');
  startUrl.searchParams.set('mode', 'identity');
  const started = await beginOAuth(new Request(startUrl), env, config);
  const authorization = new URL(started.headers.get('location'));
  assert.equal(authorization.searchParams.get('config_id'), null);
  assert.equal(authorization.searchParams.get('scope'), 'public_profile');
  const state = authorization.searchParams.get('state');

  const identityFetch = async (url) => {
    const target = String(url);
    if (target.includes('/oauth/access_token')) return new Response(JSON.stringify({ access_token: 'personal-identity-token-secret', expires_in: 3600 }), { status: 200, headers: { 'content-type': 'application/json' } });
    if (target.includes('/me?') || target.endsWith('/me')) return new Response(JSON.stringify({ id: 'user-900', name: 'Identity User', picture: { data: { url: 'https://example.test/user.png' } } }), { status: 200, headers: { 'content-type': 'application/json' } });
    throw new Error(`unexpected identity Meta URL ${target}`);
  };
  await handleOAuthCallback(new Request(`https://yance-facebook-gateway.example.workers.dev/oauth/facebook/callback?state=${encodeURIComponent(state)}&code=identity-code`), env, config, identityFetch);
  const result = await pollOAuthResult(new Request(`https://worker.test/oauth/facebook/result/${flowId}`, { headers: { authorization: `Bearer ${clientSecret}` } }), env, flowId);
  assert.equal(result.mode, 'identity');
  assert.equal(result.status, 'authorized');
  assert.deepEqual(result.identity, { userId: 'user-900', displayName: 'Identity User', avatarUrl: 'https://example.test/user.png', messagingSupported: false });
  assert.deepEqual(result.pages, []);
  assert.equal(JSON.stringify(result).includes('personal-identity-token-secret'), false);
});
