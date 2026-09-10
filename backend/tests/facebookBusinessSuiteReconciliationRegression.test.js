'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-facebook-business-suite-'));
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
  instanceId: `facebook-business-suite-reconciliation-${process.pid}`
});
createSqliteConnectionBroker({
  dbPath,
  authorityWriteHostCapability: authorityWriteHost.capability
});
const { AppRuntimeFactory } = require('../runtime/AppRuntimeFactory');
const runtimeAuthorityStore = getSqliteConnectionBroker().open();
const appRuntime = AppRuntimeFactory.create({
  ownership: { guard: () => ({ ownerInstanceId: 'facebook-business-suite-reconciliation-owner', fencingToken: 1 }) },
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
  buildId: 'facebook-business-suite-reconciliation-test',
  authorityWriteHostCapability: authorityWriteHost.capability,
  authorityStore: runtimeAuthorityStore
});
appRuntime.configureProductionServices();

const facebookModule = require('../services/facebookAdapter');
const messageStore = require('../services/messageStore');
const notificationPolicy = require('../services/notificationPolicy');
const eventBus = require('../services/eventBus');
const relayClient = require('../services/facebookRelayClient');
const { getStore, closeStore } = require('../repositories/storeProvider');

const { FacebookAdapter, facebookContactId, webhookPeerId, retrySqliteBusy } = facebookModule;

test.after(() => {
  try { closeStore(); } catch (_) {}
  try { AppRuntimeFactory.resetForTests(); } catch (_) {}
  try { resetSqliteConnectionBrokerForTests(); } catch (_) {}
  try { authorityWriteHost.close(); } catch (_) {}
  fs.rmSync(dataRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  delete process.env.YANCE_TEST_ONLY_SQLITE_BROKER_RESET;
  delete process.env.YANCE_TEST_ONLY_RUNTIME_RESET;
});

function patch(t, object, key, value) {
  const original = object[key];
  object[key] = value;
  t.after(() => { object[key] = original; });
}

function ensureFacebookPlatformAccount(accountId, pageId = '') {
  getStore().upsertAccount({
    id: accountId, accountId, adapterAccountId: accountId, platform: 'facebook', state: 'online',
    displayName: accountId, canSend: false, canReceive: true, payload: { pageId }
  });
}

function facebookAccount(overrides = {}) {
  return {
    id: 'facebook-business-suite',
    platform: 'facebook',
    credentialRef: 'credential:facebook-business-suite',
    displayName: '公共主页',
    metadata: { pageId: 'page-10001' },
    ...overrides
  };
}

function frozenFacebookAttempt(overrides = {}) {
  return Object.freeze({
    executionId: 'facebook-physical-execution-1',
    attemptId: 'facebook-physical-attempt-1',
    claimId: 'facebook-physical-claim-1',
    ownerId: 'facebook-physical-owner-1',
    generation: 1,
    hostGeneration: 1,
    fencingToken: 1,
    state: 'RUNNING',
    platform: 'facebook',
    operationKind: 'OUTBOUND_MESSAGE_SEND',
    ...overrides
  });
}

test('Business Suite reconciliation retries a transient SQLite transaction owner conflict before failing a conversation', async () => {
  let attempts = 0;
  const result = await retrySqliteBusy('history-message-upsert', async () => {
    attempts += 1;
    if (attempts < 3) {
      const error = new Error('SQLite transaction is owned by another asynchronous context');
      error.code = 'SQLITE_TRANSACTION_BUSY_CONTEXT';
      throw error;
    }
    return { inserted: true };
  }, { attempts: 3, baseDelayMs: 1 });
  assert.deepEqual(result, { inserted: true });
  assert.equal(attempts, 3);
});

test('Facebook peer resolution always selects the non-Page participant for inbound and echo events', () => {
  assert.equal(webhookPeerId({ sender: { id: 'psid-1' }, recipient: { id: 'page-1' } }, 'page-1', false), 'psid-1');
  assert.equal(webhookPeerId({ sender: { id: 'page-1' }, recipient: { id: 'psid-1' } }, 'page-1', true), 'psid-1');
  assert.equal(webhookPeerId({ sender: { id: 'page-1' }, recipient: { id: 'psid-1' } }, 'page-1', false), 'psid-1');
  assert.equal(webhookPeerId({ sender: { id: 'page-1' }, recipient: { id: 'page-1' } }, 'page-1', true), '');
});

test('unknown Facebook first message atomically creates account-scoped contact, conversation and message identity', async () => {
  const accountId = 'facebook-atomic-account';
  const pageId = 'page-atomic';
  const psid = 'psid-atomic-new';
  const conversationId = `${accountId}:${psid}`;
  const contactId = facebookContactId(accountId, psid);
  ensureFacebookPlatformAccount(accountId, pageId);

  const result = await messageStore.upsert({
    id: 'mid-atomic-1',
    externalMessageId: 'mid-atomic-1',
    dedupeKey: `${accountId}:${psid}:mid-atomic-1`,
    accountId,
    sourceAccountId: accountId,
    platform: 'facebook',
    pageId,
    pageScopedUserId: psid,
    contactExternalId: psid,
    contactId,
    chatJid: `facebook:${psid}`,
    conversationId,
    direction: 'inbound',
    fromMe: false,
    sender: psid,
    contactName: 'Sassi Gasmi',
    text: 'Hello from a new Business Suite thread',
    type: 'text',
    timestamp: '2026-07-22T13:38:00.000Z',
    source: 'facebook-webhook'
  });

  assert.equal(result.inserted, true);
  const store = getStore();
  const contact = store.db.prepare('SELECT * FROM contacts WHERE id=?').get(contactId);
  const conversation = store.db.prepare('SELECT * FROM r32_conversations WHERE session_key=?').get(conversationId);
  const message = store.db.prepare('SELECT * FROM r32_messages WHERE id=?').get(`${accountId}:${psid}:mid-atomic-1`);
  assert.ok(contact, 'first event must create a contact row');
  assert.ok(conversation, 'first event must create a conversation row');
  assert.ok(message, 'first event must create a message row');
  assert.equal(contact.account_id, accountId);
  assert.equal(contact.external_id, psid);
  assert.equal(contact.display_name, 'Sassi Gasmi');
  assert.equal(conversation.account_id, accountId);
  assert.equal(conversation.contact_id, contactId);
  assert.equal(conversation.platform, 'facebook');
  const contactPayload = JSON.parse(contact.payload_json);
  const conversationPayload = JSON.parse(conversation.payload_json);
  assert.equal(contactPayload.pageId, pageId);
  assert.equal(contactPayload.sourceAccountId, accountId);
  assert.equal(contactPayload.pageScopedUserId, psid);
  assert.equal(conversationPayload.pageId, pageId);
  assert.equal(conversationPayload.sourceAccountId, accountId);
  assert.equal(conversationPayload.pageScopedUserId, psid);
});

test('Facebook contact refresh preserves existing tags while adding external conversation identity', async () => {
  const accountId = 'facebook-preserve-account';
  const psid = 'psid-preserve';
  const contactId = facebookContactId(accountId, psid);
  const conversationId = `${accountId}:${psid}`;
  ensureFacebookPlatformAccount(accountId, 'page-preserve');
  await messageStore.upsert({
    externalMessageId: 'mid-preserve-1', dedupeKey: 'dedupe-preserve-1', accountId, platform: 'facebook',
    pageId: 'page-preserve', pageScopedUserId: psid, contactExternalId: psid, contactId,
    chatJid: `facebook:${psid}`, conversationId, direction: 'inbound', fromMe: false,
    contactName: 'Tagged Contact', text: 'first', timestamp: '2026-07-22T13:39:00.000Z', source: 'facebook-webhook'
  });
  const store = getStore();
  store.db.prepare("UPDATE contacts SET tags_json='[\"vip\"]', aliases_json='[\"Sassi\"]' WHERE id=?").run(contactId);

  await messageStore.upsert({
    externalMessageId: 'mid-preserve-2', dedupeKey: 'dedupe-preserve-2', accountId, platform: 'facebook',
    pageId: 'page-preserve', pageScopedUserId: psid, contactExternalId: psid, contactId,
    externalConversationId: 't_external_thread_1', chatJid: `facebook:${psid}`, conversationId,
    direction: 'outbound', fromMe: true, contactName: 'Tagged Contact', text: 'reply',
    timestamp: '2026-07-22T13:40:00.000Z', source: 'facebook-history-periodic-reconciliation', historical: true
  });

  const contact = store.db.prepare('SELECT tags_json,aliases_json,payload_json FROM contacts WHERE id=?').get(contactId);
  assert.deepEqual(JSON.parse(contact.tags_json), ['vip']);
  assert.deepEqual(JSON.parse(contact.aliases_json), ['Sassi']);
  assert.equal(JSON.parse(contact.payload_json).externalConversationId, 't_external_thread_1');
});

test('local outbound send and later Business Suite echo with the same Meta message id remain one SQLite row', async () => {
  const accountId = 'facebook-echo-dedupe';
  const psid = 'psid-echo-dedupe';
  const conversationId = `${accountId}:${psid}`;
  const common = {
    accountId, sourceAccountId: accountId, platform: 'facebook', pageId: 'page-echo',
    pageScopedUserId: psid, contactExternalId: psid, contactId: facebookContactId(accountId, psid),
    chatJid: `facebook:${psid}`, conversationId, direction: 'outbound', fromMe: true,
    contactName: 'Echo Contact', text: 'same reply', timestamp: '2026-07-22T13:41:00.000Z'
  };
  await messageStore.upsert({ ...common, dedupeKey: 'local-message-row-1', externalMessageId: 'mid-meta-echo-1', source: 'facebook-send' });
  await messageStore.upsert({ ...common, dedupeKey: `${accountId}:${psid}:mid-meta-echo-1`, externalMessageId: 'mid-meta-echo-1', source: 'facebook-webhook' });

  const rows = getStore().db.prepare(`SELECT id,payload_json FROM r32_messages WHERE account_id=? AND json_extract(payload_json,'$.externalMessageId')=?`).all(accountId, 'mid-meta-echo-1');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 'local-message-row-1');
  assert.equal(JSON.parse(rows[0].payload_json).fromMe, true);
});

test('Business Suite outbound echo creates a new contact/conversation and is stored as own message', async t => {
  const adapter = new FacebookAdapter();
  const account = facebookAccount({ id: 'facebook-business-suite-echo' });
  patch(t, adapter, 'senderProfile', async () => ({ name: 'Sassi Gasmi', avatarUrl: '' }));
  patch(t, notificationPolicy, 'notify', () => { throw new Error('outbound echo must not notify as inbound'); });
  let persistedEvent = null;
  const onPersisted = event => { if (event.payload?.accountId === account.id) persistedEvent = event.payload; };
  eventBus.on('facebook:webhook-message-persisted', onPersisted);
  t.after(() => eventBus.off('facebook:webhook-message-persisted', onPersisted));

  const result = await adapter.handleWebhook({ object: 'page', entry: [{ id: 'page-10001', messaging: [{
    sender: { id: 'page-10001' }, recipient: { id: 'psid-business-suite-new' }, timestamp: 1784741880000,
    message: { mid: 'mid-business-suite-echo', is_echo: true, text: 'Business Suite reply' }
  }] }] }, [account]);

  assert.equal(result.accepted, 0);
  const conversationId = `${account.id}:psid-business-suite-new`;
  const conversation = getStore().db.prepare('SELECT * FROM r32_conversations WHERE session_key=?').get(conversationId);
  const message = getStore().db.prepare(`SELECT * FROM r32_messages WHERE session_key=? AND json_extract(payload_json,'$.externalMessageId')=?`).get(conversationId, 'mid-business-suite-echo');
  assert.ok(conversation);
  assert.ok(conversation.contact_id);
  assert.ok(message);
  const payload = JSON.parse(message.payload_json);
  assert.equal(payload.direction, 'outbound');
  assert.equal(payload.fromMe, true);
  assert.equal(payload.pageScopedUserId, 'psid-business-suite-new');
  assert.equal(persistedEvent.direction, 'outbound');
  assert.equal(persistedEvent.isEcho, true);
  assert.equal(persistedEvent.peerId, 'psid-business-suite-new');
  assert.equal(persistedEvent.newConversation, true);
});

test('Facebook post-connect reconciliation delegates history synchronization to durable authority', async () => {
  const adapter = new FacebookAdapter();
  const account = facebookAccount({ id: 'facebook-scheduled-reconciliation' });
  const row = {
    account,
    historySyncAvailable: true,
    state: 'connected', permissionReady: true, subscriptionReady: true,
    stopped: false, reconciliationActive: false, reconciliationRunning: false,
    reconciliationTimer: null, reconciliationLastAt: '', reconciliationLastError: ''
  };
  adapter.sessions.set(account.id, row);
  adapter.emit = () => {};
  adapter.sync = async () => { throw new Error('history synchronization must be owned by DurableExecutionAuthorityV2'); };
  let delegated = null;
  const onDelegated = event => { if (event.payload?.accountId === account.id) delegated = event.payload; };
  eventBus.on('facebook:reconciliation-delegated', onDelegated);
  try {
    assert.equal(adapter.scheduleReconciliation(account, row), false);
  } finally {
    eventBus.off('facebook:reconciliation-delegated', onDelegated);
  }

  assert.equal(delegated.authority, 'DurableExecutionAuthorityV2');
  assert.equal(delegated.operationKind, 'HISTORY_SYNCHRONIZATION');
  assert.equal(delegated.reasonCode, 'DURABLE_HISTORY_SYNCHRONIZATION_REQUIRED');
  assert.equal(row.reconciliationLastAt, '');
  assert.equal(row.reconciliationLastError, 'DURABLE_HISTORY_SYNCHRONIZATION_REQUIRED');
  assert.equal(row.reconciliationLastResult, undefined);
  assert.equal(row.reconciliationActive, false);
  assert.equal(row.reconciliationRunning, false);
  assert.equal(row.reconciliationTimer, null);
});

test('Facebook reconciliation exposes a real blocked state without pages_read_engagement', () => {
  const adapter = new FacebookAdapter();
  const account = facebookAccount({ id: 'facebook-no-history-permission' });
  const row = {
    account,
    historySyncAvailable: false,
    historySyncReason: 'pages_read_engagement 尚未授权；Business Suite 会话无法补拉',
    missingOptionalPermissions: ['pages_read_engagement'],
    reconciliationActive: true,
    reconciliationRunning: true
  };
  adapter.sessions.set(account.id, row);
  assert.equal(adapter.scheduleReconciliation(account, row), false);
  assert.equal(row.reconciliationActive, false);
  assert.equal(row.reconciliationRunning, false);
  assert.match(row.reconciliationLastError, /pages_read_engagement/);
  assert.equal(row.reconciliationTimer, null);
  const state = adapter.publicState(row);
  assert.equal(state.historySyncAvailable, false);
  assert.deepEqual(state.missingOptionalPermissions, ['pages_read_engagement']);
  assert.match(state.reconciliationLastError, /Business Suite/);
});


test('Facebook natural contact identity reuses an existing legacy primary key instead of violating the account-scoped unique index', async () => {
  const accountId = 'facebook-natural-key-account';
  const psid = '10000000000000111';
  const legacyContactId = 'legacy-facebook-contact-row';
  const requestedContactId = facebookContactId(accountId, psid);
  const conversationId = `${accountId}:${psid}`;
  const store = getStore();
  ensureFacebookPlatformAccount(accountId, 'page-natural-key');
  store.upsertContact({
    id: legacyContactId,
    platform: 'facebook',
    accountId,
    externalId: psid,
    displayName: 'Mario Legacy',
    source: 'legacy-facebook-import'
  });

  const result = await messageStore.upsert({
    dedupeKey: 'facebook-natural-key-message-1',
    externalMessageId: 'mid-natural-key-1',
    accountId,
    sourceAccountId: accountId,
    platform: 'facebook',
    pageId: 'page-natural-key',
    pageScopedUserId: psid,
    contactExternalId: psid,
    contactId: requestedContactId,
    chatJid: `facebook:${psid}`,
    conversationId,
    direction: 'inbound',
    fromMe: false,
    sender: psid,
    contactName: 'Mario Neefe',
    text: 'new inbound message',
    timestamp: '2026-07-23T11:40:00.000Z',
    source: 'facebook-webhook'
  });

  assert.equal(result.inserted, true);
  const contacts = store.db.prepare('SELECT id,display_name FROM contacts WHERE platform=? AND account_id=? AND external_id=?').all('facebook', accountId, psid);
  assert.equal(contacts.length, 1);
  assert.equal(contacts[0].id, legacyContactId);
  assert.equal(contacts[0].display_name, 'Mario Neefe');
  const conversation = store.db.prepare('SELECT contact_id FROM r32_conversations WHERE session_key=?').get(conversationId);
  assert.equal(conversation.contact_id, legacyContactId);
  const saved = store.getMessage('facebook-natural-key-message-1');
  assert.equal(saved.contactId, legacyContactId);
});

test('Facebook inbound webhook and outbound echo can persist the same natural contact identity without duplicate-contact races', async () => {
  const accountId = 'facebook-contact-race-account';
  const psid = '10000000000000222';
  const legacyContactId = 'legacy-race-contact';
  const conversationId = `${accountId}:${psid}`;
  const store = getStore();
  ensureFacebookPlatformAccount(accountId, 'page-race');
  store.upsertContact({ id: legacyContactId, platform: 'facebook', accountId, externalId: psid, displayName: 'Race Contact' });

  const common = {
    accountId,
    sourceAccountId: accountId,
    platform: 'facebook',
    pageId: 'page-race',
    pageScopedUserId: psid,
    contactExternalId: psid,
    chatJid: `facebook:${psid}`,
    conversationId,
    contactName: 'Race Contact',
    type: 'text'
  };
  await Promise.all([
    messageStore.upsert({ ...common, contactId: facebookContactId(accountId, psid), dedupeKey: 'race-inbound', externalMessageId: 'mid-race-inbound', direction: 'inbound', fromMe: false, sender: psid, text: 'inbound', timestamp: '2026-07-23T11:41:00.000Z', source: 'facebook-webhook' }),
    messageStore.upsert({ ...common, contactId: 'another-generated-contact-id', dedupeKey: 'race-echo', externalMessageId: 'mid-race-echo', direction: 'outbound', fromMe: true, sender: 'page-race', text: 'outbound', timestamp: '2026-07-23T11:41:01.000Z', source: 'facebook-webhook' })
  ]);

  const contacts = store.db.prepare('SELECT id FROM contacts WHERE platform=? AND account_id=? AND external_id=?').all('facebook', accountId, psid);
  assert.deepEqual(contacts.map(row => row.id), [legacyContactId]);
  const messages = store.db.prepare('SELECT COUNT(*) AS n FROM r32_messages WHERE session_key=?').get(conversationId);
  assert.equal(Number(messages.n), 2);
  assert.equal(store.db.prepare('SELECT contact_id FROM r32_conversations WHERE session_key=?').get(conversationId).contact_id, legacyContactId);
});

test('Facebook send remains successful after Meta acceptance when local persistence needs repair', async t => {
  const adapter = new FacebookAdapter();
  adapter.credentials = () => ({ secret: { pageId: 'page-send' } });
  patch(t, relayClient, 'send', async () => ({ messageId: 'mid-meta-accepted-1' }));
  patch(t, messageStore, 'upsert', async () => {
    const error = new Error('UNIQUE constraint failed: contacts.platform, contacts.account_id, contacts.external_id');
    error.code = 'ERR_SQLITE_ERROR';
    throw error;
  });

  const result = await adapter.sendText(
    facebookAccount({ id: 'facebook-meta-accepted' }),
    'facebook:10000000000000333',
    'already delivered by Meta',
    {
      localMessageId: 'local-meta-accepted-1',
      sessionKey: 'facebook-meta-accepted:10000000000000333',
      physicalAttemptContext: frozenFacebookAttempt({
        executionId: 'facebook-meta-accepted-execution',
        attemptId: 'facebook-meta-accepted-attempt',
        claimId: 'facebook-meta-accepted-claim',
        ownerId: 'facebook-meta-accepted-owner',
        accountId: 'facebook-meta-accepted'
      })
    }
  );

  assert.equal(result.messageId, 'mid-meta-accepted-1');
  assert.equal(result.localPersistencePending, true);
  assert.equal(result.localPersistenceErrorCode, 'ERR_SQLITE_ERROR');
});
