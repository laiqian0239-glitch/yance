'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { STATE, getContract, MATRIX, mediaCapability } = require('../../backend/services/platformCapabilities');

test('sticker capability matrix distinguishes partial and unsupported platform paths', () => {
  assert.equal(getContract('whatsapp', 'sticker').state, STATE.PARTIAL);
  assert.equal(getContract('whatsapp', 'animatedSticker').state, STATE.PARTIAL);
  assert.equal(getContract('whatsapp', 'lottieSticker').state, STATE.PARTIAL);
  assert.equal(getContract('telegram', 'sticker').state, STATE.PARTIAL);
  assert.equal(getContract('telegram', 'animatedSticker').state, STATE.PARTIAL);
  assert.equal(getContract('telegram', 'lottieSticker').state, STATE.UNSUPPORTED);
  assert.equal(getContract('facebook', 'sticker').state, STATE.UNSUPPORTED);
  assert.equal(MATRIX.whatsapp.sticker, 'partial');
  assert.equal(MATRIX.telegram.animatedSticker, 'partial');
  assert.equal(MATRIX.facebook.sticker, false);
  assert.equal(mediaCapability('animatedSticker'), 'animatedSticker');
});
