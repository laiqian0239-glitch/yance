'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { PATHS } = require('../config');
const replyBrainAuthority = require('./replyBrainModelAuthority');
const replyChampionAuthority = require('./replyChampionAuthority');
const executionModeAuthority = require('./aiExecutionModeAuthority');
const providerDomainAuthority = require('./modelProviderFailureDomainAuthority');
const taskRoutingAuthority = require('./modelServiceTaskRoutingAuthority');

const AUTHORITY = 'AIQualityRouteAuthority';
const SCHEMA_VERSION = 2;
const RECEIPT_KEY_FILE = path.join(PATHS.secure, 'ai-quality-route-receipt.key');
let cachedReceiptKey = null;

function receiptSigningKey() {
  if (cachedReceiptKey) return cachedReceiptKey;
  const configured = String(process.env.YANCE_AI_ROUTE_RECEIPT_SECRET || '').trim();
  if (configured) { cachedReceiptKey = Buffer.from(configured, 'utf8'); return cachedReceiptKey; }
  fs.mkdirSync(PATHS.secure, { recursive: true });
  try {
    const encoded = fs.readFileSync(RECEIPT_KEY_FILE, 'utf8').trim();
    const decoded = Buffer.from(encoded, 'base64url');
    if (decoded.length >= 32) { cachedReceiptKey = decoded; return cachedReceiptKey; }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const generated = crypto.randomBytes(32);
  const temp = `${RECEIPT_KEY_FILE}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, generated.toString('base64url'), { mode: 0o600, flag: 'wx' });
  try { fs.renameSync(temp, RECEIPT_KEY_FILE); }
  catch (error) {
    try { fs.rmSync(temp, { force: true }); } catch (_) {}
    if (error?.code !== 'EEXIST') throw error;
  }
  try { fs.chmodSync(RECEIPT_KEY_FILE, 0o600); } catch (_) {}
  const persisted = Buffer.from(fs.readFileSync(RECEIPT_KEY_FILE, 'utf8').trim(), 'base64url');
  if (persisted.length < 32) throw Object.assign(new Error('AI 路由回执签名密钥无效。'), { code: 'AI_QUALITY_ROUTE_RECEIPT_KEY_INVALID' });
  cachedReceiptKey = persisted;
  return cachedReceiptKey;
}

function signReceiptHash(receiptHash) {
  return crypto.createHmac('sha256', receiptSigningKey()).update(String(receiptHash || ''), 'utf8').digest('base64url');
}

function timingSafeEqualText(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const QUALITY_TIER = Object.freeze({
  HIGH: 'high',
  QUALIFIED: 'qualified',
  CONDITIONAL: 'conditional',
  EMERGENCY: 'emergency',
  BLOCKED: 'blocked'
});

const ROUTE_STATE = Object.freeze({
  READY: 'ready',
  CONDITIONAL: 'conditional',
  DEGRADED: 'degraded',
  EMERGENCY_ONLY: 'emergency-only',
  BLOCKED: 'blocked'
});

const TASK_PROFILES = Object.freeze({
  director: Object.freeze({
    qualityClass: 'relationship-strategy',
    minimumTier: QUALITY_TIER.HIGH,
    requiredCapabilities: Object.freeze(['social_dialogue_high', 'relationship_reasoning', 'persona_consistency_long_context', 'json_schema_strict']),
    emergencyLearningEligible: false
  }),
  quick_reply: Object.freeze({
    qualityClass: 'social-generation',
    minimumTier: QUALITY_TIER.HIGH,
    requiredCapabilities: Object.freeze(['social_dialogue_high', 'style_axis_control', 'candidate_diversity', 'persona_consistency_long_context']),
    emergencyLearningEligible: false
  }),
  deep_reply: Object.freeze({
    qualityClass: 'social-generation-deep',
    minimumTier: QUALITY_TIER.HIGH,
    requiredCapabilities: Object.freeze(['social_dialogue_high', 'relationship_reasoning', 'persona_consistency_long_context', 'style_axis_control']),
    emergencyLearningEligible: false
  }),
  understanding: Object.freeze({
    qualityClass: 'relationship-understanding',
    minimumTier: QUALITY_TIER.QUALIFIED,
    requiredCapabilities: Object.freeze(['relationship_reasoning', 'json_schema_strict']),
    emergencyLearningEligible: false
  }),
  relationship: Object.freeze({
    qualityClass: 'relationship-understanding',
    minimumTier: QUALITY_TIER.QUALIFIED,
    requiredCapabilities: Object.freeze(['relationship_reasoning', 'persona_consistency_long_context']),
    emergencyLearningEligible: false
  }),
  fact_extraction: Object.freeze({
    qualityClass: 'evidence-extraction',
    minimumTier: QUALITY_TIER.QUALIFIED,
    requiredCapabilities: Object.freeze(['evidence_grounded_extraction', 'json_schema_strict']),
    emergencyLearningEligible: false
  }),
  memory_extraction: Object.freeze({
    qualityClass: 'memory-governance',
    minimumTier: QUALITY_TIER.QUALIFIED,
    requiredCapabilities: Object.freeze(['evidence_grounded_extraction', 'relationship_reasoning', 'json_schema_strict']),
    emergencyLearningEligible: false
  }),
  learning_synthesis: Object.freeze({
    qualityClass: 'learning-synthesis',
    minimumTier: QUALITY_TIER.HIGH,
    requiredCapabilities: Object.freeze(['social_dialogue_high', 'relationship_reasoning', 'json_schema_strict']),
    emergencyLearningEligible: false
  }),
  translation: Object.freeze({
    qualityClass: 'translation',
    minimumTier: QUALITY_TIER.QUALIFIED,
    requiredCapabilities: Object.freeze(['translation_quality', 'multilingual_zh_bridge']),
    emergencyLearningEligible: false
  })
});

const TIER_RANK = Object.freeze({
  [QUALITY_TIER.BLOCKED]: 0,
  [QUALITY_TIER.EMERGENCY]: 1,
  [QUALITY_TIER.CONDITIONAL]: 2,
  [QUALITY_TIER.QUALIFIED]: 3,
  [QUALITY_TIER.HIGH]: 4
});

function clean(value) { return String(value == null ? '' : value).trim(); }
function normalizedTask(value) {
  const task = clean(value);
  if (task === 'reply' || task === 'standard_reply') return 'quick_reply';
  if (task === 'memories' || task === 'contact_memory') return 'memory_extraction';
  return task;
}
function taskProfile(task) {
  return TASK_PROFILES[normalizedTask(task)] || Object.freeze({
    qualityClass: 'general',
    minimumTier: QUALITY_TIER.QUALIFIED,
    requiredCapabilities: Object.freeze([]),
    emergencyLearningEligible: false
  });
}
function explicitCapabilityTags(model = {}) {
  const values = [
    ...(Array.isArray(model.capabilityTags) ? model.capabilityTags : []),
    ...(Array.isArray(model.catalogMetadata?.capabilityTags) ? model.catalogMetadata.capabilityTags : []),
    ...(Array.isArray(model.qualityCapabilities) ? model.qualityCapabilities : [])
  ];
  return new Set(values.map(value => clean(value).toLowerCase()).filter(Boolean));
}
function commercialQualifyingTasks(model = {}) {
  const benchmark = model.lastCommercialBenchmark && typeof model.lastCommercialBenchmark === 'object'
    ? model.lastCommercialBenchmark
    : null;
  return new Set(Array.isArray(benchmark?.qualifyingTasks) ? benchmark.qualifyingTasks.map(clean) : []);
}
function derivedCapabilityTags(model = {}, task = '') {
  const target = normalizedTask(task);
  const tags = explicitCapabilityTags(model);
  const qualification = ['quick_reply', 'deep_reply', 'director'].includes(target)
    ? replyBrainAuthority.taskQualification(model, target)
    : null;
  const benchmark = replyBrainAuthority.benchmarkResult(model);
  const scenarioPass = id => replyBrainAuthority.benchmarkScenarioPass(model, id);

  if (qualification?.full) {
    tags.add('social_dialogue_high');
    tags.add('persona_consistency_long_context');
    if (target === 'director') {
      tags.add('relationship_reasoning');
      tags.add('json_schema_strict');
    } else {
      tags.add('style_axis_control');
      tags.add('candidate_diversity');
    }
  }
  if (scenarioPass('persona_boundary')) tags.add('persona_consistency_long_context');
  if (scenarioPass('director_schema')) tags.add('json_schema_strict');
  if (scenarioPass('german_whatsapp') || scenarioPass('english_whatsapp')) tags.add('social_dialogue_high');
  if (benchmark?.pass === true && ['director', 'deep_reply'].includes(target)) tags.add('relationship_reasoning');

  const allowed = new Set(Array.isArray(model.allowedTasks) ? model.allowedTasks.map(clean) : []);
  if (allowed.has('fact_extraction') || allowed.has('memory_extraction')) tags.add('evidence_grounded_extraction');
  if (allowed.has('understanding') || allowed.has('relationship')) tags.add('relationship_reasoning');
  if (allowed.has('translation')) tags.add('multilingual_zh_bridge');
  if (commercialQualifyingTasks(model).has('translation')) tags.add('translation_quality');
  if (model.lastQualificationTest?.scores?.json?.pass === true || model.lastTest?.scores?.json?.pass === true) tags.add('json_schema_strict');
  return [...tags].sort();
}
function onboardingConditionalTaskEligible(model = {}, task = '') {
  const target = normalizedTask(task);
  const allowed = new Set(Array.isArray(model.allowedTasks) ? model.allowedTasks.map(clean) : []);
  const smokePassed = model.onboardingSmokeStatus === 'passed' || model.openRouterOnboardingSmoke?.pass === true;
  return clean(model.qualification) === 'experimental' && smokePassed && allowed.has(target);
}

function qualityTierForModel(model = {}, task = '') {
  const target = normalizedTask(task);
  if (!model || model.userDisabled === true || model.available === false) return QUALITY_TIER.BLOCKED;
  if (['quick_reply', 'deep_reply', 'director'].includes(target)) {
    const qualification = replyBrainAuthority.taskQualification(model, target);
    if (qualification.full) return QUALITY_TIER.HIGH;
    if (qualification.selectable) return QUALITY_TIER.CONDITIONAL;
    return QUALITY_TIER.BLOCKED;
  }
  if (target === 'learning_synthesis') {
    const allowed = new Set(Array.isArray(model.allowedTasks) ? model.allowedTasks.map(clean) : []);
    if (!allowed.has('learning_synthesis')) return QUALITY_TIER.BLOCKED;
    const directorQualification = replyBrainAuthority.taskQualification(model, 'director');
    if (directorQualification.full) return QUALITY_TIER.HIGH;
    if (directorQualification.selectable) return QUALITY_TIER.CONDITIONAL;
    return QUALITY_TIER.BLOCKED;
  }
  if (target === 'translation') {
    if (commercialQualifyingTasks(model).has('translation')) return QUALITY_TIER.QUALIFIED;
    const allowed = new Set(Array.isArray(model.allowedTasks) ? model.allowedTasks.map(clean) : []);
    return (model.qualification === 'verified' && allowed.has('translation')) || onboardingConditionalTaskEligible(model, 'translation')
      ? QUALITY_TIER.CONDITIONAL
      : QUALITY_TIER.BLOCKED;
  }
  const allowed = new Set(Array.isArray(model.allowedTasks) ? model.allowedTasks.map(clean) : []);
  if (model.qualification === 'verified' && (allowed.has(target) || !target)) return QUALITY_TIER.QUALIFIED;
  if (model.qualification === 'experimental' && allowed.has(target)) return QUALITY_TIER.CONDITIONAL;
  return QUALITY_TIER.BLOCKED;
}
function capabilityCoverage(model = {}, task = '') {
  const profile = taskProfile(task);
  const tags = new Set(derivedCapabilityTags(model, task));
  const missing = profile.requiredCapabilities.filter(tag => !tags.has(tag));
  return {
    required: [...profile.requiredCapabilities],
    present: [...tags].sort(),
    missing,
    pass: missing.length === 0
  };
}
function modelProjection(model = {}, task = '') {
  const tier = qualityTierForModel(model, task);
  const coverage = capabilityCoverage(model, task);
  return {
    id: clean(model.id),
    name: clean(model.name || model.id),
    provider: clean(model.provider),
    task: normalizedTask(task),
    qualityTier: tier,
    qualityRank: TIER_RANK[tier] || 0,
    capabilityCoverage: coverage,
    routeEligible: tier !== QUALITY_TIER.BLOCKED,
    highCapabilityPath: tier === QUALITY_TIER.HIGH && coverage.pass
  };
}
function modelById(models = []) {
  return new Map((Array.isArray(models) ? models : []).map(model => [clean(model.id), model]));
}
function routeModelIds(route = {}, requestedModelId = '') {
  return {
    primary: clean(requestedModelId || route.primary),
    fallback: clean(route.fallback),
    emergency: clean(route.emergency || route.emergencyModelId)
  };
}

function conditionalRouteEligible(model = {}, task = '') {
  const target = normalizedTask(task);
  if (!model || model.available === false || model.userDisabled === true) return false;
  if (replyChampionAuthority.isFormalReplyTask(target)) {
    return replyBrainAuthority.manualRouteEligible(model, target);
  }
  if (target === 'translation') {
    const allowed = new Set(Array.isArray(model.allowedTasks) ? model.allowedTasks.map(clean) : []);
    return (clean(model.qualification) === 'verified' && allowed.has('translation'))
      || onboardingConditionalTaskEligible(model, 'translation');
  }
  return qualityTierForModel(model, target) === QUALITY_TIER.CONDITIONAL;
}

function routePlan({ task, route = {}, models = [], requestedModelId = '', executionMode = '' } = {}) {
  const target = normalizedTask(task);
  const executionPolicy = executionModeAuthority.policyFor(executionMode);
  const candidateOnly = executionPolicy.mode === executionModeAuthority.EXECUTION_MODE.CANDIDATE_ONLY;
  const profile = taskProfile(target);
  const byId = modelById(models);
  const ids = routeModelIds(route, requestedModelId);
  const primaryModel = ids.primary ? byId.get(ids.primary) : null;
  const fallbackModel = ids.fallback ? byId.get(ids.fallback) : null;
  const primary = primaryModel ? modelProjection(primaryModel, target) : null;
  const fallback = fallbackModel ? modelProjection(fallbackModel, target) : null;
  const emergency = ids.emergency ? modelProjection(byId.get(ids.emergency), target) : null;
  const minimumRank = TIER_RANK[profile.minimumTier] || TIER_RANK[QUALITY_TIER.QUALIFIED];
  const conditionalAllowed = executionPolicy.allowConditional === true;
  const championDecision = replyChampionAuthority.isFormalReplyTask(target)
    ? replyChampionAuthority.decide(models, target, {
        requestedModelId: ids.primary,
        maxFallbackScoreGap: Number(route.maxFallbackScoreGap || replyChampionAuthority.DEFAULT_MAX_FALLBACK_SCORE_GAP)
      })
    : null;
  const championExists = Boolean(championDecision?.champion?.modelId);
  const enforceChampion = !candidateOnly;
  const primaryIsChampion = !enforceChampion || !championExists || primary?.id === championDecision.champion.modelId;
  const fallbackIsRunnerUp = !enforceChampion || !championExists || fallback?.id === championDecision.fallback?.modelId;
  const basePrimaryPass = Boolean(primary && primary.routeEligible && primary.qualityRank >= minimumRank && primary.capabilityCoverage.pass);
  const primaryPass = basePrimaryPass && primaryIsChampion;
  const primaryConditional = Boolean(
    primary && primary.routeEligible && conditionalAllowed && conditionalRouteEligible(primaryModel, target)
  );
  const baselineRank = primaryPass ? primary.qualityRank : primaryConditional ? primary.qualityRank : minimumRank;
  const fallbackCandidateEligible = Boolean(candidateOnly && fallback && fallback.routeEligible && fallback.id !== primary?.id
    && conditionalRouteEligible(fallbackModel, target));
  const fallbackIndependent = Boolean(primaryModel && fallbackModel && providerDomainAuthority.independent(primaryModel, fallbackModel));
  const baseFallbackPass = Boolean(fallback && fallback.routeEligible && fallback.id !== primary?.id && (
    (fallback.qualityRank >= baselineRank && (fallback.capabilityCoverage.pass || fallback.qualityTier === QUALITY_TIER.CONDITIONAL))
    || fallbackCandidateEligible
  ));
  const fallbackPass = baseFallbackPass && fallbackIsRunnerUp && fallbackIndependent;
  const emergencyAllowed = route.allowEmergency === true;
  const emergencyPass = Boolean(emergencyAllowed && emergency && emergency.routeEligible && emergency.id !== primary?.id && emergency.id !== fallback?.id);

  let state = ROUTE_STATE.READY;
  const violations = [];
  if (enforceChampion && championExists && !primaryIsChampion) {
    state = ROUTE_STATE.BLOCKED;
    violations.push({
      code: 'AI_REPLY_PRIMARY_NOT_CHAMPION',
      modelId: primary?.id || '',
      championModelId: championDecision.champion.modelId,
      requestedModelId: ids.primary
    });
  } else if (!primaryPass && !primaryConditional) {
    state = emergencyPass ? ROUTE_STATE.EMERGENCY_ONLY : ROUTE_STATE.BLOCKED;
    violations.push({ code: 'AI_QUALITY_PRIMARY_BELOW_TASK_TIER', modelId: primary?.id || '', requiredTier: profile.minimumTier, actualTier: primary?.qualityTier || QUALITY_TIER.BLOCKED });
  } else if (enforceChampion && championExists && championDecision.fallback && !fallbackIsRunnerUp) {
    state = ROUTE_STATE.DEGRADED;
    violations.push({
      code: 'AI_REPLY_FALLBACK_NOT_ELIGIBLE_RUNNER_UP',
      modelId: fallback?.id || '',
      expectedFallbackModelId: championDecision.fallback.modelId,
      maxFallbackScoreGap: championDecision.maxFallbackScoreGap
    });
  } else if (fallback && !fallbackIndependent) {
    state = primaryConditional ? ROUTE_STATE.CONDITIONAL : ROUTE_STATE.DEGRADED;
    violations.push({
      code: 'AI_ROUTE_FALLBACK_FAILURE_DOMAIN_NOT_INDEPENDENT',
      primaryModelId: primary?.id || '',
      fallbackModelId: fallback?.id || '',
      primaryFailureDomain: providerDomainAuthority.providerFailureDomain(primaryModel || {}),
      fallbackFailureDomain: providerDomainAuthority.providerFailureDomain(fallbackModel || {})
    });
  } else if (!fallbackPass) {
    state = primaryConditional ? ROUTE_STATE.CONDITIONAL : ROUTE_STATE.DEGRADED;
    violations.push({ code: 'AI_QUALITY_SAME_TIER_FALLBACK_MISSING', modelId: fallback?.id || '', primaryTier: primary?.qualityTier || '', fallbackTier: fallback?.qualityTier || QUALITY_TIER.BLOCKED });
  } else if (primaryConditional) {
    state = ROUTE_STATE.CONDITIONAL;
  }
  if (emergency && !emergencyAllowed) violations.push({ code: 'AI_QUALITY_EMERGENCY_CONFIGURED_BUT_DISABLED', modelId: emergency.id });

  return {
    schemaVersion: SCHEMA_VERSION,
    authority: AUTHORITY,
    executionMode: executionPolicy.mode,
    deliveryEligible: executionPolicy.deliveryEligible,
    learningEligible: executionPolicy.learningEligible,
    formalReceiptEligible: executionPolicy.formalReceiptEligible,
    task: target,
    qualityClass: profile.qualityClass,
    minimumTier: profile.minimumTier,
    requiredCapabilities: [...profile.requiredCapabilities],
    state,
    pass: state === ROUTE_STATE.READY,
    primaryPass,
    primaryConditional,
    fallbackPass,
    fallbackIndependent,
    emergencyPass,
    highCapabilityPathReady: primaryPass && fallbackPass,
    humanReviewRequired: executionPolicy.humanReviewRequired === true || state === ROUTE_STATE.CONDITIONAL,
    emergencyAvailable: emergencyPass,
    emergencyLearningEligible: profile.emergencyLearningEligible === true,
    championDecision,
    primary,
    fallback,
    emergency,
    violations
  };
}

function classifyFailure(error = {}) {
  const decision = taskRoutingAuthority.classifyFailure(error);
  const actions = {
    CANCELLED_OR_STALE: 'stop_cancelled_or_stale',
    PROVIDER_AUTHORIZATION_FAILED: 'stop_and_reauthenticate',
    REQUEST_NOT_RETRYABLE: 'stop_and_correct_request',
    MODEL_UNAVAILABLE: 'switch_independent_provider',
    RATE_LIMITED: 'cooldown_then_switch_independent_provider',
    TIMEOUT: 'reduce_context_then_switch_independent_provider',
    PROVIDER_TRANSIENT_FAILURE: 'switch_independent_provider',
    QUALITY_FAILURE: 'switch_independent_provider_and_record_quality_failure',
    MODEL_INVOCATION_FAILED: 'stop_unclassified_failure'
  };
  return { ...decision, action: actions[decision.reasonCode] || 'stop_unclassified_failure' };
}
function routeReceipt({ task, executionMode = '', selectedModel = {}, routePlan: plan = null, fallbackUsed = false, emergencyMode = false, attempts = [] } = {}) {
  const target = normalizedTask(task);
  const executionPolicy = executionModeAuthority.policyFor(executionMode || plan?.executionMode);
  const model = modelProjection(selectedModel, target);
  const payload = {
    schemaVersion: SCHEMA_VERSION,
    authority: AUTHORITY,
    task: target,
    executionMode: executionPolicy.mode,
    deliveryEligible: executionPolicy.deliveryEligible,
    formalReceiptEligible: executionPolicy.formalReceiptEligible,
    humanReviewRequired: executionPolicy.humanReviewRequired || plan?.humanReviewRequired === true,
    selectedModelId: model.id,
    selectedModelName: model.name,
    selectedProvider: model.provider,
    qualityTier: emergencyMode ? QUALITY_TIER.EMERGENCY : model.qualityTier,
    fallbackUsed: fallbackUsed === true,
    emergencyMode: emergencyMode === true,
    qualityDegraded: emergencyMode === true || model.qualityTier === QUALITY_TIER.CONDITIONAL,
    learningEligible: executionPolicy.learningEligible === true && emergencyMode !== true && model.qualityTier !== QUALITY_TIER.EMERGENCY,
    highCapabilityPath: emergencyMode !== true && model.highCapabilityPath,
    routeState: plan?.state || '',
    championModelId: clean(plan?.championDecision?.champion?.modelId),
    championTaskScore: Number(plan?.championDecision?.champion?.taskScore || 0),
    championFallbackModelId: clean(plan?.championDecision?.fallback?.modelId),
    placementLane: clean(plan?.placementDecision?.policy?.lane),
    budgetReasonCode: clean(plan?.budgetDecision?.reasonCode),
    budgetRemainingUsd: Number(plan?.budgetDecision?.remainingUsd || 0),
    reasonCodes: Array.isArray(plan?.violations) ? plan.violations.map(item => item.code) : [],
    attempts: Array.isArray(attempts) ? attempts.map(item => ({
      attemptId: clean(item.attemptId),
      modelId: clean(item.modelId),
      provider: clean(item.provider),
      failureDomain: clean(item.failureDomain),
      role: clean(item.role),
      status: clean(item.status),
      code: clean(item.code),
      qualityTier: clean(item.qualityTier),
      reasonCode: clean(item.reasonCode),
      recoveryAction: clean(item.recoveryAction),
      fallbackAllowed: item.fallbackAllowed === true,
      retrySameModel: item.retrySameModel === true,
      retryAfterMs: Number(item.retryAfterMs || 0),
      nextRetryAt: clean(item.nextRetryAt),
      providerRequestId: clean(item.providerRequestId),
      httpStatus: Number(item.httpStatus || 0),
      timeoutMs: Number(item.timeoutMs || 0),
      remainingBudgetMs: Number(item.remainingBudgetMs || 0),
      latencyMs: Number(item.latencyMs || 0),
      outcomeUnknown: item.outcomeUnknown === true,
      recoveryPhase: clean(item.recoveryPhase),
      contextReduced: item.contextReduced === true,
      originalContextChars: Number(item.originalContextChars || 0),
      reducedContextChars: Number(item.reducedContextChars || 0)
    })) : [],
    observedAt: new Date().toISOString()
  };
  const receiptHash = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  return {
    ...payload,
    receiptHash,
    receiptSignature: signReceiptHash(receiptHash)
  };
}


function verifyRouteReceipt(receipt = {}, options = {}) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) {
    throw Object.assign(new Error('AI 路由回执缺失。'), { code: 'AI_QUALITY_ROUTE_RECEIPT_REQUIRED', status: 409 });
  }
  const { receiptHash, receiptSignature, ...payload } = receipt;
  const actualHash = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  if (!clean(receiptHash) || clean(receiptHash) !== actualHash) {
    throw Object.assign(new Error('AI 路由回执校验失败。'), { code: 'AI_QUALITY_ROUTE_RECEIPT_INVALID', status: 409, expected: clean(receiptHash), actual: actualHash });
  }
  const actualSignature = signReceiptHash(actualHash);
  if (!clean(receiptSignature) || !timingSafeEqualText(receiptSignature, actualSignature)) {
    throw Object.assign(new Error('AI 路由回执签名校验失败。'), { code: 'AI_QUALITY_ROUTE_RECEIPT_SIGNATURE_INVALID', status: 409 });
  }
  if (clean(payload.authority) !== AUTHORITY || Number(payload.schemaVersion || 0) !== SCHEMA_VERSION) {
    throw Object.assign(new Error('AI 路由回执来源不可信。'), { code: 'AI_QUALITY_ROUTE_RECEIPT_AUTHORITY_INVALID', status: 409 });
  }
  const expectedTask = normalizedTask(options.task || payload.task);
  if (!expectedTask || normalizedTask(payload.task) !== expectedTask) {
    throw Object.assign(new Error('AI 路由回执任务不匹配。'), { code: 'AI_QUALITY_ROUTE_RECEIPT_TASK_MISMATCH', status: 409, expectedTask, actualTask: normalizedTask(payload.task) });
  }
  if (!clean(payload.selectedModelId)) {
    throw Object.assign(new Error('AI 路由回执缺少实际模型。'), { code: 'AI_QUALITY_ROUTE_RECEIPT_MODEL_REQUIRED', status: 409 });
  }
  if (payload.emergencyMode === true && options.allowEmergency !== true) {
    throw Object.assign(new Error('应急路由回执不能用于当前操作。'), { code: 'AI_QUALITY_ROUTE_RECEIPT_EMERGENCY_NOT_ALLOWED', status: 409 });
  }
  if (payload.formalReceiptEligible === false && options.requireFormalReceiptEligible !== false) {
    throw Object.assign(new Error('候选试运行回执不能用于正式资格或生产操作。'), { code: 'AI_QUALITY_ROUTE_RECEIPT_FORMAL_INELIGIBLE', status: 409 });
  }
  if (payload.learningEligible === false && options.requireLearningEligible !== false) {
    throw Object.assign(new Error('不可学习的路由回执不能用于学习晋升。'), { code: 'AI_QUALITY_ROUTE_RECEIPT_LEARNING_INELIGIBLE', status: 409 });
  }
  const minimumTier = options.minimumTier || taskProfile(expectedTask).minimumTier;
  if (options.enforceMinimumTier !== false && (TIER_RANK[clean(payload.qualityTier)] || 0) < (TIER_RANK[minimumTier] || 0)) {
    throw Object.assign(new Error('AI 路由回执未达到任务质量档位。'), { code: 'AI_QUALITY_ROUTE_RECEIPT_TIER_INSUFFICIENT', status: 409, minimumTier, actualTier: clean(payload.qualityTier) });
  }
  return { ok: true, receiptHash: actualHash, receiptSignature: actualSignature, task: expectedTask, qualityTier: clean(payload.qualityTier), selectedModelId: clean(payload.selectedModelId), emergencyMode: payload.emergencyMode === true, learningEligible: payload.learningEligible !== false };
}

module.exports = {
  AUTHORITY,
  SCHEMA_VERSION,
  QUALITY_TIER,
  ROUTE_STATE,
  TASK_PROFILES,
  taskProfile,
  explicitCapabilityTags,
  derivedCapabilityTags,
  qualityTierForModel,
  capabilityCoverage,
  modelProjection,
  routePlan,
  classifyFailure,
  routeReceipt,
  verifyRouteReceipt
};
