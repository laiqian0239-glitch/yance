'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { R32SqliteStore } = require('../lib/r32SqliteStore');
const { WhatsAppAdapter } = require('../services/whatsappAdapter');
const sendQueueModule = require('../services/sendQueueService');
const queueRepository = require('../repositories/sendQueueRepository');
const localPersistenceRepairService = require('../services/localPersistenceRepairService');
const messageStore = require('../services/messageStore');
const { ExternalIdentityAuthority } = require('../services/externalIdentityAuthority');
const { OutboxRouteAuthority } = require('../services/outboxRouteAuthority');
const outboundCommandRepository = require('../repositories/outboundCommandRepository');

function versionedRouteAuthority(store) {
  return new OutboxRouteAuthority({
    storeProvider: () => store,
    externalIdentityAuthority: new ExternalIdentityAuthority({ storeProvider: () => store })
  });
}

function enqueueVersioned(store, input = {}) {
  const platform = String(input.payload?.platform || 'whatsapp');
  const target = String(input.payload?.chatJid || 'chat-a');
  return outboundCommandRepository.createAtomic({
    store,
    outboxRouteAuthority: versionedRouteAuthority(store),
    route: { conversationId: input.sessionKey, accountId: input.accountId, platform, routeTarget: target, capabilitySnapshotId: input.capabilitySnapshotId || '' },
    queue: input
  }).queue;
}

function seedQueueScope(store, options = {}) {
  const accountId = options.accountId || 'account-a';
  const sessionKey = options.sessionKey || 'account-a:chat-a';
  const platform = options.platform || 'whatsapp';
  store.upsertAccount({ id: accountId, accountId, adapterAccountId: accountId, platform, state: 'online', canSend: true, canReceive: true });
  store.upsertConversation({ sessionKey, accountId, platform, title: sessionKey, routeState: 'bound', chatJid: options.chatJid || 'chat-a', externalId: options.chatJid || 'chat-a' });
}

function patch(object, replacements) {
  const originals = {};
  for (const [key, value] of Object.entries(replacements)) {
    originals[key] = object[key];
    object[key] = value;
  }
  return () => {
    for (const [key, value] of Object.entries(originals)) object[key] = value;
  };
}

test('WhatsApp stale startup behavior invalidates the old generation before allocating the replacement', async () => {
  const adapter = new WhatsAppAdapter();
  const accountId = 'wa-stale-account';
  const order = [];
  adapter.generations.set(accountId, 4);
  adapter.stop = async stoppedAccountId => {
    order.push({ operation: 'stop', generation: adapter.generations.get(stoppedAccountId) });
    adapter.generations.set(stoppedAccountId, Number(adapter.generations.get(stoppedAccountId) || 0) + 1);
    adapter.stopping.add(stoppedAccountId);
    adapter.stoppedAccounts.add(stoppedAccountId);
  };
  const existing = { socket: {}, state: 'connecting', startedAtMs: Date.now() - 60000, generation: 4 };
  const result = await adapter.prepareStartGeneration(accountId, existing, { databaseAccountId: 'wa-db-account' });

  assert.deepEqual(order, [{ operation: 'stop', generation: 4 }]);
  assert.equal(result.reused, false);
  assert.equal(result.generation, 6);
  assert.equal(adapter.generations.get(accountId), 6);
  assert.equal(adapter.stopping.has(accountId), false);
  assert.equal(adapter.stoppedAccounts.has(accountId), false);
});

test('platform accepted local pending is durable and is never claimed for a second network send', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-platform-accepted-'));
  const store = new R32SqliteStore({ dbPath: path.join(root, 'store.db') });
  try {
    seedQueueScope(store);
    enqueueVersioned(store, {
      id: 'send-accepted',
      idempotencyKey: 'accepted-key',
      accountId: 'account-a',
      sessionKey: 'account-a:chat-a',
      messageType: 'text',
      payload: { platform: 'whatsapp', operation: 'text', chatJid: 'chat-a', text: 'hello' }
    });
    const claim = store.claimNextSend();
    assert.equal(claim.state, 'sending');
    const pending = store.markPlatformAcceptedLocalPending('send-accepted', {
      platformMessageId: 'remote-1',
      localPersistencePlans: [{ id: 'repair-1', payload: { kind: 'message-receipt' } }],
      error: 'LOCAL_REPAIR_DB_BUSY'
    }, { generation: claim.claim_generation, token: claim.claim_token });
    assert.equal(pending.state, 'platform_accepted_local_pending');
    assert.equal(pending.platform_message_id, 'remote-1');
    assert.equal(pending.payload._localPersistencePlans.length, 1);
    assert.equal(store.recoverStaleSends(1), 0);
    assert.equal(store.claimNextSend(), null);
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test('stale in-flight sends become outcome-unknown and are never automatically claimed again', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-stale-outcome-'));
  const store = new R32SqliteStore({ dbPath: path.join(root, 'store.db') });
  try {
    seedQueueScope(store);
    enqueueVersioned(store, {
      id: 'send-unknown',
      idempotencyKey: 'unknown-key',
      accountId: 'account-a',
      sessionKey: 'account-a:chat-a',
      messageType: 'text',
      payload: { platform: 'whatsapp', operation: 'text', chatJid: 'chat-a', text: 'hello' }
    });
    assert.equal(store.claimNextSend().state, 'sending');
    store.db.prepare("UPDATE r32_send_queue SET locked_at='2000-01-01T00:00:00.000Z' WHERE id='send-unknown'").run();
    assert.equal(store.recoverStaleSends(1000), 1);
    assert.equal(store.getSendQueueItem('send-unknown').state, 'send_outcome_unknown');
    assert.equal(store.claimNextSend(), null);
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test('application restart treats every inherited sending row as outcome-unknown immediately', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-interrupted-outcome-'));
  const store = new R32SqliteStore({ dbPath: path.join(root, 'store.db') });
  try {
    seedQueueScope(store);
    enqueueVersioned(store, {
      id: 'send-interrupted',
      idempotencyKey: 'interrupted-key',
      accountId: 'account-a',
      sessionKey: 'account-a:chat-a',
      messageType: 'text',
      payload: { platform: 'whatsapp', operation: 'text', chatJid: 'chat-a', text: 'hello' }
    });
    assert.equal(store.claimNextSend().state, 'sending');
    assert.equal(store.recoverInterruptedSends(), 1);
    assert.equal(store.getSendQueueItem('send-interrupted').state, 'send_outcome_unknown');
    assert.equal(store.claimNextSend(), null);
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test('primary message database uses FULL synchronous durability for send-state commits', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-sqlite-full-sync-'));
  const store = new R32SqliteStore({ dbPath: path.join(root, 'store.db') });
  try {
    const row = store.db.prepare('PRAGMA synchronous').get();
    assert.equal(Number(row.synchronous), 2);
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test('persisted outcome-unknown rows block automatic network and system resume attempts', () => {
  const service = new sendQueueModule.SendQueueService();
  const row = {
    id: 'send-persisted-unknown',
    account_id: 'account-a',
    session_key: 'session-a',
    state: 'send_outcome_unknown',
    platform_message_id: 'remote-unknown',
    last_error: 'SEND_OUTCOME_UNKNOWN',
    updated_at: new Date().toISOString(),
    payload: { platform: 'whatsapp', chatJid: 'chat-a' }
  };
  const restoreQueue = patch(queueRepository, {
    list: options => options?.state === 'send_outcome_unknown' ? [row] : [row],
    summary: options => ({ total: 1, active: 1, outcomeUnknown: 1, globalOutcomeUnknown: 0, allAccountOutcomeUnknown: 1, commandOutcomeUnknown: 0, accountOutcomeUnknown: options?.accountId === 'account-a' ? 1 : 0 })
  });
  try {
    service.pause('network-offline');
    const online = service.resume('network-online');
    assert.equal(online.paused, false, 'account-scoped unknown must not freeze unrelated lanes');
    assert.equal(online.pausedReason, '');
    assert.equal(online.resumeBlocked, false);
    assert.equal(online.outcomeUnknown, 1);
    assert.throws(() => service.assertEnqueueAllowed('text', { accountId: 'account-a' }), error => error.code === 'SEND_OUTCOME_UNKNOWN_WRITE_BLOCKED');
    assert.equal(service.assertEnqueueAllowed('text', { accountId: 'account-b' }), true);
    const system = service.resume('system-resume');
    assert.equal(system.pausedReason, '');
  } finally {
    restoreQueue();
  }
});

test('manual not-sent reconciliation clears any uncertain remote message id in SQLite', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-outcome-reconcile-'));
  const store = new R32SqliteStore({ dbPath: path.join(root, 'store.db') });
  try {
    seedQueueScope(store);
    enqueueVersioned(store, {
      id: 'send-reconcile-clear-id',
      idempotencyKey: 'reconcile-clear-id-key',
      accountId: 'account-a',
      sessionKey: 'account-a:chat-a',
      messageType: 'text',
      payload: { platform: 'whatsapp', operation: 'text', chatJid: 'chat-a', text: 'hello' }
    });
    const claim = store.claimNextSend();
    assert.equal(claim.state, 'sending');
    store.markSendOutcomeUnknown('send-reconcile-clear-id', { platformMessageId: 'remote-uncertain-id' }, { generation: claim.claim_generation, token: claim.claim_token });
    const saved = store.resolveSendOutcomeUnknown('send-reconcile-clear-id', 'confirmed_not_sent');
    assert.equal(saved.state, 'retry');
    assert.equal(saved.platform_message_id, '');
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test('defer cannot overwrite a send-outcome-unknown row back to retry', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-defer-state-guard-'));
  const store = new R32SqliteStore({ dbPath: path.join(root, 'store.db') });
  try {
    seedQueueScope(store);
    enqueueVersioned(store, {
      id: 'send-defer-state-guard',
      idempotencyKey: 'defer-state-guard-key',
      accountId: 'account-a',
      sessionKey: 'account-a:chat-a',
      messageType: 'text',
      payload: { platform: 'whatsapp', operation: 'text', chatJid: 'chat-a', text: 'hello' }
    });
    const claim = store.claimNextSend();
    assert.equal(claim.state, 'sending');
    assert.equal(store.markSendOutcomeUnknown('send-defer-state-guard', { error: 'uncertain' }, { generation: claim.claim_generation, token: claim.claim_token }).state, 'send_outcome_unknown');
    assert.throws(() => store.deferSend('send-defer-state-guard', { error: 'paused' }), error => error.code === 'SEND_QUEUE_DEFER_STALE_COMPLETION');
    assert.equal(store.getSendQueueItem('send-defer-state-guard').state, 'send_outcome_unknown');
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test('outcome-unknown persistence cannot overwrite a queue item that is no longer sending', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-outcome-state-guard-'));
  const store = new R32SqliteStore({ dbPath: path.join(root, 'store.db') });
  try {
    seedQueueScope(store);
    enqueueVersioned(store, {
      id: 'send-state-guard',
      idempotencyKey: 'state-guard-key',
      accountId: 'account-a',
      sessionKey: 'account-a:chat-a',
      messageType: 'text',
      payload: { platform: 'whatsapp', operation: 'text', chatJid: 'chat-a', text: 'hello' }
    });
    const saved = store.markSendOutcomeUnknown('send-state-guard', { platformMessageId: 'remote-should-not-apply' });
    assert.equal(saved.state, 'pending');
    assert.equal(saved.platform_message_id, '');
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test('receipt repair never deletes a media source owned by outbound media repair', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-receipt-media-owner-'));
  const mediaFile = path.join(root, 'media.bin');
  fs.writeFileSync(mediaFile, Buffer.from('media'));
  const service = new localPersistenceRepairService.LocalPersistenceRepairService();
  const restoreMessages = patch(messageStore, { updateReceipt: async () => {} });
  try {
    await service.apply({
      payload: {
        kind: 'message-receipt',
        receipt: { accountId: 'account-a', chatJid: 'chat-a', messageId: 'send-1', status: 'sent' },
        cleanupFile: true,
        filePath: mediaFile
      }
    });
    assert.equal(fs.existsSync(mediaFile), true);
  } finally {
    restoreMessages();
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});
