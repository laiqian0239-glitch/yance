'use strict';

const { TASKS } = require('../../shared/constants');
const replyBrainAuthority = require('./replyBrainModelAuthority');
const taskRuntimePolicy = require('./modelTaskRuntimePolicy');
const modelCapabilityAuthority = require('./modelCapabilityAuthority');
const roleReceiptAuthority = require('./aiRoleQualificationReceiptAuthority');
const replyChampionAuthority = require('./replyChampionAuthority');
const workloadPlacementAuthority = require('./aiWorkloadPlacementAuthority');
const routeResolutionAuthority = require('./aiRouteResolutionAuthority');

const TASK_ALIASES = Object.freeze({
  reply: 'quick_reply',
  standard_reply: 'quick_reply',
  weekly_review: 'summary',
  memories: 'memory_extraction',
  contact_memory: 'memory_extraction',
  media: 'media_analysis',
  persona: 'persona_rewrite'
});
const CHAT_REPLY_TASKS = new Set(['quick_reply', 'deep_reply', 'director', 'relationship']);
const REPLY_BENCHMARK_TASKS = new Set(['quick_reply', 'deep_reply', 'director']);

function cleanModelId(value) {
  if (typeof value === 'string') {
    const id = value.trim();
    if (!id || id === '[object Object]' || id === 'configured-model' || id === 'undefined' || id === 'null') return '';
    return id;
  }
  if (value && typeof value === 'object') return cleanModelId(value.modelId || value.id || value.value);
  return '';
}

function normalizedTask(task) { return TASK_ALIASES[String(task || '').trim()] || String(task || '').trim(); }
function modelName(model = {}) { return String(model.name || model.id || '').toLowerCase(); }
function isCoderModel(model = {}) { return /(?:coder|codeqwen|starcoder|deepseek-coder)/i.test(modelName(model)); }
function isTranslationModel(model = {}) { return /(?:translate|translation|translategemma)/i.test(modelName(model)); }
function isEmbeddingModel(model = {}) { return /(?:embed|bge-|nomic-embed|e5-)/i.test(modelName(model)); }

function parseParameterBillions(model = {}) {
  const explicit = String(model.parameterSize || model.details?.parameterSize || '').match(/([0-9]+(?:\.[0-9]+)?)\s*[bB]/);
  if (explicit) return Number(explicit[1]);
  const bytes = Number(model.sizeBytes || model.size || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return 0;
  return bytes / 650000000;
}

function modelTaskPolicyAllows(model, task) {
  const target = normalizedTask(task);
  if (!modelCapabilityAuthority.supportsTask(model, target)) return false;
  const taskEligibility = model?.catalogMetadata?.taskEligibility;
  if (taskEligibility && typeof taskEligibility === 'object') {
    const role = target === 'media_analysis'
      ? 'media_analysis'
      : ['fact_extraction', 'memory_extraction', 'understanding', 'summary'].includes(target)
        ? 'memory_extraction'
        : target === 'persona_rewrite'
          ? 'persona_rewrite'
          : target;
    if (Object.prototype.hasOwnProperty.call(taskEligibility, role) && taskEligibility[role] !== true) return false;
  }
  if (isEmbeddingModel(model)) return false;
  if (isTranslationModel(model)) return target === 'translation';
  if (isCoderModel(model) && CHAT_REPLY_TASKS.has(target)) return false;
  return true;
}

function onboardingConditionalTaskEligible(model = {}, task = '') {
  const target = normalizedTask(task);
  const allowed = new Set(Array.isArray(model.allowedTasks) ? model.allowedTasks : []);
  const smokePassed = model.onboardingSmokeStatus === 'passed' || model.openRouterOnboardingSmoke?.pass === true;
  return String(model.qualification || '') === 'experimental' && smokePassed && allowed.has(target);
}

function eligibleForTask(model, task, options = {}) {
  if (!model || model.available === false || model.userDisabled === true || !modelTaskPolicyAllows(model, task)) return false;
  const qualification = String(model.qualification || '');
  const target = normalizedTask(task);
  const receiptDecision = roleReceiptAuthority.GOVERNED_TASKS.includes(target)
    ? roleReceiptAuthority.validate(model, target, { now: options.now })
    : { pass: true };
  if (REPLY_BENCHMARK_TASKS.has(target)) {
    const formallyQualified = replyBrainAuthority.replyBrainQualified(model);
    if (formallyQualified) return receiptDecision.pass === true;
    if (options.allowConditional === true && replyBrainAuthority.manualRouteEligible(model, target)) return true;
    return false;
  }
  if (target === 'translation') {
    if (receiptDecision.pass === true) return true;
    if (options.allowConditional === true) {
      const allowed = new Set(Array.isArray(model.allowedTasks) ? model.allowedTasks : []);
      return (qualification === 'verified' && allowed.has('translation'))
        || onboardingConditionalTaskEligible(model, 'translation');
    }
    return false;
  }
  if (qualification !== 'verified' && !(options.allowExperimental === true && qualification === 'experimental')) return false;
  const allowed = new Set(Array.isArray(model.allowedTasks) ? model.allowedTasks : []);
  return allowed.has(task) || allowed.has(target);
}

function routeCandidateScore(model, task) {
  const target = normalizedTask(task);
  const name = modelName(model);
  const billions = parseParameterBillions(model);
  let score = model.qualification === 'verified' ? 1000 : 650;
  const cloudModel = model.provider !== 'ollama';
  // Quality-first is the default product policy: qualified cloud models lead; local models remain offline/emergency fallbacks.
  score += cloudModel ? 320 : -80;
  if (Number(model.callCount || 0) > 0) score += Math.min(60, Number(model.callCount || 0) * 4);
  if (model.lastError) score -= 35;

  if (target === 'translation') {
    if (isTranslationModel(model)) score += 600;
    score += cloudModel ? 900 : 220;
  } else if (target === 'quick_reply' || target === 'deep_reply') {
    const brainScore = replyBrainAuthority.replyBrainScore(model);
    const taskQualification = replyBrainAuthority.taskQualification(model, target);
    if (taskQualification.full) score += 620;
    else if (taskQualification.selectable) score += taskQualification.state === 'conditional' ? 360 : 220;
    score += Number(taskQualification.score || 0) * 6;
    score += brainScore * 4;
    if (/ministral|mistral-small|qwen.*(?:9b|14b|30b)|gemma.*12b/i.test(name)) score += 220;
    if (billions >= 12 && billions <= 35) score += target === 'deep_reply' ? 260 : 220;
    else if (billions >= 8) score += 150;
    else if (billions > 0 && billions < 6) score -= 260;
  } else if (target === 'director' || target === 'relationship' || target === 'quality_review') {
    score += replyBrainAuthority.replyBrainScore(model) * 4;
    if (/ministral|mistral-small|qwen.*(?:9b|14b|30b)|gemma.*12b/i.test(name)) score += 300;
  } else if (['fact_extraction', 'memory_extraction', 'understanding', 'summary', 'persona_rewrite'].includes(target)) {
    if (/qwen3\.5.*4b|qwen3\.5.*9b|gemma/i.test(name)) score += 180;
  }

  if (isCoderModel(model)) score -= 220;
  return score;
}

function candidatesForTask(models, task, options = {}) {
  const target = normalizedTask(task);
  const sourceModels = Array.isArray(models) ? models : [];
  const byId = new Map(sourceModels.map(model => [cleanModelId(model.id), model]));
  const placement = workloadPlacementAuthority.rankCandidates(sourceModels, target, {
    translationProfile: target === 'translation' ? (options.translationProfile || 'outbound') : '',
    background: options.background === true,
    now: options.now,
    maxFallbackScoreGap: options.maxFallbackScoreGap
  });
  const selected = placement.candidates
    .map(row => byId.get(cleanModelId(row.modelId)))
    .filter(Boolean);
  if (selected.length || target === 'translation') return selected;
  const allowExperimental = options.allowExperimental !== false;
  const allowConditional = options.allowConditional === true;
  if (replyChampionAuthority.isFormalReplyTask(target) && !allowConditional) return [];
  return sourceModels
    .filter(model => eligibleForTask(model, target, { allowExperimental, allowConditional, now: options.now }))
    .sort((a, b) => routeCandidateScore(b, target) - routeCandidateScore(a, target));
}

function normalizeRoute(route = {}, task = '') {
  const v2 = routeResolutionAuthority.normalizeRouteV2(route, task);
  const source = typeof route === 'string' ? { primary: route } : (route && typeof route === 'object' ? route : {});
  const primary = v2.legacy.primary;
  const fallback = v2.legacy.fallback;
  const primarySelection = v2.legacy.primarySelection;
  const fallbackSelection = v2.legacy.fallbackSelection;
  const requestedEnabled = v2.legacy.requestedEnabled;
  return {
    authority: v2.authority,
    schemaVersion: v2.schemaVersion,
    requested: v2.requested,
    resolved: v2.resolved,
    resolutionState: v2.resolutionState,
    reasonCodes: [...v2.reasonCodes],
    primary,
    fallback,
    requestedPrimary: v2.legacy.requestedPrimary,
    requestedFallback: v2.legacy.requestedFallback,
    allowExperimental: source.allowExperimental === true,
    allowConditional: source.allowConditional === true,
    allowCloudFallback: source.allowCloudFallback !== false,
    humanReviewRequired: source.humanReviewRequired === true || source.allowConditional === true,
    allowEmergency: source.allowEmergency === true,
    emergency: cleanModelId(source.emergency || source.emergencyModelId),
    emergencyModelId: cleanModelId(source.emergency || source.emergencyModelId),
    emergencyLearningEligible: false,
    qualityPolicyVersion: String(source.qualityPolicyVersion || 'ai-champion-brain-v2'),
    maxFallbackScoreGap: Math.max(0, Number(source.maxFallbackScoreGap ?? replyChampionAuthority.DEFAULT_MAX_FALLBACK_SCORE_GAP)),
    primarySelection,
    fallbackSelection,
    requestedEnabled,
    enabled: requestedEnabled,
    operational: requestedEnabled && Boolean(primary),
    maxTokens: taskRuntimePolicy.normalizeMaxTokens(task, source.maxTokens),
    timeoutMs: taskRuntimePolicy.normalizeTimeoutMs(task, source.timeoutMs),
    source: String(source.source || ''),
    autoSelectionReason: String(source.autoSelectionReason || ''),
    historyPrimary: cleanModelId(source.historyPrimary),
    historyFallback: cleanModelId(source.historyFallback),
    offlineFallback: cleanModelId(source.offlineFallback),
    profiles: source.profiles && typeof source.profiles === 'object' ? { ...source.profiles } : {},
    updatedAt: String(source.updatedAt || '')
  };
}

function projectResolvedRouteV2(route = {}, task = '', byId = new Map()) {
  const primaryModel = byId.get(cleanModelId(route.primary));
  const fallbackModel = byId.get(cleanModelId(route.fallback));
  const primaryReason = cleanModelId(route.primary)
    ? route.primarySelection === 'auto'
      ? (route.allowConditional === true ? 'AUTO_CONDITIONAL_CHALLENGER_SELECTED' : 'AUTO_CHAMPION_SELECTED')
      : 'MANUAL_MODEL_SELECTED'
    : 'PRIMARY_MODEL_UNRESOLVED';
  const fallbackReason = cleanModelId(route.fallback)
    ? route.fallbackSelection === 'auto'
      ? 'AUTO_FALLBACK_PROVIDER_INDEPENDENT'
      : (routeResolutionAuthority.providerFailureDomain(fallbackModel || {}) === routeResolutionAuthority.providerFailureDomain(primaryModel || {})
        ? 'MANUAL_FALLBACK_SHARED_PROVIDER_DOMAIN'
        : 'MANUAL_FALLBACK_PROVIDER_INDEPENDENT')
    : route.fallbackSelection === 'auto'
      ? 'NO_QUALIFIED_INDEPENDENT_FALLBACK'
      : 'FALLBACK_NOT_REQUESTED';
  const requested = {
    enabled: route.requestedEnabled !== false,
    primary: {
      mode: route.primarySelection === 'auto' ? 'auto' : 'manual',
      modelId: route.primarySelection === 'manual' ? cleanModelId(route.requestedPrimary || route.primary) : ''
    },
    fallback: {
      mode: route.fallbackSelection === 'manual' ? 'manual' : 'auto',
      modelId: route.fallbackSelection === 'manual' ? cleanModelId(route.requestedFallback || route.fallback) : ''
    }
  };
  const resolved = {
    primary: {
      modelId: cleanModelId(route.primary),
      provider: routeResolutionAuthority.providerFailureDomain(primaryModel || {}),
      reasonCode: primaryReason
    },
    fallback: {
      modelId: cleanModelId(route.fallback),
      provider: cleanModelId(route.fallback) ? routeResolutionAuthority.providerFailureDomain(fallbackModel || {}) : '',
      reasonCode: fallbackReason
    }
  };
  const v2 = routeResolutionAuthority.normalizeRouteV2({ requested, resolved }, task);
  return {
    ...route,
    authority: v2.authority,
    schemaVersion: v2.schemaVersion,
    requested: v2.requested,
    resolved: v2.resolved,
    resolutionState: v2.resolutionState,
    reasonCodes: [...v2.reasonCodes],
    ...v2.legacy
  };
}

function repairRegistryDocument(document = {}, options = {}) {
  const models = Array.isArray(document.models) ? document.models : [];
  const byId = new Map(models.map(model => [String(model.id || ''), model]));
  const routes = document.routes && typeof document.routes === 'object' ? document.routes : {};
  const tasks = [...new Set([...TASKS, ...Object.keys(routes).map(normalizedTask).filter(Boolean)])];
  const repaired = {};
  const quarantine = [];
  let changed = false;

  for (const task of tasks) {
    const rawRoute = routes[task] || {};
    const route = normalizeRoute(rawRoute, task);
    const next = { ...route };
    for (const role of ['primary', 'fallback']) {
      const requestedKey = role === 'primary' ? 'requestedPrimary' : 'requestedFallback';
      const selectionKey = role === 'primary' ? 'primarySelection' : 'fallbackSelection';
      const rawValue = typeof rawRoute === 'string' && role === 'primary' ? rawRoute : (rawRoute?.[role] || rawRoute?.[requestedKey]);
      const supplied = rawValue !== undefined && rawValue !== null && String(rawValue).trim() !== '';
      const modelId = route[role] || (route[selectionKey] === 'manual' ? route[requestedKey] : '');
      if (!modelId) {
        next[role] = '';
        if (supplied) quarantine.push({ task, role, modelId: String(rawValue), code: 'INVALID_MODEL_ID', reason: 'invalid-model-id-shape' });
        continue;
      }
      const model = byId.get(modelId);
      const allowExperimental = route.allowExperimental || (options.autoSelectVerified !== false && model?.qualification === 'experimental');
      const allowConditional = route.allowConditional === true;
      if (!eligibleForTask(model, task, { allowExperimental, allowConditional })) {
        quarantine.push({ task, role, modelId, code: 'UNQUALIFIED_ROUTABLE_MODEL', reason: !model ? 'model-not-found' : `qualification-or-policy-${model.qualification || 'unknown'}` });
        next[role] = '';
      } else {
        next[role] = modelId;
        if (route[selectionKey] === 'manual') next[requestedKey] = modelId;
      }
    }

    if (next.emergency) {
      const emergencyModel = byId.get(next.emergency);
      if (next.allowEmergency !== true) {
        quarantine.push({ task, role: 'emergency', modelId: next.emergency, code: 'EMERGENCY_ROUTE_DISABLED', reason: 'allowEmergency=false' });
        next.emergency = '';
        next.emergencyModelId = '';
      } else if (!eligibleForTask(emergencyModel, task, { allowExperimental: true, allowConditional: true })) {
        quarantine.push({ task, role: 'emergency', modelId: next.emergency, code: 'UNQUALIFIED_EMERGENCY_MODEL', reason: !emergencyModel ? 'model-not-found' : `qualification-or-policy-${emergencyModel.qualification || 'unknown'}` });
        next.emergency = '';
        next.emergencyModelId = '';
      } else {
        next.emergencyModelId = next.emergency;
        next.emergencyLearningEligible = false;
      }
    }

    if (task === 'translation') {
      for (const field of ['historyPrimary', 'historyFallback', 'offlineFallback']) {
        const modelId = cleanModelId(next[field]);
        if (!modelId) { next[field] = ''; continue; }
        const model = byId.get(modelId);
        if (!eligibleForTask(model, 'translation', { allowExperimental: true, allowConditional: false })) {
          quarantine.push({ task, role: field, modelId, code: 'UNQUALIFIED_TRANSLATION_PROFILE_MODEL', reason: !model ? 'model-not-found' : `qualification-or-policy-${model.qualification || 'unknown'}` });
          next[field] = '';
        }
      }
      if (next.historyFallback === next.historyPrimary) next.historyFallback = '';
    }

    if (options.autoSelectVerified !== false && next.enabled !== false) {
      const formalReplyTask = replyChampionAuthority.isFormalReplyTask(task);
      const championDecision = formalReplyTask
        ? replyChampionAuthority.decide(models, task, {
            now: options.now,
            maxFallbackScoreGap: Number(next.maxFallbackScoreGap || replyChampionAuthority.DEFAULT_MAX_FALLBACK_SCORE_GAP)
          })
        : null;
      const conditionalAutoTrial = Boolean(formalReplyTask && championDecision?.pass !== true && next.allowConditional === true);
      const allCandidates = candidatesForTask(models, task, {
        allowExperimental: true,
        allowConditional: conditionalAutoTrial,
        translationProfile: normalizedTask(task) === 'translation' ? 'outbound' : '',
        maxFallbackScoreGap: Number(next.maxFallbackScoreGap || replyChampionAuthority.DEFAULT_MAX_FALLBACK_SCORE_GAP)
      });
      const candidates = normalizedTask(task) === 'translation' && next.allowCloudFallback !== true
        ? allCandidates.filter(model => model.provider === 'ollama')
        : allCandidates;
      const autoPrimary = next.primarySelection === 'auto';
      const autoFallback = next.fallbackSelection === 'auto';
      const source = formalReplyTask
        ? (conditionalAutoTrial ? 'reply-conditional-authority-auto' : 'reply-champion-authority-auto')
        : 'workload-placement-authority-auto';
      if (autoPrimary) {
        next.primary = candidates[0]?.id || '';
        next.requestedPrimary = '';
        next.allowExperimental = false;
        next.allowConditional = conditionalAutoTrial;
        next.humanReviewRequired = conditionalAutoTrial;
        next.autoSelectionReason = candidates[0]
          ? conditionalAutoTrial
            ? `${candidates[0].name}：当前无正式冠军，按专项评估门槛进入条件试运行，必须人工确认`
            : `${candidates[0].name}：由${source === 'reply-champion-authority-auto' ? '任务冠军权威' : '工作负载分层权威'}选定`
          : '当前任务没有通过权威门禁的模型';
        next.source = source;
        next.updatedAt = new Date().toISOString();
      }
      if (autoFallback) {
        const primaryModel = byId.get(next.primary);
        const primaryDomain = routeResolutionAuthority.providerFailureDomain(primaryModel || {});
        const fallback = candidates.find(model => model.id !== next.primary
          && routeResolutionAuthority.providerFailureDomain(model) !== primaryDomain);
        next.fallback = fallback?.id || '';
        next.requestedFallback = '';
        next.source = source;
        next.updatedAt = new Date().toISOString();
      }
      if (task === 'translation') {
        const historyCandidates = candidatesForTask(models, 'translation', { translationProfile: 'history', allowConditional: false });
        if (!next.historyPrimary || next.primarySelection === 'auto') next.historyPrimary = historyCandidates[0]?.id || '';
        if (!next.historyFallback || next.fallbackSelection === 'auto') next.historyFallback = historyCandidates.find(model => model.id !== next.historyPrimary)?.id || '';
        if (!next.offlineFallback || next.primarySelection === 'auto') next.offlineFallback = historyCandidates.find(model => model.provider === 'ollama')?.id || next.historyPrimary || '';
      }
    }

    if (next.fallback === next.primary) next.fallback = '';
    if ([next.primary, next.fallback].includes(next.emergency)) {
      next.emergency = '';
      next.emergencyModelId = '';
    }
    if (!next.primary) {
      next.fallback = '';
      if (next.allowEmergency !== true) {
        next.emergency = '';
        next.emergencyModelId = '';
      }
    }
    next.requestedEnabled = next.requestedEnabled !== false;
    next.enabled = next.requestedEnabled;
    next.operational = next.requestedEnabled && Boolean(next.primary);
    const projectedNext = projectResolvedRouteV2(next, task, byId);
    repaired[task] = projectedNext;
    if (JSON.stringify(normalizeRoute(routes[task] || {}, task)) !== JSON.stringify(projectedNext)) changed = true;
  }

  return {
    document: {
      ...document,
      schemaVersion: Math.max(3, Number(document.schemaVersion || 0)),
      routes: repaired,
      routeQuarantine: quarantine,
      routesRepairedAt: changed || quarantine.length ? new Date().toISOString() : String(document.routesRepairedAt || '')
    },
    quarantine,
    repairedRoutes: repaired
  };
}

function validateRoutes(routes, models, options = {}) {
  const document = { models: Array.isArray(models) ? models : [], routes: routes || {} };
  const result = repairRegistryDocument(document, {
    autoSelectVerified: options.autoSelect === true,
    rebalanceAutoRoutes: options.autoSelect === true
  });
  if (result.quarantine.length && options.throwOnInvalid !== false) {
    const error = new Error('模型路由包含不存在、未验证、任务不匹配或角色不允许的模型');
    error.code = 'INVALID_MODEL_ROUTE';
    error.status = 400;
    error.violations = result.quarantine;
    throw error;
  }
  return result;
}

function configuredRouteCount(routes = {}) {
  return Object.entries(routes || {}).filter(([task, route]) => normalizeRoute(route, task).enabled !== false && cleanModelId(route?.primary || route)).length;
}

module.exports = {
  cleanModelId,
  normalizedTask,
  eligibleForTask,
  normalizeRoute,
  projectResolvedRouteV2,
  repairRegistryDocument,
  validateRoutes,
  configuredRouteCount,
  candidatesForTask,
  routeCandidateScore,
  modelTaskPolicyAllows,
  REPLY_BENCHMARK_TASKS,
  isCoderModel,
  isTranslationModel,
  parseParameterBillions,
  taskRuntimePolicy,
  modelCapabilityAuthority
};
