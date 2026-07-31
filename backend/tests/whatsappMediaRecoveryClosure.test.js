'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  serializeBaileysMessageInfo,
  reconstructBaileysMessageInfo,
  hasMediaEnvelope
} = require('../services/whatsappMediaEnvelope');
const { normalizeIncoming, unwrap } = require('../services/messageNormalizer');
const { WhatsAppHistoryMediaRecoveryQueue } = require('../services/whatsappHistoryMediaRecovery');
const transcription = require('../services/transcriptionService');

const root = path.resolve(__dirname, '../..');
const source = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function info(message, patch = {}) {
  return {
    key: { remoteJid: '447974905090@s.whatsapp.net', id: patch.id || 'MSG-1', fromMe: false },
    messageTimestamp: 1784650000,
    pushName: patch.pushName || '',
    verifiedBizName: patch.verifiedBizName || '',
    message,
    ...patch
  };
}

test('Baileys media envelope round-trips encrypted media bytes without logging-only placeholders', () => {
  const original = info({ imageMessage: { url: 'https://mmg.whatsapp.net/x', mediaKey: Buffer.from([1, 2, 3]), fileSha256: Buffer.from([4, 5]), mimetype: 'image/jpeg' } });
  const envelope = serializeBaileysMessageInfo(original);
  assert.equal(hasMediaEnvelope({ mediaEnvelope: envelope }), true);
  const restored = reconstructBaileysMessageInfo(envelope);
  assert.deepEqual(restored.message.imageMessage.mediaKey, Buffer.from([1, 2, 3]));
  assert.deepEqual(restored.message.imageMessage.fileSha256, Buffer.from([4, 5]));
  assert.equal(restored.key.id, 'MSG-1');
});

test('photos persist thumbnail plus durable media envelope for restart recovery', () => {
  const row = normalizeIncoming({
    accountId: 'wa-account',
    info: info({ imageMessage: { mimetype: 'image/jpeg', jpegThumbnail: Buffer.from([0xff, 0xd8, 0xff, 0xd9]), mediaKey: Buffer.from('key'), directPath: '/mms/image/1' } })
  });
  const attachment = row.attachments[0];
  assert.equal(row.type, 'image');
  assert.match(attachment.thumbnailDataUrl, /^data:image\/jpeg;base64,/);
  assert.equal(hasMediaEnvelope(attachment), true);
  assert.equal(attachment.downloadStatus, 'pending');
});

test('lottie FutureProofMessage unwraps to normal sticker recovery instead of unsupported', () => {
  const wrapped = { lottieStickerMessage: { message: { stickerMessage: { mimetype: 'image/webp', isAnimated: true, mediaKey: Buffer.from('k'), directPath: '/mms/sticker/1', pngThumbnail: Buffer.from([1, 2, 3]) } } } };
  assert.ok(unwrap(wrapped).stickerMessage);
  const row = normalizeIncoming({ accountId: 'wa-account', info: info(wrapped, { id: 'STICKER-1' }) });
  const attachment = row.attachments[0];
  assert.equal(row.type, 'sticker');
  assert.equal(attachment.isAnimatedSticker, true);
  assert.equal(attachment.renderable === false, false);
  assert.equal(attachment.downloadable === false, false);
  assert.equal(hasMediaEnvelope(attachment), true);
});

test('voice messages preserve Opus waveform and durable envelope', () => {
  const row = normalizeIncoming({
    accountId: 'wa-account',
    info: info({ audioMessage: { mimetype: 'audio/ogg; codecs=opus', ptt: true, seconds: 13, waveform: Buffer.from([1, 10, 20, 30]), mediaKey: Buffer.from('key'), directPath: '/mms/audio/1' } }, { id: 'VOICE-1' })
  });
  const attachment = row.attachments[0];
  assert.equal(row.type, 'voice');
  assert.equal(attachment.duration, 13);
  assert.equal(attachment.waveformBase64, Buffer.from([1, 10, 20, 30]).toString('base64'));
  assert.equal(hasMediaEnvelope(attachment), true);
});

test('restart resume reconstructs stored envelope and persists ready media', async () => {
  const stored = normalizeIncoming({
    accountId: 'wa-account',
    info: info({ imageMessage: { mimetype: 'image/jpeg', mediaKey: Buffer.from('key'), directPath: '/mms/image/1' } }, { id: 'IMG-RESTART' })
  });
  const writes = [];
  const events = [];
  const store = {
    listConversations: () => [{ id: stored.conversationId, accountId: 'wa-account', platform: 'whatsapp' }],
    listMessages: () => [stored],
    upsert: async message => { writes.push(message); return message; }
  };
  const media = {
    materializeBaileys: async input => {
      assert.equal(input.info.key.id, 'IMG-RESTART');
      return { ...input.descriptor, downloadStatus: 'ready', mediaUrl: '/api/r32/messages/media/a/b/c.jpg', localFile: 'c.jpg' };
    }
  };
  const queue = new WhatsAppHistoryMediaRecoveryQueue({ concurrency: 1, store, media, events: { publish: (type, payload) => events.push({ type, payload }) }, log: { info() {}, warn() {} } });
  const plan = queue.resumeAccount({ accountId: 'wa-account', socket: {} });
  assert.equal(plan.queued, 1);
  for (let attempt = 0; attempt < 50 && (queue.snapshot().active || queue.snapshot().queued); attempt += 1) await wait(10);
  assert.equal(writes.at(-1).attachments[0].downloadStatus, 'ready');
  assert.ok(events.some(row => row.type === 'whatsapp:history-media-recovered'));
});

test('brand logos remain valid WhatsApp Business avatars because provenance is authoritative', () => {
  const avatar = source('backend/services/avatarService.js');
  assert.match(avatar, /Avatar pixels are not platform identity/);
  assert.match(avatar, /const KNOWN_PLATFORM_AVATAR_HASHES = new Map\(\)/);
  assert.doesNotMatch(avatar, /known-facebook-logo-placeholder/);
});

test('runtime has thumbnail fallback, retry action and durable recovery route', () => {
  const ui = source('frontend/js/r32-ui-runtime.js');
  const capabilities = source('frontend/js/r32-conversation-capabilities.js');
  const routes = source('backend/routes/messages.js');
  const adapter = source('backend/services/whatsappAdapter.js');
  assert.match(ui, /messageMediaThumbnail/);
  assert.match(ui, /media-retry-btn/);
  assert.match(capabilities, /retryMessageMedia/);
  assert.match(routes, /:messageId\/retry/);
  assert.match(adapter, /resumeAccount\(\{ accountId: databaseAccountId/);
  assert.match(adapter, /fetchMessageHistory/);
  assert.match(adapter, /getBusinessProfile/);
});

test('transcription reports configured command or precise engine-not-configured status', () => {
  const previous = process.env.YANCE_WHISPER_COMMAND;
  process.env.YANCE_WHISPER_COMMAND = 'whisper-cli --file {file} --language {language}';
  try {
    const status = transcription.engineStatus();
    assert.equal(status.available, true);
    assert.equal(status.source, 'YANCE_WHISPER_COMMAND');
    assert.equal(status.command, 'whisper-cli');
  } finally {
    if (previous == null) delete process.env.YANCE_WHISPER_COMMAND;
    else process.env.YANCE_WHISPER_COMMAND = previous;
  }
});

test('on-demand history refetch is treated as media patching, not another full conversation reload', () => {
  const adapter = source('backend/services/whatsappAdapter.js');
  const stability = require('../../frontend/js/r32-sync-stability.js');
  assert.match(adapter, /syncType === 7/);
  assert.match(adapter, /whatsapp:history-media-refetched/);
  assert.equal(stability.isMessagePatchEvent('whatsapp:history-media-refetched'), true);
  assert.equal(stability.requiresConversationReload('whatsapp:history-media-refetched'), false);
});

test('WhatsApp Business names use real directory/profile fields and never avatar pixel classification', () => {
  const adapter = source('backend/services/whatsappAdapter.js');
  const diagnostics = source('tools/uat/whatsappIdentityDiagnostics.js');
  assert.match(adapter, /row\.verifiedBizName/);
  assert.match(adapter, /profile\.verifiedBizName/);
  assert.match(adapter, /never derive a name from avatar pixels/);
  assert.match(diagnostics, /avatarProvenanceErrors/);
  assert.doesNotMatch(diagnostics, /WHATSAPP_AVATAR_PLATFORM_CONTENT_MISMATCH/);
});

test('voice transcription discovers ffmpeg for WhatsApp OGG Opus conversion before whisper.cpp', () => {
  const speech = source('backend/services/transcriptionService.js');
  assert.match(speech, /discoverFfmpeg/);
  assert.match(speech, /pcm_s16le/);
  assert.match(speech, /AUDIO_CONVERTER_NOT_CONFIGURED/);
});

test('WhatsApp diagnostics expose the real media recovery backlog by kind and missing envelope', () => {
  const diagnostics = source('tools/uat/whatsappIdentityDiagnostics.js');
  assert.match(diagnostics, /whatsappMediaInventory/);
  assert.match(diagnostics, /whatsappMediaMissingEnvelope/);
  assert.match(diagnostics, /byKind/);
});

test('media recovery uses finite backoff and manual retry counts exactly once', async () => {
  const original = normalizeIncoming({
    accountId: 'wa-account',
    info: info({ imageMessage: { mimetype: 'image/jpeg', mediaKey: Buffer.from('key'), directPath: '/mms/image/retry' } }, { id: 'IMG-RETRY' })
  });
  let stored = original;
  const store = {
    listConversations: () => [{ id: original.conversationId, accountId: 'wa-account', platform: 'whatsapp' }],
    listMessages: () => [stored],
    upsert: async message => { stored = message; return message; }
  };
  const media = {
    materializeBaileys: async ({ descriptor }) => ({
      ...descriptor,
      downloadStatus: 'failed',
      downloadError: 'MEDIA_DOWNLOAD_TIMEOUT',
      retryable: true
    })
  };
  const queue = new WhatsAppHistoryMediaRecoveryQueue({
    concurrency: 1,
    maxRetries: 2,
    store,
    media,
    events: { publish() {} },
    log: { info() {}, warn() {} }
  });

  const first = queue.resumeAccount({ accountId: 'wa-account', socket: {} });
  assert.equal(first.queued, 1);
  for (let attempt = 0; attempt < 50 && (queue.snapshot().active || queue.snapshot().queued); attempt += 1) await wait(10);
  assert.equal(stored.attachments[0].retryCount, 1);
  assert.equal(stored.attachments[0].retryable, true);
  assert.ok(Date.parse(stored.attachments[0].nextRetryAt) > Date.now());

  const second = queue.retryStored({ accountId: 'wa-account', conversationId: original.conversationId, messageId: original.id, socket: {} });
  assert.equal(second.queued, true);
  for (let attempt = 0; attempt < 50 && (queue.snapshot().active || queue.snapshot().queued); attempt += 1) await wait(10);
  assert.equal(stored.attachments[0].retryCount, 2);
  assert.equal(stored.attachments[0].retryable, false);
  assert.equal(stored.attachments[0].nextRetryAt, '');
});
