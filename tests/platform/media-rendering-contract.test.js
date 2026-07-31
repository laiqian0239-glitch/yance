'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { normalizeIncoming } = require('../../backend/services/messageNormalizer');
const mediaPipeline = require('../../backend/services/mediaPipeline');
const playback = require('../../frontend/js/r32-media-playback');

test('WhatsApp FutureProof animated sticker unwraps into a recoverable animated WebP', () => {
  const row = normalizeIncoming({ accountId: 'wa-1', info: { key: { id: 'm1', remoteJid: '1@s.whatsapp.net' }, message: { lottieStickerMessage: { message: { stickerMessage: { mimetype: 'image/webp', isAnimated: true, mediaKey: Buffer.from('key'), directPath: '/mms/sticker/1' } } } } } });
  assert.equal(row.type, 'sticker');
  assert.equal(row.attachments[0].stickerFormat, 'webp');
  assert.equal(row.attachments[0].renderable === false, false);
  assert.equal(row.attachments[0].downloadable === false, false);
  assert.equal(row.attachments[0].isAnimatedSticker, true);
});


test('unsupported WhatsApp Lottie wrapper is not sent through Baileys media download', async () => {
  const attachment = await mediaPipeline.materializeBaileys({
    accountId: 'wa-1', conversationId: 'wa-1:chat', messageId: 'm1', info: {}, socket: {},
    descriptor: { kind: 'sticker', stickerFormat: 'lottie', renderable: false, downloadable: false, supportState: 'unsupported' }
  });
  assert.equal(attachment.downloadStatus, 'unsupported');
  assert.equal(attachment.stickerFormat, 'lottie');
});

test('desktop animation settings have deterministic pause semantics', () => {
  assert.deepEqual(playback.normalizeSettings({ stickerAutoplay: false, pauseAnimationWhenHidden: false }), { stickerAutoplay: false, pauseAnimationWhenHidden: false });
  playback.setSettings({ stickerAutoplay: false, pauseAnimationWhenHidden: false });
  assert.equal(playback.snapshot().paused, true);
  playback.setSettings({ stickerAutoplay: true, pauseAnimationWhenHidden: false });
  assert.equal(playback.snapshot().paused, false);
});

test('conversation renderer carries animated sticker metadata and unsupported format fallback', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../frontend/js/r32-ui-runtime.js'), 'utf8');
  assert.match(source, /isAnimatedSticker:Boolean/);
  assert.match(source, /data-animated-media/);
  assert.match(source, /mediaRenderable===false/);
  assert.match(source, /YanceMediaPlayback\?\.enhance/);
  assert.match(source, /animatedEmojiMotion/);
});
