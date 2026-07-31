'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-mobile-voice-ingest-'));
process.env.YANCE_DATA_DIR = dataRoot;

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'qrcode') return { toDataURL: async value => `data:image/png;base64,${Buffer.from(String(value || '')).toString('base64')}` };
  return originalLoad.call(this, request, parent, isMain);
};
const adapter = require('../services/whatsappAdapter');
Module._load = originalLoad;

const normalizer = require('../services/messageNormalizer');
const messages = require('../repositories/messageRepository');
const { getStore, closeStore } = require('../repositories/storeProvider');
const messageInteraction = require('../../frontend/js/r32-message-interaction-runtime');
const { canonicalBaileysMediaInfo } = require('../services/mediaPipeline');

const root = path.resolve(__dirname, '../..');
const source = relative => fs.readFileSync(path.join(root, relative), 'utf8');

process.on('exit', () => {
  try { closeStore(); } catch (_) {}
  try { fs.rmSync(dataRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); } catch (_) {}
});

function mobileVoice(id = 'MOBILE-VOICE-1') {
  return {
    key: {
      id,
      fromMe: true,
      remoteJid: '4915778008463:31@s.whatsapp.net'
    },
    messageTimestamp: 1784662440,
    message: {
      deviceSentMessage: {
        destinationJid: '4915739003140@s.whatsapp.net',
        message: {
          audioMessage: {
            ptt: true,
            mimetype: 'audio/ogg; codecs=opus',
            seconds: 2,
            directPath: '/mms/audio/mobile-one',
            mediaKey: Buffer.from('same-media-key'),
            fileSha256: Buffer.from('same-file-hash')
          }
        }
      }
    }
  };
}

test('mobile-originated voice unwraps deviceSentMessage and binds to the destination conversation', () => {
  const row = normalizer.normalizeIncoming({ accountId: 'wa-account', info: mobileVoice() });
  assert.equal(row.chatJid, '4915739003140@s.whatsapp.net');
  assert.equal(row.conversationId, 'wa-account:4915739003140@s.whatsapp.net');
  assert.equal(row.fromMe, true);
  assert.equal(row.direction, 'outbound');
  assert.equal(row.type, 'voice');
  assert.equal(row.text, '你发送了一条语音');
  assert.equal(row.attachments[0].duration, 2);
  assert.equal(row.rawMeta.deviceSent, true);
  assert.equal(row.rawMeta.deviceSentDestination, '4915739003140@s.whatsapp.net');
  assert.ok(row.rawMeta.transportDedupeKey);
});

test('mobile-originated media is unwrapped before Baileys download and keeps the destination JID', () => {
  const canonical = canonicalBaileysMediaInfo(mobileVoice('DOWNLOAD-VOICE'));
  assert.equal(canonical.key.remoteJid, '4915739003140@s.whatsapp.net');
  assert.ok(canonical.message.audioMessage);
  assert.equal(canonical.message.deviceSentMessage, undefined);
});

test('companion echoes with different outer ids share one media transport dedupe key', () => {
  const first = normalizer.normalizeIncoming({ accountId: 'wa-account', info: mobileVoice('OUTER-A') });
  const second = normalizer.normalizeIncoming({ accountId: 'wa-account', info: mobileVoice('OUTER-B') });
  assert.notEqual(first.externalMessageId, second.externalMessageId);
  assert.equal(first.dedupeKey, second.dedupeKey);
  assert.equal(first.rawMeta.transportDedupeKey, second.rawMeta.transportDedupeKey);
});

test('duplicate checkpoint does not let an unknown placeholder block a real voice upgrade', () => {
  const incoming = normalizer.normalizeIncoming({ accountId: 'wa-account', info: mobileVoice('UPGRADE-VOICE') });
  const skip = adapter.shouldSkipDuplicateReceipt({
    claim: { duplicate: true },
    message: incoming,
    accountId: 'wa-account',
    hasExternalMessage: () => true,
    getExternalMessage: () => ({ type: 'unknown', text: '你发送了一条暂不支持的消息' })
  });
  assert.equal(skip, false);

  const alreadyVoice = adapter.shouldSkipDuplicateReceipt({
    claim: { duplicate: true },
    message: incoming,
    accountId: 'wa-account',
    hasExternalMessage: input => {
      assert.equal(input.chatJid, incoming.chatJid);
      return true;
    },
    getExternalMessage: () => ({ type: 'voice' })
  });
  assert.equal(alreadyVoice, true);
});

test('repository stores multiple companion echoes as one voice row and retains external id aliases', async () => {
  const first = normalizer.normalizeIncoming({ accountId: 'wa-account', info: mobileVoice('ALIAS-A') });
  const second = normalizer.normalizeIncoming({ accountId: 'wa-account', info: mobileVoice('ALIAS-B') });
  await messages.upsert(first);
  await messages.upsert(second);

  const store = getStore();
  const rows = store.db.prepare("SELECT * FROM r32_messages WHERE account_id='wa-account'").all();
  assert.equal(rows.length, 1);
  const payload = JSON.parse(rows[0].payload_json);
  assert.equal(rows[0].message_type, 'voice');
  assert.equal(rows[0].session_key, 'wa-account:4915739003140@s.whatsapp.net');
  assert.equal(payload.externalMessageId, 'ALIAS-A');
  assert.deepEqual(new Set(payload.externalMessageAliases), new Set(['ALIAS-A', 'ALIAS-B']));
  assert.equal(messages.hasExternalMessage({ accountId: 'wa-account', targetId: 'ALIAS-A' }), true);
  assert.equal(messages.hasExternalMessage({ accountId: 'wa-account', targetId: 'ALIAS-B' }), true);
});

test('startup repair removes a duplicate group of synthetic unsupported mobile echoes', async () => {
  const accountId = 'wa-legacy-echo';
  const conversationId = `${accountId}:4915739003140@s.whatsapp.net`;
  const timestamp = '2026-07-21T15:14:00.000Z';
  for (let index = 0; index < 5; index += 1) {
    await messages.upsert({
      id: `legacy-unsupported-${index}`,
      externalMessageId: `legacy-unsupported-${index}`,
      dedupeKey: `legacy-unsupported-${index}`,
      accountId,
      conversationId,
      sessionKey: conversationId,
      chatJid: '4915739003140@s.whatsapp.net',
      platform: 'whatsapp',
      direction: 'outbound',
      fromMe: true,
      type: 'unknown',
      text: '对方发送了一条暂不支持的消息',
      timestamp,
      status: 'sent'
    });
  }
  const result = messages.collapseDuplicateUnsupportedMobileEchoes(accountId);
  assert.equal(result.groups, 1);
  assert.equal(result.removed, 5);
  assert.deepEqual(result.archivedConversations, [conversationId]);
  const remaining = getStore().db.prepare('SELECT COUNT(*) AS n FROM r32_messages WHERE account_id=?').get(accountId).n;
  assert.equal(remaining, 0);
  const archived = getStore().db.prepare('SELECT archived_at,archive_reason FROM r32_conversations WHERE session_key=?').get(conversationId);
  assert.ok(archived.archived_at);
  assert.equal(archived.archive_reason, 'synthetic-mobile-voice-echo');
  assert.deepEqual(messages.collapseDuplicateUnsupportedMobileEchoes(accountId), { groups: 0, removed: 0, conversations: [], archivedConversations: [], archivedContacts: [] });
});

test('programmatic scroll restoration never triggers older-history loading', () => {
  assert.equal(messageInteraction.shouldLoadOlder({ scrollTop: 0, threshold: 140, restoring: true }), false);
  assert.equal(messageInteraction.shouldLoadOlder({ scrollTop: 0, threshold: 140, restoring: false }), true);
  assert.equal(messageInteraction.shouldLoadOlder({ scrollTop: 500, threshold: 140, restoring: false }), false);

  const ui = source('frontend/js/r32-ui-runtime.js');
  assert.match(ui, /beginMessageScrollRestore/);
  assert.match(ui, /messageScrollRestoreActive/);
  assert.match(ui, /messageBottomLock/);
  assert.match(ui, /restoreMessagePositionAfterMediaLayout/);
  assert.match(ui, /captureMessageScrollState/);
  assert.match(ui, /mode:'anchor'/);
  assert.match(ui, /shouldLoadOlder/);
  const stability = require('../../frontend/js/r32-sync-stability');
  assert.equal(stability.requiresConversationReload('messages:mobile-echo-repaired'), true);
});
