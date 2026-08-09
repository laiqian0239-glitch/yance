'use strict';

const { requestJson, normalizeEndpoint, normalizeApiKey } = require('./openAiCompatibleClient');

const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1';
const SERVICE_VERSION = 'openrouter-model-brain-catalog-v1';
const REGISTER_LIMIT = 64;
function clean(value) { return String(value == null ? '' : value).trim(); }
function lower(value) { return clean(value).toLowerCase(); }
function array(value) { return Array.isArray(value) ? value : []; }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function finite(value, fallback = 0) { const number = Number(value); return Number.isFinite(number) ? number : fallback; }
function unique(value) { return [...new Set(array(value).map(lower).filter(Boolean))]; }
function pricePerMillion(value) { return Number((finite(value, 0) * 1_000_000).toFixed(6)); }

function capabilityProfile(model = {}) {
  return {
    text: model.textInput === true && model.textOutput === true,
    vision: model.inputModalities?.includes('image') === true,
    audio: model.inputModalities?.includes('audio') === true,
    video: model.inputModalities?.includes('video') === true,
    structuredOutput: model.supportedParameters?.some(value => ['structured_outputs', 'response_format'].includes(value)) === true,
    tools: model.supportedParameters?.some(value => ['tools', 'tool_choice'].includes(value)) === true,
    reasoning: model.supportedParameters?.some(value => ['reasoning', 'include_reasoning'].includes(value)) === true
  };
}
function normalizeCatalogModel(raw = {}) {
  const architecture = object(raw.architecture);
  const pricing = object(raw.pricing);
  const modality = lower(architecture.modality);
  const split = modality.split('->');
  const inputModalities = unique(architecture.input_modalities).length ? unique(architecture.input_modalities) : unique(clean(split[0]).split('+'));
  const outputModalities = unique(architecture.output_modalities).length ? unique(architecture.output_modalities) : unique(clean(split[1]).split('+'));
  const supportedParameters = unique(raw.supported_parameters);
  const id = clean(raw.id);
  const name = clean(raw.name || id);
  const model = {
    id,
    name,
    canonicalSlug: clean(raw.canonical_slug),
    description: clean(raw.description),
    contextLength: Math.max(0, finite(raw.context_length, 0)),
    maxCompletionTokens: Math.max(0, finite(raw.top_provider?.max_completion_tokens, 0)),
    inputModalities,
    outputModalities,
    supportedParameters,
    promptPerMillion: pricePerMillion(pricing.prompt),
    completionPerMillion: pricePerMillion(pricing.completion),
    textInput: inputModalities.includes('text'),
    textOutput: outputModalities.includes('text'),
    created: finite(raw.created, 0),
    raw
  };
  return { ...model, ...capabilityProfile(model) };
}
function exclusionReason(model = {}) {
  const text = lower(`${model.id} ${model.name} ${model.description}`);
  if (!model.id) return 'missing-model-id';
  if (/(?:^|[:/._-])batch(?:$|[:/._-])/u.test(lower(model.id))) return 'batch-only-model';
  if (/embedding|rerank|vector model|moderation|content safety|text[- ]?to[- ]?(?:image|video|audio)|speech synthesis|\btts\b/u.test(text)) return 'non-chat-special-purpose';
  if (!model.textInput || !model.textOutput) return 'text-chat-capability-missing';
  return '';
}
function isSpecialPurpose(model = {}) { return Boolean(exclusionReason(model)); }
function catalogRegistryRow(model = {}) {
  const capabilities = ['text'];
  if (model.vision) capabilities.push('vision');
  if (model.audio) capabilities.push('audio');
  if (model.video) capabilities.push('video');
  return {
    id: clean(model.id),
    name: clean(model.id),
    displayName: clean(model.name || model.id),
    capabilities,
    catalogMetadata: {
      contextLength: Number(model.contextLength || 0),
      maxCompletionTokens: Number(model.maxCompletionTokens || 0),
      inputModalities: array(model.inputModalities),
      outputModalities: array(model.outputModalities),
      supportedParameters: array(model.supportedParameters),
      promptPerMillion: Number(model.promptPerMillion || 0),
      completionPerMillion: Number(model.completionPerMillion || 0),
      canonicalSlug: clean(model.canonicalSlug)
    }
  };
}
function publicKeyStatus(keyInfo = {}) {
  return {
    label: clean(keyInfo.label),
    limit: finite(keyInfo.limit, 0),
    limitRemaining: finite(keyInfo.limit_remaining, 0),
    usage: finite(keyInfo.usage, 0),
    usageDaily: finite(keyInfo.usage_daily, 0),
    usageWeekly: finite(keyInfo.usage_weekly, 0),
    usageMonthly: finite(keyInfo.usage_monthly, 0),
    expiresAt: clean(keyInfo.expires_at)
  };
}
function secureCredential(options = {}) {
  const securityGuard = options.securityGuard || require('../core/securityGuardSingleton').getSecurityGuard();
  const credentialRef = clean(options.credentialRef);
  if (!credentialRef) throw Object.assign(new Error('OpenRouter凭据引用不能为空'), { code: 'OPENROUTER_CREDENTIAL_REF_REQUIRED' });
  const credential = securityGuard.credentials.get(credentialRef) || {};
  let apiKey = '';
  try { apiKey = normalizeApiKey(credential.apiKey || credential.key || credential.token); }
  catch (error) {
    if (error.code === 'CLOUD_MODEL_CREDENTIAL_MISSING') throw Object.assign(new Error('OpenRouter API Key尚未写入系统安全存储'), { code: 'OPENROUTER_CREDENTIAL_MISSING' });
    throw Object.assign(new Error(error.message || 'OpenRouter API Key格式无效'), { code: 'OPENROUTER_CREDENTIAL_INVALID' });
  }
  return { credentialRef, apiKey };
}
async function refreshAccountStatus(options = {}) {
  const registry = options.registry || require('./modelRegistry');
  const request = options.requestJson || requestJson;
  const endpoint = normalizeEndpoint(options.endpoint || OPENROUTER_ENDPOINT);
  const { credentialRef, apiKey } = secureCredential(options);
  const keyPayload = await request(`${endpoint}/key`, { apiKey, timeoutMs: 30000, signal: options.signal });
  const snapshot = { provider: 'openrouter', endpoint, credentialRef, key: publicKeyStatus(object(keyPayload.data)), accountStatus: 'connected', refreshedAt: new Date().toISOString() };
  await registry.recordOpenRouterSnapshot?.(snapshot);
  return snapshot;
}
async function autoConfigure(options = {}) {
  const registry = options.registry || require('./modelRegistry');
  const request = options.requestJson || requestJson;
  const endpoint = normalizeEndpoint(options.endpoint || OPENROUTER_ENDPOINT);
  const { credentialRef, apiKey } = secureCredential(options);
  const [keyPayload, catalogPayload] = await Promise.all([
    request(`${endpoint}/key`, { apiKey, timeoutMs: 30000, signal: options.signal }),
    request(`${endpoint}/models/user`, { apiKey, timeoutMs: 60000, signal: options.signal })
  ]);
  const catalog = array(catalogPayload.data).map(normalizeCatalogModel).filter(model => model.id);
  const usable = catalog.filter(model => !isSpecialPurpose(model));
  if (!usable.length) throw Object.assign(new Error('OpenRouter当前账号没有返回可用于文本对话的模型目录'), { code: 'OPENROUTER_MODEL_CATALOG_EMPTY' });
  await registry.synchronizeOpenRouterCatalog?.({ endpoint, credentialRef, models: usable.map(catalogRegistryRow) });
  const registered = [];
  for (const model of usable.slice(0, REGISTER_LIMIT)) {
    const row = catalogRegistryRow(model);
    const state = await registry.upsertCloudModel({
      provider: 'openrouter',
      endpoint,
      name: row.name,
      modelName: row.name,
      displayName: row.displayName,
      credentialRef,
      source: 'openrouter-auto',
      available: true,
      resetValidation: false,
      capabilities: row.capabilities,
      catalogMetadata: row.catalogMetadata
    });
    registered.push((state.models || []).find(item => item.provider === 'openrouter' && item.name === row.name && item.credentialRef === credentialRef) || row);
  }
  const snapshot = {
    schemaVersion: 1,
    serviceVersion: SERVICE_VERSION,
    provider: 'openrouter',
    endpoint,
    credentialRef,
    connectedAt: new Date().toISOString(),
    catalogStatus: 'ready',
    catalogCount: catalog.length,
    usableCatalogCount: usable.length,
    registeredModelCount: registered.length,
    catalog: usable.map(catalogRegistryRow),
    registered: registered.map(row => ({ id: clean(row.id), name: clean(row.name), displayName: clean(row.displayName || row.name), capabilities: array(row.capabilities) })),
    key: publicKeyStatus(object(keyPayload.data)),
    accountStatus: 'connected',
    qualificationStatus: 'pending'
  };
  await registry.recordOpenRouterSnapshot?.(snapshot);
  return snapshot;
}

module.exports = { OPENROUTER_ENDPOINT, SERVICE_VERSION, normalizeCatalogModel, capabilityProfile, exclusionReason, isSpecialPurpose, catalogRegistryRow, publicKeyStatus, refreshAccountStatus, autoConfigure };
