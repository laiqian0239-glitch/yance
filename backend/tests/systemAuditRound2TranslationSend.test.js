'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-translation-send-'));
process.env.YANCE_DATA_DIR = dataRoot;
process.env.WORKBUDDY_DATA_DIR = dataRoot;
const outboundTranslationAuthority = require('../services/outboundTranslationAuthority');
const { MessageTranslationService, translationEligibleMessage } = require('../services/messageTranslationService');
const sendQueueModule = require('../services/sendQueueService');
const messageStore = require('../services/messageStore');
const sendMessageService = require('../services/sendMessageService');
const { SendPolicyAuthority } = require('../services/sendPolicyAuthority');
const { getStore, closeStore } = require('../repositories/storeProvider');

test.after(() => {
  try { closeStore(); } catch (_) {}
  fs.rmSync(dataRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

function seedSendScope(accountId = 'wa-a', platform = 'whatsapp', sessionKey = `${accountId}:peer`, chatJid = 'peer') {
  const store = getStore();
  store.upsertAccount({ id: accountId, accountId, adapterAccountId: accountId, platform, state: 'connected', canSend: true, canReceive: true });
  store.upsertConversation({ sessionKey, accountId, platform, title: chatJid, routeState: 'bound', chatJid, externalId: chatJid });
  return store;
}

function patch(t, object, key, value) {
  const original = object[key];
  object[key] = value;
  t.after(() => { object[key] = original; });
}

function germanLanguageAuthority() {
  return { targetLanguage: () => 'de' };
}

function readySendPolicy(platform, accountId) {
  return new SendPolicyAuthority({
    accountStateProvider: () => [{
      id: accountId,
      platform,
      state: 'connected',
      canAttemptSend: true,
      sendVerified: true,
      canSend: true,
      canReceive: true,
      credentialReady: true,
      capabilityAvailability: {}
    }]
  });
}

test('Chinese manual text is translated to the scoped contact language with protected entities preserved', async () => {
  let execution = null;
  const result = await outboundTranslationAuthority.prepare({
    text: '我今晚18:30不能视频通话，明天可以。我的WhatsApp号码是 +49 170 2106045。',
    platform: 'whatsapp', accountId: 'wa-a', sessionKey: 'wa-a:peer', chatJid: 'peer', idempotencyKey: 'send-1',
    conversation: { contactId: 'c1', platform: 'whatsapp', accountId: 'wa-a', chatJid: 'peer' }
  }, {
    contactLanguageAuthority: germanLanguageAuthority(),
    aiGateway: {
      async execute(input) {
        execution = input;
        return { text: 'Ich kann heute Abend um 18:30 keinen Videoanruf machen, aber morgen geht es. Meine WhatsApp-Nummer ist +49 170 2106045.', modelId: 'cloud-free-de' };
      }
    }
  });

  assert.equal(result.translationApplied, true);
  assert.equal(result.targetLanguageCode, 'de');
  assert.equal(result.translatedZh.includes('今晚18:30'), true);
  assert.match(result.text, /18:30/u);
  assert.match(result.text, /\+49 170 2106045/u);
  assert.equal(execution.task, 'translation');
  assert.equal(execution.context.sessionKey, 'wa-a:peer');
  assert.equal(execution.context.sourceAccountId, 'wa-a');
});

test('translation model failure blocks Chinese before the durable send queue', async () => {
  await assert.rejects(() => outboundTranslationAuthority.prepare({
    text: '你好，明天见。', platform: 'facebook', accountId: 'fb-a', sessionKey: 'fb-a:peer', chatJid: 'peer', idempotencyKey: 'send-2'
  }, {
    contactLanguageAuthority: germanLanguageAuthority(),
    aiGateway: { execute: async () => { throw Object.assign(new Error('all models offline'), { code: 'ALL_MODELS_FAILED' }); } }
  }), error => error.code === 'OUTBOUND_TRANSLATION_FAILED' && /已阻止发送中文/u.test(error.message));
});

test('unresolved target language blocks Chinese instead of guessing or sending source text', async () => {
  await assert.rejects(() => outboundTranslationAuthority.prepare({
    text: '你好，新朋友。', platform: 'telegram', accountId: 'tg-a', sessionKey: 'tg-a:peer', chatJid: 'peer'
  }, {
    contactLanguageAuthority: { targetLanguage: () => '' },
    aiGateway: { execute: async () => ({ text: 'Hallo' }) }
  }), error => error.code === 'OUTBOUND_TARGET_LANGUAGE_UNRESOLVED');
});

test('non-Chinese manual text bypasses the model and remains unchanged', async () => {
  let called = false;
  const result = await outboundTranslationAuthority.prepare({ text: 'Bis morgen!', targetLanguageCode: 'de' }, {
    aiGateway: { execute: async () => { called = true; return { text: 'wrong' }; } }
  });
  assert.equal(result.text, 'Bis morgen!');
  assert.equal(result.translationApplied, false);
  assert.equal(called, false);
});

test('send queue stores and dispatches only the verified target-language text', async t => {
  const store = seedSendScope('wa-a', 'whatsapp', 'wa-a:peer', 'peer');
  const service = new sendQueueModule.SendQueueService({
    outboundTranslationAuthority: {
      prepare: async () => ({
        text: 'Hallo, bis morgen!', originalComposerText: '你好，明天见！', translatedZh: '你好，明天见！',
        sourceText: 'Hallo, bis morgen!', sourceLanguage: 'de', translationApplied: true,
        translationStatus: 'success', translationModel: 'translation-main', translatedAt: '2026-07-25T12:00:00.000Z',
        translationSourceHash: 'hash', translationTargetLanguage: 'de', targetLanguage: 'German', targetLanguageCode: 'de',
        languageAuthority: { code: 'de' }, languageValidation: { pass: true }
      })
    },
    sendPolicyAuthority: readySendPolicy('whatsapp', 'wa-a')
  });
  patch(t, sendMessageService, 'resolveAccount', () => ({ platform: 'whatsapp' }));

  const result = await service.enqueueText({ accountId: 'wa-a', chatJid: 'peer', sessionKey: 'wa-a:peer', text: '你好，明天见！', idempotencyKey: 'outbound-1' });
  const queued = store.getSendQueueItem(result.id);
  const persisted = store.getMessage(result.id);

  assert.equal(queued.payload.text, 'Hallo, bis morgen!');
  assert.equal(queued.payload.translation.translatedZh, '你好，明天见！');
  assert.equal(persisted.text, 'Hallo, bis morgen!');
  assert.equal(persisted.translatedZh, '你好，明天见！');
  assert.equal(result.translationApplied, true);
  assert.ok(queued.outbox_route_id);
  assert.ok(queued.outbox_route_version_id);
});

test('send queue never creates a durable row when outbound translation blocks', async t => {
  const service = new sendQueueModule.SendQueueService({
    outboundTranslationAuthority: { prepare: async () => { throw Object.assign(new Error('blocked'), { code: 'OUTBOUND_TRANSLATION_FAILED' }); } }
  });
  const store = getStore();
  const beforeQueue = store.listSendQueue().length;
  patch(t, sendMessageService, 'resolveAccount', () => ({ platform: 'facebook' }));
  await assert.rejects(() => service.enqueueText({ accountId: 'fb-a', chatJid: 'peer', sessionKey: 'fb-a:peer', text: '你好', idempotencyKey: 'outbound-2' }), { code: 'OUTBOUND_TRANSLATION_FAILED' });
  assert.equal(store.listSendQueue().length, beforeQueue);
});

test('automatic Chinese-understanding translation ignores system and revoked messages', async () => {
  assert.equal(translationEligibleMessage({ id: 's1', type: 'system', text: 'connected' }), false);
  assert.equal(translationEligibleMessage({ id: 's2', direction: 'system', text: 'sync complete' }), false);
  assert.equal(translationEligibleMessage({ id: 'r1', direction: 'inbound', fromMe: false, revoked: true, text: 'Hallo' }), false);
  assert.equal(translationEligibleMessage({ id: 'm1', direction: 'inbound', fromMe: false, text: 'Hallo' }), true);
  assert.equal(translationEligibleMessage({ id: 'm2', direction: 'outbound', fromMe: true, text: 'Guten Morgen' }), true);
  assert.equal(translationEligibleMessage({ id: 'legacy-1', text: 'Historische Nachricht ohne Richtung' }), true);
  assert.equal(translationEligibleMessage({ id: 'draft-1', type: 'draft', text: 'not sent' }), false);
  assert.equal(translationEligibleMessage({ id: 'quote-1', type: 'quoted', text: 'quoted content' }), false);

  const store = {
    getMessage: () => ({ id: 'system-1', direction: 'system', type: 'system', text: 'platform sync' }),
    upsertMessage() { throw new Error('system message must not be written by translation'); }
  };
  const service = new MessageTranslationService({
    storeProvider: () => store,
    bilingualUnderstandingService: { translateToChinese: async () => { throw new Error('must not call model'); } },
    contactLanguageAuthority: { observeMessage() { throw new Error('must not observe system language'); } },
    logger: { warn() {} }
  });
  const result = await service.translateMessage('system-1');
  assert.equal(result.status, 'skipped');
});

test('blocked media caption translation creates no queue file or durable row', async t => {
  const service = new sendQueueModule.SendQueueService({
    outboundTranslationAuthority: { prepare: async () => { throw Object.assign(new Error('blocked'), { code: 'OUTBOUND_TRANSLATION_FAILED' }); } }
  });
  patch(t, sendMessageService, 'resolveAccount', () => ({ platform: 'telegram' }));
  const store = getStore();
  const beforeQueue = store.listSendQueue().length;

  const before = new Set(require('node:fs').readdirSync(sendQueueModule.QUEUE_MEDIA_ROOT));
  await assert.rejects(() => service.enqueueMedia({
    accountId: 'tg-a', chatJid: 'peer', sessionKey: 'tg-a:peer',
    buffer: Buffer.from('safe-media-content'), kind: 'document', mimeType: 'application/octet-stream', filename: 'note.bin',
    caption: '你好，这是文件。', idempotencyKey: 'outbound-media-blocked-1'
  }), { code: 'OUTBOUND_TRANSLATION_FAILED' });
  const after = new Set(require('node:fs').readdirSync(sendQueueModule.QUEUE_MEDIA_ROOT));
  assert.deepEqual(after, before);
  assert.equal(store.listSendQueue().length, beforeQueue);
});


test('ordinary foreign-language messaging remains durable when every AI model is unavailable', async t => {
  const store = seedSendScope('wa-no-ai', 'whatsapp', 'wa-no-ai:peer', 'peer');
  const aiGateway = require('../services/aiGateway');
  patch(t, aiGateway, 'execute', async () => { throw Object.assign(new Error('all AI unavailable'), { code: 'NO_QUALIFIED_MODEL' }); });
  patch(t, sendMessageService, 'resolveAccount', () => ({ platform: 'whatsapp' }));

  const service = new sendQueueModule.SendQueueService({
    sendPolicyAuthority: readySendPolicy('whatsapp', 'wa-no-ai')
  });
  const result = await service.enqueueText({
    accountId: 'wa-no-ai', chatJid: 'peer', sessionKey: 'wa-no-ai:peer', text: 'Bis morgen!', idempotencyKey: 'no-ai-original-language'
  });
  const queued = store.getSendQueueItem(result.id);
  assert.equal(queued.payload.text, 'Bis morgen!');
  assert.equal(result.translationApplied, false);
  assert.equal(result.state, 'pending');
  assert.ok(queued.outbox_route_version_id);
});

test('frontend send timeout covers the 180 second translation budget', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.resolve(__dirname, '../../frontend/js/core-client.js'), 'utf8');
  assert.match(source, /message\.sendText', payload, \{ timeoutMs: 240000 \}/u);
});
