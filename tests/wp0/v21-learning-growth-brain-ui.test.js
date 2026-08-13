'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');

test('Learning composes through ProductExperienceShell without restoring the legacy YanceWorkspace capability dashboard', () => {
  const yancePath = path.join(ROOT, 'integration/element-module/src/YanceWorkspace.tsx');
  assert.equal(fs.existsSync(yancePath), true, 'YanceWorkspace.tsx must exist');
  const yance = fs.readFileSync(yancePath, 'utf8');
  assert.match(yance, /ProductExperienceShell/u);
  assert.doesNotMatch(yance, /LearningWorkspace/u);
  assert.doesNotMatch(yance, /CAPABILITIES|activeCapability|setActiveCapability/u);

  const shellPath = path.join(ROOT, 'integration/element-module/src/product-experience/ProductExperienceShell.tsx');
  assert.equal(fs.existsSync(shellPath), true, 'ProductExperienceShell.tsx must exist');
  const shell = fs.readFileSync(shellPath, 'utf8');
  assert.match(shell, /import\s+\{\s*LearningWorkspace\s*\}\s+from\s+["']\.\.\/LearningWorkspace["']/u);
  assert.match(shell, /<LearningWorkspace\s*\/>/u);

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
