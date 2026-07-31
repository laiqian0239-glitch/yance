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

test('application start rehydrates persisted outcome-unknown blockers before queue processing', () => {
  const service = new sendQueueModule.SendQueueService();
  const row = {
    id: 'send-startup-unknown',
    account_id: 'account-a',
    session_key: 'session-a',
    state: 'send_outcome_unknown',
    updated_at: new Date().toISOString(),
    payload: { platform: 'facebook', chatJid: 'chat-a' }
  };
  const restoreQueue = patch(queueRepository, {
    recoverInterrupted: () => 0,
    list: options => options?.state === 'send_outcome_unknown' ? [row] : [row],
    summary: () => ({ total: 1, active: 1, outcomeUnknown: 1, globalOutcomeUnknown: 0, allAccountOutcomeUnknown: 1, commandOutcomeUnknown: 0, accountOutcomeUnknown: 1 }),
    claimNext: () => null
  });
  service.recoverAcceptedJournals = () => 0;
  try {
    service.start();
    assert.equal(service.pausedReason, '', 'startup must isolate the affected account lane rather than globally pause');
    assert.equal(service.status().resumeBlocked, false);
    assert.equal(service.status().outcomeUnknown, 1);
    assert.equal(service.blockedPlatformAcceptances.has(row.id), true);
    assert.equal(service.blockedPlatformAcceptances.get(row.id).scope, 'account');
  } finally {
    service.stop();
    restoreQueue();
  }
});

test('outcome-unknown scan failure during a running tick fails closed before any network claim', async () => {
  const service = new sendQueueModule.SendQueueService();
  let claimCalls = 0;
  let processCalls = 0;
  service.recoverAcceptedJournals = () => 0;
  service.recoverPlatformAcceptedLocalPending = async () => {};
  service.processRow = async () => { processCalls += 1; };
  const restoreQueue = patch(queueRepository, {
    list: options => {
      if (options?.state === 'send_outcome_unknown') {
        throw Object.assign(new Error('SQLite outcome scan unavailable'), { code: 'SQLITE_BUSY' });
      }
      return [];
    },
    claimNext: () => {
      claimCalls += 1;
      return { id: 'must-not-dispatch', account_id: 'account-a', payload: { platform: 'whatsapp' } };
    }
  });
  try {
    await service.tick();
    assert.equal(service.pausedReason, 'PLATFORM_ACCEPTED_CHECKPOINT_UNCERTAIN');
    assert.equal(service.blockedPlatformAcceptances.has('__scan_failed__'), true);
    assert.equal(claimCalls, 0);
    assert.equal(processCalls, 0);
  } finally {
    restoreQueue();
  }
});

test('a newly raised outcome-unknown pause stops already-claimed later rows before network dispatch', async () => {
  const service = new sendQueueModule.SendQueueService();
  const claimed = [
    { id: 'send-first-uncertain', account_id: 'account-a', payload: { platform: 'whatsapp', chatJid: 'chat-a' } },
    { id: 'send-second-must-not-dispatch', account_id: 'account-a', payload: { platform: 'whatsapp', chatJid: 'chat-a' } }
  ];
  const processed = [];
  const deferred = [];
  service.recoverAcceptedJournals = () => 0;
  service.recoverPlatformAcceptedLocalPending = async () => {};
  service.processRow = async row => {
    processed.push(row.id);
    if (row.id === 'send-first-uncertain') service.pause('PLATFORM_ACCEPTED_CHECKPOINT_UNCERTAIN');
  };
  const restoreQueue = patch(queueRepository, {
    list: () => [],
    claimNext: () => claimed.shift() || null,
    defer: rowId => {
      deferred.push(rowId);
      return {
        id: rowId,
        account_id: 'account-a',
        state: 'retry',
        payload: { platform: 'whatsapp', chatJid: 'chat-a' }
      };
    }
  });
  try {
    await service.tick();
    assert.equal(service.pausedReason, 'PLATFORM_ACCEPTED_CHECKPOINT_UNCERTAIN');
    assert.deepEqual(processed, ['send-first-uncertain']);
    assert.deepEqual(deferred, ['send-second-must-not-dispatch']);
  } finally {
    restoreQueue();
  }
});

test('paused queues continue local journal recovery while network dispatch remains gated', async () => {
  const service = new sendQueueModule.SendQueueService();
  const row = {
    id: 'send-local-recovery-while-paused',
    account_id: 'account-a',
    session_key: 'session-a',
    state: 'send_outcome_unknown',
    updated_at: new Date().toISOString(),
    payload: { platform: 'facebook', chatJid: 'chat-a' }
  };
  let state = 'send_outcome_unknown';
  let recoveryCalls = 0;
  let claimCalls = 0;
  service.pausedReason = 'PLATFORM_ACCEPTED_CHECKPOINT_UNCERTAIN';
  service.blockedPlatformAcceptances.set(row.id, { id: row.id, persisted: true });
  service.recoverAcceptedJournals = () => {
    recoveryCalls += 1;
    state = 'platform_accepted_local_pending';
    return 1;
  };
  service.recoverPlatformAcceptedLocalPending = async () => {};
  const restoreQueue = patch(queueRepository, {
    list: options => options?.state === 'send_outcome_unknown' && state === 'send_outcome_unknown' ? [row] : [],
    claimNext: () => { claimCalls += 1; return null; }
  });
  try {
    await service.tick();
    assert.equal(recoveryCalls, 1);
    assert.equal(service.pausedReason, '');
    assert.equal(service.blockedPlatformAcceptances.size, 0);
    assert.equal(claimCalls, 1);
  } finally {
    restoreQueue();
  }
});

test('manual confirmation that the platform did not send moves outcome-unknown back to retry and clears the blocker', async () => {
  const service = new sendQueueModule.SendQueueService();
  const row = {
    id: 'send-confirmed-not-sent',
    idempotency_key: 'idem-confirmed-not-sent',
    account_id: 'account-a',
    session_key: 'session-a',
    message_type: 'text',
    state: 'send_outcome_unknown',
    payload: { platform: 'whatsapp', operation: 'text', chatJid: 'chat-a', text: 'hello' }
  };
  let resolved = false;
  const restoreQueue = patch(queueRepository, {
    get: () => ({ ...row, state: resolved ? 'retry' : 'send_outcome_unknown' }),
    list: options => options?.state === 'send_outcome_unknown' && !resolved ? [row] : [],
    resolveOutcomeUnknown: (_id, resolution) => {
      assert.equal(resolution, 'confirmed_not_sent');
      resolved = true;
      return { ...row, state: 'retry', last_error: 'SEND_OUTCOME_RECONCILED' };
    }
  });
  const restoreMessages = patch(messageStore, { updateReceipt: async () => ({ ok: true }) });
  try {
    service.blockedPlatformAcceptances.set(row.id, { id: row.id, persisted: true });
    service.pausedReason = 'PLATFORM_ACCEPTED_CHECKPOINT_UNCERTAIN';
    const output = await service.resolveOutcomeUnknown(row.id, 'confirmed_not_sent');
    assert.equal(output.queue.state, 'retry');
    assert.equal(service.pausedReason, '');
    assert.equal(service.blockedPlatformAcceptances.size, 0);
  } finally {
    restoreMessages();
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

test('runtime-only outcome blockers retry SQLite persistence during local recovery', () => {
  const service = new sendQueueModule.SendQueueService();
  const row = {
    id: 'send-runtime-only-blocker',
    account_id: 'account-a',
    session_key: 'session-a',
    state: 'send_outcome_unknown',
    platform_message_id: 'remote-runtime-only',
    updated_at: new Date().toISOString(),
    payload: { platform: 'facebook', chatJid: 'chat-a' }
  };
  let persisted = false;
  const restoreQueue = patch(queueRepository, {
    markOutcomeUnknown: () => {
      persisted = true;
      return row;
    },
    list: options => options?.state === 'send_outcome_unknown' && persisted ? [row] : []
  });
  try {
    service.blockedPlatformAcceptances.set(row.id, { id: row.id, platformMessageId: row.platform_message_id, error: 'SQLITE_BUSY' });
    assert.equal(service.hydrateOutcomeUnknownBlockers(), 0, 'account-scoped blocker must not be counted as global');
    assert.equal(persisted, true);
    assert.equal(service.blockedPlatformAcceptances.get(row.id).persisted, true);
    assert.equal(service.blockedPlatformAcceptances.get(row.id).scope, 'account');
  } finally {
    restoreQueue();
  }
});

test('manual confirmation that the platform sent creates local repair plans without another network dispatch', async () => {
  const service = new sendQueueModule.SendQueueService();
  const row = {
    id: 'send-confirmed-sent',
    idempotency_key: 'idem-confirmed-sent',
    account_id: 'account-a',
    session_key: 'session-a',
    message_type: 'text',
    state: 'send_outcome_unknown',
    platform_message_id: 'remote-confirmed-sent',
    payload: { platform: 'facebook', operation: 'text', chatJid: 'chat-a', text: 'hello' }
  };
  let state = 'send_outcome_unknown';
  let dispatchCalls = 0;
  const enqueuedPlans = [];
  service.dispatch = async () => { dispatchCalls += 1; };
  const restoreQueue = patch(queueRepository, {
    get: () => ({ ...row, state }),
    list: options => options?.state === 'send_outcome_unknown' && state === 'send_outcome_unknown' ? [row] : [],
    markPlatformAcceptedLocalPending: (_id, input) => {
      state = 'platform_accepted_local_pending';
      return { ...row, state, payload: { ...row.payload, _localPersistencePlans: input.localPersistencePlans } };
    },
    markResult: () => {
      state = 'sent';
      return { ...row, state };
    },
    checkpointDelivery: () => {
      state = 'sent';
      return { queue: { ...row, state }, message: { id: row.id, deliveryStatus: 'sent' } };
    }
  });
  const restoreRepair = patch(localPersistenceRepairService, {
    enqueue: plan => { enqueuedPlans.push(plan); return { id: plan.id, state: 'pending' }; }
  });
  try {
    service.blockedPlatformAcceptances.set(row.id, { id: row.id, persisted: true });
    service.pausedReason = 'PLATFORM_ACCEPTED_CHECKPOINT_UNCERTAIN';
    const output = await service.resolveOutcomeUnknown(row.id, 'confirmed_sent');
    assert.equal(output.queue.state, 'sent');
    assert.equal(dispatchCalls, 0);
    assert.equal(enqueuedPlans.length, 1);
    assert.equal(enqueuedPlans.some(plan => plan.payload.kind === 'message-upsert'), true);
    assert.equal(enqueuedPlans.some(plan => plan.payload.kind === 'message-receipt'), false);
    assert.equal(service.pausedReason, '');
  } finally {
    restoreRepair();
    restoreQueue();
  }
});

test('outcome-unknown reconciliation is exposed through the core contract and restored in the conversation UI after restart', () => {
  const root = path.resolve(__dirname, '..', '..');
  const contracts = fs.readFileSync(path.join(root, 'shared', 'core', 'contracts.js'), 'utf8');
  const accountContext = fs.readFileSync(path.join(root, 'backend', 'core', 'accountContext.js'), 'utf8');
  const routes = fs.readFileSync(path.join(root, 'backend', 'routes', 'messages.js'), 'utf8');
  const coreClient = fs.readFileSync(path.join(root, 'frontend', 'js', 'core-client.js'), 'utf8');
  const capabilities = fs.readFileSync(path.join(root, 'frontend', 'js', 'r32-conversation-capabilities.js'), 'utf8');
  assert.match(contracts, /message\.queue\.resolveOutcome/);
  assert.match(accountContext, /case 'message\.queue\.resolveOutcome'/);
  assert.match(routes, /resolve-outcome/);
  assert.match(coreClient, /listQueue: payload => command\('message\.queue\.list'/);
  assert.match(coreClient, /resolveOutcome: \(id, resolution\) => command\('message\.queue\.resolveOutcome'/);
  assert.match(capabilities, /loadPersistedSendQueueState/);
  assert.match(capabilities, /data-queue-confirm-sent/);
  assert.match(capabilities, /data-queue-confirm-not-sent/);
});

test('platform acceptance with both journal and SQLite checkpoint failures pauses the queue and blocks automatic resend', async () => {
  const service = new sendQueueModule.SendQueueService();
  service.writeAcceptedJournal = () => { throw Object.assign(new Error('journal disk full'), { code: 'ENOSPC' }); };
  service.dispatch = async () => ({ messageId: 'remote-uncertain-1' });
  const row = {
    id: 'send-uncertain-1',
    idempotency_key: 'uncertain-key-1',
    account_id: 'account-a',
    session_key: 'session-a',
    message_type: 'text',
    state: 'sending',
    attempts: 1,
    payload: { platform: 'whatsapp', operation: 'text', chatJid: 'chat-a', text: 'hello' }
  };
  let outcomeUnknownCalls = 0;
  const restoreQueue = patch(queueRepository, {
    get: () => ({ ...row }),
    markPlatformAcceptedLocalPending: () => { throw Object.assign(new Error('sqlite checkpoint busy'), { code: 'SQLITE_BUSY' }); },
    markOutcomeUnknown: (_id, input) => {
      outcomeUnknownCalls += 1;
      return { ...row, state: 'send_outcome_unknown', platform_message_id: input.platformMessageId, last_error: input.error };
    }
  });
  try {
    const output = await service.processRow(row);
    assert.equal(output.queue.state, 'send_outcome_unknown');
    assert.equal(output.result.automaticRetryBlocked, true);
    assert.equal(outcomeUnknownCalls, 1);
    assert.equal(service.pausedReason, '', 'uncertain acceptance isolates the account lane, not the global queue');
    assert.equal(service.blockedPlatformAcceptances.has(row.id), true);
    assert.equal(service.blockedPlatformAcceptances.get(row.id).scope, 'account');
  } finally {
    restoreQueue();
  }
});

test('corrupt platform-acceptance journals are quarantined instead of being parsed on every queue tick', () => {
  const journalRoot = sendQueueModule.PLATFORM_ACCEPTED_JOURNAL_ROOT;
  const corruptRoot = sendQueueModule.PLATFORM_ACCEPTED_CORRUPT_ROOT;
  fs.mkdirSync(journalRoot, { recursive: true });
  fs.mkdirSync(corruptRoot, { recursive: true });
  const filename = `corrupt-regression-${process.pid}-${Date.now()}.json`;
  const sourceFile = path.join(journalRoot, filename);
  fs.writeFileSync(sourceFile, '{not-valid-json', 'utf8');
  const before = new Set(fs.readdirSync(corruptRoot));
  try {
    const service = new sendQueueModule.SendQueueService();
    assert.equal(service.recoverAcceptedJournals(), 0);
    assert.equal(fs.existsSync(sourceFile), false);
    const created = fs.readdirSync(corruptRoot).filter(name => !before.has(name) && name.startsWith(filename));
    assert.equal(created.length, 1);
    fs.rmSync(path.join(corruptRoot, created[0]), { force: true });
  } finally {
    fs.rmSync(sourceFile, { force: true });
  }
});

test('valid platform-acceptance journals remain retryable when SQLite recovery is temporarily unavailable', () => {
  const journalRoot = sendQueueModule.PLATFORM_ACCEPTED_JOURNAL_ROOT;
  fs.mkdirSync(journalRoot, { recursive: true });
  const filename = `retryable-regression-${process.pid}-${Date.now()}.json`;
  const sourceFile = path.join(journalRoot, filename);
  fs.writeFileSync(sourceFile, JSON.stringify({
    queueId: 'send-retryable-journal',
    platformMessageId: 'remote-retryable-journal',
    localPersistencePlans: [{ id: 'repair-retryable', payload: { kind: 'message-receipt' } }],
    acceptedAt: new Date().toISOString()
  }), 'utf8');
  const restoreQueue = patch(queueRepository, {
    get: () => { throw Object.assign(new Error('sqlite busy'), { code: 'SQLITE_BUSY' }); }
  });
  try {
    const service = new sendQueueModule.SendQueueService();
    assert.equal(service.recoverAcceptedJournals(), 0);
    assert.equal(fs.existsSync(sourceFile), true);
  } finally {
    restoreQueue();
    fs.rmSync(sourceFile, { force: true });
  }
});

test('repair enqueue failure keeps the send in platform accepted local pending instead of marking sent or retrying network', async () => {
  const service = new sendQueueModule.SendQueueService();
  service.writeAcceptedJournal = () => 'journal';
  service.removeAcceptedJournal = () => {};
  service.dispatch = async () => ({
    messageId: 'remote-message-1',
    localPersistencePending: true,
    localPersistenceErrorCode: 'SQLITE_BUSY',
    localPersistenceRepair: {
      kind: 'message-upsert',
      message: { id: 'send-1', accountId: 'account-a', conversationId: 'session-a', text: 'hello' }
    }
  });

  let state = 'sending';
  let markSentCalls = 0;
  const row = {
    id: 'send-1',
    idempotency_key: 'idem-1',
    account_id: 'account-a',
    session_key: 'session-a',
    message_type: 'text',
    state,
    attempts: 1,
    payload: { platform: 'whatsapp', operation: 'text', chatJid: 'chat-a', text: 'hello' }
  };

  const restoreQueue = patch(queueRepository, {
    get: () => ({ ...row, state, platform_message_id: 'remote-message-1', payload: row.payload }),
    markPlatformAcceptedLocalPending: (_id, input) => {
      state = 'platform_accepted_local_pending';
      row.payload = { ...row.payload, _localPersistencePlans: input.localPersistencePlans };
      return { ...row, state, platform_message_id: input.platformMessageId, last_error: input.error };
    },
    markResult: () => {
      markSentCalls += 1;
      state = 'sent';
      return { ...row, state };
    }
  });
  const restoreRepair = patch(localPersistenceRepairService, {
    enqueue: () => { throw Object.assign(new Error('repair database busy'), { code: 'SQLITE_BUSY' }); }
  });
  const restoreMessages = patch(messageStore, { updateReceipt: async () => {} });

  try {
    const output = await service.processRow(row);
    assert.equal(output.queue.state, 'platform_accepted_local_pending');
    assert.equal(output.result.localPersistencePending, true);
    assert.equal(markSentCalls, 0);
    assert.equal(state, 'platform_accepted_local_pending');
  } finally {
    restoreMessages();
    restoreRepair();
    restoreQueue();
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

test('pending platform acceptance recovery enqueues local plans without calling the network dispatcher', async () => {
  const service = new sendQueueModule.SendQueueService();
  let dispatchCalls = 0;
  let markSentCalls = 0;
  service.dispatch = async () => { dispatchCalls += 1; };
  service.cleanupQueueMedia = () => {};
  const plan = {
    id: 'local-repair-message-send-2',
    queueId: 'send-2',
    platform: 'facebook',
    accountId: 'account-b',
    conversationId: 'session-b',
    payload: { kind: 'message-upsert', message: { id: 'send-2' } }
  };
  const row = {
    id: 'send-2',
    account_id: 'account-b',
    session_key: 'session-b',
    state: 'platform_accepted_local_pending',
    platform_message_id: 'remote-2',
    payload: { platform: 'facebook', chatJid: 'chat-b', _localPersistencePlans: [plan] }
  };
  const restoreQueue = patch(queueRepository, {
    list: () => [row],
    markResult: () => {
      markSentCalls += 1;
      return { ...row, state: 'sent' };
    },
    checkpointDelivery: () => {
      markSentCalls += 1;
      return { queue: { ...row, state: 'sent' }, message: { id: row.id, deliveryStatus: 'sent' } };
    },
    markPlatformAcceptedLocalPending: () => row
  });
  const restoreRepair = patch(localPersistenceRepairService, { enqueue: input => ({ id: input.id, state: 'pending' }) });
  try {
    await service.recoverPlatformAcceptedLocalPending();
    assert.equal(dispatchCalls, 0);
    assert.equal(markSentCalls, 1);
  } finally {
    restoreRepair();
    restoreQueue();
  }
});
