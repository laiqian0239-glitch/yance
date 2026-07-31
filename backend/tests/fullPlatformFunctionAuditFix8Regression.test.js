'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const whatsappModule = require('../services/whatsappAdapter');
const telegramModule = require('../services/telegramAdapter');
const accountManagerModule = require('../services/accountManager');
const accountStore = require('../services/accountStore');
const accountLifecycle = require('../services/accountLifecycle');
const canonicalIdentity = require('../services/canonicalIdentityService');
const messageStore = require('../services/messageStore');
const sendQueue = require('../services/sendQueueService');
const systemPolicy = require('../services/systemPolicy');

const ROOT = path.resolve(__dirname, '..', '..');
const source = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

function patch(t, object, key, value) {
  const original = object[key];
  object[key] = value;
  t.after(() => { object[key] = original; });
}

test('WhatsApp QR renderer is isolated from unrelated platform module loading', () => {
  assert.equal(typeof whatsappModule.WhatsAppAdapter, 'function');
  assert.throws(
    () => whatsappModule.loadQRCodeDependency(() => { throw Object.assign(new Error('not installed'), { code: 'MODULE_NOT_FOUND' }); }),
    error => error.code === 'WHATSAPP_QR_RENDERER_MISSING' && /二维码渲染组件不可用/u.test(error.message)
  );
  assert.doesNotMatch(source('backend/services/whatsappAdapter.js'), /^const QRCode = require\('qrcode'\);$/mu);
});

test('Telegram QR renderer is isolated from unrelated platform module loading', () => {
  assert.equal(typeof telegramModule.TelegramAdapter, 'function');
  assert.throws(
    () => telegramModule.loadQRCodeDependency(() => { throw Object.assign(new Error('not installed'), { code: 'MODULE_NOT_FOUND' }); }),
    error => error.code === 'TELEGRAM_QR_RENDERER_MISSING' && /二维码渲染组件不可用/u.test(error.message)
  );
  assert.doesNotMatch(source('backend/services/telegramAdapter.js'), /^const QRCode = require\('qrcode'\);$/mu);
});

test('direct account text sending preserves quoted-message context through the durable queue', async t => {
  const manager = Object.create(accountManagerModule.AccountManager.prototype);
  manager.publicAccount = () => ({ canAttemptSend: true, sendVerified: false, canSend: false, stateLabel: '已连接' });
  const account = { id: 'wa-account-1', platform: 'whatsapp', paused: false };
  let queued = null;
  patch(t, systemPolicy, 'assertWriteAllowed', () => {});
  patch(t, accountStore, 'get', () => account);
  patch(t, accountStore, 'bindConversation', async () => {});
  patch(t, accountStore, 'record', async () => {});
  patch(t, accountLifecycle, 'assertEligible', () => {});
  patch(t, canonicalIdentity, 'resolveCanonicalAccountId', value => value);
  patch(t, messageStore, 'getConversation', () => ({ id: 'conversation-1', accountId: account.id }));
  patch(t, sendQueue, 'enqueueText', async input => { queued = input; return { id: 'queue-1', state: 'pending' }; });
  patch(t, sendQueue, 'status', () => ({ started: false }));

  const quoted = { key: { id: 'platform-message-7', remoteJid: '491234@s.whatsapp.net' }, quotedMessageId: 'platform-message-7' };
  await manager.sendText({
    accountId: account.id,
    conversationId: 'conversation-1',
    recipientId: '491234@s.whatsapp.net',
    text: '引用回复',
    quoted,
    idempotencyKey: 'quoted-send-1'
  });

  assert.equal(queued.quoted, quoted);
  assert.equal(queued.sessionKey, 'conversation-1');
  assert.equal(queued.chatJid, '491234@s.whatsapp.net');
});

test('AccountContext direct-send bridge forwards quoted-message context', () => {
  const accountContextSource = source('backend/core/accountContext.js');
  assert.match(accountContextSource, /quoted:\s*payload\.quoted\s*\|\|\s*null/u);
});
