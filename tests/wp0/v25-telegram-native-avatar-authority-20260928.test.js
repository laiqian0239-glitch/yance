'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

test('Telegram timeline avatars stay owned by mautrix Matrix member state and Element EventTile', () => {
  const config = JSON.parse(read('config/matrix/element-config.json'));
  const messageProjection = read('integration/element-module/src/product-experience/ProductConversationProjection.tsx');
  const moduleIndex = read('integration/element-module/src/index.tsx');
  const messageRenderer = moduleIndex.match(/messageComponentsApi\.registerMessageRenderer\([\s\S]*?\n\s*\);/u)?.[0] || '';

  assert.equal(Object.prototype.hasOwnProperty.call(config.setting_defaults || {}, 'layout'), false,
    'Yance must not force Element bubble layout, which suppresses native sender avatars');
  assert.doesNotMatch(messageProjection, /yance-product-message__self-avatar/u,
    'Product must not inject a second self-avatar beside Element EventTile');
  assert.doesNotMatch(messageProjection, /renderUserAvatar/u,
    'Product message renderer must not own Matrix user avatar rendering');
  assert.ok(messageRenderer, 'Product message renderer wiring must exist');
  assert.doesNotMatch(messageRenderer, /currentUserId=|renderUserAvatar=/u,
    'timeline renderer wiring must leave sender identity and avatar ownership to Element EventTile');
});
