'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  FacebookBusinessSuiteAvatarImportService,
  EXTENSION_ID,
  EXTENSION_ORIGIN,
  SOURCE,
  normalizeName
} = require('../services/facebookBusinessSuiteAvatarImportService');

const root = path.resolve(__dirname, '../..');

function harness(options = {}) {
  const records = [];
  const updates = [];
  const cached = [];
  const account = {
    id: 'facebook-account-1',
    platform: 'facebook',
    adapterAccountId: 'page-1203748086150141',
    displayName: 'Yeonhee Kim',
    identityLabel: 'Yeonhee Kim',
    metadata: {}
  };
  const conversations = options.conversations || [
    { id: 'conv-patric', sessionKey: 'conv-patric', accountId: account.id, platform: 'facebook', title: 'Patric Steiger', contactId: 'contact-patric', externalConversationId: 'thread-patric', customAvatar: false },
    { id: 'conv-klaus', sessionKey: 'conv-klaus', accountId: account.id, platform: 'facebook', title: 'Klaus Richter', contactId: 'contact-klaus', pageScopedUserId: '12345678901234567', customAvatar: false }
  ];
  const current = new Map(conversations.map(row => [row.id, { ...row }]));
  const service = new FacebookBusinessSuiteAvatarImportService({
    accountStore: {
      get: id => id === account.id ? account : null,
      record: async (action, detail) => { records.push({ action, detail }); }
    },
    messageStore: {
      listConversations: () => [...current.values()],
      getConversation: id => current.get(id) || null,
      updateConversationMetadata: async (id, patch) => {
        updates.push({ id, patch });
        const next = { ...(current.get(id) || {}), ...patch };
        current.set(id, next);
        return next;
      }
    },
    avatarService: {
      validateBuffer: buffer => ({ mimeType: 'image/png', bytes: buffer.length }),
      cacheBuffer: async input => {
        cached.push(input);
        return `/api/r32/messages/media/${input.accountId}/${input.conversationId}/contact-avatar.png`;
      }
    },
    eventBus: { publish() {} },
    logger: { warn() {} }
  });
  return { service, account, records, updates, cached, current };
}

const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2Z2kAAAAASUVORK5CYII=';

test('Business Suite importer creates a time-limited account-bound session and exact-name preview', () => {
  const h = harness();
  const session = h.service.start(h.account.id);
  assert.equal(session.active, true);
  assert.equal(session.accountName, 'Yeonhee Kim');
  assert.equal(session.extensionConnected, false);
  const preview = h.service.preview(session.sessionId, [
    { entryId: 'p1', displayName: 'Patric Steiger', avatarUrl: 'https://scontent.xx.fbcdn.net/patric.jpg', threadId: 'thread-patric' },
    { entryId: 'p2', displayName: 'Nobody Else', avatarUrl: 'https://scontent.xx.fbcdn.net/nobody.jpg' }
  ]);
  assert.deepEqual(preview.session.preview, { scanned: 2, matched: 1, new: 1, changed: 0, unchanged: 0, ambiguous: 0, unmatched: 1 });
  assert.deepEqual(preview.session.reconciliation, { potentialNewConversations: 1, messagePreviewDifferences: 0 });
  assert.equal(preview.results[0].status, 'matched');
  assert.equal(preview.results[0].reason, 'thread-id');
  assert.equal(preview.results[1].status, 'unmatched');
  assert.equal(h.service.statusForAccount(h.account.id).extensionConnected, true);
  const renewed = h.service.start(h.account.id);
  assert.equal(renewed.sessionId, session.sessionId);
  assert.ok(Date.parse(renewed.expiresAt) >= Date.parse(session.expiresAt));
});

test('Business Suite importer persists image bytes, SQLite avatar state and manual lock', async () => {
  const h = harness();
  const session = h.service.start(h.account.id);
  h.service.preview(session.sessionId, [{ entryId: 'k1', displayName: 'Klaus Richter', avatarUrl: 'https://scontent.xx.fbcdn.net/klaus.jpg' }]);
  const result = await h.service.import(session.sessionId, [{ entryId: 'k1', imageBase64: tinyPng }]);
  assert.deepEqual(result.summary, { imported: 1, skipped: 0, failed: 0 });
  assert.equal(h.cached.length, 1);
  assert.equal(h.cached[0].source, SOURCE);
  assert.equal(h.cached[0].platform, 'facebook');
  const finalPatch = h.updates.at(-1).patch;
  assert.equal(finalPatch.customAvatar, true);
  assert.equal(finalPatch.avatarLocked, true);
  assert.equal(finalPatch.avatarSource, SOURCE);
  assert.equal(finalPatch.avatarStatus, 'ready');
  assert.equal(finalPatch.avatarLastError, '');
  assert.equal(finalPatch.webCompanion.version, 1);
  assert.equal(finalPatch.webCompanion.userConfirmed, true);
  assert.equal(finalPatch.avatarImportRemoteHash.length, 16);
});

test('Business Suite importer does not overwrite a different user-confirmed manual avatar by default', async () => {
  const h = harness({ conversations: [{ id: 'conv-1', sessionKey: 'conv-1', accountId: 'facebook-account-1', platform: 'facebook', title: 'Patric Steiger', customAvatar: true, avatarSource: 'manual-upload' }] });
  const session = h.service.start(h.account.id);
  h.service.preview(session.sessionId, [{ entryId: 'p1', displayName: 'Patric Steiger', avatarUrl: 'https://scontent.xx.fbcdn.net/patric.jpg' }]);
  const result = await h.service.import(session.sessionId, [{ entryId: 'p1', imageBase64: tinyPng }]);
  assert.deepEqual(result.summary, { imported: 0, skipped: 1, failed: 0 });
  assert.equal(result.results[0].code, 'AVATAR_IMPORT_MANUAL_AVATAR_PROTECTED');
  assert.equal(h.cached.length, 0);
});

test('duplicate display names stay ambiguous and are never silently imported', () => {
  const h = harness({ conversations: [
    { id: 'c1', accountId: 'facebook-account-1', platform: 'facebook', title: 'Alex Smith' },
    { id: 'c2', accountId: 'facebook-account-1', platform: 'facebook', title: 'Alex Smith' }
  ] });
  const session = h.service.start(h.account.id);
  const preview = h.service.preview(session.sessionId, [{ entryId: 'a1', displayName: 'Alex Smith', avatarUrl: 'https://scontent.xx.fbcdn.net/a.jpg' }]);
  assert.equal(preview.results[0].status, 'ambiguous');
  assert.equal(preview.results[0].candidateNames.length, 2);
  assert.equal(preview.session.preview.matched, 0);
});

test('web companion incremental preview skips unchanged avatars and reports message differences', async () => {
  const h = harness({ conversations: [{
    id: 'conv-1', sessionKey: 'conv-1', accountId: 'facebook-account-1', platform: 'facebook',
    title: 'Patric Steiger', contactId: 'contact-1', lastMessage: 'old preview',
    avatarSource: SOURCE, avatarImportSource: SOURCE, avatarImportRemoteHash: 'placeholder'
  }] });
  const session = h.service.start(h.account.id);
  const first = h.service.preview(session.sessionId, [{ entryId: 'p1', displayName: 'Patric Steiger', avatarUrl: 'https://scontent.xx.fbcdn.net/patric-new.jpg', snippet: 'new preview' }]);
  assert.equal(first.results[0].action, 'changed');
  assert.equal(first.results[0].messagePreviewDiff, true);
  assert.equal(first.session.reconciliation.messagePreviewDifferences, 1);
  await h.service.import(session.sessionId, [{ entryId: 'p1', imageBase64: tinyPng }]);
  const second = h.service.preview(session.sessionId, [{ entryId: 'p2', displayName: 'Patric Steiger', avatarUrl: 'https://scontent.xx.fbcdn.net/patric-new.jpg', snippet: 'new preview' }]);
  assert.equal(second.results[0].action, 'unchanged');
  assert.equal(second.session.preview.unchanged, 1);
  const skipped = await h.service.import(session.sessionId, [{ entryId: 'p2', imageBase64: tinyPng }]);
  assert.equal(skipped.results[0].code, 'AVATAR_IMPORT_UNCHANGED');
});

test('extension bridge and Manifest V3 stay narrowly scoped while obsolete root installers remain quarantined', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'tools/facebook-business-suite-avatar-importer/manifest.json'), 'utf8'));
  const worker = fs.readFileSync(path.join(root, 'tools/facebook-business-suite-avatar-importer/service-worker.js'), 'utf8');
  const bridge = fs.readFileSync(path.join(root, 'backend/routes/facebookAvatarImportBridge.js'), 'utf8');
  const server = fs.readFileSync(path.join(root, 'backend/server.js'), 'utf8');
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.key.length > 100, true);
  assert.deepEqual(manifest.content_scripts[0].matches, ['https://business.facebook.com/*']);
  assert.equal(manifest.host_permissions.includes('<all_urls>'), false);
  assert.match(worker, /credentials:\s*'omit'/);
  assert.match(worker, /ALLOWED_IMAGE_HOSTS/);
  assert.match(worker, /offset \+= 6/);
  assert.equal(fs.existsSync(path.join(root, 'INSTALL_FACEBOOK_AVATAR_IMPORTER.ps1')), false);
  assert.match(bridge, /importer\.EXTENSION_ORIGIN/);
  assert.match(bridge, /importer\.EXTENSION_ID/);
  assert.equal(EXTENSION_ORIGIN, `chrome-extension://${EXTENSION_ID}`);
  assert.ok(server.indexOf("app.use('/api/bridge/facebook-avatar-import'") < server.indexOf('app.use(createR32LocalApiSecurity'));
});

test('account center exposes start, refresh and stop controls without manual file upload', () => {
  const ui = fs.readFileSync(path.join(root, 'frontend/r32-account-center.js'), 'utf8');
  const routes = fs.readFileSync(path.join(root, 'backend/routes/accounts.js'), 'utf8');
  assert.match(ui, /言策网页伴侣 · Facebook/);
  assert.match(ui, /头像补全 · 增量扫描 · 会话差异预览/);
  assert.match(ui, /facebook-avatar-import-start/);
  assert.match(ui, /facebook-avatar-import-refresh/);
  assert.match(ui, /facebook-avatar-import-stop/);
  assert.match(routes, /facebook\/avatar-import\/session/);
  assert.match(normalizeName('  Patric—Steiger '), /patric steiger/);
});
