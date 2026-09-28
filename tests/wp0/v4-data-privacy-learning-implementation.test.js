'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const SHELL = path.join(ROOT, 'integration/element-module/src/product-experience/ProductExperienceShell.tsx');
const LEARNING = path.join(ROOT, 'integration/element-module/src/LearningWorkspace.tsx');
const SETTINGS = path.join(ROOT, 'integration/element-module/src/product-experience/ProductSystemSettingsSurface.tsx');
const PRELOAD = path.join(ROOT, 'electron/preload.js');
const BRIDGE = path.join(ROOT, 'electron/r32StoreBridge.js');

function read(file) { return fs.readFileSync(file, 'utf8'); }

test('V4 Data/Privacy/Learning is advanced governance, not primary navigation', () => {
  const shell = read(SHELL);
  assert.match(shell, /数据、隐私与学习/u);
  assert.match(shell, /<LearningWorkspace/u);
  assert.match(shell, /ProductSystemSettingsSurface category="data"/u);
  assert.doesNotMatch(shell, /<strong>学习<\/strong>/u);
});

test('V4 learning governance locks the four mature learning-mode meanings', () => {
  const learning = read(LEARNING);
  for (const marker of [
    '发送并学习', '仅发送，不学习', '本次例外', '本次不学习',
    'send_and_learn', 'send_only', 'exception', 'do_not_learn'
  ]) assert.ok(learning.includes(marker), `missing learning-mode marker: ${marker}`);
  assert.match(learning, /真实发送成功后/u);
  assert.match(learning, /仅当前轮/u);
  assert.match(learning, /阻止学习/u);
});

test('V4 learning UI exposes evidence-governed privacy boundaries without fake mutation', () => {
  const learning = read(LEARNING);
  for (const marker of ['临时证据', '重复证据', '可追溯', '可撤销', '不会自动修改']) {
    assert.ok(learning.includes(marker), `missing learning governance marker: ${marker}`);
  }
  assert.doesNotMatch(learning, /sendMessage|sendEvent|storeConfirmSend/u);
});

test('V4 data protection remains the mature backup/restore bridge', () => {
  const settings = read(SETTINGS), preload = read(PRELOAD), bridge = read(BRIDGE);
  assert.match(settings, /getProductDataProtectionState/u);
  assert.match(settings, /mutateProductDataProtection/u);
  assert.match(preload, /store:product-system-data-protection-state/u);
  assert.match(bridge, /productDataProtectionState/u);
  assert.match(bridge, /\/api\/r32\/system\/backups/u);
  assert.match(bridge, /\/api\/r32\/system\/portable-backups/u);
});
