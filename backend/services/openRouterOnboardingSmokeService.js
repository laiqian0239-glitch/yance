'use strict';

const aiGateway = require('./aiGateway');
const AUTHORITY = 'YanceOpenRouterModelBrainSmoke';
const REQUIRED_CAPABILITIES = Object.freeze(['text']);
const ALLOWED_TASKS = Object.freeze(['probe']);
function clean(value) { return String(value == null ? '' : value).trim(); }
function parseJson(value) { try { return JSON.parse(clean(value)); } catch (_) { return null; } }
function validatePayload(value = {}) { return Boolean(value && typeof value === 'object'); }
function modelIdentity(model = {}) { return { id: clean(model.id), name: clean(model.name || model.id), provider: clean(model.provider || 'openrouter') }; }
function assertRealChatCompletionReceipt(result = {}) {
  if (!clean(result.text)) throw Object.assign(new Error('OPENROUTER_LOGICAL_SMOKE_EMPTY'), { code: 'OPENROUTER_LOGICAL_SMOKE_EMPTY' });
  if (!clean(result.evidence?.selectedModel || result.model)) throw Object.assign(new Error('OPENROUTER_LOGICAL_SMOKE_MODEL_EVIDENCE_MISSING'), { code: 'OPENROUTER_LOGICAL_SMOKE_MODEL_EVIDENCE_MISSING' });
  return true;
}
async function runModelSmoke(model, options = {}) {
  const gateway = options.aiGateway || aiGateway;
  const started = Date.now();
  const result = await gateway.execute({
    task: 'probe',
    modelId: clean(model.id),
    messages: [{ role: 'user', content: 'Reply with exactly: YANCE_MODEL_BRAIN_OK' }],
    options: { timeoutMs: Number(options.timeoutMs || 120000), temperature: 0, maxTokens: 24 }
  });
  assertRealChatCompletionReceipt(result);
  const pass = /YANCE_MODEL_BRAIN_OK/iu.test(clean(result.text));
  return {
    authority: AUTHORITY,
    modelId: clean(model.id),
    model: clean(model.name || model.id),
    pass,
    testedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    requestId: clean(result.evidence?.requestId),
    returnedModel: clean(result.evidence?.selectedModel || result.model),
    provider: clean(result.evidence?.provider || result.provider),
    capabilityTags: ['text', 'model-brain-smoke'],
    message: pass ? 'logical Model Brain/LiteLLM smoke passed' : 'logical smoke response mismatch'
  };
}
async function run(options = {}) {
  const registry = options.registry || require('./modelRegistry');
  const state = registry.read();
  const snapshot = options.snapshot || state.openRouter || {};
  const credentialRef = clean(snapshot.credentialRef || state.openRouter?.credentialRef);
  const models = (state.models || []).filter(model => model.source === 'openrouter-auto' && (!credentialRef || model.credentialRef === credentialRef) && model.available !== false && model.userDisabled !== true);
  if (!models.length) throw Object.assign(new Error('OPENROUTER_SMOKE_CATALOG_EMPTY'), { code: 'OPENROUTER_SMOKE_CATALOG_EMPTY' });
  const results = [];
  let passed = null;
  for (const model of models) {
    try {
      const receipt = await runModelSmoke(model, options);
      results.push(receipt);
      await registry.recordOpenRouterOnboardingSmoke?.(model.id, receipt);
      if (receipt.pass) { passed = receipt; break; }
    } catch (error) {
      const receipt = { authority: AUTHORITY, modelId: clean(model.id), model: clean(model.name), pass: false, testedAt: new Date().toISOString(), code: clean(error.code || 'OPENROUTER_LOGICAL_SMOKE_FAILED'), message: clean(error.message) };
      results.push(receipt);
      await registry.recordOpenRouterOnboardingSmoke?.(model.id, receipt);
    }
  }
  if (!passed) {
    const error = Object.assign(new Error('OpenRouter logical Model Brain smoke failed for all catalog deployments'), { code: 'OPENROUTER_ONBOARDING_SMOKE_FAILED', results });
    await registry.recordOpenRouterSnapshot?.({ onboardingSmokeStatus: 'failed', onboardingSmokeResults: results, qualificationStatus: 'pending' });
    throw error;
  }
  const output = { authority: AUTHORITY, pass: true, testedAt: new Date().toISOString(), passedModelId: passed.modelId, results };
  await registry.recordOpenRouterSnapshot?.({ onboardingSmokeStatus: 'passed', onboardingSmokeResults: results, logicalModelBrainSmoke: true, qualificationStatus: 'pending' });
  return output;
}

module.exports = { AUTHORITY, REQUIRED_CAPABILITIES, ALLOWED_TASKS, parseJson, validatePayload, assertRealChatCompletionReceipt, modelIdentity, runModelSmoke, run };
