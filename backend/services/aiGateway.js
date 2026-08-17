'use strict';

const { randomUUID } = require('crypto');
const registry = require('./modelRegistry');
const modelBrainRuntime = require('./modelBrainRuntime');
const modelBrainProjection = require('./modelBrainProjection');
const eventBus = require('./eventBus');
const logger = require('./logger');
const { getSecurityGuard } = require('../core/securityGuardSingleton');

const securityGuard = getSecurityGuard();
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
  speech_transcription: 240000,
  probe: 60000
});

function clean(value) { return String(value == null ? '' : value).trim(); }
function finiteNonNegative(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}
function taskPriority(task, options = {}) {
  if (Number.isFinite(Number(options.priority))) return Number(options.priority);
  const value = clean(task);
  if (['quick_reply', 'deep_reply', 'director'].includes(value)) return 100;
  if (value === 'translation') return options.background === true ? 35 : 70;
  return options.background === true ? 20 : 55;
}
function resolveQueueTimeoutMs(task, { queueTimeoutMs, options = {}, background = false } = {}) {
  const taskFloor = TASK_QUEUE_TIMEOUT_FLOORS[clean(task)] || 180000;
  const environmentFloor = finiteNonNegative(
    background ? process.env.YANCE_AI_BACKGROUND_QUEUE_TIMEOUT_MS : process.env.YANCE_AI_INTERACTIVE_QUEUE_TIMEOUT_MS,
    background ? 300000 : 180000
  );
  const executionBudget = finiteNonNegative(options.timeoutMs, 0);
  const explicitBudget = queueTimeoutMs == null ? 0 : finiteNonNegative(queueTimeoutMs, 0);
  return Math.max(taskFloor, environmentFloor, executionBudget, explicitBudget);
}
function normalizeTaskContext(context = {}, task = '') {
  const value = context && typeof context === 'object' ? context : {};
  const platform = clean(value.platform).toLowerCase();
  const sourceAccountId = clean(value.sourceAccountId || value.accountId);
  const sessionKey = clean(value.sessionKey || value.conversationId);
  const generation = clean(value.generation || value.analysisGeneration || value.contextVersion);
  const scopeKey = clean(value.scopeKey) || [platform, sourceAccountId, sessionKey, clean(task)].filter(Boolean).join('|');
  return {
    platform,
    sourceAccountId,
    sessionKey,
    requestId: clean(value.requestId),
    generation,
    scopeKey,
    contactId: clean(value.contactId),
    conversationId: clean(value.conversationId || sessionKey),
    runtimeBuild: clean(value.runtimeBuild)
  };
}
function staleContextError(context = {}) {
  return Object.assign(new Error('AI任务结果已过期，已丢弃，未写入当前会话'), {
    code: 'AI_STALE_RESULT',
    status: 409,
    context
  });
}
function assertExecutionCommitAllowed({ signal, executionId = '', expectedGeneration = '', currentGeneration = '' } = {}) {
  const expected = clean(expectedGeneration);
  const current = clean(typeof currentGeneration === 'function' ? currentGeneration() : currentGeneration);
  if (!signal?.aborted && (!expected || expected === current)) return;
  throw Object.assign(new Error('AI execution result is stale'), {
    code: 'AI_STALE_EXECUTION_RESULT',
    executionId: clean(executionId),
    reason: clean(signal?.reason?.code || (expected && expected !== current ? 'GENERATION_SUPERSEDED' : 'MODEL_CANCELLED'))
  });
}
function credentialEnvelope(candidates = []) {
  const result = {};
  for (const model of candidates) {
    const ref = clean(model.credentialRef);
    if (!ref || Object.prototype.hasOwnProperty.call(result, ref)) continue;
    const row = securityGuard.credentials.get(ref) || {};
    result[ref] = {
      apiKey: clean(row.apiKey || row.key || row.token),
      endpoint: clean(row.endpoint || row.baseUrl || model.endpoint),
      model: clean(row.model || row.modelName || model.modelName || model.name)
    };
  }
  return result;
}
class PQueueSchedulerAdapter {
  constructor({ concurrency = 2, name = 'model-brain' } = {}) {
    this.name = clean(name) || 'model-brain';
    this.concurrency = Math.max(1, Number(concurrency || 1));
    this.queue = null;
    this.queuePromise = null;
    this.queueLoadState = 'idle';
    this.queueLoadError = '';
    this.controllers = new Map();
    this.pending = new Map();
    this.running = new Map();
    this.completed = new Map();
    this.sequence = 0;
  }
  _rememberCompletion(id, record) {
    this.completed.set(id, Object.freeze({ id, ...record }));
    while (this.completed.size > 50) this.completed.delete(this.completed.keys().next().value);
  }
  async _loadQueue() {
    if (this.queuePromise) return this.queuePromise;
    this.queueLoadState = 'loading';
    this.queuePromise = import('p-queue').then(module => {
      const PQueue = module?.default;
      if (typeof PQueue !== 'function') {
        throw Object.assign(new Error('p-queue default export is unavailable'), {
          code: 'P_QUEUE_MODULE_INVALID'
        });
      }
      this.queue = new PQueue({ concurrency: this.concurrency });
      this.queueLoadState = 'ready';
      return this.queue;
    }).catch(error => {
      this.queueLoadState = 'failed';
      this.queueLoadError = clean(error?.code || error?.message || error);
      throw error;
    });
    return this.queuePromise;
  }
  add(task, meta = {}) {
    if (typeof task !== 'function') throw new TypeError('PQueueSchedulerAdapter task must be a function');
    const id = clean(meta.id || meta.jobId) || `${this.name}-${++this.sequence}`;
    if (this.controllers.has(id) || this.pending.has(id) || this.running.has(id)) {
      throw Object.assign(new Error(`Duplicate p-queue task id: ${id}`), { code: 'P_QUEUE_TASK_ID_DUPLICATE', id });
    }
    const priority = Number.isFinite(Number(meta.priority)) ? Number(meta.priority) : 0;
    const queueTimeoutMs = Math.max(0, Number(meta.queueTimeoutMs || 0));
    const externalSignal = meta.signal;
    const publicMeta = { ...meta, priority, queueTimeoutMs };
    delete publicMeta.signal;
    const controller = new AbortController();
    const pending = Object.freeze({ id, meta: Object.freeze(publicMeta), createdAt: Date.now() });
    this.controllers.set(id, controller);
    this.pending.set(id, pending);

    let detachExternalAbort = () => {};
    if (externalSignal?.addEventListener) {
      const onExternalAbort = () => {
        if (!this.pending.has(id) || controller.signal.aborted) return;
        controller.abort(externalSignal.reason || Object.assign(new Error('Queued AI task cancelled'), {
          code: 'JOB_CANCELLED',
          taskId: id
        }));
      };
      detachExternalAbort = () => externalSignal.removeEventListener?.('abort', onExternalAbort);
      if (externalSignal.aborted) onExternalAbort();
      else externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }

    let queueTimer = null;
    if (queueTimeoutMs > 0) {
      queueTimer = setTimeout(() => {
        if (!this.pending.has(id) || controller.signal.aborted) return;
        controller.abort(Object.assign(new Error('AI任务排队超时，尚未开始运行'), {
          code: 'AI_QUEUE_TIMEOUT',
          taskId: id
        }));
      }, queueTimeoutMs);
    }

    // Keep running work inside p-queue until the task itself settles; execution deadlines and
    // provider termination remain downstream runtime responsibilities, not scheduler authority.
    const promise = this._loadQueue().then(queue => queue.add(async ({ signal }) => {
      if (queueTimer) clearTimeout(queueTimer);
      detachExternalAbort();
      this.pending.delete(id);
      const startedAt = Date.now();
      this.running.set(id, Object.freeze({ id, meta: pending.meta, startedAt }));
      try {
        const value = await task({ signal });
        this._rememberCompletion(id, { ok: true, durationMs: Date.now() - startedAt, at: new Date().toISOString() });
        return value;
      } catch (error) {
        this._rememberCompletion(id, {
          ok: false,
          durationMs: Date.now() - startedAt,
          at: new Date().toISOString(),
          code: clean(error?.code || error?.name || 'P_QUEUE_TASK_FAILED')
        });
        throw error;
      } finally {
        this.running.delete(id);
      }
    }, {
      id,
      priority,
      signal: controller.signal
    })).finally(() => {
      if (queueTimer) clearTimeout(queueTimer);
      detachExternalAbort();
      this.pending.delete(id);
      this.controllers.delete(id);
    });

    return Object.freeze({ id, promise });
  }
  // Cancellation is intentionally queued-only. Running work retains its concurrency slot until settlement.
  cancel(id) {
    const key = clean(id);
    const controller = this.controllers.get(key);
    if (!controller || !this.pending.has(key) || controller.signal.aborted) return false;
    controller.abort(Object.assign(new Error('Queued AI task cancelled'), {
      code: 'JOB_CANCELLED',
      taskId: key
    }));
    return true;
  }
  status() {
    return {
      name: this.name,
      scheduler: 'p-queue@9.3.1',
      moduleState: this.queueLoadState,
      moduleError: this.queueLoadError,
      concurrency: this.concurrency,
      pending: [...this.pending.values()],
      running: [...this.running.values()],
      completed: [...this.completed.values()],
      pQueue: this.queue ? { size: this.queue.size, pending: this.queue.pending } : { size: 0, pending: 0 }
    };
  }
}

function normalizeRuntimeResult(result = {}, task = '') {
  const evidence = result.evidence || {};
  return {
    ...result,
    task: clean(task),
    modelId: clean(evidence.selectedModel),
    model: clean(evidence.selectedModel),
    provider: clean(evidence.provider),
    latencyMs: Number(evidence.latencyMs || 0),
    totalTokens: Number(evidence.totalTokens || result.usage?.total_tokens || 0),
    inputTokens: Number(evidence.inputTokens || result.usage?.prompt_tokens || 0),
    outputTokens: Number(evidence.outputTokens || result.usage?.completion_tokens || 0),
    costUsd: Number(evidence.costUsd || 0),
    retryCount: Number(evidence.retryCount || 0),
    fallbackCount: Number(evidence.fallbackCount || 0),
    fallbackUsed: Number(evidence.fallbackCount || 0) > 0
  };
}

class AiGateway {
  constructor(options = {}) {
    this.registry = options.registry || registry;
    this.runtime = options.runtime || modelBrainRuntime;
    this.jobs = new Map();
    this.controllers = new Map();
    this.queueIds = new Map();
    this.dedupe = new Map();
    this.latestContextGenerations = new Map();
    this.contextJobs = new Map();
    this.jobRetentionLimit = Math.max(50, Number(process.env.YANCE_AI_JOB_RETENTION || 500));
    const concurrency = Math.max(1, Number(options.concurrency || process.env.YANCE_AI_CONCURRENCY || 2));
    this.queue = options.queue || new PQueueSchedulerAdapter({
      concurrency,
      name: 'model-brain'
    });
  }
  prepare() { return this.runtime.status(); }
  registerTaskContext(jobId, task, rawContext = {}) {
    const context = normalizeTaskContext(rawContext, task);
    if (!context.scopeKey || !context.generation) return context;
    const previous = this.latestContextGenerations.get(context.scopeKey);
    if (previous && previous !== context.generation) {
      for (const id of this.contextJobs.get(context.scopeKey) || []) this.cancel(id);
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
  _pruneJobs() {
    if (this.jobs.size < this.jobRetentionLimit) return;
    for (const [id, row] of this.jobs) {
      if (this.jobs.size < this.jobRetentionLimit) break;
      if (['completed', 'failed', 'cancelled'].includes(row.status)) this.jobs.delete(id);
    }
  }
  projection(task, options = {}, modelId = '') {
    const state = this.registry.read();
    const projection = modelBrainProjection.project(state, {
      task,
      constraints: {
        ...(options.constraints || {}),
        localOnly: options.localOnly === true || options.constraints?.localOnly === true
      }
    });
    if (clean(task) !== 'probe' || !clean(modelId)) return projection;
    const candidates = projection.catalog.filter(row => row.id === clean(modelId) && row.enabled);
    return Object.freeze({ ...projection, candidates: Object.freeze(candidates), catalog: Object.freeze(candidates) });
  }
  async _run({ jobId, task, messages, modelId = '', options = {}, signal, context = {} }) {
    assertExecutionCommitAllowed({ signal, executionId: jobId, expectedGeneration: context.generation, currentGeneration: () => this.latestContextGenerations.get(context.scopeKey) || context.generation });
    const projection = this.projection(task, options, modelId);
    if (!projection.candidates.length) {
      throw Object.assign(new Error(`任务 ${task} 没有满足硬资格条件的 Model Brain deployment`), {
        code: 'MODEL_BRAIN_NO_ELIGIBLE_DEPLOYMENT',
        status: 503,
        hardEligibility: projection.hardEligibility
      });
    }
    const payload = {
      requestId: jobId,
      modelGroup: projection.modelGroup,
      logicalModel: projection.logicalModel,
      tags: projection.tags,
      catalog: projection.candidates,
      credentials: credentialEnvelope(projection.candidates),
      messages,
      complexity: options.complexity || null,
      options: {
        timeoutMs: Number(options.timeoutMs || TASK_QUEUE_TIMEOUT_FLOORS[clean(task)] || 180000),
        maxTokens: options.maxTokens,
        temperature: options.temperature,
        json: options.json === true,
        numRetries: options.numRetries,
        maxFallbacks: options.maxFallbacks
      }
    };
    eventBus.publish('ai:job-started', { jobId, task, modelBrain: true, logicalModel: projection.logicalModel, candidateCount: projection.candidates.length });
    const raw = clean(task) === 'probe' ? await this.runtime.probe(payload) : await this.runtime.execute(payload);
    assertExecutionCommitAllowed({ signal, executionId: jobId, expectedGeneration: context.generation, currentGeneration: () => this.latestContextGenerations.get(context.scopeKey) || context.generation });
    const result = normalizeRuntimeResult(raw, task);
    eventBus.publish('ai:job-complete', { jobId, task, modelBrain: true, evidence: result.evidence });
    return result;
  }
  submit({ task, messages, modelId = '', options = {}, signal: externalSignal = null, priority, queueTimeoutMs, background = false, context: rawContext = {} }) {
    const jobId = randomUUID();
    const context = this.registerTaskContext(jobId, task, rawContext);
    const controller = new AbortController();
    const relayExternal = () => controller.abort(externalSignal?.reason || Object.assign(new Error('MODEL_CANCELLED'), { code: 'MODEL_CANCELLED' }));
    if (externalSignal?.aborted) relayExternal();
    else externalSignal?.addEventListener?.('abort', relayExternal, { once: true });
    this.controllers.set(jobId, controller);
    this._pruneJobs();
    this.jobs.set(jobId, { jobId, task, status: 'queued', createdAt: new Date().toISOString(), context, result: null, error: null });
    const timeoutMs = Math.max(1000, Number(options.timeoutMs || TASK_QUEUE_TIMEOUT_FLOORS[clean(task)] || 180000));
    const queued = this.queue.add(async ({ signal }) => {
      const relay = () => controller.abort(signal.reason || Object.assign(new Error('JOB_CANCELLED'), { code: 'JOB_CANCELLED' }));
      if (signal.aborted) relay(); else signal.addEventListener('abort', relay, { once: true });
      const row = this.jobs.get(jobId);
      if (row) { row.status = 'running'; row.startedAt = new Date().toISOString(); }
      try {
        this.assertTaskContextCurrent(context);
        const result = await this._run({ jobId, task, messages, modelId, options: { ...options, timeoutMs }, signal: controller.signal, context });
        this.assertTaskContextCurrent(context);
        const current = this.jobs.get(jobId);
        if (current && current.status === 'running') {
          current.status = 'completed'; current.completedAt = new Date().toISOString(); current.result = result;
        }
        return result;
      } catch (error) {
        const current = this.jobs.get(jobId);
        if (current && current.status === 'running') {
          current.status = controller.signal.aborted ? 'cancelled' : 'failed';
          current.completedAt = new Date().toISOString();
          current.error = { code: error.code || 'MODEL_BRAIN_JOB_FAILED', message: error.message || String(error), status: Number(error.status || 0) };
        }
        throw error;
      } finally {
        signal.removeEventListener?.('abort', relay);
        externalSignal?.removeEventListener?.('abort', relayExternal);
        this.controllers.delete(jobId);
        this.releaseTaskContext(jobId, context);
      }
    }, {
      task,
      jobId,
      priority: taskPriority(task, { priority, background }),
      queueTimeoutMs: resolveQueueTimeoutMs(task, { queueTimeoutMs, options: { ...options, timeoutMs }, background }),
      executionTimeoutMs: timeoutMs + 5000,
      executionTimeoutCode: 'AI_EXECUTION_TIMEOUT',
      background: background === true,
      providerKey: 'model-brain',
      signal: controller.signal
    });
    this.queueIds.set(jobId, queued.id);
    queued.promise.catch(error => {
      const current = this.jobs.get(jobId);
      if (current && current.status === 'queued') {
        current.status = error?.code === 'JOB_CANCELLED' || controller.signal.aborted ? 'cancelled' : 'failed';
        current.completedAt = new Date().toISOString();
        current.error = {
          code: error?.code || 'MODEL_BRAIN_QUEUE_FAILED',
          message: error?.message || String(error),
          status: Number(error?.status || 0)
        };
      }
      logger.warn('ai', 'model-brain-job-failed', { jobId, task, reasonCode: error?.code || 'MODEL_BRAIN_QUEUE_FAILED', error: error?.message || String(error) });
    }).finally(() => {
      this.queueIds.delete(jobId);
      externalSignal?.removeEventListener?.('abort', relayExternal);
      this.controllers.delete(jobId);
      this.releaseTaskContext(jobId, context);
    });
    return { jobId };
  }
  async waitForJob(jobId) {
    for (;;) {
      const row = this.jobs.get(jobId);
      if (!row) throw Object.assign(new Error('AI_JOB_LOST'), { code: 'AI_JOB_LOST' });
      if (row.status === 'completed') return row.result;
      if (row.status === 'failed' || row.status === 'cancelled') {
        throw Object.assign(new Error(row.error?.message || 'AI任务失败'), { code: row.error?.code || 'MODEL_BRAIN_JOB_FAILED', status: Number(row.error?.status || 0) });
      }
      await new Promise(resolve => setTimeout(resolve, 40));
    }
  }
  async execute(payload = {}) {
    const dedupeKey = clean(payload.dedupeKey);
    const fingerprint = clean(payload.fingerprint);
    if (dedupeKey) {
      const existing = this.dedupe.get(dedupeKey);
      if (existing && fingerprint && existing.fingerprint === fingerprint) return existing.promise;
      if (existing) this.cancel(existing.jobId);
    }
    const { jobId } = this.submit(payload);
    const promise = this.waitForJob(jobId);
    if (dedupeKey) this.dedupe.set(dedupeKey, { jobId, fingerprint, promise });
    try { return await promise; }
    finally { if (dedupeKey && this.dedupe.get(dedupeKey)?.jobId === jobId) this.dedupe.delete(dedupeKey); }
  }
  getJob(jobId) { return this.jobs.get(jobId) || null; }
  listJobs() { return [...this.jobs.values()].slice(-200); }
  cancel(jobId) {
    const controller = this.controllers.get(jobId);
    const queueId = this.queueIds.get(jobId);
    const queued = queueId ? this.queue.cancel(queueId) : false;
    if (controller) controller.abort(Object.assign(new Error('MODEL_CANCELLED'), { code: 'MODEL_CANCELLED' }));
    const row = this.jobs.get(jobId);
    if (row && !['completed', 'failed'].includes(row.status)) {
      row.status = 'cancelled'; row.completedAt = new Date().toISOString(); row.error = { code: 'MODEL_CANCELLED', message: '任务已取消' };
    }
    return Boolean(controller || queued || row);
  }
  status() {
    return {
      modelBrain: this.runtime.status(),
      projection: { authority: 'LiteLLM v1.95.0', hardEligibility: ['privacy', 'local/cloud', 'modality', 'language', 'context', 'provider'] },
      queue: this.queue.status(),
      jobs: this.listJobs(),
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

module.exports.PQueueSchedulerAdapter = PQueueSchedulerAdapter;
