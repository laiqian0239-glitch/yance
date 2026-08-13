'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-batch26-platform-ai-'));
process.env.YANCE_DATA_DIR = dataRoot;
process.env.NODE_ENV = 'test';

const { JobQueue } = require('../services/jobQueue');
const { PlatformAdapterFacade } = require('../services/platformAdapterPorts');
const { SendQueueService } = require('../services/sendQueueService');
const queueRepository = require('../repositories/sendQueueRepository');
const { executeWithDeadline } = require('../services/executionDeadline');
const telegramModule = require('../services/telegramAdapter');
const { WhatsAppAdapter } = require('../services/whatsappAdapter');
const messageStore = require('../services/messageStore');
const syncCheckpoint = require('../services/syncCheckpointService');
const contextBrain = require('../services/contextAwareReplyBrain');
const learningService = require('../services/replyFeedbackLearningService');
const aiTaskRuntimeRegistry = require('../services/aiTaskRuntimeRegistry');
const lifecycleAuthority = require('../services/asyncOperationLifecycleAuthority').authority;
const facebookRelay = require('../services/facebookRelayClient');
const backgroundJobAuthority = require('../services/backgroundJobAuthority');
const { getStore, closeStore } = require('../repositories/storeProvider');
const { R32SqliteStore } = require('../lib/r32SqliteStore');
const { SqliteStorePersistenceAdapter } = require('../store/adapters/SqliteStorePersistenceAdapter');
const { StoreManager } = require('../store/StoreManager');
const { registerAiReplyCommands } = require('../store/commands/registerAiReplyCommands');

const { TelegramAdapter } = telegramModule;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function patch(t, object, key, value) {
  const original = object[key];
  object[key] = value;
  t.after(() => { object[key] = original; });
}

function createStoreRoot(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const store = new R32SqliteStore({ dbPath: path.join(root, 'r32.db') });
  return { root, store };
}

async function createManager(store, ids = {}) {
  const accountId = ids.accountId || 'wa-b26';
  const contactId = ids.contactId || 'contact-b26';
  const conversationId = ids.conversationId || 'conversation-b26';
  store.upsertAccount({ id: accountId, platform: 'whatsapp', adapterAccountId: accountId, displayName: 'Batch 26', canSend: true, canReceive: true });
  store.upsertContact({ id: contactId, platform: 'whatsapp', accountId, externalId: '491111111@s.whatsapp.net', displayName: 'Batch 26 Contact', canonicalContactId: contactId });
  store.upsertConversation({ sessionKey: conversationId, platform: 'whatsapp', accountId, contactId, title: 'Batch 26 Contact', routeState: 'ready', version: 1 });
  const manager = new StoreManager({ persistence: new SqliteStorePersistenceAdapter({ store }) });
  registerAiReplyCommands(manager);
  await manager.hydrate();
  return { manager, accountId, contactId, conversationId };
}

test.after(() => {
  learningService.stop();
  closeStore();
  fs.rmSync(dataRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

test('Batch26 AI watchdog releases the logical result but never overbooks a physical provider zombie', async () => {
  const queue = new JobQueue({ concurrency: 1, name: 'batch26-watchdog', maxPhysicalZombiesPerProvider: 1 });
  const first = queue.add(async () => new Promise(() => {}), { providerKey: 'ignored-abort-provider', executionTimeoutMs: 30 });
  const second = queue.add(async () => 'must-not-start', { providerKey: 'ignored-abort-provider', queueTimeoutMs: 500, executionTimeoutMs: 200 });
  await assert.rejects(first.promise, error => error.code === 'AI_EXECUTION_TIMEOUT');
  await assert.rejects(second.promise, error => error.code === 'AI_PROVIDER_PHYSICAL_CIRCUIT_OPEN');
  const status = queue.status();
  assert.equal(status.running.length, 0, 'logical slot must be released');
  assert.equal(status.physicalInFlightCount, 1, 'ignored provider call retains the physical permit');
  assert.equal(status.physicalInFlight[0].zombie, true);
  assert.equal(status.pending.length, 0);
});

test('Batch26 platform egress deadline returns outcome-unknown while another account still completes', async t => {
  const previous = process.env.YANCE_PLATFORM_EGRESS_TIMEOUT_MS;
  process.env.YANCE_PLATFORM_EGRESS_TIMEOUT_MS = '1000';
  t.after(() => {
    if (previous == null) delete process.env.YANCE_PLATFORM_EGRESS_TIMEOUT_MS;
    else process.env.YANCE_PLATFORM_EGRESS_TIMEOUT_MS = previous;
  });
  let failureEvidence = 0;
  const deliveryAuthority = {
    recordFailure() { failureEvidence += 1; return { observationId: 'failure' }; },
    recordSuccess() { return { observationId: 'success', capabilityId: 'message.text.send' }; }
  };
  const eventLog = { append(input) { return { event: { eventId: `event:${input.externalEventId}` } }; } };
  const hung = new PlatformAdapterFacade('telegram', {
    egressAuthorizer: async () => ({ authorized: true }),
    egressHandler: async () => new Promise(() => {}),
    deliveryAuthority,
    eventLog
  });
  const healthy = new PlatformAdapterFacade('whatsapp', {
    egressAuthorizer: async () => ({ authorized: true }),
    egressHandler: async () => ({ messageId: 'wa-ok-1' }),
    deliveryAuthority,
    eventLog
  });
  const base = { commandType: 'OutboxCommand', contentFrozen: true, operation: 'text', finalText: 'hello', sessionKey: 's', conversationTarget: 'peer' };
  const hungPromise = hung.executeEgress({ ...base, platform: 'telegram', accountId: 'tg-a', commandId: 'tg-cmd', idempotencyKey: 'tg-key' });
  const healthyResult = await healthy.executeEgress({ ...base, platform: 'whatsapp', accountId: 'wa-b', commandId: 'wa-cmd', idempotencyKey: 'wa-key' });
  assert.equal(healthyResult.platformMessageId, 'wa-ok-1');
  await assert.rejects(hungPromise, error => {
    assert.equal(error.code, 'PLATFORM_EGRESS_DEADLINE_EXCEEDED');
    assert.equal(error.outcomeUnknown, true);
    assert.equal(error.automaticRetryBlocked, true);
    assert.ok(error.executionGeneration);
    return true;
  });
  assert.equal(failureEvidence, 0, 'outcome-unknown must not be recorded as an ordinary retryable failure');
});

test('Batch26 WhatsApp egress abort closes the authoritative socket generation', async () => {
  const adapter = new WhatsAppAdapter();
  const controller = new AbortController();
  let rejectSend;
  let ended = 0;
  const row = {
    state: 'online',
    databaseAccountId: 'wa-abort',
    socket: {
      sendMessage() { return new Promise((_, reject) => { rejectSend = reject; }); },
      end(error) { ended += 1; rejectSend?.(error); }
    }
  };
  adapter.accounts.set('wa-abort', row);
  const pending = adapter.sendText({
    accountId: 'wa-abort',
    chatJid: '491111111@s.whatsapp.net',
    text: 'deadline test',
    signal: controller.signal,
    executionGeneration: 'wa-generation-1'
  });
  await delay(5);
  controller.abort(Object.assign(new Error('deadline'), { code: 'PLATFORM_EGRESS_DEADLINE_EXCEEDED' }));
  await assert.rejects(pending, error => error.code === 'PLATFORM_EGRESS_DEADLINE_EXCEEDED');
  assert.equal(ended, 1);
  assert.equal(row.egressDeadlineGeneration, 'wa-generation-1');
});

test('Batch26 Telegram egress abort disconnects and quarantines the current client generation', async () => {
  const adapter = new TelegramAdapter();
  const controller = new AbortController();
  let rejectSend;
  let disconnected = 0;
  const row = {
    account: null,
    state: 'connected',
    client: {
      sendMessage() { return new Promise((_, reject) => { rejectSend = reject; }); },
      async disconnect() { disconnected += 1; rejectSend?.(Object.assign(new Error('disconnected'), { code: 'TELEGRAM_DISCONNECTED' })); }
    }
  };
  adapter.sessions.set('tg-abort', row);
  const pending = adapter.sendText('tg-abort', '42', 'deadline test', {
    signal: controller.signal,
    executionGeneration: 'tg-generation-1'
  });
  await delay(5);
  controller.abort(Object.assign(new Error('deadline'), { code: 'PLATFORM_EGRESS_DEADLINE_EXCEEDED' }));
  await assert.rejects(pending, error => ['TELEGRAM_DISCONNECTED', 'PLATFORM_EGRESS_DEADLINE_EXCEEDED'].includes(error.code));
  await delay(10);
  assert.equal(disconnected, 1);
  assert.equal(row.state, 'recovering');
  assert.equal(row.egressDeadlineGeneration, 'tg-generation-1');
});


test('Batch26 send queue tick releases a timed-out lane and completes another account lane', async t => {
  const service = new SendQueueService();
  const claimed = [
    { id: 'hung-lane', account_id: 'tg-hung', state: 'sending', payload: { platform: 'telegram' } },
    { id: 'healthy-lane', account_id: 'wa-healthy', state: 'sending', payload: { platform: 'whatsapp' } }
  ];
  const completed = [];
  patch(t, queueRepository, 'list', () => []);
  patch(t, queueRepository, 'claimNext', () => claimed.shift() || null);
  service.recoverAcceptedJournals = () => 0;
  service.recoverPlatformAcceptedLocalPending = async () => {};
  service.reconcileOutcomeUnknownFromDurableEvidence = async () => {};
  service.processRow = async row => {
    if (row.id === 'hung-lane') {
      await assert.rejects(
        executeWithDeadline(() => new Promise(() => {}), {
          timeoutMs: 30,
          code: 'PLATFORM_EGRESS_DEADLINE_EXCEEDED',
          outcomeUnknown: true,
          operation: 'batch26-send-queue-lane-test',
          platform: 'telegram',
          accountId: row.account_id,
          commandId: row.id
        }),
        error => error.code === 'PLATFORM_EGRESS_DEADLINE_EXCEEDED'
      );
      completed.push('hung-timeout');
      return;
    }
    completed.push('healthy-complete');
  };
  await service.tick();
  assert.ok(completed.includes('healthy-complete'));
  assert.ok(completed.includes('hung-timeout'));
  assert.equal(service.running, false);
});

test('Batch26 Telegram QR authorization polling has a hard per-call deadline', async () => {
  const adapter = new TelegramAdapter();
  const account = { id: 'tg-qr-deadline' };
  const row = {
    state: 'waiting-verification',
    client: { checkAuthorization: async () => new Promise(() => {}) }
  };
  adapter.sessions.set(account.id, row);
  const startedAt = Date.now();
  await assert.rejects(
    adapter.waitForQrAuthorization(account, row, 35),
    error => error.code === 'TELEGRAM_QR_CONFIRM_TIMEOUT'
  );
  assert.ok(Date.now() - startedAt < 500, 'hung SDK poll must not defeat the overall QR deadline');
});

test('Batch26 Telegram phone login deadline aborts an SDK start promise that never settles', async t => {
  const previous = process.env.YANCE_TELEGRAM_AUTH_CHALLENGE_TIMEOUT_MS;
  process.env.YANCE_TELEGRAM_AUTH_CHALLENGE_TIMEOUT_MS = '35';
  t.after(() => {
    if (previous == null) delete process.env.YANCE_TELEGRAM_AUTH_CHALLENGE_TIMEOUT_MS;
    else process.env.YANCE_TELEGRAM_AUTH_CHALLENGE_TIMEOUT_MS = previous;
  });
  const adapter = new TelegramAdapter();
  const account = { id: 'tg-phone-deadline', credentialRef: 'credential:tg-phone-deadline', platform: 'telegram' };
  let disconnected = 0;
  patch(t, adapter, 'credentials', () => ({ appCredentials: { apiId: 1, apiHash: 'hash' }, secret: { session: '', phoneNumber: '' } }));
  patch(t, adapter, 'disconnect', async () => ({ state: 'unconfigured' }));
  patch(t, adapter, 'createClient', () => ({
    start: async () => new Promise(() => {}),
    async disconnect() { disconnected += 1; }
  }));
  patch(t, adapter, 'persistCredentials', async () => ({ ok: true }));
  const result = await adapter.beginPhoneLogin(account, '+491234567890');
  assert.equal(result.state, 'error');
  assert.match(result.lastError, /过期|deadline/i);
  await delay(20);
  assert.ok(disconnected >= 1);
});

test('Batch26 Telegram remote acceptance returns durable local repair instead of a retryable rejection', async t => {
  const adapter = new TelegramAdapter();
  let remoteSends = 0;
  adapter.sessions.set('tg-a', { state: 'connected', client: { async sendMessage() { remoteSends += 1; return { id: 991 }; } } });
  patch(t, messageStore, 'upsert', async () => { throw Object.assign(new Error('SQLITE_BUSY'), { code: 'SQLITE_BUSY' }); });
  const result = await adapter.sendText('tg-a', '42', 'hello', { localMessageId: 'local-1', sessionKey: 'tg-a:42' });
  assert.equal(remoteSends, 1);
  assert.equal(result.messageId, '991');
  assert.equal(result.localPersistencePending, true);
  assert.equal(result.localPersistenceErrorCode, 'SQLITE_BUSY');
  assert.equal(result.localPersistenceRepair.kind, 'message-upsert');
});

test('Batch26 Telegram live ingest persists text and durable enrichment identity before any media work', async t => {
  const adapter = new TelegramAdapter();
  let handler;
  const account = { id: 'tg-live', displayName: 'TG' };
  const row = { state: 'connected', client: { addEventHandler(fn) { handler = fn; } }, user: { id: 'me' } };
  class NewMessage {}
  const order = [];
  let persisted = null;
  patch(t, syncCheckpoint, 'begin', () => ({ batchId: 'batch-live' }));
  patch(t, syncCheckpoint, 'claimRemoteMessage', () => ({ claimed: true, duplicate: false }));
  patch(t, syncCheckpoint, 'commit', () => { order.push('commit'); });
  patch(t, messageStore, 'upsert', async input => {
    order.push('message'); persisted = input;
    return { inserted: true, message: input, conversation: {} };
  });
  patch(t, adapter, 'scheduleMessageEnrichment', () => { order.push('enrichment-scheduled'); });
  adapter.sessions.set(account.id, row);
  adapter.attachMessageHandler(account, row, NewMessage);
  await handler({ message: {
    id: 7, chatId: 42, senderId: 42, out: false, message: 'visible now', date: 1783900800,
    media: {}, photo: {}, downloadMedia: async () => new Promise(() => {})
  } });
  assert.deepEqual(order, ['message', 'commit', 'enrichment-scheduled']);
  assert.equal(persisted.text, 'visible now');
  assert.equal(persisted.attachments[0].downloadStatus, 'queued');
  assert.equal(persisted.backgroundJobs[0].jobType, 'telegram-message-enrichment');
});

test('Batch26 Telegram live ingest failure records failed checkpoint and releases the remote claim', async t => {
  const adapter = new TelegramAdapter();
  let handler;
  const account = { id: 'tg-live-fail', displayName: 'TG' };
  const row = { state: 'connected', client: { addEventHandler(fn) { handler = fn; } }, user: { id: 'me' } };
  class NewMessage {}
  let released = 0; let failed = 0; let committed = 0;
  patch(t, syncCheckpoint, 'begin', () => ({ batchId: 'batch-live-fail' }));
  patch(t, syncCheckpoint, 'claimRemoteMessage', () => ({ claimed: true, duplicate: false }));
  patch(t, syncCheckpoint, 'releaseRemoteMessage', () => { released += 1; });
  patch(t, syncCheckpoint, 'fail', () => { failed += 1; });
  patch(t, syncCheckpoint, 'commit', () => { committed += 1; });
  patch(t, messageStore, 'upsert', async () => { throw new Error('disk interrupted'); });
  adapter.sessions.set(account.id, row);
  adapter.attachMessageHandler(account, row, NewMessage);
  await handler({ message: { id: 8, chatId: 42, senderId: 42, out: false, message: 'hello', date: 1783900800 } });
  assert.equal(released, 1);
  assert.equal(failed, 1);
  assert.equal(committed, 0);
});

test('Batch26 Telegram history failure does not advance the durable cursor', async t => {
  const adapter = new TelegramAdapter();
  const account = { id: 'tg-sync', displayName: 'TG' };
  const client = {
    async getDialogs() { return [{ id: '42', title: 'Peer', unreadCount: 1, entity: { id: '42' } }]; },
    async getMessages() { return [{ id: 5, date: 1783900800, out: false, message: 'lost' }]; }
  };
  adapter.sessions.set(account.id, { state: 'connected', client });
  patch(t, messageStore, 'getConversation', () => null);
  patch(t, messageStore, 'hasExternalMessage', () => false);
  patch(t, messageStore, 'upsert', async () => { throw new Error('message write failed'); });
  patch(t, syncCheckpoint, 'begin', () => ({ batchId: 'batch-sync' }));
  let committed = 0; let failed = 0; let failedPayload = null;
  patch(t, syncCheckpoint, 'commit', () => { committed += 1; });
  patch(t, syncCheckpoint, 'fail', input => { failed += 1; failedPayload = input; });
  const result = await adapter.sync(account);
  assert.equal(result.failedMessages, 1);
  assert.equal(result.failedConversations, 1);
  assert.equal(committed, 0);
  assert.equal(failed, 1);
  assert.equal(failedPayload.payload.failedRemoteMessageId, '5');
});


test('Batch26 reply generation does not wait on a learned-profile barrier', async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '../services/contextAwareReplyBrain.js'), 'utf8');
  assert.doesNotMatch(source, /waitForLearningIdle|replyLearningScopeAuthority/u);
});

test('Batch26 feedback evidence is transaction-bound and projection jobs are retired', () => { const service=require('../services/replyFeedbackLearningService');assert.equal(service.status().customProjectionScheduler,false);assert.equal(service.status().automaticProfileMutation,false); });


test('Batch26 immutable feedback no longer requires startup reconciliation pagination', () => { const service=require('../services/replyFeedbackLearningService');assert.equal(service.status().customRetryQueue,false); });

test('Batch26 candidate commit CAS rejects a stale conversation revision without writing a candidate', async () => {
  const { root, store } = createStoreRoot('yance-b26-candidate-cas-');
  try {
    const { manager, contactId, conversationId } = await createManager(store);
    const task = await manager.dispatch({
      type: 'AI_REPLY_TASK_STARTED', source: 'batch26-test',
      payload: { contactId, conversationId, conversationRevision: 1, entityVersions: {}, source: 'openrouter' }
    });
    store.upsertConversation({ sessionKey: conversationId, platform: 'whatsapp', accountId: 'wa-b26', contactId, title: 'Batch 26 Contact', routeState: 'ready', version: 2 });
    const currentManager = new StoreManager({ persistence: new SqliteStorePersistenceAdapter({ store }) });
    registerAiReplyCommands(currentManager);
    await currentManager.hydrate();
    const result = await currentManager.dispatch({
      type: 'AI_REPLY_CANDIDATE_READY', source: 'batch26-test',
      payload: { taskId: task.result.taskId, text: 'stale candidate', conversationRevision: 1, expectedConversationRevision: 1, expectedEntityVersions: {} }
    });
    assert.equal(result.result.stale, true);
    assert.equal(result.result.candidateId, '');
    const snapshot = currentManager.snapshot();
    assert.equal(snapshot.aiBrain.tasksById[task.result.taskId].status, 'cancelled');
    assert.equal(Object.keys(snapshot.aiBrain.candidatesById).length, 0);
  } finally {
    try { store.close(); } catch (_) {}
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test('Batch26 interrupted durable AI runtime task is failed on restart recovery', () => {
  const runtime = aiTaskRuntimeRegistry.start('task-b26-restart', { conversationId: 'cv-b26', contactId: 'c-b26', conversationRevision: 1 });
  aiTaskRuntimeRegistry.finish('task-b26-restart');
  const before = lifecycleAuthority.read(runtime.operationId);
  assert.equal(before.state, 'RUNNING');
  const recovered = aiTaskRuntimeRegistry.recoverInterrupted();
  assert.equal(recovered.recovered, 1);
  const after = lifecycleAuthority.read(runtime.operationId);
  assert.equal(after.state, 'FAILED');
  assert.equal(after.errorCode, 'PROCESS_RESTARTED_AI_TASK_INTERRUPTED');
});

test('Batch26 authoritative inbound message transaction includes durable analysis and enrichment jobs', async () => {
  const store = getStore();
  store.upsertAccount({ id: 'tg-durable', platform: 'telegram', adapterAccountId: 'tg-durable', displayName: 'TG durable', canSend: true, canReceive: true });
  const outcome = await messageStore.upsert({
    id: 'tg-durable-msg-1', externalMessageId: '101', dedupeKey: 'tg-durable:42:101',
    accountId: 'tg-durable', sourceAccountId: 'tg-durable', platform: 'telegram', chatJid: 'telegram:42', conversationId: 'tg-durable:42',
    direction: 'inbound', fromMe: false, type: 'image', text: 'caption', sender: '42', senderName: 'Peer', contactName: 'Peer',
    timestamp: new Date().toISOString(), attachments: [{ kind: 'image', downloadStatus: 'queued' }],
    backgroundJobs: [{
      jobType: 'telegram-message-enrichment', platform: 'telegram', sourceAccountId: 'tg-durable', conversationId: 'tg-durable:42', entityId: '101', revision: 'v1', maxAttempts: 5,
      payload: { chatId: '42', externalId: '101', conversationId: 'tg-durable:42' }
    }]
  });
  assert.equal(outcome.message.text, 'caption');
  const jobs = store.db.prepare("SELECT job_type,state FROM background_job_state WHERE source_account_id='tg-durable' ORDER BY job_type").all();
  assert.deepEqual(jobs.map(row => ({ job_type: row.job_type, state: row.state })), [
    { job_type: 'ai-conversation-analysis', state: 'PENDING' },
    { job_type: 'telegram-message-enrichment', state: 'PENDING' }
  ]);
});


test('Batch26 parallel migrations create collision-proof snapshots for different databases', async () => {
  const common = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-b26-parallel-migration-'));
  const storeModule = path.resolve(__dirname, '../lib/r32SqliteStore.js');
  const runChild = index => new Promise((resolve, reject) => {
    const dbPath = path.join(common, `db-${index}`, 'r32.db');
    const code = `
      const { R32SqliteStore } = require(${JSON.stringify(storeModule)});
      const store = new R32SqliteStore({ dbPath: ${JSON.stringify(dbPath)} });
      store.close();
    `;
    const child = spawn(process.execPath, ['-e', code], {
      env: { ...process.env, YANCE_DATA_DIR: path.join(common, `data-${index}`) },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    child.on('error', reject);
    child.on('exit', exitCode => exitCode === 0 ? resolve() : reject(new Error(`migration child ${index} failed (${exitCode}): ${output}`)));
  });
  try {
    await Promise.all([0, 1, 2, 3].map(runChild));
    const backupRoot = path.join(common, 'migration-backups');
    const snapshots = fs.existsSync(backupRoot) ? fs.readdirSync(backupRoot).filter(name => name.endsWith('.sqlite')) : [];
    assert.equal(new Set(snapshots).size, snapshots.length);
    assert.ok(snapshots.length >= 4, `expected at least one snapshot per database, got ${snapshots.length}`);
  } finally {
    fs.rmSync(common, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test('Batch26 Facebook raw response body has its own deadline and cancels the body', async () => {
  let cancelled = 0;
  const response = {
    arrayBuffer: async () => new Promise(() => {}),
    body: { async cancel() { cancelled += 1; } }
  };
  await assert.rejects(
    facebookRelay.readRawBodyWithDeadline(response, { timeoutMs: 20, code: 'FACEBOOK_BODY_TEST_TIMEOUT' }),
    error => error.code === 'FACEBOOK_BODY_TEST_TIMEOUT'
  );
  assert.equal(cancelled, 1);
});
