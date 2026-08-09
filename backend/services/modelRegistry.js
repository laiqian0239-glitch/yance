'use strict';

const crypto = require('crypto');
const { SqliteDocumentStore } = require('../lib/sqliteDocumentStore');
const { QUALIFICATION } = require('../../shared/constants');
const { normalizeModelError } = require('./modelErrorNormalizer');
const roleReceiptAuthority = require('./aiRoleQualificationReceiptAuthority');
const aiBudgetAuthority = require('./aiBudgetAuthority');

const store = new SqliteDocumentStore('model-registry', {
  schemaVersion: 4,
  scannedAt: '',
  endpoint: '',
  version: '',
  models: [],
  routes: {},
  history: [],
  openRouter: {},
  aiBudgetPolicy: {
    totalBudgetUsd: aiBudgetAuthority.DEFAULT_POLICY.totalBudgetUsd,
    championReserveUsd: aiBudgetAuthority.DEFAULT_POLICY.championReserveUsd,
    backgroundPaidEnabled: aiBudgetAuthority.DEFAULT_POLICY.backgroundPaidEnabled,
    updatedAt: '',
    source: 'default'
  },
  aiBudgetUsage: { spentUsd: 0, periodStartedAt: '' }
});

function clean(value) { return String(value == null ? '' : value).trim(); }
function unique(values) { return [...new Set((Array.isArray(values) ? values : []).map(clean).filter(Boolean))]; }
function nowIso() { return new Date().toISOString(); }
function pushHistory(current, entry) {
  current.history = Array.isArray(current.history) ? current.history : [];
  current.history.unshift({ ...entry, recordedAt: entry.recordedAt || nowIso() });
  current.history = current.history.slice(0, 500);
}
function deauthorizedDocument(value = {}) {
  const current = value && typeof value === 'object' ? value : {};
  return {
    ...current,
    schemaVersion: Math.max(4, Number(current.schemaVersion || 0)),
    routes: {},
    routeQuarantine: [],
    routingAuthority: 'LiteLLM v1.95.0 Model Brain',
    legacyRoutingRetired: true
  };
}
function readWithAuthorities() {
  const current = deauthorizedDocument(store.read());
  const policy = aiBudgetAuthority.normalizePolicy(current.aiBudgetPolicy || {});
  const usage = aiBudgetAuthority.normalizeUsage(current.aiBudgetUsage || {});
  return {
    ...current,
    aiBudgetPolicy: {
      totalBudgetUsd: policy.totalBudgetUsd,
      championReserveUsd: policy.championReserveUsd,
      backgroundPaidEnabled: policy.backgroundPaidEnabled,
      updatedAt: clean(current.aiBudgetPolicy?.updatedAt),
      source: clean(current.aiBudgetPolicy?.source || 'default')
    },
    aiBudgetUsage: { spentUsd: usage.spentUsd, periodStartedAt: clean(current.aiBudgetUsage?.periodStartedAt) }
  };
}
function update(mutator) {
  return store.updateAsync(current => deauthorizedDocument(mutator(deauthorizedDocument(current)) || current));
}
function routingManagedError() {
  return Object.assign(new Error('MODEL_ROUTING_MANAGED_BY_LITELLM'), { code: 'MODEL_ROUTING_MANAGED_BY_LITELLM', status: 410 });
}

async function setAiBudgetPolicy(input = {}) {
  const totalBudgetUsd = Number(input.totalBudgetUsd);
  const championReserveUsd = Number(input.championReserveUsd);
  if (!Number.isFinite(totalBudgetUsd) || totalBudgetUsd < 0 || !Number.isFinite(championReserveUsd) || championReserveUsd < 0 || championReserveUsd > totalBudgetUsd) {
    throw Object.assign(new Error('AI_BUDGET_POLICY_INVALID'), { code: 'AI_BUDGET_POLICY_INVALID', status: 400 });
  }
  await update(current => {
    const usage = aiBudgetAuthority.normalizeUsage(current.aiBudgetUsage || {});
    current.aiBudgetPolicy = {
      totalBudgetUsd,
      championReserveUsd,
      backgroundPaidEnabled: input.backgroundPaidEnabled !== false,
      updatedAt: nowIso(),
      source: 'user-configured'
    };
    current.aiBudgetUsage = { spentUsd: usage.spentUsd, periodStartedAt: clean(current.aiBudgetUsage?.periodStartedAt) };
    return current;
  });
  return readWithAuthorities();
}

function mergeDiscovered(discovery = {}) {
  return update(current => {
    const byId = new Map((current.models || []).map(model => [model.id, model]));
    const seen = new Set();
    for (const incoming of discovery.models || []) {
      if (!incoming?.id) continue;
      seen.add(incoming.id);
      const previous = byId.get(incoming.id) || {};
      byId.set(incoming.id, {
        qualification: QUALIFICATION.untested,
        allowedTasks: [],
        blockedReason: '',
        lastTest: null,
        ...previous,
        ...incoming,
        available: true,
        missingSince: ''
      });
    }
    for (const [id, model] of byId) {
      if (!seen.has(id) && model.provider === 'ollama') byId.set(id, { ...model, available: false, missingSince: model.missingSince || nowIso() });
    }
    current.models = [...byId.values()].sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
    current.scannedAt = discovery.scannedAt || nowIso();
    current.endpoint = clean(discovery.endpoint);
    current.version = clean(discovery.version);
    current.ollamaOnline = discovery.online === true;
    current.scanError = clean(discovery.error);
    return current;
  });
}

function cloudModelId(provider, endpoint, name) {
  return `cloud-${crypto.createHash('sha1').update([provider, endpoint, name].join('|')).digest('hex').slice(0, 18)}`;
}
function synchronizeOpenRouterCatalog(input = {}) {
  const endpoint = clean(input.endpoint).replace(/\/+$/, '');
  const credentialRef = clean(input.credentialRef);
  if (!endpoint || !credentialRef) throw Object.assign(new Error('OPENROUTER_CATALOG_SCOPE_REQUIRED'), { code: 'OPENROUTER_CATALOG_SCOPE_REQUIRED' });
  const byName = new Map((Array.isArray(input.models) ? input.models : []).map(row => [clean(row?.name || row?.id), row]).filter(([name]) => name));
  return update(current => {
    const timestamp = nowIso();
    current.models = (current.models || []).map(model => {
      if (model.source !== 'openrouter-auto' || clean(model.endpoint).replace(/\/+$/, '') !== endpoint || model.credentialRef !== credentialRef) return model;
      const catalog = byName.get(clean(model.name));
      if (!catalog) return { ...model, available: false, catalogAvailable: false, catalogMissingSince: model.catalogMissingSince || timestamp, updatedAt: timestamp };
      return {
        ...model,
        displayName: clean(catalog.displayName || model.displayName || model.name),
        capabilities: unique(catalog.capabilities || model.capabilities),
        catalogMetadata: { ...(model.catalogMetadata || {}), ...(catalog.catalogMetadata || {}) },
        available: true,
        catalogAvailable: true,
        catalogSeenAt: timestamp,
        catalogMissingSince: '',
        updatedAt: timestamp
      };
    });
    current.openRouterCatalogSynchronizedAt = timestamp;
    return current;
  });
}
function upsertCloudModel(input = {}) {
  const provider = clean(input.provider || 'openai-compatible').toLowerCase();
  const endpoint = clean(input.endpoint).replace(/\/+$/, '');
  const name = clean(input.name || input.model);
  const credentialRef = clean(input.credentialRef);
  if (!endpoint || !name || !credentialRef) throw Object.assign(new Error('INVALID_CLOUD_MODEL'), { code: 'INVALID_CLOUD_MODEL', status: 400 });
  return update(current => {
    const id = clean(input.id || cloudModelId(provider, endpoint, name));
    const index = (current.models || []).findIndex(model => model.id === id);
    const previous = index >= 0 ? current.models[index] : {};
    const reset = input.resetValidation === true || previous.endpoint !== endpoint || previous.name !== name || previous.credentialRef !== credentialRef;
    const row = {
      qualification: QUALIFICATION.untested,
      allowedTasks: [],
      blockedReason: '等待真实调用测试',
      createdAt: previous.createdAt || nowIso(),
      ...previous,
      id,
      provider,
      endpoint,
      name,
      modelName: clean(input.modelName || name),
      credentialRef,
      source: clean(input.source || previous.source || 'user-configured'),
      displayName: clean(input.displayName || previous.displayName || name),
      capabilities: unique(input.capabilities || previous.capabilities),
      taskHints: unique(input.taskHints || previous.taskHints),
      capabilityTags: unique(input.capabilityTags || previous.capabilityTags).map(value => value.toLowerCase()),
      catalogMetadata: { ...(previous.catalogMetadata || {}), ...(input.catalogMetadata || {}) },
      visionTestRequired: input.testVision === true || unique(input.capabilities).includes('vision'),
      available: input.available !== false,
      configured: true,
      updatedAt: nowIso(),
      ...(reset ? {
        qualification: QUALIFICATION.untested,
        allowedTasks: [],
        blockedReason: '等待真实调用测试',
        lastTest: null,
        testedAt: '',
        connectivityStatus: 'untested'
      } : {})
    };
    if (index >= 0) current.models[index] = row; else current.models.push(row);
    return current;
  });
}
function removeModel(modelId) {
  return update(current => { current.models = (current.models || []).filter(model => model.id !== modelId); return current; });
}
function setModelEnabled(modelId, enabled, options = {}) {
  return update(current => {
    const index = (current.models || []).findIndex(model => model.id === modelId);
    if (index < 0) throw Object.assign(new Error('MODEL_NOT_FOUND'), { code: 'MODEL_NOT_FOUND' });
    const timestamp = nowIso();
    current.models[index] = {
      ...current.models[index],
      userDisabled: enabled !== true,
      disabledAt: enabled === true ? '' : timestamp,
      disabledReason: enabled === true ? '' : clean(options.reason || '用户在 AI 工作台停用'),
      updatedAt: timestamp
    };
    return current;
  });
}
function recordInvocation(modelId, metrics = {}) {
  return update(current => {
    const index = (current.models || []).findIndex(model => model.id === modelId);
    if (index < 0) return current;
    const model = current.models[index];
    const timestamp = nowIso();
    const cost = Number(metrics.costUsd ?? metrics.cost ?? 0);
    current.models[index] = {
      ...model,
      lastUsedAt: timestamp,
      lastSuccessAt: timestamp,
      lastSuccessfulInvocation: {
        returnedModel: clean(metrics.returnedModel || metrics.model),
        providerRequestId: clean(metrics.providerRequestId || metrics.requestId),
        latencyMs: Number(metrics.latencyMs || metrics.totalMs || 0),
        promptTokens: Number(metrics.inputTokens || metrics.promptTokens || 0),
        outputTokens: Number(metrics.outputTokens || 0),
        totalTokens: Number(metrics.totalTokens || 0),
        costUsd: Number.isFinite(cost) ? cost : 0
      },
      callCount: Number(model.callCount || 0) + 1,
      totalCostUsd: Number((Number(model.totalCostUsd || 0) + (Number.isFinite(cost) ? cost : 0)).toFixed(12)),
      lastInvocationStatus: 'success',
      lastInvocationAt: timestamp,
      lastError: '',
      lastErrorCode: ''
    };
    return current;
  });
}
function recordInvocationFailure(modelId, error) {
  return update(current => {
    const index = (current.models || []).findIndex(model => model.id === modelId);
    if (index < 0) return current;
    const normalized = normalizeModelError(error);
    current.models[index] = {
      ...current.models[index],
      lastFailedAt: nowIso(),
      failureCount: Number(current.models[index].failureCount || 0) + 1,
      lastError: normalized.message,
      lastErrorCode: normalized.code,
      lastHttpStatus: normalized.status,
      lastInvocationStatus: 'failed',
      lastInvocationAt: nowIso()
    };
    return current;
  });
}
function recordTest(modelId, result = {}) {
  return update(current => {
    const index = (current.models || []).findIndex(model => model.id === modelId);
    if (index < 0) throw Object.assign(new Error('MODEL_NOT_FOUND'), { code: 'MODEL_NOT_FOUND' });
    const previous = current.models[index];
    const normalized = result.connectivity?.pass === true ? null : normalizeModelError(result.connectivity?.error || result, { fallbackMessage: result.blockedReason || '模型资格测试失败', fallbackCode: result.connectivity?.code || 'MODEL_QUALIFICATION_FAILED' });
    current.models[index] = {
      ...previous,
      qualification: result.qualification || previous.qualification || QUALIFICATION.untested,
      allowedTasks: unique(result.allowedTasks),
      blockedReason: clean(result.blockedReason),
      lastTest: result,
      testedAt: result.testedAt || nowIso(),
      available: previous.provider === 'ollama' ? (result.connectivity?.pass !== false && previous.available !== false) : true,
      configured: previous.provider === 'ollama' ? previous.available !== false : true,
      connectivityStatus: result.connectivity?.pass === true ? 'passed' : result.connectivity ? 'failed' : 'untested',
      lastQualificationTest: result,
      qualificationTestedAt: result.testedAt || nowIso(),
      qualificationError: normalized ? normalized.message : '',
      qualificationErrorCode: normalized ? normalized.code : '',
      qualificationHttpStatus: Number(result.connectivity?.status || result.connectivity?.httpStatus || 0)
    };
    pushHistory(current, { type: 'model-qualification', modelId, model: previous.name, qualification: result.qualification, allowedTasks: unique(result.allowedTasks), testedAt: result.testedAt || nowIso() });
    return current;
  });
}
function nextRoleReceipts(previous = {}, modelId, tasks = [], result = {}, governedTasks = roleReceiptAuthority.GOVERNED_TASKS) {
  const receipts = { ...(previous.roleQualificationReceipts || {}) };
  const qualifying = new Set(unique(tasks));
  if (result.completed === false) return receipts;
  for (const task of governedTasks) {
    try {
      receipts[task] = roleReceiptAuthority.issueFromEvidence({ modelId, task, score: Number(result.score || 0), issuedAt: result.testedAt, summary: result.summary, evidence: { ...result, qualifyingTasks: [...qualifying] } });
    } catch (_) { delete receipts[task]; }
  }
  return receipts;
}
function recordRoleQualificationReceipt(modelId, task, input = {}) {
  return update(current => {
    const index = (current.models || []).findIndex(model => model.id === modelId);
    if (index < 0) throw Object.assign(new Error('MODEL_NOT_FOUND'), { code: 'MODEL_NOT_FOUND' });
    const previous = current.models[index];
    const receipt = roleReceiptAuthority.issueFromEvidence({ ...input, modelId, task, evidence: input.evidence || input });
    current.models[index] = { ...previous, roleQualificationReceipts: { ...(previous.roleQualificationReceipts || {}), [task]: receipt }, updatedAt: nowIso() };
    pushHistory(current, { type: 'ai-role-qualification-receipt', modelId, model: previous.name, task, receiptId: receipt.receiptId, pass: receipt.pass, testedAt: receipt.issuedAt });
    return current;
  });
}
function recordReplyBrainBenchmark(modelId, result = {}) {
  return update(current => {
    const index = (current.models || []).findIndex(model => model.id === modelId);
    if (index < 0) throw Object.assign(new Error('MODEL_NOT_FOUND'), { code: 'MODEL_NOT_FOUND' });
    const previous = current.models[index];
    const timestamp = result.testedAt || nowIso();
    const allowed = new Set(unique(previous.allowedTasks));
    if (result.completed !== false) {
      for (const task of ['quick_reply', 'deep_reply', 'director', 'persona_rewrite']) allowed.delete(task);
      if (result.pass === true && previous.qualification === QUALIFICATION.verified) for (const task of unique(result.qualifyingTasks)) allowed.add(task);
    }
    current.models[index] = {
      ...previous,
      allowedTasks: [...allowed],
      lastReplyBrainBenchmark: result.completed === false ? previous.lastReplyBrainBenchmark : result,
      lastReplyBrainBenchmarkAttempt: result,
      lastSuccessfulReplyBrainBenchmark: result.pass === true ? result : previous.lastSuccessfulReplyBrainBenchmark,
      roleQualificationReceipts: nextRoleReceipts(previous, modelId, result.qualifyingTasks, result, ['quick_reply', 'deep_reply', 'director']),
      replyBrainBenchmarkStatus: clean(result.status || (result.pass === true ? 'REPLY_BRAIN_QUALIFIED' : 'REPLY_BRAIN_FAILED')),
      replyBrainBenchmarkScore: Number(result.score || 0),
      replyBrainBenchmarkTestedAt: timestamp,
      updatedAt: timestamp
    };
    pushHistory(current, { type: 'reply-brain-benchmark', modelId, model: previous.name, testedAt: timestamp, completed: result.completed !== false, pass: result.pass === true, status: result.status || '' });
    return current;
  });
}
function recordCommercialBenchmark(modelId, result = {}) {
  return update(current => {
    const index = (current.models || []).findIndex(model => model.id === modelId);
    if (index < 0) throw Object.assign(new Error('MODEL_NOT_FOUND'), { code: 'MODEL_NOT_FOUND' });
    const previous = current.models[index];
    const timestamp = result.testedAt || nowIso();
    const allowed = new Set(unique(previous.allowedTasks));
    if (result.completed !== false) {
      for (const task of ['translation', 'fact_extraction', 'understanding', 'summary', 'relationship']) allowed.delete(task);
      for (const task of unique(result.qualifyingTasks)) allowed.add(task);
    }
    current.models[index] = {
      ...previous,
      allowedTasks: [...allowed],
      lastCommercialBenchmark: result,
      commercialBenchmarkStatus: clean(result.status || (result.pass === true ? 'COMMERCIAL_MODEL_QUALIFIED' : 'COMMERCIAL_MODEL_FAILED')),
      commercialBenchmarkScore: Number(result.score || 0),
      commercialBenchmarkTestedAt: timestamp,
      roleQualificationReceipts: nextRoleReceipts(previous, modelId, result.qualifyingTasks, result, ['translation']),
      updatedAt: timestamp
    };
    pushHistory(current, { type: 'commercial-model-benchmark', modelId, model: previous.name, testedAt: timestamp, pass: result.pass === true, status: result.status || '' });
    return current;
  });
}
function recordOpenRouterOnboardingSmoke(modelId, result = {}) {
  return update(current => {
    const index = (current.models || []).findIndex(model => model.id === modelId);
    if (index < 0) throw Object.assign(new Error('MODEL_NOT_FOUND'), { code: 'MODEL_NOT_FOUND' });
    const previous = current.models[index];
    const timestamp = result.testedAt || nowIso();
    current.models[index] = {
      ...previous,
      capabilityTags: unique([...(previous.capabilityTags || []), ...(result.capabilityTags || [])]).map(value => value.toLowerCase()),
      openRouterOnboardingSmoke: { ...result, testedAt: timestamp },
      onboardingSmokeStatus: result.pass === true ? 'passed' : 'failed',
      onboardingSmokeTestedAt: timestamp,
      updatedAt: timestamp
    };
    pushHistory(current, { type: 'openrouter-onboarding-smoke', modelId, model: previous.name, testedAt: timestamp, pass: result.pass === true, requestId: clean(result.requestId) });
    return current;
  });
}
function recordOpenRouterSnapshot(snapshot = {}) {
  return update(current => {
    current.openRouter = { ...(current.openRouter || {}), ...snapshot, credentialRef: clean(snapshot.credentialRef || current.openRouter?.credentialRef), updatedAt: nowIso() };
    return current;
  });
}

function applyRecommendedUtilityRoutes() { return Promise.reject(routingManagedError()); }
function applyRecommendedReplyBrainRoutes() { return Promise.reject(routingManagedError()); }
function applyOpenRouterConditionalRoutes() { return Promise.reject(routingManagedError()); }
function setRoutes() { return Promise.reject(routingManagedError()); }
function validateRouteDraft() { throw routingManagedError(); }
function setRoute() { return Promise.reject(routingManagedError()); }
function repairRoutes() { return Promise.reject(routingManagedError()); }

module.exports = {
  read: readWithAuthorities,
  write: value => store.write(deauthorizedDocument(value)),
  mergeDiscovered,
  recordTest,
  recordReplyBrainBenchmark,
  recordCommercialBenchmark,
  recordRoleQualificationReceipt,
  applyRecommendedUtilityRoutes,
  applyRecommendedReplyBrainRoutes,
  setAiBudgetPolicy,
  setRoutes,
  validateRouteDraft,
  setRoute,
  upsertCloudModel,
  synchronizeOpenRouterCatalog,
  removeModel,
  setModelEnabled,
  recordInvocation,
  recordInvocationFailure,
  recordOpenRouterOnboardingSmoke,
  applyOpenRouterConditionalRoutes,
  recordOpenRouterSnapshot,
  repairRoutes
};
