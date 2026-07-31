'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { PATHS } = require('../config');
const replyBrainAuthority = require('./replyBrainModelAuthority');

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
    return model.qualification === 'verified' && allowed.has('translation') ? QUALITY_TIER.CONDITIONAL : QUALITY_TIER.BLOCKED;
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
function routePlan({ task, route = {}, models = [], requestedModelId = '' } = {}) {
  const target = normalizedTask(task);
  const profile = taskProfile(target);
  const byId = modelById(models);
  const ids = routeModelIds(route, requestedModelId);
  const primary = ids.primary ? modelProjection(byId.get(ids.primary), target) : null;
  const fallback = ids.fallback ? modelProjection(byId.get(ids.fallback), target) : null;
  const emergency = ids.emergency ? modelProjection(byId.get(ids.emergency), target) : null;
  const minimumRank = TIER_RANK[profile.minimumTier] || TIER_RANK[QUALITY_TIER.QUALIFIED];
  const conditionalAllowed = route.allowConditional === true;
  const primaryPass = Boolean(primary && primary.routeEligible && primary.qualityRank >= minimumRank && primary.capabilityCoverage.pass);
  const primaryConditional = Boolean(primary && primary.routeEligible && conditionalAllowed && primary.qualityTier === QUALITY_TIER.CONDITIONAL);
  const baselineRank = primaryPass ? primary.qualityRank : primaryConditional ? primary.qualityRank : minimumRank;
  const fallbackPass = Boolean(fallback && fallback.routeEligible && fallback.id !== primary?.id && fallback.qualityRank >= baselineRank && (fallback.capabilityCoverage.pass || fallback.qualityTier === QUALITY_TIER.CONDITIONAL));
  const emergencyAllowed = route.allowEmergency === true;
  const emergencyPass = Boolean(emergencyAllowed && emergency && emergency.routeEligible && emergency.id !== primary?.id && emergency.id !== fallback?.id);

  let state = ROUTE_STATE.READY;
  const violations = [];
  if (!primaryPass && !primaryConditional) {
    state = emergencyPass ? ROUTE_STATE.EMERGENCY_ONLY : ROUTE_STATE.BLOCKED;
    violations.push({ code: 'AI_QUALITY_PRIMARY_BELOW_TASK_TIER', modelId: primary?.id || '', requiredTier: profile.minimumTier, actualTier: primary?.qualityTier || QUALITY_TIER.BLOCKED });
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
    task: target,
    qualityClass: profile.qualityClass,
    minimumTier: profile.minimumTier,
    requiredCapabilities: [...profile.requiredCapabilities],
    state,
    pass: state === ROUTE_STATE.READY,
    primaryPass,
    primaryConditional,
    fallbackPass,
    emergencyPass,
    highCapabilityPathReady: primaryPass && fallbackPass,
    humanReviewRequired: state === ROUTE_STATE.CONDITIONAL || route.humanReviewRequired === true,
    emergencyAvailable: emergencyPass,
    emergencyLearningEligible: profile.emergencyLearningEligible === true,
    primary,
    fallback,
    emergency,
    violations
  };
}
function classifyFailure(error = {}) {
  const code = clean(error.code).toUpperCase();
  const status = Number(error.status || error.httpStatus || 0);
  if (status === 404 || /MODEL_NOT_FOUND|MODEL_REMOVED|NOT_FOUND/.test(code)) return { reasonCode: 'MODEL_UNAVAILABLE', action: 'switch_same_tier', retrySameModel: false };
  if (status === 429 || /RATE|QUOTA|THROTTLE/.test(code)) return { reasonCode: 'RATE_LIMITED', action: 'switch_provider_or_backoff_same_tier', retrySameModel: true };
  if (/SCHEMA|JSON|STRUCTURED_OUTPUT|PARSE/.test(code)) return { reasonCode: 'SCHEMA_INVALID', action: 'correct_once_then_switch_same_tier', retrySameModel: true };
  if (status === 408 || /TIMEOUT|DEADLINE/.test(code)) return { reasonCode: 'TIMEOUT', action: 'reduce_context_then_switch_low_latency_same_tier', retrySameModel: true };
  if (status >= 500 || /NETWORK|ECONN|OFFLINE|HTTP_5/.test(code)) return { reasonCode: 'PROVIDER_TRANSIENT_FAILURE', action: 'switch_same_tier', retrySameModel: false };
  if (/WRONG_LANGUAGE|CHINESE_LEAK|PERSONA|HALLUCINATION|EMPTY_REPLY|DUPLICATE/.test(code)) return { reasonCode: 'QUALITY_FAILURE', action: 'switch_same_tier_and_record_quality_failure', retrySameModel: false };
  return { reasonCode: 'MODEL_INVOCATION_FAILED', action: 'switch_same_tier_if_retryable', retrySameModel: false };
}
function routeReceipt({ task, selectedModel = {}, routePlan: plan = null, fallbackUsed = false, emergencyMode = false, attempts = [] } = {}) {
  const target = normalizedTask(task);
  const model = modelProjection(selectedModel, target);
  const payload = {
    schemaVersion: SCHEMA_VERSION,
    authority: AUTHORITY,
    task: target,
    selectedModelId: model.id,
    selectedModelName: model.name,
    selectedProvider: model.provider,
    qualityTier: emergencyMode ? QUALITY_TIER.EMERGENCY : model.qualityTier,
    fallbackUsed: fallbackUsed === true,
    emergencyMode: emergencyMode === true,
    qualityDegraded: emergencyMode === true || model.qualityTier === QUALITY_TIER.CONDITIONAL,
    learningEligible: emergencyMode !== true && model.qualityTier !== QUALITY_TIER.EMERGENCY,
    highCapabilityPath: emergencyMode !== true && model.highCapabilityPath,
    routeState: plan?.state || '',
    reasonCodes: Array.isArray(plan?.violations) ? plan.violations.map(item => item.code) : [],
    attempts: Array.isArray(attempts) ? attempts.map(item => ({
      modelId: clean(item.modelId),
      status: clean(item.status),
      code: clean(item.code),
      qualityTier: clean(item.qualityTier),
      reasonCode: clean(item.reasonCode),
      recoveryAction: clean(item.recoveryAction),
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
