'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-fix21-pin-'));
process.env.YANCE_DATA_DIR = dataRoot;

const { getStore, closeStore } = require('../repositories/storeProvider');
const workspaceRepository = require('../repositories/workspaceRepository');
const messageRepository = require('../repositories/messageRepository');

const root = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test.after(() => {
  try { closeStore(); } catch (_) {}
  fs.rmSync(dataRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

test('conversation pin is persisted per conversation and isolated by account', () => {
  const store = getStore();
  store.upsertContact({ id: 'contact-a', platform: 'facebook', accountId: 'facebook-a', externalId: '1001', displayName: 'Alice' });
  store.upsertContact({ id: 'contact-b', platform: 'facebook', accountId: 'facebook-b', externalId: '1002', displayName: 'Bob' });
  store.upsertConversation({ sessionKey: 'facebook-a:1001', accountId: 'facebook-a', contactId: 'contact-a', platform: 'facebook', title: 'Alice', lastMessageAt: '2026-07-24T10:00:00.000Z' });
  store.upsertConversation({ sessionKey: 'facebook-b:1002', accountId: 'facebook-b', contactId: 'contact-b', platform: 'facebook', title: 'Bob', lastMessageAt: '2026-07-24T11:00:00.000Z' });

  const pinned = workspaceRepository.setConversationPinned('facebook-a:1001', { pinned: true, by: 'user' });
  assert.equal(pinned.pinned, true);
  assert.equal(pinned.accountId, 'facebook-a');
  assert.ok(pinned.pinnedAt);

  const rows = messageRepository.listConversations({ limit: 20 });
  assert.equal(rows.find(row => row.id === 'facebook-a:1001').pinned, true);
  assert.equal(rows.find(row => row.id === 'facebook-b:1002').pinned, false);

  const unpinned = workspaceRepository.setConversationPinned('facebook-a:1001', { pinned: false, by: 'user' });
  assert.equal(unpinned.pinned, false);
  assert.equal(messageRepository.getConversation('facebook-a:1001').pinned, false);
});

test('contact context menu exposes persistent pin and pinned-first rendering', () => {
  const ui = read('frontend/js/r32-ui-runtime.js');
  const html = read('frontend/index.html');
  const routes = read('backend/routes/workspace.js');
  assert.match(ui, /data-contact-action="pin"/);
  assert.match(ui, /setConversationPinned\(contact\.id,!contact\.pinned\)/);
  assert.match(ui, /workspace\/conversations\/\$\{encodeURIComponent\(id\)\}\/pin/);
  assert.match(ui, /Number\(Boolean\(b\.pinned\)\)-Number\(Boolean\(a\.pinned\)\)/);
  assert.match(html, /contact-card\.pinned/);
  assert.match(routes, /conversations\/:sessionKey\/pin/);
});

test('Facebook web companion presents incremental avatar and conversation-difference governance', () => {
  const accountCenter = read('frontend/r32-account-center.js');
  const content = read('tools/facebook-business-suite-avatar-importer/content.js');
  const service = read('backend/services/facebookBusinessSuiteAvatarImportService.js');
  assert.match(accountCenter, /言策网页伴侣 · Facebook/);
  assert.match(accountCenter, /潜在新会话/);
  assert.match(accountCenter, /消息摘要差异/);
  assert.match(content, /新增头像/);
  assert.match(content, /无需更新/);
  assert.match(content, /不会直接写入消息/);
  assert.match(service, /AVATAR_IMPORT_UNCHANGED/);
  assert.match(service, /automaticMessageWrites: false/);
  assert.match(service, /webCompanion/);
});
