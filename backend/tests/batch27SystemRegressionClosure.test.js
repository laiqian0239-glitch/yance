'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-batch27-system-reg-'));
process.env.YANCE_DATA_DIR = dataRoot;
process.env.NODE_ENV = 'test';
process.env.YANCE_TEST_ONLY_SQLITE_BROKER_RESET = '1';

const { acquireAuthorityWriteHost } = require('../services/authorityWriteHost');
const {
  createSqliteConnectionBroker,
  resetSqliteConnectionBrokerForTests
} = require('../lib/sqliteConnectionBroker');

const dbPath = path.join(dataRoot, 'store', 'yance-r32.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const authorityWriteHost = acquireAuthorityWriteHost({
  dbPath,
  instanceId: `batch27-system-regression-${process.pid}`
});
createSqliteConnectionBroker({
  dbPath,
  authorityWriteHostCapability: authorityWriteHost.capability
});

const eventBus = require('../services/eventBus');
const platformDrivers = require('../services/platformDriverRegistry');
const whatsapp = require('../services/whatsappAdapter');
const telegram = require('../services/telegramAdapter');
const facebook = require('../services/facebookChatwootMatrixBridge');
const outboundCommandRepository = require('../repositories/outboundCommandRepository');
const { OutboxRouteAuthority } = require('../services/outboxRouteAuthority');
const { ExternalIdentityAuthority } = require('../services/externalIdentityAuthority');
const bilingual = require('../services/bilingualUnderstandingService');
const { getStore, closeStore } = require('../repositories/storeProvider');

function patch(t, object, key, value) {
  const original = object[key];
  object[key] = value;
  t.after(() => { object[key] = original; });
}
function routeAuthority(store) {
  return new OutboxRouteAuthority({ storeProvider: () => store, externalIdentityAuthority: new ExternalIdentityAuthority({ storeProvider: () => store }) });
}
function seedScope(store, suffix, platform) {
  const accountId = `${platform}-account-${suffix}`;
  const sessionKey = `${accountId}:peer-${suffix}`;
  const target = `peer-${suffix}`;
  store.upsertAccount({ id: accountId, accountId, adapterAccountId: accountId, platform, state: 'online', canSend: true, canReceive: true });
  store.upsertConversation({ sessionKey, accountId, platform, title: target, routeState: 'bound', chatJid: target, externalId: target });
  return { accountId, sessionKey, target, platform };
}
function command(store, scope, id) {
  return {
    store,
    outboxRouteAuthority: routeAuthority(store),
    route: { conversationId: scope.sessionKey, accountId: scope.accountId, platform: scope.platform, routeTarget: scope.target, capabilitySnapshotId: 'cap-b27-system' },
    queue: { id, idempotencyKey: id, accountId: scope.accountId, sessionKey: scope.sessionKey, messageType: 'text', capabilitySnapshotId: 'cap-b27-system', payload: { platform: scope.platform, operation: 'text', text: id, chatJid: scope.target } },
    message: { id, dedupeKey: id, externalMessageId: id, accountId: scope.accountId, conversationId: scope.sessionKey, sessionKey: scope.sessionKey, chatJid: scope.target, platform: scope.platform, direction: 'outbound', fromMe: true, type: 'text', text: id }
  };
}
function persistedAttempt(platform, accountId, idempotencyKey, suffix) {
  return Object.freeze({
    executionId: `${platform}-execution-${suffix}`,
    intentId: `${platform}-intent-${suffix}`,
    attemptId: `${platform}-attempt-${suffix}`,
    claimId: `${platform}-claim-${suffix}`,
    ownerId: `${platform}-owner-${suffix}`,
    idempotencyKey,
    requestContentSha256: 'c'.repeat(64),
    generation: 2,
    hostGeneration: 3,
    fencingToken: 5,
    platform,
    accountReference: accountId,
    state: 'RUNNING'
  });
}

test.after(() => {
  try { closeStore(); } catch (_) {}
  try { resetSqliteConnectionBrokerForTests(); } catch (_) {}
  try { authorityWriteHost.close(); } catch (_) {}
  fs.rmSync(dataRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  delete process.env.YANCE_TEST_ONLY_SQLITE_BROKER_RESET;
});

test('SYS-REG-01 platform operation matrix propagates signal, generation and queue projection ownership', async t => {
  const signal = new AbortController().signal;
  const generation = 'generation-system-1';
  const calls = [];
  const record = (platform, operation) => async (...args) => {
    calls.push({ platform, operation, args });
    return { messageId: `${platform}-${operation}` };
  };
  for (const [module, platform, operations] of [
    [whatsapp, 'whatsapp', ['sendText','sendMedia','sendReaction','revokeMessage','sendPresence','markRead']],
    [telegram, 'telegram', ['sendText','sendMedia','sendReaction','revokeMessage','sendNativeExpression','sendPresence','markRead']],
    [facebook, 'facebook', ['sendText','sendMedia','sendPresence','markRead']]
  ]) for (const operation of operations) patch(t, module, operation, record(platform, operation));

  const common = { signal, executionGeneration: generation, localProjectionOwnedByQueue: true, localMessageId: 'cmd-system', sessionKey: 'session-system' };
  const contexts = {
    whatsapp: { account: { id: 'wa' }, accountId: 'wa', adapterAccountId: 'wa', target: 'wa-peer' },
    telegram: { account: { id: 'tg' }, accountId: 'tg', adapterAccountId: 'tg', target: 'tg-peer' },
    facebook: { account: { id: 'fb' }, accountId: 'fb', adapterAccountId: 'fb', target: 'fb-peer' }
  };
  const inputs = {
    sendText: { ...common, text: 'hello' },
    sendMedia: { ...common, filePath: '/tmp/a.jpg', kind: 'image' },
    sendReaction: { ...common, targetId: 'm1', emoji: '👍' },
    revokeMessage: { ...common, targetId: 'm1' },
    sendNativeExpression: { ...common, reference: 'sticker-1', kind: 'sticker' },
    sendPresence: { ...common, state: 'typing' },
    markRead: { ...common, messageIds: ['m1'] }
  };
  for (const platform of ['whatsapp','telegram','facebook']) {
    const driver = platformDrivers.get(platform);
    for (const operation of Object.keys(inputs)) {
      if (typeof driver[operation] !== 'function') continue;
      await driver[operation](contexts[platform], {
        ...inputs[operation],
        physicalAttemptContext: persistedAttempt(platform, contexts[platform].accountId, inputs[operation].localMessageId, operation)
      });
    }
  }
  assert.equal(calls.length, 17);
  for (const call of calls) {
    const flattened = call.args.flatMap(value => value && typeof value === 'object' ? [value] : []);
    const option = flattened.find(value => value.signal === signal || value.executionGeneration === generation);
    assert.ok(option, `${call.platform}.${call.operation} did not receive execution context`);
    assert.equal(option.signal, signal, `${call.platform}.${call.operation} signal`);
    assert.equal(option.executionGeneration, generation, `${call.platform}.${call.operation} generation`);
    if (['sendText','sendMedia','sendNativeExpression'].includes(call.operation) && call.platform === 'facebook') {
      assert.equal(option.localProjectionOwnedByQueue, true, `${call.platform}.${call.operation} queue ownership`);
    }
  }
});

test('SYS-REG-02 unknown send can enter platform-accepted local-pending checkpoint only once', async () => {
  const store = getStore();
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const scope = seedScope(store, suffix, 'telegram');
  const queueId = `unknown-${suffix}`;
  outboundCommandRepository.createAtomic(command(store, scope, queueId));
  const claimed = store.claimNextSend();
  const unknown = store.markSendOutcomeUnknown(queueId, {
    unknownScope: 'command', unknownReason: 'DEADLINE', unknownLane: `telegram:${scope.accountId}`,
    executionGeneration: claimed.execution_generation, error: 'DEADLINE'
  }, { generation: claimed.claim_generation, token: claimed.claim_token });
  assert.equal(unknown.state, 'send_outcome_unknown');
  const accepted = store.markPlatformAcceptedLocalPending(queueId, {
    platformMessageId: 'remote-accepted',
    localPersistencePlans: [{ id: 'repair-local-projection', payload: { kind: 'message-upsert', queueId } }],
    error: 'LOCAL_PROJECTION_PENDING'
  });
  assert.equal(accepted.state, 'platform_accepted_local_pending');
  assert.equal(accepted.platform_message_id, 'remote-accepted');
  assert.equal(accepted.payload._localPersistencePlans.length, 1);
  assert.throws(() => store.markPlatformAcceptedLocalPending(queueId, {
    platformMessageId: 'remote-duplicate',
    error: 'DUPLICATE_LATE_RESULT'
  }), error => error.code === 'SEND_QUEUE_LOCAL_CHECKPOINT_STALE');
  assert.equal(store.getSendQueueItem(queueId).platform_message_id, 'remote-accepted');
});

test('DEV-P1-01 translation cancellation is propagated instead of converted into a failed translation result', async () => {
  const controller = new AbortController();
  const aiGateway = {
    execute({ signal }) {
      return new Promise((resolve, reject) => {
        const abort = () => reject(signal.reason || Object.assign(new Error('cancelled'), { code: 'AI_TASK_CANCELLED' }));
        if (signal.aborted) abort();
        else signal.addEventListener('abort', abort, { once: true });
      });
    }
  };
  const pending = bilingual.translateToChinese({ text: 'Hello, how are you?', sourceLanguage: 'en', signal: controller.signal }, { aiGateway });
  controller.abort(Object.assign(new Error('new inbound'), { code: 'AI_TASK_CANCELLED' }));
  await assert.rejects(pending, error => error.code === 'AI_TASK_CANCELLED');
});
