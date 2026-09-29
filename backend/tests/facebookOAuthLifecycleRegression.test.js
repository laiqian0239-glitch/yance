'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const accountStore = require('../services/accountStore');
const platformAuthConfig = require('../services/platformAuthConfig');
const facebookOAuthService = require('../services/facebookOAuthService');

function patch(t, object, key, value) {
  const original = object[key];
  object[key] = value;
  t.after(() => { object[key] = original; });
}
function response(status, data) {
  return { ok: status >= 200 && status < 300, status, async json() { return data; } };
}
function frozenOAuthOperation(accountId) {
  return Object.freeze({
    executionId: 'facebook-oauth-execution-1', operationId: 'facebook-oauth-operation-1',
    operationKind: 'OAUTH_FLOW', ownerId: 'facebook-oauth-owner-1', claimId: 'facebook-oauth-claim-1',
    generation: 1, hostGeneration: 1, fencingToken: 1, state: 'RUNNING', platform: 'facebook',
    deadlineAt: new Date(Date.now() + 60000).toISOString(), accountId
  });
}

test('Facebook Page OAuth fails closed to Chatwoot before Worker I/O', async t => {
  const account = {
    id: 'facebook-page-account', platform: 'facebook', credentialRef: 'facebook-page-credential',
    metadata: { accountKind: 'page', driverId: 'facebook-page-official' }
  };
  let configCalls = 0;
  let fetchCalls = 0;
  patch(t, accountStore, 'get', () => account);
  patch(t, platformAuthConfig, 'facebook', () => { configCalls += 1; return { configured: true }; });
  patch(t, global, 'fetch', async () => { fetchCalls += 1; throw new Error('must not fetch'); });
  await assert.rejects(
    facebookOAuthService.begin(account.id),
    error => error.code === 'FACEBOOK_PAGE_OAUTH_OWNED_BY_CHATWOOT' && error.status === 409
  );
  assert.equal(configCalls, 0);
  assert.equal(fetchCalls, 0);
  assert.equal(facebookOAuthService._flows.size, 0);
});

test('Personal Identity keeps a non-messaging OAuth contract without the retired relay client', async t => {
  const source = fs.readFileSync(path.resolve(__dirname, '../services/facebookOAuthService.js'), 'utf8');
  assert.doesNotMatch(source, /facebookRelayClient|facebookAdapter/u);
  assert.match(source, /accountKind === 'personal-identity' \? 'identity' : 'page'/u);
  assert.match(source, /messagingSupported:\s*false/u);
  assert.match(source, /driverId:\s*'facebook-personal-identity-official'/u);

  patch(t, global, 'fetch', async url => {
    assert.equal(String(url), 'https://identity.example.test/healthz');
    return response(200, {
      ok: true, service: 'yance-facebook-gateway', graphVersion: 'v25.0',
      oauthContract: {
        version: 6, authorizationMode: 'business-login-configuration', legacyScopeParameter: false,
        supportedModes: ['page', 'identity'],
        personalIdentity: { messagingSupported: false, tokenReturnedToDesktop: false },
        callbackUrl: 'https://identity.example.test/oauth/facebook/callback',
        requiredPermissions: ['pages_show_list', 'pages_messaging', 'pages_manage_metadata'],
        optionalPermissions: ['pages_read_engagement'],
        pageDiscovery: {
          primary: '/me/accounts',
          tokenRecovery: ['/{debug_token.user_id}/accounts', '/{granular_target_id}?fields=access_token'],
          selectionEvidence: 'debug_token.granular_scopes.target_ids', directPageProfileProbe: true,
          directPageTokenRecovery: true, directPageTokenFields: ['id,access_token', 'access_token'],
          profileHydration: 'page-access-token', diagnosticsPersistedWithoutTokens: true
        }
      }
    });
  });
  const verified = await facebookOAuthService.verifyWorkerOAuthContract(
    'https://identity.example.test', 'v25.0', 'identity',
    { physicalOperationContext: frozenOAuthOperation('facebook-personal-identity-account') }
  );
  assert.equal(verified.service, 'yance-facebook-gateway');
  assert.equal(verified.oauthContract.personalIdentity.messagingSupported, false);
});
