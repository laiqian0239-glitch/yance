'use strict';

function clean(value) { return String(value == null ? '' : value).trim(); }
function providerOf(model = {}) { return clean(model.provider || model.kind || 'ollama').toLowerCase(); }
const LOCAL_OPENAI_PROVIDERS = new Set(['llama.cpp', 'ktransformers']);

function defaultReadCredential(ref, context) {
  const { getSecurityGuard } = require('../core/securityGuardSingleton');
  return getSecurityGuard().credentials.get(ref, context);
}

function assertLoopbackEndpoint(endpoint) {
  let url;
  try { url = new URL(clean(endpoint)); } catch (_) {
    throw Object.assign(new Error('Local OpenAI-compatible endpoint is invalid'), { code: 'LOCAL_OPENAI_ENDPOINT_INVALID', status: 400 });
  }
  const host = clean(url.hostname).toLowerCase();
  if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host)) {
    throw Object.assign(new Error('Local OpenAI-compatible endpoint must stay on loopback'), { code: 'LOCAL_OPENAI_ENDPOINT_NOT_LOOPBACK', status: 400 });
  }
  return clean(endpoint);
}

function resolveModelExecutionSpec(model = {}, options = {}) {
  const provider = providerOf(model);
  const modelId = clean(model.id);
  if (provider === 'ollama') {
    return Object.freeze({ provider, endpoint: clean(model.endpoint), modelName: clean(model.name), modelId });
  }
  if (LOCAL_OPENAI_PROVIDERS.has(provider)) {
    return Object.freeze({
      provider,
      transport: 'openai-compatible-local',
      endpoint: assertLoopbackEndpoint(model.endpoint),
      modelName: clean(model.name),
      modelId
    });
  }
  if (provider === 'airllm') {
    return Object.freeze({
      provider,
      transport: 'airllm-worker',
      endpoint: '',
      modelName: clean(model.name),
      modelId,
      runtime: Object.freeze({ workerPath: clean(model.runtime?.workerPath || 'runtime/local-ai/airllm/yance_airllm_worker.py') })
    });
  }
  if (!['openai', 'openai-compatible', 'cloud'].includes(provider)) {
    throw Object.assign(new Error(`UNSUPPORTED_MODEL_PROVIDER:${provider}`), { code: 'UNSUPPORTED_MODEL_PROVIDER', status: 400 });
  }
  const readCredential = options.readCredential || defaultReadCredential;
  const credential = readCredential(clean(model.credentialRef), { actor: 'backend-core', modelId });
  const apiKey = clean(credential?.apiKey || credential?.key || credential?.token);
  if (!apiKey) {
    throw Object.assign(new Error('Cloud model credential is unavailable'), { code: 'MODEL_CREDENTIAL_MISSING', status: 400, modelId });
  }
  const frozenCredential = Object.freeze({ apiKey });
  return Object.freeze({
    provider,
    endpoint: clean(credential?.endpoint || credential?.baseUrl || model.endpoint),
    modelName: clean(credential?.model || credential?.modelName || model.name),
    modelId,
    credential: frozenCredential
  });
}

module.exports = { resolveModelExecutionSpec, assertLoopbackEndpoint, LOCAL_OPENAI_PROVIDERS };