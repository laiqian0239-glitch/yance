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

function credentialStore(initial = {}, events = []) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    get(ref) { return values.get(ref) || null; },
    async persist(ref, value) { events.push(`persist:${ref}`); values.set(ref, value); },
    async remove(ref) { events.push(`remove:${ref}`); values.delete(ref); }
  };
}

function fetchAuthority({ subject = '@tester:yance.local', externalId = 'tester', worker = {}, matrixLoginFailures = 0, events = [] } = {}) {
  const calls = [];
  let matrixLoginAttempts = 0;
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    if (String(url).includes('/_matrix/federation/v1/openid/userinfo')) {
      events.push('matrix-openid');
      return new Response(JSON.stringify({ sub: subject }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (String(url).endsWith('/verify')) {
      events.push('verify');
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
      events.push('status');
      return new Response(JSON.stringify({
        ok: true,
        enabled: worker.enabled !== false,
        keyId: worker.keyId || 'key_123',
        expires: worker.expires ?? null,
        identity: { externalId: worker.externalId || externalId },
        requestId: 'worker-status-1'
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (String(url).endsWith('/_matrix/client/v3/login')) {
      events.push('matrix-login');
      matrixLoginAttempts += 1;
      if (matrixLoginAttempts <= matrixLoginFailures) {
        return new Response(JSON.stringify({ ok: false, reasonCode: 'MATRIX_JWT_LOGIN_UNAVAILABLE' }), {
          status: 503,
          headers: { 'content-type': 'application/json' }
        });
      }
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

test('post-login activation verifies the already-persisted keyId exactly once after Matrix subject proof', async () => {
  const { createPersonalAccessService } = loadService();
  const events = [];
  const store = credentialStore({ 'personal-access.invitation-key': { keyId: 'key_123' } }, events);
  const authority = fetchAuthority({ events });
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
  assert.deepEqual(events, ['matrix-openid', 'status']);
  assert.equal(authority.calls.length, 2);
  assert.deepEqual(JSON.parse(authority.calls[1].init.body), { keyId: 'key_123' });
});

test('first TESTER invitation persists only keyId before Matrix handoff and keeps bearer tokens transient', async () => {
  const { createPersonalAccessService } = loadService();
  const events = [];
  const store = credentialStore({}, events);
  const authority = fetchAuthority({ events });
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
  assert.deepEqual(store.values.get('personal-access.invitation-key'), { keyId: 'key_123' });
  assert.equal(JSON.stringify(store.values.get('personal-access.invitation-key')).includes('invite_live'), false);
  assert.equal(JSON.stringify(store.values.get('personal-access.invitation-key')).includes('matrix-access-token'), false);
  assert.ok(events.indexOf('verify') >= 0);
  assert.ok(events.indexOf('persist:personal-access.invitation-key') > events.indexOf('verify'));
  assert.ok(events.indexOf('matrix-login') > events.indexOf('persist:personal-access.invitation-key'));
  assert.equal(authority.calls.filter(call => String(call.url).endsWith('/verify')).length, 1);

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
});

test('same device no-invitation re-entry uses non-consumptive status and never verifies the raw invitation twice', async () => {
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

  const first = await service.login({ invitationKey: 'invite_live' });
  const resumed = await service.login({});
  assert.equal(first.usable, true);
  assert.equal(resumed.usable, true);
  assert.equal(resumed.accountAuth.userId, '@tester:yance.local');
  assert.equal(authority.calls.filter(call => String(call.url).endsWith('/verify')).length, 1);
  assert.equal(authority.calls.filter(call => String(call.url).endsWith('/status')).length, 1);
  assert.equal(authority.calls.filter(call => String(call.url).endsWith('/_matrix/client/v3/login')).length, 2);
});

test('downstream Matrix failure leaves the keyId receipt durable so retry resumes without another consumptive verify', async () => {
  const { createPersonalAccessService } = loadService();
  const store = credentialStore();
  const authority = fetchAuthority({ matrixLoginFailures: 1 });
  const service = createPersonalAccessService({
    credentialStore: store,
    authorityUrl: 'https://access.example',
    matrixBaseUrl: 'http://127.0.0.1:8008',
    matrixServerName: 'yance.local',
    matrixJwtSecret: 'matrix-registration-secret',
    fetchImpl: authority.fetchImpl
  });

  await assert.rejects(
    service.login({ invitationKey: 'invite_live' }),
    error => error?.reasonCode === 'MATRIX_JWT_LOGIN_UNAVAILABLE'
  );
  assert.deepEqual(store.values.get('personal-access.invitation-key'), { keyId: 'key_123' });

  const resumed = await service.login({ invitationKey: 'invite_live' });
  assert.equal(resumed.usable, true);
  assert.equal(authority.calls.filter(call => String(call.url).endsWith('/verify')).length, 1);
  assert.equal(authority.calls.filter(call => String(call.url).endsWith('/status')).length, 1);
});

test('stored receipt authority failure never falls back to a consumptive invitation retry', async () => {
  const { createPersonalAccessService } = loadService();
  const calls = [];
  const store = credentialStore({ 'personal-access.invitation-key': { keyId: 'key_123' } });
  const service = createPersonalAccessService({
    credentialStore: store,
    authorityUrl: 'https://access.example',
    matrixBaseUrl: 'http://127.0.0.1:8008',
    matrixServerName: 'yance.local',
    matrixJwtSecret: 'matrix-registration-secret',
    fetchImpl: async (url) => {
      calls.push(String(url));
      if (String(url).endsWith('/status')) {
        return new Response(JSON.stringify({ ok: false, reasonCode: 'UNKEY_AUTHORITY_UNAVAILABLE' }), {
          status: 503,
          headers: { 'content-type': 'application/json' }
        });
      }
      throw new Error('consumptive fallback must not execute');
    }
  });

  const result = await service.login({ invitationKey: 'invite_live' });
  assert.equal(result.usable, false);
  assert.equal(result.reasonCode, 'UNKEY_AUTHORITY_UNAVAILABLE');
  assert.deepEqual(calls, ['https://access.example/status']);
  assert.deepEqual(store.values.get('personal-access.invitation-key'), { keyId: 'key_123' });
});

test('missing stored Unkey key is terminal, clears once, and a fresh invitation is only eligible on the next explicit login', async () => {
  const { createPersonalAccessService } = loadService();
  const calls = [];
  const store = credentialStore({ 'personal-access.invitation-key': { keyId: 'key_stale' } });
  const service = createPersonalAccessService({
    credentialStore: store,
    authorityUrl: 'https://access.example',
    matrixBaseUrl: 'http://127.0.0.1:8008',
    matrixServerName: 'yance.local',
    matrixJwtSecret: 'matrix-registration-secret',
    fetchImpl: async (url, init = {}) => {
      calls.push(String(url));
      if (String(url).endsWith('/status')) {
        return new Response(JSON.stringify({ ok: false, reasonCode: 'UNKEY_AUTHORITY_REJECTED' }), {
          status: 404,
          headers: { 'content-type': 'application/json' }
        });
      }
      if (String(url).endsWith('/verify')) {
        return new Response(JSON.stringify({
          ok: true,
          valid: true,
          enabled: true,
          keyId: 'key_new',
          expires: null,
          identity: { externalId: 'tester' }
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (String(url).endsWith('/_matrix/client/v3/login')) {
        const payload = JSON.parse(init.body || '{}');
        jwt.verify(payload.token, 'matrix-registration-secret', {
          algorithms: ['HS256'], issuer: 'yance-personal-access', audience: 'yance.local'
        });
        return new Response(JSON.stringify({
          user_id: '@tester:yance.local', access_token: 'matrix-access-token', device_id: 'DEVICE123'
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response('{}', { status: 404 });
    }
  });

  const stale = await service.login({ invitationKey: 'invite_live' });
  assert.equal(stale.reasonCode, 'UNKEY_ENTITLEMENT_INVALID');
  assert.equal(store.values.has('personal-access.invitation-key'), false);
  assert.deepEqual(calls, ['https://access.example/status']);

  const fresh = await service.login({ invitationKey: 'invite_live' });
  assert.equal(fresh.usable, true);
  assert.deepEqual(store.values.get('personal-access.invitation-key'), { keyId: 'key_new' });
  assert.equal(calls.filter(url => url.endsWith('/verify')).length, 1);
});

test('returning TESTER status uses stored keyId with getKey and rejects legacy raw invitation receipt', async () => {
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
    credentialStore: credentialStore({ 'personal-access.invitation-key': { keyId: 'key_123' } }),
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

test('TESTER fails closed on disabled or expired getKey and session logout preserves durable device receipt', async () => {
  const { createPersonalAccessService } = loadService();
  const disabled = createPersonalAccessService({
    credentialStore: credentialStore({ 'personal-access.invitation-key': { keyId: 'key_123' } }),
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
    credentialStore: credentialStore({ 'personal-access.invitation-key': { keyId: 'key_123' } }),
    authorityUrl: 'https://access.example',
    matrixServerName: 'yance.local',
    fetchImpl: fetchAuthority({ worker: { expires: 1577836800000 } }).fetchImpl
  });
  assert.equal((await expired.activate(input)).reasonCode, 'UNKEY_ENTITLEMENT_EXPIRED');

  const malformedExpiry = createPersonalAccessService({
    credentialStore: credentialStore({ 'personal-access.invitation-key': { keyId: 'key_123' } }),
    authorityUrl: 'https://access.example',
    matrixServerName: 'yance.local',
    fetchImpl: fetchAuthority({ worker: { expires: 'not-a-millisecond-timestamp' } }).fetchImpl
  });
  assert.equal((await malformedExpiry.activate(input)).reasonCode, 'UNKEY_ENTITLEMENT_EXPIRY_INVALID');

  const store = credentialStore({ 'personal-access.invitation-key': { keyId: 'key_123' } });
  const service = createPersonalAccessService({ credentialStore: store, authorityUrl: 'https://access.example' });
  const logout = await service.logout();
  assert.equal(logout.reasonCode, 'DEVICE_ENTITLEMENT_PRESERVED');
  assert.deepEqual(store.values.get('personal-access.invitation-key'), { keyId: 'key_123' });
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