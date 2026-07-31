'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { R32SqliteStore } = require('../lib/r32SqliteStore');
const { createPlatformCoreRepository } = require('../repositories/platformCoreRepository');
const { DomainEventLogService } = require('../services/domainEventLogService');
const { PlatformAdapterFacade, PlatformAdapterRegistryV2 } = require('../services/platformAdapterPorts');
const { PlatformDeliveryAuthority } = require('../services/platformDeliveryAuthority');

function withEventLog(callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-r12-adapter-'));
  const store = new R32SqliteStore({ dbPath: path.join(root, 'database', 'yance.db') });
  const repository = createPlatformCoreRepository({ storeProvider: () => store });
  try { return callback({ store, eventLog: new DomainEventLogService({ repository }) }); }
  finally { try { store.close(); } catch (_) {} fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
}

async function withEventLogAsync(callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-r12-adapter-'));
  const store = new R32SqliteStore({ dbPath: path.join(root, 'database', 'yance.db') });
  const repository = createPlatformCoreRepository({ storeProvider: () => store });
  try {
    return await callback({
      store,
      eventLog: new DomainEventLogService({ repository }),
      deliveryAuthority: new PlatformDeliveryAuthority({ repository })
    });
  } finally {
    try { store.close(); } catch (_) {}
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
}

test('each registered platform exposes exactly auth, ingress, egress and reconcile ports', () => {
  const registry = new PlatformAdapterRegistryV2();
  const contracts = registry.contracts();
  for (const platform of ['facebook', 'whatsapp', 'telegram']) {
    assert.deepEqual(contracts[platform].ports, ['auth', 'ingress', 'egress', 'reconcile']);
    assert.equal(contracts[platform].boundaries.egressConsumesOutboxOnly, true);
    assert.equal(contracts[platform].boundaries.reconcileDoesNotBlockRealtime, true);
  }
});

test('ingress produces a redacted, idempotent domain event instead of UI state', () => {
  withEventLog(({ store, eventLog }) => {
    const facade = new PlatformAdapterFacade('facebook', { eventLog });
    const first = facade.ingress.ingest({
      platform: 'facebook', sourceAccountId: 'page-1', externalEventId: 'evt-1', eventType: 'message.received',
      rawEvent: { id: 'evt-1', text: 'Hallo', pageToken: 'secret' }
    });
    const second = facade.ingress.ingest({
      platform: 'facebook', sourceAccountId: 'page-1', externalEventId: 'evt-1', eventType: 'message.received',
      rawEvent: { id: 'evt-1', text: 'Hallo', pageToken: 'secret' }
    });
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM domain_events').get().count, 1);
    assert.equal(first.event.payload.pageToken, '[REDACTED]');
  });
});

test('egress refuses non-Outbox payloads and accepts frozen OutboxCommand only', async () => {
  await withEventLogAsync(async ({ eventLog, deliveryAuthority }) => {
    let executed = null;
    const facade = new PlatformAdapterFacade('telegram', {
      eventLog, deliveryAuthority,
      egressAuthorizer: async () => ({ authorized: true, queueId: 'send-1' }),
      egressHandler: async command => { executed = command; return { success: true, platformMessageId: 'm1', raw: { accessToken: 'secret' } }; }
    });
    await assert.rejects(() => facade.egress.execute({ platform: 'telegram', text: 'hello' }), error => error.code === 'EGRESS_OUTBOX_COMMAND_REQUIRED');
    const command = {
      commandType: 'OutboxCommand', commandId: 'send-1', idempotencyKey: 'idem-1', platform: 'telegram',
      accountId: 'tg-1', sessionKey: 'tg-1:peer', conversationTarget: 'peer', operation: 'text', finalText: 'Hallo',
      finalTextSha256: 'x', contentFrozen: true
    };
    const result = await facade.egress.execute(command);
    assert.equal(result.success, true);
    assert.equal(result.resultType, 'PlatformSendResult');
    assert.equal(result.platformMessageId, 'm1');
    assert.equal(Object.prototype.hasOwnProperty.call(result, 'raw'), false);
    assert.equal(executed, command);
  });
});

test('egress treats structured success=false as a rejection instead of platform acceptance', async () => {
  const facade = new PlatformAdapterFacade('telegram', {
    egressAuthorizer: async () => ({ authorized: true, queueId: 'send-failed' }),
    egressHandler: async () => ({ success: false, reasonCode: 'REMOTE_REJECTED', message: 'denied' })
  });
  const command = {
    commandType: 'OutboxCommand', commandId: 'send-failed', outboxId: 'send-failed', idempotencyKey: 'idem-failed', platform: 'telegram',
    accountId: 'tg-1', sessionKey: 'tg-1:peer', conversationTarget: 'peer', operation: 'text', finalText: 'Hallo',
    finalTextSha256: 'x', contentFrozen: true
  };
  await assert.rejects(() => facade.egress.execute(command), error => error.code === 'REMOTE_REJECTED');
});

test('reconcile failures degrade only that account and never block realtime traffic', async () => {
  const facade = new PlatformAdapterFacade('whatsapp', {
    reconcileHandler: async () => { throw Object.assign(new Error('history failed'), { code: 'HISTORY_PARTIAL' }); }
  });
  const result = await facade.reconcile.execute({ accountId: 'wa-1', mode: 'history' });
  assert.equal(result.status, 'degraded');
  assert.equal(result.realtimeBlocked, false);
  assert.equal(result.reasonCode, 'HISTORY_PARTIAL');
});

test('platform ports reject Express, DOM and raw SQLite boundary objects', () => {
  const facade = new PlatformAdapterFacade('facebook');
  assert.throws(() => facade.ingress.normalize({ req: {}, platform: 'facebook' }), error => error.code === 'PLATFORM_PORT_BOUNDARY_VIOLATION');
  assert.throws(() => facade.auth.status({ dom: {}, accountId: 'fb-1' }), error => error.code === 'PLATFORM_PORT_BOUNDARY_VIOLATION');
  assert.throws(() => facade.ingress.normalize({ platform: 'facebook', sourceAccountId: 'fb-1', rawEvent: { nested: { handler() {} } } }), error => error.code === 'PLATFORM_PORT_BOUNDARY_VIOLATION');
  const fakeDom = Object.create({ constructor: { name: 'HTMLDivElement' } });
  fakeDom.nodeType = 1; fakeDom.nodeName = 'DIV';
  assert.throws(() => facade.ingress.normalize({ platform: 'facebook', sourceAccountId: 'fb-1', rawEvent: fakeDom }), error => error.code === 'PLATFORM_PORT_BOUNDARY_VIOLATION');
});

test('platform ports reject binary, prototype-pollution keys and accessors before crossing the adapter boundary', () => {
  const facade = new PlatformAdapterFacade('facebook');
  assert.throws(() => facade.ingress.normalize({
    platform: 'facebook', sourceAccountId: 'fb-1', externalEventId: 'evt-bin', rawEvent: { bytes: Buffer.from('secret') }
  }), error => error.code === 'PLATFORM_PORT_BINARY_FORBIDDEN');
  const polluted = JSON.parse('{"platform":"facebook","sourceAccountId":"fb-1","rawEvent":{"__proto__":{"polluted":true}}}');
  assert.throws(() => facade.ingress.normalize(polluted), error => error.code === 'PLATFORM_PORT_DTO_KEY_FORBIDDEN');
  const accessor = { platform: 'facebook', sourceAccountId: 'fb-1', rawEvent: {} };
  Object.defineProperty(accessor.rawEvent, 'secret', { enumerable: true, get() { throw new Error('getter should never execute'); } });
  assert.throws(() => facade.ingress.normalize(accessor), error => error.code === 'PLATFORM_PORT_DTO_ACCESSOR_FORBIDDEN');
  assert.equal({}.polluted, undefined);
});

test('durable message egress refuses a claimed success without a platform message id', async () => {
  const facade = new PlatformAdapterFacade('telegram', {
    egressAuthorizer: async () => ({ authorized: true, queueId: 'send-no-id' }),
    egressHandler: async () => ({ success: true })
  });
  const command = {
    commandType: 'OutboxCommand', commandId: 'send-no-id', outboxId: 'send-no-id', idempotencyKey: 'idem-no-id', platform: 'telegram',
    accountId: 'tg-1', sessionKey: 'tg-1:peer', conversationTarget: 'peer', operation: 'text', finalText: 'Hallo',
    finalTextSha256: 'x', contentFrozen: true
  };
  await assert.rejects(() => facade.egress.execute(command), error => error.code === 'PLATFORM_SEND_RESULT_ID_REQUIRED');
});
