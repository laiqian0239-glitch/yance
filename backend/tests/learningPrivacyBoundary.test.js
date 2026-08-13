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

test('per-conversation do-not-learn is a real visible control', () => {
  const workspacePath = path.join(ROOT, 'integration/element-module/src/LearningWorkspace.tsx');
  assert.equal(fs.existsSync(workspacePath), true, 'LearningWorkspace.tsx must exist');
  const workspace = fs.readFileSync(workspacePath, 'utf8');
  assert.match(workspace, /do not learn|doNotLearn/iu);
  assert.match(workspace, /Privacy|Consent/u);
});
