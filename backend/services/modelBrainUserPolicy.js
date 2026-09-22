'use strict';

const { SqliteDocumentStore } = require('../lib/sqliteDocumentStore');
const modelBrainProjection = require('./modelBrainProjection');
const taskRuntimePolicy = require('./modelTaskRuntimePolicy');
const { CORE_AI_TASKS } = require('./aiTaskRoleReadinessAuthority');

const REASONING_LEVELS = Object.freeze(['minimum','low','medium','high','very_high','maximum','ultra']);
const REASONING_LABELS = Object.freeze({
  minimum: '最小', low: '低', medium: '中', high: '高',
  very_high: '极高', maximum: '最高', ultra: '超高'
});
const REASONING_PROFILES = Object.freeze({
  minimum: Object.freeze({ tokenScale: 0.55, timeoutScale: 0.80, numRetries: 0, maxFallbacks: 1 }),
  low: Object.freeze({ tokenScale: 0.75, timeoutScale: 0.90, numRetries: 1, maxFallbacks: 2 }),
  medium: Object.freeze({ tokenScale: 1.00, timeoutScale: 1.00, numRetries: 2, maxFallbacks: 5 }),
  high: Object.freeze({ tokenScale: 1.15, timeoutScale: 1.10, numRetries: 2, maxFallbacks: 5 }),
  very_high: Object.freeze({ tokenScale: 1.30, timeoutScale: 1.20, numRetries: 2, maxFallbacks: 5 }),
  maximum: Object.freeze({ tokenScale: 1.45, timeoutScale: 1.30, numRetries: 2, maxFallbacks: 5 }),
  ultra: Object.freeze({ tokenScale: 1.60, timeoutScale: 1.40, numRetries: 2, maxFallbacks: 5 })
});
const DEFAULT_TASKS = Object.freeze(Object.fromEntries(CORE_AI_TASKS.map(task => [task, Object.freeze({
  mode: 'auto', primaryModelId: '', fallbackModelId: '', updatedAt: ''
})])));
const store = new SqliteDocumentStore('model-brain-user-policy', {
  schemaVersion: 1,
  reasoningLevel: 'medium',
  fastMode: false,
  updatedAt: '',
  tasks: DEFAULT_TASKS
});

function clean(value) { return String(value == null ? '' : value).trim(); }
function nowIso() { return new Date().toISOString(); }
function normalizeReasoningLevel(value) {
  const level = clean(value).toLowerCase();
  return REASONING_LEVELS.includes(level) ? level : 'medium';
}
function assertTask(value) {
  const task = clean(value);
  if (!CORE_AI_TASKS.includes(task)) {
    throw Object.assign(new Error('MODEL_BRAIN_USER_POLICY_TASK_INVALID'), { code: 'MODEL_BRAIN_USER_POLICY_TASK_INVALID', status: 400, task });
  }
  return task;
}
function normalizeTaskPolicy(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const mode = clean(source.mode).toLowerCase() === 'manual' ? 'manual' : 'auto';
  return {
    mode,
    primaryModelId: mode === 'manual' ? clean(source.primaryModelId) : '',
    fallbackModelId: mode === 'manual' ? clean(source.fallbackModelId) : '',
    updatedAt: clean(source.updatedAt)
  };
}
function normalizeDocument(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const tasks = {};
  for (const task of CORE_AI_TASKS) tasks[task] = normalizeTaskPolicy(source.tasks?.[task]);
  return {
    schemaVersion: 1,
    reasoningLevel: normalizeReasoningLevel(source.reasoningLevel),
    fastMode: source.fastMode === true,
    updatedAt: clean(source.updatedAt),
    tasks
  };
}
function read() { return normalizeDocument(store.read()); }
function eligibleModels(state = {}, task = '') {
  return modelBrainProjection.project({ models: Array.isArray(state.models) ? state.models : [] }, { task: assertTask(task) }).candidates;
}
function assertManualBinding(state = {}, task = '', policy = {}) {
  const candidates = eligibleModels(state, task);
  const eligible = new Map(candidates.map(model => [clean(model.id), model]));
  const primary = clean(policy.primaryModelId);
  const fallback = clean(policy.fallbackModelId);
  if (!primary || !eligible.has(primary)) {
    throw Object.assign(new Error('所选主模型尚未通过该功能的正式资格验证'), {
      code: 'MODEL_BRAIN_USER_POLICY_PRIMARY_INELIGIBLE', status: 409, task, modelId: primary
    });
  }
  if (fallback && (!eligible.has(fallback) || fallback === primary)) {
    throw Object.assign(new Error('所选备用模型尚未通过该功能的正式资格验证，或与主模型重复'), {
      code: 'MODEL_BRAIN_USER_POLICY_FALLBACK_INELIGIBLE', status: 409, task, modelId: fallback
    });
  }
  return { candidates, primary: eligible.get(primary), fallback: fallback ? eligible.get(fallback) : null };
}

async function updatePreferences(input = {}) {
  const next = await store.updateAsync(current => {
    const normalized = normalizeDocument(current);
    if (input.reasoningLevel != null) normalized.reasoningLevel = normalizeReasoningLevel(input.reasoningLevel);
    if (input.fastMode != null) normalized.fastMode = input.fastMode === true;
    normalized.updatedAt = nowIso();
    return normalized;
  });
  return normalizeDocument(next);
}
async function setTaskPolicy(taskValue, input = {}, state = {}) {
  const task = assertTask(taskValue);
  const requested = normalizeTaskPolicy({ ...input, updatedAt: nowIso() });
  if (requested.mode === 'manual') assertManualBinding(state, task, requested);
  const next = await store.updateAsync(current => {
    const normalized = normalizeDocument(current);
    normalized.tasks[task] = requested;
    normalized.updatedAt = nowIso();
    return normalized;
  });
  return normalizeDocument(next);
}

function resolve(taskValue, state = {}) {
  const task = assertTask(taskValue);
  const document = read();
  const taskPolicy = document.tasks[task] || normalizeTaskPolicy();
  const candidates = eligibleModels(state, task);
  if (taskPolicy.mode !== 'manual') {
    return { task, document, taskPolicy, candidates, primary: null, fallback: null };
  }
  const manual = assertManualBinding(state, task, taskPolicy);
  const selected = [manual.primary, manual.fallback].filter(Boolean);
  return { task, document, taskPolicy, candidates: selected, primary: manual.primary, fallback: manual.fallback };
}

function requestOptions(taskValue, options = {}, documentValue = read()) {
  const task = assertTask(taskValue);
  const document = normalizeDocument(documentValue);
  const baseTokenPolicy = taskRuntimePolicy.policyForTask(task);
  const baseTimeoutPolicy = taskRuntimePolicy.timeoutPolicyForTask(task);
  const requestedLevel = normalizeReasoningLevel(options.reasoningLevel || document.reasoningLevel);
  const profile = REASONING_PROFILES[requestedLevel];
  const fast = options.fastMode == null ? document.fastMode === true : options.fastMode === true;
  const tokenScale = fast ? Math.min(profile.tokenScale, 0.75) : profile.tokenScale;
  const timeoutScale = fast ? Math.min(profile.timeoutScale, 0.9) : profile.timeoutScale;
  const baseTokens = Number(options.maxTokens || baseTokenPolicy.default);
  const baseTimeout = Number(options.timeoutMs || baseTimeoutPolicy.default);
  return {
    ...options,
    maxTokens: taskRuntimePolicy.normalizeMaxTokens(task, Math.round(baseTokens * tokenScale)),
    timeoutMs: taskRuntimePolicy.normalizeTimeoutMs(task, Math.round(baseTimeout * timeoutScale)),
    numRetries: options.numRetries == null ? profile.numRetries : Math.max(0, Number(options.numRetries || 0)),
    maxFallbacks: options.maxFallbacks == null ? profile.maxFallbacks : Math.max(0, Number(options.maxFallbacks || 0)),
    reasoningLevel: requestedLevel,
    fastMode: fast
  };
}
function project(state = {}) {
  const document = read();
  const models = Array.isArray(state.models) ? state.models : [];
  const tasks = {};
  for (const task of CORE_AI_TASKS) {
    const taskPolicy = document.tasks[task] || normalizeTaskPolicy();
    const candidates = eligibleModels({ models }, task);
    const byId = new Map(candidates.map(model => [clean(model.id), model]));
    const primary = byId.get(taskPolicy.primaryModelId) || null;
    const fallback = byId.get(taskPolicy.fallbackModelId) || null;
    tasks[task] = {
      ...taskPolicy,
      logicalModel: modelBrainProjection.logicalModel(task),
      eligibleModelCount: candidates.length,
      primaryEligible: taskPolicy.mode !== 'manual' || Boolean(primary),
      fallbackEligible: !taskPolicy.fallbackModelId || Boolean(fallback),
      primaryModel: primary ? { id: primary.id, name: primary.name, provider: primary.provider } : null,
      fallbackModel: fallback ? { id: fallback.id, name: fallback.name, provider: fallback.provider } : null
    };
  }
  return {
    schemaVersion: 1,
    authority: 'User preference → Model Brain → LiteLLM',
    reasoningLevel: document.reasoningLevel,
    reasoningLabel: REASONING_LABELS[document.reasoningLevel],
    fastMode: document.fastMode,
    updatedAt: document.updatedAt,
    tasks
  };
}

module.exports = {
  REASONING_LEVELS,
  REASONING_LABELS,
  REASONING_PROFILES,
  normalizeReasoningLevel,
  normalizeTaskPolicy,
  normalizeDocument,
  eligibleModels,
  assertManualBinding,
  requestOptions,
  read,
  project,
  resolve,
  updatePreferences,
  setTaskPolicy
};
