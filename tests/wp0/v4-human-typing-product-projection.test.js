'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const projection = read('integration/element-module/src/product-experience/experienceProjection.ts');
const people = read('integration/element-module/src/product-experience/PeopleSurface.tsx');
const composer = read('integration/element-module/src/product-experience/ProductComposerAccessory.tsx');
const index = read('integration/element-module/src/index.tsx');

test('human typing Product mode is projected from mature typingState policy instead of local UI state', () => {
  assert.match(projection, /export async function loadHumanTypingProjection/u);
  assert.match(projection, /storeSnapshot\(\{\s*domains:\s*\["typingState"\]\s*\}\)/u);
  assert.match(projection, /platformAfterApproval\s*===\s*true[\s\S]{0,160}["']自然["'][\s\S]{0,160}["']关闭["']/u);
  assert.doesNotMatch(projection, /setTimeout|setInterval/u);
});

test('Home shows the real global human-typing mode and never labels it as relationship projection', () => {
  assert.match(people, /loadHumanTypingProjection/u);
  assert.match(people, /全局：\{humanTypingModeLabel\}/u);
  assert.doesNotMatch(people, /当前关系投影/u);
});
test('Conversation always shows the mature global mode and preserves real active send controls', () => {
  assert.match(composer, /loadHumanTypingProjection/u);
  assert.match(composer, /真人打字 · 全局：\{humanTypingModeLabel\}/u);
  assert.match(composer, /正在输入/u);
  assert.match(composer, />立即发送<\/button>/u);
  assert.match(composer, />取消<\/button>/u);
  assert.match(composer, /releaseHumanTypingElementSend/u);
  assert.match(composer, /cancelHumanTypingElementSend/u);
  assert.doesNotMatch(composer, /setTimeout|setInterval/u);
});

test('Element composer/send remains the sole physical send authority', () => {
  assert.match(index, /registerOutgoingMessagePrepare/u);
  assert.match(index, /registerOutgoingMessageCompletion/u);
  assert.match(index, /prepareHumanTypingElementSend/u);
  assert.match(index, /completeHumanTypingElementSend/u);
  assert.doesNotMatch(index, /createMessageComposer|replaceComposer|new\s+Composer/u);
});