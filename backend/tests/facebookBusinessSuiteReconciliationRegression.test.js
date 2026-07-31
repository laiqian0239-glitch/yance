'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-facebook-business-suite-'));
process.env.YANCE_DATA_DIR = dataRoot;

const facebookModule = require('../services/facebookAdapter');
const messageStore = require('../services/messageStore');
const notificationPolicy = require('../services/notificationPolicy');
const eventBus = require('../services/eventBus');
const relayClient = require('../services/facebookRelayClient');
const sendQueueService = require('../services/sendQueueService');
const queueRepository = require('../repositories/sendQueueRepository');
const outboundCommandRepository = require('../repositories/outboundCommandRepository');
const { getStore, closeStore } = require('../repositories/storeProvider');

const { FacebookAdapter, facebookContactId, webhookPeerId, retrySqliteBusy } = facebookModule;

test.after(() => {
  closeStore();
  fs.rmSync(dataRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
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

test('Facebook post-connect reconciliation runs once, records completion and stops cleanly', async () => {
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
  adapter.reconciliationPolicy = () => ({ initialDelayMs: 0, intervalMs: 15000, maximumConversations: 25, maximumMessages: 50 });
  let options = null;
  adapter.sync = async (_account, input) => {
    options = input;
    adapter.stopReconciliation(row);
    return { conversations: 1, messagesScanned: 2, messagesInserted: 2, avatars: 0, failedConversations: 0, syncedAt: '2026-07-22T13:42:00.000Z' };
  };

  assert.equal(adapter.scheduleReconciliation(account, row), true);
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(options.maximumConversations, 25);
  assert.equal(options.maximumMessages, 50);
  assert.match(options.source, /post-connect-reconciliation/);
  assert.equal(row.reconciliationLastAt, '2026-07-22T13:42:00.000Z');
  assert.equal(row.reconciliationLastError, '');
  assert.equal(row.reconciliationLastResult.conversations, 1);
  assert.equal(row.reconciliationLastResult.messages, 2);
  assert.equal(row.reconciliationLastResult.failedConversations, 0);
  assert.equal(row.reconciliationActive, false);
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
  assert.equal(row.reconciliationTimer, undefined);
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
    { localMessageId: 'local-meta-accepted-1', sessionKey: 'facebook-meta-accepted:10000000000000333' }
  );

  assert.equal(result.messageId, 'mid-meta-accepted-1');
  assert.equal(result.localPersistencePending, true);
  assert.equal(result.localPersistenceErrorCode, 'ERR_SQLITE_ERROR');
});

test('send queue never schedules a second network send after platform acceptance when only the local receipt projection fails', async t => {
  const queueId = 'send-local-projection-pending';
  const accountId = 'facebook-local-projection';
  const sessionKey = 'facebook-local-projection:10000000000000444';
  ensureFacebookPlatformAccount(accountId, 'page-local-projection');
  getStore().upsertConversation({
    sessionKey, accountId, platform: 'facebook', title: '10000000000000444',
    routeState: 'bound', chatJid: 'facebook:10000000000000444', externalId: '10000000000000444'
  });
  outboundCommandRepository.createAtomic({
    route: { conversationId: sessionKey, accountId, platform: 'facebook', routeTarget: 'facebook:10000000000000444', capabilitySnapshotId: '' },
    queue: {
      id: queueId,
      idempotencyKey: 'idem-local-projection-pending',
      accountId,
      sessionKey,
      messageType: 'text',
      payload: { platform: 'facebook', operation: 'text', chatJid: 'facebook:10000000000000444', text: 'accepted' }
    }
  });
  const row = queueRepository.claimNext();
  assert.equal(row.id, queueId);
  patch(t, sendQueueService, 'dispatch', async () => ({ messageId: 'mid-platform-accepted-2', localPersistencePending: true, localPersistenceErrorCode: 'ERR_SQLITE_ERROR' }));
  patch(t, messageStore, 'updateReceipt', async () => {
    const error = new Error('local receipt projection failed');
    error.code = 'ERR_SQLITE_ERROR';
    throw error;
  });

  const output = await sendQueueService.processRow(row);
  assert.equal(output.queue.state, 'platform_accepted_local_pending');
  assert.equal(output.result.platformMessageId, 'mid-platform-accepted-2');
  assert.equal(output.result.localPersistencePending, true);
  assert.equal(queueRepository.get(queueId).state, 'platform_accepted_local_pending');
  assert.equal(queueRepository.claimNext(), null);
});
