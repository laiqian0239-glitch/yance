'use strict';

const { randomUUID } = require('crypto');
const registry = require('./modelRegistry');
const { startModelExecution } = require('./modelExecutionHost');
const { normalizeModelResult } = require('./modelResultNormalizer');
const eventBus = require('./eventBus');
const logger = require('./logger');
const { JobQueue } = require('./jobQueue');
const { TASKS, QUALIFICATION } = require('../../shared/constants');
const { normalizedTask, eligibleForTask, cleanModelId, normalizeRoute } = require('./modelRoutingIntegrityService');
const { normalizeModelError, createAllModelsFailedError } = require('./modelErrorNormalizer');
const taskRuntimePolicy = require('./modelTaskRuntimePolicy');
const aiQualityRouteAuthority = require('./aiQualityRouteAuthority');
const aiContextReductionPolicy = require('./aiContextReductionPolicy');
const workloadPlacementAuthority = require('./aiWorkloadPlacementAuthority');
const aiBudgetAuthority = require('./aiBudgetAuthority');
const executionModeAuthority = require('./aiExecutionModeAuthority');
const aiExecutionTraceAuthority = require('./aiExecutionTraceAuthority');
const taskRoutingAuthority = require('./modelServiceTaskRoutingAuthority');
const providerDomainAuthority = require('./modelProviderFailureDomainAuthority');

function taskPriority(task, options = {}) {
  if (Number.isFinite(Number(options.priority))) return Number(options.priority);
  const value = normalizedTask(task);
  if (['quick_reply', 'deep_reply', 'director'].includes(value)) return 100;
  if (value === 'translation') return options.background === true ? 35 : 70;
  return options.background === true ? 20 : 55;
}

const TASK_QUEUE_TIMEOUT_FLOORS = Object.freeze({
  quick_reply: 180000,
  deep_reply: 240000,
  director: 180000,
  translation: 180000,
  understanding: 180000,
  relationship: 180000,
  quality_review: 180000,
  summary: 180000,
  fact_extraction: 180000,
  memory_extraction: 180000,
  media_analysis: 240000,
  material_analysis: 240000,
  persona_rewrite: 180000,
  speech_transcription: 240000
});

function finiteNonNegative(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function resolveQueueTimeoutMs(task, { queueTimeoutMs, options = {}, background = false } = {}) {
  const targetTask = normalizedTask(task);
  const taskFloor = TASK_QUEUE_TIMEOUT_FLOORS[targetTask] || 180000;
  const environmentFloor = finiteNonNegative(
    background ? process.env.YANCE_AI_BACKGROUND_QUEUE_TIMEOUT_MS : process.env.YANCE_AI_INTERACTIVE_QUEUE_TIMEOUT_MS,
    background ? 300000 : 180000
  );
  const executionBudget = finiteNonNegative(options.timeoutMs, 0);
  const explicit = queueTimeoutMs ?? options.queueTimeoutMs;
  const explicitBudget = explicit !== undefined && explicit !== null && String(explicit).trim() !== ''
    ? finiteNonNegative(explicit, 0)
    : 0;
  // A caller may increase the wait budget, but must never shorten it below the
  // task, environment, or actual model execution budget. Otherwise a slow local
  // model can be declared timed out before it receives an execution slot.
  return Math.max(taskFloor, environmentFloor, executionBudget, explicitBudget);
}

function normalizeTaskContext(context = {}, task = '') {
  const value = context && typeof context === 'object' ? context : {};
  const platform = String(value.platform || '').trim().toLowerCase();
  const sourceAccountId = String(value.sourceAccountId || value.accountId || '').trim();
  const sessionKey = String(value.sessionKey || value.conversationId || '').trim();
  const requestId = String(value.requestId || '').trim();
  const generation = String(value.generation || value.analysisGeneration || value.contextVersion || '').trim();
  const scopeKey = String(value.scopeKey || '').trim() || [platform, sourceAccountId, sessionKey, normalizedTask(task)].filter(Boolean).join('|');
  return {
    platform, sourceAccountId, sessionKey, requestId, generation, scopeKey,
    contactId: String(value.contactId || '').trim(),
    conversationId: String(value.conversationId || sessionKey || '').trim(),
    runtimeBuild: String(value.runtimeBuild || '').trim(),
    modelRouteVersion: String(value.modelRouteVersion || '').trim()
  };
}

function staleContextError(context = {}) {
  const error = new Error('AI任务结果已过期，已丢弃，未写入当前会话');
  error.code = 'AI_STALE_RESULT';
  error.status = 409;
  error.context = context;
  return error;
}

function assertExecutionCommitAllowed({
  signal,
  executionId = '',
  expectedGeneration = '',
  currentGeneration = ''
} = {}) {
  const expected = String(expectedGeneration || '').trim();
  const current = String(
    typeof currentGeneration === 'function' ? currentGeneration() : currentGeneration || ''
  ).trim();
  if (!signal?.aborted && (!expected || expected === current)) return;
  const reason = String(signal?.reason?.code || (expected && expected !== current
    ? 'GENERATION_SUPERSEDED'
    : 'MODEL_CANCELLED'));
  throw Object.assign(new Error('AI execution result is stale'), {
    code: 'AI_STALE_EXECUTION_RESULT',
    executionId: String(executionId || '').trim(),
    reason
  });
}

function translationRouteIds(route = {}, profile = 'realtime') {
  const target = String(profile || 'realtime').trim().toLowerCase();
  if (target === 'history') {
    return {
      primaryId: cleanModelId(route.historyPrimary),
      fallbackId: cleanModelId(route.historyFallback || route.primary || route.fallback)
    };
  }
  if (target === 'offline') {
    return {
      primaryId: cleanModelId(route.offlineFallback || route.historyPrimary),
      fallbackId: cleanModelId(route.historyFallback)
    };
  }
  return { primaryId: cleanModelId(route.primary), fallbackId: cleanModelId(route.fallback) };
}


class AiGateway {
  constructor(options = {}) {
    this.executeModel = typeof options.executeModel === 'function' ? options.executeModel : null;
    this.startModelExecution = typeof options.startModelExecution === 'function'
      ? options.startModelExecution
      : startModelExecution;
    this.activeExecutions = new Map();
    this.terminateExecution = typeof options.terminateExecution === 'function'
      ? options.terminateExecution
      : context => this.terminateActiveExecution(context);
    this.registry = options.registry || registry;
    this.controllers = new Map();
    this.jobs = new Map();
    this.failures = new Map();
    this.cooldowns = new Map();
    this.clock = {
      now: typeof options.clock?.now === 'function' ? options.clock.now : Date.now
    };
    this.queueIds = new Map();
    this.dedupe = new Map();
    this.latestContextGenerations = new Map();
    this.contextJobs = new Map();
    this.jobRetentionLimit = Math.max(50, Number(process.env.YANCE_AI_JOB_RETENTION || 500));
    const concurrency = Math.max(1, Number(options.concurrency || process.env.YANCE_AI_CONCURRENCY || 2));
    this.queue = new JobQueue({
      concurrency,
      providerConcurrency: options.providerConcurrency || {},
      name: 'ai-gateway',
      reservedHighPrioritySlots: concurrency > 1 ? Math.max(1, Number(process.env.YANCE_AI_INTERACTIVE_RESERVED_SLOTS || 1)) : 0,
      highPriorityThreshold: 70
    });
    this.loadPersistedCircuits();
  }

  providerKeyForModel(model = {}) {
    return cleanModelId(model.providerId || model.provider || model.id || model.name) || 'default';
  }

  async executeModelAttempt({
    jobId,
    model,
    messages,
    options,
    signal,
    updateProvider,
    bindExecution
  }) {
    const providerKey = this.providerKeyForModel(model);
    if (this.executeModel) {
      updateProvider?.(providerKey);
      return this.executeModel(model, messages, options, signal);
    }
    const handle = this.startModelExecution({
      model,
      messages,
      options,
      signal
    });
    if (bindExecution) {
      bindExecution({ executionId: handle.executionId, providerKey });
    } else {
      updateProvider?.(providerKey);
    }
    this.activeExecutions.set(jobId, handle);
    try {
      return await handle.result;
    } finally {
      if (this.activeExecutions.get(jobId) === handle) this.activeExecutions.delete(jobId);
    }
  }

  terminateActiveExecution(context = {}) {
    const handle = this.activeExecutions.get(String(context.jobId || '').trim());
    if (!handle) return null;
    return handle.requestTermination(context.error || context.reason || 'queue-termination');
  }

  loadPersistedCircuits() {
    const now = this.clock.now();
    for (const model of this.registry.read().models || []) {
      const openedUntil = Date.parse(String(model.circuitOpenedUntil || ''));
      if (!Number.isFinite(openedUntil) || openedUntil <= now) continue;
      const openedAt = Date.parse(String(model.circuitOpenedAt || '')) || now;
      this.failures.set(model.id, { count: Math.max(3, Number(model.consecutiveFailureCount || 3)), openedAt });
      this.cooldowns.set(model.id, openedUntil);
    }
  }

  _pruneJobs(limit = this.jobRetentionLimit) {
    const maximum = Math.max(1, Number(limit || this.jobRetentionLimit));
    if (this.jobs.size < maximum) return;
    const terminal = new Set(['completed', 'failed', 'cancelled']);
    for (const [jobId, row] of this.jobs) {
      if (this.jobs.size < maximum) break;
      if (!terminal.has(row?.status)) continue;
      this.jobs.delete(jobId);
    }
  }

  eligibleModels(task, options = {}) {
    const targetTask = normalizedTask(task);
    const state = this.registry.read();
    return (state.models || []).filter(model => eligibleForTask(model, targetTask, {
      allowExperimental: options.allowExperimental === true,
      allowConditional: options.allowConditional === true
    }));
  }

  resolveRoute(task, requestedModelId = '', options = {}) {
    const targetTask = normalizedTask(task);
    if (!TASKS.includes(targetTask)) throw new Error(`UNKNOWN_TASK:${task}`);
    const state = this.registry.read();
    const models = state.models || [];
    const executionPolicy = executionModeAuthority.policyFor(options.executionMode);
    const routeOverrideApplied = Boolean(options.routeOverride && typeof options.routeOverride === 'object');
    const route = routeOverrideApplied
      ? normalizeRoute(options.routeOverride, targetTask)
      : (state.routes?.[targetTask] || state.routes?.[task] || {});
    const candidates = models.filter(model => eligibleForTask(model, targetTask, {
      allowExperimental: route.allowExperimental === true,
      allowConditional: executionPolicy.allowConditional === true
    }));
    const find = id => candidates.find(model => model.id === cleanModelId(id));
    const byId = new Map(models.map(model => [cleanModelId(model.id), model]));
    const explicit = requestedModelId && find(requestedModelId);
    const translationProfile = targetTask === 'translation'
      ? String(options.translationProfile || (options.background === true ? 'history' : 'realtime')).trim().toLowerCase()
      : '';
    const placementDecision = workloadPlacementAuthority.rankCandidates(models, targetTask, {
      translationProfile,
      background: options.background === true,
      allowConditional: executionPolicy.allowConditional === true,
      requestedModelId: explicit?.id || '',
      maxFallbackScoreGap: Number(route.maxFallbackScoreGap || 0) || undefined
    });
    const rankedModels = placementDecision.candidates
      .map(row => byId.get(cleanModelId(row.modelId)))
      .filter(model => model && eligibleForTask(model, targetTask, {
        allowExperimental: route.allowExperimental === true,
        allowConditional: executionPolicy.allowConditional === true
      }));
    const budgetFor = model => aiBudgetAuthority.decide(state, {
      task: targetTask,
      translationProfile,
      background: options.background === true,
      modelCostClass: workloadPlacementAuthority.modelCostClass(model || {})
    });
    const admittedRanked = [];
    const blockedBudgetDecisions = [];
    for (const model of rankedModels) {
      const decision = budgetFor(model);
      if (decision.pass) admittedRanked.push({ model, decision });
      else blockedBudgetDecisions.push({ modelId: model.id, decision });
    }

    const profileIds = targetTask === 'translation'
      ? translationRouteIds(route, translationProfile)
      : { primaryId: route.primary, fallbackId: route.fallback };
    const autoSelection = route.primarySelection === 'auto' || (!cleanModelId(profileIds.primaryId) && !explicit);
    const onlyRequestedModel = options.onlyRequestedModel === true && Boolean(explicit);
    let primary = null;
    let fallback = null;
    let budgetDecision = null;

    if (explicit) {
      budgetDecision = budgetFor(explicit);
      primary = budgetDecision.pass ? explicit : null;
    } else if (autoSelection) {
      primary = admittedRanked[0]?.model || null;
      fallback = !onlyRequestedModel ? admittedRanked.find(row => row.model.id !== primary?.id)?.model || null : null;
      budgetDecision = admittedRanked[0]?.decision || blockedBudgetDecisions[0]?.decision || aiBudgetAuthority.decide(state, {
        task: targetTask,
        translationProfile,
        background: options.background === true,
        modelCostClass: 'paid-cloud'
      });
    } else {
      const configuredPrimary = route.enabled === false ? null : find(profileIds.primaryId);
      const configuredFallback = route.enabled === false ? null : find(profileIds.fallbackId);
      if (configuredPrimary) {
        budgetDecision = budgetFor(configuredPrimary);
        primary = budgetDecision.pass ? configuredPrimary : null;
      }
      if (!primary && configuredFallback) {
        const fallbackBudget = budgetFor(configuredFallback);
        if (fallbackBudget.pass) {
          primary = configuredFallback;
          budgetDecision = fallbackBudget;
        } else if (!budgetDecision) budgetDecision = fallbackBudget;
      } else if (!onlyRequestedModel && configuredFallback && configuredFallback.id !== primary?.id) {
        const fallbackBudget = budgetFor(configuredFallback);
        if (fallbackBudget.pass) fallback = configuredFallback;
      }
    }

    if (primary && !fallback && !onlyRequestedModel && autoSelection) {
      fallback = admittedRanked.find(row => row.model.id !== primary.id)?.model || null;
    }
    const emergencyId = cleanModelId(route.emergency || route.emergencyModelId);
    const emergencyCandidate = route.allowEmergency === true
      ? models.find(model => model.id === emergencyId && eligibleForTask(model, targetTask, { allowExperimental: true, allowConditional: true })) || null
      : null;
    const emergencyBudget = emergencyCandidate ? budgetFor(emergencyCandidate) : null;
    const emergency = !onlyRequestedModel && emergencyCandidate && emergencyBudget?.pass === true && ![primary?.id, fallback?.id].includes(emergencyCandidate.id)
      ? emergencyCandidate
      : null;
    const qualityPlan = aiQualityRouteAuthority.routePlan({
      task: targetTask,
      executionMode: executionPolicy.mode,
      route: { ...route, primary: primary?.id || '', fallback: fallback?.id || '', emergency: emergency?.id || '' },
      models,
      requestedModelId: explicit?.id || ''
    });
    qualityPlan.placementDecision = {
      authority: placementDecision.authority,
      schemaVersion: placementDecision.schemaVersion,
      policy: placementDecision.policy,
      candidateModelIds: placementDecision.candidates.map(row => row.modelId),
      rejected: placementDecision.rejected
    };
    qualityPlan.budgetDecision = budgetDecision;
    const qualityPrimary = qualityPlan.primaryPass || qualityPlan.primaryConditional ? primary : null;
    const qualityFallback = qualityPrimary && qualityPlan.fallbackPass ? fallback : null;
    const qualityEmergency = qualityPlan.emergencyPass ? emergency : null;
    return {
      primary: qualityPrimary,
      fallback: qualityFallback,
      emergency: qualityEmergency,
      qualityPlan,
      placementDecision,
      budgetDecision,
      budgetBlockedCandidates: blockedBudgetDecisions,
      route,
      routeOverrideApplied,
      task: targetTask,
      translationProfile,
      executionMode: executionPolicy.mode,
      deliveryEligible: executionPolicy.deliveryEligible,
      learningEligible: executionPolicy.learningEligible,
      formalReceiptEligible: executionPolicy.formalReceiptEligible,
      conditional: qualityPlan.state === aiQualityRouteAuthority.ROUTE_STATE.CONDITIONAL,
      humanReviewRequired: executionPolicy.humanReviewRequired === true || qualityPlan.humanReviewRequired === true
    };
  }

  noteFailure(modelId) {
    const current = this.failures.get(modelId) || { count: 0, openedAt: 0 };
    current.count += 1;
    if (current.count >= 3) current.openedAt = this.clock.now();
    this.failures.set(modelId, current);
  }

  noteSuccess(modelId) {
    this.failures.delete(modelId);
    this.cooldowns.delete(modelId);
  }

  noteCooldown(modelId, retryAfterMs = 0) {
    const duration = Math.max(0, Number(retryAfterMs || 0));
    if (!modelId || duration <= 0) return '';
    const until = this.clock.now() + duration;
    this.cooldowns.set(modelId, until);
    return new Date(until).toISOString();
  }

  isCircuitOpen(modelId) {
    const cooldownUntil = Number(this.cooldowns.get(modelId) || 0);
    if (cooldownUntil > this.clock.now()) return true;
    if (cooldownUntil) this.cooldowns.delete(modelId);
    const row = this.failures.get(modelId);
    if (!row?.openedAt) return false;
    if (this.clock.now() - row.openedAt > 5 * 60 * 1000) {
      this.failures.delete(modelId);
      return false;
    }
    return true;
  }

  async _run({
    jobId,
    task,
    messages,
    modelId = '',
    options = {},
    signal,
    updateProvider = null,
    bindExecution = null,
    expectedGeneration = '',
    currentGeneration = ''
  }) {
    const route = this.resolveRoute(task, modelId, options);
    const routedTask = route.task;
    const routeTestId = String(options.routeTestId || '').trim();
    const durableExecutionId = String(options.executionId || jobId || '').trim();
    aiExecutionTraceAuthority.record(routeTestId, 'gateway-route-resolved', {
      task: routedTask,
      executionId: durableExecutionId,
      executionMode: route.executionMode,
      resolvedPrimary: route.primary?.id || '',
      resolvedFallback: route.fallback?.id || '',
      allowConditional: route.executionMode === executionModeAuthority.EXECUTION_MODE.CANDIDATE_ONLY,
      humanReviewRequired: route.humanReviewRequired === true,
      formalQualification: route.qualityPlan?.primaryPass === true,
      routeState: route.qualityPlan?.state || '',
      reasonCodes: route.qualityPlan?.reasonCodes || [],
      deliveryEligible: route.deliveryEligible === true,
      learningEligible: route.learningEligible === true,
      formalReceiptEligible: route.formalReceiptEligible === true
    });
    const routeTimeoutMs = Number(route.route?.timeoutMs || 0);
    const callerTimeoutMs = Number(options.timeoutMs || 0);
    const effectiveTimeoutMs = taskRuntimePolicy.normalizeTimeoutMs(routedTask, Math.max(routeTimeoutMs, callerTimeoutMs));
    const effectiveMaxTokens = taskRuntimePolicy.normalizeMaxTokens(routedTask, options.maxTokens || route.route?.maxTokens);
    const executionBudget = taskRoutingAuthority.createBudget({
      totalBudgetMs: effectiveTimeoutMs,
      now: this.clock.now
    });
    const assertCommitAllowed = () => assertExecutionCommitAllowed({
      signal,
      executionId: jobId,
      expectedGeneration,
      currentGeneration
    });
    const fencedOnToken = typeof options.onToken === 'function'
      ? (...args) => {
          assertCommitAllowed();
          return options.onToken(...args);
        }
      : options.onToken;
    const candidates = [
      route.primary ? { model: route.primary, role: 'primary', emergencyMode: false } : null,
      route.fallback ? { model: route.fallback, role: 'fallback', emergencyMode: false } : null,
      route.emergency ? { model: route.emergency, role: 'emergency', emergencyMode: true } : null
    ]
      .filter(Boolean)
      .filter((entry, index, rows) => rows.findIndex(row => row.model.id === entry.model.id) === index);
    if (!candidates.length) {
      const qualityBlocked = Boolean(route.qualityPlan && route.qualityPlan.state === aiQualityRouteAuthority.ROUTE_STATE.BLOCKED);
      const error = new Error(qualityBlocked
        ? `任务 ${task} 的已配置模型未通过质量能力门禁`
        : `任务 ${task} 没有通过资格测试的可用模型`);
      error.code = qualityBlocked ? 'AI_QUALITY_ROUTE_BLOCKED' : 'NO_QUALIFIED_MODEL';
      error.qualityPlan = route.qualityPlan || null;
      aiExecutionTraceAuthority.record(routeTestId, 'quality-plan-blocked', {
        task: routedTask, executionId: durableExecutionId, executionMode: route.executionMode, routeState: route.qualityPlan?.state || '',
        reasonCode: error.code, reasonCodes: route.qualityPlan?.reasonCodes || [],
        resolvedPrimary: route.primary?.id || '', resolvedFallback: route.fallback?.id || ''
      });
      throw error;
    }
    let lastError = null;
    const attempts = [];
    eventBus.publish('ai:job-started', {
      jobId,
      task: routedTask,
      requestedTask: task,
      candidates: candidates.map(entry => entry.model.name),
      timeoutMs: effectiveTimeoutMs,
      maxTokens: effectiveMaxTokens,
      totalBudgetMs: executionBudget.totalBudgetMs
    });

    const runAttempt = async ({ candidate, attemptMessages, contextReductionReceipt = null }) => {
      const model = candidate.model;
      const modelQuality = aiQualityRouteAuthority.modelProjection(model, routedTask);
      const remainingBefore = executionBudget.remainingMs();
      if (remainingBefore <= 0) {
        throw Object.assign(new Error('AI model route total timeout budget exhausted'), {
          code: 'AI_ROUTE_TOTAL_BUDGET_EXHAUSTED',
          status: 408,
          timeoutMs: executionBudget.totalBudgetMs
        });
      }
      const attemptTimeoutMs = executionBudget.attemptTimeoutMs(effectiveTimeoutMs);
      const attemptId = randomUUID();
      const attemptStartedAt = this.clock.now();
      const provider = this.providerKeyForModel(model);
      const failureDomain = providerDomainAuthority.providerFailureDomain(model);
      aiExecutionTraceAuthority.record(routeTestId, 'worker-started', {
        task: routedTask,
        executionId: durableExecutionId,
        attemptId,
        executionMode: route.executionMode,
        modelId: model.id,
        provider,
        failureDomain,
        workerStarted: true,
        status: contextReductionReceipt ? 'context-reduced-retry' : 'running',
        timeoutMs: attemptTimeoutMs,
        remainingBudgetMs: remainingBefore
      });
      try {
        const rawResult = await this.executeModelAttempt({
          jobId,
          model,
          messages: attemptMessages,
          options: {
            maxTokens: effectiveMaxTokens,
            timeoutMs: attemptTimeoutMs,
            temperature: options.temperature,
            json: options.json,
            keepAlive: options.keepAlive,
            onToken: fencedOnToken
          },
          signal,
          updateProvider,
          bindExecution
        });
        const result = taskRoutingAuthority.assertUsableResult(normalizeModelResult(rawResult, options));
        const providerRequestId = String(result.providerRequestId || result.requestId || '').trim();
        aiExecutionTraceAuthority.record(routeTestId, 'provider-result', {
          task: routedTask,
          executionId: durableExecutionId,
          attemptId,
          executionMode: route.executionMode,
          modelId: model.id,
          provider,
          failureDomain,
          providerRequestId,
          status: 'success',
          workerStarted: true,
          remainingBudgetMs: executionBudget.remainingMs()
        });
        assertCommitAllowed();
        await this.registry.recordInvocation(model.id, result);
        assertCommitAllowed();
        this.noteSuccess(model.id);
        const receipt = taskRoutingAuthority.attemptReceipt({
          attemptId,
          modelId: model.id,
          model: model.name,
          provider,
          failureDomain,
          role: candidate.role,
          emergencyMode: candidate.emergencyMode,
          qualityTier: modelQuality.qualityTier,
          status: 'success',
          providerRequestId,
          timeoutMs: attemptTimeoutMs,
          remainingBudgetMs: executionBudget.remainingMs(),
          latencyMs: this.clock.now() - attemptStartedAt
        });
        if (contextReductionReceipt) {
          receipt.contextReduced = true;
          receipt.recoveryPhase = 'same-model-reduced-context';
          receipt.originalContextChars = Number(contextReductionReceipt.originalChars || 0);
          receipt.reducedContextChars = Number(contextReductionReceipt.reducedChars || 0);
          receipt.contextReductionReceipt = contextReductionReceipt;
        }
        attempts.push(receipt);
        return { result, modelQuality };
      } catch (error) {
        if (error?.code === 'AI_STALE_EXECUTION_RESULT') throw error;
        const normalized = normalizeModelError(error, { nowMs: this.clock.now() });
        const recovery = aiQualityRouteAuthority.classifyFailure(normalized);
        const nextRetryAt = normalized.retryAfterMs > 0
          ? this.noteCooldown(model.id, normalized.retryAfterMs)
          : normalized.nextRetryAt;
        const receipt = taskRoutingAuthority.attemptReceipt({
          attemptId,
          modelId: model.id,
          model: model.name,
          provider,
          failureDomain,
          role: candidate.role,
          emergencyMode: candidate.emergencyMode,
          qualityTier: modelQuality.qualityTier,
          status: 'failed',
          code: normalized.code,
          reasonCode: recovery.reasonCode,
          fallbackAllowed: recovery.fallbackAllowed,
          retrySameModel: recovery.retrySameModel,
          retryAfterMs: normalized.retryAfterMs,
          nextRetryAt,
          providerRequestId: normalized.providerRequestId || error?.providerRequestId,
          httpStatus: normalized.status,
          timeoutMs: attemptTimeoutMs,
          remainingBudgetMs: executionBudget.remainingMs(),
          latencyMs: this.clock.now() - attemptStartedAt,
          outcomeUnknown: recovery.outcomeUnknown,
          message: normalized.message
        });
        receipt.recoveryAction = recovery.action;
        if (contextReductionReceipt) {
          receipt.contextReduced = true;
          receipt.recoveryPhase = 'same-model-reduced-context';
          receipt.originalContextChars = Number(contextReductionReceipt.originalChars || 0);
          receipt.reducedContextChars = Number(contextReductionReceipt.reducedChars || 0);
        }
        attempts.push(receipt);
        aiExecutionTraceAuthority.record(routeTestId, 'provider-attempt-failed', {
          task: routedTask,
          executionId: durableExecutionId,
          attemptId,
          executionMode: route.executionMode,
          modelId: model.id,
          provider,
          failureDomain,
          status: 'failed',
          errorCode: normalized.code,
          reasonCode: recovery.reasonCode,
          fallbackAllowed: recovery.fallbackAllowed,
          retryAfterMs: normalized.retryAfterMs,
          nextRetryAt,
          remainingBudgetMs: executionBudget.remainingMs(),
          workerStarted: true
        });
        eventBus.publish('ai:job-model-failed', {
          jobId,
          task: routedTask,
          requestedTask: task,
          modelId: model.id,
          model: model.name,
          role: candidate.role,
          emergencyMode: candidate.emergencyMode,
          qualityTier: modelQuality.qualityTier,
          error: normalized.message,
          code: normalized.code,
          reasonCode: recovery.reasonCode,
          recoveryAction: recovery.action,
          fallbackAllowed: recovery.fallbackAllowed,
          retryAfterMs: normalized.retryAfterMs,
          nextRetryAt,
          httpStatus: normalized.status
        });
        if (recovery.countsForCircuit) this.noteFailure(model.id);
        if (!['MODEL_CANCELLED', 'JOB_CANCELLED', 'MODEL_REQUEST_DISCONNECTED'].includes(String(normalized.code || '').toUpperCase())) {
          await this.registry.recordInvocationFailure(model.id, error, {
            countForCircuit: recovery.countsForCircuit === true,
            cooldownUntil: nextRetryAt || ''
          });
        }
        error.normalizedModelError = normalized;
        error.routeRecovery = recovery;
        error.attemptReceipt = receipt;
        throw error;
      }
    };

    const complete = ({ candidate, modelQuality, result, contextReductionReceipt = null }) => {
      const model = candidate.model;
      const fallbackUsed = candidate.role !== 'primary';
      const qualityRouteReceipt = aiQualityRouteAuthority.routeReceipt({
        task: routedTask,
        executionMode: route.executionMode,
        selectedModel: model,
        routePlan: route.qualityPlan,
        fallbackUsed,
        emergencyMode: candidate.emergencyMode,
        attempts
      });
      eventBus.publish('ai:job-complete', {
        jobId,
        task: routedTask,
        requestedTask: task,
        modelId: model.id,
        model: model.name,
        fallbackUsed,
        emergencyMode: candidate.emergencyMode,
        learningEligible: qualityRouteReceipt.learningEligible,
        qualityTier: qualityRouteReceipt.qualityTier,
        qualityRouteReceipt,
        attempts,
        metrics: result,
        contextReductionReceipt,
        totalBudgetMs: executionBudget.totalBudgetMs,
        remainingBudgetMs: executionBudget.remainingMs()
      });
      return {
        jobId,
        task: routedTask,
        requestedTask: task,
        modelId: model.id,
        model: model.name,
        fallbackUsed,
        emergencyMode: candidate.emergencyMode,
        learningEligible: qualityRouteReceipt.learningEligible,
        qualityTier: qualityRouteReceipt.qualityTier,
        qualityDegraded: qualityRouteReceipt.qualityDegraded,
        highCapabilityPath: qualityRouteReceipt.highCapabilityPath,
        qualityRouteReceipt,
        executionMode: route.executionMode,
        deliveryEligible: route.deliveryEligible === true && candidate.emergencyMode !== true,
        formalReceiptEligible: route.formalReceiptEligible === true && candidate.emergencyMode !== true,
        conditionalRoute: route.conditional === true,
        humanReviewRequired: route.humanReviewRequired === true || candidate.emergencyMode,
        effectiveTimeoutMs,
        totalBudgetMs: executionBudget.totalBudgetMs,
        remainingBudgetMs: executionBudget.remainingMs(),
        effectiveMaxTokens,
        attempts,
        ...(contextReductionReceipt ? { contextReductionReceipt } : {}),
        ...result
      };
    };

    for (const candidate of candidates) {
      const model = candidate.model;
      const modelQuality = aiQualityRouteAuthority.modelProjection(model, routedTask);
      if (signal?.aborted) throw signal.reason || new Error('MODEL_CANCELLED');
      if (executionBudget.remainingMs() <= 0) {
        lastError = Object.assign(new Error('AI model route total timeout budget exhausted'), {
          code: 'AI_ROUTE_TOTAL_BUDGET_EXHAUSTED',
          status: 408
        });
        attempts.push(taskRoutingAuthority.attemptReceipt({
          modelId: model.id,
          model: model.name,
          provider: this.providerKeyForModel(model),
          failureDomain: providerDomainAuthority.providerFailureDomain(model),
          role: candidate.role,
          emergencyMode: candidate.emergencyMode,
          qualityTier: modelQuality.qualityTier,
          status: 'failed',
          code: lastError.code,
          reasonCode: 'TOTAL_BUDGET_EXHAUSTED',
          fallbackAllowed: false,
          timeoutMs: 0,
          remainingBudgetMs: 0,
          message: lastError.message
        }));
        break;
      }
      if (this.isCircuitOpen(model.id)) {
        attempts.push(taskRoutingAuthority.attemptReceipt({
          modelId: model.id,
          model: model.name,
          provider: this.providerKeyForModel(model),
          failureDomain: providerDomainAuthority.providerFailureDomain(model),
          role: candidate.role,
          emergencyMode: candidate.emergencyMode,
          qualityTier: modelQuality.qualityTier,
          status: 'circuit_open',
          code: 'MODEL_CIRCUIT_OPEN',
          reasonCode: 'MODEL_COOLDOWN_OR_CIRCUIT_OPEN',
          fallbackAllowed: true,
          remainingBudgetMs: executionBudget.remainingMs(),
          message: '模型熔断或 Retry-After 冷却中，本次已跳过'
        }));
        eventBus.publish('ai:job-model-skipped', {
          jobId,
          task: routedTask,
          requestedTask: task,
          modelId: model.id,
          model: model.name,
          role: candidate.role,
          qualityTier: modelQuality.qualityTier,
          code: 'MODEL_CIRCUIT_OPEN'
        });
        continue;
      }
      try {
        const outcome = await runAttempt({ candidate, attemptMessages: messages });
        return complete({ candidate, modelQuality: outcome.modelQuality, result: outcome.result });
      } catch (error) {
        if (error?.code === 'AI_STALE_EXECUTION_RESULT') {
          eventBus.publish('ai:stale-execution-result', {
            jobId,
            task: routedTask,
            executionId: error.executionId || jobId,
            reason: error.reason || 'GENERATION_SUPERSEDED'
          });
          throw error;
        }
        lastError = error;
        const recovery = error.routeRecovery || taskRoutingAuthority.classifyFailure(error.normalizedModelError || error);
        const reduction = recovery.reasonCode === 'TIMEOUT'
          && recovery.retrySameModel === true
          && options.contextReductionBeforeFallback !== false
          && executionBudget.remainingMs() > 0
          ? aiContextReductionPolicy.reduceMessages(messages, { task: routedTask, targetRatio: options.contextReductionRatio })
          : { changed: false, reasonCode: 'NOT_REQUESTED', messages };
        if (reduction.changed) {
          eventBus.publish('ai:job-context-reduced-retry', {
            jobId,
            task: routedTask,
            requestedTask: task,
            modelId: model.id,
            model: model.name,
            originalChars: reduction.originalChars,
            reducedChars: reduction.reducedChars,
            reductionRatio: reduction.reductionRatio,
            originalHash: reduction.originalHash,
            reducedHash: reduction.reducedHash
          });
          try {
            const outcome = await runAttempt({ candidate, attemptMessages: reduction.messages, contextReductionReceipt: reduction });
            return complete({ candidate, modelQuality: outcome.modelQuality, result: outcome.result, contextReductionReceipt: reduction });
          } catch (reducedError) {
            if (reducedError?.code === 'AI_STALE_EXECUTION_RESULT') {
              eventBus.publish('ai:stale-execution-result', {
                jobId,
                task: routedTask,
                executionId: reducedError.executionId || jobId,
                reason: reducedError.reason || 'GENERATION_SUPERSEDED'
              });
              throw reducedError;
            }
            lastError = reducedError;
            const reducedRecovery = reducedError.routeRecovery || taskRoutingAuthority.classifyFailure(reducedError.normalizedModelError || reducedError);
            eventBus.publish('ai:job-context-reduced-retry-failed', {
              jobId,
              task: routedTask,
              requestedTask: task,
              modelId: model.id,
              model: model.name,
              code: reducedError.normalizedModelError?.code || reducedError.code,
              reasonCode: reducedRecovery.reasonCode,
              recoveryAction: reducedRecovery.action,
              fallbackAllowed: reducedRecovery.fallbackAllowed,
              originalChars: reduction.originalChars,
              reducedChars: reduction.reducedChars
            });
            if (!reducedRecovery.fallbackAllowed) break;
            continue;
          }
        }
        if (!recovery.fallbackAllowed) break;
      }
    }
    const aggregate = createAllModelsFailedError(attempts, { cause: lastError });
    logger.error('models', 'gateway-job-failed', { jobId, task: routedTask, requestedTask: task, error: aggregate.message, code: aggregate.code, attempts });
    throw aggregate;
  }

  registerTaskContext(jobId, task, rawContext = {}) {
    const context = normalizeTaskContext(rawContext, task);
    if (!context.scopeKey || !context.generation) return context;
    const previousGeneration = this.latestContextGenerations.get(context.scopeKey);
    if (previousGeneration && previousGeneration !== context.generation) {
      for (const existingJobId of this.contextJobs.get(context.scopeKey) || []) this.cancel(existingJobId);
    }
    this.latestContextGenerations.set(context.scopeKey, context.generation);
    const jobs = this.contextJobs.get(context.scopeKey) || new Set();
    jobs.add(jobId);
    this.contextJobs.set(context.scopeKey, jobs);
    return context;
  }

  releaseTaskContext(jobId, context = {}) {
    if (!context.scopeKey) return;
    const jobs = this.contextJobs.get(context.scopeKey);
    if (!jobs) return;
    jobs.delete(jobId);
    if (!jobs.size) this.contextJobs.delete(context.scopeKey);
  }

  assertTaskContextCurrent(context = {}) {
    if (!context.scopeKey || !context.generation) return;
    const latest = this.latestContextGenerations.get(context.scopeKey);
    if (latest && latest !== context.generation) throw staleContextError({ ...context, latestGeneration: latest });
  }

  submit({ task, messages, modelId = '', options = {}, signal: externalSignal = null, priority = undefined, queueTimeoutMs = undefined, background = false, context: rawContext = {} }) {
    const routeOptions = { ...options, background: background === true };
    const routeResolution = this.resolveRoute(task, modelId, routeOptions);
    const configuredTimeoutMs = Number(routeResolution.route?.timeoutMs || 0);
    const physicalProviderKey = cleanModelId(
      routeResolution.primary?.providerId || routeResolution.primary?.provider || routeResolution.primary?.id
      || routeResolution.fallback?.providerId || routeResolution.fallback?.provider || routeResolution.fallback?.id
      || modelId || task
    );
    const effectiveOptions = {
      ...routeOptions,
      timeoutMs: taskRuntimePolicy.normalizeTimeoutMs(task, Math.max(configuredTimeoutMs, Number(options.timeoutMs || 0)))
    };
    const jobId = randomUUID();
    const context = this.registerTaskContext(jobId, task, rawContext);
    const controller = new AbortController();
    const abortFromExternal = () => controller.abort(externalSignal?.reason || Object.assign(new Error('MODEL_CANCELLED'), { code: 'MODEL_CANCELLED' }));
    let submissionCleaned = false;
    const cleanupSubmission = () => {
      if (submissionCleaned) return;
      submissionCleaned = true;
      externalSignal?.removeEventListener?.('abort', abortFromExternal);
      this.controllers.delete(jobId);
      this.releaseTaskContext(jobId, context);
    };
    if (externalSignal?.aborted) abortFromExternal();
    else externalSignal?.addEventListener?.('abort', abortFromExternal, { once: true });
    this.controllers.set(jobId, controller);
    this._pruneJobs();
    this.jobs.set(jobId, {
      jobId,
      task,
      status: 'queued',
      createdAt: new Date().toISOString(),
      context,
      result: null,
      error: null
    });
    const queuePriority = taskPriority(task, { priority, background });
    const effectiveQueueTimeoutMs = resolveQueueTimeoutMs(task, { queueTimeoutMs, options: effectiveOptions, background });
    const queued = this.queue.add(async ({ signal, generation, updateProvider, bindExecution }) => {
      const relay = () => controller.abort(signal.reason || new Error('JOB_CANCELLED'));
      if (signal.aborted) relay();
      else signal.addEventListener('abort', relay, { once: true });
      const current = this.jobs.get(jobId);
      if (current) {
        current.status = 'running';
        current.startedAt = new Date().toISOString();
        current.executionGeneration = generation;
      }
      try {
        this.assertTaskContextCurrent(context);
        const result = await this._run({
          jobId,
          task,
          messages,
          modelId,
          options: effectiveOptions,
          signal: controller.signal,
          updateProvider,
          bindExecution,
          expectedGeneration: context.generation,
          currentGeneration: () => this.latestContextGenerations.get(context.scopeKey) || context.generation
        });
        this.assertTaskContextCurrent(context);
        result.taskContext = context;
        const row = this.jobs.get(jobId);
        if (row && row.status === 'running' && row.executionGeneration === generation) {
          row.status = 'completed';
          row.completedAt = new Date().toISOString();
          row.result = result;
        }
        return result;
      } catch (error) {
        const row = this.jobs.get(jobId);
        if (row && row.status === 'running' && row.executionGeneration === generation) {
          row.status = controller.signal.aborted ? 'cancelled' : 'failed';
          row.completedAt = new Date().toISOString();
          row.error = { code: error.code || 'AI_JOB_FAILED', message: error.message || String(error), status: Number(error.status || 0), attempts: Array.isArray(error.attempts) ? error.attempts : [] };
        }
        throw error;
      } finally {
        signal.removeEventListener?.('abort', relay);
        cleanupSubmission();
      }
    }, {
      task, jobId, context, priority: queuePriority, queueTimeoutMs: effectiveQueueTimeoutMs,
      executionTimeoutMs: Math.max(1_000, Number(effectiveOptions.executionTimeoutMs || effectiveOptions.timeoutMs || 30_000) + 5_000),
      executionTimeoutCode: 'AI_EXECUTION_TIMEOUT', background: background === true,
      providerKey: physicalProviderKey || 'default',
      hardTerminate: this.terminateExecution ? context => this.terminateExecution({
        ...context, task, jobId, modelId, providerKey: physicalProviderKey || 'default', controller
      }) : null
    });
    this.queueIds.set(jobId, queued.id);
    queued.promise.finally(() => {
      this.queueIds.delete(jobId);
      // Queue timeout and pending cancellation never enter the task callback,
      // so their external abort listener/controller must be released here.
      cleanupSubmission();
    }).catch(error => {
      const row = this.jobs.get(jobId);
      if (row && ['queued','running'].includes(row.status)) {
        row.status = error.code === 'JOB_CANCELLED' ? 'cancelled' : 'failed';
        row.executionGeneration = row.executionGeneration || String(this.queueIds.get(jobId) || '').trim();
        row.completedAt = new Date().toISOString();
        row.error = { code: error.code || 'AI_QUEUE_FAILED', message: error.message || String(error), status: Number(error.status || 0), attempts: [] };
      }
      logger.warn('ai', 'queued-job-failed', { operation: 'aiGateway.queuedPromise', accountId: '', conversationId: '', reasonCode: error.code || 'AI_QUEUED_JOB_FAILED', httpStatus: Number(error.status || 0), attempt: 1, nextRetryAt: '', jobId, task, error: error.message });
    });
    return { jobId };
  }

  async waitForJob(jobId) {
    while (true) {
      const row = this.jobs.get(jobId);
      if (!row) throw Object.assign(new Error('AI_JOB_LOST'), { code: 'AI_JOB_LOST' });
      if (row.status === 'completed') return row.result;
      if (row.status === 'failed' || row.status === 'cancelled') {
        const error = new Error(row.error?.message || 'AI任务失败');
        error.code = row.error?.code || 'AI_JOB_FAILED';
        error.status = Number(row.error?.status || 0);
        error.attempts = Array.isArray(row.error?.attempts) ? row.error.attempts : [];
        throw error;
      }
      await new Promise(resolve => setTimeout(resolve, 40));
    }
  }

  async execute(payload = {}) {
    const dedupeKey = String(payload.dedupeKey || '').trim();
    const fingerprint = String(payload.fingerprint || '').trim();
    if (dedupeKey) {
      const existing = this.dedupe.get(dedupeKey);
      if (existing && fingerprint && existing.fingerprint === fingerprint) return existing.promise;
      if (existing) this.cancel(existing.jobId);
    }

    const { jobId } = this.submit(payload);
    const promise = this.waitForJob(jobId);
    if (dedupeKey) this.dedupe.set(dedupeKey, { jobId, fingerprint, promise });
    try {
      return await promise;
    } finally {
      if (dedupeKey && this.dedupe.get(dedupeKey)?.jobId === jobId) this.dedupe.delete(dedupeKey);
    }
  }

  getJob(jobId) {
    return this.jobs.get(jobId) || null;
  }

  listJobs() {
    return [...this.jobs.values()].slice(-200);
  }

  cancel(jobId) {
    const controller = this.controllers.get(jobId);
    const queueId = this.queueIds.get(jobId);
    const queued = queueId ? this.queue.cancel(queueId) : false;
    if (controller) controller.abort(new Error('MODEL_CANCELLED'));
    const row = this.jobs.get(jobId);
    if (row && !['completed', 'failed'].includes(row.status)) {
      row.status = 'cancelled';
      row.completedAt = new Date().toISOString();
      row.error = { code: 'MODEL_CANCELLED', message: '任务已取消' };
    }
    if (controller || queued) eventBus.publish('ai:job-cancelled', { jobId, task: row?.task || '' });
    return Boolean(controller || queued || row);
  }

  status() {
    return {
      queue: this.queue.status(),
      jobs: this.listJobs(),
      circuits: Object.fromEntries(this.failures),
      dedupe: [...this.dedupe.entries()].map(([key, value]) => ({ key, jobId: value.jobId, fingerprint: value.fingerprint })),
      taskContexts: [...this.latestContextGenerations.entries()].slice(-200).map(([scopeKey, generation]) => ({ scopeKey, generation, activeJobs: (this.contextJobs.get(scopeKey) || new Set()).size }))
    };
  }
}

const aiGateway = new AiGateway();
module.exports = aiGateway;
module.exports.AiGateway = AiGateway;
module.exports.TASK_QUEUE_TIMEOUT_FLOORS = TASK_QUEUE_TIMEOUT_FLOORS;
module.exports.resolveQueueTimeoutMs = resolveQueueTimeoutMs;
module.exports.normalizeTaskContext = normalizeTaskContext;
module.exports.staleContextError = staleContextError;
module.exports.assertExecutionCommitAllowed = assertExecutionCommitAllowed;
module.exports.translationRouteIds = translationRouteIds;
