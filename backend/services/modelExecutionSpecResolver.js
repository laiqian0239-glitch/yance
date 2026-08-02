'use strict';

function clean(value) { return String(value == null ? '' : value).trim(); }
function providerOf(model = {}) { return clean(model.provider || model.kind || 'ollama').toLowerCase(); }

function defaultReadCredential(ref, context) {
  const { getSecurityGuard } = require('../core/securityGuardSingleton');
  return getSecurityGuard().credentials.get(ref, context);
}

function resolveModelExecutionSpec(model = {}, options = {}) {
  const provider = providerOf(model);
  const modelId = clean(model.id);
  if (provider === 'ollama') {
    return Object.freeze({ provider, endpoint: clean(model.endpoint), modelName: clean(model.name), modelId });
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

module.exports = { resolveModelExecutionSpec };
