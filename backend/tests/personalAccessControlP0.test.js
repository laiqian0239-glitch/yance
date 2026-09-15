'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const jwt = require('jsonwebtoken');

const SERVICE_PATH = path.resolve(__dirname, '../services/personalAccessService.js');
const GUARD_PATH = path.resolve(__dirname, '../middleware/personalAccessGuard.js');

function loadService() {
  assert.equal(fs.existsSync(SERVICE_PATH), true, 'missing OWNER/TESTER personal access service authority');
  delete require.cache[SERVICE_PATH];
  return require(SERVICE_PATH);
}

function loadGuard() {
  assert.equal(fs.existsSync(GUARD_PATH), true, 'missing product entitlement guard');
  delete require.cache[GUARD_PATH];
  return require(GUARD_PATH);
}

function credentialStore(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    get(ref) { return values.get(ref) || null; },
    async persist(ref, value) { values.set(ref, value); },
    async remove(ref) { values.delete(ref); }
  };
}

function fetchAuthority({ subject = '@tester:yance.local', externalId = 'tester', worker = {} } = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    if (String(url).includes('/_matrix/federation/v1/openid/userinfo')) {
      return new Response(JSON.stringify({ sub: subject }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (String(url).endsWith('/verify')) {
      return new Response(JSON.stringify({
        ok: true,
        valid: worker.valid !== false,
        enabled: worker.enabled !== false,
        keyId: worker.keyId || 'key_123',
        expires: worker.expires ?? null,
        identity: { externalId: worker.externalId || externalId },
        requestId: 'worker-req-1'
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (String(url).endsWith('/status')) {
      return new Response(JSON.stringify({
        ok: true,
        valid: true,
        enabled: worker.enabled !== false,
        keyId: worker.keyId || 'key_123',
        expires: worker.expires ?? null,
        identity: { externalId: worker.externalId || externalId },
        requestId: 'worker-status-1'
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (String(url).endsWith('/_matrix/client/v3/login')) {
      const payload = JSON.parse(init.body || '{}');
      assert.equal(payload.type, 'org.matrix.login.jwt');
      const decoded = jwt.verify(payload.token, 'matrix-registration-secret', {
        algorithms: ['HS256'],
        issuer: 'yance-personal-access',
        audience: 'yance.local'
      });
      assert.equal(decoded.sub, 'tester');
      return new Response(JSON.stringify({
        user_id: '@tester:yance.local',
        access_token: 'matrix-access-token',
        device_id: 'DEVICE123'
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('{}', { status: 404 });
  };
  return { calls, fetchImpl };
}

test('OWNER marker grants local Product access without sending a secret to Worker', async () => {
  const { createPersonalAccessService } = loadService();
  const authority = fetchAuthority();
  const service = createPersonalAccessService({
    credentialStore: credentialStore({ 'personal-access.owner-admin': { present: true } }),
    authorityUrl: 'https://access.example',
    fetchImpl: authority.fetchImpl
  });

  const status = await service.status();
  assert.equal(status.role, 'OWNER');
  assert.equal(status.usable, true);
  assert.equal(status.reasonCode, 'OWNER_PERMANENT_ACCESS');
  assert.equal(authority.calls.length, 0);
});

test('TESTER stores only the non-secret keyId receipt after Matrix subject and Unkey identity match', async () => {
  const { createPersonalAccessService } = loadService();
  const store = credentialStore();
  const authority = fetchAuthority();
  const service = createPersonalAccessService({
    credentialStore: store,
    authorityUrl: 'https://access.example',
    matrixBaseUrl: 'http://127.0.0.1:8008',
    matrixServerName: 'yance.local',
    fetchImpl: authority.fetchImpl
  });

  const result = await service.activate({
    keyId: 'key_123',
    matrixOpenId: {
      access_token: 'openid-token',
      token_type: 'Bearer',
      matrix_server_name: 'yance.local',
      expires_in: 3600
    }
  });

  assert.equal(result.usable, true);
  assert.equal(result.reasonCode, 'ENTITLEMENT_VALID');
  assert.deepEqual(store.values.get('personal-access.invitation-key'), { keyId: 'key_123' });
  assert.equal(JSON.stringify(store.values.get('personal-access.invitation-key')).includes('invite_live'), false);
  assert.equal(store.values.has('personal-access.installation'), false);
  assert.equal(authority.calls.length, 3);
  assert.deepEqual(JSON.parse(authority.calls[1].init.body), { keyId: 'key_123' });
});

test('TESTER invitation login uses Synapse JWT and keeps invitation/access tokens transient', async () => {
  const { createPersonalAccessService } = loadService();
  const store = credentialStore();
  const authority = fetchAuthority();
  const service = createPersonalAccessService({
    credentialStore: store,
    authorityUrl: 'https://access.example',
    matrixBaseUrl: 'http://127.0.0.1:8008',
    matrixServerName: 'yance.local',
    matrixJwtSecret: 'matrix-registration-secret',
    fetchImpl: authority.fetchImpl
  });

  const result = await service.login({ invitationKey: 'invite_live' });

  assert.equal(result.usable, true);
  assert.equal(result.reasonCode, 'ENTITLEMENT_VALID');
  assert.equal(result.accountAuth.userId, '@tester:yance.local');
  assert.equal(result.accountAuth.deviceId, 'DEVICE123');
  assert.equal(result.accountAuth.accessToken, 'matrix-access-token');
  assert.equal(result.subject, '@tester:yance.local');
  assert.equal(store.values.has('personal-access.invitation-key'), false);

  const legacyMxidAuthority = fetchAuthority({ worker: { externalId: '@tester:yance.local' } });
  const legacyMxid = createPersonalAccessService({
    credentialStore: credentialStore(),
    authorityUrl: 'https://access.example',
    matrixBaseUrl: 'http://127.0.0.1:8008',
    matrixServerName: 'yance.local',
    matrixJwtSecret: 'matrix-registration-secret',
    fetchImpl: legacyMxidAuthority.fetchImpl
  });
  assert.equal((await legacyMxid.login({ invitationKey: 'invite_live' })).reasonCode, 'MATRIX_INVITATION_EXTERNAL_ID_INVALID');
  assert.equal(authority.calls.length, 2);
  assert.equal(authority.calls[0].url, 'https://access.example/verify');
  assert.deepEqual(JSON.parse(authority.calls[0].init.body), { key: 'invite_live' });
  assert.match(authority.calls[1].url, /\/_matrix\/client\/v3\/login$/u);
});

test('returning TESTER uses stored keyId with getKey and rejects legacy raw invitation receipt', async () => {
  const { createPersonalAccessService } = loadService();
  const store = credentialStore({ 'personal-access.invitation-key': { keyId: 'key_123' } });
  const authority = fetchAuthority();
  const service = createPersonalAccessService({
    credentialStore: store,
    authorityUrl: 'https://access.example',
    matrixServerName: 'yance.local',
    fetchImpl: authority.fetchImpl
  });

  const result = await service.status({
    matrixOpenId: {
      access_token: 'openid-token',
      token_type: 'Bearer',
      matrix_server_name: 'yance.local',
      expires_in: 3600
    }
  });
  assert.equal(result.usable, true);
  assert.equal(result.keyId, 'key_123');
  assert.deepEqual(JSON.parse(authority.calls[1].init.body), { keyId: 'key_123' });

  const legacy = createPersonalAccessService({
    credentialStore: credentialStore({ 'personal-access.invitation-key': { key: 'invite_live' } }),
    authorityUrl: 'https://access.example',
    matrixServerName: 'yance.local',
    fetchImpl: authority.fetchImpl
  });
  assert.equal((await legacy.status()).reasonCode, 'INVITATION_REQUIRED');
});

test('TESTER fails closed when Matrix subject and Unkey identity differ', async () => {
  const { createPersonalAccessService } = loadService();
  const authority = fetchAuthority({ worker: { externalId: 'other' } });
  const service = createPersonalAccessService({
    credentialStore: credentialStore(),
    authorityUrl: 'https://access.example',
    matrixServerName: 'yance.local',
    fetchImpl: authority.fetchImpl
  });

  const result = await service.activate({
    keyId: 'key_123',
    matrixOpenId: {
      access_token: 'openid-token',
      token_type: 'Bearer',
      matrix_server_name: 'yance.local',
      expires_in: 3600
    }
  });
  assert.equal(result.usable, false);
  assert.equal(result.reasonCode, 'MATRIX_SUBJECT_MISMATCH');
});

test('TESTER fails closed on disabled or expired getKey and logout clears receipt', async () => {
  const { createPersonalAccessService } = loadService();
  const disabled = createPersonalAccessService({
    credentialStore: credentialStore(),
    authorityUrl: 'https://access.example',
    matrixServerName: 'yance.local',
    fetchImpl: fetchAuthority({ worker: { enabled: false } }).fetchImpl
  });
  const input = {
    keyId: 'key_123',
    matrixOpenId: {
      access_token: 'openid-token',
      token_type: 'Bearer',
      matrix_server_name: 'yance.local',
      expires_in: 3600
    }
  };
  assert.equal((await disabled.activate(input)).reasonCode, 'UNKEY_ENTITLEMENT_DISABLED');

  const expired = createPersonalAccessService({
    credentialStore: credentialStore(),
    authorityUrl: 'https://access.example',
    matrixServerName: 'yance.local',
    fetchImpl: fetchAuthority({ worker: { expires: 1577836800000 } }).fetchImpl
  });
  assert.equal((await expired.activate(input)).reasonCode, 'UNKEY_ENTITLEMENT_EXPIRED');

  const malformedExpiry = createPersonalAccessService({
    credentialStore: credentialStore(),
    authorityUrl: 'https://access.example',
    matrixServerName: 'yance.local',
    fetchImpl: fetchAuthority({ worker: { expires: 'not-a-millisecond-timestamp' } }).fetchImpl
  });
  assert.equal((await malformedExpiry.activate(input)).reasonCode, 'UNKEY_ENTITLEMENT_EXPIRY_INVALID');

  const store = credentialStore({ 'personal-access.invitation-key': { keyId: 'key_123' } });
  const service = createPersonalAccessService({ credentialStore: store, authorityUrl: 'https://access.example' });
  assert.equal((await service.logout()).reasonCode, 'INVITATION_REQUIRED');
  assert.equal(store.values.has('personal-access.invitation-key'), false);
});

test('minimal request surface is exact and every other product API is entitlement protected', () => {
  const { isMinimalPersonalAccessPath } = loadGuard();
  for (const [method, route] of [
    ['POST', '/api/r32/personal-access/status'],
    ['POST', '/api/r32/personal-access/login'],
    ['POST', '/api/r32/personal-access/activate'],
    ['POST', '/api/r32/personal-access/logout']
  ]) {
    assert.equal(isMinimalPersonalAccessPath(method, route), true, `${method} ${route}`);
  }
  for (const [method, route] of [
    ['GET', '/api/r32/personal-access/status'],
    ['GET', '/api/r32/messages'],
    ['GET', '/api/app/v2/state'],
    ['POST', '/api/r32/personal-access/owner'],
    ['GET', '/api/r32/personal-access/activate']
  ]) {
    assert.equal(isMinimalPersonalAccessPath(method, route), false, `${method} ${route}`);
  }
});

test('guard returns fail-closed 403 for missing entitlement and allows active tester', async () => {
  const { createPersonalAccessGuard } = loadGuard();
  const makeResponse = () => ({
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; }
  });

  const deniedGuard = createPersonalAccessGuard({
    personalAccessService: { authorizeProductRequest: async () => ({ usable: false, reasonCode: 'INVITATION_REQUIRED', role: 'TESTER' }) }
  });
  const deniedRes = makeResponse();
  let deniedNext = 0;
  await deniedGuard({ method: 'GET', path: '/api/r32/messages', originalUrl: '/api/r32/messages' }, deniedRes, () => { deniedNext += 1; });
  assert.equal(deniedNext, 0);
  assert.equal(deniedRes.statusCode, 403);
  assert.equal(deniedRes.payload.code, 'PERSONAL_ACCESS_REQUIRED');
  assert.equal(deniedRes.payload.reasonCode, 'INVITATION_REQUIRED');

  const activeGuard = createPersonalAccessGuard({
    personalAccessService: { authorizeProductRequest: async () => ({ usable: true, reasonCode: 'ENTITLEMENT_VALID', role: 'TESTER' }) }
  });
  const activeRes = makeResponse();
  let activeNext = 0;
  await activeGuard({ method: 'GET', path: '/api/r32/messages', originalUrl: '/api/r32/messages' }, activeRes, () => { activeNext += 1; });
  assert.equal(activeNext, 1);
  assert.equal(activeRes.statusCode, 200);
});
