'use strict';

const { requestJson, normalizeEndpoint, normalizeApiKey } = require('./openAiCompatibleClient');
const frontierCandidateAuthority = require('./openRouterFrontierCandidateAuthority');

const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1';
const SERVICE_VERSION = 'openrouter-auto-config-v3-quality-first';
const ROLE_LIMIT = 4;
const REGISTER_LIMIT = 28;
const ROLE_TASK_HINTS = Object.freeze({
  translation: Object.freeze(['translation']),
  quick_reply: Object.freeze(['quick_reply']),
  director: Object.freeze(['director']),
  deep_reply: Object.freeze(['deep_reply']),
  media_analysis: Object.freeze(['media_analysis']),
  memory_extraction: Object.freeze(['memory_extraction', 'fact_extraction', 'understanding', 'summary']),
  persona_rewrite: Object.freeze(['persona_rewrite'])
});

function clean(value) { return String(value == null ? '' : value).trim(); }
function array(value) { return Array.isArray(value) ? value : []; }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function finite(value, fallback = 0) { const number = Number(value); return Number.isFinite(number) ? number : fallback; }
function lower(value) { return clean(value).toLowerCase(); }

const ROUTER_PATTERN = /openrouter\/free|auto[- ]?router|free models router/u;
const EMBEDDING_PATTERN = /embedding|rerank|vector model|bge-|nomic-embed|e5-/u;
const SAFETY_PATTERN = /moderation|content safety|guard(?:rail)?|safety classifier/u;
const CODE_PATTERN = /\bcoder\b|code model|coding agent|starcoder|deepseek-coder|codeqwen/u;
const TRANSCRIPTION_PATTERN = /speech[- ]?to[- ]?text|transcription|whisper/u;
const BATCH_PATTERN = /(?:^|[:/._-])batch(?:$|[:/._-])/u;
const GENERATION_PATTERN = /(?:text[- ]?to[- ]?(?:image|video|audio|music)|image generator|video generator|audio generator|music generator|speech synthesis|text[- ]?to[- ]?speech|\btts\b|\blyria\b|image\s*\d|nano banana|krea|flux\b|stable diffusion|midjourney)/u;

function pricePerMillion(value) {
  return Number((finite(value, 0) * 1_000_000).toFixed(6));
}

function hasFinitePrice(pricing = {}, key = '') {
  if (!Object.prototype.hasOwnProperty.call(pricing, key)) return false;
  const value = pricing[key];
  if (value === '' || value == null) return false;
  return Number.isFinite(Number(value));
}

function normalizeCatalogModel(raw = {}) {
  const architecture = object(raw.architecture);
  const pricing = object(raw.pricing);
  const inputModalities = array(architecture.input_modalities).map(lower).filter(Boolean);
  const outputModalities = array(architecture.output_modalities).map(lower).filter(Boolean);
  const supportedParameters = array(raw.supported_parameters).map(lower).filter(Boolean);
  const id = clean(raw.id);
  const name = clean(raw.name || id);
  const promptPerMillion = pricePerMillion(pricing.prompt);
  const completionPerMillion = pricePerMillion(pricing.completion);
  const requestPrice = finite(pricing.request, 0);
  const promptPriceKnown = hasFinitePrice(pricing, 'prompt');
  const completionPriceKnown = hasFinitePrice(pricing, 'completion');
  const requestPriceKnown = hasFinitePrice(pricing, 'request');
  const pricingKnown = promptPriceKnown && completionPriceKnown;
  const explicitFreeVariant = /:free$/iu.test(id);
  const free = explicitFreeVariant || (
    pricingKnown
    && promptPerMillion === 0
    && completionPerMillion === 0
    && (!requestPriceKnown || requestPrice === 0)
  );
  const modality = lower(architecture.modality);
  const modalityInput = clean(modality.split('->')[0]).split('+').map(lower).filter(Boolean);
  const modalityOutput = clean(modality.split('->')[1]).split('+').map(lower).filter(Boolean);
  const effectiveInputs = inputModalities.length ? inputModalities : modalityInput;
  const effectiveOutputs = outputModalities.length ? outputModalities : modalityOutput;
  const text = lower(`${id} ${name} ${raw.description || ''}`);
  const textInput = effectiveInputs.includes('text');
  const textOutput = effectiveOutputs.includes('text');
  const imageOutput = effectiveOutputs.includes('image');
  const audioOutput = effectiveOutputs.includes('audio');
  const videoOutput = effectiveOutputs.includes('video');
  const batchOnly = BATCH_PATTERN.test(lower(id)) || lower(raw.api_mode) === 'batch' || lower(raw.endpoint_type) === 'batch';
  const generationOnly = (!textOutput && (imageOutput || audioOutput || videoOutput)) || GENERATION_PATTERN.test(text);
  const base = {
    id,
    name,
    canonicalSlug: clean(raw.canonical_slug),
    description: clean(raw.description),
    contextLength: Math.max(0, finite(raw.context_length, 0)),
    maxCompletionTokens: Math.max(0, finite(raw.top_provider?.max_completion_tokens, 0)),
    inputModalities: effectiveInputs,
    outputModalities: effectiveOutputs,
    supportedParameters,
    promptPerMillion,
    completionPerMillion,
    requestPrice,
    pricingKnown,
    requestPriceKnown,
    free,
    textInput,
    textOutput,
    visionInput: effectiveInputs.includes('image'),
    audioInput: effectiveInputs.includes('audio'),
    videoInput: effectiveInputs.includes('video'),
    imageOutput,
    audioOutput,
    videoOutput,
    generationOnly,
    batchOnly,
    structuredOutput: supportedParameters.some(value => ['structured_outputs', 'response_format'].includes(value)),
    reasoning: supportedParameters.some(value => ['reasoning', 'include_reasoning'].includes(value)),
    tools: supportedParameters.some(value => ['tools', 'tool_choice'].includes(value)),
    expirationDate: clean(raw.expiration_date),
    created: finite(raw.created, 0),
    raw
  };
  return { ...base, ...capabilityProfile(base) };
}

function exclusionReason(model = {}) {
  const text = lower(`${model.id} ${model.name} ${model.description}`);
  if (!model.id) return 'missing-model-id';
  if (model.batchOnly === true || BATCH_PATTERN.test(lower(model.id))) return 'batch-only-model';
  if (ROUTER_PATTERN.test(text)) return 'dynamic-router-not-deterministic';
  if (EMBEDDING_PATTERN.test(text)) return 'embedding-or-rerank-model';
  if (SAFETY_PATTERN.test(text)) return 'safety-classifier';
  if (CODE_PATTERN.test(text)) return 'code-specialist-model';
  if (TRANSCRIPTION_PATTERN.test(text)) return 'transcription-only-model';
  if (model.generationOnly || GENERATION_PATTERN.test(text)) return 'non-text-generation-model';
  if (!model.textOutput) return 'no-text-output';
  if (!model.textInput) return 'no-text-input';
  return '';
}

function capabilityProfile(model = {}) {
  const reason = exclusionReason(model);
  const chatTextEligible = !reason;
  const translationEligible = chatTextEligible;
  const mediaAnalysisEligible = !reason && model.textOutput === true && (model.visionInput === true || model.audioInput === true || model.videoInput === true);
  return {
    excludedReason: reason,
    chatTextEligible,
    mediaAnalysisEligible,
    taskEligibility: Object.freeze({
      translation: translationEligible,
      quick_reply: chatTextEligible,
      director: chatTextEligible,
      deep_reply: chatTextEligible,
      media_analysis: mediaAnalysisEligible,
      memory_extraction: chatTextEligible,
      persona_rewrite: chatTextEligible
    })
  };
}

function isSpecialPurpose(model = {}) {
  const eligibility = object(model.taskEligibility);
  return !Object.values(eligibility).some(Boolean);
}

function eligibleForRole(model = {}, role = '') {
  return model.taskEligibility?.[role] === true;
}

function familyQuality(model = {}) {
  const text = lower(`${model.id} ${model.name}`);
  let score = 18;
  // Current conversational families receive an explicit quality prior. The
  // commercial benchmark remains authoritative after real calls; this prior
  // only determines the first shortlist.
  if (/deepseek[^\n]*(?:v4|4)[^\n]*pro/u.test(text)) score += 74;
  else if (/claude[^\n]*opus/u.test(text)) score += 72;
  else if (/(?:gpt|openai)[^\n]*5\.6/u.test(text)) score += 70;
  else if (/claude[^\n]*sonnet/u.test(text)) score += 68;
  else if (/deepseek[^\n]*(?:v4|4)[^\n]*flash/u.test(text)) score += 66;
  else if (/gemini[^\n]*3\.6/u.test(text)) score += 64;
  else if (/gemini[^\n]*3[^\n]*flash/u.test(text)) score += 61;
  else if (/deepseek[^\n]*v3\.2/u.test(text)) score += 58;
  else if (/gemma[^\n]*4/u.test(text)) score += 56;
  else if (/mimo[^\n]*2\.5/u.test(text)) score += 54;
  else if (/anthropic|claude/u.test(text)) score += 50;
  else if (/openai|gpt/u.test(text)) score += 48;
  else if (/deepseek/u.test(text)) score += 47;
  else if (/google|gemini/u.test(text)) score += 45;
  else if (/qwen/u.test(text)) score += 41;
  else if (/x-ai|grok/u.test(text)) score += 39;
  else if (/mistral|mixtral/u.test(text)) score += 36;
  else if (/gemma/u.test(text)) score += 35;
  else if (/meta|llama/u.test(text)) score += 33;
  if (/opus|sonnet|pro\b|ultra|large|max\b|70b|72b|120b|400b/u.test(text)) score += 8;
  if (/nano|small|8b|9b/u.test(text)) score -= 10;
  return score;
}

function qualityTier(model = {}) {
  const quality = familyQuality(model);
  if (quality >= 82) return 'premium';
  if (quality >= 68) return 'high';
  if (quality >= 52) return 'balanced';
  return 'utility';
}

function usagePolicy(model = {}) {
  const tier = qualityTier(model);
  return {
    finalReplyEligible: tier === 'premium' || tier === 'high' || tier === 'balanced',
    qualityTier: tier,
    freeModel: model.free === true,
    primaryPolicy: model.free === true ? 'utility-or-budget-fallback' : 'quality-first-cloud',
    localFallbackOnly: false
  };
}

function multilingualScore(model = {}) {
  const text = lower(`${model.id} ${model.name} ${model.description}`);
  let score = 0;
  if (/gemini|qwen|gpt|claude|mistral|llama|gemma|deepseek/u.test(text)) score += 18;
  if (/multilingual|translation|translate/u.test(text)) score += 12;
  return score;
}

function cheapScore(model = {}) {
  if (model.free) return 35;
  const combined = model.promptPerMillion + model.completionPerMillion;
  if (combined <= 1) return 28;
  if (combined <= 5) return 20;
  if (combined <= 15) return 12;
  if (combined <= 35) return 5;
  return 0;
}

function speedScore(model = {}) {
  const text = lower(`${model.id} ${model.name}`);
  let score = 0;
  if (/flash|lite|mini|nano|fast|turbo|small/u.test(text)) score += 18;
  if (/opus|ultra|large|400b/u.test(text)) score -= 6;
  return score;
}

function contextScore(model = {}) {
  if (model.contextLength >= 1_000_000) return 12;
  if (model.contextLength >= 200_000) return 9;
  if (model.contextLength >= 100_000) return 6;
  if (model.contextLength >= 32_000) return 3;
  return 0;
}

function roleScore(model, role) {
  const quality = familyQuality(model);
  const cheap = cheapScore(model);
  const speed = speedScore(model);
  const context = contextScore(model);
  const structured = model.structuredOutput ? 9 : 0;
  const multilingual = multilingualScore(model);
  const paidQualityBias = model.free ? -18 : 8;
  if (role === 'translation') return quality * 0.9 + multilingual * 1.5 + structured + speed * 0.45 + cheap * 0.2 + (model.free ? 5 : 0) + context * 0.25;
  if (role === 'quick_reply') return quality * 2 + multilingual * 0.8 + speed * 0.75 + structured + context * 0.35 + paidQualityBias + cheap * 0.08;
  if (role === 'director') return quality * 2.25 + structured * 1.2 + context + multilingual * 0.5 + (model.reasoning ? 12 : 0) + paidQualityBias + cheap * 0.05;
  if (role === 'deep_reply') return quality * 2.2 + context * 1.15 + structured + multilingual * 0.7 + (model.reasoning ? 10 : 0) + paidQualityBias + cheap * 0.05;
  if (role === 'media_analysis') return model.visionInput ? quality * 1.4 + speed * 0.4 + context + 35 + paidQualityBias : -1000;
  if (role === 'memory_extraction') return multilingual + structured * 1.2 + cheap + speed + (model.free ? 18 : 0) + context * 0.5;
  if (role === 'persona_rewrite') return quality * 2.15 + multilingual + structured + context + (model.reasoning ? 8 : 0) + paidQualityBias + cheap * 0.05;
  return quality + cheap * 0.1;
}

function rankForRole(models, role, limit = ROLE_LIMIT) {
  return models
    .filter(model => eligibleForRole(model, role))
    .map(model => ({ ...model, selectionScore: Number(roleScore(model, role).toFixed(2)) }))
    .sort((a, b) => b.selectionScore - a.selectionScore || familyQuality(b) - familyQuality(a) || Number(a.free) - Number(b.free) || b.contextLength - a.contextLength || a.id.localeCompare(b.id))
    .slice(0, limit);
}

function buildSelections(models = [], frontierPlan = frontierCandidateAuthority.buildPlan(models)) {
  const roles = ['translation', 'quick_reply', 'director', 'deep_reply', 'media_analysis', 'memory_extraction', 'persona_rewrite'];
  return Object.fromEntries(roles.map(role => {
    const rows = rankForRole(models, role);
    const forcePreferred = ['quick_reply', 'director', 'deep_reply', 'persona_rewrite'].includes(role);
    return [role, frontierCandidateAuthority.prioritizeRows(rows, frontierPlan, { forcePreferred })];
  }));
}

function selectedTaskHints(selections = {}) {
  const hints = new Map();
  for (const [role, rows] of Object.entries(selections)) {
    for (const row of rows) {
      const list = hints.get(row.id) || [];
      for (const task of ROLE_TASK_HINTS[role] || []) if (!list.includes(task)) list.push(task);
      hints.set(row.id, list);
    }
  }
  return hints;
}

function chooseRegistrationRows(selections = {}, frontierPlan = {}) {
  const hints = selectedTaskHints(selections);
  const unique = new Map();
  const append = row => {
    if (!row?.id || unique.has(row.id)) return;
    unique.set(row.id, { ...row, taskHints: hints.get(row.id) || [] });
  };
  for (const row of Array.isArray(frontierPlan.shortlist) ? frontierPlan.shortlist : []) append(row);
  for (const rows of Object.values(selections)) for (const row of rows) append(row);
  return [...unique.values()]
    .map((row, index) => ({ ...row, frontierOrder: index, registrationQuality: familyQuality(row), usagePolicy: usagePolicy(row) }))
    .sort((a, b) => a.frontierOrder - b.frontierOrder || b.registrationQuality - a.registrationQuality || Number(a.free) - Number(b.free) || b.taskHints.length - a.taskHints.length || Number(b.selectionScore || 0) - Number(a.selectionScore || 0))
    .slice(0, REGISTER_LIMIT);
}

function publicSelection(row = {}) {
  return {
    id: row.id,
    name: row.name,
    free: row.free === true,
    contextLength: row.contextLength,
    textInput: row.textInput === true,
    textOutput: row.textOutput === true,
    visionInput: row.visionInput === true,
    audioInput: row.audioInput === true,
    videoInput: row.videoInput === true,
    imageOutput: row.imageOutput === true,
    audioOutput: row.audioOutput === true,
    videoOutput: row.videoOutput === true,
    generationOnly: row.generationOnly === true,
    structuredOutput: row.structuredOutput === true,
    promptPerMillion: row.promptPerMillion,
    completionPerMillion: row.completionPerMillion,
    pricingKnown: row.pricingKnown === true,
    score: row.selectionScore,
    qualityTier: qualityTier(row),
    usagePolicy: usagePolicy(row),
    taskHints: array(row.taskHints),
    taskEligibility: object(row.taskEligibility),
    excludedReason: clean(row.excludedReason)
  };
}

function catalogRegistryRow(row = {}) {
  return {
    name: row.id,
    displayName: row.name,
    capabilities: [
      ...(row.chatTextEligible ? ['text'] : []),
      ...(row.visionInput ? ['vision'] : []),
      ...(row.audioInput ? ['audio-input'] : []),
      ...(row.videoInput ? ['video-input'] : []),
      ...(row.structuredOutput ? ['structured-output'] : []),
      ...(row.reasoning ? ['reasoning'] : [])
    ],
    catalogMetadata: {
      canonicalSlug: row.canonicalSlug,
      description: row.description,
      contextLength: row.contextLength,
      maxCompletionTokens: row.maxCompletionTokens,
      inputModalities: row.inputModalities,
      outputModalities: row.outputModalities,
      supportedParameters: row.supportedParameters,
      pricing: {
        promptPerMillion: row.promptPerMillion,
        completionPerMillion: row.completionPerMillion,
        request: row.requestPrice,
        known: row.pricingKnown === true,
        requestKnown: row.requestPriceKnown === true
      },
      free: row.free,
      expirationDate: row.expirationDate,
      catalogCreated: row.created,
      taskEligibility: object(row.taskEligibility),
      excludedReason: clean(row.excludedReason),
      generationOnly: row.generationOnly === true,
      qualityTier: qualityTier(row),
      usagePolicy: usagePolicy(row)
    }
  };
}

function publicKeyStatus(keyInfo = {}) {
  return {
    isFreeTier: keyInfo.is_free_tier === true,
    limit: keyInfo.limit == null ? null : finite(keyInfo.limit, 0),
    limitRemaining: keyInfo.limit_remaining == null ? null : finite(keyInfo.limit_remaining, 0),
    limitReset: clean(keyInfo.limit_reset),
    usage: finite(keyInfo.usage, 0),
    usageDaily: finite(keyInfo.usage_daily, 0),
    usageWeekly: finite(keyInfo.usage_weekly, 0),
    usageMonthly: finite(keyInfo.usage_monthly, 0),
    byokUsage: finite(keyInfo.byok_usage, 0),
    byokUsageDaily: finite(keyInfo.byok_usage_daily, 0),
    byokUsageWeekly: finite(keyInfo.byok_usage_weekly, 0),
    byokUsageMonthly: finite(keyInfo.byok_usage_monthly, 0),
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
  return { credentialRef, apiKey, securityGuard };
}

async function refreshAccountStatus(options = {}) {
  const registry = options.registry || require('./modelRegistry');
  const request = options.requestJson || requestJson;
  const endpoint = normalizeEndpoint(options.endpoint || OPENROUTER_ENDPOINT);
  const { credentialRef, apiKey } = secureCredential(options);
  const keyPayload = await request(`${endpoint}/key`, { apiKey, timeoutMs: 30_000, signal: options.signal });
  const snapshot = {
    provider: 'openrouter', endpoint, credentialRef,
    key: publicKeyStatus(object(keyPayload.data)),
    balanceRefreshStatus: 'success',
    balanceRefreshedAt: new Date().toISOString()
  };
  if (typeof registry.recordOpenRouterSnapshot === 'function') await registry.recordOpenRouterSnapshot(snapshot);
  return snapshot;
}

async function autoConfigure(options = {}) {
  const registry = options.registry || require('./modelRegistry');
  const request = options.requestJson || requestJson;
  const endpoint = normalizeEndpoint(options.endpoint || OPENROUTER_ENDPOINT);
  const { credentialRef, apiKey } = secureCredential(options);

  const [keyPayload, catalogPayload] = await Promise.all([
    request(`${endpoint}/key`, { apiKey, timeoutMs: 30_000, signal: options.signal }),
    request(`${endpoint}/models/user`, { apiKey, timeoutMs: 60_000, signal: options.signal })
  ]);
  const keyInfo = object(keyPayload.data);
  const rawCatalog = array(catalogPayload.data);
  const catalog = rawCatalog.map(normalizeCatalogModel).filter(model => model.id);
  const eligible = catalog.filter(model => !isSpecialPurpose(model));
  if (!eligible.length) throw Object.assign(new Error('OpenRouter当前账号没有返回适合言策任务的模型'), { code: 'OPENROUTER_MODEL_CATALOG_EMPTY' });
  const frontierPlan = frontierCandidateAuthority.buildPlan(eligible, { limit: REGISTER_LIMIT });
  const selections = buildSelections(eligible, frontierPlan);
  const registrationRows = chooseRegistrationRows(selections, frontierPlan);
  if (!registrationRows.length) throw Object.assign(new Error('没有找到适合言策任务的OpenRouter模型'), { code: 'OPENROUTER_NO_YANCE_CANDIDATES' });

  if (typeof registry.synchronizeOpenRouterCatalog === 'function') {
    await registry.synchronizeOpenRouterCatalog({
      endpoint,
      credentialRef,
      models: eligible.map(catalogRegistryRow)
    });
  }

  for (const row of registrationRows) {
    const catalogRow = catalogRegistryRow(row);
    await registry.upsertCloudModel({
      provider: 'openai-compatible',
      endpoint,
      name: row.id,
      displayName: catalogRow.displayName,
      credentialRef,
      source: 'openrouter-auto',
      available: true,
      resetValidation: false,
      capabilities: catalogRow.capabilities,
      taskHints: row.taskHints,
      catalogMetadata: catalogRow.catalogMetadata
    });
  }

  const snapshot = {
    schemaVersion: 1,
    serviceVersion: SERVICE_VERSION,
    provider: 'openrouter',
    endpoint,
    credentialRef,
    connectedAt: new Date().toISOString(),
    modelCount: rawCatalog.length,
    catalogCount: catalog.length,
    textModelCount: catalog.filter(model => model.textInput && model.textOutput).length,
    chatTextModelCount: catalog.filter(model => model.chatTextEligible).length,
    mediaAnalysisModelCount: catalog.filter(model => model.mediaAnalysisEligible).length,
    generationOnlyModelCount: catalog.filter(model => model.generationOnly).length,
    eligibleModelCount: eligible.length,
    freeModelCount: eligible.filter(model => model.free).length,
    registeredModelCount: registrationRows.length,
    shortlistedModelCount: registrationRows.length,
    unassessedModelCount: eligible.length,
    key: publicKeyStatus(keyInfo),
    balanceRefreshStatus: 'success',
    balanceRefreshedAt: new Date().toISOString(),
    selections: Object.fromEntries(Object.entries(selections).map(([role, rows]) => [role, rows.map(publicSelection)])),
    registered: registrationRows.map(publicSelection),
    routingPolicy: 'QUALITY_FIRST_CLOUD_PRIMARY_FREE_UTILITY_LOCAL_OFFLINE_FALLBACK',
    preferredRoute: {
      authority: frontierPlan.authority,
      primarySlug: frontierPlan.preferredPrimary.slug,
      primaryAvailable: frontierPlan.preferredPrimary.available,
      primaryReasonCode: frontierPlan.preferredPrimary.reasonCode,
      fallbackSlug: frontierPlan.preferredFallback.slug,
      fallbackAvailable: frontierPlan.preferredFallback.available,
      fallbackReasonCode: frontierPlan.preferredFallback.reasonCode,
      providerCoverage: frontierPlan.providerCoverage,
      formalQualificationRequired: true
    },
    frontierCandidateCount: frontierPlan.shortlist.length,
    frontierRejected: frontierPlan.rejected,
    benchmarkStatus: 'pending'
  };
  if (typeof registry.recordOpenRouterSnapshot === 'function') await registry.recordOpenRouterSnapshot(snapshot);
  return snapshot;
}

module.exports = {
  OPENROUTER_ENDPOINT,
  SERVICE_VERSION,
  normalizeCatalogModel,
  capabilityProfile,
  exclusionReason,
  isSpecialPurpose,
  eligibleForRole,
  familyQuality,
  qualityTier,
  usagePolicy,
  roleScore,
  rankForRole,
  buildSelections,
  chooseRegistrationRows,
  frontierCandidateAuthority,
  catalogRegistryRow,
  publicKeyStatus,
  refreshAccountStatus,
  autoConfigure
};
