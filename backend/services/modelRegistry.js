'use strict';

const { SqliteDocumentStore } = require('../lib/sqliteDocumentStore');
const { QUALIFICATION } = require('../../shared/constants');
const crypto = require('crypto');
const routingIntegrity = require('./modelRoutingIntegrityService');
const { normalizeModelError } = require('./modelErrorNormalizer');
const roleReceiptAuthority = require('./aiRoleQualificationReceiptAuthority');
const aiBudgetAuthority = require('./aiBudgetAuthority');

const store = new SqliteDocumentStore('model-registry', {
  schemaVersion: 1,
  scannedAt: '',
  endpoint: '',
  version: '',
  models: [],
  routes: {},
  history: [],
  aiBudgetPolicy: {
    totalBudgetUsd: aiBudgetAuthority.DEFAULT_POLICY.totalBudgetUsd,
    championReserveUsd: aiBudgetAuthority.DEFAULT_POLICY.championReserveUsd,
    backgroundPaidEnabled: aiBudgetAuthority.DEFAULT_POLICY.backgroundPaidEnabled,
    updatedAt: '',
    source: 'default'
  },
  aiBudgetUsage: {
    spentUsd: 0,
    periodStartedAt: ''
  }
});


function readWithAuthorities() {
  const current = store.read();
  const policy = aiBudgetAuthority.normalizePolicy(current.aiBudgetPolicy || {});
  const usage = aiBudgetAuthority.normalizeUsage(current.aiBudgetUsage || {});
  return {
    ...current,
    aiBudgetPolicy: {
      totalBudgetUsd: policy.totalBudgetUsd,
      championReserveUsd: policy.championReserveUsd,
      backgroundPaidEnabled: policy.backgroundPaidEnabled,
      updatedAt: String(current.aiBudgetPolicy?.updatedAt || ''),
      source: String(current.aiBudgetPolicy?.source || 'default')
    },
    aiBudgetUsage: {
      spentUsd: usage.spentUsd,
      periodStartedAt: String(current.aiBudgetUsage?.periodStartedAt || '')
    }
  };
}

async function setAiBudgetPolicy(input = {}) {
  const totalBudgetUsd = Number(input.totalBudgetUsd);
  const championReserveUsd = Number(input.championReserveUsd);
  const valid = Number.isFinite(totalBudgetUsd)
    && totalBudgetUsd >= 0
    && Number.isFinite(championReserveUsd)
    && championReserveUsd >= 0
    && championReserveUsd <= totalBudgetUsd
    && (input.backgroundPaidEnabled === undefined || typeof input.backgroundPaidEnabled === 'boolean');
  if (!valid) {
    const error = new Error('AI_BUDGET_POLICY_INVALID');
    error.code = 'AI_BUDGET_POLICY_INVALID';
    error.status = 400;
    throw error;
  }
  return store.updateAsync(current => {
    const usage = aiBudgetAuthority.normalizeUsage(current.aiBudgetUsage || {});
    current.aiBudgetPolicy = {
      totalBudgetUsd,
      championReserveUsd,
      backgroundPaidEnabled: input.backgroundPaidEnabled !== false,
      updatedAt: new Date().toISOString(),
      source: 'user-configured'
    };
    current.aiBudgetUsage = {
      spentUsd: usage.spentUsd,
      periodStartedAt: String(current.aiBudgetUsage?.periodStartedAt || '')
    };
    return current;
  }).then(() => readWithAuthorities());
}

function cleanCircuitDate(value) {
  const text = String(value || '').trim();
  return Number.isFinite(Date.parse(text)) ? text : '';
}

function mergeDiscovered(discovery) {
  return store.updateAsync(current => {
    const byId = new Map((current.models || []).map(model => [model.id, model]));
    const discoveredIds = new Set();
    for (const model of discovery.models || []) {
      discoveredIds.add(model.id);
      const existing = byId.get(model.id) || {};
      byId.set(model.id, {
        qualification: QUALIFICATION.untested,
        allowedTasks: [],
        blockedReason: '',
        lastTest: null,
        ...existing,
        ...model,
        available: true,
        missingSince: ''
      });
    }
    for (const [id, model] of byId) {
      if (!discoveredIds.has(id) && model.provider === 'ollama') {
        byId.set(id, { ...model, available: false, missingSince: model.missingSince || new Date().toISOString() });
      }
    }
    current.models = [...byId.values()].sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
    current.scannedAt = discovery.scannedAt;
    current.endpoint = discovery.endpoint;
    current.version = discovery.version;
    current.ollamaOnline = discovery.online;
    current.scanError = discovery.error || '';
    return routingIntegrity.repairRegistryDocument(current, { autoSelectVerified: true, rebalanceAutoRoutes: true }).document;
  });
}


function cloudModelId(provider, endpoint, name) {
  return `cloud-${crypto.createHash('sha1').update([provider, endpoint, name].join('|')).digest('hex').slice(0, 18)}`;
}

function synchronizeOpenRouterCatalog(input = {}) {
  const endpoint = String(input.endpoint || '').trim().replace(/\/+$/, '');
  const credentialRef = String(input.credentialRef || '').trim();
  const catalogModels = Array.isArray(input.models) ? input.models : [];
  const byName = new Map(catalogModels
    .map(row => [String(row?.name || row?.id || '').trim(), row])
    .filter(([name]) => Boolean(name)));
  if (!endpoint || !credentialRef) throw Object.assign(new Error('OPENROUTER_CATALOG_SCOPE_REQUIRED'), { code: 'OPENROUTER_CATALOG_SCOPE_REQUIRED' });
  return store.updateAsync(current => {
    const now = new Date().toISOString();
    current.models = (current.models || []).map(model => {
      if (model.source !== 'openrouter-auto' || String(model.endpoint || '').replace(/\/+$/, '') !== endpoint || model.credentialRef !== credentialRef) return model;
      const catalog = byName.get(String(model.name || '').trim());
      if (!catalog) {
        return {
          ...model,
          available: false,
          catalogAvailable: false,
          catalogMissingSince: model.catalogMissingSince || now,
          catalogPreviousBlockedReason: model.catalogMissingSince ? model.catalogPreviousBlockedReason : String(model.blockedReason || ''),
          blockedReason: 'OpenRouter当前账号模型目录已不再返回该模型',
          updatedAt: now
        };
      }
      const catalogMetadata = catalog.catalogMetadata && typeof catalog.catalogMetadata === 'object' ? catalog.catalogMetadata : {};
      return {
        ...model,
        displayName: String(catalog.displayName || model.displayName || model.name).trim(),
        capabilities: Array.isArray(catalog.capabilities) ? [...new Set(catalog.capabilities)] : model.capabilities,
        catalogMetadata: { ...(model.catalogMetadata || {}), ...catalogMetadata },
        available: true,
        catalogAvailable: true,
        catalogSeenAt: now,
        catalogMissingSince: '',
        blockedReason: model.catalogMissingSince ? String(model.catalogPreviousBlockedReason || '') : model.blockedReason,
        catalogPreviousBlockedReason: '',
        updatedAt: now
      };
    });
    current.openRouterCatalogSynchronizedAt = now;
    return routingIntegrity.repairRegistryDocument(current, { autoSelectVerified: true, rebalanceAutoRoutes: true }).document;
  });
}

function upsertCloudModel(input = {}) {
  const provider = String(input.provider || 'openai-compatible').toLowerCase();
  const endpoint = String(input.endpoint || '').trim().replace(/\/+$/, '');
  const name = String(input.name || input.model || '').trim();
  const credentialRef = String(input.credentialRef || '').trim();
  if (!endpoint || !name || !credentialRef) throw new Error('INVALID_CLOUD_MODEL');
  return store.updateAsync(current => {
    const id = String(input.id || cloudModelId(provider, endpoint, name));
    const index = (current.models || []).findIndex(model => model.id === id);
    const previous = index >= 0 ? current.models[index] : {};
    const resetValidation = input.resetValidation === true || previous.endpoint !== endpoint || previous.name !== name || previous.credentialRef !== credentialRef;
    const row = {
      qualification: QUALIFICATION.untested,
      allowedTasks: [],
      blockedReason: '等待真实调用测试',
      available: true,
      configured: true,
      createdAt: previous.createdAt || new Date().toISOString(),
      ...previous,
      id, provider, endpoint, name, credentialRef,
      source: input.source || previous.source || 'user-configured',
      displayName: String(input.displayName || previous.displayName || name).trim(),
      capabilities: Array.isArray(input.capabilities)
        ? [...new Set(input.capabilities.map(value => String(value || '').trim()).filter(Boolean))]
        : input.testVision === true
          ? [...new Set([...(Array.isArray(previous.capabilities) ? previous.capabilities : []), 'vision'])]
          : (Array.isArray(previous.capabilities) ? previous.capabilities.filter(value => value !== 'vision') : []),
      taskHints: Array.isArray(input.taskHints)
        ? [...new Set(input.taskHints.map(value => String(value || '').trim()).filter(Boolean))]
        : (Array.isArray(previous.taskHints) ? previous.taskHints : []),
      capabilityTags: Array.isArray(input.capabilityTags)
        ? [...new Set(input.capabilityTags.map(value => String(value || '').trim().toLowerCase()).filter(Boolean))]
        : (Array.isArray(previous.capabilityTags) ? previous.capabilityTags : []),
      catalogMetadata: input.catalogMetadata && typeof input.catalogMetadata === 'object'
        ? { ...(previous.catalogMetadata || {}), ...input.catalogMetadata }
        : (previous.catalogMetadata || {}),
      visionTestRequired: input.testVision === true || (Array.isArray(input.capabilities) && input.capabilities.includes('vision')),
      available: input.available !== false,
      configured: true,
      ...(resetValidation ? { qualification: QUALIFICATION.untested, allowedTasks: [], blockedReason: '等待真实调用测试', lastTest: null, testedAt: '', lastError: '', lastFailedAt: '', connectivityStatus: 'untested', lastReplyBrainBenchmark: null, lastReplyBrainBenchmarkAttempt: null, lastSuccessfulReplyBrainBenchmark: null, replyBrainBenchmarkStatus: '', replyBrainBenchmarkScore: 0, replyBrainBenchmarkTestedAt: '', replyBrainBenchmarkAttemptStatus: '', replyBrainBenchmarkAttemptScore: 0, replyBrainBenchmarkAttemptTestedAt: '', lastCommercialBenchmark: null, commercialBenchmarkStatus: '', commercialBenchmarkScore: 0, commercialBenchmarkTestedAt: '' } : {}),
      updatedAt: new Date().toISOString()
    };
    if (index >= 0) current.models[index] = row; else current.models.push(row);
    return current;
  });
}

function removeModel(modelId) {
  return store.updateAsync(current => {
    current.models = (current.models || []).filter(model => model.id !== modelId);
    for (const [task, route] of Object.entries(current.routes || {})) {
      if (route?.primary === modelId || route?.fallback === modelId) {
        current.routes[task] = {
          ...route,
          primary: route?.primary === modelId ? '' : route?.primary || '',
          fallback: route?.fallback === modelId ? '' : route?.fallback || ''
        };
      }
    }
    return current;
  });
}


function setModelEnabled(modelId, enabled, options = {}) {
  return store.updateAsync(current => {
    const index = (current.models || []).findIndex(model => model.id === modelId);
    if (index < 0) {
      const error = new Error('MODEL_NOT_FOUND');
      error.code = 'MODEL_NOT_FOUND';
      throw error;
    }
    const now = new Date().toISOString();
    current.models[index] = {
      ...current.models[index],
      userDisabled: enabled !== true,
      disabledAt: enabled === true ? '' : now,
      disabledReason: enabled === true ? '' : String(options.reason || '用户在 AI 工作台停用'),
      updatedAt: now
    };
    if (enabled !== true) {
      for (const [task, route] of Object.entries(current.routes || {})) {
        if (route?.primary === modelId || route?.fallback === modelId) {
          current.routes[task] = {
            ...route,
            primary: route?.primary === modelId ? '' : route?.primary || '',
            fallback: route?.fallback === modelId ? '' : route?.fallback || '',
            source: 'model-disabled',
            updatedAt: now
          };
        }
      }
    }
    return routingIntegrity.repairRegistryDocument(current, { autoSelectVerified: enabled === true, rebalanceAutoRoutes: enabled === true }).document;
  });
}

function recordInvocation(modelId, metrics = {}) {
  return store.updateAsync(current => {
    const index = (current.models || []).findIndex(model => model.id === modelId);
    if (index < 0) return current;
    const model = current.models[index];
    const succeededAt = new Date().toISOString();
    const success = {
      at: succeededAt,
      latencyMs: Number(metrics.totalMs || 0),
      promptTokens: Number(metrics.promptTokens || 0),
      outputTokens: Number(metrics.outputTokens || 0),
      totalTokens: Number(metrics.totalTokens || 0),
      returnedModel: String(metrics.returnedModel || metrics.raw?.model || '')
    };
    const pricing = model.catalogMetadata?.pricing || {};
    const reportedCost = metrics.costUsd === '' || metrics.costUsd == null || !Number.isFinite(Number(metrics.costUsd)) ? null : Number(metrics.costUsd);
    const promptPrice = pricing.promptPerMillion === '' || pricing.promptPerMillion == null || !Number.isFinite(Number(pricing.promptPerMillion)) ? null : Number(pricing.promptPerMillion);
    const completionPrice = pricing.completionPerMillion === '' || pricing.completionPerMillion == null || !Number.isFinite(Number(pricing.completionPerMillion)) ? null : Number(pricing.completionPerMillion);
    const requestPrice = pricing.request === '' || pricing.request == null || !Number.isFinite(Number(pricing.request)) ? 0 : Number(pricing.request);
    const estimatedCost = pricing.known !== false && promptPrice != null && completionPrice != null
      ? Number(((success.promptTokens / 1_000_000 * promptPrice) + (success.outputTokens / 1_000_000 * completionPrice) + requestPrice).toFixed(12))
      : null;
    const invocationCost = reportedCost != null ? reportedCost : estimatedCost;
    const costSource = reportedCost != null ? 'provider-usage' : estimatedCost != null ? 'catalog-estimate' : 'unknown';
    if (invocationCost != null && invocationCost > 0 && String(model.provider || '').toLowerCase() !== 'ollama') {
      const usage = aiBudgetAuthority.normalizeUsage(current.aiBudgetUsage || {});
      current.aiBudgetUsage = {
        spentUsd: Number((usage.spentUsd + invocationCost).toFixed(12)),
        periodStartedAt: String(current.aiBudgetUsage?.periodStartedAt || succeededAt)
      };
    }
    current.models[index] = {
      ...model,
      lastUsedAt: succeededAt,
      lastSuccessAt: succeededAt,
      lastSuccessfulInvocation: success,
      lastLatencyMs: success.latencyMs,
      lastPromptTokens: success.promptTokens,
      lastOutputTokens: success.outputTokens,
      lastTotalTokens: success.totalTokens,
      lastReturnedModel: success.returnedModel,
      lastCostUsd: invocationCost,
      lastCostSource: costSource,
      totalCostUsd: invocationCost == null ? Number(model.totalCostUsd || 0) : Number((Number(model.totalCostUsd || 0) + invocationCost).toFixed(12)),
      costTrackedCallCount: invocationCost == null ? Number(model.costTrackedCallCount || 0) : Number(model.costTrackedCallCount || 0) + 1,
      callCount: Number(model.callCount || 0) + 1,
      lastError: '',
      lastErrorCode: '',
      lastHttpStatus: 0,
      lastAttemptStatus: 'success',
      lastInvocationStatus: 'success',
      lastInvocationAt: succeededAt,
      lastInvocationError: '',
      lastInvocationErrorCode: '',
      lastInvocationHttpStatus: 0,
      consecutiveFailureCount: 0,
      circuitOpenedAt: '',
      circuitOpenedUntil: ''
    };
    return current;
  });
}

function recordInvocationFailure(modelId, error, options = {}) {
  return store.updateAsync(current => {
    const index = (current.models || []).findIndex(model => model.id === modelId);
    if (index < 0) return current;
    const model = current.models[index];
    const normalized = normalizeModelError(error);
    const now = new Date();
    const countForCircuit = options.countForCircuit === true;
    const consecutiveFailureCount = countForCircuit ? Number(model.consecutiveFailureCount || 0) + 1 : Number(model.consecutiveFailureCount || 0);
    const requestedCooldownUntil = cleanCircuitDate(options.cooldownUntil);
    const requestedCooldownMs = Date.parse(requestedCooldownUntil);
    const cooldownRequested = Number.isFinite(requestedCooldownMs) && requestedCooldownMs > now.getTime();
    const thresholdOpenedUntilMs = countForCircuit && consecutiveFailureCount >= 3 ? now.getTime() + 5 * 60 * 1000 : 0;
    const shouldOpenCircuit = thresholdOpenedUntilMs > 0 || cooldownRequested;
    const openedUntilMs = Math.max(thresholdOpenedUntilMs, cooldownRequested ? requestedCooldownMs : 0);
    const circuitOpenedAt = shouldOpenCircuit ? now.toISOString() : cleanCircuitDate(model.circuitOpenedAt);
    const circuitOpenedUntil = shouldOpenCircuit ? new Date(openedUntilMs).toISOString() : cleanCircuitDate(model.circuitOpenedUntil);
    current.models[index] = {
      ...model,
      lastFailedAt: now.toISOString(),
      failureCount: Number(model.failureCount || 0) + 1,
      lastError: normalized.message,
      lastErrorCode: normalized.code,
      lastHttpStatus: normalized.status,
      lastAttemptStatus: 'failed',
      lastInvocationStatus: 'failed',
      lastInvocationAt: new Date().toISOString(),
      lastInvocationError: normalized.message,
      lastInvocationErrorCode: normalized.code,
      lastInvocationHttpStatus: normalized.status,
      consecutiveFailureCount,
      circuitOpenedAt,
      circuitOpenedUntil
    };
    return current;
  });
}

function recordTest(modelId, result) {
  return store.updateAsync(current => {
    const index = current.models.findIndex(model => model.id === modelId);
    if (index < 0) throw new Error('MODEL_NOT_FOUND');
    const previous = current.models[index];
    const allowedTasks = Array.isArray(result.allowedTasks) ? result.allowedTasks : [];
    current.models[index] = {
      ...previous,
      qualification: result.qualification,
      allowedTasks,
      blockedReason: result.blockedReason || '',
      lastTest: result,
      testedAt: result.testedAt,
      available: previous.provider === 'ollama' ? (result.connectivity?.pass !== false && previous.available !== false) : true,
      configured: previous.provider === 'ollama' ? previous.available !== false : true,
      connectivityStatus: result.connectivity?.pass === true ? 'passed' : result.connectivity ? 'failed' : 'untested',
      lastQualificationTest: result,
      qualificationTestedAt: result.testedAt || new Date().toISOString(),
      lastQualificationAttemptStatus: result.connectivity?.pass === true ? 'success' : result.connectivity ? 'failed' : 'never',
      qualificationError: result.connectivity?.pass === true ? '' : normalizeModelError(result.connectivity?.error || result, { fallbackMessage: result.blockedReason || '模型资格测试失败', fallbackCode: result.connectivity?.code || 'MODEL_QUALIFICATION_FAILED' }).message,
      qualificationErrorCode: result.connectivity?.pass === true ? '' : normalizeModelError(result.connectivity || result, { fallbackCode: 'MODEL_QUALIFICATION_FAILED' }).code,
      qualificationHttpStatus: Number(result.connectivity?.status || result.connectivity?.httpStatus || 0)
    };
    current.routes = current.routes && typeof current.routes === 'object' ? current.routes : {};
    if (['verified', 'experimental'].includes(String(result.qualification || ''))) {
      for (const task of allowedTasks) {
        const route = current.routes[task] && typeof current.routes[task] === 'object' ? current.routes[task] : {};
        if (!route.primary) {
          current.routes[task] = {
            ...route,
            primary: modelId,
            fallback: route.fallback || '',
            allowExperimental: result.qualification === 'experimental',
            updatedAt: new Date().toISOString(),
            source: 'qualification-auto-route'
          };
        }
      }
    }
    current.history.unshift({ modelId, model: previous.name, ...result });
    current.history = current.history.slice(0, 500);
    return routingIntegrity.repairRegistryDocument(current, { autoSelectVerified: true, rebalanceAutoRoutes: true }).document;
  });
}

function nextRoleReceipts(previous = {}, modelId, tasks = [], result = {}, options = {}) {
  const receipts = { ...(previous.roleQualificationReceipts && typeof previous.roleQualificationReceipts === 'object' ? previous.roleQualificationReceipts : {}) };
  const governed = new Set(options.governedTasks || roleReceiptAuthority.GOVERNED_TASKS);
  const qualifying = new Set(Array.isArray(tasks) ? tasks : []);
  if (result.completed === false) return receipts;
  for (const task of governed) {
    const evidence = { ...result, qualifyingTasks: [...qualifying] };
    try {
      receipts[task] = roleReceiptAuthority.issueFromEvidence({
        modelId,
        task,
        score: Number(result.score || 0),
        issuedAt: result.testedAt,
        summary: result.summary,
        evidence
      });
    } catch (_) {
      delete receipts[task];
    }
  }
  return receipts;
}

function recordRoleQualificationReceipt(modelId, task, input = {}) {
  return store.updateAsync(current => {
    const index = (current.models || []).findIndex(model => model.id === modelId);
    if (index < 0) throw Object.assign(new Error('MODEL_NOT_FOUND'), { code: 'MODEL_NOT_FOUND' });
    const previous = current.models[index];
    const evidence = input.evidence && typeof input.evidence === 'object' ? input.evidence : input;
    const receipt = roleReceiptAuthority.issueFromEvidence({ ...input, modelId, task, evidence });
    current.models[index] = {
      ...previous,
      roleQualificationReceipts: { ...(previous.roleQualificationReceipts || {}), [task]: receipt },
      updatedAt: new Date().toISOString()
    };
    current.history = Array.isArray(current.history) ? current.history : [];
    current.history.unshift({ type: 'ai-role-qualification-receipt', modelId, model: previous.name, task, receiptId: receipt.receiptId, pass: receipt.pass, score: receipt.score, testedAt: receipt.issuedAt });
    current.history = current.history.slice(0, 500);
    return routingIntegrity.repairRegistryDocument(current, { autoSelectVerified: true, rebalanceAutoRoutes: true }).document;
  });
}

function recordReplyBrainBenchmark(modelId, result = {}) {
  return store.updateAsync(current => {
    const index = (current.models || []).findIndex(model => model.id === modelId);
    if (index < 0) {
      const error = new Error('MODEL_NOT_FOUND');
      error.code = 'MODEL_NOT_FOUND';
      throw error;
    }
    const previous = current.models[index];
    const now = String(result.testedAt || new Date().toISOString());
    const replyTasks = new Set(['quick_reply', 'deep_reply', 'director', 'persona_rewrite']);
    const allowed = new Set(Array.isArray(previous.allowedTasks) ? previous.allowedTasks : []);
    const incomplete = result.completed === false || String(result.status || '') === 'REPLY_BRAIN_INCOMPLETE';
    const previousSuccessful = previous.lastSuccessfulReplyBrainBenchmark
      || (previous.lastReplyBrainBenchmark?.pass === true ? previous.lastReplyBrainBenchmark : null);

    if (incomplete) {
      current.models[index] = {
        ...previous,
        allowedTasks: [...allowed],
        lastReplyBrainBenchmarkAttempt: result,
        replyBrainBenchmarkAttemptStatus: String(result.status || 'REPLY_BRAIN_INCOMPLETE'),
        replyBrainBenchmarkAttemptScore: Number(result.score || 0),
        replyBrainBenchmarkAttemptTestedAt: now,
        replyBrainBenchmarkAttemptFailure: String(result.summary || result.recommendation || '本次回复大脑评估未完成'),
        lastSuccessfulReplyBrainBenchmark: previousSuccessful,
        updatedAt: now
      };
    } else {
      if (result.pass === true && previous.qualification === 'verified') {
        for (const task of Array.isArray(result.qualifyingTasks) ? result.qualifyingTasks : []) allowed.add(task);
      } else {
        for (const task of replyTasks) allowed.delete(task);
      }
      current.models[index] = {
        ...previous,
        allowedTasks: [...allowed],
        lastReplyBrainBenchmark: result,
        lastReplyBrainBenchmarkAttempt: result,
        lastSuccessfulReplyBrainBenchmark: result.pass === true ? result : previousSuccessful,
        roleQualificationReceipts: nextRoleReceipts(previous, modelId, Array.isArray(result.qualifyingTasks) ? result.qualifyingTasks : [], result, { governedTasks: ['quick_reply', 'deep_reply', 'director'] }),
        replyBrainBenchmarkStatus: String(result.status || (result.pass === true ? 'REPLY_BRAIN_QUALIFIED' : 'REPLY_BRAIN_FAILED')),
        replyBrainBenchmarkScore: Number(result.score || 0),
        replyBrainBenchmarkTestedAt: now,
        replyBrainBenchmarkFailure: result.pass === true ? '' : String(result.summary || result.recommendation || '回复大脑基准未通过'),
        replyBrainBenchmarkAttemptStatus: String(result.status || ''),
        replyBrainBenchmarkAttemptScore: Number(result.score || 0),
        replyBrainBenchmarkAttemptTestedAt: now,
        replyBrainBenchmarkAttemptFailure: result.pass === true ? '' : String(result.summary || result.recommendation || ''),
        updatedAt: now
      };
    }
    current.history = Array.isArray(current.history) ? current.history : [];
    current.history.unshift({
      type: 'reply-brain-benchmark',
      modelId,
      model: previous.name,
      testedAt: now,
      completed: !incomplete,
      pass: result.pass === true,
      score: Number(result.score || 0),
      status: result.status || '',
      summary: result.summary || ''
    });
    current.history = current.history.slice(0, 500);
    return routingIntegrity.repairRegistryDocument(current, { autoSelectVerified: true, rebalanceAutoRoutes: true }).document;
  });
}

function recordCommercialBenchmark(modelId, result = {}) {
  return store.updateAsync(current => {
    const index = (current.models || []).findIndex(model => model.id === modelId);
    if (index < 0) {
      const error = new Error('MODEL_NOT_FOUND');
      error.code = 'MODEL_NOT_FOUND';
      throw error;
    }
    const previous = current.models[index];
    const now = String(result.testedAt || new Date().toISOString());
    const governedTasks = new Set(['translation', 'fact_extraction', 'understanding', 'summary', 'relationship']);
    const allowed = new Set(Array.isArray(previous.allowedTasks) ? previous.allowedTasks : []);
    if (result.completed !== false) {
      const qualifying = new Set(Array.isArray(result.qualifyingTasks) ? result.qualifyingTasks : []);
      for (const task of governedTasks) {
        if (qualifying.has(task)) allowed.add(task);
        else allowed.delete(task);
      }
    }
    const technicalPass = previous.lastTest?.connectivity?.pass === true || previous.connectivityStatus === 'passed' || Number(previous.callCount || 0) > 0;
    const nextQualification = previous.qualification === 'verified'
      ? 'verified'
      : technicalPass && allowed.size
        ? 'experimental'
        : previous.qualification;
    current.models[index] = {
      ...previous,
      qualification: nextQualification,
      allowedTasks: [...allowed],
      lastCommercialBenchmark: result,
      roleQualificationReceipts: nextRoleReceipts(previous, modelId, Array.isArray(result.qualifyingTasks) ? result.qualifyingTasks : [], result, { governedTasks: ['translation'] }),
      commercialBenchmarkStatus: String(result.status || (result.pass === true ? 'COMMERCIAL_MODEL_QUALIFIED' : 'COMMERCIAL_MODEL_FAILED')),
      commercialBenchmarkScore: Number(result.score || 0),
      commercialTranslationScore: Number(result.translationScore || 0),
      commercialEvidenceScore: Number(result.evidenceScore || 0),
      commercialBenchmarkTestedAt: now,
      commercialBenchmarkFailure: result.pass === true ? '' : String(result.summary || '商业模型专项未通过'),
      updatedAt: now
    };
    current.history = Array.isArray(current.history) ? current.history : [];
    current.history.unshift({
      type: 'commercial-model-benchmark', modelId, model: previous.name, testedAt: now,
      completed: result.completed !== false, pass: result.pass === true, score: Number(result.score || 0),
      translationScore: Number(result.translationScore || 0), evidenceScore: Number(result.evidenceScore || 0),
      status: result.status || '', summary: result.summary || ''
    });
    current.history = current.history.slice(0, 500);
    return routingIntegrity.repairRegistryDocument(current, { autoSelectVerified: true, rebalanceAutoRoutes: true }).document;
  });
}

function applyRecommendedUtilityRoutes(routes = {}) {
  return store.updateAsync(current => {
    const now = new Date().toISOString();
    current.routes = current.routes && typeof current.routes === 'object' ? current.routes : {};
    for (const task of ['translation', 'fact_extraction', 'understanding', 'summary', 'relationship']) {
      const route = routes[task] && typeof routes[task] === 'object' ? routes[task] : {};
      current.routes[task] = {
        ...(current.routes[task] || {}),
        ...route,
        source: route.source || 'commercial-model-benchmark-auto',
        updatedAt: now
      };
    }
    current.commercialUtilityRoutesAppliedAt = now;
    return routingIntegrity.repairRegistryDocument(current, { autoSelectVerified: true, rebalanceAutoRoutes: true }).document;
  });
}

function applyRecommendedReplyBrainRoutes(routes = {}) {
  return store.updateAsync(current => {
    const now = new Date().toISOString();
    current.routes = current.routes && typeof current.routes === 'object' ? current.routes : {};
    for (const task of ['quick_reply', 'deep_reply', 'director']) {
      const route = routes[task] && typeof routes[task] === 'object' ? routes[task] : {};
      current.routes[task] = {
        ...(current.routes[task] || {}),
        ...route,
        source: 'reply-brain-benchmark-auto',
        updatedAt: now
      };
    }
    current.replyBrainRoutesAppliedAt = now;
    return routingIntegrity.repairRegistryDocument(current, { autoSelectVerified: true, rebalanceAutoRoutes: true }).document;
  });
}



function recordOpenRouterOnboardingSmoke(modelId, result = {}) {
  return store.updateAsync(current => {
    const index = (current.models || []).findIndex(model => model.id === modelId);
    if (index < 0) {
      const error = new Error('MODEL_NOT_FOUND');
      error.code = 'MODEL_NOT_FOUND';
      throw error;
    }
    const previous = current.models[index];
    const now = String(result.testedAt || new Date().toISOString());
    const capabilityTags = [...new Set([
      ...(Array.isArray(previous.capabilityTags) ? previous.capabilityTags : []),
      ...(Array.isArray(result.capabilityTags) ? result.capabilityTags : [])
    ].map(value => String(value || '').trim().toLowerCase()).filter(Boolean))];
    current.models[index] = {
      ...previous,
      capabilityTags,
      openRouterOnboardingSmoke: { ...result, testedAt: now },
      onboardingSmokeStatus: result.pass === true ? 'passed' : 'failed',
      onboardingSmokeTestedAt: now,
      onboardingSmokeFailure: result.pass === true ? '' : String(result.message || result.error || 'OpenRouter 最小真实调用未通过'),
      updatedAt: now
    };
    current.history = Array.isArray(current.history) ? current.history : [];
    current.history.unshift({
      type: 'openrouter-onboarding-smoke', modelId, model: previous.name, testedAt: now,
      pass: result.pass === true, requestId: String(result.requestId || ''), returnedModel: String(result.returnedModel || ''),
      message: String(result.message || '')
    });
    current.history = current.history.slice(0, 500);
    return current;
  });
}

function applyOpenRouterConditionalRoutes(routeInput = {}) {
  return store.updateAsync(current => {
    const now = new Date().toISOString();
    current.routes = current.routes && typeof current.routes === 'object' ? current.routes : {};
    for (const [task, configured] of Object.entries(routeInput || {})) {
      if (!configured || typeof configured !== 'object') continue;
      current.routes[task] = {
        ...(current.routes[task] || {}),
        ...configured,
        primarySelection: 'manual',
        fallbackSelection: 'manual',
        requestedPrimary: String(configured.primary || ''),
        requestedFallback: String(configured.fallback || ''),
        requestedEnabled: configured.enabled !== false,
        enabled: configured.enabled !== false,
        operational: configured.enabled !== false && Boolean(configured.primary),
        allowExperimental: configured.allowExperimental !== false,
        allowConditional: configured.allowConditional !== false,
        humanReviewRequired: configured.humanReviewRequired !== false,
        source: 'openrouter-onboarding-smoke-conditional',
        qualityPolicyVersion: 'ai-quality-cloud-first-v2',
        updatedAt: now
      };
    }
    current.openRouterConditionalRoutesAppliedAt = now;
    return routingIntegrity.repairRegistryDocument(current, { autoSelectVerified: false, rebalanceAutoRoutes: false }).document;
  });
}

function recordOpenRouterSnapshot(snapshot = {}) {
  return store.updateAsync(current => {
    current.openRouter = {
      ...(current.openRouter && typeof current.openRouter === 'object' ? current.openRouter : {}),
      ...snapshot,
      credentialRef: String(snapshot.credentialRef || current.openRouter?.credentialRef || ''),
      updatedAt: new Date().toISOString()
    };
    return current;
  });
}

function setRoutes(routes, options = {}) {
  return store.updateAsync(current => {
    const validation = routingIntegrity.validateRoutes(routes, current.models || [], { throwOnInvalid: options.throwOnInvalid !== false, autoSelect: options.autoSelect !== false });
    current.routes = Object.fromEntries(Object.entries(validation.repairedRoutes).map(([task, route]) => [task, {
      ...route,
      source: 'user-configured',
      updatedAt: new Date().toISOString()
    }]));
    current.routeQuarantine = validation.quarantine;
    current.schemaVersion = Math.max(2, Number(current.schemaVersion || 0));
    current.routesUpdatedAt = new Date().toISOString();
    return current;
  });
}

function validateRouteDraft(task, route, options = {}) {
  const target = routingIntegrity.normalizedTask(task);
  if (!target) throw Object.assign(new Error('MODEL_ROUTE_TASK_REQUIRED'), { code: 'MODEL_ROUTE_TASK_REQUIRED', status: 400 });
  const current = store.read();
  const validation = routingIntegrity.validateRoutes({ [target]: route || {} }, current.models || [], {
    throwOnInvalid: options.throwOnInvalid !== false,
    autoSelect: options.autoSelect !== false
  });
  const resolved = validation.repairedRoutes[target];
  if (!resolved) throw Object.assign(new Error('MODEL_ROUTE_DRAFT_UNRESOLVED'), { code: 'MODEL_ROUTE_DRAFT_UNRESOLVED', status: 400, task: target });
  return {
    ...resolved,
    source: String(options.source || 'user-route-draft'),
    updatedAt: new Date().toISOString()
  };
}

function setRoute(task, route, options = {}) {
  const target = routingIntegrity.normalizedTask(task);
  if (!target) return Promise.reject(Object.assign(new Error('MODEL_ROUTE_TASK_REQUIRED'), { code: 'MODEL_ROUTE_TASK_REQUIRED', status: 400 }));
  return store.updateAsync(current => {
    const validation = routingIntegrity.validateRoutes({ [target]: route || {} }, current.models || [], {
      throwOnInvalid: options.throwOnInvalid !== false,
      autoSelect: options.autoSelect !== false
    });
    const resolved = validation.repairedRoutes[target];
    if (!resolved) throw Object.assign(new Error('MODEL_ROUTE_DRAFT_UNRESOLVED'), { code: 'MODEL_ROUTE_DRAFT_UNRESOLVED', status: 400, task: target });
    const now = new Date().toISOString();
    current.routes = current.routes && typeof current.routes === 'object' ? { ...current.routes } : {};
    current.routes[target] = {
      ...resolved,
      source: String(options.source || 'user-configured-single-task'),
      updatedAt: now
    };
    const existingQuarantine = Array.isArray(current.routeQuarantine) ? current.routeQuarantine : [];
    current.routeQuarantine = [
      ...existingQuarantine.filter(row => routingIntegrity.normalizedTask(row?.task) !== target),
      ...validation.quarantine.filter(row => routingIntegrity.normalizedTask(row?.task) === target)
    ];
    current.schemaVersion = Math.max(3, Number(current.schemaVersion || 0));
    current.routesUpdatedAt = now;
    current.lastRouteUpdatedTask = target;
    return current;
  });
}

function repairRoutes(options = {}) {
  return store.updateAsync(current => routingIntegrity.repairRegistryDocument(current, { autoSelectVerified: options.autoSelectVerified !== false, rebalanceAutoRoutes: options.rebalanceAutoRoutes !== false }).document);
}

module.exports = {
  read: () => readWithAuthorities(),
  write: value => store.write(value),
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
