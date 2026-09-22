const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');

test('Conversation is Chinese-first in both directions and keeps owner avatar projection', () => {
  const projection = read('integration/element-module/src/product-experience/ProductConversationProjection.tsx');
  const index = read('integration/element-module/src/index.tsx');
  const css = read('integration/element-module/src/product-experience/ProductExperienceShell.css');
  const preload = read('electron/preload.js');
  const bridge = read('electron/r32StoreBridge.js');

  assert.doesNotMatch(projection, /\u4e2d\u6587\u7406\u89e3/u);
  assert.match(projection, /aria-label="\u4e2d\u6587\u8bd1\u6587"/u);
  assert.match(projection, /yance-product-message__translation[\s\S]*yance-product-message__original/u);
  assert.match(projection, /storeTranslateChinese/u);
  assert.match(projection, /ownEvent/u);
  assert.match(projection, /yance-product-message__self-avatar/u);
  assert.match(index, /currentUserId=\{typeof clientApi\.getUserId/u);
  assert.match(index, /renderUserAvatar=\{typeof builtinsApi\.renderUserAvatar/u);
  assert.match(preload, /storeTranslateChinese/u);
  assert.match(bridge, /store:translate-chinese/u);
});
test('Conversation visual shell keeps Chinese-first hierarchy and a stable three-mode reply menu', () => {
  const shell = read('integration/element-module/src/product-experience/ProductExperienceShell.tsx');
  const css = read('integration/element-module/src/product-experience/ProductExperienceShell.css');
  const elementPatch = read('upstream-patches/element-web/0020-yance-product-live-room-public-seams.patch');

  assert.doesNotMatch(css, /\.mx_[A-Za-z0-9_-]*/u);
  assert.match(css, /Conversation reading priority: Chinese first, original language second/u);
  assert.match(css, /\.yance-product-message__translation \{[\s\S]*font-size:\s*\.9rem !important;[\s\S]*font-weight:\s*610 !important;/u);
  assert.match(css, /\.yance-product-message__self-avatar \{[\s\S]*position:\s*absolute;[\s\S]*right:\s*-38px;/u);
  assert.match(shell, /\u7531\u6211\u56de\u590d[\s\S]*\u5efa\u8bae\u6211[\s\S]*\u81ea\u52a8\u5904\u7406/u);
  assert.match(css, /Hard reset for reply-mode popup items/u);
  assert.match(css, /\.yance-product-conversation__chat-actions \.yance-header-mode__menu > button \{[\s\S]*width:\s*100% !important;[\s\S]*min-height:\s*56px !important;/u);

  assert.match(elementPatch, /max-width: min\(78%, 700px\)/u);
  assert.match(elementPatch, /padding: 10px 13px/u);
  assert.match(elementPatch, /border-radius: 20px/u);
  assert.match(elementPatch, /margin-left: auto; margin-right: 42px/u);
  assert.match(elementPatch, /font-size: \.9rem/u);
  assert.match(elementPatch, /font-weight: 610/u);
});
