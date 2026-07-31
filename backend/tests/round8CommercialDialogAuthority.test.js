'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const files = [
  'frontend/r32-system-center.js',
  'frontend/r32-settings-recovery.js',
  'frontend/r32-account-center.js',
  'frontend/js/r32-persona-runtime.js',
  'frontend/js/r32-phase1-governance-runtime.js',
  'frontend/js/r32-conversation-capabilities.js',
  'frontend/js/r32-ui-runtime.js'
];

test('commercial workspaces use the themed dialog authority instead of browser-native confirmation prompts', () => {
  for (const file of files) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    assert.doesNotMatch(source, /(?<!YanceDialogs\.)\b(?:window\.)?confirm\s*\(/, `${file} still uses native confirm`);
    assert.doesNotMatch(source, /(?<!YanceDialogs\.)\b(?:window\.)?prompt\s*\(/, `${file} still uses native prompt`);
  }
});

test('destructive account, recovery, persona and learning actions are still explicitly confirmed', () => {
  const joined = files.map(file => fs.readFileSync(path.join(root, file), 'utf8')).join('\n');
  for (const title of ['删除账号绑定','退出账号','暂存恢复计划','回滚人物基线','删除学习偏好','清空回复学习']) {
    assert.match(joined, new RegExp(title));
  }
  assert.match(joined, /YanceDialogs\.confirm/);
  assert.match(joined, /YanceDialogs\.prompt/);
});
