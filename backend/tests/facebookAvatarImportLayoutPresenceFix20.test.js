'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('account core client maps Business Suite avatar import session commands', () => {
  const source = read('frontend/js/core-client.js');
  assert.match(source, /'facebook\/avatar-import\/session':method === 'GET' \? 'account\.facebook\.avatarImport\.status' : 'account\.facebook\.avatarImport\.start'/u);
  assert.match(source, /'facebook\/avatar-import\/session\/stop':'account\.facebook\.avatarImport\.stop'/u);
});

test('conversation header grows with wrapped route controls instead of clipping content', () => {
  const css = read('frontend/r32-conversation-center-v2.css');
  assert.match(css, /\.chat\{grid-template-rows:minmax\(72px,auto\) minmax\(0,1fr\) auto/u);
  assert.match(css, /\.chat-head\{min-height:72px/u);
});

test('Facebook contact presence placeholders and online filter are hidden from the customer UI', () => {
  const source = read('frontend/js/r32-ui-runtime.js');
  assert.doesNotMatch(source, /平台不提供上线状态/u);
  assert.match(source, /button\.hidden=!supported/u);
  assert.match(source, /contactPresenceSupported\(c\)/u);
  assert.match(source, /withStatus:presenceSupported/u);
  assert.doesNotMatch(source, /platformKey==='facebook'&&!c\.archived/u);
  assert.match(source, /host\.hidden=!text/u);
  assert.match(source, /dot\.hidden=platformPresenceUnsupported&&!typingLabel/u);
});
