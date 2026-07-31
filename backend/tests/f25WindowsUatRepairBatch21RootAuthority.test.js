'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-batch21-root-authority-'));
process.env.YANCE_DATA_DIR = dataRoot;

const { R32SqliteStore } = require('../lib/r32SqliteStore');
const { createPlatformCoreRepository } = require('../repositories/platformCoreRepository');
const { PlatformDeliveryAuthority, capabilityIdForCommand, isEmojiOnly, ACK_TTL_MS } = require('../services/platformDeliveryAuthority');
const { AsyncOperationLifecycleAuthority, STATES } = require('../services/asyncOperationLifecycleAuthority');
const { PlatformAdapterFacade } = require('../services/platformAdapterPorts');
const messageStore = require('../services/messageStore');
const identityLinkAuthority = messageStore._identityLinkAuthority;
const accountRepository = require('../repositories/accountRepository');
const { getStore, closeStore } = require('../repositories/storeProvider');

function tempStore(prefix = 'yance-batch21-isolated-') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const store = new R32SqliteStore({ dbPath: path.join(root, 'database', 'yance.db') });
  return { store, close() { try { store.close(); } catch (_) {} fs.rmSync(root, { recursive: true, force: true }); } };
}

function inboundMessage(id, overrides = {}) {
  return {
    id,
    externalMessageId: id,
    dedupeKey: id,
    platform: 'facebook',
    accountId: 'page-batch21',
    sourceAccountId: 'page-batch21',
    pageScopedUserId: 'psid-batch21',
    contactExternalId: 'psid-batch21',
    chatJid: 'facebook:psid-batch21',
    conversationId: 'page-batch21:psid-batch21',
    direction: 'inbound',
    fromMe: false,
    sender: 'psid-batch21',
    contactId: 'contact-batch21',
    contactName: 'Batch 21 Test',
    text: 'Hallo',
    type: 'text',
    timestamp: '2026-07-28T08:00:00.000Z',
    ...overrides
  };
}

test.after(() => {
  try { closeStore(); } catch (_) {}
  fs.rmSync(dataRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

test('async lifecycle supersedes old generations and rejects stale completion writeback', () => {
  const fixture = tempStore();
  try {
    let clock = Date.parse('2026-07-28T08:00:00.000Z');
    const authority = new AsyncOperationLifecycleAuthority({ store: fixture.store, clock: () => clock });
    const first = authority.create({ operationId: 'op-first', operationType: 'ai.reply.candidates', scopeKey: 'conversation-1', objectFingerprint: 'revision-1' }).operation;
    authority.start(first.operationId);
    clock += 1000;
    const second = authority.create({ operationId: 'op-second', operationType: 'ai.reply.candidates', scopeKey: 'conversation-1', objectFingerprint: 'revision-2' }).operation;
    assert.equal(authority.read(first.operationId).state, STATES.SUPERSEDED);
    authority.start(second.operationId);
    const stale = authority.succeed(first.operationId, { text: 'old' }, { generation: first.generation, objectFingerprint: first.objectFingerprint });
    assert.equal(stale.updated, false);
    assert.equal(stale.reason, 'stale-completion');
    const current = authority.succeed(second.operationId, { text: 'current' }, { generation: second.generation, objectFingerprint: second.objectFingerprint });
    assert.equal(current.updated, true);
    assert.equal(current.operation.state, STATES.SUCCEEDED);
    assert.equal(authority.latest({ operationType: 'ai.reply.candidates', scopeKey: 'conversation-1' }).operationId, 'op-second');
  } finally { fixture.close(); }
});

test('delivery authority separates text, emoji and media capability truth by real platform ACK', async () => {
  const fixture = tempStore();
  try {
    let clock = new Date('2026-07-28T08:00:00.000Z');
    const repository = createPlatformCoreRepository({ storeProvider: () => fixture.store });
    const delivery = new PlatformDeliveryAuthority({ repository, clock: () => clock });
    assert.equal(isEmojiOnly('🌹'), true);
    assert.equal(isEmojiOnly('Hallo 🌹'), false);
    assert.equal(capabilityIdForCommand({ operation: 'text', finalText: '🌹' }), 'message.emoji.send');
    assert.equal(capabilityIdForCommand({ operation: 'media', messageType: 'image' }), 'message.media.image.send');

    delivery.recordSuccess({ platform: 'facebook', accountId: 'page-1', commandId: 'text-1', operation: 'text', finalText: 'Hallo' }, { platformMessageId: 'fb-mid-text-1' });
    clock = new Date(clock.getTime() + 1000);
    delivery.recordFailure({ platform: 'facebook', accountId: 'page-1', commandId: 'emoji-1', operation: 'text', finalText: '🌹' }, { code: 'FACEBOOK_EMOJI_REJECTED', message: 'emoji-only rejected' });
    clock = new Date(clock.getTime() + 1000);
    delivery.recordSuccess({ platform: 'facebook', accountId: 'page-1', commandId: 'image-1', operation: 'media', messageType: 'image' }, { platformMessageId: 'fb-mid-image-1' });

    const truth = delivery.accountTruth({ platform: 'facebook', accountId: 'page-1' });
    assert.equal(truth.sendVerified, true);
    assert.equal(truth.capabilities['message.text.send'].availability, 'ready');
    assert.equal(truth.capabilities['message.emoji.send'].availability, 'blocked');
    assert.equal(truth.capabilities['message.media.image.send'].availability, 'ready');

    const facade = new PlatformAdapterFacade('facebook', {
      deliveryAuthority: delivery,
      operationLifecycle: new AsyncOperationLifecycleAuthority({ store: fixture.store }),
      egressAuthorizer: async () => ({ authorized: true, queueId: 'text-2' }),
      egressHandler: async () => ({ success: true, platformMessageId: 'fb-mid-text-2', requestId: 'provider-request-2' })
    });
    const result = await facade.egress.execute({
      commandType: 'OutboxCommand', commandId: 'text-2', outboxId: 'text-2', idempotencyKey: 'idem-text-2',
      platform: 'facebook', accountId: 'page-1', sessionKey: 'page-1:peer', conversationTarget: 'peer',
      operation: 'text', finalText: 'Guten Morgen', finalTextSha256: 'x', contentFrozen: true
    });
    assert.equal(result.deliveryCapabilityId, 'message.text.send');
    assert.ok(result.deliveryAckObservationId);

    clock = new Date(clock.getTime() + ACK_TTL_MS + 1);
    assert.equal(delivery.accountTruth({ platform: 'facebook', accountId: 'page-1' }).sendVerified, false);
  } finally { fixture.close(); }
});

test('identity failure rolls back message, conversation, person and bindings as one transaction', async t => {
  const store = getStore();
  await accountRepository.create({ id: 'page-batch21', adapterAccountId: 'page-batch21', platform: 'facebook', displayName: 'Batch 21 Page' });
  const original = identityLinkAuthority.observeWithinTransaction.bind(identityLinkAuthority);
  identityLinkAuthority.observeWithinTransaction = function forcedFailure(input, repo) {
    original(input, repo);
    const error = new Error('forced identity transaction failure');
    error.code = 'FORCED_IDENTITY_TRANSACTION_FAILURE';
    throw error;
  };
  t.after(() => { identityLinkAuthority.observeWithinTransaction = original; });

  const result = await messageStore.upsert(inboundMessage('batch21-atomic-failure'));
  assert.equal(result.committed, true);
  assert.equal(result.projectionStatus, 'pending');
  assert.equal(result.repairRequired, true);
  assert.equal(result.failure?.code, 'FORCED_IDENTITY_TRANSACTION_FAILURE');
  assert.equal(store.db.prepare("SELECT state FROM domain_event_projection_jobs WHERE event_id=?").get(result.eventId).state, 'failed');
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM r32_messages WHERE id=?').get('batch21-atomic-failure').count, 0);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM r32_conversations WHERE session_key=?').get('page-batch21:psid-batch21').count, 0);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM persons').get().count, 0);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM identity_links').get().count, 0);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM conversation_bindings').get().count, 0);
});

test('successful inbound commit hydrates canonical identity and account route from SQLite authority', async () => {
  const store = getStore();
  identityLinkAuthority.observeWithinTransaction = Object.getPrototypeOf(identityLinkAuthority).observeWithinTransaction.bind(identityLinkAuthority);
  const saved = await messageStore.upsert(inboundMessage('batch21-atomic-success'));
  assert.equal(saved.message.id, 'batch21-atomic-success');
  const messageRow = store.db.prepare('SELECT * FROM r32_messages WHERE id=?').get(saved.message.id);
  const conversationRow = store.db.prepare('SELECT * FROM r32_conversations WHERE session_key=?').get('page-batch21:psid-batch21');
  const identityRow = store.db.prepare('SELECT * FROM identity_links LIMIT 1').get();
  const bindingRow = store.db.prepare("SELECT * FROM conversation_bindings WHERE conversation_id=? AND state='active'").get('page-batch21:psid-batch21');
  assert.ok(messageRow);
  assert.ok(conversationRow?.person_id);
  assert.equal(bindingRow.person_id, conversationRow.person_id);
  assert.equal(identityRow.person_id, conversationRow.person_id);
  assert.equal(bindingRow.account_id, 'page-batch21');

  const state = accountRepository.read();
  assert.equal(state.bindings['page-batch21:psid-batch21'].authority, 'r32_conversations');
  assert.equal(state.bindings['page-batch21:psid-batch21'].accountId, 'page-batch21');
  await assert.rejects(() => accountRepository.bindConversation('nonexistent-shell', 'page-batch21', 'facebook'), error => error.code === 'CONVERSATION_BINDING_REQUIRES_PERSISTED_CONVERSATION');
});

test('OpenRouter dual-model smoke writes one durable lifecycle and applies routes only after 2/2 real-call results', async () => {
  const fixture = tempStore('yance-batch21-openrouter-');
  try {
    const lifecycle = new AsyncOperationLifecycleAuthority({ store: fixture.store });
    const smoke = require('../services/openRouterOnboardingSmokeService');
    const state = {
      models: [
        { id: 'or-primary', name: 'provider/model-primary', source: 'openrouter-auto', available: true },
        { id: 'or-fallback', name: 'provider/model-fallback', source: 'openrouter-auto', available: true }
      ],
      openRouter: { keyFingerprint: 'sha256:test-key' }
    };
    let routesApplied = 0;
    const registry = {
      read: () => state,
      async recordInvocation() {}, async recordReplyBrainBenchmark() {}, async recordCommercialBenchmark() {},
      async recordTest() {}, async recordOpenRouterOnboardingSmoke() {}, async recordInvocationFailure() {},
      async applyOpenRouterConditionalRoutes(routes) { routesApplied += 1; state.routes = routes; return { routes }; }
    };
    const executeModel = async model => ({
      text: JSON.stringify({
        director: { goal: '自然回应', strategy: '轻松推进', avoid: ['虚构事实'] },
        candidates: [
          { text: 'Hallo, schön von dir zu hören. Wie war dein Tag?', translationZh: '你好，很高兴收到你的消息。你今天过得怎么样？', direction: '自然' },
          { text: 'Nur ein Hallo? Jetzt bin ich neugierig auf dich.', translationZh: '只有一句你好？现在我对你有点好奇了。', direction: '俏皮' },
          { text: 'Hallo. Erzähl mir etwas, das dich heute zum Lächeln gebracht hat.', translationZh: '你好。告诉我一件今天让你微笑的事吧。', direction: '推进' }
        ],
        translationZh: '你好', fabricatedFacts: []
      }),
      returnedModel: model.name, totalMs: 42, firstTokenMs: 10, promptTokens: 120, outputTokens: 80, totalTokens: 200,
      raw: { id: `request-${model.id}` }, requestMode: 'json'
    });
    const result = await smoke.run({ registry, operationLifecycle: lifecycle, executeModel, snapshot: { selections: {} } });
    assert.equal(result.pass, true);
    assert.equal(result.results.length, 2);
    assert.equal(routesApplied, 1);
    const operation = lifecycle.read(result.operationId);
    assert.equal(operation.state, STATES.SUCCEEDED);
    assert.equal(operation.result.passed, 2);
    assert.equal(operation.result.total, 2);
  } finally { fixture.close(); }
});


test('renderer treats realtime message events as SQLite invalidations instead of a second message authority', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../frontend/js/r32-ui-runtime.js'), 'utf8');
  assert.doesNotMatch(source, /rows\.push\(translated\)/u);
  assert.match(source, /Realtime events only invalidate the SQLite projection/u);
  assert.match(source, /mediaPatchReloadCoordinator\?\.schedule\?\.\('message:translation-updated'\)/u);
});
