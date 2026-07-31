'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-batch27-system-reg-'));
process.env.YANCE_DATA_DIR = dataRoot;
process.env.NODE_ENV = 'test';

const eventBus = require('../services/eventBus');
const platformDrivers = require('../services/platformDriverRegistry');
const whatsapp = require('../services/whatsappAdapter');
const telegram = require('../services/telegramAdapter');
const facebook = require('../services/facebookAdapter');
const { JobQueue } = require('../services/jobQueue');
const { BackgroundJobAuthority } = require('../services/backgroundJobAuthority');
const { executeWithDeadline } = require('../services/executionDeadline');
const { SendQueueService } = require('../services/sendQueueService');
const outboundCommandRepository = require('../repositories/outboundCommandRepository');
const { OutboxRouteAuthority } = require('../services/outboxRouteAuthority');
const { ExternalIdentityAuthority } = require('../services/externalIdentityAuthority');
const bilingual = require('../services/bilingualUnderstandingService');
const { getStore, closeStore } = require('../repositories/storeProvider');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
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

test.after(() => {
  try { closeStore(); } catch (_) {}
  fs.rmSync(dataRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
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
      await driver[operation](contexts[platform], inputs[operation]);
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

test('SYS-REG-02 late accepted result converges unknown exactly once and stale generation is rejected', async () => {
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
  const service = new SendQueueService();
  const stale = await service.handleLateEgressResult({ platformAccepted: true, commandId: queueId, platformMessageId: 'remote-stale', executionGeneration: 'stale-generation' });
  assert.equal(stale.reason, 'generation-stale');
  assert.equal(store.getSendQueueItem(queueId).state, 'send_outcome_unknown');
  const lateIdentity = {
    platform: scope.platform,
    accountId: scope.accountId,
    operation: 'text',
    sessionKey: scope.sessionKey,
    conversationTarget: scope.target,
    outboxRouteId: unknown.outbox_route_id,
    outboxRouteVersionId: unknown.outbox_route_version_id
  };
  const accepted = await service.handleLateEgressResult({ ...lateIdentity, platformAccepted: true, commandId: queueId, platformMessageId: 'remote-accepted', executionGeneration: claimed.execution_generation });
  assert.equal(accepted.handled, true);
  assert.equal(store.getSendQueueItem(queueId).state, 'platform_accepted_local_pending');
  const duplicate = await service.handleLateEgressResult({ ...lateIdentity, platformAccepted: true, commandId: queueId, platformMessageId: 'remote-accepted', executionGeneration: claimed.execution_generation });
  assert.equal(duplicate.reason, 'queue-not-unknown');
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM r32_messages WHERE id=?').get(queueId).count, 1);
});

test('DEV-P0-04 hard terminator ends a non-cooperative physical execution before provider capacity is reused', async () => {
  const queue = new JobQueue({ concurrency: 1, name: `hard-terminate-${Date.now()}`, maxPhysicalZombiesPerProvider: 1, providerCircuitCooldownMs: 1000 });
  let rejectRaw;
  let terminateCalls = 0;
  const first = queue.add(() => new Promise((_, reject) => { rejectRaw = reject; }), {
    providerKey: 'terminable-provider', executionTimeoutMs: 30,
    hardTerminate() {
      terminateCalls += 1;
      rejectRaw(Object.assign(new Error('worker terminated'), { code: 'PROVIDER_WORKER_TERMINATED' }));
      return true;
    }
  });
  await assert.rejects(first.promise, error => error.code === 'AI_EXECUTION_TIMEOUT');
  for (let i = 0; i < 50 && queue.status().physicalInFlightCount !== 0; i += 1) await delay(10);
  assert.equal(terminateCalls, 1);
  assert.equal(queue.status().physicalInFlightCount, 0);
  const second = queue.add(async () => 'ok', { providerKey: 'other-provider', executionTimeoutMs: 100 });
  assert.equal(await second.promise, 'ok');
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

test('SYS-REG-04 AI timeout observability includes correlation, operation, generation and account lane', async () => {
  const queue = new JobQueue({ concurrency: 1, name: `observable-${Date.now()}`, maxPhysicalZombiesPerProvider: 1 });
  const events = [];
  const listener = event => events.push(event?.payload || event);
  eventBus.on('queue:execution-timeout', listener);
  try {
    const job = queue.add(() => new Promise(() => {}), {
      providerKey: 'observable-provider', executionTimeoutMs: 20,
      jobId: 'operation-observable', correlationId: 'correlation-observable',
      accountLane: 'telegram:account-observable', context: { requestId: 'request-observable', scopeKey: 'telegram:account-observable' }
    });
    await assert.rejects(job.promise, error => error.code === 'AI_EXECUTION_TIMEOUT');
    assert.equal(events.length, 1);
    assert.equal(events[0].correlationId, 'correlation-observable');
    assert.equal(events[0].operationId, 'operation-observable');
    assert.equal(events[0].accountLane, 'telegram:account-observable');
    assert.ok(events[0].executionGeneration);
  } finally {
    eventBus.off('queue:execution-timeout', listener);
  }
});


test('SYS-REG-03 compound pressure keeps healthy account and provider lanes progressing with bounded durable backlog metrics', async () => {
  const store = getStore();
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const stalledScope = seedScope(store, `${suffix}-stalled`, 'telegram');
  const healthyScope = seedScope(store, `${suffix}-healthy`, 'facebook');
  const stalledId = `compound-stalled-${suffix}`;
  const healthyId = `compound-healthy-${suffix}`;
  outboundCommandRepository.createAtomic(command(store, stalledScope, stalledId));
  outboundCommandRepository.createAtomic(command(store, healthyScope, healthyId));

  const service = new SendQueueService();
  service.dispatch = row => row.account_id === stalledScope.accountId
    ? executeWithDeadline(() => new Promise(() => {}), {
      timeoutMs: 35,
      code: 'PLATFORM_EGRESS_DEADLINE_EXCEEDED',
      outcomeUnknown: true,
      automaticRetryBlocked: true,
      operation: 'text', platform: 'telegram', accountId: stalledScope.accountId, commandId: row.id
    })
    : delay(8).then(() => ({ messageId: `remote-${row.id}` }));

  const aiQueue = new JobQueue({
    concurrency: 2,
    name: `compound-ai-${suffix}`,
    maxPhysicalZombiesPerProvider: 1,
    providerCircuitCooldownMs: 5_000
  });
  const zombie = aiQueue.add(() => new Promise(() => {}), {
    providerKey: 'ignored-abort-provider', executionTimeoutMs: 30,
    correlationId: `corr-${suffix}`, accountLane: `ai:${suffix}`
  });
  const healthyAi = aiQueue.add(async () => 'healthy-ai-complete', {
    providerKey: 'healthy-provider', executionTimeoutMs: 200
  });

  const durable = new BackgroundJobAuthority({ store });
  for (let index = 0; index < 601; index += 1) {
    durable.enqueue({
      jobType: 'compound-recovery', platform: 'telegram', sourceAccountId: stalledScope.accountId,
      conversationId: stalledScope.sessionKey, entityId: `entity-${suffix}-${String(index).padStart(4, '0')}`,
      revision: 'v1', payload: { index }
    }, { maxAttempts: 3 });
  }

  const startedAt = Date.now();
  const queryLoop = (async () => {
    let reads = 0;
    while (Date.now() - startedAt < 120) {
      store.listSendQueue({ limit: 20 });
      reads += 1;
      await delay(2);
    }
    return reads;
  })();
  const zombieOutcome = assert.rejects(zombie.promise, error => error.code === 'AI_EXECUTION_TIMEOUT');
  const [_, healthyAiResult, reads] = await Promise.all([service.tick(), healthyAi.promise, queryLoop, zombieOutcome]);

  assert.equal(healthyAiResult, 'healthy-ai-complete');
  assert.ok(reads > 0);
  assert.equal(store.getSendQueueItem(stalledId).state, 'send_outcome_unknown');
  assert.equal(store.getSendQueueItem(stalledId).unknown_scope, 'command');
  assert.equal(store.getSendQueueItem(healthyId).state, 'sent');
  assert.equal(service.running, false);
  assert.ok(Date.now() - startedAt < 1_000, 'compound lanes must settle within the bounded watchdog window');

  const aiStatus = aiQueue.status();
  assert.equal(aiStatus.physicalInFlightCount, 1, 'the ignored provider remains physically isolated rather than spawning replacements');
  assert.equal(aiStatus.providerCircuits['ignored-abort-provider'].open, true);
  const backlog = durable.snapshot({ jobType: 'compound-recovery', order: 'oldest', limit: 50 });
  assert.equal(backlog.total, 601);
  assert.equal(backlog.jobs.length, 50);
  assert.equal(backlog.remaining, 551);
  assert.ok(backlog.oldestPendingAt);
  assert.equal(backlog.consistency.pass, true);
});
