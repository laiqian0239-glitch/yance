'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-b40-presence-order-'));
process.env.YANCE_DATA_DIR = dataRoot;

const messageStore = require('../services/messageStore');
const { getStore, closeStore } = require('../repositories/storeProvider');

const store = getStore();
const conversationId = 'wa-presence-order:49123@s.whatsapp.net';
store.upsertConversation({
  sessionKey: conversationId,
  accountId: 'wa-presence-order',
  platform: 'whatsapp',
  title: 'Presence Ordering',
  online: true,
  presence: 'available',
  presenceState: 'online',
  presenceUpdatedAt: '2026-07-24T12:00:10.000Z'
});

test.after(() => {
  try { closeStore(); } catch (_) {}
  fs.rmSync(dataRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

test('conversation metadata persistence ignores an older terminal presence update', async () => {
  const saved = await messageStore.updateConversationMetadata(conversationId, {
    online: false,
    presence: 'unavailable',
    presenceState: 'offline',
    presenceUpdatedAt: '2026-07-24T12:00:05.000Z'
  });

  assert.equal(saved.online, true);
  assert.equal(saved.presenceState, 'online');
  assert.equal(saved.presenceUpdatedAt, '2026-07-24T12:00:10.000Z');
});

test('a stale presence fragment cannot suppress unrelated newer metadata fields', async () => {
  const saved = await messageStore.updateConversationMetadata(conversationId, {
    online: false,
    presence: 'unavailable',
    presenceState: 'offline',
    presenceUpdatedAt: '2026-07-24T12:00:05.000Z',
    avatarUrl: 'https://cdn.example/avatar-new.jpg',
    avatarUpdatedAt: '2026-07-24T12:00:20.000Z',
    avatarStatus: 'ready'
  });

  assert.equal(saved.online, true);
  assert.equal(saved.presenceState, 'online');
  assert.equal(saved.presenceUpdatedAt, '2026-07-24T12:00:10.000Z');
  assert.equal(saved.avatarUrl, 'https://cdn.example/avatar-new.jpg');
  assert.equal(saved.avatarStatus, 'ready');
});
