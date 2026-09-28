'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const shell = () => fs.readFileSync(path.join(ROOT, 'integration/element-module/src/product-experience/ProductExperienceShell.tsx'), 'utf8');
const styles = () => fs.readFileSync(path.join(ROOT, 'integration/element-module/src/product-experience/ProductExperienceShell.css'), 'utf8');

test('Conversation Workspace v4 exposes the approved desktop controls without replacing Element authority', () => {
  const source = shell();
  assert.match(source, /onAddContact:\s*\(\)\s*=>\s*void/u);
  assert.match(source, /className="yance-conversation-add-contact"[\s\S]*添加联系人/u);
  assert.match(source, /\["persona",\s*"人格"\]/u);
  assert.match(source, /inspectorTab === "persona"/u);
  assert.match(source, /className="yance-desktop-rail"/u);
  assert.doesNotMatch(source, /className="yance-conversation-rail"/u);
  assert.match(source, /productPresentation:\s*"yance-conversation"/u);
});
test('Conversation Workspace v4 matches the approved 2048 desktop proportions', () => {
  const css = styles();
  assert.match(css, /--yance-conversation-v4-contacts:\s*400px/u);
  assert.match(css, /--yance-conversation-v4-insight:\s*408px/u);
  assert.match(css, /--yance-conversation-v4-topbar:\s*68px/u);
  assert.match(css, /\.yance-product-shell\[data-conversation-surface-active\]\s*\{[\s\S]{0,160}padding:\s*0\s+0\s+0\s+102px/u);
  assert.match(css, /\.yance-conversation-workspace-v4\s*\{[\s\S]{0,260}grid-template-columns:\s*minmax\(0,\s*1fr\)/u);
  assert.match(css, /grid-template-rows:\s*var\(--yance-conversation-v4-topbar\)\s+minmax\(0,\s*1fr\)/u);
  assert.match(css, /grid-template-columns:\s*var\(--yance-conversation-v4-contacts\)\s+minmax\(0,\s*1fr\)\s+var\(--yance-conversation-v4-insight\)/u);
});

const projection = () => fs.readFileSync(path.join(ROOT, 'integration/element-module/src/product-experience/ProductConversationProjection.tsx'), 'utf8');
const experienceProjection = () => fs.readFileSync(path.join(ROOT, 'integration/element-module/src/product-experience/experienceProjection.ts'), 'utf8');

test('Conversation Workspace v4 exposes the six approved Reply Brain quick-style controls', () => {
  const source = projection();
  for (const label of ['更自然', '成熟', '暧昧', '少问', '别太主动', '更像我']) {
    assert.match(source, new RegExp(`>${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}<`, 'u'), `missing quick-style control: ${label}`);
  }
});

test('Conversation Workspace v4 projects mature send-and-learn choice into AI approval', () => {
  const source = projection();
  const api = experienceProjection();
  assert.match(source, /发送并学习/u);
  assert.match(source, /send_and_learn/u);
  assert.match(source, /send_only/u);
  assert.match(api, /approveReplyCandidate\(candidateId:\s*string,\s*learningMode:/u);
  assert.match(api, /storeApproveReply\(\{\s*candidateId,\s*learningMode\s*\}\)/u);
});

test('Conversation Workspace v4 keeps user model choice reachable at the conversation bottom', () => {
  const source = shell();
  assert.match(source, /className="yance-conversation-model-control"/u);
  assert.match(source, /modelSummary\.(?:quickPrimary|deepPrimary|quickMode|deepMode)/u);
  assert.match(source, /onOpenModels/u);
});
