'use strict';

const replyBrainAuthority = require('./replyBrainModelAuthority');
const roleReceiptAuthority = require('./aiRoleQualificationReceiptAuthority');
const lifecycleAuthority = require('./aiBrainRoleLifecycleAuthority');
const providerDomainAuthority = require('./modelProviderFailureDomainAuthority');

const AUTHORITY = 'ReplyChampionAuthority';
const SCHEMA_VERSION = 1;
const FORMAL_REPLY_TASKS = Object.freeze(['quick_reply', 'deep_reply', 'director']);
const DEFAULT_MAX_FALLBACK_SCORE_GAP = 8;

function clean(value) { return String(value == null ? '' : value).trim(); }
function normalizedTask(value) {
  const task = clean(value);
  if (task === 'reply' || task === 'standard_reply') return 'quick_reply';
  return task;
}
function isFormalReplyTask(task) { return FORMAL_REPLY_TASKS.includes(normalizedTask(task)); }

const providerFailureDomain = providerDomainAuthority.providerFailureDomain;

function timestamp(value) {
  const parsed = Date.parse(clean(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function projection(model = {}, task = '', options = {}) {
  const target = normalizedTask(task);
  const modelId = clean(model.id);
  if (!modelId) return { pass: false, modelId: '', reasonCode: 'AI_REPLY_MODEL_ID_REQUIRED' };
  if (model.available === false || model.userDisabled === true) {
    return { pass: false, modelId, reasonCode: model.userDisabled === true ? 'AI_REPLY_MODEL_DISABLED' : 'AI_REPLY_MODEL_UNAVAILABLE' };
  }
  const lifecycle = lifecycleAuthority.deriveModelTaskLifecycle(model, target, { now: options.now });
  const qualification = replyBrainAuthority.taskQualification(model, target);
  if (lifecycle.formal !== true || lifecycle.routable !== true) {
    return {
      pass: false,
      modelId,
      reasonCode: lifecycle.reasonCode || 'AI_REPLY_TASK_NOT_FORMALLY_QUALIFIED',
      qualification,
      lifecycle,
      receipt: lifecycle.evidence?.roleReceipt || null
    };
  }
  const receipt = lifecycle.evidence?.roleReceipt || roleReceiptAuthority.validate(model, target, { now: options.now });
  const benchmark = lifecycle.evidence?.benchmark || replyBrainAuthority.benchmarkResult(model) || {};
  return {
    pass: true,
    model,
    modelId,
    modelName: clean(model.name || model.id),
    provider: clean(model.provider),
    task: target,
    taskScore: Number(qualification.score || 0),
    benchmarkScore: Number(replyBrainAuthority.benchmarkScore(model) || 0),
    runtimeEvidence: Boolean(model.lastSuccessfulInvocation || model.lastSuccessAt || Number(model.callCount || 0) > 0),
    currentFailure: Boolean(model.currentFailure || model.lastInvocationStatus === 'failed' || model.lastError),
    testedAt: clean(benchmark.testedAt || model.replyBrainBenchmarkTestedAt),
    qualification,
    receipt,
    lifecycle
  };
}

function compare(left, right) {
  if (right.taskScore !== left.taskScore) return right.taskScore - left.taskScore;
  if (right.benchmarkScore !== left.benchmarkScore) return right.benchmarkScore - left.benchmarkScore;
  if (Number(right.runtimeEvidence) !== Number(left.runtimeEvidence)) return Number(right.runtimeEvidence) - Number(left.runtimeEvidence);
  if (Number(left.currentFailure) !== Number(right.currentFailure)) return Number(left.currentFailure) - Number(right.currentFailure);
  if (timestamp(right.testedAt) !== timestamp(left.testedAt)) return timestamp(right.testedAt) - timestamp(left.testedAt);
  return left.modelId.localeCompare(right.modelId);
}

function rank(models = [], task = '', options = {}) {
  const target = normalizedTask(task);
  if (!isFormalReplyTask(target)) {
    return { authority: AUTHORITY, schemaVersion: SCHEMA_VERSION, task: target, pass: false, ranking: [], rejected: [], reasonCode: 'AI_REPLY_CHAMPION_TASK_UNSUPPORTED' };
  }
  const ranking = [];
  const rejected = [];
  for (const model of Array.isArray(models) ? models : []) {
    const row = projection(model, target, options);
    if (row.pass) ranking.push(row);
    else rejected.push({ modelId: row.modelId, reasonCode: row.reasonCode, qualification: row.qualification || null, receipt: row.receipt || null });
  }
  ranking.sort(compare);
  return {
    authority: AUTHORITY,
    schemaVersion: SCHEMA_VERSION,
    task: target,
    pass: ranking.length > 0,
    ranking,
    rejected,
    reasonCode: ranking.length ? '' : 'AI_REPLY_CHAMPION_UNAVAILABLE'
  };
}

function publicCandidate(row, championScore = 0) {
  if (!row) return null;
  return {
    modelId: row.modelId,
    modelName: row.modelName,
    provider: row.provider,
    taskScore: row.taskScore,
    benchmarkScore: row.benchmarkScore,
    testedAt: row.testedAt,
    scoreGap: Math.max(0, Number(championScore || 0) - Number(row.taskScore || 0))
  };
}

function decide(models = [], task = '', options = {}) {
  const ranked = rank(models, task, options);
  const championRow = ranked.ranking[0] || null;
  const maximumGap = Math.max(0, Number(options.maxFallbackScoreGap ?? DEFAULT_MAX_FALLBACK_SCORE_GAP));
  const championDomain = providerFailureDomain(championRow?.model || {});
  const fallbackRow = championRow
    ? ranked.ranking.slice(1).find(row => providerFailureDomain(row.model) !== championDomain && championRow.taskScore - row.taskScore <= maximumGap) || null
    : null;
  const requestedModelId = clean(options.requestedModelId);
  const requestedMismatch = Boolean(requestedModelId && championRow && requestedModelId !== championRow.modelId);
  return {
    authority: AUTHORITY,
    schemaVersion: SCHEMA_VERSION,
    task: ranked.task,
    pass: ranked.pass && !requestedMismatch,
    reasonCode: requestedMismatch ? 'AI_REPLY_REQUESTED_MODEL_NOT_CHAMPION' : ranked.reasonCode,
    requestedModelId,
    champion: publicCandidate(championRow, championRow?.taskScore),
    fallback: publicCandidate(fallbackRow, championRow?.taskScore),
    fallbackReasonCode: championRow && !fallbackRow ? 'AI_REPLY_INDEPENDENT_FALLBACK_UNAVAILABLE' : '',
    continuityReady: Boolean(championRow && fallbackRow),
    maxFallbackScoreGap: maximumGap,
    ranking: ranked.ranking.map(row => publicCandidate(row, championRow?.taskScore)),
    rejected: ranked.rejected
  };
}

module.exports = {
  AUTHORITY,
  SCHEMA_VERSION,
  FORMAL_REPLY_TASKS,
  DEFAULT_MAX_FALLBACK_SCORE_GAP,
  normalizedTask,
  isFormalReplyTask,
  projection,
  providerFailureDomain,
  rank,
  decide
};
