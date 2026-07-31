'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('message menu exposes platform-aware basic actions and Yance enhancements', () => {
  const source = read('frontend/js/r32-conversation-capabilities.js');
  for (const marker of [
    "menuButton('forward','转发消息副本')",
    "menuButton('copy-original','复制原文')",
    "menuButton('copy-translation','复制中文翻译')",
    "menuButton('translate',translated?'重新翻译成中文':'翻译成中文')",
    "menuButton('show-bilingual','显示原文与中文')",
    "menuButton('generate-reply','根据这条消息生成回复')",
    "menuButton('add-note','加入客户备注')",
    "menuButton('add-fact','标记为待确认事实')",
    "menuButton('save-media','保存 / 下载')",
    "menuButton('copy-media','复制图片'"
  ]) assert.match(source, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(source, /function openForwardDialog\(message\)/);
  assert.match(source, /function forwardMessageTo\(message,target\)/);
  assert.match(source, /不伪装成平台原生转发标记/);
});

test('message-to-customer actions persist notes and confirmed facts through the workspace profile authority', () => {
  const source = read('frontend/js/r32-ui-runtime.js');
  assert.match(source, /window\.YanceMessageActions=Object\.freeze/);
  assert.match(source, /async function addMessageToNotes\(message\)/);
  assert.match(source, /async function addMessageConfirmedFact\(message\)/);
  assert.match(source, /source:'user_marked_message'/);
  assert.match(source, /persistCurrentProfile\(contact/);
});

test('contact menu is deliberately limited to conversation management and does not duplicate profile or relationship actions', () => {
  const source = read('frontend/js/r32-ui-runtime.js');
  for (const action of ['open','pin','archive']) assert.match(source, new RegExp(`data-contact-action=\"${action}\"`));
  for (const action of ['profile','identity','timeline','insights','unread','priority','mute','tag','note','copy']) {
    assert.doesNotMatch(source, new RegExp(`data-contact-action=\"${action}\"`));
  }
  assert.doesNotMatch(source, /toggleContactPriorityFromMenu|toggleContactMuteFromMenu|contactCopyableIdentity/);
});

test('context menus and forwarding use semantic theme tokens', () => {
  const css = read('frontend/r32-conversation-capabilities.css');
  assert.match(css, /\.r32-forward-list/);
  assert.match(css, /var\(--surface-card\)/);
  assert.match(css, /var\(--border-active\)/);
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/i);
});

test('bilingual chat search returns identity metadata and renders Chinese with original evidence', () => {
  const repository = read('backend/repositories/messageRepository.js');
  const frontend = read('frontend/js/r32-conversation-capabilities.js');
  assert.match(repository, /translatedZh/);
  assert.match(repository, /contactName/);
  assert.match(repository, /platform:/);
  assert.match(frontend, /正在同时搜索原文、中文译文和联系人身份/);
  assert.match(frontend, /r32-search-original/);
  assert.match(frontend, /focusSearchMessage/);
});

test('expression picker reports real platform capability and does not impersonate a native pack browser', () => {
  const service = read('backend/services/expressionLibraryService.js');
  const frontend = read('frontend/js/r32-conversation-capabilities.js');
  assert.match(service, /nativePackBrowser: platform === 'telegram' && nativeLibrary.available/);
  assert.match(service, /listNativeExpressions/);
  assert.match(service, /WhatsApp 原生贴纸收藏\/最近使用目录尚未接入/);
  assert.match(frontend, /stateLabel/);
  assert.match(frontend, /expressionMeta\.sources/);
});

test('media analysis keeps Chinese understanding and expandable source-language evidence', () => {
  const frontend = read('frontend/js/r32-conversation-capabilities.js');
  assert.match(frontend, /function bilingualAnalysisBlock/);
  assert.match(frontend, /中文用于你理解客户内容，发送给客户时仍保持客户语言/);
  assert.match(frontend, /查看原文/);
  assert.match(frontend, /r32-analysis-original/);
});
