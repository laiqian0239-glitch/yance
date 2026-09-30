'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const read = value => fs.readFileSync(path.join(ROOT, ...value.split('/')), 'utf8');

test('Product model task editor exposes Auto plus eligible mature Model Brain candidates', () => {
  const shell = read('integration/element-module/src/product-experience/ProductExperienceShell.tsx');
  assert.match(shell, /preferredModelByTask/u);
  assert.match(shell, /preferredModelId/u);
  assert.match(shell, /自动选择/u);
  assert.match(shell, /taskEligibleModels\.map/u);
  assert.match(shell, /set-model-brain-preferences/u);
  assert.doesNotMatch(shell, /primaryModelId|fallbackModelId|set-task-model-policy/u);
});

test('manual Product selection stays a user preference and never calls Ollama directly', () => {
  const shell = read('integration/element-module/src/product-experience/ProductExperienceShell.tsx');
  const bridge = read('electron/r32StoreBridge.js');
  assert.match(shell, /action:\s*"set-model-brain-preferences"[\s\S]{0,240}task[\s\S]{0,240}preferredModelId/u);
  assert.match(bridge, /\/api\/r32\/models\/model-brain\/preferences/u);
  assert.doesNotMatch(shell, /fetch\([^)]*11434|\/api\/generate|\/api\/chat/iu);
});
