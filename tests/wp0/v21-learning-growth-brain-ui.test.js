'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');

test('Learning is a top-level product capability with the complete runtime-backed workspace', () => {
  const yancePath = path.join(ROOT, 'integration/element-module/src/YanceWorkspace.tsx');
  assert.equal(fs.existsSync(yancePath), true, 'YanceWorkspace.tsx must exist');
  const yance = fs.readFileSync(yancePath, 'utf8');
  assert.match(yance, /Learning/u);

  const workspacePath = path.join(ROOT, 'integration/element-module/src/LearningWorkspace.tsx');
  assert.equal(fs.existsSync(workspacePath), true, 'LearningWorkspace.tsx must exist');
  const workspace = fs.readFileSync(workspacePath, 'utf8');
  for (const label of [
    'Overview',
    'Daily Review',
    'Learning Coach',
    'Evidence',
    'Proposals',
    'Experiments',
    'Rollout',
    'Promotion',
    'Rollback',
    'Privacy',
    'Consent'
  ]) assert.match(workspace, new RegExp(label, 'u'), `${label} surface must be visible`);
  assert.match(workspace, /learningAssistantRuntime|invoke|action/iu);
});
