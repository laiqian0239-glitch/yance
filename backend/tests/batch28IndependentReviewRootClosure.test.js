'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-b28-independent-review-'));
process.env.YANCE_DATA_DIR = dataRoot;
process.env.NODE_ENV = 'test';

const { R32SqliteStore } = require('../lib/r32SqliteStore');
const jobQueue = require('../services/jobQueue');
const { executeWithDeadline } = require('../services/executionDeadline');
const platformMessagingService = require('../services/platformMessagingService');
const eventBus = require('../services/eventBus');
const { executeEgressWithDeadline, executePortWithDeadline, createAccountManagerAuthHandler, createAccountManagerReconcileHandler } = require('../services/platformAdapterPorts');
const accountStore = require('../services/accountStore');
const platformDrivers = require('../services/platformDriverRegistry');
const backgroundJobAuthority = require('../services/backgroundJobAuthority');
const asyncOperationLifecycleAuthority = require('../services/asyncOperationLifecycleAuthority');
const { SendQueueService } = require('../services/sendQueueService');
const { StoreManager } = require('../store/StoreManager');
const { SqliteStorePersistenceAdapter } = require('../store/adapters/SqliteStorePersistenceAdapter');
const { registerAiReplyCommands } = require('../store/commands/registerAiReplyCommands');
const { MessageTranslationService, translationSourceHash, translationWorkKey } = require('../services/messageTranslationService');
const { getStore, closeStore } = require('../repositories/storeProvider');
const { RuntimeOwnership } = require('../runtime/RuntimeOwnership');
const { PATHS } = require('../config');
const { TelegramAdapter } = require('../services/telegramAdapter');
const { getSecurityGuard } = require('../core/securityGuardSingleton');
const { DurableInternalOperationAuthority } = require('../services/durableInternalOperationAuthority');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(predicate, timeoutMs = 2500) {
  const started = Date.now();
  while (Date.now() - started <= timeoutMs) {
    const value = predicate();
    if (value) return value;
    await delay(10);
  }
  throw new Error('Timed out waiting for condition');
}
function fixture(prefix = 'yance-b28-fixture-') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const store = new R32SqliteStore({ dbPath: path.join(root, 'database', 'yance.db') });
  return { root, store, close() { try { store.close(); } catch (_) {} fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); } };
}
function durableAuthority(store) {
  let sequence = 0;
  return new DurableInternalOperationAuthority({
    storeProvider: () => store,
    tokenProvider: () => store.authorityWriteHostCapability.tokenSnapshot(),
    idFactory: prefix => `${prefix}-${++sequence}`
  });
}
function seedAiScope(store) {
  const accountId = 'wa-runtime-account';
  const contactId = 'wa-runtime-contact';
  const conversationId = 'wa-runtime-conversation';
  store.upsertAccount({ id: accountId, accountId, adapterAccountId: accountId, platform: 'whatsapp', state: 'online', canSend: true, canReceive: true });
  store.upsertContact({ id: contactId, accountId, platform: 'whatsapp', externalId: '491234567@s.whatsapp.net', canonicalContactId: contactId, displayName: 'Runtime Contact' });
  store.upsertConversation({ sessionKey: conversationId, accountId, platform: 'whatsapp', contactId, title: 'Runtime Contact', routeState: 'ready', version: 1 });
  return { accountId, contactId, conversationId };
}
function seedTranslationMessage(store, suffix = 'translation') {
  const accountId = `tg-${suffix}-account`;
  const contactId = `tg-${suffix}-contact`;
  const conversationId = `tg-${suffix}-conversation`;
  const messageId = `tg-${suffix}-message`;
  store.upsertAccount({ id: accountId, accountId, adapterAccountId: accountId, platform: 'telegram', state: 'online', canSend: true, canReceive: true });
  store.upsertContact({ id: contactId, accountId, platform: 'telegram', externalId: `peer-${suffix}`, canonicalContactId: contactId, displayName: 'Translation Contact' });
  store.upsertConversation({ sessionKey: conversationId, accountId, platform: 'telegram', contactId, title: 'Translation Contact', routeState: 'ready', version: 1 });
  store.upsertMessage({
    id: messageId, sessionKey: conversationId, conversationId, accountId, contactId,
    senderId: `peer-${suffix}`, role: 'customer', direction: 'inbound', messageType: 'text',
    text: 'Guten Morgen', language: 'de', sentAt: '2026-07-29T06:00:00.000Z'
  });
  return { accountId, contactId, conversationId, messageId };
}

test.after(() => {
  try { closeStore(); } catch (_) {}
  fs.rmSync(dataRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

test('B28-P0-01 retired background job authority exposes only read-only state labels and recovery delegation', () => {
  assert.equal(typeof backgroundJobAuthority.BackgroundJobAuthority, 'undefined');
  assert.equal(backgroundJobAuthority.STATES.RUNNING, 'RUNNING');
  assert.equal(backgroundJobAuthority.STATES.RETRY_WAIT, 'RETRY_WAIT');
  assert.equal(typeof backgroundJobAuthority.recoverDurableExecutions, 'function');
});

test('B28-P0-02 legacy JobQueue no longer owns physical execution or hard termination', () => {
  assert.equal(typeof jobQueue.JobQueue, 'undefined');
  assert.deepEqual(Object.keys(jobQueue).sort(), ['recoverDurableExecutions', 'recoverNonterminalExecutions']);
});

test('B28-P0-03 caller cancellation quarantines a later provider ACK with generation and reason', async () => {
  const controller = new AbortController();
  let resolveProvider;
  const late = [];
  const pending = executeWithDeadline(() => new Promise(resolve => { resolveProvider = resolve; }), {
    timeoutMs: 10_000,
    signal: controller.signal,
    generation: 'caller-abort-generation',
    operation: 'sendText',
    platform: 'telegram',
    accountId: 'tg-cancel',
    commandId: 'cmd-cancel',
    onLateResult(error, value, context) { late.push({ error, value, context }); }
  });
  controller.abort(Object.assign(new Error('superseded'), { code: 'AI_TASK_CANCELLED' }));
  await assert.rejects(pending, error => error.code === 'AI_TASK_CANCELLED');
  resolveProvider({ platformAccepted: true, messageId: 'late-ack-1' });
  await delay(10);
  assert.equal(late.length, 1);
  assert.equal(late[0].context.generation, 'caller-abort-generation');
  assert.equal(late[0].context.reason, 'caller-abort');
  assert.equal(late[0].value.messageId, 'late-ack-1');
});

test('B28-P0-13 adapter-port deadline publishes a late platform ACK for durable queue convergence', async t => {
  const previousTimeout = process.env.YANCE_PLATFORM_EGRESS_TIMEOUT_MS;
  process.env.YANCE_PLATFORM_EGRESS_TIMEOUT_MS = '1000';
  t.after(() => {
    if (previousTimeout == null) delete process.env.YANCE_PLATFORM_EGRESS_TIMEOUT_MS;
    else process.env.YANCE_PLATFORM_EGRESS_TIMEOUT_MS = previousTimeout;
  });
  let resolveProvider;
  const events = [];
  const listener = event => events.push(event);
  eventBus.on('platform-egress:late-result-quarantined', listener);
  try {
    const pending = executeEgressWithDeadline(() => new Promise(resolve => { resolveProvider = resolve; }), {
      platform: 'telegram', accountId: 'tg-late-port', commandId: 'queue-late-port', operation: 'text',
      sessionKey: 'tg-late-port:peer', conversationTarget: 'peer',
      outboxRouteId: 'route-late-port', outboxRouteVersionId: 'route-version-late-port'
    });
    await assert.rejects(pending, error => error.code === 'PLATFORM_EGRESS_DEADLINE_EXCEEDED');
    resolveProvider({ messageId: 'remote-late-port' });
    await waitFor(() => events.length === 1);
    const payload = events[0].payload;
    assert.equal(payload.platformAccepted, true);
    assert.equal(payload.platformMessageId, 'remote-late-port');
    assert.equal(payload.commandId, 'queue-late-port');
    assert.equal(payload.sessionKey, 'tg-late-port:peer');
    assert.equal(payload.outboxRouteVersionId, 'route-version-late-port');
    assert.ok(payload.executionGeneration);
  } finally {
    eventBus.off('platform-egress:late-result-quarantined', listener);
  }
});

test('B28-P0-08 a bare cancellation signal cannot bypass direct platform operation deadline or generation fencing', async t => {
  let resolveProvider;
  let received = null;
  t.mock.method(accountStore, 'list', () => [{ id: 'wa-direct-deadline', adapterAccountId: 'wa-direct-deadline', platform: 'whatsapp' }]);
  t.mock.method(platformDrivers, 'get', () => ({
    adapterAccountId(account, requestedId) { return account?.adapterAccountId || requestedId; },
    externalTarget(value) { return value; },
    sendPresence(_context, input) {
      received = input;
      return new Promise(resolve => { resolveProvider = resolve; });
    }
  }));
  const controller = new AbortController();
  const pending = platformMessagingService.sendPresence({
    accountId: 'wa-direct-deadline', platform: 'whatsapp', chatJid: '491234567@s.whatsapp.net',
    state: 'composing', timeoutMs: 25, signal: controller.signal, executionGeneration: 'direct-presence-generation'
  });
  await assert.rejects(pending, error => error.code === 'PLATFORM_OPERATION_DEADLINE_EXCEEDED' && error.executionGeneration === 'direct-presence-generation');
  assert.equal(received.executionGeneration, 'direct-presence-generation');
  assert.notEqual(received.signal, controller.signal, 'direct operation must receive the locally fenced deadline signal');
  resolveProvider({ ok: true });
  await delay(5);
});

test('B28-P0-04 send_outcome_unknown blocks writes and legacy queue mutations are retired', async () => {
  const service = new SendQueueService();
  service.pausedReason = 'PLATFORM_ACCEPTED_CHECKPOINT_UNCERTAIN';
  assert.throws(() => service.assertEnqueueAllowed('text', { accountId: 'brand-new-account' }), error => error.code === 'SEND_QUEUE_STATUS_UNAVAILABLE_WRITE_BLOCKED');
  await assert.rejects(() => service.retry('legacy-id'), error => error.code === 'SEND_QUEUE_LEGACY_MUTATION_RETIRED');
  await assert.rejects(() => service.cancel('legacy-id'), error => error.reasonCode === 'WP_B_DURABLE_RECOVERY_AUTHORITY_REQUIRED');
});

test('B28-P0-12 outcome-unknown crash journal is route/generation fenced before replay', async () => {
  const service = new SendQueueService();
  assert.equal(typeof service.recoverOutcomeUnknownJournals, 'undefined');
  await assert.rejects(() => service.resolveOutcomeUnknown('journal-queue', 'sent'), error => error.code === 'SEND_QUEUE_LEGACY_MUTATION_RETIRED');
});

test('B28-P0-05 async recovery cursor remains stable while earlier pages become terminal', () => {
  const f = fixture('yance-b28-async-cursor-');
  try {
    const authority = durableAuthority(f.store);
    for (let index = 0; index < 9; index += 1) {
      authority.create({ operationId: `async-${index}`, operationType: 'ai.reply.candidates', scopeKey: `scope-${index}`, objectFingerprint: `fingerprint-${index}` });
    }
    const visited = authority.snapshot({ operationType: 'ai.reply.candidates', state: 'SCHEDULED', limit: 9 }).map(operation => operation.operationId);
    for (const operationId of visited) {
      const running = authority.start(operationId).operation;
      authority.succeed(operationId, { status: 'completed' }, { generation: running.generation, objectFingerprint: running.objectFingerprint });
    }
    assert.equal(visited.length, 9);
    assert.equal(new Set(visited).size, 9);
    assert.equal(authority.snapshot({ operationType: 'ai.reply.candidates', state: 'SCHEDULED' }).length, 0);
    assert.equal(authority.snapshot({ operationType: 'ai.reply.candidates', state: 'RUNNING' }).length, 0);
  } finally { f.close(); }
});

test('B28-P0-06 candidate final transaction rejects cancelled runtime generation before persistence', async () => {
  const f = fixture('yance-b28-runtime-cas-');
  try {
    const { contactId, conversationId } = seedAiScope(f.store);
    const manager = new StoreManager({ persistence: new SqliteStorePersistenceAdapter({ store: f.store }) });
    registerAiReplyCommands(manager);
    await manager.hydrate();
    const started = await manager.dispatch({ type: 'AI_REPLY_TASK_STARTED', source: 'b28-test', payload: { contactId, conversationId, conversationRevision: 1, entityVersions: {}, source: 'openrouter' } });
    const taskId = started.result.taskId;
    f.store.db.prepare(`INSERT OR REPLACE INTO async_operation_state(
      operation_id,operation_type,scope_key,object_fingerprint,state,generation,progress,
      error_code,error_message,created_at,updated_at,finished_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      taskId, 'ai.reply.candidates', conversationId, 'runtime-fingerprint-v1', 'CANCELLED', 1, 0,
      'SUPERSEDED', 'superseded by newer runtime generation',
      '2026-07-29T05:30:00.000Z', '2026-07-29T05:30:01.000Z', '2026-07-29T05:30:01.000Z'
    );

    await assert.rejects(manager.dispatch({ type: 'AI_REPLY_CANDIDATE_READY', source: 'b28-test', payload: {
      taskId, text: 'late candidate must not commit', conversationId,
      expectedConversationRevision: 1, expectedEntityVersions: {},
      expectedRuntimeGeneration: 1,
      expectedRuntimeFingerprint: 'runtime-fingerprint-v1'
    } }), error => error.code === 'STALE_AI_RUNTIME_AT_CANDIDATE_COMMIT');
    assert.equal(Object.keys(manager.snapshot().aiBrain.candidatesById).length, 0);
    assert.equal(Number(f.store.db.prepare('SELECT COUNT(*) AS count FROM ai_reply_candidates WHERE task_id=?').get(taskId).count), 0);
  } finally { f.close(); }
});

test('B28-P0-07 translation final transaction rejects superseded generation and only commits the newest result', async () => {
  const f = fixture('yance-b28-translation-cas-');
  try {
    const { messageId } = seedTranslationMessage(f.store, 'translation-cas');
    const calls = [];
    const authority = durableAuthority(f.store);
    const service = new MessageTranslationService({
      storeProvider: () => f.store,
      internalOperationAuthorityProvider: () => authority,
      contactLanguageAuthority: { observeMessage() {} },
      bilingualUnderstandingService: {
        translateToChinese(input) {
          return new Promise(resolve => calls.push({ input, resolve }));
        }
      },
      logger: { info() {}, warn() {} },
      maxConcurrency: 1
    });
    const first = service.createJob(messageId, { force: true });
    await waitFor(() => calls.length === 1);
    const second = service.retryJob(first.id, { background: true });
    assert.equal(service.getJob(first.id).status, 'cancelled');
    assert.equal(service.getJob(first.id).errorCode, 'TRANSLATION_SUPERSEDED');
    assert.notEqual(second.operationId, first.operationId);

    calls[0].resolve({
      sourceText: 'Guten Morgen', sourceLanguage: 'de', translatedZh: '旧结果',
      translationStatus: 'success', translationModel: 'old-provider', translatedAt: '2026-07-29T06:01:00.000Z'
    });
    await waitFor(() => calls.length === 2);
    const runningSecond = service.getJob(second.id);
    assert.equal(runningSecond.status, 'running');
    const pending = f.store.getMessage(messageId);
    assert.notEqual(pending.translatedZh, '旧结果');
    assert.equal(pending.translationStatus, 'pending');
    assert.equal(pending.translationOperationId, second.operationId);
    assert.equal(Number(pending.translationGeneration), Number(runningSecond.generation));

    calls[1].resolve({
      sourceText: 'Guten Morgen', sourceLanguage: 'de', translatedZh: '新结果',
      translationStatus: 'success', translationModel: 'new-provider', translatedAt: '2026-07-29T06:02:00.000Z'
    });
    const completed = await waitFor(() => {
      const row = service.getJob(second.id);
      return row && !['queued', 'running'].includes(row.status) ? row : null;
    });
    assert.equal(completed.status, 'success');
    const saved = f.store.getMessage(messageId);
    assert.equal(saved.translatedZh, '新结果');
    assert.equal(saved.translationModel, 'new-provider');
    assert.equal(saved.translationOperationId, second.operationId);
    assert.equal(Number(saved.translationGeneration), Number(completed.generation));
    assert.equal(service.getJob(first.operationId).durableState, 'CANCELLED');
    assert.equal(service.getJob(second.operationId).durableState, 'SUCCEEDED');
    service.close();
  } finally { f.close(); }
});

test('B28-P0-09 translation restart recovery delegates active lifecycle recovery to durable execution authority', () => {
  const f = fixture('yance-b28-translation-recovery-');
  try {
    const { messageId } = seedTranslationMessage(f.store, 'translation-recovery');
    const message = f.store.getMessage(messageId);
    const sourceHash = translationSourceHash(message.text);
    const fingerprint = translationWorkKey(message, message.text);
    const authority = durableAuthority(f.store);
    const created = authority.create({
      operationId: 'translation-restart-operation', operationType: 'translation.message',
      scopeKey: messageId, objectFingerprint: fingerprint
    }).operation;
    const running = authority.start(created.operationId, { progress: 35 }).operation;
    f.store.upsertMessage({
      ...message,
      sourceText: message.text,
      sourceLanguage: 'de',
      translatedZh: '',
      translationStatus: 'pending',
      translationSourceHash: sourceHash,
      translationTargetLanguage: 'zh',
      translationOperationId: running.operationId,
      translationGeneration: running.generation,
      translationObjectFingerprint: running.objectFingerprint
    });
    const service = new MessageTranslationService({
      storeProvider: () => f.store,
      internalOperationAuthorityProvider: () => authority,
      contactLanguageAuthority: { observeMessage() {} },
      logger: { info() {}, warn() {} }
    });
    const report = service.recoverInterruptedTranslations({ pageLimit: 1 });
    assert.equal(report.scanned, 0);
    assert.equal(report.messageFailed, 0);
    assert.equal(report.lifecycleFailed, 0);
    assert.equal(report.errors.length, 0);
    assert.equal(report.delegatedTo, 'DurableExecutionRecoveryAuthority');
    assert.equal(authority.read(running.operationId).state, 'RUNNING');
  } finally { f.close(); }
});

test('B28-P1-01 Learning V4 ledger separates eligible evidence without custom retry or DLQ state', () => { const service=require('../services/replyFeedbackLearningService');const row=service.buildImmutableFeedbackSignal({eventType:'sent',outboxId:'o',contactId:'p',conversationId:'c',personaTruthReceipt:{pass:true},learningEligible:true});assert.equal(row.learningEligible,true);assert.equal(service.status().customRetryQueue,false); });


test('B28-P0-10 RuntimeOwnership honors its canonical dbPath and releases process guards', async () => {
  const baselineExitListeners = process.listenerCount('exit');
  const roots = [
    fs.mkdtempSync(path.join(os.tmpdir(), 'yance-b28-runtime-path-a-')),
    fs.mkdtempSync(path.join(os.tmpdir(), 'yance-b28-runtime-path-b-'))
  ];
  try {
    for (let index = 0; index < roots.length; index += 1) {
      const root = roots[index];
      const dbPath = path.join(root, 'store', 'runtime-authority.db');
      const owner = new RuntimeOwnership({ dataRoot: root, dbPath, buildId: `b28-runtime-path-${index}` });
      await owner.acquire();
      try {
        assert.equal(fs.realpathSync(owner.dbPath), fs.realpathSync(dbPath));
        assert.equal(fs.realpathSync(owner.store.dbPath), fs.realpathSync(dbPath));
        assert.equal(owner.store.snapshot().stateVersion, 1);
        assert.equal(fs.existsSync(dbPath), true);
        assert.equal(process.listenerCount('exit'), baselineExitListeners + 1);
      } finally {
        await owner.release();
      }
      assert.equal(process.listenerCount('exit'), baselineExitListeners);
    }
    assert.notEqual(path.resolve(roots[0], 'store', 'runtime-authority.db'), path.resolve(roots[1], 'store', 'runtime-authority.db'));
  } finally {
    roots.forEach(root => fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));
  }
});


test('B28-P0-14 Telegram credential persistence delegates once to guarded custody instead of recursing', async t => {
  const guard = getSecurityGuard();
  const calls = [];
  t.mock.method(guard, 'persistCredential', async (ref, value, context) => {
    calls.push({ ref, value, context });
    return true;
  });
  const adapter = new TelegramAdapter();
  const value = { session: 'session-value', phoneNumber: '+4912345678' };
  assert.equal(await adapter.persistCredentials('telegram-credential-ref', value), true);
  assert.deepEqual(calls, [{
    ref: 'telegram-credential-ref',
    value,
    context: { actor: 'platform-adapter' }
  }]);
});


test('B28-P0-15 every AccountManager auth/reconcile operation receives the authoritative signal and generation', async () => {
  const controller = new AbortController();
  const generation = 'auth-reconcile-generation';
  const calls = [];
  const record = (name, args, result = {}) => { calls.push({ name, args }); return result; };
  const manager = {
    connect: (...args) => record('connect', args), reconnect: (...args) => record('reconnect', args),
    disconnect: (...args) => record('disconnect', args), resume: (...args) => record('resume', args),
    startTelegramQr: (...args) => record('startTelegramQr', args), startTelegramPhone: (...args) => record('startTelegramPhone', args),
    submitTelegramCode: (...args) => record('submitTelegramCode', args), submitTelegramPassword: (...args) => record('submitTelegramPassword', args),
    cancelTelegramLogin: (...args) => record('cancelTelegramLogin', args),
    beginFacebookOAuth: (...args) => record('beginFacebookOAuth', args), pollFacebookOAuth: (...args) => record('pollFacebookOAuth', args),
    selectFacebookPage: (...args) => record('selectFacebookPage', args), cancelFacebookOAuth: (...args) => record('cancelFacebookOAuth', args),
    sync: (...args) => record('sync', args),
    startFacebookBusinessSuiteAvatarImport: (...args) => record('startFacebookBusinessSuiteAvatarImport', args),
    getFacebookBusinessSuiteAvatarImportStatus: (...args) => record('getFacebookBusinessSuiteAvatarImportStatus', args),
    stopFacebookBusinessSuiteAvatarImport: (...args) => record('stopFacebookBusinessSuiteAvatarImport', args),
    diagnoseFacebookAvatarClosure: (...args) => record('diagnoseFacebookAvatarClosure', args)
  };
  const auth = createAccountManagerAuthHandler(() => manager);
  const base = { accountId: 'account-auth', signal: controller.signal, operationGeneration: generation };
  await auth.execute({ ...base, operation: 'connect' });
  await auth.execute({ ...base, operation: 'reconnect' });
  await auth.execute({ ...base, operation: 'pause' });
  await auth.execute({ ...base, operation: 'resume' });
  await auth.execute({ ...base, operation: 'logout' });
  await auth.execute({ ...base, operation: 'telegram.qr.start' });
  await auth.execute({ ...base, operation: 'telegram.phone.start', phoneNumber: '+491234567' });
  await auth.execute({ ...base, operation: 'telegram.code', code: '12345' });
  await auth.execute({ ...base, operation: 'telegram.password', password: 'secret' });
  await auth.execute({ ...base, operation: 'telegram.cancel' });
  await auth.execute({ ...base, operation: 'facebook.oauth.start' });
  await auth.execute({ ...base, operation: 'facebook.oauth.status', flowId: 'flow' });
  await auth.execute({ ...base, operation: 'facebook.oauth.selectPage', flowId: 'flow', pageId: 'page' });
  await auth.execute({ ...base, operation: 'facebook.oauth.cancel', flowId: 'flow' });

  const reconcile = createAccountManagerReconcileHandler(() => manager);
  await reconcile({ ...base, operation: 'sync' });
  await reconcile({ ...base, operation: 'facebook.avatar-import.start' });
  await reconcile({ ...base, operation: 'facebook.avatar-import.status' });
  await reconcile({ ...base, operation: 'facebook.avatar-import.stop' });
  await reconcile({ ...base, operation: 'facebook.avatar-closure.diagnose', limit: 4 });

  assert.equal(calls.length, 19);
  for (const call of calls) {
    const options = [...call.args].reverse().find(value => value && typeof value === 'object' && !Array.isArray(value) && ('signal' in value || 'operationGeneration' in value));
    assert.ok(options, `${call.name} must receive operation options`);
    assert.equal(options.signal, controller.signal, `${call.name} must receive the authoritative signal`);
    assert.equal(options.operationGeneration, generation, `${call.name} must receive the authoritative generation`);
  }
});

test('B28-P0-16 auth and reconcile deadlines quarantine late completions by operation generation', async () => {
  const events = { auth: [], reconcile: [] };
  const onAuth = event => events.auth.push(event);
  const onReconcile = event => events.reconcile.push(event);
  eventBus.on('platform-auth:late-result-quarantined', onAuth);
  eventBus.on('platform-reconcile:late-result-quarantined', onReconcile);
  let resolveAuth;
  let resolveReconcile;
  try {
    const auth = executePortWithDeadline(() => new Promise(resolve => { resolveAuth = resolve; }), {
      kind: 'auth', platform: 'telegram', accountId: 'tg-auth-late', operation: 'telegram.code',
      operationId: 'auth-operation', generation: 'auth-generation', timeoutMs: 1000
    });
    const reconcile = executePortWithDeadline(() => new Promise(resolve => { resolveReconcile = resolve; }), {
      kind: 'reconcile', platform: 'facebook', accountId: 'fb-reconcile-late', operation: 'sync',
      operationId: 'reconcile-operation', generation: 'reconcile-generation', timeoutMs: 1000
    });
    const settled = await Promise.allSettled([auth, reconcile]);
    assert.equal(settled[0].status, 'rejected');
    assert.equal(settled[0].reason.code, 'PLATFORM_AUTH_DEADLINE_EXCEEDED');
    assert.equal(settled[1].status, 'rejected');
    assert.equal(settled[1].reason.code, 'PLATFORM_RECONCILE_DEADLINE_EXCEEDED');
    resolveAuth({ state: 'connected' });
    resolveReconcile({ status: 'ready' });
    await waitFor(() => events.auth.length === 1 && events.reconcile.length === 1);
    assert.equal(events.auth[0].payload.operationGeneration, 'auth-generation');
    assert.equal(events.auth[0].payload.quarantineReason, 'deadline');
    assert.equal(events.auth[0].payload.resultState, 'connected');
    assert.equal(events.reconcile[0].payload.operationGeneration, 'reconcile-generation');
    assert.equal(events.reconcile[0].payload.quarantineReason, 'deadline');
    assert.equal(events.reconcile[0].payload.resultState, 'ready');
  } finally {
    eventBus.off('platform-auth:late-result-quarantined', onAuth);
    eventBus.off('platform-reconcile:late-result-quarantined', onReconcile);
  }
});
