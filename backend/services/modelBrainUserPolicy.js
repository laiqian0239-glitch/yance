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
  minimum: Object.freeze({ tokenScale: 0.55, timeoutScale: 0.80 }),
  low: Object.freeze({ tokenScale: 0.75, timeoutScale: 0.90 }),
  medium: Object.freeze({ tokenScale: 1.00, timeoutScale: 1.00 }),
  high: Object.freeze({ tokenScale: 1.15, timeoutScale: 1.10 }),
  very_high: Object.freeze({ tokenScale: 1.30, timeoutScale: 1.20 }),
  maximum: Object.freeze({ tokenScale: 1.45, timeoutScale: 1.30 }),
  ultra: Object.freeze({ tokenScale: 1.60, timeoutScale: 1.40 })
});
const store = new SqliteDocumentStore('model-brain-user-policy', {
  schemaVersion: 2,
  reasoningLevel: 'medium',
  fastMode: false,
  updatedAt: ''
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
function normalizeDocument(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    schemaVersion: 2,
    reasoningLevel: normalizeReasoningLevel(source.reasoningLevel),
    fastMode: source.fastMode === true,
    updatedAt: clean(source.updatedAt)
  };
}
function read() { return normalizeDocument(store.read()); }
function eligibleModels(state = {}, task = '') {
  return modelBrainProjection.project({ models: Array.isArray(state.models) ? state.models : [] }, { task: assertTask(task) }).candidates;
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
    reasoningLevel: requestedLevel,
    fastMode: fast
  };
}
function project(state = {}) {
  const document = read();
  const models = Array.isArray(state.models) ? state.models : [];
  const tasks = {};
  for (const task of CORE_AI_TASKS) {
    const candidates = eligibleModels({ models }, task);
    tasks[task] = {
      logicalModel: modelBrainProjection.logicalModel(task),
      eligibleModelCount: candidates.length
    };
  }
  return {
    schemaVersion: 2,
    authority: 'User intent → Model Brain → LiteLLM',
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
  normalizeDocument,
  eligibleModels,
  requestOptions,
  read,
  project,
  updatePreferences
};
