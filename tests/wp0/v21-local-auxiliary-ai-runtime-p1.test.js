'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..', '..');
const read = repositoryPath => fs.readFileSync(path.join(ROOT, repositoryPath), 'utf8');
const AUTHORIZATION_PATH = 'governance/layered-ci/v21-local-auxiliary-ai-runtime-p1-v1-authorization.json';

function changedFileSetSha256(paths) {
  const normalized = [...new Set(paths)].sort();
  return crypto.createHash('sha256').update(`${normalized.join('\n')}\n`, 'utf8').digest('hex');
}

test('delegated authorization seals the exact implementation and Fast Closure V2 failure-first path sets', () => {
  const authorization = JSON.parse(read(AUTHORIZATION_PATH));
  const implementation = authorization.implementation;
  const failureFirst = implementation.failureFirstCommit;

  assert.equal(implementation.branch, 'product/v21-local-auxiliary-ai-runtime-p1-v1');
  assert.equal(implementation.allowedChangedPaths.length, 20);
  assert.equal(implementation.approvedChangedFileCount, 20);
  assert.equal(changedFileSetSha256(implementation.allowedChangedPaths), implementation.approvedChangedFileSetSha256);
  assert.deepEqual(failureFirst.allowedChangedPaths, [
    'backend/tests/localAuxiliaryAiRuntimeP1.test.js',
    'tests/wp0/v21-local-auxiliary-ai-runtime-p1.test.js'
  ]);
  assert.equal(changedFileSetSha256(failureFirst.allowedChangedPaths), failureFirst.approvedChangedFileSetSha256);
  assert.equal(failureFirst.productionCodeChanged, false);
  assert.equal(failureFirst.fastClosureV2.enabled, true);
  assert.equal(failureFirst.fastClosureV2.requiredClosureTrailer, 'Yance-Closure-Matrix-Unknown-Blockers: 0');
});

test('formal reply remains LiteLLM cloud authority and local auxiliary scheduling is physically isolated', () => {
  const projection = read('backend/services/modelBrainProjection.js');
  const gateway = read('backend/services/aiGateway.js');

  assert.match(projection, /quick_reply/u);
  assert.match(projection, /deep_reply/u);
  assert.match(projection, /director/u);
  assert.match(projection, /source:cloud/u, 'formal reply projection must materialize a cloud-only hard constraint');
  assert.match(projection, /AUXILIARY_RUNTIME_PROVIDERS/u, 'formal reply must explicitly deny auxiliary runtime providers rather than falsifying locality');
  assert.match(projection, /deniedProviders/u);
  assert.match(projection, /isLoopbackHost\(endpointHost\(endpoint\)\)/u, 'local/cloud truth must continue to use real endpoint locality');
  assert.match(projection, /localAuxiliarySlaTasks/u, 'local background admission must bind benchmark/SLA-qualified tasks');
  assert.match(projection, /YanceCommercialModelBenchmark/u);
  assert.match(projection, /auxiliaryOnly/u, 'Model Brain hard projection must expose an explicit auxiliary-only constraint for scheduler isolation');
  assert.match(gateway, /localAuxiliaryQueue/u, 'AiGateway must own a scheduler separate from the interactive Model Brain queue');
  assert.match(gateway, /local-auxiliary/u, 'the auxiliary scheduler must have an explicit local-auxiliary identity');
  assert.match(gateway, /_schedulerPlan/u, 'background queue choice must be gated by an admitted auxiliary-only projection');
  assert.match(gateway, /auxiliaryOnly: true/u);
  assert.match(gateway, /AUXILIARY_RUNTIME_PROVIDERS/u, 'scheduler admission must bind the same auxiliary provider authority as Model Brain projection');
  assert.match(gateway, /providerKey: schedulerPlan\.localAuxiliary \? 'local-auxiliary' : 'model-brain'/u);
  assert.doesNotMatch(gateway, /const scheduler = background === true \? this\.localAuxiliaryQueue : this\.queue/u, 'background=true alone must never move cloud-capable work onto the local auxiliary scheduler');
});

test('existing Ollama seam grows truthful pull/progress/cancel lifecycle without introducing another local runtime or arbitrary pull endpoint', () => {
  const ollama = read('backend/services/ollamaClient.js');
  const routes = read('backend/routes/models.js');
  const workbench = read('frontend/js/r32-ai-workbench-runtime.js');

  assert.match(ollama, /\/api\/pull/u, 'on-demand model assets must reuse Ollama /api/pull');
  assert.match(ollama, /onProgress/u, 'physical pull must surface progress');
  assert.match(ollama, /authorizedPullRoot/u, 'pull must constrain caller-supplied endpoints to loopback or trusted Ollama configuration');
  assert.match(ollama, /OLLAMA_ENDPOINT_NOT_AUTHORIZED/u);
  assert.match(ollama, /const layers = new Map\(\)/u, 'multi-layer pulls must aggregate progress by digest rather than replace the previous layer');
  assert.match(ollama, /knownTotal = \[\.\.\.layers\.values\(\)\]\.reduce/u, 'known layer totals must aggregate without pretending to be a final global denominator');
  assert.match(ollama, /completed = \[\.\.\.layers\.values\(\)\]\.reduce/u, 'completed bytes must remain cumulative across layer boundaries');
  assert.match(ollama, /if \(status\.toLowerCase\(\) === 'success'\)[\s\S]*total = Math\.max\(knownTotal, completed\);[\s\S]*percent = 100;[\s\S]*else \{[\s\S]*total = 0;[\s\S]*percent = 0;/u, 'global total and percentage must remain unknown until terminal success');
  assert.match(routes, /\/local\/pull/u, 'model routes must expose explicit user-consented local pull');
  assert.match(routes, /pull.*cancel|cancel.*pull/us, 'model routes must expose cancellation for an active pull');
  assert.match(routes, /pullLocalModel[\s\S]*controller\.signal\.aborted[\s\S]*pullControllers\.delete\(requestId\)[\s\S]*state: 'finalizing'[\s\S]*discoverLocalModels/u, 'accepted cancellation must be observed before cancellation authority ends, and finalization must begin only after physical pull completion');
  assert.match(routes, /if \(!controller\) return res\.json\(\{ ok: true, requestId, cancelled: false/u, 'late cancellation during finalization must be reported as not applied');
  assert.match(workbench, /percent:0/u, 'Workbench pull state must represent nonterminal global percentage as unknown');
  assert.match(workbench, /Number\.isFinite\(Number\(pull\.percent\)\)/u, 'Workbench must consume the backend percentage projection rather than inventing a separate authority when the projection is present');
  assert.match(workbench, /if\(payload\.cancelled===true\)/u, 'Workbench must distinguish accepted from late/no-op cancellation');
  assert.match(workbench, /下载已进入完成阶段，取消未生效/u);
  assert.match(workbench, /state:String\(payload\.state\|\|current\.state\|\|'running'\)/u, 'desktop progress events must preserve the backend finalizing state');
  assert.match(workbench, /finally\{if\(button\)button\.textContent=old\|\|'取消下载';renderModels\(\)\}/u, 'failed cancellation must rerender the button from truthful pull state');
  assert.match(routes, /unload/u);
  assert.match(routes, /delete|removeLocalModel/u);

  const runtimeSources = [
    read('backend/services/ollamaClient.js'),
    read('backend/services/aiGateway.js'),
    read('backend/services/modelBrainProjection.js')
  ].join('\n');
  assert.doesNotMatch(runtimeSources, /ktransformers|airllm|llama\.cpp/iu, 'V1 must not admit a second local inference runtime');
});

test('local auxiliary authority, benchmark/SLA evidence and truthful UI status are first-class but never reply authority', () => {
  const statusProjection = read('backend/services/modelStatusProjection.js');
  const systemCenter = read('backend/services/systemCenterService.js');
  const workbench = read('frontend/js/r32-ai-workbench-runtime.js');
  const systemCenterUi = read('frontend/r32-system-center.js');

  assert.match(statusProjection, /localAuxiliary/u);
  assert.match(statusProjection, /YanceCommercialModelBenchmark/u);
  assert.match(statusProjection, /benchmarkPass/u);
  assert.match(statusProjection, /sla/iu);
  assert.match(systemCenter, /localAuxiliary/u);
  assert.match(workbench, /localAuxiliary/u);
  assert.match(workbench, /pull|download|下载/iu);
  assert.match(systemCenterUi, /localAuxiliary/u);
  assert.match(systemCenterUi, /localSla\.admissionRequiresQualificationAndBenchmarkEvidence === false \? 'bad' : localBenchmark\.available \? '' : 'warn'/u, 'benchmark/SLA card must become healthy when evidence exists and the gate is intact');
  assert.match(systemCenterUi, /system-center-nine-tabs[\s\S]*TAB_META\.length === 9/u, 'System Center self-test must reflect the actual nine-tab metadata contract');
  assert.match(systemCenterUi, /system-center-local-auxiliary'[\s\S]*!state\.overview \? true : state\.overview\.ai\?\.localAuxiliary\?\.realtimeReplyAuthority === false/u, 'self-test must not fail before async overview evidence exists');
  assert.doesNotMatch(systemCenterUi, /system-center-eight-tabs/u);
});

test('preserved formal reply caller does not grow a local precondition or local fallback', () => {
  const replyBrain = read('backend/services/contextAwareReplyBrain.js');
  assert.match(replyBrain, /quick_reply/u);
  assert.match(replyBrain, /deep_reply/u);
  assert.doesNotMatch(replyBrain, /localOnly/u, 'ContextAwareReplyBrain must not make formal reply depend on local runtime state');
  assert.doesNotMatch(replyBrain, /ollama/iu, 'formal reply caller must remain runtime-agnostic and cloud-authoritative through Model Brain');
});
