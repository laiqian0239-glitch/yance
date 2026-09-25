'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const AI = path.join(ROOT, 'integration/element-module/src/product-experience/AIWorkspace.tsx');
const SHELL = path.join(ROOT, 'integration/element-module/src/product-experience/ProductExperienceShell.tsx');
const PROJECTION = path.join(ROOT, 'integration/element-module/src/product-experience/experienceProjection.ts');
const CSS = path.join(ROOT, 'integration/element-module/src/product-experience/ProductExperienceShell.css');
const ROUTE = path.join(ROOT, 'backend/routes/workspace.js');
const BRIDGE = path.join(ROOT, 'electron/r32StoreBridge.js');
const PRELOAD = path.join(ROOT, 'electron/preload.js');
function read(file) { return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''; }

test('AI Workspace v4 exists as a deep workspace and is not restored as a primary rail item', () => {
  const ai = read(AI), shell = read(SHELL);
  assert.match(ai, /export function AIWorkspace/u);
  assert.match(shell, /aiWorkspaceVisible/u);
  assert.match(shell, /<AIWorkspace/u);
  assert.doesNotMatch(shell, /<strong>AI 助手<\/strong>/u);
  assert.doesNotMatch(shell, /<strong>AI 工作台<\/strong>/u);
});

test('AI Workspace task controls are real backend-backed handlers', () => {
  const ai = read(AI), projection = read(PROJECTION);
  for (const token of ['loadAiWorkspace','createAiWorkspaceTask','updateAiWorkspaceTask','runAiWorkspaceTask']) {
    assert.match(ai, new RegExp(token, 'u'));
    assert.match(projection, new RegExp(`export async function ${token}`, 'u'));
  }
  for (const label of ['新建 AI 任务','保存任务','重新运行','运行任务']) assert.match(ai, new RegExp(label, 'u'));
  assert.match(ai, /onClick=\{[^}]*run/u);
});

test('AI Workspace projects only real people/evidence and never imports a send authority', () => {
  const ai = read(AI);
  assert.match(ai, /result\.ranked/u);
  assert.match(ai, /evidenceRefs/u);
  assert.match(ai, /onOpenRelationship/u);
  assert.match(ai, /onOpenConversation/u);
  assert.match(ai, /不会直接发送消息/u);
  assert.match(ai, /不会把分析自动升级为事实/u);
  assert.doesNotMatch(ai, /storeConfirmSend|prepareOutboundMessage|sendEvent|sendMessage|stageApprovedReply/u);
  assert.doesNotMatch(ai, /Hermes|Sophia|Claude 3\.5|GPT-4o|Gemini 2\.5/u);
});

test('AI Workspace model and context controls use current real owners rather than demo constants', () => {
  const ai = read(AI);
  assert.match(ai, /getProductModelRuntimeState/u);
  for (const label of ['联系人范围','时间范围','结果数量','真实对话','共享时刻','确认记忆与未完成事项','关系目标','推理强度','引用来源','区分事实与趋势']) {
    assert.match(ai, new RegExp(label, 'u'));
  }
  assert.match(ai, /verified/u);
  assert.match(ai, /modelId/u);
  assert.match(ai, /reasoningStrength/u);
});

test('AI Workspace v4 CSS owns the approved task-list, result and settings columns', () => {
  const css = read(CSS);
  assert.match(css, /\.yance-ai-workspace-v4\s*\{/u);
  assert.match(css, /\.yance-ai-workspace-v4__tasks/u);
  assert.match(css, /\.yance-ai-workspace-v4__main/u);
  assert.match(css, /\.yance-ai-workspace-v4__settings/u);
  assert.match(css, /grid-template-columns:\s*minmax\(240px,\s*320px\)\s+minmax\(0,\s*1fr\)\s+minmax\(260px,\s*340px\)/u);
});

test('AI Workspace desktop bridge and HTTP routes expose only the admitted task seams', () => {
  const route = read(ROUTE), bridge = read(BRIDGE), preload = read(PRELOAD);
  for (const endpoint of ['/ai-workspace', '/ai-workspace/tasks', '/ai-workspace/tasks/:taskId', '/ai-workspace/tasks/:taskId/run']) {
    assert.ok(route.includes(endpoint), `missing endpoint ${endpoint}`);
  }
  for (const channel of ['store:ai-workspace-load','store:ai-workspace-create-task','store:ai-workspace-update-task','store:ai-workspace-run-task']) {
    assert.ok(bridge.includes(channel), `bridge missing ${channel}`);
    assert.ok(preload.includes(channel), `preload missing ${channel}`);
  }
  assert.match(route, /productAiWorkspace\.runTask/u);
  assert.match(route, /cross-module-ai-analysis/u);
});
