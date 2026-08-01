'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const source = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const runtimeErrors = require('../../frontend/js/r32-runtime-errors');

test('renderer runtime failures distinguish recoverable network errors from fatal JavaScript faults', () => {
  assert.equal(typeof runtimeErrors.classifyRuntimeFailure, 'function');
  const aborted = runtimeErrors.classifyRuntimeFailure(Object.assign(new Error('Request aborted'), { name: 'AbortError' }), { kind: 'unhandledrejection' });
  assert.equal(aborted.recoverable, true);
  assert.equal(aborted.silent, true);
  assert.equal(aborted.reasonCode, 'RENDERER_OPERATION_ABORTED');

  const network = runtimeErrors.classifyRuntimeFailure(Object.assign(new Error('Failed to fetch'), { code: 'ERR_NETWORK_CHANGED' }), { kind: 'unhandledrejection' });
  assert.equal(network.recoverable, true);
  assert.equal(network.fatal, false);
  assert.equal(network.reasonCode, 'RENDERER_NETWORK_TRANSIENT');

  const fatal = runtimeErrors.classifyRuntimeFailure(new ReferenceError('missingAuthority is not defined'), { kind: 'error' });
  assert.equal(fatal.fatal, true);
  assert.equal(fatal.recoverable, false);
  assert.equal(fatal.reasonCode, 'RENDERER_JAVASCRIPT_FAULT');
});

test('AI workbench hydrates global model state even when no contact is active', () => {
  const ui = source('frontend/js/r32-ai-workbench-runtime.js');
  const openStart = ui.indexOf('function openAIWorkbench');
  const openEnd = ui.indexOf('\nfunction undo', openStart);
  const openBody = ui.slice(openStart, openEnd);
  assert.ok(openStart >= 0 && openEnd > openStart);
  assert.doesNotMatch(openBody, /if\(state\.selectedId\)refreshAiRuntimeStatus\(\);else renderPanel/u);
  assert.match(openBody, /refreshAiRuntimeStatus\(\{reason:'workbench-open'/u);
  assert.match(ui, /modelRuntime:\{status:'idle'/u);
  assert.match(ui, /MODEL_RUNTIME_RECOVERING/u);
  assert.match(ui, /当前没有活动联系人也会读取全局模型注册表/u);
});

test('network utility recovery requests bounded model state rehydration', () => {
  const main = source('electron/main.js');
  const preload = source('electron/preload.js');
  const ui = source('frontend/js/r32-ai-workbench-runtime.js');
  assert.match(main, /app\.on\('child-process-gone'/u);
  assert.match(main, /desktop:runtime-health/u);
  assert.match(preload, /onRuntimeHealth:/u);
  assert.match(ui, /onRuntimeHealth/u);
  assert.match(ui, /rehydrate-network-dependent-state/u);
  assert.match(ui, /scheduleModelRuntimeRefresh/u);
});

test('global renderer errors are classified and exported with structured evidence', () => {
  const ui = source('frontend/js/r32-ui-runtime.js');
  assert.match(ui, /classifyRuntimeFailure/u);
  assert.match(ui, /recordRendererRuntimeFailure/u);
  assert.match(ui, /runtimeErrors:/u);
  assert.match(ui, /runtimeProcessHealth:/u);
  assert.doesNotMatch(ui, /window\.addEventListener\('error',e=>\{[^\n]*showSystemStatus\('error','检测到运行异常/u);
});

test('model service page renders explicit loading, recovery and failure states instead of a blank area', () => {
  const ui = source('frontend/js/r32-ai-workbench-runtime.js');
  assert.match(ui, /正在读取全局模型注册表/u);
  assert.match(ui, /网络服务已重启，正在重新读取模型状态/u);
  assert.match(ui, /模型运行状态读取失败/u);
  assert.match(ui, /data-model-runtime-state/u);
});

test('model runtime hydration and recovery state is exported in workspace diagnostics', () => {
  const workbench = source('frontend/js/r32-ai-workbench-runtime.js');
  const ui = source('frontend/js/r32-ui-runtime.js');
  assert.match(workbench, /__YanceModelRuntimeDiagnostics/u);
  assert.match(ui, /modelRuntime:/u);
});

test('bounded model runtime recovery terminates in failed state without duplicate in-flight requests', () => {
  const ui = source('frontend/js/r32-ai-workbench-runtime.js');
  assert.match(ui, /MODEL_RUNTIME_RETRY_DELAYS\[Math\.max\(0,attempt-1\)\]/u);
  assert.match(ui, /runtime\.attempt<MODEL_RUNTIME_RETRY_DELAYS\.length/u);
  assert.doesNotMatch(ui, /modelRuntimeRefreshPromise&&!options\.force/u);
  assert.match(ui, /if\(modelRuntimeRefreshPromise\)return modelRuntimeRefreshPromise/u);
});

test('derived source identity declares FIX6H runtime recovery authorities', () => {
  const delivery = source('tools/runtime-delivery/source-uat-delivery.js');
  assert.match(delivery, /windowsRuntimeRecoveryAuthority:\s*true/u);
  assert.match(delivery, /contactIndependentModelHydration:\s*true/u);
  assert.match(delivery, /rendererRuntimeFailureClassification:\s*true/u);
  assert.match(delivery, /windowsExplorerPathAuthority:\s*true/u);
});
