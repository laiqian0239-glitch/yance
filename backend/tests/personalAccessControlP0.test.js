'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

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
    async persist(ref, value) { values.set(ref, value); }
  };
}

function fetchAuthority({ subject = '@tester:yance.local', worker = {} } = {}) {
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
        expires: worker.expires || '',
        identity: { externalId: worker.externalId || subject },
        requestId: 'worker-req-1'
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

test('TESTER stores only the opaque invitation key after Matrix subject and Unkey identity match', async () => {
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
    invitationKey: 'invite_live',
    matrixOpenId: {
      access_token: 'openid-token',
      token_type: 'Bearer',
      matrix_server_name: 'yance.local',
      expires_in: 3600
    }
  });

  assert.equal(result.usable, true);
  assert.equal(result.reasonCode, 'ENTITLEMENT_VALID');
  assert.deepEqual(store.values.get('personal-access.invitation-key'), { key: 'invite_live' });
  assert.equal(store.values.has('personal-access.installation'), false);
  assert.equal(authority.calls.length, 3);
  assert.equal(JSON.parse(authority.calls[1].init.body).key, 'invite_live');
});

test('TESTER fails closed when Matrix subject and Unkey identity differ', async () => {
  const { createPersonalAccessService } = loadService();
  const authority = fetchAuthority({ worker: { externalId: '@other:yance.local' } });
  const service = createPersonalAccessService({
    credentialStore: credentialStore(),
    authorityUrl: 'https://access.example',
    matrixServerName: 'yance.local',
    fetchImpl: authority.fetchImpl
  });

  const result = await service.activate({
    invitationKey: 'invite_live',
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

test('minimal request surface is exact and every other product API is entitlement protected', () => {
  const { isMinimalPersonalAccessPath } = loadGuard();
  for (const [method, route] of [
    ['POST', '/api/r32/personal-access/status'],
    ['POST', '/api/r32/personal-access/activate']
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
