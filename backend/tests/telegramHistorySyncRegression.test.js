'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const telegramModule = require('../services/telegramAdapter');
const messageStore = require('../services/messageStore');
const syncCheckpoint = require('../services/syncCheckpointService');
const avatarService = require('../services/avatarService');
const notificationPolicy = require('../services/notificationPolicy');

const { TelegramAdapter } = telegramModule;

function patch(t, object, key, value) {
  const original = object[key];
  object[key] = value;
  t.after(() => { object[key] = original; });
}

function account() {
  return { id: 'telegram-history', platform: 'telegram', displayName: '我的 Telegram', credentialRef: 'telegram-history-credential' };
}

test('Telegram history sync imports messages in chronological order and restores server unread count', async t => {
  const adapter = new TelegramAdapter();
  const currentAccount = account();
  const client = {
    async getDialogs() {
      return [{ id: '42', title: 'Telegram 客户', unreadCount: 2, entity: { id: '42', firstName: 'Telegram', lastName: '客户' } }];
    },
    async getMessages() {
      return [
        { id: 2, date: 1783920060, out: true, senderId: 'me', message: '你好', async getSender() { return null; } },
        { id: 1, date: 1783920000, out: false, senderId: '42', message: '我想了解一下', async getSender() { return { firstName: 'Telegram', lastName: '客户' }; } }
      ];
    },
    async downloadProfilePhoto() { return null; }
  };
  adapter.sessions.set(currentAccount.id, { account: currentAccount, client, state: 'connected' });
  patch(t, adapter, 'materializeMessageMedia', async () => []);
  patch(t, messageStore, 'getConversation', () => ({ unreadCount: 9, avatarUrl: '' }));
  patch(t, messageStore, 'hasExternalMessage', ({ targetId }) => String(targetId) === '2');
  const imported = [];
  patch(t, messageStore, 'upsert', async value => { imported.push(value); return { inserted: true, message: value, conversation: {} }; });
  let metadata = null;
  patch(t, messageStore, 'updateConversationMetadata', async (_id, value) => { metadata = value; return value; });
  patch(t, syncCheckpoint, 'begin', () => ({ batchId: 'batch-1' }));
  let committed = null;
  patch(t, syncCheckpoint, 'commit', value => { committed = value; return value; });
  patch(t, syncCheckpoint, 'fail', () => { throw new Error('unexpected fail'); });

  const result = await adapter.sync(currentAccount);

  assert.equal(imported.length, 1);
  assert.equal(imported[0].externalMessageId, '1');
  assert.equal(imported[0].direction, 'inbound');
  assert.equal(imported[0].source, 'telegram-history-sync');
  assert.equal(metadata.unreadCount, 2);
  assert.equal(metadata.title, 'Telegram 客户');
  assert.equal(committed.remoteMessageId, '2');
  assert.equal(result.conversations, 1);
  assert.equal(result.messagesScanned, 2);
  assert.equal(result.messagesInserted, 1);
  assert.equal(result.failedConversations, 0);
  assert.equal(result.failedMessages, 0);
});

test('Telegram timestamp helper accepts Date, Unix seconds, and Unix milliseconds', () => {
  assert.equal(telegramModule.telegramTimestamp(new Date('2026-07-13T00:00:00.000Z')), '2026-07-13T00:00:00.000Z');
  assert.equal(telegramModule.telegramTimestamp(1783900800), '2026-07-13T00:00:00.000Z');
  assert.equal(telegramModule.telegramTimestamp(1783900800000), '2026-07-13T00:00:00.000Z');
});

test('Telegram live ingest retries when a prior receipt exists but the message was never persisted', async t => {
  const adapter = new TelegramAdapter();
  const currentAccount = account();
  let liveHandler = null;
  const row = {
    account: currentAccount,
    state: 'connected',
    client: { addEventHandler(handler) { liveHandler = handler; }, async downloadProfilePhoto() { return null; } },
    user: { id: 'me' }
  };
  class NewMessage {}
  patch(t, syncCheckpoint, 'begin', () => ({ batchId: 'live-batch' }));
  patch(t, syncCheckpoint, 'claimRemoteMessage', () => ({ claimed: false, duplicate: true }));
  let committed = false;
  patch(t, syncCheckpoint, 'commit', () => { committed = true; return {}; });
  patch(t, messageStore, 'hasExternalMessage', () => false);
  patch(t, messageStore, 'getConversation', () => ({ title: '客户', avatarUrl: '' }));
  let inserted = null;
  patch(t, messageStore, 'upsert', async value => { inserted = value; return { inserted: true, message: value, conversation: { title: '客户' } }; });
  patch(t, messageStore, 'updateConversationMetadata', async () => ({}));
  patch(t, avatarService, 'needsRefresh', () => false);
  patch(t, notificationPolicy, 'notify', () => {});
  patch(t, adapter, 'materializeMessageMedia', async () => []);

  adapter.sessions.set(currentAccount.id, row);
  adapter.attachMessageHandler(currentAccount, row, NewMessage);
  assert.equal(typeof liveHandler, 'function');
  await liveHandler({ message: { id: 77, chatId: 42, senderId: 42, date: 1783900800, out: false, message: '重试成功', async getSender() { return { firstName: '客户' }; } } });

  assert.equal(inserted.externalMessageId, '77');
  assert.equal(inserted.text, '重试成功');
  assert.equal(committed, true);
});

test('Telegram first live message is visible before sender/avatar enrichment starts', async t => {
  const adapter = new TelegramAdapter();
  const currentAccount = account();
  let liveHandler = null;
  const row = {
    account: currentAccount,
    state: 'connected',
    client: {
      addEventHandler(handler) { liveHandler = handler; },
      async downloadProfilePhoto() { return Buffer.from('telegram-avatar'); }
    },
    user: { id: 'me' }
  };
  class NewMessage {}
  patch(t, syncCheckpoint, 'begin', () => ({ batchId: 'live-first-message' }));
  patch(t, syncCheckpoint, 'claimRemoteMessage', () => ({ claimed: true, duplicate: false }));
  patch(t, syncCheckpoint, 'commit', () => ({}));
  patch(t, messageStore, 'hasExternalMessage', () => false);
  patch(t, messageStore, 'getConversation', () => null);
  patch(t, avatarService, 'needsRefresh', () => true);
  let inserted = null;
  patch(t, messageStore, 'upsert', async value => {
    inserted = value;
    return { inserted: true, message: value, conversation: { title: value.contactName, avatarUrl: value.avatarUrl } };
  });
  patch(t, notificationPolicy, 'notify', () => {});
  patch(t, adapter, 'materializeMessageMedia', async () => []);
  let enrichment = null;
  patch(t, adapter, 'scheduleMessageEnrichment', (accountValue, rowValue, messageValue, baseMessage, descriptor, options) => {
    enrichment = { accountValue, rowValue, messageValue, baseMessage, descriptor, options };
  });

  adapter.sessions.set(currentAccount.id, row);
  adapter.attachMessageHandler(currentAccount, row, NewMessage);
  await liveHandler({ message: {
    id: 88, chatId: 42, senderId: 42, date: 1783900800, out: false, message: '第一条消息',
    async getSender() { return { firstName: 'Anna', lastName: 'Meyer' }; }
  } });

  assert.equal(inserted.text, '第一条消息');
  assert.equal(inserted.contactName, currentAccount.displayName);
  assert.equal(inserted.avatarUrl || '', '');
  assert.equal(inserted.backgroundJobs[0].jobType, 'telegram-message-enrichment');
  assert.ok(enrichment, 'sender/avatar enrichment must be scheduled after the message commit');
  assert.equal(enrichment.baseMessage.externalMessageId, '88');
  assert.equal(enrichment.options.chatId, '42');
});

test('Telegram history sync resumes durable backfill offset across runs without skipping older pages', async t => {
  const adapter = new TelegramAdapter();
  const currentAccount = account();
  const calls = [];
  const pages = new Map([
    ['', [
      { id: 5, date: 1783920300, out: false, senderId: '42', message: 'm5' },
      { id: 4, date: 1783920240, out: false, senderId: '42', message: 'm4' }
    ]],
    ['4', [
      { id: 3, date: 1783920180, out: false, senderId: '42', message: 'm3' },
      { id: 2, date: 1783920120, out: false, senderId: '42', message: 'm2' }
    ]],
    ['2', [
      { id: 1, date: 1783920060, out: false, senderId: '42', message: 'm1' }
    ]]
  ]);
  const client = {
    async getDialogs() { return [{ id: '42', title: 'Telegram 客户', unreadCount: 0, entity: { id: '42' } }]; },
    async getMessages(_entity, options = {}) {
      const offset = options.offsetId == null ? '' : String(options.offsetId);
      calls.push(offset);
      return pages.get(offset) || [];
    }
  };
  adapter.sessions.set(currentAccount.id, { account: currentAccount, client, state: 'connected' });
  patch(t, adapter, 'scheduleMessageEnrichment', () => {});
  patch(t, messageStore, 'getConversation', () => ({ unreadCount: 0 }));
  const persisted = new Set();
  patch(t, messageStore, 'hasExternalMessage', ({ targetId }) => persisted.has(String(targetId)));
  patch(t, messageStore, 'upsert', async value => { persisted.add(String(value.externalMessageId)); return { inserted: true, message: value, conversation: {} }; });
  patch(t, messageStore, 'updateConversationMetadata', async () => ({}));
  let checkpoint = null;
  let sequence = 0;
  patch(t, syncCheckpoint, 'read', () => checkpoint);
  patch(t, syncCheckpoint, 'begin', () => ({ batchId: `history-page-${++sequence}`, previous: checkpoint }));
  patch(t, syncCheckpoint, 'commit', value => {
    checkpoint = {
      cursor: value.cursor,
      remoteMessageId: value.remoteMessageId,
      remoteTimestamp: value.remoteTimestamp,
      phase: 'committed',
      payload: value.payload
    };
    return checkpoint;
  });
  patch(t, syncCheckpoint, 'fail', () => { throw new Error('unexpected checkpoint failure'); });
  const oldMessages = process.env.YANCE_TELEGRAM_SYNC_MESSAGES_PER_DIALOG;
  const oldPages = process.env.YANCE_TELEGRAM_HISTORY_PAGES_PER_DIALOG;
  process.env.YANCE_TELEGRAM_SYNC_MESSAGES_PER_DIALOG = '2';
  process.env.YANCE_TELEGRAM_HISTORY_PAGES_PER_DIALOG = '1';
  t.after(() => {
    if (oldMessages === undefined) delete process.env.YANCE_TELEGRAM_SYNC_MESSAGES_PER_DIALOG;
    else process.env.YANCE_TELEGRAM_SYNC_MESSAGES_PER_DIALOG = oldMessages;
    if (oldPages === undefined) delete process.env.YANCE_TELEGRAM_HISTORY_PAGES_PER_DIALOG;
    else process.env.YANCE_TELEGRAM_HISTORY_PAGES_PER_DIALOG = oldPages;
  });

  const first = await adapter.sync(currentAccount);
  assert.deepEqual(calls, ['', '4']);
  assert.equal(checkpoint.cursor, '2');
  assert.equal(checkpoint.payload.backfillOffsetId, '2');
  assert.equal(checkpoint.payload.historyComplete, false);
  assert.equal(first.historyPages, 2);

  calls.length = 0;
  const second = await adapter.sync(currentAccount);
  assert.deepEqual(calls, ['', '2']);
  assert.equal(checkpoint.cursor, '');
  assert.equal(checkpoint.payload.historyComplete, true);
  assert.equal(second.historyCompletedConversations, 1);
  assert.deepEqual([...persisted].sort((a, b) => Number(a) - Number(b)), ['1', '2', '3', '4', '5']);
});

test('Telegram history sync does not advance the committed high-water mark until a multi-run new-message gap is closed', async t => {
  const adapter = new TelegramAdapter();
  const currentAccount = account();
  const calls = [];
  let availableIds = [106, 105, 104, 103, 102, 101];
  const client = {
    async getDialogs() { return [{ id: '84', title: 'Catch-up 客户', unreadCount: 0, entity: { id: '84' } }]; },
    async getMessages(_entity, options = {}) {
      const limit = Number(options.limit || 2);
      const minimum = Number(options.minId || 0);
      const offset = options.offsetId == null ? Infinity : Number(options.offsetId);
      calls.push({ minId: minimum, offsetId: Number.isFinite(offset) ? offset : '', limit });
      return availableIds
        .filter(id => id > minimum && id < offset)
        .sort((left, right) => right - left)
        .slice(0, limit)
        .map(id => ({ id, date: 1783920000 + id, out: false, senderId: '84', message: `m${id}` }));
    }
  };
  adapter.sessions.set(currentAccount.id, { account: currentAccount, client, state: 'connected' });
  patch(t, adapter, 'scheduleMessageEnrichment', () => {});
  patch(t, messageStore, 'getConversation', () => ({ unreadCount: 0 }));
  const persisted = new Set();
  patch(t, messageStore, 'hasExternalMessage', ({ targetId }) => persisted.has(String(targetId)));
  patch(t, messageStore, 'upsert', async value => { persisted.add(String(value.externalMessageId)); return { inserted: true, message: value, conversation: {} }; });
  patch(t, messageStore, 'updateConversationMetadata', async () => ({}));
  let checkpoint = {
    cursor: '', remoteMessageId: '100', remoteTimestamp: '2026-07-13T00:00:00.000Z', phase: 'committed',
    payload: { source: 'telegram-history-sync', schemaVersion: 3, historyComplete: true, backfillOffsetId: '', catchupInProgress: false }
  };
  let sequence = 0;
  patch(t, syncCheckpoint, 'read', () => checkpoint);
  patch(t, syncCheckpoint, 'begin', () => ({ batchId: `catchup-${++sequence}`, previous: checkpoint }));
  patch(t, syncCheckpoint, 'commit', value => {
    checkpoint = { cursor: value.cursor, remoteMessageId: value.remoteMessageId, remoteTimestamp: value.remoteTimestamp, phase: 'committed', payload: value.payload };
    return checkpoint;
  });
  patch(t, syncCheckpoint, 'fail', () => { throw new Error('unexpected checkpoint failure'); });
  const oldMessages = process.env.YANCE_TELEGRAM_SYNC_MESSAGES_PER_DIALOG;
  const oldCatchup = process.env.YANCE_TELEGRAM_CATCHUP_PAGES_PER_DIALOG;
  process.env.YANCE_TELEGRAM_SYNC_MESSAGES_PER_DIALOG = '2';
  process.env.YANCE_TELEGRAM_CATCHUP_PAGES_PER_DIALOG = '1';
  t.after(() => {
    if (oldMessages === undefined) delete process.env.YANCE_TELEGRAM_SYNC_MESSAGES_PER_DIALOG;
    else process.env.YANCE_TELEGRAM_SYNC_MESSAGES_PER_DIALOG = oldMessages;
    if (oldCatchup === undefined) delete process.env.YANCE_TELEGRAM_CATCHUP_PAGES_PER_DIALOG;
    else process.env.YANCE_TELEGRAM_CATCHUP_PAGES_PER_DIALOG = oldCatchup;
  });

  await adapter.sync(currentAccount);
  assert.equal(checkpoint.remoteMessageId, '100', 'the durable high-water mark must stay at the old boundary while a gap remains');
  assert.equal(checkpoint.payload.catchupInProgress, true);
  assert.equal(checkpoint.payload.catchupTargetRemoteMessageId, '106');
  assert.equal(checkpoint.payload.catchupOffsetId, '105');

  await adapter.sync(currentAccount);
  assert.equal(checkpoint.remoteMessageId, '100');
  assert.equal(checkpoint.payload.catchupOffsetId, '103');
  await adapter.sync(currentAccount);
  assert.equal(checkpoint.remoteMessageId, '100');
  assert.equal(checkpoint.payload.catchupOffsetId, '101');
  await adapter.sync(currentAccount);
  assert.equal(checkpoint.remoteMessageId, '106');
  assert.equal(checkpoint.payload.catchupInProgress, false);
  assert.deepEqual([...persisted].sort((a, b) => Number(a) - Number(b)), ['101', '102', '103', '104', '105', '106']);

  availableIds = [108, 107, ...availableIds];
  await adapter.sync(currentAccount);
  assert.equal(checkpoint.remoteMessageId, '106', 'an exactly full latest page stays provisional until the boundary is proven');
  assert.equal(checkpoint.payload.catchupTargetRemoteMessageId, '108');
  await adapter.sync(currentAccount);
  assert.equal(checkpoint.remoteMessageId, '108');
  assert.deepEqual([...persisted].sort((a, b) => Number(a) - Number(b)), ['101', '102', '103', '104', '105', '106', '107', '108']);
  assert.ok(calls.some(call => call.minId === 100 && call.offsetId === 105));
  assert.ok(calls.some(call => call.minId === 106));
});
