'use strict';

const { randomUUID } = require('crypto');
const registry = require('./modelRegistry');
const { startModelExecution } = require('./modelExecutionHost');
const { normalizeModelResult } = require('./modelResultNormalizer');
const eventBus = require('./eventBus');
const logger = require('./logger');
const { JobQueue } = require('./jobQueue');
const { TASKS, QUALIFICATION } = require('../../shared/constants');
const { normalizedTask, eligibleForTask, cleanModelId } = require('./modelRoutingIntegrityService');
const { normalizeModelError, createAllModelsFailedError } = require('./modelErrorNormalizer');
const taskRuntimePolicy = require('./modelTaskRuntimePolicy');
const aiQualityRouteAuthority = require('./aiQualityRouteAuthority');
const aiContextReductionPolicy = require('./aiContextReductionPolicy');

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

function shouldCountModelFailure(error = {}) {
  const code = String(error.code || '').toUpperCase();
  const status = Number(error.status || 0);
  if (['MODEL_CANCELLED', 'JOB_CANCELLED', 'MODEL_REQUEST_DISCONNECTED', 'AI_QUEUE_TIMEOUT'].includes(code)) return false;
  if (status >= 400 && status < 500 && status !== 408 && status !== 429) return false;
  if (/(CREDENTIAL_MISSING|INVALID_|MODEL_NOT_FOUND|UNSUPPORTED_MODEL_PROVIDER|MISCONFIGURED)/u.test(code)) return false;
  return /(TIMEOUT|NETWORK|ECONN|OFFLINE|OOM|RESOURCE|RATE|HTTP_5|REQUEST_FAILED|INVOCATION_FAILED)/u.test(code)
    || status === 408 || status === 429 || status >= 500;
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
    const now = Date.now();
    for (const model of this.registry.read().models || []) {
      const openedUntil = Date.parse(String(model.circuitOpenedUntil || ''));
      if (!Number.isFinite(openedUntil) || openedUntil <= now) continue;
      const openedAt = Date.parse(String(model.circuitOpenedAt || '')) || now;
      this.failures.set(model.id, { count: Math.max(3, Number(model.consecutiveFailureCount || 3)), openedAt });
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
    const route = state.routes?.[targetTask] || state.routes?.[task] || {};
    const candidates = this.eligibleModels(targetTask, {
      allowExperimental: route.allowExperimental === true,
      allowConditional: route.allowConditional === true
    });
    const find = id => candidates.find(model => model.id === cleanModelId(id));
    const explicit = requestedModelId && find(requestedModelId);
    const translationProfile = targetTask === 'translation'
      ? String(options.translationProfile || (options.background === true ? 'history' : 'realtime')).trim().toLowerCase()
      : '';
    const profileIds = targetTask === 'translation'
      ? translationRouteIds(route, translationProfile)
      : { primaryId: route.primary, fallbackId: route.fallback };
    const profilePrimaryId = profileIds.primaryId;
    const profileFallbackId = profileIds.fallbackId;
    const configuredPrimary = route.enabled === false ? null : (explicit || find(profilePrimaryId) || null);
    const configuredFallback = route.enabled === false ? null : (find(profileFallbackId) || null);
    const primary = configuredPrimary || configuredFallback || null;
    const onlyRequestedModel = options.onlyRequestedModel === true && Boolean(explicit);
    const fallback = !onlyRequestedModel && configuredPrimary && configuredFallback && configuredFallback.id !== configuredPrimary.id
      ? configuredFallback
      : null;
    const emergencyId = cleanModelId(route.emergency || route.emergencyModelId);
    const emergencyCandidate = route.allowEmergency === true
      ? (state.models || []).find(model => model.id === emergencyId && eligibleForTask(model, targetTask, { allowExperimental: true, allowConditional: true })) || null
      : null;
    const emergency = !onlyRequestedModel && emergencyCandidate && ![primary?.id, fallback?.id].includes(emergencyCandidate.id) ? emergencyCandidate : null;
    const qualityPlan = aiQualityRouteAuthority.routePlan({
      task: targetTask,
      route: { ...route, primary: primary?.id || '', fallback: fallback?.id || '', emergency: emergency?.id || '' },
      models: state.models || [],
      requestedModelId: explicit?.id || ''
    });
    // The quality authority is an execution gate, not an observability-only
    // annotation. A model that remains selectable under the legacy routing
    // rules must still satisfy the task-specific quality tier and capability
    // contract before AiGateway is allowed to invoke it.
    const qualityPrimary = qualityPlan.primaryPass || qualityPlan.primaryConditional ? primary : null;
    const qualityFallback = qualityPrimary && qualityPlan.fallbackPass ? fallback : null;
    const qualityEmergency = qualityPlan.emergencyPass ? emergency : null;
    return {
      primary: qualityPrimary, fallback: qualityFallback, emergency: qualityEmergency,
      qualityPlan, route, task: targetTask, translationProfile,
      conditional: route.allowConditional === true,
      humanReviewRequired: route.humanReviewRequired === true || route.allowConditional === true
    };
  }

  noteFailure(modelId) {
    const current = this.failures.get(modelId) || { count: 0, openedAt: 0 };
    current.count += 1;
    if (current.count >= 3) current.openedAt = Date.now();
    this.failures.set(modelId, current);
  }

  noteSuccess(modelId) {
    this.failures.delete(modelId);
  }

  isCircuitOpen(modelId) {
    const row = this.failures.get(modelId);
    if (!row?.openedAt) return false;
    if (Date.now() - row.openedAt > 5 * 60 * 1000) {
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
    const routeTimeoutMs = Number(route.route?.timeoutMs || 0);
    const callerTimeoutMs = Number(options.timeoutMs || 0);
    const effectiveTimeoutMs = taskRuntimePolicy.normalizeTimeoutMs(routedTask, Math.max(routeTimeoutMs, callerTimeoutMs));
    const effectiveMaxTokens = taskRuntimePolicy.normalizeMaxTokens(routedTask, options.maxTokens || route.route?.maxTokens);
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
      throw error;
    }
    let lastError = null;
    const attempts = [];
    eventBus.publish('ai:job-started', { jobId, task: routedTask, requestedTask: task, candidates: candidates.map(entry => entry.model.name), timeoutMs: effectiveTimeoutMs, maxTokens: effectiveMaxTokens });
    for (const candidate of candidates) {
      const model = candidate.model;
      const modelQuality = aiQualityRouteAuthority.modelProjection(model, routedTask);
      if (signal?.aborted) throw signal.reason || new Error('MODEL_CANCELLED');
      if (this.isCircuitOpen(model.id)) {
        attempts.push({ modelId: model.id, model: model.name, role: candidate.role, emergencyMode: candidate.emergencyMode, qualityTier: modelQuality.qualityTier, status: 'circuit_open', code: 'MODEL_CIRCUIT_OPEN', message: '模型熔断保护中，本次已跳过', httpStatus: 0 });
        eventBus.publish('ai:job-model-skipped', { jobId, task: routedTask, requestedTask: task, modelId: model.id, model: model.name, role: candidate.role, qualityTier: modelQuality.qualityTier, code: 'MODEL_CIRCUIT_OPEN' });
        continue;
      }
      try {
        const rawResult = await this.executeModelAttempt({
          jobId,
          model,
          messages,
          options: {
            maxTokens: effectiveMaxTokens,
            timeoutMs: effectiveTimeoutMs,
            temperature: options.temperature,
            json: options.json,
            keepAlive: options.keepAlive,
            onToken: fencedOnToken
          },
          signal,
          updateProvider,
          bindExecution
        });
        const result = normalizeModelResult(rawResult, options);
        assertCommitAllowed();
        await this.registry.recordInvocation(model.id, result);
        assertCommitAllowed();
        this.noteSuccess(model.id);
        attempts.push({ modelId: model.id, model: model.name, role: candidate.role, emergencyMode: candidate.emergencyMode, qualityTier: modelQuality.qualityTier, status: 'success', code: '', message: '', httpStatus: 0, timeoutMs: effectiveTimeoutMs });
        const fallbackUsed = candidate.role !== 'primary';
        const qualityRouteReceipt = aiQualityRouteAuthority.routeReceipt({
          task: routedTask,
          selectedModel: model,
          routePlan: route.qualityPlan,
          fallbackUsed,
          emergencyMode: candidate.emergencyMode,
          attempts
        });
        eventBus.publish('ai:job-complete', {
          jobId, task: routedTask, requestedTask: task, modelId: model.id, model: model.name,
          fallbackUsed, emergencyMode: candidate.emergencyMode, learningEligible: qualityRouteReceipt.learningEligible,
          qualityTier: qualityRouteReceipt.qualityTier, qualityRouteReceipt, attempts, metrics: result
        });
        return {
          jobId, task: routedTask, requestedTask: task, modelId: model.id, model: model.name,
          fallbackUsed, emergencyMode: candidate.emergencyMode, learningEligible: qualityRouteReceipt.learningEligible,
          qualityTier: qualityRouteReceipt.qualityTier, qualityDegraded: qualityRouteReceipt.qualityDegraded,
          highCapabilityPath: qualityRouteReceipt.highCapabilityPath,
          qualityRouteReceipt,
          conditionalRoute: route.conditional === true,
          humanReviewRequired: route.humanReviewRequired === true || candidate.emergencyMode,
          effectiveTimeoutMs, effectiveMaxTokens, attempts, ...result
        };
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
        const normalized = normalizeModelError(error);
        const recovery = aiQualityRouteAuthority.classifyFailure(normalized);
        attempts.push({
          modelId: model.id, model: model.name, role: candidate.role, emergencyMode: candidate.emergencyMode,
          qualityTier: modelQuality.qualityTier, status: 'failed', code: normalized.code,
          reasonCode: recovery.reasonCode, recoveryAction: recovery.action,
          message: normalized.message, httpStatus: normalized.status, timeoutMs: effectiveTimeoutMs
        });
        eventBus.publish('ai:job-model-failed', {
          jobId, task: routedTask, requestedTask: task, modelId: model.id, model: model.name,
          role: candidate.role, emergencyMode: candidate.emergencyMode, qualityTier: modelQuality.qualityTier,
          error: normalized.message, code: normalized.code, reasonCode: recovery.reasonCode,
          recoveryAction: recovery.action, httpStatus: normalized.status
        });
        const reduction = recovery.reasonCode === 'TIMEOUT' && options.contextReductionBeforeFallback !== false
          ? aiContextReductionPolicy.reduceMessages(messages, { task: routedTask, targetRatio: options.contextReductionRatio })
          : { changed: false, reasonCode: 'NOT_REQUESTED', messages };
        if (reduction.changed) {
          eventBus.publish('ai:job-context-reduced-retry', {
            jobId, task: routedTask, requestedTask: task, modelId: model.id, model: model.name,
            originalChars: reduction.originalChars, reducedChars: reduction.reducedChars,
            reductionRatio: reduction.reductionRatio, originalHash: reduction.originalHash, reducedHash: reduction.reducedHash
          });
          try {
            const reducedRawResult = await this.executeModelAttempt({
              jobId,
              model,
              messages: reduction.messages,
              options: {
              maxTokens: effectiveMaxTokens,
              timeoutMs: effectiveTimeoutMs,
              temperature: options.temperature,
              json: options.json,
              keepAlive: options.keepAlive,
              onToken: fencedOnToken
              },
              signal,
              updateProvider,
              bindExecution
            });
            const reducedResult = normalizeModelResult(reducedRawResult, options);
            assertCommitAllowed();
            await this.registry.recordInvocation(model.id, reducedResult);
            assertCommitAllowed();
            this.noteSuccess(model.id);
            attempts.push({
              modelId: model.id, model: model.name, role: candidate.role, emergencyMode: candidate.emergencyMode,
              qualityTier: modelQuality.qualityTier, status: 'success', code: '', message: '', httpStatus: 0,
              timeoutMs: effectiveTimeoutMs, contextReduced: true, recoveryPhase: 'same-model-reduced-context',
              originalContextChars: reduction.originalChars, reducedContextChars: reduction.reducedChars,
              contextReductionReceipt: reduction
            });
            const fallbackUsed = candidate.role !== 'primary';
            const qualityRouteReceipt = aiQualityRouteAuthority.routeReceipt({
              task: routedTask, selectedModel: model, routePlan: route.qualityPlan,
              fallbackUsed, emergencyMode: candidate.emergencyMode, attempts
            });
            eventBus.publish('ai:job-complete', {
              jobId, task: routedTask, requestedTask: task, modelId: model.id, model: model.name,
              fallbackUsed, emergencyMode: candidate.emergencyMode, learningEligible: qualityRouteReceipt.learningEligible,
              qualityTier: qualityRouteReceipt.qualityTier, qualityRouteReceipt, attempts, metrics: reducedResult,
              contextReductionReceipt: reduction
            });
            return {
              jobId, task: routedTask, requestedTask: task, modelId: model.id, model: model.name,
              fallbackUsed, emergencyMode: candidate.emergencyMode, learningEligible: qualityRouteReceipt.learningEligible,
              qualityTier: qualityRouteReceipt.qualityTier, qualityDegraded: qualityRouteReceipt.qualityDegraded,
              highCapabilityPath: qualityRouteReceipt.highCapabilityPath,
              qualityRouteReceipt,
              conditionalRoute: route.conditional === true,
              humanReviewRequired: route.humanReviewRequired === true || candidate.emergencyMode,
              effectiveTimeoutMs, effectiveMaxTokens, attempts, contextReductionReceipt: reduction, ...reducedResult
            };
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
            const reducedNormalized = normalizeModelError(reducedError);
            const reducedRecovery = aiQualityRouteAuthority.classifyFailure(reducedNormalized);
            attempts.push({
              modelId: model.id, model: model.name, role: candidate.role, emergencyMode: candidate.emergencyMode,
              qualityTier: modelQuality.qualityTier, status: 'failed', code: reducedNormalized.code,
              reasonCode: reducedRecovery.reasonCode, recoveryAction: reducedRecovery.action,
              message: reducedNormalized.message, httpStatus: reducedNormalized.status, timeoutMs: effectiveTimeoutMs,
              contextReduced: true, recoveryPhase: 'same-model-reduced-context',
              originalContextChars: reduction.originalChars, reducedContextChars: reduction.reducedChars
            });
            const reducedCountForCircuit = shouldCountModelFailure(reducedNormalized);
            if (reducedCountForCircuit) this.noteFailure(model.id);
            if (!['MODEL_CANCELLED', 'JOB_CANCELLED', 'MODEL_REQUEST_DISCONNECTED'].includes(String(reducedNormalized.code || '').toUpperCase())) {
              await this.registry.recordInvocationFailure(model.id, reducedError, { countForCircuit: reducedCountForCircuit });
            }
            eventBus.publish('ai:job-context-reduced-retry-failed', {
              jobId, task: routedTask, requestedTask: task, modelId: model.id, model: model.name,
              code: reducedNormalized.code, reasonCode: reducedRecovery.reasonCode,
              recoveryAction: 'switch_same_tier_after_context_reduction',
              originalChars: reduction.originalChars, reducedChars: reduction.reducedChars
            });
            continue;
          }
        }
        const countForCircuit = shouldCountModelFailure(normalized);
        if (countForCircuit) this.noteFailure(model.id);
        if (!['MODEL_CANCELLED', 'JOB_CANCELLED', 'MODEL_REQUEST_DISCONNECTED'].includes(String(normalized.code || '').toUpperCase())) {
          await this.registry.recordInvocationFailure(model.id, error, { countForCircuit });
        }
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
    const routeResolution = this.resolveRoute(task, modelId);
    const configuredTimeoutMs = Number(routeResolution.route?.timeoutMs || 0);
    const physicalProviderKey = cleanModelId(
      routeResolution.primary?.providerId || routeResolution.primary?.provider || routeResolution.primary?.id
      || routeResolution.fallback?.providerId || routeResolution.fallback?.provider || routeResolution.fallback?.id
      || modelId || task
    );
    const effectiveOptions = {
      ...options,
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
