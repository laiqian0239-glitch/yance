'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { AccountContext } = require('../core/accountContext');
const sendMessageService = require('../services/sendMessageService');

function contextHarness(overrides = {}) {
  const calls = { local: [], platform: [] };
  const conversation = {
    conversationId: 'wa-account-a:491111@s.whatsapp.net',
    sessionKey: 'wa-account-a:491111@s.whatsapp.net',
    accountId: 'wa-adapter-a',
    platform: 'whatsapp',
    chatJid: '491111@s.whatsapp.net',
    contactId: 'contact-wa-a',
    canonicalContactId: 'customer-shared'
  };
  const messageStore = {
    getConversation(id) { return id === conversation.conversationId ? conversation : null; },
    async markRead(id) { calls.local.push(id); return { ...conversation, unread: 0 }; },
    ...(overrides.messageStore || {})
  };
  const accountStore = {
    list() { return [{ id: 'wa-account-a', adapterAccountId: 'wa-adapter-a', platform: 'whatsapp' }]; },
    ...(overrides.accountStore || {})
  };
  const instance = new AccountContext({
    securityGuard: {}, accountManager: {}, accountStore, accountMigration: {}, messageStore,
    sendQueue: {}, platformMessaging: {}, platformCapabilities: {}, whatsapp: {}, facebook: {},
    canonicalIdentity: {}, eventBus: {}
  });
  sendMessageService.setRegistry({
    async markRead(input) { calls.platform.push({ ...input }); return { ok: true }; }
  });
  return { instance, calls, conversation };
}

test.afterEach(() => sendMessageService.resetRegistry());

test('read mutation is rejected before local state changes when platform/account/target scope mismatches', async () => {
  const { instance, calls, conversation } = contextHarness();
  const mismatches = [
    { platform: 'telegram', accountId: 'wa-account-a', chatJid: conversation.chatJid },
    { platform: 'whatsapp', accountId: 'wa-account-b', chatJid: conversation.chatJid },
    { platform: 'whatsapp', accountId: 'wa-account-a', chatJid: '492222@s.whatsapp.net' }
  ];
  for (const input of mismatches) {
    await assert.rejects(
      instance.markRead({ conversationId: conversation.conversationId, ...input }),
      error => error?.code === 'CONVERSATION_ROUTE_SCOPE_MISMATCH' && error?.status === 409
    );
  }
  assert.deepEqual(calls.local, []);
  assert.deepEqual(calls.platform, []);
});

test('read mutation resolves the canonical route and returns all five isolation dimensions', async () => {
  const { instance, calls, conversation } = contextHarness();
  const result = await instance.markRead({
    conversationId: conversation.conversationId,
    platform: 'whatsapp',
    accountId: 'wa-account-a',
    chatJid: conversation.chatJid,
    messageKeys: [{ id: 'remote-1', remoteJid: conversation.chatJid }]
  });
  assert.deepEqual(calls.local, [conversation.conversationId]);
  assert.equal(calls.platform.length, 1);
  assert.equal(calls.platform[0].accountId, 'wa-adapter-a');
  assert.equal(calls.platform[0].chatJid, conversation.chatJid);
  assert.deepEqual(result.routeScope, {
    platform: 'whatsapp',
    sourceAccountId: 'wa-adapter-a',
    platformContactIdentity: conversation.chatJid,
    conversationId: conversation.conversationId,
    canonicalContactId: 'customer-shared'
  });
});

test('unknown conversation is rejected without mutating unread state', async () => {
  const { instance, calls } = contextHarness();
  await assert.rejects(
    instance.markRead({ conversationId: 'missing-conversation', platform: 'whatsapp', accountId: 'wa-account-a', chatJid: '491111@s.whatsapp.net' }),
    error => error?.code === 'CONVERSATION_NOT_FOUND' && error?.status === 404
  );
  assert.deepEqual(calls.local, []);
  assert.deepEqual(calls.platform, []);
});

test('frontend restores unread only when the read request fails, not when profile or AI context loading fails', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../frontend/js/r32-ui-runtime.js'), 'utf8');
  assert.match(source, /const contextFailure=results\.slice\(0,3\)\.find/);
  assert.match(source, /readResult=results\[3\]/);
  assert.match(source, /if\(readFailure&&previousUnread>0\)/);
  assert.match(source, /会话辅助信息加载失败，已读状态不受影响/);
  assert.doesNotMatch(source, /const failure=results\.find\(result=>result\.status==='rejected'\);if\(failure\)\{if\(previousUnread>0\)/);
});

test('draft, scroll, mute and unread state remain conversation/account keyed rather than name or avatar keyed', () => {
  const ui = fs.readFileSync(path.join(__dirname, '../../frontend/js/r32-ui-runtime.js'), 'utf8');
  const workspace = fs.readFileSync(path.join(__dirname, '../services/workspaceService.js'), 'utf8');
  assert.match(ui, /drafts\[composerOwnerId\]/);
  assert.match(ui, /drafts\[id\]/);
  assert.match(ui, /messageScroll\[activeId\]/);
  assert.match(ui, /mutedConversations\s*:\s*list/);
  assert.match(ui, /mutedAccounts\s*:\s*list/);
  assert.match(workspace, /getDocument\('conversation-drafts', contact\.id, null\)/);
  assert.doesNotMatch(ui, /drafts\[(?:c\.|contact\.)?(?:name|avatar|avatarUrl)\]/);
});
