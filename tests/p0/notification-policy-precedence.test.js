'use strict';

// AC-013 会话级与平台级静音 — 后端 notificationPolicy.decision 优先级表冻结 + 平台静音单一写入器
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-p0-notification-precedence-'));
process.env.YANCE_DATA_DIR = dataRoot;
process.env.WORKBUDDY_DATA_DIR = dataRoot;
process.env.YANCE_TEST_ONLY_SQLITE_BROKER_RESET = '1';

const { acquireAuthorityWriteHost } = require('../../backend/services/authorityWriteHost');
const {
  createSqliteConnectionBroker,
  resetSqliteConnectionBrokerForTests
} = require('../../backend/lib/sqliteConnectionBroker');
const { closeR32Store } = require('../../backend/lib/r32StoreSingleton');

const dbPath = path.join(dataRoot, 'store', 'yance-r32.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const authorityWriteHost = acquireAuthorityWriteHost({
  dbPath,
  instanceId: `p0-notification-precedence-${process.pid}`
});

createSqliteConnectionBroker({
  dbPath,
  authorityWriteHostCapability: authorityWriteHost.capability
});

const np = require('../../backend/services/notificationPolicy.js');

test.after(() => {
  try { closeR32Store(); } catch (_) {}
  try { resetSqliteConnectionBrokerForTests(); } catch (_) {}
  try { authorityWriteHost.close(); } catch (_) {}
  fs.rmSync(dataRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  delete process.env.YANCE_TEST_ONLY_SQLITE_BROKER_RESET;
  delete process.env.WORKBUDDY_DATA_DIR;
  delete process.env.YANCE_DATA_DIR;
});

async function reset() {
  await np.update({
    enabled: true,
    desktopEnabled: true,
    paused: false,
    focused: false,
    activeConversationId: '',
    mutedConversations: [],
    mutedAccounts: [],
    mutedPlatforms: [],
    dnd: { enabled: false, start: '22:30', end: '07:30' }
  });
}

test('AC-013 backend precedence resolves in frozen order: active > conversation > account > platform > dnd > allowed', async () => {
  await reset();

  // active-conversation outranks conversation mute
  await np.update({ focused: true, activeConversationId: 'c1', mutedConversations: ['c1'] });
  assert.equal(np.decision({ conversationId: 'c1' }).reason, 'active-conversation');

  // muted-conversation outranks muted-account
  await np.update({ focused: false, activeConversationId: '', mutedConversations: ['c1'], mutedAccounts: ['acc1'] });
  assert.equal(np.decision({ conversationId: 'c1', accountId: 'acc1' }).reason, 'muted-conversation');

  // muted-account outranks muted-platform
  await np.update({ mutedConversations: [], mutedAccounts: ['acc1'], mutedPlatforms: ['tel'] });
  assert.equal(np.decision({ accountId: 'acc1', platform: 'tel' }).reason, 'muted-account');

  // muted-platform outranks dnd
  await np.update({ mutedAccounts: [], dnd: { enabled: true, start: '00:00', end: '23:59' } });
  assert.equal(np.decision({ platform: 'tel' }).reason, 'muted-platform');

  // dnd outranks allowed
  await np.update({ mutedPlatforms: [] });
  assert.equal(np.decision({ conversationId: 'c9' }).reason, 'dnd');

  // paused outranks active-conversation
  await np.update({ paused: true, dnd: { enabled: false } });
  assert.equal(np.decision({ conversationId: 'c1', focused: true, activeConversationId: 'c1' }).reason, 'paused');
});

test('AC-013 platform mute: mutedPlatforms silences that platform only; other platforms still allowed', async () => {
  await reset();
  await np.update({ mutedPlatforms: ['telegram'] });
  assert.equal(np.decision({ platform: 'telegram', conversationId: 'c1' }).reason, 'muted-platform');
  assert.equal(np.decision({ platform: 'whatsapp', conversationId: 'c1' }).reason, 'allowed');
  // 单一权威写入器：update() 是唯一变更路径，decision 直接读它
  assert.deepEqual(np.read().mutedPlatforms, ['telegram']);
});

test('AC-013 single authoritative writer: update() is the only mutation entry; decision reflects it', async () => {
  await reset();
  await np.update({ mutedAccounts: ['acc-x'] });
  assert.equal(np.decision({ accountId: 'acc-x' }).reason, 'muted-account');
  const snap = np.read();
  assert.deepEqual(snap.mutedAccounts, ['acc-x']);
  assert.deepEqual(snap.mutedPlatforms, []);
});
