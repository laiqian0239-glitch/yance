'use strict';

const modelBrainRuntime = require('./modelBrainRuntime');
const modelBrainProjection = require('./modelBrainProjection');
const registry = require('./modelRegistry');
const { getSecurityGuard } = require('../core/securityGuardSingleton');
const securityGuard = getSecurityGuard();

const MINIMUM_VISION_TEST_IMAGE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nWQAAAAASUVORK5CYII=';
function clean(value) { return String(value == null ? '' : value).trim(); }
function providerOf(model = {}) { return clean(model.provider || model.kind || 'unknown').toLowerCase(); }
function credentialFor(model = {}) {
  const value = securityGuard.credentials.get(model.credentialRef || '') || {};
  return {
    apiKey: clean(value.apiKey || value.key || value.token),
    endpoint: clean(value.endpoint || value.baseUrl || model.endpoint),
    model: clean(value.model || value.modelName || model.name)
  };
}
function projectionForExactModel(model = {}, { task = 'probe', localOnly = false, modalities = [] } = {}) {
  const targetTask = clean(task || 'probe');
  // Qualification/bootstrap probes are the one deliberately isolated exception to
  // production hard qualification. They exercise one explicit deployment so Yance can
  // collect the evidence required to qualify it; production tasks never receive this
  // promotion and therefore remain fail-closed.
  const candidate = targetTask === 'probe'
    ? { ...model, qualification: model.qualification === 'verified' ? 'verified' : 'experimental' }
    : model;
  const projected = modelBrainProjection.project({ models: [candidate] }, {
    task: targetTask,
    constraints: { localOnly, modalities, allowExperimental: targetTask === 'probe' }
  });
  const row = projected.candidates.find(item => item.id === clean(candidate.id || candidate.name));
  if (!row || !row.enabled) throw Object.assign(new Error('MODEL_NOT_AVAILABLE'), { code: 'MODEL_NOT_AVAILABLE' });
  return { ...projected, candidates: [row], catalog: [row] };
}
async function executeModel(model, messages, options = {}, signal) {
  if (signal?.aborted) throw signal.reason || Object.assign(new Error('MODEL_CANCELLED'), { code: 'MODEL_CANCELLED' });
  const projection = projectionForExactModel(model, { task: options.task || 'probe', localOnly: options.localOnly === true, modalities: options.modalities || [] });
  const credential = credentialFor(model);
  return modelBrainRuntime.execute({
    modelGroup: projection.modelGroup,
    logicalModel: projection.logicalModel,
    tags: projection.tags,
    catalog: projection.candidates,
    credentials: clean(model.credentialRef) ? { [clean(model.credentialRef)]: credential } : {},
    messages,
    options
  });
}
async function verifyCloudAccess({ endpoint, apiKey = '', model = '', signal, runInference = true, testVision = false, provider = 'openai' } = {}) {
  if (!model && runInference) throw Object.assign(new Error('MODEL_NAME_REQUIRED_FOR_LOGICAL_PROBE'), { code: 'MODEL_NAME_REQUIRED_FOR_LOGICAL_PROBE' });
  const synthetic = {
    id: `credential-probe:${clean(model)}`,
    name: clean(model),
    modelName: clean(model),
    provider: clean(provider || 'openai'),
    endpoint: clean(endpoint),
    enabled: true,
    qualification: 'experimental',
    credentialRef: 'probe',
    capabilities: { modalities: testVision ? ['text', 'vision'] : ['text'] }
  };
  const textProjection = projectionForExactModel(synthetic, { task: 'probe' });
  const visionProjection = testVision ? projectionForExactModel(synthetic, { task: 'probe', modalities: ['vision'] }) : null;
  if (!runInference) return { endpoint: clean(endpoint), models: [], modelAvailable: Boolean(model), inference: null, vision: null, tests: { discovery: { pass: true, modelCount: 0 }, text: null, vision: null } };
  if (signal?.aborted) throw signal.reason || Object.assign(new Error('MODEL_CANCELLED'), { code: 'MODEL_CANCELLED' });
  const credentials = { probe: { apiKey: clean(apiKey), endpoint: clean(endpoint), model: clean(model) } };
  const result = await modelBrainRuntime.probe({
    modelGroup: textProjection.modelGroup,
    logicalModel: textProjection.logicalModel,
    tags: textProjection.tags,
    catalog: textProjection.candidates,
    credentials,
    messages: [],
    timeoutMs: 180000,
    options: { timeoutMs: 180000 }
  });
  let visionResult = null;
  if (testVision) {
    if (signal?.aborted) throw signal.reason || Object.assign(new Error('MODEL_CANCELLED'), { code: 'MODEL_CANCELLED' });
    visionResult = await modelBrainRuntime.execute({
      modelGroup: visionProjection.modelGroup,
      logicalModel: visionProjection.logicalModel,
      tags: visionProjection.tags,
      catalog: visionProjection.candidates,
      credentials,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'Inspect the attached image. Reply with exactly YANCE_VISION_OK only if it is a plain white image.' },
          { type: 'image_url', image_url: { url: MINIMUM_VISION_TEST_IMAGE } }
        ]
      }],
      options: { timeoutMs: 180000, temperature: 0, maxTokens: 24 }
    });
    visionResult = { ...visionResult, probePass: /YANCE_VISION_OK/iu.test(clean(visionResult?.text)) };
  }
  const testEvidence = value => value ? {
    pass: value.probePass !== false,
    status: 200,
    returnedModel: clean(value.evidence?.selectedModel),
    totalMs: Number(value.evidence?.latencyMs || 0),
    totalTokens: Number(value.evidence?.totalTokens || 0)
  } : null;
  return {
    endpoint: clean(endpoint),
    models: model ? [model] : [],
    modelAvailable: true,
    inference: result,
    vision: visionResult,
    tests: {
      discovery: { pass: true, modelCount: model ? 1 : 0 },
      text: testEvidence(result),
      vision: testEvidence(visionResult)
    }
  };
}
async function verifyCloudCredential({ endpoint, credentialRef, model = '', signal, runInference = true, testVision = false, provider = 'openai' } = {}) {
  const credential = securityGuard.credentials.get(credentialRef) || {};
  return verifyCloudAccess({
    endpoint: clean(credential.endpoint || credential.baseUrl || endpoint),
    apiKey: clean(credential.apiKey || credential.key || credential.token),
    model,
    signal,
    runInference,
    testVision,
    provider
  });
}

module.exports = { providerOf, credentialFor, executeModel, verifyCloudAccess, verifyCloudCredential, MINIMUM_VISION_TEST_IMAGE };
