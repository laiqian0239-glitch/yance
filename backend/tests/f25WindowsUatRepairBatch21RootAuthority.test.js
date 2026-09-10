'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-batch21-root-authority-'));
process.env.YANCE_DATA_DIR = dataRoot;
process.env.YANCE_TEST_ONLY_SQLITE_BROKER_RESET = '1';
process.env.YANCE_TEST_ONLY_RUNTIME_RESET = '1';

const { acquireAuthorityWriteHost } = require('../services/authorityWriteHost');
const {
  createSqliteConnectionBroker,
  getSqliteConnectionBroker,
  resetSqliteConnectionBrokerForTests
} = require('../lib/sqliteConnectionBroker');

const dbPath = path.join(dataRoot, 'store', 'yance-r32.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const authorityWriteHost = acquireAuthorityWriteHost({
  dbPath,
  instanceId: `f25-batch21-root-authority-${process.pid}`
});
createSqliteConnectionBroker({
  dbPath,
  authorityWriteHostCapability: authorityWriteHost.capability
});
const { AppRuntimeFactory } = require('../runtime/AppRuntimeFactory');
const runtimeAuthorityStore = getSqliteConnectionBroker().open();
const appRuntime = AppRuntimeFactory.create({
  ownership: { guard: () => ({ ownerInstanceId: 'f25-batch21-root-authority-owner', fencingToken: 1 }) },
  store: {
    db: runtimeAuthorityStore.db,
    snapshot: () => ({
      stateVersion: 1,
      lastEventSequence: 0,
      runtime: { operatingMode: 'normal', operatingModeRevision: 1 },
      capabilities: {},
      diagnosticsSummary: {}
    })
  },
  lifecycle: { state: 'runtime_state_ready' },
  buildId: 'f25-batch21-root-authority-test',
  authorityWriteHostCapability: authorityWriteHost.capability,
  authorityStore: runtimeAuthorityStore
});
appRuntime.configureProductionServices();

const { R32SqliteStore } = require('../lib/r32SqliteStore');
const { createPlatformCoreRepository } = require('../repositories/platformCoreRepository');
const { PlatformDeliveryAuthority, capabilityIdForCommand, isEmojiOnly, ACK_TTL_MS } = require('../services/platformDeliveryAuthority');
const asyncOperationLifecycleAuthority = require('../services/asyncOperationLifecycleAuthority');
const { PlatformAdapterFacade } = require('../services/platformAdapterPorts');
const messageStore = require('../services/messageStore');
const identityLinkAuthority = messageStore._identityLinkAuthority;
const accountRepository = require('../repositories/accountRepository');
const { getStore, closeStore } = require('../repositories/storeProvider');

function tempStore(prefix = 'yance-batch21-isolated-') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const store = new R32SqliteStore({ dbPath: path.join(root, 'database', 'yance.db') });
  return { store, close() { try { store.close(); } catch (_) {} fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); } };
}

function persistedEgressAttempt(platform, command, suffix = '1') {
  return Object.freeze({
    executionId: `${platform}-execution-${suffix}`,
    intentId: `${platform}-intent-${suffix}`,
    attemptId: `${platform}-attempt-${suffix}`,
    claimId: `${platform}-claim-${suffix}`,
    ownerId: `${platform}-owner-${suffix}`,
    idempotencyKey: command.idempotencyKey,
    requestContentSha256: 'a'.repeat(64),
    generation: 3,
    hostGeneration: 7,
    fencingToken: 11,
    platform,
    accountReference: command.accountId
  });
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
  try { AppRuntimeFactory.resetForTests(); } catch (_) {}
  try { resetSqliteConnectionBrokerForTests(); } catch (_) {}
  try { authorityWriteHost.close(); } catch (_) {}
  fs.rmSync(dataRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  delete process.env.YANCE_TEST_ONLY_SQLITE_BROKER_RESET;
  delete process.env.YANCE_TEST_ONLY_RUNTIME_RESET;
});

test('async lifecycle compatibility facade exposes no retired SQL writer constructor', () => {
  assert.equal(typeof asyncOperationLifecycleAuthority.AsyncOperationLifecycleAuthority, 'undefined');
  assert.equal(typeof asyncOperationLifecycleAuthority.recoverDurableExecutions, 'function');
  assert.equal(asyncOperationLifecycleAuthority.STATES.SUPERSEDED, 'SUPERSEDED');
  assert.equal(asyncOperationLifecycleAuthority.TERMINAL.has('SUPERSEDED'), true);
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
      egressAuthorizer: async () => ({ authorized: true, queueId: 'text-2' }),
      egressHandler: async () => ({ success: true, platformMessageId: 'fb-mid-text-2', requestId: 'provider-request-2' })
    });
    const command = {
      commandType: 'OutboxCommand', commandId: 'text-2', outboxId: 'text-2', idempotencyKey: 'idem-text-2',
      platform: 'facebook', accountId: 'page-1', sessionKey: 'page-1:peer', conversationTarget: 'peer',
      operation: 'text', finalText: 'Guten Morgen', finalTextSha256: 'x', contentFrozen: true
    };
    const result = await facade.egress.execute(
      command,
      persistedEgressAttempt('facebook', command, 'delivery')
    );
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

test('OpenRouter logical smoke records real chat-completion receipt without old async lifecycle', async () => {
  const smoke = require('../services/openRouterOnboardingSmokeService');
  const state = {
    models: [
      { id: 'or-primary', name: 'provider/model-primary', source: 'openrouter-auto', available: true },
      { id: 'or-fallback', name: 'provider/model-fallback', source: 'openrouter-auto', available: true }
    ],
    openRouter: { keyFingerprint: 'sha256:test-key' }
  };
  const smokeRecords = [];
  let snapshot = null;
  const registry = {
    read: () => state,
    async recordOpenRouterOnboardingSmoke(modelId, receipt) { smokeRecords.push({ modelId, receipt }); },
    async recordOpenRouterSnapshot(input) { snapshot = input; }
  };
  const calls = [];
  const aiGateway = {
    async execute(input) {
      calls.push(input);
      return {
        text: 'YANCE_MODEL_BRAIN_OK',
        evidence: { selectedModel: input.modelId, requestId: `request-${input.modelId}`, provider: 'openrouter' }
      };
    }
  };
  const result = await smoke.run({ registry, aiGateway, snapshot: { selections: {} } });
  assert.equal(result.pass, true);
  assert.equal(result.passedModelId, 'or-primary');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].task, 'probe');
  assert.equal(smokeRecords.length, 1);
  assert.equal(smokeRecords[0].receipt.requestId, 'request-or-primary');
  assert.equal(snapshot.logicalModelBrainSmoke, true);
  assert.equal(snapshot.qualificationStatus, 'pending');
});


test('renderer treats realtime message events as SQLite invalidations instead of a second message authority', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../frontend/js/r32-ui-runtime.js'), 'utf8');
  assert.doesNotMatch(source, /rows\.push\(translated\)/u);
  assert.match(source, /Realtime events only invalidate the SQLite projection/u);
  assert.match(source, /mediaPatchReloadCoordinator\?\.schedule\?\.\('message:translation-updated'\)/u);
});
