'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const { contactFromConversation } = require('../services/workspaceService');

function sourceBetween(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.notEqual(from, -1, `missing source anchor: ${start}`);
  assert.notEqual(to, -1, `missing source anchor: ${end}`);
  return source.slice(from, to);
}

test('Fix22: profile text resolves the complete fallback chain across all platforms', () => {
  const source = read('frontend/js/r32-ui-runtime.js');
  const block = sourceBetween(source, 'const invalidProfileText=', 'function mergeLocalizedContent');
  const context = {};
  vm.createContext(context);
  vm.runInContext(`${block};this.profileText=profileText;`, context);

  assert.equal(context.profileText('', null, 'Yeonhee Kim', '未识别账号'), 'Yeonhee Kim');
  assert.equal(context.profileText(undefined, 'undefined', '', 'Anna'), 'Anna');
  assert.equal(context.profileText([], ['Deutsch', '', 'English'], '未知'), 'Deutsch、English');
  assert.equal(context.profileText(null, undefined, ''), '');
});

test('Fix22: Facebook presence is omitted rather than rendered as an unsupported online state', () => {
  const recent = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const facebook = contactFromConversation({
    sessionKey: 'fb-account:contact-1',
    platform: 'facebook',
    accountId: 'fb-account',
    title: 'Facebook Contact',
    lastMessageAt: recent,
    payload: { platform: 'facebook' }
  });
  assert.equal(facebook.presenceSupport, 'unsupported');
  assert.notEqual(facebook.last, '平台不提供上线状态');
  assert.match(facebook.last, /分钟前|刚刚/);

  const ui = read('frontend/js/r32-ui-runtime.js');
  assert.match(ui, /presenceUnsupported=!contactPresenceSupported\(c\)/u);
  assert.match(ui, /activityFact=presenceUnsupported\?\['最近互动'/u);
  assert.doesNotMatch(ui, /\['当前状态',c\.last\]/u);
});

test('Fix22: narrow chat headers wrap all route controls instead of relying only on taller rows', () => {
  const css = read('frontend/r32-conversation-center-v2.css');
  assert.match(css, /@media\(max-width:1220px\)[\s\S]*\.chat-identity\{grid-template-columns:minmax\(0,1fr\)/u);
  assert.match(css, /\.chat-route\{grid-column:1\/-1;display:grid;grid-template-columns:repeat\(2,minmax\(120px,1fr\)\)/u);
  assert.match(css, /@media\(max-width:980px\)[\s\S]*\.chat-head\{grid-template-columns:minmax\(0,1fr\)/u);
  assert.match(css, /\.chat-account-select,.chat-bilingual-select,.chat-language-select\{width:100%;max-width:none;margin:0\}/u);
});

test('Round7: the slim contact menu exposes no copy action, so opaque platform IDs cannot be copied from that surface', () => {
  const source = read('frontend/js/r32-ui-runtime.js');
  assert.doesNotMatch(source, /data-contact-action="copy"/u);
  assert.doesNotMatch(source, /function contactCopyableIdentity/u);
  assert.doesNotMatch(source, /复制号码|复制联系方式|内部身份 ID/u);
});
