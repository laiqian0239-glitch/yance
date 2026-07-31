'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const ROOT = path.resolve(__dirname, '../..');
const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-source-uat-round1-'));
process.env.YANCE_DATA_DIR = dataRoot;

const originalModuleLoad = Module._load;
Module._load = function mockedModuleLoad(request, parent, isMain) {
  if (request === 'qrcode') return { toDataURL: async () => 'data:image/png;base64,stub' };
  return originalModuleLoad.call(this, request, parent, isMain);
};
const adapter = require('../services/whatsappAdapter');
Module._load = originalModuleLoad;
const { getStore, closeStore } = require('../repositories/storeProvider');

const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');

test.after(() => {
  try { closeStore(); } catch (_) {}
  fs.rmSync(dataRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

test('source-mode DesktopHost forwards release and platform-auth paths to the backend child', () => {
  const main = read('electron/main.js');
  for (const name of [
    'YANCE_RELEASE_RESOURCES_PATH',
    'YANCE_PLATFORM_AUTH_CONFIG_PATH',
    'YANCE_PLATFORM_AUTH_CONFIG_SHA256_PATH'
  ]) {
    assert.match(main, new RegExp(name));
  }
  assert.match(main, /backendEnvironment\(launch\s*=\s*\{\}\)/);
  assert.match(main, /platform-auth\.json/);
  assert.match(main, /platform-auth\.sha256/);
});

test('WhatsApp source UAT requests full history and consumes Baileys history snapshots', () => {
  const source = read('backend/services/whatsappAdapter.js');
  assert.match(source, /syncFullHistory:\s*true/);
  assert.match(source, /shouldSyncHistoryMessage:\s*\(\) => true/);
  assert.match(source, /onSocket\('messaging-history\.set'/);
  assert.match(source, /persistWhatsAppDirectorySnapshot/);
  assert.match(source, /ingestWhatsAppHistoryMessages/);
  assert.match(source, /whatsapp:history-synced/);
  assert.match(source, /onSocket\('chats\.upsert'/);
  assert.match(source, /onSocket\('chats\.update'/);
});

test('WhatsApp JID normalization keeps stable person and group identities', () => {
  assert.equal(adapter.historyJid('491234567:19@s.whatsapp.net'), '491234567@s.whatsapp.net');
  assert.equal(adapter.historyJid('120363012345678@g.us'), '120363012345678@g.us');
  assert.equal(adapter.historyJid('status@broadcast'), '');
  assert.equal(adapter.historyJid('abc@newsletter'), '');
});

test('WhatsApp history contacts and chats are persisted under the canonical database account id', () => {
  const stats = adapter.persistWhatsAppDirectorySnapshot({
    databaseAccountId: 'db-whatsapp-1',
    contacts: [
      { id: '491111111:7@s.whatsapp.net', name: 'Anna' },
      { id: '120363099999999@g.us', subject: 'Berlin Team' }
    ],
    chats: [
      { id: '491111111@s.whatsapp.net', name: 'Anna', unreadCount: 3, conversationTimestamp: 1752920000 },
      { id: '120363099999999@g.us', name: 'Berlin Team', unreadCount: 0, conversationTimestamp: 1752920100 }
    ]
  });
  assert.deepEqual(stats, { contacts: 2, conversations: 2 });

  const store = getStore();
  const contacts = store.db.prepare('SELECT account_id AS accountId, external_id AS externalId, display_name AS displayName FROM contacts ORDER BY external_id').all();
  const conversations = store.listConversations({ limit: 20 });
  assert.equal(contacts.length, 2);
  assert.ok(contacts.every(row => row.accountId === 'db-whatsapp-1'));
  assert.ok(contacts.some(row => row.externalId === '491111111@s.whatsapp.net' && row.displayName === 'Anna'));
  assert.equal(conversations.length, 2);
  assert.ok(conversations.every(row => row.accountId === 'db-whatsapp-1'));
  assert.ok(conversations.some(row => row.sessionKey === 'db-whatsapp-1:491111111@s.whatsapp.net'));
});

test('WhatsApp account profile photo is fetched and exposed to account-center runtime data', async () => {
  const calls = [];
  const profile = await adapter.ownWhatsAppProfile({
    profilePictureUrl: async (jid, kind) => {
      calls.push({ jid, kind });
      return 'https://example.invalid/account-avatar.jpg';
    }
  }, { id: '491234567:8@s.whatsapp.net', name: 'Anna' });
  assert.deepEqual(calls, [{ jid: '491234567@s.whatsapp.net', kind: 'image' }]);
  assert.equal(profile.avatarUrl, 'https://example.invalid/account-avatar.jpg');
  assert.equal(profile.avatarStatus, 'ready');
});



test('WhatsApp presence and avatar subscriptions include canonical database account conversations', () => {
  const source = read('backend/services/whatsappAdapter.js');
  assert.match(source, /const databaseAccountId = row\.databaseAccountId \|\| this\.accountByAdapterId\(accountId\)\?\.id \|\| accountId;/);
  assert.match(source, /item\.accountId === databaseAccountId/);
  assert.match(source, /item\.adapterAccountId === accountId/);
});

test('account center mounts real account avatars and falls back to the display identity', () => {
  const source = read('frontend/r32-account-center.js');
  assert.match(source, /function accountAvatarUrl/);
  assert.match(source, /YanceAvatarRuntime/);
  assert.match(source, /accountAvatarMarkup\(account,p\)/);
  assert.match(source, /bindAccountAvatarFallbacks/);
});

test('contact-search navigation opens the contact workspace and focuses its search field', () => {
  const source = read('frontend/js/r32-ui-runtime.js');
  assert.match(source, /openContactsPage\(activeId\)/);
  assert.match(source, /identitySearch/);
  assert.doesNotMatch(source, /searchContact.*openConversationView/s);
});

test('theme studio exposes the expanded persisted theme catalog', () => {
  const catalog = JSON.parse(read('frontend/theme-catalog.json'));
  const ids = catalog.themes.map(theme => theme.id);
  assert.ok(ids.length >= 29, `expected at least 29 themes, received ${ids.length}`);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.match(read('frontend/r32-theme-motion.css'), new RegExp(`data-theme=["']${id}["']`));
  assert.match(read('frontend/r32-theme-motion.js'), /theme32ViewTabs/);
  assert.match(read('frontend/r32-theme-motion.js'), /saveCustomThemePreset/);
});

test('notification settings expose multi-sound per-event selectors and forced preview', () => {
  const settings = read('frontend/r32-settings-recovery.js');
  const systemCenter = read('frontend/r32-system-center.js');
  const notificationPolicy = read('backend/services/notificationPolicy.js');
  const service = read('electron/SoundNotificationService.js');
  const soundCatalog = read('shared/notificationSoundCatalog.js');
  const main = read('electron/main.js');
  assert.match(settings, /open-system-notifications/);
  for (const field of [
    'incomingSoundPattern',
    'outgoingSoundPattern',
    'failureSoundPattern',
    'presenceOnlineSoundPattern',
    'presenceOfflineSoundPattern'
  ]) assert.match(notificationPolicy, new RegExp(field));
  assert.match(systemCenter, /notificationSoundOptions/);
  assert.match(systemCenter, /force:\s*true/);
  assert.match(soundCatalog, /task-complete/);
  assert.match(soundCatalog, /warning-low/);
  assert.match(main, /payload\.force !== true && now - lastSoundAt < 650/);
});

test('WhatsApp live persistence and UI events use canonical database account ids', () => {
  const source = read('backend/services/whatsappAdapter.js');
  assert.match(source, /const requestedConversationId = `\$\{databaseAccountId\}:\$\{chatJid\}`/);
  assert.match(source, /conversation:presence'[\s\S]*accountId:\s*databaseAccountId,[\s\S]*conversationId,/);
  assert.match(source, /normalizeIncoming\(\{ accountId: databaseAccountId/);
  assert.match(source, /updateReceipt\(\{ accountId: databaseAccountId/);
  assert.match(source, /message:receipt'.*accountId: databaseAccountId/s);
  assert.match(source, /message:outbound-sent'.*accountId: databaseAccountId/s);
});
