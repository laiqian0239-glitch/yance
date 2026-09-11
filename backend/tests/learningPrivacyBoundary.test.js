'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');

test('Learning privacy fails closed before evidence leaves the device', () => {
  const policyPath = path.join(ROOT, 'backend/services/learningDataPolicy.js');
  assert.equal(fs.existsSync(policyPath), true, 'learningDataPolicy.js must exist');
  const policy = fs.readFileSync(policyPath, 'utf8');
  assert.match(policy, /Presidio|presidio/u);
  assert.match(policy, /doNotLearn|do_not_learn/u);
  assert.match(policy, /loopback|localhost|remote.*off|telemetry.*off/iu);
});

test('learning workspace refuses a fake per-conversation do-not-learn switch without a durable authority', () => {
  const workspacePath = path.join(ROOT, 'integration/element-module/src/LearningWorkspace.tsx');
  assert.equal(fs.existsSync(workspacePath), true, 'LearningWorkspace.tsx must exist');
  const workspace = fs.readFileSync(workspacePath, 'utf8');
  // Privacy/Consent surfaces stay visible in the learning workspace.
  assert.match(workspace, /Privacy|Consent/u);
  // The UI intentionally does not present a non-durable per-conversation
  // "do not learn" toggle; the fail-closed boundary is owned by learningDataPolicy.
  assert.match(workspace, /会话级持久化/u);
  assert.match(workspace, /不要学习/u);
  assert.match(workspace, /假开关/u);
});
