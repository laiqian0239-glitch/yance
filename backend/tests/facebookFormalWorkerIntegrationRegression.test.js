'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const accountStore = require('../services/accountStore');
const platformAuthConfig = require('../services/platformAuthConfig');
const releasePlatformAuth = require('../services/releasePlatformAuth');
const facebookOAuthService = require('../services/facebookOAuthService');
const relayModule = require('../services/facebookRelayClient');
const { getSecurityGuard } = require('../core/securityGuardSingleton');
const formalWorkerProbe = require('../../tools/facebook/verify-formal-worker');

const FORMAL_WORKER = 'https://yance-facebook-gateway.wangyi198675.workers.dev';
const securityGuard = getSecurityGuard();

function patch(t, object, key, value) {
  const original = object[key];
  object[key] = value;
  t.after(() => { object[key] = original; });
}

function response(status, data) {
  return { ok: status >= 200 && status < 300, status, async json() { return data; } };
}

// Schema 23 WP-B requires a frozen RUNNING persisted operation before OAuth Worker I/O.
function frozenFormalOAuthOperation() {
  return Object.freeze({
    executionId: 'exec-facebook-formal-oauth',
    operationId: 'op-facebook-formal-oauth',
    operationKind: 'OAUTH_FLOW',
    ownerId: 'owner-facebook-formal',
    claimId: 'claim-facebook-formal',
    generation: 1,
    hostGeneration: 1,
    fencingToken: 1,
    state: 'RUNNING',
    platform: 'facebook',
    deadlineAt: new Date(Date.now() + 60000).toISOString(),
    accountId: 'facebook-formal-worker-account'
  });
}

async function installOAuthHarness(t) {
  let vault = {};
  const account = {
    id: 'facebook-formal-worker-account', platform: 'facebook', displayName: 'Facebook', identityLabel: '待授权',
    credentialRef: 'facebook-formal-worker-credential',
    metadata: { accountKind: 'personal-identity', driverId: 'facebook-personal-identity-official', authorizationPending: true }
  };
  patch(t, accountStore, 'get', () => account);
  patch(t, platformAuthConfig, 'facebook', () => ({ configured: true, workerBaseUrl: FORMAL_WORKER, graphVersion: 'v25.0' }));
  patch(t, platformAuthConfig, 'randomSecret', () => `client-${'x'.repeat(48)}`);
  patch(t, platformAuthConfig, 'sha256Base64Url', value => `hash-${String(value).length}`);
  patch(t, relayModule, 'generateDeviceIdentity', () => ({ deviceId: 'fbdev-formal', publicKeySpki: 'public-spki', privateKeyPkcs8: 'private-pkcs8' }));
  patch(t, securityGuard, 'readCredential', () => vault);
  patch(t, securityGuard, 'persistCredential', async (_ref, value) => { vault = value; return true; });
  patch(t, global, 'fetch', async url => {
    assert.equal(String(url), `${FORMAL_WORKER}/healthz`);
    return response(200, {
      ok: true, service: 'yance-facebook-gateway', graphVersion: 'v25.0',
      oauthContract: {
        version: 6, authorizationMode: 'business-login-configuration', legacyScopeParameter: false,
        supportedModes: ['page', 'identity'],
        personalIdentity: { messagingSupported: false, tokenReturnedToDesktop: false },
        callbackUrl: `${FORMAL_WORKER}/oauth/facebook/callback`,
        requiredPermissions: ['pages_show_list','pages_messaging','pages_manage_metadata'],
        optionalPermissions: ['pages_read_engagement'],
        pageDiscovery: {
          primary: '/me/accounts', tokenRecovery: ['/{debug_token.user_id}/accounts', '/{granular_target_id}?fields=access_token'],
          selectionEvidence: 'debug_token.granular_scopes.target_ids', directPageProfileProbe: true,
          directPageTokenRecovery: true, directPageTokenFields: ['id,access_token', 'access_token'],
          profileHydration: 'page-access-token', diagnosticsPersistedWithoutTokens: true
        }
      }
    });
  });
  t.after(() => facebookOAuthService._flows.clear());
  const started = await facebookOAuthService.begin(account.id, { physicalOperationContext: frozenFormalOAuthOperation() });
  return { account, started, flow: facebookOAuthService._flows.get(started.flowId) };
}

test('private platform release seal binds the exact production Worker and Telegram application identity', () => {
  const root = path.resolve(__dirname, '..', '..', 'release', 'facebook-production-resources');
  const loaded = releasePlatformAuth.readSealedFile(path.join(root, 'platform-auth.json'), {
    hashPath: path.join(root, 'platform-auth.sha256')
  });
  assert.equal(loaded.sealed, true);
  assert.equal(loaded.facebook.workerBaseUrl, FORMAL_WORKER);
  assert.equal(loaded.facebook.graphVersion, 'v25.0');
  assert.equal(Number.isInteger(loaded.telegram.apiId) && loaded.telegram.apiId > 0, true);
  assert.match(String(loaded.telegram.apiHash || ''), /^[0-9a-f]{32}$/u);
});



test('formal Worker health probe accepts only the expected service identity', async () => {
  const accepted = await formalWorkerProbe.verify(async url => {
    assert.equal(url, `${FORMAL_WORKER}/healthz`);
    return response(200, {
      ok: true, service: 'yance-facebook-gateway', graphVersion: 'v25.0', time: '2026-07-18T10:00:00.000Z',
      oauthContract: {
        version: 5, authorizationMode: 'business-login-configuration', legacyScopeParameter: false,
        callbackUrl: `${FORMAL_WORKER}/oauth/facebook/callback`,
        requiredPermissions: ['pages_show_list','pages_messaging','pages_manage_metadata'],
        optionalPermissions: ['pages_read_engagement'],
        pageDiscovery: {
          primary: '/me/accounts', tokenRecovery: ['/{debug_token.user_id}/accounts', '/{granular_target_id}?fields=access_token'],
          selectionEvidence: 'debug_token.granular_scopes.target_ids', directPageProfileProbe: true,
          directPageTokenRecovery: true, directPageTokenFields: ['id,access_token', 'access_token'],
          profileHydration: 'page-access-token', diagnosticsPersistedWithoutTokens: true
        }
      }
    });
  });
  assert.equal(accepted.status, 'PASS');
  await assert.rejects(
    formalWorkerProbe.verify(async () => response(200, { ok: true, service: 'another-service' })),
    error => error.code === 'FACEBOOK_FORMAL_WORKER_HEALTH_FAILED'
  );
});

test('desktop requests reject an old or injected Worker URL when the release is formally bound', t => {
  patch(t, platformAuthConfig, 'facebook', () => ({ configured: true, workerBaseUrl: FORMAL_WORKER, graphVersion: 'v25.0' }));
  assert.equal(relayModule.assertReleaseWorkerBinding(`${FORMAL_WORKER}/`), FORMAL_WORKER);
  assert.throws(
    () => relayModule.assertReleaseWorkerBinding('https://old-gateway.example.com'),
    error => error.code === 'FACEBOOK_WORKER_BINDING_MISMATCH'
  );
});

test('browser OAuth starts at the formal Worker and never places Meta App credentials in the URL', async t => {
  const { started } = await installOAuthHarness(t);
  const url = new URL(started.authorizationUrl);
  assert.equal(url.origin, FORMAL_WORKER);
  assert.equal(url.pathname, '/oauth/facebook/start');
  assert.equal(url.searchParams.get('device_id'), 'fbdev-formal');
  assert.equal(url.searchParams.get('public_key'), 'public-spki');
  assert.equal(url.searchParams.has('app_id'), false);
  assert.equal(url.searchParams.has('app_secret'), false);
  assert.equal(url.searchParams.has('page_token'), false);
});

test('OAuth page selection is retired to Chatwoot and never persists a Worker page binding', async t => {
  let persisted = 0;
  patch(t, securityGuard, 'persistCredential', async () => { persisted += 1; });
  let fetchCalls = 0;
  patch(t, global, 'fetch', async () => { fetchCalls += 1; return response(200, { ok: true }); });
  // Page OAuth is owned by Chatwoot; the Worker selectPage surface is an unconditional fail-closed tombstone
  // that performs no Worker I/O and never persists a device/page/Graph binding.
  await assert.rejects(
    facebookOAuthService.selectPage('any-account', 'any-flow', '1203748086150141'),
    error => error.code === 'FACEBOOK_PAGE_OAUTH_OWNED_BY_CHATWOOT'
  );
  assert.equal(persisted, 0);
  assert.equal(fetchCalls, 0);
});

test('event polling counts only ACKs confirmed by Worker after local processing', async () => {
  const client = new relayModule.FacebookRelayClient();
  const account = { id: 'facebook-ack-count' };
  const secret = { workerBaseUrl: FORMAL_WORKER };
  const calls = [];
  client.request = async (_secret, endpoint) => {
    calls.push(endpoint);
    if (endpoint.startsWith('/api/desktop/events')) return {
      events: [
        { event_id: 'event-1', delivery_id: 'delivery-1', lease_token: 'lease-1', payload: { object: 'page', entry: [] } },
        { event_id: 'event-2', delivery_id: 'delivery-2', lease_token: 'lease-2', payload: { object: 'page', entry: [] } }
      ],
      has_more: false
    };
    return { acked: ['delivery-1'], failed: [{ delivery_id: 'delivery-2', code: 'FACEBOOK_ACK_LEASE_MISMATCH' }] };
  };
  let localWrites = 0;
  const result = await client.syncOnce(account, secret, async () => { localWrites += 1; });
  assert.equal(localWrites, 2);
  assert.equal(result.received, 2);
  assert.equal(result.acked, 1);
  assert.equal(calls.length, 2);
});

test('Facebook relay readiness remains permission/subscription scoped and state callback failures are observable', () => {
  const adapter = fs.readFileSync(path.resolve(__dirname, '../services/facebookAdapter.js'), 'utf8');
  const relay = fs.readFileSync(path.resolve(__dirname, '../services/facebookRelayClient.js'), 'utf8');
  assert.match(adapter, /row\.canSend = row\.permissionReady && row\.tokenStatus === 'active'/u);
  assert.match(adapter, /row\.canReceive = relay\.state === 'connected' && row\.subscriptionReady/u);
  assert.match(relay, /worker-state-listener-failed/u);
  // connect() performs exactly one health observation; retry/reachability is owned by the durable pump.
  assert.match(relay, /row\.workerStatus = health\.status \|\| 'unknown'/u);
});

test('persisted WP-B attempt identity leaves Worker URLs and remains explicit signed request metadata', async t => {
  patch(t, platformAuthConfig, 'facebook', () => ({ configured: false, workerBaseUrl: '', graphVersion: 'v25.0' }));
  const identity = relayModule.generateDeviceIdentity();
  const observed = {};
  patch(t, global, 'fetch', async (url, options = {}) => {
    observed.url = String(url);
    observed.headers = options.headers || {};
    return response(200, { ok: true, status: 'ready' });
  });
  const physicalAttemptContext = Object.freeze({
    executionId: 'exec-facebook-red',
    attemptId: 'attempt-facebook-red',
    claimId: 'claim-facebook-red',
    ownerId: 'owner-facebook-red',
    generation: 3,
    hostGeneration: 5,
    fencingToken: 7,
    state: 'RUNNING',
    platform: 'facebook',
    operationKind: 'HISTORY_SYNCHRONIZATION'
  });
  const client = new relayModule.FacebookRelayClient();
  await client.request({
    workerBaseUrl: 'https://worker.test',
    deviceId: identity.deviceId,
    devicePrivateKeyPkcs8: identity.privateKeyPkcs8
  }, '/api/desktop/health', { physicalAttemptContext });
  const target = new URL(observed.url);
  for (const key of [
    'wpb_execution_id', 'wpb_attempt_id', 'wpb_claim_id', 'wpb_owner_id',
    'wpb_generation', 'wpb_host_generation', 'wpb_fencing_token'
  ]) assert.equal(target.searchParams.has(key), false, `${key} must not appear in the Worker URL`);
  assert.equal(observed.headers['x-yance-wpb-execution-id'], physicalAttemptContext.executionId);
  assert.equal(observed.headers['x-yance-wpb-attempt-id'], physicalAttemptContext.attemptId);
  assert.equal(observed.headers['x-yance-wpb-claim-id'], physicalAttemptContext.claimId);
  assert.equal(observed.headers['x-yance-wpb-owner-id'], physicalAttemptContext.ownerId);
  assert.equal(observed.headers['x-yance-wpb-generation'], String(physicalAttemptContext.generation));
  assert.equal(observed.headers['x-yance-wpb-host-generation'], String(physicalAttemptContext.hostGeneration));
  assert.equal(observed.headers['x-yance-wpb-fencing-token'], String(physicalAttemptContext.fencingToken));
  assert.match(String(observed.headers['x-yance-signature'] || ''), /^[A-Za-z0-9_-]+$/u);
});
