'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createR32LocalApiSecurity } = require('../middleware/r32LocalApiSecurity');
const { createPersonalAccessGuard } = require('../middleware/personalAccessGuard');
const startupContext = require('../bootstrap/desktopStartupContext');

const signedHeaders = {
  'content-type': 'application/json',
  'x-chatwoot-timestamp': '1790462000',
  'x-chatwoot-signature': `sha256=${'a'.repeat(64)}`,
};

function responseProbe() {
  return {
    statusCode: 200,
    payload: null,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
}

function request(headers = signedHeaders, path = '/api/r32/accounts/facebook/webhook') {
  return { method: 'POST', path, originalUrl: path, url: path, headers, socket: { remoteAddress: '127.0.0.1' } };
}
test('signed Chatwoot Page webhook reaches HMAC owner without local UI session token', async () => {
  startupContext.resetForTests();
  startupContext.configureDesktopStartupContext({ apiSessionToken: 'test-session', startupNonce: 'chatwoot-auth-test', backendPid: process.pid });
  const middleware = createR32LocalApiSecurity();
  const res = responseProbe();
  let nextCalled = false;
  middleware(request(), res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.equal(res.payload, null);
});

test('unsigned or wrong-path request remains protected by local UI session auth', () => {
  startupContext.resetForTests();
  startupContext.configureDesktopStartupContext({ apiSessionToken: 'test-session', startupNonce: 'chatwoot-auth-test', backendPid: process.pid });
  for (const req of [request({ 'content-type': 'application/json' }), request(signedHeaders, '/api/r32/accounts/not-webhook')]) {
    const res = responseProbe();
    let nextCalled = false;
    createR32LocalApiSecurity()(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 401);
    assert.equal(res.payload?.code, 'API_SESSION_UNAUTHORIZED');
  }
});

test('signed Chatwoot Page webhook bypasses Product entitlement but unsigned request does not', async () => {
  let calls = 0;
  const guard = createPersonalAccessGuard({ personalAccessService: { async authorizeProductRequest() { calls += 1; return { usable: false, reasonCode: 'TEST_DENY' }; } } });
  const signedRes = responseProbe(); let signedNext = false;
  await guard(request(), signedRes, () => { signedNext = true; });
  assert.equal(signedNext, true); assert.equal(calls, 0);
  const unsignedRes = responseProbe(); let unsignedNext = false;
  await guard(request({ 'content-type': 'application/json' }), unsignedRes, () => { unsignedNext = true; });
  assert.equal(unsignedNext, false); assert.equal(calls, 1); assert.equal(unsignedRes.statusCode, 403);
});
