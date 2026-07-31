'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const facebookModule = require('../services/facebookAdapter');
const relayClient = require('../services/facebookRelayClient');
const { getSecurityGuard } = require('../core/securityGuardSingleton');
const messageStore = require('../services/messageStore');
const mediaPipeline = require('../services/mediaPipeline');
const avatarService = require('../services/avatarService');
const notificationPolicy = require('../services/notificationPolicy');
const eventBus = require('../services/eventBus');
const syncCheckpoint = require('../services/syncCheckpointService');

const { FacebookAdapter } = facebookModule;
const securityGuard = getSecurityGuard();

function flushImmediate() { return new Promise(resolve => setImmediate(resolve)); }

function patch(t, object, key, value) {
  const original = object[key];
  object[key] = value;
  t.after(() => { object[key] = original; });
}

function account() {
  return {
    id: 'facebook-readiness',
    platform: 'facebook',
    credentialRef: 'credential:facebook-readiness',
    displayName: '广告主页',
    metadata: { pageId: '10001' }
  };
}

function secret(overrides = {}) {
  return {
    authorizationMode: 'cloudflare-worker',
    cloudAccountId: 'fbacct-cloud-1',
    pageId: '10001',
    permissions: ['pages_show_list', 'pages_messaging', 'pages_manage_metadata', 'pages_read_engagement'],
    workerBaseUrl: 'https://yance-facebook.example.workers.dev',
    deviceId: 'fbdev-1',
    devicePublicKeySpki: 'public-key',
    devicePrivateKeyPkcs8: 'private-key',
    tokenStatus: 'active',
    webhookStatus: 'subscribed',
    graphVersion: 'v25.0',
    ...overrides
  };
}

function cloudAccount(overrides = {}) {
  return {
    cloudAccountId: 'fbacct-cloud-1',
    pageId: '10001',
    pageName: '广告主页',
    pageUsername: 'ad-page',
    permissions: ['pages_show_list', 'pages_messaging', 'pages_manage_metadata', 'pages_read_engagement'],
    webhookStatus: 'subscribed',
    tokenStatus: 'active',
    ...overrides
  };
}

function installCredentials(t, value = secret()) {
  patch(t, securityGuard, 'readCredential', () => value);
}

test('Facebook authorization with missing required permissions is never reported connected', async t => {
  const adapter = new FacebookAdapter();
  installCredentials(t, secret({ permissions: ['pages_messaging'] }));
  patch(t, relayClient, 'accounts', async () => ({ accounts: [cloudAccount({ permissions: ['pages_messaging'] })] }));
  let relayCalls = 0;
  patch(t, relayClient, 'connect', async () => { relayCalls += 1; return { state: 'connected' }; });
  patch(t, relayClient, 'status', () => ({ state: 'unconfigured', connectedAt: '', lastError: '' }));

  const state = await adapter.connect(account());
  assert.equal(state.state, 'reauthorize');
  assert.equal(state.permissionReady, false);
  assert.deepEqual(state.missingPermissions, ['pages_show_list', 'pages_manage_metadata']);
  assert.deepEqual(state.missingOptionalPermissions, ['pages_read_engagement']);
  assert.equal(state.canSend, false);
  assert.equal(state.canReceive, false);
  assert.equal(relayCalls, 0);
});

test('Facebook Page without cloud webhook subscription can send but cannot receive', async t => {
  const adapter = new FacebookAdapter();
  installCredentials(t);
  patch(t, relayClient, 'accounts', async () => ({ accounts: [cloudAccount({ webhookStatus: 'unsubscribed' })] }));
  let relayCalls = 0;
  patch(t, relayClient, 'connect', async () => { relayCalls += 1; return { state: 'connected' }; });
  patch(t, relayClient, 'status', () => ({ state: 'unconfigured', connectedAt: '', lastError: '' }));

  const state = await adapter.connect(account());
  assert.equal(state.state, 'limited');
  assert.equal(state.permissionReady, true);
  assert.equal(state.subscriptionReady, false);
  assert.equal(state.canSend, true);
  assert.equal(state.canReceive, false);
  assert.equal(relayCalls, 0);
});

test('Facebook new messaging remains ready when only history permission is unavailable', async t => {
  const adapter = new FacebookAdapter();
  const permissions = ['pages_show_list', 'pages_messaging', 'pages_manage_metadata'];
  installCredentials(t, secret({ permissions }));
  patch(t, relayClient, 'accounts', async () => ({ accounts: [cloudAccount({ permissions })] }));
  let relayStatus = { state: 'connecting', connectedAt: '', lastError: '' };
  patch(t, relayClient, 'status', () => relayStatus);
  patch(t, relayClient, 'connect', async (_account, _secret, _onWebhook, onState) => {
    relayStatus = { state: 'connected', connectedAt: '2026-07-20T01:02:03.000Z', lastError: '', workerStatus: 'ready' };
    onState(relayStatus);
    return relayStatus;
  });
  const state = await adapter.connect(account());
  assert.equal(state.state, 'limited');
  assert.equal(state.permissionReady, true);
  assert.equal(state.newMessagingReady, true);
  assert.equal(state.historySyncAvailable, false);
  assert.deepEqual(state.missingPermissions, []);
  assert.deepEqual(state.missingOptionalPermissions, ['pages_read_engagement']);
  assert.match(state.historySyncReason, /Business Suite/);
  assert.match(state.reconciliationLastError, /pages_read_engagement/);
  assert.equal(state.reconciliationActive, false);
  assert.equal(state.canSend, true);
  assert.equal(state.canReceive, true);
});

test('Facebook becomes receive-ready only after permissions, cloud subscription and HTTPS polling are ready', async t => {
  const adapter = new FacebookAdapter();
  installCredentials(t);
  patch(t, relayClient, 'accounts', async () => ({ accounts: [cloudAccount()] }));
  let relayStatus = { state: 'connecting', connectedAt: '', lastError: '' };
  patch(t, relayClient, 'status', () => relayStatus);
  patch(t, relayClient, 'connect', async (_account, _secret, _onWebhook, onState) => {
    relayStatus = { state: 'connected', connectedAt: '2026-07-13T01:02:03.000Z', lastError: '', workerStatus: 'ready', pendingEvents: 2, deadLetter: 0 };
    onState(relayStatus);
    return relayStatus;
  });

  const state = await adapter.connect(account());
  assert.equal(state.state, 'connected');
  assert.equal(state.permissionReady, true);
  assert.equal(state.subscriptionReady, true);
  assert.deepEqual(state.subscriptionFields, ['messages']);
  assert.equal(state.canSend, true);
  assert.equal(state.canReceive, true);
  assert.equal(state.relayState, 'connected');
  assert.equal(state.workerStatus, 'ready');
  assert.equal(state.pendingEvents, 2);
});

test('Facebook status polling cannot revive send or receive after Page token expiry', t => {
  const adapter = new FacebookAdapter();
  const currentAccount = account();
  adapter.sessions.set(currentAccount.id, {
    account: currentAccount,
    state: 'connected',
    page: { id: '10001', name: '广告主页' },
    webhook: 'relay-connected',
    permissionReady: true,
    subscriptionReady: true,
    historySyncAvailable: true,
    tokenStatus: 'expired',
    canSend: true,
    canReceive: true,
    missingPermissions: [],
    missingOptionalPermissions: [],
    permissions: ['pages_show_list', 'pages_messaging', 'pages_manage_metadata', 'pages_read_engagement'],
    subscriptionFields: ['messages']
  });
  patch(t, relayClient, 'status', () => ({ state: 'connected', connectedAt: '2026-07-24T01:02:03.000Z', lastError: '' }));

  const state = adapter.status(currentAccount.id);
  assert.equal(state.state, 'reauthorize');
  assert.equal(state.tokenStatus, 'expired');
  assert.equal(state.canSend, false);
  assert.equal(state.canReceive, false);
  assert.match(state.lastError, /Token.*expired/iu);
});

test('Facebook status polling keeps outbound ready but disables inbound while relay reconnects', t => {
  const adapter = new FacebookAdapter();
  const currentAccount = account();
  adapter.sessions.set(currentAccount.id, {
    account: currentAccount,
    state: 'connected',
    page: { id: '10001', name: '广告主页' },
    webhook: 'relay-connected',
    permissionReady: true,
    subscriptionReady: true,
    historySyncAvailable: true,
    tokenStatus: 'active',
    canSend: true,
    canReceive: true,
    missingPermissions: [],
    missingOptionalPermissions: [],
    permissions: ['pages_show_list', 'pages_messaging', 'pages_manage_metadata', 'pages_read_engagement'],
    subscriptionFields: ['messages']
  });
  patch(t, relayClient, 'status', () => ({ state: 'connecting', connectedAt: '', lastError: '' }));

  const state = adapter.status(currentAccount.id);
  assert.equal(state.state, 'connecting');
  assert.equal(state.canSend, true);
  assert.equal(state.canReceive, false);
  assert.equal(state.webhook, 'relay-connecting');
});

test('Facebook readiness helpers require the current Page permission set and normalize webhook fields', () => {
  assert.deepEqual(facebookModule.missingPermissions(['pages_messaging', 'pages_messaging']), ['pages_show_list', 'pages_manage_metadata']);
  assert.deepEqual(facebookModule.missingOptionalPermissions(['pages_show_list', 'pages_messaging', 'pages_manage_metadata']), ['pages_read_engagement']);
  assert.deepEqual(
    facebookModule.subscriptionFields([{ subscribed_fields: ['messages', 'messages'] }, { subscribed_fields: ['messaging_postbacks'] }]),
    ['messages', 'messaging_postbacks']
  );
});

test('Facebook ad referral metadata is normalized without retaining arbitrary nested payloads', () => {
  const referral = facebookModule.normalizeReferral({
    source: 'ADS', type: 'OPEN_THREAD', ref: 'campaign-summer', ad_id: '998877', flow_id: 'flow-42',
    ads_context_data: { ad_title: '夏季活动', photo_url: 'https://cdn.example/ad.jpg', ignored_secret: 'must-not-survive' },
    ignored_token: 'must-not-survive'
  });
  assert.deepEqual(referral, {
    source: 'ADS', type: 'OPEN_THREAD', ref: 'campaign-summer', adId: '998877', flowId: 'flow-42', adTitle: '夏季活动',
    postId: '', productId: '', photoUrl: 'https://cdn.example/ad.jpg', videoUrl: ''
  });
  assert.equal(facebookModule.referralMessageText(referral), '客户通过 Facebook 广告「夏季活动」进入会话');
});

test('standalone Click-to-Messenger referral creates a local inbox event and conversation attribution', async t => {
  const adapter = new FacebookAdapter();
  const currentAccount = account();
  installCredentials(t);
  patch(t, adapter, 'senderProfile', async () => ({ name: '广告客户', avatarUrl: '' }));
  patch(t, avatarService, 'needsRefresh', () => false);
  patch(t, messageStore, 'getConversation', () => ({ id: `${currentAccount.id}:user-9`, title: '广告客户', avatarUrl: '' }));
  let insertedMessage = null;
  patch(t, messageStore, 'upsert', async value => { insertedMessage = value; return { inserted: true, message: value, conversation: { title: '广告客户', avatarUrl: '' } }; });
  let metadataPatch = null;
  patch(t, messageStore, 'updateConversationMetadata', async (_id, value) => { metadataPatch = value; return value; });
  let notification = null;
  patch(t, notificationPolicy, 'notify', value => { notification = value; });

  const result = await adapter.handleWebhook({ object: 'page', entry: [{ id: '10001', messaging: [{
    sender: { id: 'user-9' }, recipient: { id: '10001' }, timestamp: 1783920000000,
    referral: { source: 'ADS', type: 'OPEN_THREAD', ad_id: 'ad-77', ref: 'summer', ads_context_data: { ad_title: '夏季广告' } }
  }] }] }, [currentAccount]);

  assert.equal(result.accepted, 1);
  assert.equal(insertedMessage.type, 'referral');
  assert.equal(insertedMessage.source, 'facebook-ad-referral');
  assert.equal(insertedMessage.acquisitionSource, 'facebook-ad');
  assert.equal(insertedMessage.facebookReferral.adId, 'ad-77');
  assert.equal(insertedMessage.text, '客户通过 Facebook 广告「夏季广告」进入会话');
  assert.equal(metadataPatch.facebookAdId, 'ad-77');
  assert.equal(notification.body, '客户通过 Facebook 广告「夏季广告」进入会话');
});

test('Facebook cloud history sync imports real history without exposing Page Token to Windows', async t => {
  const adapter = new FacebookAdapter();
  const currentAccount = account();
  installCredentials(t);
  patch(t, adapter, 'senderProfile', async () => ({ name: '广告客户', avatarUrl: '' }));
  const calls = [];
  patch(t, relayClient, 'history', async (_secret, query) => {
    calls.push({ type: 'conversations', query });
    return { data: [{
      id: 'conversation-1', updated_time: '2026-07-13T04:00:00+0000', unread_count: 1,
      participants: { data: [{ id: '10001', name: '广告主页' }, { id: 'user-42', name: '广告客户' }] },
      messages: { data: [
        { id: 'message-2', created_time: '2026-07-13T04:00:00+0000', from: { id: '10001', name: '广告主页' }, to: { data: [{ id: 'user-42' }] }, message: '你好，需要我介绍一下吗？' },
        { id: 'message-1', created_time: '2026-07-13T03:59:00+0000', from: { id: 'user-42', name: '广告客户' }, to: { data: [{ id: '10001' }] }, message: '我从广告来的', attachments: { data: [{ id: 'a-1', mime_type: 'image/jpeg', image_data: { url: 'https://cdn.example/image.jpg' } }] } }
      ], paging: { cursors: {} } }
    }], paging: { cursors: {}, next: '' } };
  });
  patch(t, relayClient, 'historyMessages', async () => { throw new Error('should not paginate embedded complete page'); });
  patch(t, messageStore, 'getConversation', () => ({ unreadCount: 7, avatarUrl: '' }));
  const imported = [];
  patch(t, messageStore, 'upsert', async value => { imported.push(value); return { inserted: true, message: value, conversation: {} }; });
  let conversationPatch = null;
  patch(t, messageStore, 'updateConversationMetadata', async (_id, value) => { conversationPatch = value; return value; });

  const result = await adapter.sync(currentAccount);

  assert.equal(calls.length, 1);
  assert.equal(imported.length, 2);
  assert.deepEqual(imported.map(message => message.externalMessageId), ['message-1', 'message-2']);
  assert.equal(imported[0].direction, 'inbound');
  assert.equal(imported[0].attachments[0].kind, 'image');
  assert.equal(imported[1].direction, 'outbound');
  assert.equal(imported[1].deliveryStatus, 'sent');
  assert.equal(conversationPatch.externalConversationId, 'conversation-1');
  assert.equal(conversationPatch.unreadCount, 1);
  assert.equal(JSON.stringify(calls).includes('page-token'), false);
  assert.deepEqual(result, { conversations: 1, messagesScanned: 2, messagesInserted: 2, avatars: 0, failedConversations: 0, syncedAt: result.syncedAt });
});

test('Facebook Worker media persists a visible placeholder before asynchronous caching', async t => {
  const adapter = new FacebookAdapter();
  const currentAccount = account();
  installCredentials(t);
  patch(t, adapter, 'senderProfile', async () => ({ name: '媒体客户', avatarUrl: '' }));
  patch(t, avatarService, 'needsRefresh', () => false);
  patch(t, messageStore, 'getConversation', () => null);
  const upserts = [];
  patch(t, messageStore, 'upsert', async value => { upserts.push(value); return { inserted: upserts.length === 1, message: value, conversation: { title: '媒体客户' } }; });
  patch(t, mediaPipeline, 'saveFile', value => ({ id: 'saved-media', kind: 'image', localPath: value.filePath, status: 'ready', downloadStatus: 'ready' }));
  patch(t, relayClient, 'downloadMedia', async (_secret, eventId, index, outputPath) => {
    assert.equal(eventId, 'fbevt-media-1'); assert.equal(index, 0);
    fs.writeFileSync(outputPath, Buffer.from('image-bytes'), { flag: 'wx' });
    return { bytes: 11, mimeType: 'image/jpeg', filename: 'photo.jpg' };
  });
  patch(t, notificationPolicy, 'notify', () => {});

  const result = await adapter.handleWebhook({ object: 'page', entry: [{ id: '10001', messaging: [{
    sender: { id: '123456' }, recipient: { id: '10001' }, timestamp: Date.now(),
    message: { mid: 'mid-media-1', attachments: [{ type: 'image', payload: { worker_media: { event_id: 'fbevt-media-1', index: 0, mime_type: 'image/jpeg', filename: 'photo.jpg', size: 11 } } }] }
  }] }] }, [currentAccount]);

  assert.equal(result.accepted, 1);
  assert.equal(upserts.length, 1);
  assert.equal(upserts[0].attachments[0].status, 'pending');
  await flushImmediate();
  assert.equal(upserts.length, 2);
  assert.equal(upserts[1].attachments[0].status, 'ready');
});


test('Facebook Worker media failure keeps the message and marks only the attachment retryable', async t => {
  const adapter = new FacebookAdapter();
  const currentAccount = account();
  installCredentials(t);
  patch(t, adapter, 'senderProfile', async () => ({ name: '媒体客户', avatarUrl: '' }));
  patch(t, avatarService, 'needsRefresh', () => false);
  patch(t, messageStore, 'getConversation', () => null);
  const upserts = [];
  patch(t, messageStore, 'upsert', async value => { upserts.push(value); return { inserted: upserts.length === 1, message: value, conversation: {} }; });
  patch(t, relayClient, 'downloadMedia', async () => { throw Object.assign(new Error('temporary worker media error'), { code: 'FACEBOOK_MEDIA_NOT_AVAILABLE', status: 503 }); });

  const result = await adapter.handleWebhook({ object: 'page', entry: [{ id: '10001', messaging: [{
    sender: { id: '123456' }, recipient: { id: '10001' }, timestamp: Date.now(),
    message: { mid: 'mid-media-retry', attachments: [{ type: 'image', payload: { worker_media: { event_id: 'fbevt-media-retry', index: 0, mime_type: 'image/jpeg' } } }] }
  }] }] }, [currentAccount]);
  assert.equal(result.accepted, 1);
  assert.equal(upserts[0].attachments[0].status, 'pending');
  await flushImmediate();
  assert.equal(upserts.length, 2);
  assert.equal(upserts[1].attachments[0].status, 'failed');
  assert.equal(upserts[1].attachments[0].retryable, true);
});



test('Facebook Business Suite reconciliation resumes from a durable cursor and resets after the final page', async t => {
  const adapter = new FacebookAdapter();
  const currentAccount = account();
  installCredentials(t);
  const historyCalls = [];
  patch(t, relayClient, 'history', async (_secret, input) => {
    historyCalls.push(input.after || '');
    if (input.after === 'cursor-start') return { data: [], paging: { cursors: { after: 'cursor-next' }, next: 'available' } };
    return { data: [], paging: { cursors: { after: '' }, next: '' } };
  });
  patch(t, syncCheckpoint, 'read', () => ({ cursor: 'cursor-start' }));
  let begun = null;
  let committed = null;
  patch(t, syncCheckpoint, 'begin', input => { begun = input; return { batchId: 'fb-sync-batch' }; });
  patch(t, syncCheckpoint, 'commit', input => { committed = input; return input; });
  patch(t, syncCheckpoint, 'fail', () => { throw new Error('unexpected checkpoint failure'); });

  const result = await adapter.sync(currentAccount, { source: 'facebook-history-periodic-reconciliation', maximumConversations: 50 });
  assert.deepEqual(historyCalls, ['cursor-start', 'cursor-next']);
  assert.equal(begun.cursor, 'cursor-start');
  assert.equal(committed.cursor, '');
  assert.equal(result.reconciliationCursor, '');
  assert.equal(result.cursorAdvanced, true);
});

test('Windows FacebookAdapter refuses all direct Graph API calls', async () => {
  const adapter = new FacebookAdapter();
  await assert.rejects(adapter.request('https://graph.facebook.com/v25.0/me'), error => error.code === 'FACEBOOK_DIRECT_GRAPH_FORBIDDEN');
});


test('Windows legacy media fallback revalidates every redirect destination', async t => {
  const adapter = new FacebookAdapter();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, { status: 302, headers: { location: 'https://evil.example/steal' } });
  t.after(() => { globalThis.fetch = originalFetch; });
  await assert.rejects(adapter.fetchAttachmentUrl('https://cdn.fbcdn.net/source.jpg'), error => error.code === 'FACEBOOK_MEDIA_URL_BLOCKED');
});

test('Facebook history helpers reject untrusted pagination hosts and normalize attachment descriptors', () => {
  assert.throws(() => facebookModule.safeGraphPagingUrl('https://attacker.example/steal?access_token=x'), error => error.code === 'FACEBOOK_GRAPH_PAGING_URL_INVALID');
  assert.equal(facebookModule.safeGraphPagingUrl('https://graph.facebook.com/v25.0/page/conversations?after=1&access_token=must-not-survive'), 'https://graph.facebook.com/v25.0/page/conversations?after=1');
  assert.deepEqual(
    facebookModule.graphAttachments({ attachments: { data: [{ id: 'doc-1', mime_type: 'application/pdf', name: '报价.pdf', file_url: 'https://cdn.example/quote.pdf' }] } }),
    [{ id: 'doc-1', kind: 'document', mimeType: 'application/pdf', filename: '报价.pdf', size: 0, sourceUrl: 'https://cdn.example/quote.pdf', url: 'https://cdn.example/quote.pdf', mediaUrl: 'https://cdn.example/quote.pdf', status: 'remote', downloadStatus: 'remote' }]
  );
});

test('Facebook delivery, read, reaction and delete events update existing local messages without creating duplicates', async t => {
  const adapter = new FacebookAdapter();
  const currentAccount = account();
  installCredentials(t);
  const receipts = [];
  const through = [];
  const reactions = [];
  const revoked = [];
  let upserts = 0;
  patch(t, messageStore, 'updateReceipt', async value => { receipts.push(value); return value; });
  patch(t, messageStore, 'updateReceiptsThrough', async value => { through.push(value); return { count: 2 }; });
  patch(t, messageStore, 'applyReaction', async value => { reactions.push(value); return value; });
  patch(t, messageStore, 'revoke', async value => { revoked.push(value); return value; });
  patch(t, messageStore, 'upsert', async () => { upserts += 1; return { inserted: false }; });
  patch(t, eventBus, 'publish', () => {});

  const result = await adapter.handleWebhook({ object: 'page', entry: [{ id: '10001', messaging: [
    { sender: { id: 'user-1' }, recipient: { id: '10001' }, timestamp: Date.now(), delivery: { mids: ['mid-a','mid-b'], watermark: Date.now() } },
    { sender: { id: 'user-1' }, recipient: { id: '10001' }, timestamp: Date.now(), read: { watermark: Date.now() } },
    { sender: { id: 'user-1' }, recipient: { id: '10001' }, timestamp: Date.now(), reaction: { mid: 'mid-a', action: 'react', emoji: '❤' } },
    { sender: { id: 'user-1' }, recipient: { id: '10001' }, timestamp: Date.now(), message: { mid: 'mid-b', is_deleted: true } }
  ] }] }, [currentAccount]);

  assert.equal(result.accepted, 0);
  assert.deepEqual(receipts.map(row => row.messageId), ['mid-a','mid-b']);
  assert.equal(through.length, 1);
  assert.equal(through[0].chatJid, 'facebook:user-1');
  assert.equal(reactions.length, 1);
  assert.equal(reactions[0].targetId, 'mid-a');
  assert.equal(reactions[0].emoji, '❤');
  assert.equal(revoked.length, 1);
  assert.equal(revoked[0].targetId, 'mid-b');
  assert.equal(upserts, 0);
});

test('Facebook outbound echo is persisted as outbound and never triggers an incoming notification', async t => {
  const adapter = new FacebookAdapter();
  const currentAccount = account();
  installCredentials(t);
  patch(t, adapter, 'senderProfile', async () => ({ name: '客户', avatarUrl: '' }));
  patch(t, avatarService, 'needsRefresh', () => false);
  patch(t, messageStore, 'getConversation', () => ({ title: '客户', avatarUrl: '' }));
  let inserted = null;
  patch(t, messageStore, 'upsert', async value => { inserted = value; return { inserted: true, message: value, conversation: { title: '客户' } }; });
  let notifications = 0;
  patch(t, notificationPolicy, 'notify', () => { notifications += 1; });

  const result = await adapter.handleWebhook({ object: 'page', entry: [{ id: '10001', messaging: [{
    sender: { id: '10001' }, recipient: { id: 'user-echo' }, timestamp: Date.now(),
    message: { mid: 'mid-echo-1', is_echo: true, text: '已发送回复' }
  }] }] }, [currentAccount]);

  assert.equal(result.accepted, 0);
  assert.equal(inserted.direction, 'outbound');
  assert.equal(inserted.fromMe, true);
  assert.equal(inserted.chatJid, 'facebook:user-echo');
  assert.equal(inserted.conversationId, `${currentAccount.id}:user-echo`);
  assert.equal(notifications, 0);
});

test('Facebook page avatar proxy runs asynchronously after realtime connection is available', async t => {
  const adapter = new FacebookAdapter();
  installCredentials(t);
  patch(t, relayClient, 'accounts', async () => ({ accounts: [cloudAccount({ pagePicture: '', picture: '' })] }));
  let pageAvatarCalls = 0;
  patch(t, relayClient, 'avatarBuffer', async (_secret, kind) => {
    assert.equal(kind, 'page');
    pageAvatarCalls += 1;
    return { buffer: Buffer.from('page-avatar') };
  });
  patch(t, avatarService, 'cacheStandaloneBuffer', async () => ({ avatarUrl: '/api/r32/messages/media/facebook/page-avatar.jpg' }));
  patch(t, relayClient, 'status', () => ({ state: 'connected', connectedAt: '2026-07-21T00:00:00.000Z', lastError: '' }));
  patch(t, relayClient, 'connect', async () => ({ state: 'connected', connectedAt: '2026-07-21T00:00:00.000Z', lastError: '' }));

  const state = await adapter.connect(account());
  assert.equal(state.state, 'connected');
  assert.equal(pageAvatarCalls, 0);
  await flushImmediate();
  const enriched = adapter.status('facebook-readiness');
  assert.equal(pageAvatarCalls, 1);
  assert.equal(enriched.page.picture, '/api/r32/messages/media/facebook/page-avatar.jpg');
});

test('Facebook first-message profile avatar uses signed Worker proxy before a conversation row exists', async t => {
  const adapter = new FacebookAdapter();
  installCredentials(t);
  patch(t, relayClient, 'profile', async () => ({ firstName: 'Anna', lastName: 'Meyer', profilePicture: '' }));
  let proxyCalls = 0;
  patch(t, relayClient, 'avatarBuffer', async (_secret, kind, senderId) => {
    assert.equal(kind, 'profile');
    assert.equal(senderId, 'user-42');
    proxyCalls += 1;
    return { buffer: Buffer.from('profile-avatar') };
  });
  patch(t, messageStore, 'getConversation', () => null);
  let standaloneInput = null;
  patch(t, avatarService, 'cacheStandaloneBuffer', async input => {
    standaloneInput = input;
    return { avatarUrl: '/api/r32/messages/media/facebook/user-42-avatar.jpg' };
  });
  patch(t, avatarService, 'cacheBuffer', async () => { throw new Error('must not require an existing conversation'); });

  const profile = await adapter.senderProfile(account(), 'facebook:user-42', 'facebook-readiness:user-42');
  assert.equal(proxyCalls, 1);
  assert.equal(profile.name, 'Anna Meyer');
  assert.equal(profile.avatarUrl, '/api/r32/messages/media/facebook/user-42-avatar.jpg');
  assert.match(standaloneInput.assetKey, /user-42/u);
});

test('Facebook profile-name failure does not suppress the independent avatar request', async t => {
  const adapter = new FacebookAdapter();
  installCredentials(t);
  patch(t, relayClient, 'profile', async () => {
    throw Object.assign(new Error('profile unavailable'), { code: 'FACEBOOK_PROFILE_UNAVAILABLE', status: 502 });
  });
  let proxyCalls = 0;
  patch(t, relayClient, 'avatarBuffer', async (_secret, kind, senderId) => {
    assert.equal(kind, 'profile');
    assert.equal(senderId, 'user-42');
    proxyCalls += 1;
    return { buffer: Buffer.from('profile-avatar') };
  });
  patch(t, messageStore, 'getConversation', () => null);
  patch(t, avatarService, 'cacheStandaloneBuffer', async () => ({ avatarUrl: '/api/r32/messages/media/facebook/user-42-avatar.jpg' }));

  const profile = await adapter.senderProfile(account(), 'facebook:user-42', 'facebook-readiness:user-42');
  assert.equal(proxyCalls, 1);
  assert.equal(profile.avatarUrl, '/api/r32/messages/media/facebook/user-42-avatar.jpg');
  assert.equal(profile.profileStatus, 'failed');
  assert.equal(profile.profileLastError, 'FACEBOOK_PROFILE_UNAVAILABLE');
});

test('Facebook page-avatar failure remains visible in account runtime instead of being reported as healthy avatar state', async t => {
  const adapter = new FacebookAdapter();
  installCredentials(t);
  patch(t, relayClient, 'accounts', async () => ({ accounts: [cloudAccount()] }));
  patch(t, relayClient, 'avatarBuffer', async () => {
    throw Object.assign(new Error('avatar unavailable'), { code: 'FACEBOOK_AVATAR_FETCH_FAILED', status: 403 });
  });
  patch(t, relayClient, 'status', () => ({ state: 'connected', connectedAt: '2026-07-21T00:00:00.000Z', lastError: '' }));
  patch(t, relayClient, 'connect', async () => ({ state: 'connected', connectedAt: '2026-07-21T00:00:00.000Z', lastError: '' }));

  const state = await adapter.connect(account());
  assert.equal(state.state, 'connected');
  await flushImmediate();
  const enriched = adapter.status('facebook-readiness');
  assert.equal(enriched.page.avatarStatus, 'failed');
  assert.equal(enriched.page.avatarLastError, 'FACEBOOK_AVATAR_FETCH_FAILED');
});

test('Facebook reconnect schedules avatar repair for existing contacts without waiting for history sync or a new webhook', async t => {
  const adapter = new FacebookAdapter();
  installCredentials(t);
  patch(t, relayClient, 'accounts', async () => ({ accounts: [cloudAccount()] }));
  patch(t, relayClient, 'avatarBuffer', async (_secret, kind) => ({ buffer: Buffer.from(kind === 'page' ? 'page-avatar' : 'contact-avatar') }));
  patch(t, avatarService, 'cacheStandaloneBuffer', async () => ({ avatarUrl: '/api/r32/messages/media/facebook/page-avatar.jpg', avatarUpdatedAt: '2026-07-21T00:00:00.000Z' }));
  patch(t, relayClient, 'status', () => ({ state: 'connected', connectedAt: '2026-07-21T00:00:00.000Z', lastError: '' }));
  patch(t, relayClient, 'connect', async () => ({ state: 'connected', connectedAt: '2026-07-21T00:00:00.000Z', lastError: '' }));
  let scheduled = 0;
  patch(t, adapter, 'scheduleExistingContactAvatarRepair', input => {
    assert.equal(input.id, 'facebook-readiness');
    scheduled += 1;
    return Promise.resolve({ scanned: 0 });
  });

  const state = await adapter.connect(account());
  assert.equal(state.state, 'connected');
  assert.equal(scheduled, 1);
});

test('Facebook existing-contact repair resolves PSID from persisted chatJid and writes the cached avatar', async t => {
  const adapter = new FacebookAdapter();
  installCredentials(t);
  const conversationId = 'facebook-readiness:123456';
  let current = {
    id: conversationId,
    conversationId,
    sessionKey: conversationId,
    platform: 'facebook',
    accountId: 'facebook-readiness',
    chatJid: 'facebook:123456',
    title: 'Anna Meyer',
    avatarUrl: '',
    avatarStatus: ''
  };
  patch(t, messageStore, 'listConversations', () => [current]);
  patch(t, messageStore, 'getConversation', () => current);
  patch(t, messageStore, 'updateConversationMetadata', async (_id, patchValue) => {
    current = { ...current, ...patchValue, avatarUrl: patchValue.avatarUrl || current.avatarUrl };
    return current;
  });
  patch(t, avatarService, 'needsRefresh', () => true);
  patch(t, relayClient, 'profile', async () => ({ firstName: 'Anna', lastName: 'Meyer' }));
  let profilePsid = '';
  patch(t, relayClient, 'avatarBuffer', async (_secret, kind, psid) => {
    assert.equal(kind, 'profile');
    profilePsid = psid;
    return { buffer: Buffer.from('contact-avatar') };
  });
  patch(t, avatarService, 'cacheBuffer', async ({ conversationId: actual }) => {
    assert.equal(actual, conversationId);
    return { avatarUrl: '/api/r32/messages/media/facebook/contact-avatar.jpg', avatarUpdatedAt: '2026-07-21T00:00:00.000Z' };
  });

  const result = await adapter.refreshExistingContactAvatars(account(), { limit: 10, delayMs: 0 });
  assert.equal(profilePsid, '123456');
  assert.equal(result.attempted, 1);
  assert.equal(result.ready, 1);
  assert.equal(result.failed, 0);
  assert.equal(current.avatarUrl, '/api/r32/messages/media/facebook/contact-avatar.jpg');
  assert.equal(current.avatarStatus, 'ready');
  assert.equal(current.avatarLastError, '');
});

test('Facebook existing-contact repair persists an explicit failure when no valid PSID can be recovered', async t => {
  const adapter = new FacebookAdapter();
  const conversationId = 'facebook-readiness:not-a-psid';
  let current = {
    id: conversationId,
    conversationId,
    sessionKey: conversationId,
    platform: 'facebook',
    accountId: 'facebook-readiness',
    chatJid: 'facebook:unknown',
    avatarUrl: '',
    avatarStatus: ''
  };
  patch(t, messageStore, 'listConversations', () => [current]);
  patch(t, messageStore, 'updateConversationMetadata', async (_id, patchValue) => {
    current = { ...current, ...patchValue };
    return current;
  });
  patch(t, avatarService, 'needsRefresh', () => true);
  let senderProfileCalls = 0;
  patch(t, adapter, 'senderProfile', async () => { senderProfileCalls += 1; return {}; });

  const result = await adapter.refreshExistingContactAvatars(account(), { limit: 10, delayMs: 0 });
  assert.equal(senderProfileCalls, 0);
  assert.equal(result.attempted, 0);
  assert.equal(result.failed, 1);
  assert.equal(current.avatarStatus, 'failed');
  assert.equal(current.avatarLastError, 'FACEBOOK_CONTACT_PSID_MISSING');
});

test('Facebook first-contact webhook persists and notifies before optional profile/avatar enrichment', async t => {
  const adapter = new FacebookAdapter();
  const currentAccount = account();
  installCredentials(t);
  patch(t, messageStore, 'getConversation', () => null);
  patch(t, avatarService, 'needsRefresh', () => true);
  patch(t, adapter, 'senderProfile', async () => {
    throw new Error('senderProfile must not run on the critical webhook persistence path');
  });
  let enrichment = null;
  patch(t, adapter, 'scheduleWebhookContactEnrichment', (...args) => {
    enrichment = args;
    return Promise.resolve({ ok: true });
  });
  let persisted = null;
  patch(t, messageStore, 'upsert', async value => {
    persisted = value;
    return {
      inserted: true,
      message: value,
      conversation: { title: value.contactName, contactName: value.contactName, avatarUrl: '' }
    };
  });
  let notification = null;
  patch(t, notificationPolicy, 'notify', value => { notification = value; });

  const result = await adapter.handleWebhook({ object: 'page', entry: [{ id: '10001', messaging: [{
    sender: { id: '10000000000000999' },
    recipient: { id: '10001' },
    timestamp: Date.now(),
    message: { mid: 'mid-first-contact-realtime', text: 'Hallo' }
  }] }] }, [currentAccount]);

  assert.equal(result.accepted, 1);
  assert.equal(persisted.externalMessageId, 'mid-first-contact-realtime');
  assert.equal(persisted.direction, 'inbound');
  assert.equal(persisted.pageScopedUserId, '10000000000000999');
  assert.equal(persisted.contactExternalId, '10000000000000999');
  assert.equal(persisted.contactName, 'Facebook Messenger 联系人');
  assert.equal(notification.body, 'Hallo');
  assert.equal(notification.conversationId, `${currentAccount.id}:10000000000000999`);
  assert.equal(enrichment[1], '10000000000000999');
  assert.equal(enrichment[2], `${currentAccount.id}:10000000000000999`);
});

test('Facebook webhook contact enrichment is asynchronous, deduplicated and non-destructive', async t => {
  const adapter = new FacebookAdapter();
  const currentAccount = account();
  let releaseProfile;
  const profileGate = new Promise(resolve => { releaseProfile = resolve; });
  let profileCalls = 0;
  patch(t, adapter, 'senderProfile', async () => {
    profileCalls += 1;
    await profileGate;
    return { name: 'Michael Catalin', avatarUrl: '/api/r32/messages/media/avatar-michael', profileStatus: 'ready', profileLastError: '' };
  });
  let metadata = null;
  patch(t, messageStore, 'updateConversationMetadata', async (_conversationId, value) => { metadata = value; return value; });

  const first = adapter.scheduleWebhookContactEnrichment(currentAccount, '10000000000000888', `${currentAccount.id}:10000000000000888`, 'Facebook Messenger 联系人');
  const second = adapter.scheduleWebhookContactEnrichment(currentAccount, '10000000000000888', `${currentAccount.id}:10000000000000888`, 'Facebook Messenger 联系人');
  assert.equal(first, second);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(profileCalls, 1);
  releaseProfile();
  const result = await first;

  assert.equal(result.ok, true);
  assert.equal(metadata.title, 'Michael Catalin');
  assert.equal(metadata.contactName, 'Michael Catalin');
  assert.equal(metadata.avatarUrl, '/api/r32/messages/media/avatar-michael');
  assert.equal(metadata.profileStatus, 'ready');
  assert.equal(adapter.webhookContactEnrichmentTasks.size, 0);
});

test('Facebook notification failure never rolls back an already persisted inbound message', async t => {
  const adapter = new FacebookAdapter();
  const currentAccount = account();
  installCredentials(t);
  patch(t, messageStore, 'getConversation', () => ({ title: 'Mario Neefe', contactName: 'Mario Neefe', avatarUrl: '' }));
  patch(t, avatarService, 'needsRefresh', () => false);
  let upserts = 0;
  patch(t, messageStore, 'upsert', async value => {
    upserts += 1;
    return { inserted: true, message: value, conversation: { title: 'Mario Neefe', contactName: 'Mario Neefe', avatarUrl: '' } };
  });
  patch(t, notificationPolicy, 'notify', () => { throw new Error('desktop notification temporarily unavailable'); });

  const result = await adapter.handleWebhook({ object: 'page', entry: [{ id: '10001', messaging: [{
    sender: { id: '10000000000000777' }, recipient: { id: '10001' }, timestamp: Date.now(),
    message: { mid: 'mid-notification-failure', text: 'incoming still persists' }
  }] }] }, [currentAccount]);

  assert.equal(upserts, 1);
  assert.equal(result.accepted, 1);
});
