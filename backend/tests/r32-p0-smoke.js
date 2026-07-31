#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { R32SqliteStore } = require('../lib/r32SqliteStore');
const { ExternalIdentityAuthority } = require('../services/externalIdentityAuthority');
const { OutboxRouteAuthority } = require('../services/outboxRouteAuthority');
const outboundCommandRepository = require('../repositories/outboundCommandRepository');
const { createR32LegacyRouteBlocker } = require('../middleware/r32LegacyRouteBlocker');
const { createR32LocalApiSecurity } = require('../middleware/r32LocalApiSecurity');
const startupContext = require('../bootstrap/desktopStartupContext');

function invoke(middleware, request) {
  return new Promise((resolve, reject) => {
    const response = {
      statusCode: 200,
      headers: {},
      body: null,
      setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; resolve({ next: false, response: this }); return this; }
    };
    try {
      middleware(request, response, error => error ? reject(error) : resolve({ next: true, response }));
    } catch (error) { reject(error); }
  });
}

async function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-r32-p0-'));
  const dbPath = path.join(tempRoot, 'yance-r32.db');
  const store = new R32SqliteStore({ dbPath });
  try {
    store.upsertAccount({ id: 'wa', accountId: 'wa', adapterAccountId: 'wa', platform: 'whatsapp', state: 'online', canSend: true, canReceive: true });
    store.upsertConversation({ sessionKey: 'wa:test', accountId: 'wa', title: 'Test', platform: 'whatsapp', routeState: 'bound', chatJid: 'test', externalId: 'test', lastMessageAt: '2026-07-01T00:00:00.000Z' });
    store.touchConversationFromMessage({ sessionKey: 'wa:test', text: 'hello', sentAt: '2026-07-01T00:01:00.000Z' });
    store.upsertMessage({ id: 'm1', sessionKey: 'wa:test', role: 'customer', text: 'hello', sentAt: '2026-07-01T00:01:00.000Z' });
    assert.equal(store.listConversations()[0].title, 'Test');
    assert.equal(store.listMessages('wa:test').length, 1);
    assert.equal(store.searchMessages('hello').length, 1);

    const routeAuthority = new OutboxRouteAuthority({ storeProvider: () => store, externalIdentityAuthority: new ExternalIdentityAuthority({ storeProvider: () => store }) });
    const outbound = {
      store, outboxRouteAuthority: routeAuthority,
      route: { conversationId: 'wa:test', accountId: 'wa', platform: 'whatsapp', routeTarget: 'test', capabilitySnapshotId: '' },
      queue: { idempotencyKey: 'smoke-once', accountId: 'wa', sessionKey: 'wa:test', payload: { platform: 'whatsapp', operation: 'text', chatJid: 'test', text: 'hello' } }
    };
    const first = outboundCommandRepository.createAtomic(outbound).queue;
    const second = outboundCommandRepository.createAtomic(outbound).queue;
    assert.equal(first.id, second.id);
    assert.equal(store.claimNextSend().state, 'sending');
  } finally {
    store.close();
    fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }

  const blocker = createR32LegacyRouteBlocker();
  const blocked = await invoke(blocker, { path: '/api/r31/messages', originalUrl: '/api/r31/messages' });
  assert.equal(blocked.response.statusCode, 410);
  assert.equal(blocked.response.body.code, 'R31_API_RETIRED');

  startupContext.resetForTests();
  startupContext.configureDesktopStartupContext({ apiSessionToken: 'secret', startupNonce: 'r32-p0-smoke', backendPid: process.pid });
  const security = createR32LocalApiSecurity({ maxRequests: 50 });
  const baseRequest = {
    method: 'GET', path: '/api/conversations', url: '/api/conversations',
    socket: { remoteAddress: '127.0.0.1' },
    headers: { host: '127.0.0.1:27632', origin: 'http://127.0.0.1:27632' }
  };
  const denied = await invoke(security, baseRequest);
  assert.equal(denied.response.statusCode, 401);
  const allowed = await invoke(security, { ...baseRequest, headers: { ...baseRequest.headers, 'x-yance-session': 'secret' } });
  assert.equal(allowed.next, true);
  const health = await invoke(security, { ...baseRequest, path: '/api/health', url: '/api/health' });
  assert.equal(health.next, true);

  startupContext.resetForTests();
  console.log('R32 P0 smoke: PASS');
}

main().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
