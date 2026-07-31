'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, before, after } = require('node:test');
const vm = require('node:vm');
const { createR32LocalApiSecurity } = require('../middleware/r32LocalApiSecurity');
const { installR32StoreBridge } = require('../../electron/r32StoreBridge');
const desktopStartupContext = require('../bootstrap/desktopStartupContext');

const ROOT = path.resolve(__dirname, '../..');

before(() => {
  desktopStartupContext.resetForTests();
  desktopStartupContext.configureDesktopStartupContext({ apiSessionToken: 'test-session' });
});

after(() => desktopStartupContext.resetForTests());

function fakeResponse() {
  return {
    statusCode: 200,
    headers: {},
    payload: null,
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = String(value); },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; }
  };
}

function invokeSecurity(middleware, { method = 'GET', url = '/api/test' } = {}) {
  const req = {
    method,
    path: url.split('?')[0],
    url,
    socket: { remoteAddress: '127.0.0.1' },
    headers: { authorization: 'Bearer test-session' }
  };
  const res = fakeResponse();
  let nextCalled = false;
  middleware(req, res, () => { nextCalled = true; });
  return { res, nextCalled };
}

test('authenticated loopback reads and writes use separate rate-limit budgets', () => {
  const middleware = createR32LocalApiSecurity({ maxRequests: 30, readMaxRequests: 60, windowMs: 60_000 });
  for (let index = 0; index < 60; index += 1) {
    const result = invokeSecurity(middleware, { method: 'GET', url: '/api/r32/store/snapshot' });
    assert.equal(result.nextCalled, true);
    assert.equal(result.res.statusCode, 200);
  }
  const blockedRead = invokeSecurity(middleware, { method: 'GET', url: '/api/r32/store/snapshot' });
  assert.equal(blockedRead.nextCalled, false);
  assert.equal(blockedRead.res.statusCode, 429);
  assert.equal(blockedRead.res.payload.code, 'RATE_LIMITED');
  assert.ok(blockedRead.res.payload.retryAfterMs >= 1000);
  assert.equal(blockedRead.res.payload.requestClass, 'read');

  for (let index = 0; index < 30; index += 1) {
    const result = invokeSecurity(middleware, { method: 'POST', url: '/api/r32/store/ui/reading-mode' });
    assert.equal(result.nextCalled, true);
  }
  const blockedWrite = invokeSecurity(middleware, { method: 'POST', url: '/api/r32/store/ui/reading-mode' });
  assert.equal(blockedWrite.res.statusCode, 429);
  assert.equal(blockedWrite.res.payload.requestClass, 'write');
});

test('store IPC returns structured expected errors instead of throwing from the Electron handler', async () => {
  const handlers = new Map();
  const ipcMain = {
    handle(channel, handler) { handlers.set(channel, handler); },
    removeHandler(channel) { handlers.delete(channel); }
  };
  const apiError = Object.assign(new Error('Too many requests'), {
    code: 'RATE_LIMITED', reasonCode: 'RATE_LIMITED', status: 429, retryAfterMs: 4200, requestId: 'req-1'
  });
  const dispose = installR32StoreBridge({ ipcMain, apiRequest: async () => { throw apiError; } });
  const result = await handlers.get('store:get-snapshot')({}, { domains: ['customers'] });
  assert.deepEqual(result, {
    __yanceBridgeError: true,
    message: 'Too many requests',
    code: 'RATE_LIMITED',
    reasonCode: 'RATE_LIMITED',
    status: 429,
    retryAfterMs: 4200,
    requestId: 'req-1'
  });
  dispose();
  assert.equal(handlers.size, 0);
});

test('renderer StoreClient coalesces event storms and duplicate social-context reads', async () => {
  const source = fs.readFileSync(path.join(ROOT, 'frontend/js/r32-store-client.js'), 'utf8');
  let desktopListener = null;
  let snapshotCalls = 0;
  let socialCalls = 0;
  let stateVersion = 1;
  const context = {
    console,
    setTimeout,
    clearTimeout,
    queueMicrotask,
    structuredClone,
    URLSearchParams,
    fetch: async () => { throw new Error('unexpected fetch'); },
    crypto: { randomUUID: () => `id-${Math.random()}` },
    window: {
      addEventListener() {},
      yanceDesktop: {
        onDesktopEvent(listener) { desktopListener = listener; return () => { desktopListener = null; }; },
        async storeSnapshot() {
          snapshotCalls += 1;
          return { ok: true, stateVersion: stateVersion++, snapshot: { meta: { hydrated: true, stateVersion } } };
        },
        async storeSocialContext() {
          socialCalls += 1;
          await new Promise(resolve => setTimeout(resolve, 25));
          return { ok: true, context: { found: true, contactId: 'contact-1' } };
        }
      }
    }
  };
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: 'r32-store-client.js' });
  await context.window.YanceStoreClient.start();
  assert.equal(snapshotCalls, 1);
  assert.equal(typeof desktopListener, 'function');

  for (let index = 0; index < 100; index += 1) {
    desktopListener({
      type: 'store:event',
      payload: {
        eventId: `event-${index}`,
        eventType: 'customer.socialState.updated',
        domain: 'customers',
        stateVersion: 100 + index,
        priority: 'critical'
      }
    });
  }
  await new Promise(resolve => setTimeout(resolve, 525));
  assert.ok(snapshotCalls <= 3, `expected coalesced snapshots, got ${snapshotCalls}`);

  const [first, second] = await Promise.all([
    context.window.YanceStoreClient.getCustomerSocialContext('contact-1', { timelineLimit: 48, recentMessageLimit: 60 }),
    context.window.YanceStoreClient.getCustomerSocialContext('contact-1', { timelineLimit: 48, recentMessageLimit: 60 })
  ]);
  assert.equal(socialCalls, 1);
  assert.equal(first.contactId, 'contact-1');
  assert.equal(second.contactId, 'contact-1');
  context.window.YanceStoreClient.stop();
});

test('conversation runtime does not refetch social context for every successful snapshot', () => {
  const source = fs.readFileSync(path.join(ROOT, 'frontend/js/r32-ui-runtime.js'), 'utf8');
  assert.doesNotMatch(source, /'store\.snapshot\.refreshed'\]\.includes\(event\?\.eventType\).*loadStoreSocialContext/);
  assert.match(source, /scheduleStoreSocialContextRefresh\(activeId,event\?\.eventType===['"]customer\.facts\.updated['"]\?120:500\)/);
  assert.match(source, /storeSocialContextRefreshTimer=setTimeout/);
});

test('desktop API errors preserve HTTP and Retry-After metadata for renderer backoff', () => {
  const main = fs.readFileSync(path.join(ROOT, 'electron/main.js'), 'utf8');
  const preload = fs.readFileSync(path.join(ROOT, 'electron/preload.js'), 'utf8');
  assert.match(main, /error\.status = Number\(response\.status/);
  assert.match(main, /parseRetryAfterMs\(response\.headers\.get\('retry-after'\)\)/);
  assert.match(preload, /error\.retryAfterMs = Math\.max/);
  assert.match(preload, /invokeStore\('store:get-snapshot'/);
});
