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
  assert.match(gateway, /localAuxiliaryQueue/u, 'AiGateway must own a scheduler separate from the interactive Model Brain queue');
  assert.match(gateway, /local-auxiliary/u, 'the auxiliary scheduler must have an explicit local-auxiliary identity');
  assert.match(gateway, /this\.localAuxiliaryQueue/u);
  assert.match(gateway, /this\.queue/u);
});

test('existing Ollama seam grows pull/progress/cancel lifecycle without introducing another local runtime', () => {
  const ollama = read('backend/services/ollamaClient.js');
  const routes = read('backend/routes/models.js');

  assert.match(ollama, /\/api\/pull/u, 'on-demand model assets must reuse Ollama /api/pull');
  assert.match(ollama, /onProgress/u, 'physical pull must surface progress');
  assert.match(routes, /\/local\/pull/u, 'model routes must expose explicit user-consented local pull');
  assert.match(routes, /pull.*cancel|cancel.*pull/us, 'model routes must expose cancellation for an active pull');
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
  assert.match(statusProjection, /benchmark/u);
  assert.match(statusProjection, /sla/iu);
  assert.match(systemCenter, /localAuxiliary/u);
  assert.match(workbench, /localAuxiliary/u);
  assert.match(workbench, /pull|download|下载/iu);
  assert.match(systemCenterUi, /localAuxiliary/u);
});

test('preserved formal reply caller does not grow a local precondition or local fallback', () => {
  const replyBrain = read('backend/services/contextAwareReplyBrain.js');
  assert.match(replyBrain, /quick_reply/u);
  assert.match(replyBrain, /deep_reply/u);
  assert.doesNotMatch(replyBrain, /localOnly/u, 'ContextAwareReplyBrain must not make formal reply depend on local runtime state');
  assert.doesNotMatch(replyBrain, /ollama/iu, 'formal reply caller must remain runtime-agnostic and cloud-authoritative through Model Brain');
});
