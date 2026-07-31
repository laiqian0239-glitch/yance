'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..', '..');
function source(file) { return fs.readFileSync(path.join(root, file), 'utf8'); }

test('candidate rejection collects a concrete reason instead of an opaque fixed code', () => {
  const ui = source('frontend/js/r32-ui-runtime.js');
  assert.match(ui, /拒绝原因（必填）/);
  assert.match(ui, /YanceDialogs\.prompt/);
  assert.doesNotMatch(ui, /USER_REJECTED_FROM_CANDIDATE_PANEL/);
});

test('learning governance separates lifecycle truth from actual learning and exposes permanent forget', () => {
  const ui = source('frontend/js/r32-phase1-governance-runtime.js');
  const client = source('frontend/js/r32-store-client.js');
  assert.match(ui, /候选到发送的真实生命周期/);
  assert.match(ui, /实际进入学习的正负样本/);
  assert.match(ui, /永久忘记/);
  assert.match(ui, /learningApplied/);
  assert.match(client, /learning-governance\/forget/);
  assert.match(client, /confirmForget/);
});
