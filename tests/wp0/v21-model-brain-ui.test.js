'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const p = value => path.join(ROOT, ...value.split('/'));
const read = value => {
  assert.equal(fs.existsSync(p(value)), true, `missing ${value}`);
  return fs.readFileSync(p(value), 'utf8');
};
const exists = value => fs.existsSync(p(value));

test('active Element Product exposes current Model Brain/LiteLLM status without a task-route editor', () => {
  const surface = read('integration/element-module/src/product-experience/ProductSystemSettingsSurface.tsx');
  const shell = read('integration/element-module/src/product-experience/ProductExperienceShell.tsx');
  const bridge = read('electron/r32StoreBridge.js');
  const preload = read('electron/preload.js');

  assert.match(shell, /ProductSystemSettingsSurface/u);
  assert.match(surface, /Model Brain/iu);
  assert.match(surface, /LiteLLM/iu);
  assert.match(surface, /运行状态|不可用|状态已读取/iu);
  assert.match(surface, /quick_reply/u);
  assert.match(surface, /deep_reply/u);
  assert.match(surface, /director/u);
  assert.doesNotMatch(surface, /任务路由|主模型|备用模型|primaryModelId|fallbackModelId|replyBrainScore/iu);

  assert.match(bridge, /\/api\/r32\/models\/model-brain\/status/u);
  assert.match(bridge + preload, /store:product-system-model-runtime-state/u);
  assert.match(preload, /getProductModelRuntimeState/u);
});

test('route-draft and ranked OpenRouter presentation authorities remain retired', () => {
  const snapshot = read('frontend/js/r32-model-runtime-snapshot-authority.js');
  const openRouter = read('frontend/js/r32-openrouter-presentation-authority.js');
  assert.equal(exists('frontend/js/r32-route-draft-authority.js'), false);
  assert.doesNotMatch(snapshot, /routeDraftDirty|primaryModelId|fallbackModelId|champion|challenger|qualified.*pool/iu);
  assert.match(snapshot, /model.?brain|litellm/iu);
  assert.doesNotMatch(openRouter, /candidate\s*[AB]|候选\s*[AB]|preferredRoute|selectionScore|qualityTier|frontierScore|primary|fallback/iu);
  assert.match(openRouter, /catalog|capabilit|credential|account/iu);
});

test('diagnostics, architecture and runtime artifacts expose current Model Brain truth', () => {
  const system = read('backend/services/systemCenterService.js');
  const diagnostics = read('backend/services/diagnosticsService.js');
  const architecture = read('backend/services/round12ArchitectureStatusService.js');
  const runtime = read('backend/services/runtimeArtifactBootstrapService.js');

  assert.match(system, /Model Brain/iu);
  assert.match(system, /LiteLLM/iu);
  assert.match(system, /degraded|unavailable|health|运行状态/iu);
  assert.doesNotMatch(system, /主模型|备用模型|任务路由|routesPersisted|routesOperational/iu);
  assert.doesNotMatch(diagnostics, /AI 回复大脑任务路由完整|primary.*fallback|routeIntegrity.*pass/iu);
  assert.match(diagnostics, /model.?brain|litellm/iu);
  assert.doesNotMatch(architecture, /aiQualityRouteAuthority|same-tier fallback|emergency mode|high-tier primary/iu);
  assert.match(architecture, /model.?brain|litellm/iu);
  assert.doesNotMatch(runtime, /commercialScores|replyBrainScore|primary|fallback|routeIntegrity/iu);
  assert.match(runtime, /model.?brain|litellm/iu);
});

test('active Product uses fixed authenticated model capabilities, not Yance scores or an arbitrary renderer route', () => {
  const surface = read('integration/element-module/src/product-experience/ProductSystemSettingsSurface.tsx');
  const bridge = read('electron/r32StoreBridge.js');
  const preload = read('electron/preload.js');

  for (const route of [
    '/api/r32/models/model-brain/status',
    '/api/r32/models/adaptive-local/catalog',
    '/api/r32/models/adaptive-local/hardware',
    '/api/r32/models/adaptive-local/status',
    '/api/r32/models/adaptive-local/plan',
    '/api/r32/models/adaptive-local/materialize',
    '/api/r32/models/adaptive-local/remove',
    '/api/r32/models/ollama/pull',
    '/api/r32/models/ollama/pull/cancel'
  ]) assert.match(bridge, new RegExp(route.replaceAll('/', '\\/'), 'u'));

  for (const method of [
    'getProductModelRuntimeState',
    'mutateProductModelRuntime'
  ]) assert.match(preload, new RegExp(method, 'u'));

  assert.doesNotMatch(bridge, /input\.(?:url|method)|apiRequest\(\s*clean\(input/iu);
  assert.doesNotMatch(surface, /score slider|质量评分|成本评分|速度评分|首选主模型|备用模型|replyBrainScore/iu);
  assert.match(surface, /本地模型不会静默替代正式回复/u);
});
