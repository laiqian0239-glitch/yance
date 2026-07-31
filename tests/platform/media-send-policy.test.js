'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { validateStickerInput } = require('../../backend/services/mediaSendPolicy');
const webp = Buffer.from('524946460400000057454250', 'hex');

test('whatsapp sticker accepts only pre-encoded WebP', () => {
  assert.equal(validateStickerInput({ platform: 'whatsapp', kind: 'sticker', mimeType: 'image/webp', filename: 'ok.webp', buffer: webp }).validated, true);
  assert.throws(() => validateStickerInput({ platform: 'whatsapp', kind: 'sticker', mimeType: 'image/png', filename: 'bad.png', buffer: webp }), error => error.code === 'MEDIA_STICKER_FORMAT_UNSUPPORTED');
});

test('telegram animated sticker is rejected until native TGS/WebM API exists', () => {
  assert.throws(() => validateStickerInput({ platform: 'telegram', kind: 'animatedSticker', mimeType: 'application/x-tgsticker', filename: 'a.tgs' }), error => error.reason === 'native-animated-sticker-api-missing');
});

test('facebook sticker is explicitly unsupported', () => {
  assert.throws(() => validateStickerInput({ platform: 'facebook', kind: 'sticker', mimeType: 'image/webp', filename: 'a.webp', buffer: webp }), error => error.reason === 'platform-unsupported');
});
