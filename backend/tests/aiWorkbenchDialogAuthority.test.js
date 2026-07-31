'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('AI workbench destructive model operations use the themed dialog authority', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'js', 'r32-ai-workbench-runtime.js'), 'utf8');
  assert.match(source, /YanceDialogs\.confirm\(\{title:'停用模型'/);
  assert.match(source, /YanceDialogs\.prompt\(\{title:'永久删除本地模型'/);
  assert.match(source, /YanceDialogs\.confirm\(\{title:'删除云模型'/);
  assert.doesNotMatch(source, /[^.]\bconfirm\(`/);
  assert.doesNotMatch(source, /[^.]\bprompt\(`/);
});
