'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');

test('Learning remains user-reachable through Product secondary settings without restoring the legacy capability dashboard', () => {
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
  assert.match(shell, /\[learningAdminVisible,\s*setLearningAdminVisible\]\s*=\s*useState\(false\)/u);
  assert.match(shell, /<summary>体验设置<\/summary>/u);
  assert.match(shell, />学习控制<\/button>/u);
  assert.match(shell, /setLearningAdminVisible\(true\)/u);
  assert.match(shell, /learningAdminVisible\s*\?\s*<LearningWorkspace\s*\/>\s*:\s*null/u);
  assert.match(shell, /onToggle=\{[\s\S]*currentTarget\.open[\s\S]*setLearningAdminVisible\(false\)/u);
  assert.doesNotMatch(shell, /<\/AnimatePresence>\s*<LearningWorkspace\s*\/>\s*<details/u);

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
  ]) assert.match(workspace, new RegExp(label, 'u'), `${label} surface must remain available`);
  assert.match(workspace, /learningAssistantRuntime|invoke|action/iu);
});

test('Learning normal-user surface is Chinese-first and capability-oriented', () => {
  const workspace = fs.readFileSync(path.join(ROOT, 'integration/element-module/src/LearningWorkspace.tsx'), 'utf8');
  for (const label of ['概览', '每日回顾', '学习教练', '证据', '提案', '实验', '灰度发布', '晋级', '回滚', '隐私', '同意']) {
    assert.match(workspace, new RegExp(label, 'u'), `Learning missing Chinese-first label: ${label}`);
  }
});
