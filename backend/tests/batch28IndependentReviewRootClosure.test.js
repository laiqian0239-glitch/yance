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
const { JobQueue } = require('../services/jobQueue');
const { executeWithDeadline } = require('../services/executionDeadline');
const platformMessagingService = require('../services/platformMessagingService');
const eventBus = require('../services/eventBus');
const { executeEgressWithDeadline, executePortWithDeadline, createAccountManagerAuthHandler, createAccountManagerReconcileHandler } = require('../services/platformAdapterPorts');
const accountStore = require('../services/accountStore');
const platformDrivers = require('../services/platformDriverRegistry');
const { BackgroundJobAuthority, STATES: BG_STATES } = require('../services/backgroundJobAuthority');
const { AsyncOperationLifecycleAuthority, STATES: ASYNC_STATES } = require('../services/asyncOperationLifecycleAuthority');
const { ReplyLearningProjectionRepository } = require('../repositories/replyLearningProjectionRepository');
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

test('B28-P0-01 background takeover is process-fenced, account-scoped, due-aware and cursor-stable', () => {
  const f = fixture('yance-b28-background-');
  let now = Date.parse('2026-07-29T03:00:00.000Z');
  try {
    const livePids = new Set([111, 222]);
    const identities = new Map([[111, 'v2:test:old-process'], [222, 'v2:test:new-process']]);
    const processOptions = { store: f.store, clock: () => now, staleRunningMs: 300_000, pidAlive: pid => livePids.has(pid), capturePidIdentity: pid => identities.get(pid) || '' };
    const oldProcess = new BackgroundJobAuthority({ ...processOptions, processGeneration: 'old-process', pid: 111, processIdentity: identities.get(111) });
    const target = { jobType: 'telegram-message-enrichment', platform: 'telegram', sourceAccountId: 'tg-a', conversationId: 'tg-a:1', entityId: 'm-1', revision: 'v1' };
    const unrelated = { jobType: 'account-avatar-sync', platform: 'telegram', sourceAccountId: 'tg-b', conversationId: 'tg-b:1', entityId: 'c-1', revision: 'v1' };
    assert.equal(oldProcess.begin(target, { maxAttempts: 3 }).acquired, true);
    assert.equal(oldProcess.begin(unrelated, { maxAttempts: 3 }).acquired, true);

    const sameProcess = new BackgroundJobAuthority({ ...processOptions, processGeneration: 'old-process', pid: 111, processIdentity: identities.get(111) });
    assert.equal(sameProcess.recoverInterrupted({ jobType: target.jobType, platform: 'telegram', sourceAccountId: 'tg-a' }).length, 0);

    const restarted = new BackgroundJobAuthority({ ...processOptions, processGeneration: 'new-process', pid: 222, processIdentity: identities.get(222) });
    assert.equal(restarted.begin(target, { maxAttempts: 3 }).acquired, false, 'a different live process must not steal a fresh lease');
    assert.equal(restarted.recoverInterrupted({ jobType: target.jobType, platform: 'telegram', sourceAccountId: 'tg-a', retryDelayMs: 60_000 }).length, 0);
    now += 60 * 60 * 1000;
    assert.equal(restarted.begin(target, { maxAttempts: 3, staleRunningMs: 1_000 }).acquired, false, 'a forward wall-clock jump must not override a live PID identity fence');
    assert.equal(restarted.recoverInterrupted({ jobType: target.jobType, platform: 'telegram', sourceAccountId: 'tg-a', staleRunningMs: 1_000, retryDelayMs: 60_000 }).length, 0);
    livePids.delete(111);
    const recovered = restarted.recoverInterrupted({ jobType: target.jobType, platform: 'telegram', sourceAccountId: 'tg-a', retryDelayMs: 60_000 });
    assert.equal(recovered.length, 1);
    assert.equal(recovered[0].state, BG_STATES.RETRY_WAIT);
    assert.equal(restarted.read(unrelated).state, BG_STATES.RUNNING, 'unrelated job/account must remain owned by old process');
    assert.equal(restarted.snapshot({ jobType: target.jobType, sourceAccountId: 'tg-a', states: [BG_STATES.RETRY_WAIT], dueBefore: new Date(now).toISOString() }).total, 0);
    assert.equal(restarted.snapshot({ jobType: target.jobType, sourceAccountId: 'tg-a', states: [BG_STATES.RETRY_WAIT], dueBefore: new Date(now + 60_001).toISOString() }).total, 1);

    const pageInput = index => ({ jobType: 'paged-recovery', platform: 'telegram', sourceAccountId: 'tg-page', conversationId: 'tg-page:1', entityId: `page-${index}`, revision: 'v1' });
    for (let index = 0; index < 7; index += 1) restarted.enqueue(pageInput(index), { maxAttempts: 2, now });
    const visited = [];
    let cursor = null;
    do {
      const page = restarted.snapshot({ jobType: 'paged-recovery', sourceAccountId: 'tg-page', states: [BG_STATES.PENDING], order: 'oldest', limit: 2, cursor });
      for (const job of page.jobs) {
        visited.push(job.jobId);
        const lease = restarted.begin(pageInput(Number(job.entityId.split('-').pop())), { maxAttempts: 2, now });
        assert.equal(lease.acquired, true);
        assert.equal(restarted.succeed(lease.lease, { ok: true }).updated, true);
      }
      cursor = page.nextCursor;
    } while (cursor);
    assert.equal(new Set(visited).size, 7);
    assert.equal(visited.length, 7);
  } finally { f.close(); }
});

test('B28-P0-02 verified hard-termination exit receipt releases physical slot even when provider promise never settles', async () => {
  const queue = new JobQueue({ concurrency: 1, name: `b28-hard-terminate-${Date.now()}`, maxPhysicalZombiesPerProvider: 1, providerCircuitCooldownMs: 1000 });
  let terminateCalls = 0;
  const first = queue.add(() => new Promise(() => {}), {
    providerKey: 'never-settles-provider', executionTimeoutMs: 25,
    hardTerminate({ jobId }) {
      terminateCalls += 1;
      return { terminated: true, executionId: jobId, exitCode: null, signal: 'SIGTERM' };
    }
  });
  await assert.rejects(first.promise, error => error.code === 'AI_EXECUTION_TIMEOUT');
  for (let index = 0; index < 100 && queue.status().physicalInFlightCount !== 0; index += 1) await delay(5);
  assert.equal(terminateCalls, 1);
  assert.equal(queue.status().physicalInFlightCount, 0);
  assert.equal(queue.status().providerCircuits['never-settles-provider']?.zombies || 0, 0);
  const second = queue.add(async () => 'next-ran', { providerKey: 'independent-provider', executionTimeoutMs: 100 });
  assert.equal(await second.promise, 'next-ran');
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

test('B28-P0-04 send_outcome_unknown uses exact SQL totals beyond 1000 and rejects stale/mismatched convergence', async () => {
  const store = getStore();
  store.db.exec('DELETE FROM r32_send_queue');
  for (const accountId of ['global-origin','account-0','account-1','account-2','account-3']) {
    store.upsertAccount({ id: accountId, accountId, adapterAccountId: accountId, platform: 'telegram', state: 'online', canSend: true, canReceive: true });
    store.upsertConversation({ sessionKey: `${accountId}:peer`, accountId, platform: 'telegram', title: 'peer', routeState: 'bound', chatJid: 'peer', externalId: 'peer' });
  }
  const insert = store.db.prepare(`INSERT INTO r32_send_queue(
    id,idempotency_key,account_id,session_key,message_type,payload_json,state,attempts,next_attempt_at,
    locked_at,last_error,platform_message_id,created_at,updated_at,unknown_scope,unknown_reason,unknown_lane,
    execution_generation,unknown_recorded_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const base = Date.parse('2026-07-29T04:00:00.000Z');
  store.transaction(() => {
    for (let index = 0; index < 1001; index += 1) {
      const id = `unknown-${String(index).padStart(4, '0')}`;
      const accountId = index === 0 ? 'global-origin' : `account-${index % 4}`;
      const scope = index === 0 ? 'global' : (index % 3 === 0 ? 'account' : 'command');
      const at = new Date(base + index).toISOString();
      insert.run(id, id, accountId, `${accountId}:peer`, 'text',
        JSON.stringify({ platform: 'telegram', operation: 'text', accountId, chatJid: 'peer' }),
        'send_outcome_unknown', 0, at, '', 'UNKNOWN', '', at, at, scope, 'DEADLINE',
        `telegram:${accountId}`, `generation-${index}`, at);
    }
  });
  const service = new SendQueueService({
    outcomeAudit: { latest() { return null; } },
    domainEventRepository: {},
    outboxRouteAuthority: { getByConversation() { return null; } }
  });
  const status = service.status();
  assert.equal(status.outcomeUnknown, 1001);
  assert.equal(status.globalOutcomeUnknown, 1);
  assert.equal(status.outcomeUnknownItems.length, 1000);
  assert.equal(status.outcomeUnknownItemsTruncated, true);
  assert.throws(() => service.assertEnqueueAllowed('text', { accountId: 'brand-new-account' }), error => error.code === 'SEND_OUTCOME_UNKNOWN_WRITE_BLOCKED' && error.outcomeUnknown >= 1);

  const row = store.getSendQueueItem('unknown-0001');
  assert.throws(() => store.markSendOutcomeUnknown(row.id, { executionGeneration: 'stale-generation' }), error => error.code === 'SEND_QUEUE_UNKNOWN_GENERATION_STALE');
  const mismatch = await service.handleLateEgressResult({
    platformAccepted: true, commandId: row.id, platformMessageId: 'remote-wrong',
    executionGeneration: row.execution_generation, platform: 'facebook', accountId: 'wrong-account', operation: 'media'
  });
  assert.equal(mismatch.reason, 'identity-mismatch');
  assert.deepEqual(new Set(mismatch.mismatches), new Set(['platform', 'accountId', 'operation', 'sessionKey', 'conversationTarget']));
  const incomplete = await service.handleLateEgressResult({
    platformAccepted: true, commandId: row.id, platformMessageId: 'remote-incomplete',
    executionGeneration: row.execution_generation
  });
  assert.equal(incomplete.reason, 'identity-mismatch');
  assert.deepEqual(new Set(incomplete.mismatches), new Set(['platform', 'accountId', 'operation', 'sessionKey', 'conversationTarget']));
  assert.equal(store.getSendQueueItem(row.id).state, 'send_outcome_unknown');
});

test('B28-P0-12 outcome-unknown crash journal is route/generation fenced before replay', () => {
  const store = getStore();
  store.db.exec('DELETE FROM r32_send_queue');
  const accountId = 'journal-account';
  const sessionKey = 'journal-account:peer';
  store.upsertAccount({ id: accountId, accountId, adapterAccountId: accountId, platform: 'telegram', state: 'online', canSend: true, canReceive: true });
  store.upsertConversation({ sessionKey, accountId, platform: 'telegram', title: 'peer', routeState: 'bound', chatJid: 'peer', externalId: 'peer' });
  const at = '2026-07-29T04:30:00.000Z';
  store.db.prepare(`INSERT INTO outbox_routes(
    outbox_route_id,conversation_id,account_id,platform,external_identity_id,identity_link_id,person_id,
    route_target,state,capability_snapshot_id,payload_json,created_at,updated_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    'route-1', sessionKey, accountId, 'telegram', null, null, null, 'peer', 'active', '', '{}', at, at
  );
  store.db.prepare(`INSERT INTO outbox_route_versions(
    route_version_id,outbox_route_id,conversation_id,account_id,platform,external_identity_id,identity_link_id,person_id,
    route_target,capability_snapshot_id,scope_hash,state,payload_json,created_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    'route-version-1', 'route-1', sessionKey, accountId, 'telegram', '', '', '', 'peer', '',
    'journal-route-scope-hash', 'active', '{}', at
  );
  store.db.prepare(`INSERT INTO r32_send_queue(
    id,idempotency_key,account_id,session_key,message_type,payload_json,state,attempts,next_attempt_at,
    locked_at,last_error,platform_message_id,created_at,updated_at,outbox_route_id,outbox_route_version_id,
    claim_generation,claim_token,row_version,execution_generation
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    'journal-queue', 'journal-queue', accountId, sessionKey, 'text',
    JSON.stringify({ platform: 'telegram', operation: 'text', accountId, chatJid: 'peer' }),
    'sending', 1, at, at, '', '', at, at, 'route-1', 'route-version-1', 3, 'claim-3', 1, 'generation-3'
  );
  const root = path.join(PATHS.tmp, 'send-queue', 'outcome-unknown');
  const corruptRoot = path.join(root, 'corrupt');
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(corruptRoot, { recursive: true });
  const journalFile = path.join(root, 'journal-queue.json');
  fs.writeFileSync(journalFile, JSON.stringify({
    queueId: 'journal-queue', platform: 'telegram', accountId,
    operation: 'media', sessionKey, conversationTarget: 'peer',
    outboxRouteId: 'route-1', outboxRouteVersionId: 'route-version-1',
    unknownScope: 'account', unknownReason: 'NETWORK_TIMEOUT', unknownLane: `telegram:${accountId}`,
    executionGeneration: 'generation-3', claimGeneration: 3, claimToken: 'claim-3'
  }));
  const service = new SendQueueService();
  assert.equal(service.recoverOutcomeUnknownJournals(), 0);
  assert.equal(store.getSendQueueItem('journal-queue').state, 'sending');
  assert.equal(fs.existsSync(journalFile), false);
  assert.equal(fs.readdirSync(corruptRoot).length, 1);

  fs.writeFileSync(journalFile, JSON.stringify({
    queueId: 'journal-queue', platform: 'telegram', accountId,
    operation: 'text', sessionKey, conversationTarget: 'peer',
    outboxRouteId: 'route-1', outboxRouteVersionId: 'route-version-1',
    unknownScope: 'account', unknownReason: 'NETWORK_TIMEOUT', unknownLane: `telegram:${accountId}`,
    executionGeneration: 'generation-3', claimGeneration: 3, claimToken: 'claim-3'
  }));
  assert.equal(service.recoverOutcomeUnknownJournals(), 1);
  const recovered = store.getSendQueueItem('journal-queue');
  assert.equal(recovered.state, 'send_outcome_unknown');
  assert.equal(recovered.execution_generation, 'generation-3');
  fs.rmSync(root, { recursive: true, force: true });
});

test('B28-P0-05 async recovery cursor remains stable while earlier pages become terminal', () => {
  const f = fixture('yance-b28-async-cursor-');
  try {
    let clock = Date.parse('2026-07-29T05:00:00.000Z');
    const authority = new AsyncOperationLifecycleAuthority({ store: f.store, clock: () => clock++ });
    for (let index = 0; index < 9; index += 1) {
      authority.create({ operationId: `async-${index}`, operationType: 'ai.reply.candidates', scopeKey: `scope-${index}`, objectFingerprint: `fingerprint-${index}` });
    }
    const visited = [];
    let cursor = null;
    do {
      const page = authority.snapshot({ operationType: 'ai.reply.candidates', states: [ASYNC_STATES.CREATED], order: 'oldest', limit: 3, cursor });
      for (const operation of page.operations) {
        visited.push(operation.operationId);
        authority.start(operation.operationId);
        authority.succeed(operation.operationId, { ok: true }, { generation: operation.generation, objectFingerprint: operation.objectFingerprint });
      }
      cursor = page.nextCursor;
    } while (cursor);
    assert.equal(visited.length, 9);
    assert.equal(new Set(visited).size, 9);
    assert.equal(authority.snapshot({ operationType: 'ai.reply.candidates', states: [ASYNC_STATES.CREATED, ASYNC_STATES.RUNNING] }).active, 0);
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
    const lifecycle = new AsyncOperationLifecycleAuthority({ store: f.store });
    const created = lifecycle.create({ operationId: taskId, operationType: 'ai.reply.candidates', scopeKey: conversationId, objectFingerprint: 'runtime-fingerprint-v1' });
    const running = lifecycle.start(created.operation.operationId).operation;
    lifecycle.cancel(running.operationId, 'SUPERSEDED', { generation: running.generation, objectFingerprint: running.objectFingerprint });

    await assert.rejects(manager.dispatch({ type: 'AI_REPLY_CANDIDATE_READY', source: 'b28-test', payload: {
      taskId, text: 'late candidate must not commit', conversationId,
      expectedConversationRevision: 1, expectedEntityVersions: {},
      expectedRuntimeGeneration: running.generation,
      expectedRuntimeFingerprint: running.objectFingerprint
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
    const service = new MessageTranslationService({
      storeProvider: () => f.store,
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
    assert.ok(second.generation > first.generation);

    calls[0].resolve({
      sourceText: 'Guten Morgen', sourceLanguage: 'de', translatedZh: '旧结果',
      translationStatus: 'success', translationModel: 'old-provider', translatedAt: '2026-07-29T06:01:00.000Z'
    });
    await waitFor(() => calls.length === 2);
    const pending = f.store.getMessage(messageId);
    assert.notEqual(pending.translatedZh, '旧结果');
    assert.equal(pending.translationStatus, 'pending');
    assert.equal(pending.translationOperationId, second.operationId);
    assert.equal(Number(pending.translationGeneration), Number(second.generation));

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
    assert.equal(Number(saved.translationGeneration), Number(second.generation));
    assert.equal(service.lifecycleAuthority.read(first.operationId, f.store).state, ASYNC_STATES.CANCELLED);
    assert.equal(service.lifecycleAuthority.read(second.operationId, f.store).state, ASYNC_STATES.SUCCEEDED);
    service.close();
  } finally { f.close(); }
});

test('B28-P0-09 translation restart recovery atomically fails pending message and active lifecycle generation', () => {
  const f = fixture('yance-b28-translation-recovery-');
  try {
    const { messageId } = seedTranslationMessage(f.store, 'translation-recovery');
    const message = f.store.getMessage(messageId);
    const sourceHash = translationSourceHash(message.text);
    const fingerprint = translationWorkKey(message, message.text);
    const lifecycle = new AsyncOperationLifecycleAuthority({ store: f.store });
    const created = lifecycle.create({
      operationId: 'translation-restart-operation', operationType: 'translation.message',
      scopeKey: messageId, objectFingerprint: fingerprint
    }).operation;
    const running = lifecycle.start(created.operationId, { progress: 35 }).operation;
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
      lifecycleAuthority: lifecycle,
      contactLanguageAuthority: { observeMessage() {} },
      logger: { info() {}, warn() {} }
    });
    const report = service.recoverInterruptedTranslations({ pageLimit: 1 });
    assert.equal(report.scanned, 1);
    assert.equal(report.messageFailed, 1);
    assert.equal(report.lifecycleFailed, 1);
    assert.equal(report.errors.length, 0);
    const recovered = f.store.getMessage(messageId);
    assert.equal(recovered.translationStatus, 'failed');
    assert.equal(recovered.translationErrorCode, 'PROCESS_RESTARTED_TRANSLATION_INTERRUPTED');
    assert.equal(lifecycle.read(running.operationId).state, ASYNC_STATES.FAILED);
  } finally { f.close(); }
});

test('B28-P1-01 learning ledger separates ready, active, deferred retry and DLQ exactly', () => {
  const f = fixture('yance-b28-learning-ledger-');
  try {
    const repository = new ReplyLearningProjectionRepository({ store: f.store });
    f.store.upsertAccount({ id: 'learn-account', accountId: 'learn-account', adapterAccountId: 'learn-account', platform: 'telegram', state: 'online', canSend: true, canReceive: true });
    f.store.upsertContact({ id: 'contact', accountId: 'learn-account', platform: 'telegram', externalId: 'learn-contact', canonicalContactId: 'contact', displayName: 'Learning Contact' });
    const now = Date.now();
    const insert = f.store.db.prepare(`INSERT INTO reply_learning_projection_jobs(
      job_id,evidence_id,contact_id,conversation_id,state,scope_state,l1_state,attempts,claim_token,
      lease_expires_at,next_attempt_at,last_error,payload_json,created_at,updated_at,completed_at,
      lease_generation,last_heartbeat_at,final_failure_code,dlq_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const rows = [
      ['learn-pending','ev-pending','contact','pending','', '', ''],
      ['learn-processing','ev-processing','contact','processing','', '', ''],
      ['learn-retry-due','ev-retry-due','contact','retry',new Date(now - 1_000).toISOString(), '', ''],
      ['learn-retry-future','ev-retry-future','contact','retry',new Date(now + 60_000).toISOString(), '', ''],
      ['learn-failed','ev-failed','contact','failed','', 'POISON_RECORD', new Date(now).toISOString()]
    ];
    const insertEvidence = f.store.db.prepare(`INSERT INTO ai_reply_feedback_events(id,event_type,contact_id,created_at) VALUES(?,?,?,?)`);
    f.store.transaction(() => {
      rows.forEach((row, index) => insertEvidence.run(row[1], 'accepted', row[2], new Date(now + index).toISOString()));
      rows.forEach((row, index) => {
      const at = new Date(now + index).toISOString();
        insert.run(row[0], row[1], row[2], '', row[3], 'pending', 'pending', 0, '', '', row[4], '', '{}',
          at, at, '', 0, '', row[5], row[6]);
      });
    });
    const ledger = repository.ledger();
    assert.equal(ledger.pending, 1);
    assert.equal(ledger.processing, 1);
    assert.equal(ledger.retry, 2);
    assert.equal(ledger.retryDue, 1);
    assert.equal(ledger.retryDeferred, 1);
    assert.equal(ledger.ready, 2);
    assert.equal(ledger.active, 1);
    assert.equal(ledger.unresolved, 4);
    assert.equal(ledger.deadLetter, 1);
    assert.equal(ledger.totalUnfinished, 5);
    assert.equal(ledger.oldestReadyAt, new Date(now).toISOString());
    assert.equal(ledger.oldestUnresolvedAt, new Date(now).toISOString());
    assert.equal(ledger.oldestDeadLetterAt, new Date(now + 4).toISOString());

    const insertSource = f.store.db.prepare(`INSERT INTO reply_learning_source_reconciliation(
      source_key,source_type,source_entity_id,state,attempts,next_attempt_at,last_error,final_failure_code,
      dlq_at,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`);
    f.store.transaction(() => {
      insertSource.run('sent:due', 'sent', 'due', 'retry', 1, new Date(now - 1_000).toISOString(), 'TEMP', '', '', new Date(now + 10).toISOString(), new Date(now + 10).toISOString());
      insertSource.run('sent:future', 'sent', 'future', 'retry', 1, new Date(now + 60_000).toISOString(), 'TEMP', '', '', new Date(now + 11).toISOString(), new Date(now + 11).toISOString());
      insertSource.run('sent:done', 'sent', 'done', 'completed', 0, '', '', '', '', new Date(now + 12).toISOString(), new Date(now + 12).toISOString());
      insertSource.run('sent:poison', 'sent', 'poison', 'dead_letter', 8, '', 'POISON', 'POISON', new Date(now + 13).toISOString(), new Date(now + 13).toISOString(), new Date(now + 13).toISOString());
    });
    const sourceLedger = repository.sourceLedger();
    assert.equal(sourceLedger.retryable, 2);
    assert.equal(sourceLedger.retryDue, 1);
    assert.equal(sourceLedger.retryDeferred, 1);
    assert.equal(sourceLedger.unresolved, 2);
    assert.equal(sourceLedger.completed, 1);
    assert.equal(sourceLedger.deadLetter, 1);
    assert.equal(sourceLedger.oldestDueAt, new Date(now + 10).toISOString());
    assert.equal(sourceLedger.oldestDeadLetterAt, new Date(now + 13).toISOString());
  } finally { f.close(); }
});


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
        assert.equal(owner.dbPath, path.resolve(dbPath));
        assert.equal(owner.store.dbPath, path.resolve(dbPath));
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
