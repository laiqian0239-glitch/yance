'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const SERVICE_PATH = path.resolve(__dirname, '../services/personalAccessService.js');
const GUARD_PATH = path.resolve(__dirname, '../middleware/personalAccessGuard.js');

function loadService() {
  assert.equal(fs.existsSync(SERVICE_PATH), true, 'missing OWNER/TESTER personal access service authority');
  return require(SERVICE_PATH);
}

function loadGuard() {
  assert.equal(fs.existsSync(GUARD_PATH), true, 'missing product entitlement guard');
  return require(GUARD_PATH);
}

test('personal access authority exposes the exact request and grant lifecycles', () => {
  const { REQUEST_STATES, GRANT_STATES } = loadService();
  assert.deepEqual(Array.from(REQUEST_STATES), ['PENDING', 'ASSIGNED', 'APPROVED', 'REJECTED']);
  assert.deepEqual(Array.from(GRANT_STATES), ['ACTIVE', 'SUSPENDED', 'REVOKED']);
});

test('OWNER remains permanently usable independent of tester remote state', () => {
  const { evaluateEntitlement } = loadService();
  for (const remoteState of [
    null,
    { requestState: 'PENDING', grantState: null },
    { requestState: 'REJECTED', grantState: null },
    { requestState: 'APPROVED', grantState: 'SUSPENDED' },
    { requestState: 'APPROVED', grantState: 'REVOKED' }
  ]) {
    const result = evaluateEntitlement({
      ownerCredentialPresent: true,
      installationId: 'owner-installation',
      remoteState
    });
    assert.equal(result.role, 'OWNER');
    assert.equal(result.usable, true);
    assert.equal(result.reasonCode, 'OWNER_PERMANENT_ACCESS');
  }
});

test('TESTER is usable only for ACTIVE server authority bound to this installation', () => {
  const { evaluateEntitlement } = loadService();
  const active = evaluateEntitlement({
    ownerCredentialPresent: false,
    installationId: 'install-a',
    remoteState: {
      role: 'TESTER',
      requestState: 'APPROVED',
      grantState: 'ACTIVE',
      installationId: 'install-a'
    }
  });
  assert.equal(active.role, 'TESTER');
  assert.equal(active.usable, true);
  assert.equal(active.reasonCode, 'TESTER_ACTIVE');

  const copied = evaluateEntitlement({
    ownerCredentialPresent: false,
    installationId: 'install-b',
    remoteState: {
      role: 'TESTER',
      requestState: 'APPROVED',
      grantState: 'ACTIVE',
      installationId: 'install-a'
    }
  });
  assert.equal(copied.usable, false);
  assert.equal(copied.reasonCode, 'INSTALLATION_MISMATCH');
});

test('non-active or unavailable TESTER remote authority always fails closed', () => {
  const { evaluateEntitlement } = loadService();
  const cases = [
    [null, 'REMOTE_AUTHORITY_UNAVAILABLE'],
    [{ role: 'TESTER', requestState: 'PENDING', grantState: null, installationId: 'install-a' }, 'REQUEST_PENDING'],
    [{ role: 'TESTER', requestState: 'ASSIGNED', grantState: null, installationId: 'install-a' }, 'REQUEST_ASSIGNED'],
    [{ role: 'TESTER', requestState: 'REJECTED', grantState: null, installationId: 'install-a' }, 'REQUEST_REJECTED'],
    [{ role: 'TESTER', requestState: 'APPROVED', grantState: 'SUSPENDED', installationId: 'install-a' }, 'GRANT_SUSPENDED'],
    [{ role: 'TESTER', requestState: 'APPROVED', grantState: 'REVOKED', installationId: 'install-a' }, 'GRANT_REVOKED']
  ];
  for (const [remoteState, reasonCode] of cases) {
    const result = evaluateEntitlement({
      ownerCredentialPresent: false,
      installationId: 'install-a',
      remoteState
    });
    assert.equal(result.usable, false, reasonCode);
    assert.equal(result.reasonCode, reasonCode);
  }
});

test('minimal request surface is exact and every other product API is entitlement protected', () => {
  const { isMinimalPersonalAccessPath } = loadGuard();
  for (const [method, route] of [
    ['GET', '/api/r32/personal-access/status'],
    ['POST', '/api/r32/personal-access/submit-request'],
    ['POST', '/api/r32/personal-access/refresh-request']
  ]) {
    assert.equal(isMinimalPersonalAccessPath(method, route), true, `${method} ${route}`);
  }
  for (const [method, route] of [
    ['GET', '/api/r32/messages'],
    ['GET', '/api/app/v2/state'],
    ['POST', '/api/r32/personal-access/owner/requests/r1/approve'],
    ['GET', '/api/r32/personal-access/owner/requests'],
    ['GET', '/api/r32/personal-access/submit-request']
  ]) {
    assert.equal(isMinimalPersonalAccessPath(method, route), false, `${method} ${route}`);
  }
});

test('guard returns fail-closed 403 for an unapproved installation and allows active tester', async () => {
  const { createPersonalAccessGuard } = loadGuard();
  const makeResponse = () => ({
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; }
  });

  const deniedGuard = createPersonalAccessGuard({
    personalAccessService: { authorizeProductRequest: async () => ({ usable: false, reasonCode: 'REQUEST_PENDING', role: 'TESTER' }) }
  });
  const deniedRes = makeResponse();
  let deniedNext = 0;
  await deniedGuard({ method: 'GET', path: '/api/r32/messages', originalUrl: '/api/r32/messages' }, deniedRes, () => { deniedNext += 1; });
  assert.equal(deniedNext, 0);
  assert.equal(deniedRes.statusCode, 403);
  assert.equal(deniedRes.payload.code, 'PERSONAL_ACCESS_REQUIRED');
  assert.equal(deniedRes.payload.reasonCode, 'REQUEST_PENDING');

  const activeGuard = createPersonalAccessGuard({
    personalAccessService: { authorizeProductRequest: async () => ({ usable: true, reasonCode: 'TESTER_ACTIVE', role: 'TESTER' }) }
  });
  const activeRes = makeResponse();
  let activeNext = 0;
  await activeGuard({ method: 'GET', path: '/api/r32/messages', originalUrl: '/api/r32/messages' }, activeRes, () => { activeNext += 1; });
  assert.equal(activeNext, 1);
  assert.equal(activeRes.statusCode, 200);
});
