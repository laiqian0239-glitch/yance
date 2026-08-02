'use strict';

const modelCapabilityAuthority = require('./modelCapabilityAuthority');
const roleReceiptAuthority = require('./aiRoleQualificationReceiptAuthority');
const replyChampionAuthority = require('./replyChampionAuthority');

const AUTHORITY = 'AIWorkloadPlacementAuthority';
const SCHEMA_VERSION = 1;
const LOCAL_FIRST_TASKS = new Set(['translation', 'understanding', 'relationship', 'fact_extraction', 'memory_extraction', 'summary', 'material_analysis']);

function clean(value) { return String(value == null ? '' : value).trim(); }
function normalizedTask(value) {
  const task = clean(value);
  if (task === 'memories' || task === 'contact_memory') return 'memory_extraction';
  if (task === 'reply' || task === 'standard_reply') return 'quick_reply';
  return task;
}
function pricing(model = {}) { return model.catalogMetadata?.pricing && typeof model.catalogMetadata.pricing === 'object' ? model.catalogMetadata.pricing : {}; }
function modelCostClass(model = {}) {
  if (clean(model.provider).toLowerCase() === 'ollama') return 'local';
  const price = pricing(model);
  const pricingExplicit = price.known === true
    || (Object.prototype.hasOwnProperty.call(price, 'promptPerMillion') && Object.prototype.hasOwnProperty.call(price, 'completionPerMillion'));
  const freeByPrice = pricingExplicit
    && price.known !== false
    && Number(price.promptPerMillion || 0) === 0
    && Number(price.completionPerMillion || 0) === 0;
  if (model.catalogMetadata?.free === true || freeByPrice) return 'free-cloud';
  return 'paid-cloud';
}
function executionPolicy(task = '', options = {}) {
  const target = normalizedTask(task);
  const translationProfile = clean(options.translationProfile || (options.background === true ? 'history' : 'realtime')).toLowerCase();
  if (replyChampionAuthority.isFormalReplyTask(target)) {
    return { authority: AUTHORITY, schemaVersion: SCHEMA_VERSION, task: target, lane: 'reply-champion', translationProfile: '', qualityFirst: true, order: ['champion', 'runner-up'] };
  }
  if (target === 'translation' && translationProfile === 'outbound') {
    return { authority: AUTHORITY, schemaVersion: SCHEMA_VERSION, task: target, lane: 'translation-champion', translationProfile, qualityFirst: true, order: ['best-qualified'] };
  }
  if (LOCAL_FIRST_TASKS.has(target)) {
    return { authority: AUTHORITY, schemaVersion: SCHEMA_VERSION, task: target, lane: 'local-private-first', translationProfile: target === 'translation' ? translationProfile : '', qualityFirst: false, order: ['local', 'free-cloud', 'paid-cloud'] };
  }
  return { authority: AUTHORITY, schemaVersion: SCHEMA_VERSION, task: target, lane: 'free-cloud-first', translationProfile: '', qualityFirst: false, order: ['free-cloud', 'local', 'paid-cloud'] };
}
function translationScore(model = {}) {
  return Number(model.lastCommercialBenchmark?.translationScore || model.lastCommercialBenchmark?.score || 0);
}
function eligible(model = {}, task = '', options = {}) {
  const target = normalizedTask(task);
  if (!model || !clean(model.id) || model.available === false || model.userDisabled === true) return { pass: false, reasonCode: 'AI_WORK_MODEL_UNAVAILABLE' };
  if (!modelCapabilityAuthority.supportsTask(model, target)) return { pass: false, reasonCode: 'AI_WORK_MODEL_CAPABILITY_BLOCKED' };
  const allowed = new Set(Array.isArray(model.allowedTasks) ? model.allowedTasks.map(clean) : []);
  if (!allowed.has(target)) return { pass: false, reasonCode: 'AI_WORK_TASK_NOT_ALLOWED' };
  if (clean(model.qualification) !== 'verified') return { pass: false, reasonCode: 'AI_WORK_MODEL_NOT_VERIFIED' };
  if (target === 'translation') {
    const receipt = roleReceiptAuthority.validate(model, target, { now: options.now });
    if (!receipt.pass && options.allowConditional !== true) {
      return { pass: false, reasonCode: receipt.reason || 'AI_WORK_TRANSLATION_RECEIPT_INVALID', receipt };
    }
  }
  return { pass: true };
}
function laneRank(costClass, policy) {
  const index = policy.order.indexOf(costClass);
  return index < 0 ? 999 : index;
}
function candidateProjection(model = {}, task = '', policy = {}, options = {}) {
  const decision = eligible(model, task, options);
  if (!decision.pass) return { pass: false, modelId: clean(model.id), reasonCode: decision.reasonCode };
  const costClass = modelCostClass(model);
  const qualityScore = normalizedTask(task) === 'translation'
    ? translationScore(model)
    : Number(model.lastCommercialBenchmark?.evidenceScore || model.utilityQualityScore || model.lastCommercialBenchmark?.score || 0);
  return {
    pass: true,
    model,
    modelId: clean(model.id),
    modelName: clean(model.name || model.id),
    provider: clean(model.provider),
    costClass,
    qualityScore,
    laneRank: laneRank(costClass, policy)
  };
}
function rankCandidates(models = [], task = '', options = {}) {
  const policy = executionPolicy(task, options);
  if (policy.lane === 'reply-champion') {
    const champion = replyChampionAuthority.decide(models, task, options);
    return {
      authority: AUTHORITY,
      schemaVersion: SCHEMA_VERSION,
      policy,
      candidates: champion.ranking.map(row => ({ ...row, modelId: row.modelId, costClass: modelCostClass((Array.isArray(models) ? models : []).find(model => clean(model.id) === row.modelId) || {}) })),
      rejected: champion.rejected,
      championDecision: champion
    };
  }
  const candidates = [];
  const rejected = [];
  for (const model of Array.isArray(models) ? models : []) {
    const row = candidateProjection(model, task, policy, options);
    if (row.pass) candidates.push(row);
    else rejected.push({ modelId: row.modelId, reasonCode: row.reasonCode });
  }
  candidates.sort((left, right) => {
    if (policy.qualityFirst && right.qualityScore !== left.qualityScore) return right.qualityScore - left.qualityScore;
    if (left.laneRank !== right.laneRank) return left.laneRank - right.laneRank;
    if (right.qualityScore !== left.qualityScore) return right.qualityScore - left.qualityScore;
    return left.modelId.localeCompare(right.modelId);
  });
  return {
    authority: AUTHORITY,
    schemaVersion: SCHEMA_VERSION,
    policy,
    candidates: candidates.map(({ model, ...row }) => row),
    rejected,
    modelsById: new Map(candidates.map(row => [row.modelId, row.model]))
  };
}

module.exports = {
  AUTHORITY,
  SCHEMA_VERSION,
  LOCAL_FIRST_TASKS,
  normalizedTask,
  modelCostClass,
  executionPolicy,
  eligible,
  rankCandidates
};
