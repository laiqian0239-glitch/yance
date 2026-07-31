'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const index = read('frontend/index.html');
const capabilities = read('frontend/js/r32-conversation-capabilities.js');
const updateCenter = read('frontend/r32-update-center.js');
const persona = read('frontend/js/r32-persona-runtime.js');
const runtimeErrors = require('../../frontend/js/r32-runtime-errors.js');

function loadedScripts() {
  return [...index.matchAll(/<script[^>]+src="([^"]+)"/g)]
    .map(match => path.join(root, 'frontend', match[1].replace(/^\//, '')))
    .filter(file => fs.existsSync(file));
}

test('every static button id in the formal workspace is referenced by a loaded runtime', () => {
  const scripts = loadedScripts();
  const source = scripts.map(file => fs.readFileSync(file, 'utf8')).join('\n');
  const buttons = [...index.matchAll(/<button\b([^>]*)>/gi)]
    .map(match => /\bid="([^"]+)"/.exec(match[1])?.[1] || '')
    .filter(Boolean);
  assert.ok(buttons.length >= 80, `expected formal workspace button inventory, got ${buttons.length}`);
  const missing = buttons.filter(id => !source.includes(id));
  assert.deepEqual(missing, []);
});

test('conversation menu is intentionally slim and every retained action has one real handler', () => {
  const retained = ['search', 'export', 'clear', 'archive'];
  for (const action of retained) {
    assert.match(capabilities, new RegExp(`data-conv=["']${action}["']`));
    assert.ok(capabilities.includes(`querySelector('[data-conv="${action}"]')`), `missing handler for ${action}`);
  }
  const removed = [
    'contact', 'media-center', 'read', 'mute-notifications', 'mute-account',
    'mute-platform', 'priority-notifications', 'disappearing', 'block', 'report',
    'clear-local', 'refresh', 'capabilities'
  ];
  for (const action of removed) assert.doesNotMatch(capabilities, new RegExp(`data-conv=["']${action}["']`));
  assert.match(capabilities, /hasComposerContext\?'<button[^>]+data-conv="clear"/);
  assert.match(capabilities, /c\?\.archived\?'恢复到活跃会话':'归档会话'/);
});

test('structured frontend errors cannot collapse to object Object in key global surfaces', () => {
  const nested = { error: { reasonCode: 'MODEL_FAILED', message: '模型资格验证失败' } };
  assert.equal(runtimeErrors.userMessage(nested, { fallback: '失败' }), '模型资格验证失败');
  assert.equal(runtimeErrors.userMessage({ error: {} }, { fallback: '安全失败提示' }), '安全失败提示');
  assert.match(capabilities, /parseJsonResponse\(response,'媒体识别'\)/);
  assert.match(capabilities, /媒体识别返回了无效结果/);
  assert.match(capabilities, /function sendFailure\(payload,response,label\)/);
  assert.match(capabilities, /friendlyErrorMessage\(payload,`\$\{label\}失败（HTTP \$\{response\.status\}）`\)/);
  assert.match(capabilities, /label:'媒体转发'/);
  assert.match(capabilities, /label:'消息转发'/);
  assert.doesNotMatch(capabilities, /new Error\(payload\.message\|\|payload\.error\|\|/);
  assert.match(persona, /runtimeErrors\.createError/);
  assert.doesNotMatch(persona, /new Error\(payload\.message \|\| payload\.error/);
});

test('update center initial and user-triggered failures are visible, finite, and retryable', () => {
  assert.match(updateCenter, /function reportUpdateError\(error, retry\)/);
  assert.match(updateCenter, /YanceSystemStatus\?\.show\?\.\('error'/);
  assert.match(updateCenter, /actionLabel: typeof retry === 'function' \? '重试' : ''/);
  assert.match(updateCenter, /duration: 7000/);
  assert.match(updateCenter, /desktop\.getUpdateState\(\)\.then\(render\)\.catch\(error => reportUpdateError/);
  assert.match(updateCenter, /executeUpdatePhase\(attemptedPhase\)/);
  assert.doesNotMatch(updateCenter, /getUpdateState\(\)\.then\(render\)\.catch\(\(\) => \{\}\)/);
  assert.doesNotMatch(updateCenter, /error\?\.message \|\| String\(error\)/);
});
