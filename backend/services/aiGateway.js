'use strict';

const { randomUUID, createHash } = require('crypto');
const registry = require('./modelRegistry');
const modelBrainRuntime = require('./modelBrainRuntime');
const modelBrainProjection = require('./modelBrainProjection');
const eventBus = require('./eventBus');
const logger = require('./logger');
const { getSecurityGuard } = require('../core/securityGuardSingleton');
const openAiCompatibleClient = require('./openAiCompatibleClient');
const ollamaClient = require('./ollamaClient');
const { currentRuntimeInternalOperationAuthority } = require('./durableInternalOperationAuthority');

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
function aiRuntimePersistedAttemptError(field = '') {
  return Object.assign(new Error('Persisted RUNNING AI operation is required before Model Brain physical execution'), {
    code: 'WP_B_AI_RUNTIME_PERSISTED_ATTEMPT_REQUIRED',
    field: clean(field)
  });
}
function validateRuntimePersistedOperation(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.isFrozen(value)) {
    throw aiRuntimePersistedAttemptError('operation');
  }
  if (clean(value.operationKind) !== 'AI_PROVIDER_EXECUTION') throw aiRuntimePersistedAttemptError('operationKind');
  if (clean(value.state) !== 'RUNNING') throw aiRuntimePersistedAttemptError('state');
  for (const field of ['operationId', 'executionId', 'ownerId', 'claimId', 'leaseExpiresAt']) {
    if (!clean(value[field])) throw aiRuntimePersistedAttemptError(field);
  }
  for (const field of ['generation', 'hostGeneration', 'fencingToken']) {
    if (!Number.isSafeInteger(Number(value[field])) || Number(value[field]) < 1) throw aiRuntimePersistedAttemptError(field);
  }
  return value;
}
function durableAiOperationFingerprint({ jobId = '', task = '', modelId = '', context = {} } = {}) {
  return createHash('sha256').update([
    clean(jobId), clean(task), clean(modelId), clean(context.scopeKey), clean(context.generation), clean(context.requestId)
  ].join('\n'), 'utf8').digest('hex');
}
function durableAiTerminalReceipt(result = {}) {
  const evidence = result?.evidence || {};
  return Object.freeze({
    status: 'completed',
    modelId: clean(evidence.selectedModel || result.modelId || result.model),
    providerRequestId: clean(evidence.requestId || result.providerRequestId)
  });
}

function persistedAiAttemptError(field = '') {
  return Object.assign(new Error('Persisted AI attempt identity is required before Model Brain physical execution'), {
    code: 'WP_B_AI_PERSISTED_ATTEMPT_REQUIRED',
    field: clean(field)
  });
}
function requiredPersistedAiString(value, field, maximum = 2048) {
  const result = clean(value);
  if (!result || result.length > maximum || /[\u0000-\u001f\u007f]/u.test(result)) {
    throw persistedAiAttemptError(field);
  }
  return result;
}
function requiredPersistedAiInteger(value, field) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 1) throw persistedAiAttemptError(field);
  return result;
}
function validatePersistedAiPhysicalInput(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !Object.isFrozen(input)) {
    throw persistedAiAttemptError('attempt');
  }
  const credential = input.credential;
  if (!credential || typeof credential !== 'object' || Array.isArray(credential) || !Object.isFrozen(credential)) {
    throw persistedAiAttemptError('credential');
  }
  const requestContentSha256 = requiredPersistedAiString(input.requestContentSha256, 'requestContentSha256', 64);
  if (!/^[a-f0-9]{64}$/u.test(requestContentSha256)) throw persistedAiAttemptError('requestContentSha256');
  const messages = input.messages;
  if (!Array.isArray(messages) || !messages.length || !Object.isFrozen(messages)) {
    throw persistedAiAttemptError('messages');
  }
  const options = input.options == null ? Object.freeze({}) : input.options;
  if (!options || typeof options !== 'object' || Array.isArray(options) || !Object.isFrozen(options)) {
    throw persistedAiAttemptError('options');
  }
  return Object.freeze({
    executionId: requiredPersistedAiString(input.executionId, 'executionId'),
    intentId: requiredPersistedAiString(input.intentId, 'intentId'),
    attemptId: requiredPersistedAiString(input.attemptId, 'attemptId'),
    claimId: requiredPersistedAiString(input.claimId, 'claimId'),
    ownerId: requiredPersistedAiString(input.ownerId, 'ownerId'),
    generation: requiredPersistedAiInteger(input.generation, 'generation'),
    hostGeneration: requiredPersistedAiInteger(input.hostGeneration, 'hostGeneration'),
    fencingToken: requiredPersistedAiInteger(input.fencingToken, 'fencingToken'),
    idempotencyKey: requiredPersistedAiString(input.idempotencyKey, 'idempotencyKey'),
    requestContentSha256,
    credential,
    task: requiredPersistedAiString(input.task || 'reply', 'task', 128),
    modelReference: requiredPersistedAiString(input.modelReference, 'modelReference'),
    messages,
    options
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
    this.internalOperationAuthorityProvider = options.internalOperationAuthorityProvider || currentRuntimeInternalOperationAuthority;
    this.openAiClient = options.openAiClient || openAiCompatibleClient;
    this.ollamaClient = options.ollamaClient || ollamaClient;
    this.securityGuard = options.securityGuard || securityGuard;
    this.jobs = new Map();
    this.controllers = new Map();
    this.queueIds = new Map();
    this.queueAuthorities = new Map();
    this.dedupe = new Map();
    this.latestContextGenerations = new Map();
    this.contextJobs = new Map();
    this.jobRetentionLimit = Math.max(50, Number(process.env.YANCE_AI_JOB_RETENTION || 500));
    const concurrency = Math.max(1, Number(options.concurrency || process.env.YANCE_AI_CONCURRENCY || 2));
    const localAuxiliaryConcurrency = Math.max(1, Number(options.localAuxiliaryConcurrency || process.env.YANCE_AI_LOCAL_AUXILIARY_CONCURRENCY || 1));
    this.queue = options.queue || new PQueueSchedulerAdapter({
      concurrency,
      name: 'model-brain'
    });
    this.localAuxiliaryQueue = options.localAuxiliaryQueue || new PQueueSchedulerAdapter({
      concurrency: localAuxiliaryConcurrency,
      name: 'local-auxiliary'
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
  _internalOperationAuthority() {
    const authority = this.internalOperationAuthorityProvider();
    if (!authority || typeof authority.create !== 'function' || typeof authority.start !== 'function'
        || typeof authority.succeed !== 'function' || typeof authority.fail !== 'function') {
      throw Object.assign(new Error('Durable AI operation authority is unavailable'), { code: 'WP_B_RUNTIME_INTERNAL_OPERATION_AUTHORITY_REQUIRED' });
    }
    return authority;
  }
  _providerAdminFingerprint(operationType, parts = []) {
    return createHash('sha256').update([clean(operationType), ...parts.map(clean)].join('\n'), 'utf8').digest('hex');
  }
  async _runDurableProviderAdmin({ operationType, scopeKey, fingerprintParts = [], work, receipt = () => ({ status: 'completed' }) }) {
    if (typeof work !== 'function') throw new TypeError('Durable provider administration requires physical work');
    const authority = this._internalOperationAuthority();
    const operationId = `ai-provider-admin-${randomUUID()}`;
    const objectFingerprint = this._providerAdminFingerprint(operationType, fingerprintParts);
    const persisted = authority.create({
      operationId,
      operationType,
      scopeKey: clean(scopeKey) || `ai-provider-admin:${operationType}`,
      objectFingerprint,
      traceId: operationId,
      maxAttempts: 1
    });
    if (clean(persisted?.operation?.state) !== 'SCHEDULED') {
      throw Object.assign(new Error('Durable provider administration was not scheduled before physical I/O'), {
        code: 'WP_B_AI_OPERATION_SCHEDULE_REQUIRED', operationId
      });
    }
    const running = authority.start(operationId, { progress: 1 }).operation;
    validateRuntimePersistedOperation(running);
    try {
      const result = await work(running);
      authority.succeed(operationId, receipt(result), {
        generation: running.generation,
        objectFingerprint,
        reasonCode: 'AI_PROVIDER_ADMIN_SUCCEEDED'
      });
      return result;
    } catch (error) {
      if (error?.code === 'MODEL_CANCELLED' && typeof authority.cancel === 'function') {
        authority.cancel(operationId, { reasonCode: 'MODEL_CANCELLED' }, {
          generation: running.generation,
          objectFingerprint,
          reasonCode: 'MODEL_CANCELLED'
        });
      } else {
        authority.fail(operationId, { errorCode: clean(error?.code || 'AI_PROVIDER_ADMIN_FAILED') }, {
          retryable: false,
          generation: running.generation,
          objectFingerprint,
          reasonCode: clean(error?.code || 'AI_PROVIDER_ADMIN_FAILED')
        });
      }
      throw error;
    }
  }
  _cloudCredential(credentialRef, fallbackEndpoint = '') {
    const ref = clean(credentialRef);
    if (!ref) throw Object.assign(new Error('Cloud model credential reference is required'), { code: 'CLOUD_MODEL_CREDENTIAL_MISSING' });
    const row = securityGuard.credentials.get(ref) || {};
    const apiKey = this.openAiClient.normalizeApiKey(row.apiKey || row.key || row.token);
    const endpoint = this.openAiClient.normalizeEndpoint(row.endpoint || row.baseUrl || fallbackEndpoint);
    return Object.freeze({ credentialRef: ref, apiKey, endpoint });
  }
  assertCloudCredential(credentialRef, fallbackEndpoint = '') {
    const credential = this._cloudCredential(credentialRef, fallbackEndpoint);
    return Object.freeze({ credentialRef: credential.credentialRef, endpoint: credential.endpoint });
  }
  normalizeCloudEndpoint(value = '') { return this.openAiClient.normalizeEndpoint(value); }
  async listCloudModels({ endpoint = '', credentialRef = '', timeoutMs = 30000 } = {}) {
    const credential = this._cloudCredential(credentialRef, endpoint);
    return this._runDurableProviderAdmin({
      operationType: 'ai.provider-admin.cloud-list',
      scopeKey: `cloud-list:${credential.credentialRef}`,
      fingerprintParts: [credential.endpoint, credential.credentialRef],
      work: () => this.openAiClient.listModels({ endpoint: credential.endpoint, apiKey: credential.apiKey, timeoutMs }),
      receipt: () => ({ status: 'completed' })
    });
  }
  async requestOpenAiJson({ url = '', credentialRef = '', timeoutMs = 30000, method = 'GET', body, signal = null } = {}) {
    const credential = this._cloudCredential(credentialRef, url);
    return this._runDurableProviderAdmin({
      operationType: 'ai.provider-admin.cloud-request',
      scopeKey: `cloud-request:${credential.credentialRef}`,
      fingerprintParts: [url, method, credential.credentialRef],
      work: () => this.openAiClient.requestJson(url, { apiKey: credential.apiKey, timeoutMs, method, body, signal }),
      receipt: () => ({ status: 'completed', provider: 'openai-compatible' })
    });
  }
  async discoverLocalModels() {
    return this._runDurableProviderAdmin({
      operationType: 'ai.provider-admin.local-discover',
      scopeKey: 'local-model-discovery',
      fingerprintParts: ['ollama'],
      work: () => this.ollamaClient.discover(),
      receipt: () => ({ status: 'completed' })
    });
  }
  async pullLocalModel(endpoint, model, options = {}) {
    return this._runDurableProviderAdmin({
      operationType: 'ai.provider-admin.local-pull',
      scopeKey: `local-model:${clean(model)}`,
      fingerprintParts: [endpoint, model],
      work: () => this.ollamaClient.pull(endpoint, model, options),
      receipt: result => ({ status: 'completed', modelId: clean(result?.model || model) })
    });
  }
  async removeLocalModel(endpoint, model) {
    return this._runDurableProviderAdmin({
      operationType: 'ai.provider-admin.local-remove',
      scopeKey: `local-model:${clean(model)}`,
      fingerprintParts: [endpoint, model],
      work: () => this.ollamaClient.remove(endpoint, model),
      receipt: () => ({ status: 'completed', modelId: clean(model) })
    });
  }
  async unloadLocalModel(endpoint, model) {
    return this._runDurableProviderAdmin({
      operationType: 'ai.provider-admin.local-unload',
      scopeKey: `local-model:${clean(model)}`,
      fingerprintParts: [endpoint, model],
      work: () => this.ollamaClient.unload(endpoint, model),
      receipt: () => ({ status: 'completed', modelId: clean(model) })
    });
  }
  async _run({ jobId, task, messages, modelId = '', options = {}, signal, context = {}, persistedOperation = null }) {
    validateRuntimePersistedOperation(persistedOperation);
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
    const result = normalizeRuntimeResult(raw, task);
    try {
      assertExecutionCommitAllowed({ signal, executionId: jobId, expectedGeneration: context.generation, currentGeneration: () => this.latestContextGenerations.get(context.scopeKey) || context.generation });
    } catch (error) {
      error.physicalSucceeded = true;
      error.physicalResult = result;
      throw error;
    }
    eventBus.publish('ai:job-complete', { jobId, task, modelBrain: true, evidence: result.evidence });
    return result;
  }
  async performPersistedAttempt(input = {}) {
    const {
      executionId: executionKey,
      intentId: intentKey,
      attemptId: attemptKey,
      claimId: claimKey,
      ownerId: ownerKey,
      generation: attemptGeneration,
      hostGeneration: hostEpoch,
      fencingToken: fence,
      idempotencyKey: idempotencyScope,
      requestContentSha256: requestFingerprint,
      credential: credentialCapability,
      task: taskKey,
      modelReference: modelKey,
      messages: messageBatch,
      options: optionSnapshot
    } = validatePersistedAiPhysicalInput(input);
    void intentKey;
    void claimKey;
    void ownerKey;
    void attemptGeneration;
    void hostEpoch;
    void fence;
    void idempotencyScope;
    void requestFingerprint;

    const projection = this.projection(taskKey, optionSnapshot);
    const exactCandidates = projection.candidates.filter(row => clean(row?.id) === modelKey);
    if (exactCandidates.length !== 1) {
      throw Object.assign(new Error('Persisted AI attempt model binding does not resolve to exactly one enabled deployment'), {
        code: 'WP_B_AI_PERSISTED_MODEL_BINDING_INVALID',
        modelReference: modelKey,
        candidateCount: exactCandidates.length
      });
    }
    const candidate = exactCandidates[0];
    const credentialRef = clean(candidate.credentialRef);
    if (!credentialRef) throw persistedAiAttemptError('credentialReference');
    const credentials = Object.freeze({
      [credentialRef]: Object.freeze({
        apiKey: clean(credentialCapability.apiKey || credentialCapability.key || credentialCapability.token),
        endpoint: clean(credentialCapability.endpoint || credentialCapability.baseUrl || candidate.endpoint),
        model: clean(credentialCapability.model || credentialCapability.modelName || candidate.modelName || candidate.name)
      })
    });
    const timeoutMs = Math.max(1000, Number(optionSnapshot.timeoutMs || TASK_QUEUE_TIMEOUT_FLOORS[taskKey] || 180000));
    const payload = Object.freeze({
      requestId: attemptKey,
      modelGroup: projection.modelGroup,
      logicalModel: projection.logicalModel,
      tags: projection.tags,
      catalog: Object.freeze([candidate]),
      credentials,
      messages: messageBatch,
      complexity: optionSnapshot.complexity || null,
      options: Object.freeze({
        timeoutMs,
        maxTokens: optionSnapshot.maxTokens,
        temperature: optionSnapshot.temperature,
        json: optionSnapshot.json === true,
        numRetries: optionSnapshot.numRetries,
        maxFallbacks: optionSnapshot.maxFallbacks
      })
    });
    const queued = this.queue.add(async ({ signal }) => {
      if (signal?.aborted) throw signal.reason || Object.assign(new Error('Persisted AI attempt was cancelled before physical execution'), { code: 'JOB_CANCELLED' });
      eventBus.publish('ai:job-started', { jobId: executionKey, task: taskKey, modelBrain: true, logicalModel: projection.logicalModel, candidateCount: 1, persistedAttempt: true });
      const raw = taskKey === 'probe' ? await this.runtime.probe(payload) : await this.runtime.execute(payload);
      const result = normalizeRuntimeResult(raw, taskKey);
      eventBus.publish('ai:job-complete', { jobId: executionKey, task: taskKey, modelBrain: true, evidence: result.evidence, persistedAttempt: true });
      return result;
    }, {
      id: `wpb-ai-attempt:${attemptKey}`,
      task: taskKey,
      priority: taskPriority(taskKey, { priority: optionSnapshot.priority, background: false }),
      queueTimeoutMs: resolveQueueTimeoutMs(taskKey, { options: { ...optionSnapshot, timeoutMs }, background: false }),
      background: false,
      providerKey: 'model-brain'
    });
    return queued.promise;
  }

  submit({ task, messages, modelId = '', options = {}, signal: externalSignal = null, priority, queueTimeoutMs, background = false, context: rawContext = {} }) {
    const jobId = randomUUID();
    const context = this.registerTaskContext(jobId, task, rawContext);
    const authority = this.internalOperationAuthorityProvider();
    if (!authority || typeof authority.create !== 'function' || typeof authority.start !== 'function'
        || typeof authority.succeed !== 'function' || typeof authority.fail !== 'function') {
      throw Object.assign(new Error('Durable AI operation authority is unavailable'), { code: 'WP_B_RUNTIME_INTERNAL_OPERATION_AUTHORITY_REQUIRED' });
    }
    const operationScopeKey = clean(context.scopeKey) || `ai-job:${jobId}`;
    const operationFingerprint = durableAiOperationFingerprint({ jobId, task, modelId, context });
    const persisted = authority.create({
      operationId: `ai-provider-${jobId}`,
      operationType: 'ai.provider-execution',
      scopeKey: operationScopeKey,
      objectFingerprint: operationFingerprint,
      traceId: clean(context.requestId) || jobId,
      maxAttempts: 1
    });
    const operationId = clean(persisted?.operation?.operationId);
    if (!operationId || clean(persisted?.operation?.state) !== 'SCHEDULED') {
      throw Object.assign(new Error('Durable AI operation was not scheduled before queue admission'), { code: 'WP_B_AI_OPERATION_SCHEDULE_REQUIRED', operationId });
    }
    const controller = new AbortController();
    const relayExternal = () => controller.abort(externalSignal?.reason || Object.assign(new Error('MODEL_CANCELLED'), { code: 'MODEL_CANCELLED' }));
    if (externalSignal?.aborted) relayExternal();
    else externalSignal?.addEventListener?.('abort', relayExternal, { once: true });
    this.controllers.set(jobId, controller);
    this._pruneJobs();
    this.jobs.set(jobId, { jobId, task, operationId, operationFingerprint, status: 'queued', createdAt: new Date().toISOString(), context, result: null, error: null, background: background === true });
    const timeoutMs = Math.max(1000, Number(options.timeoutMs || TASK_QUEUE_TIMEOUT_FLOORS[clean(task)] || 180000));
    const scheduler = background === true ? this.localAuxiliaryQueue : this.queue;
    const queued = scheduler.add(async ({ signal }) => {
      const relay = () => controller.abort(signal.reason || Object.assign(new Error('JOB_CANCELLED'), { code: 'JOB_CANCELLED' }));
      if (signal.aborted) relay(); else signal.addEventListener('abort', relay, { once: true });
      const row = this.jobs.get(jobId);
      if (row) { row.status = 'running'; row.startedAt = new Date().toISOString(); }
      let runningOperation = null;
      try {
        this.assertTaskContextCurrent(context);
        runningOperation = authority.start(operationId, { progress: 1 }).operation;
        const result = await this._run({ jobId, task, messages, modelId, options: { ...options, timeoutMs }, signal: controller.signal, context, persistedOperation: runningOperation });
        authority.succeed(operationId, durableAiTerminalReceipt(result), {
          generation: runningOperation.generation,
          objectFingerprint: operationFingerprint,
          reasonCode: 'AI_PROVIDER_EXECUTION_SUCCEEDED'
        });
        this.assertTaskContextCurrent(context);
        const current = this.jobs.get(jobId);
        if (current && current.status === 'running') {
          current.status = 'completed'; current.completedAt = new Date().toISOString(); current.result = result;
        }
        return result;
      } catch (error) {
        if (runningOperation) {
          if (error?.physicalSucceeded === true) {
            authority.succeed(operationId, durableAiTerminalReceipt(error.physicalResult || {}), {
              generation: runningOperation.generation,
              objectFingerprint: operationFingerprint,
              reasonCode: 'AI_PROVIDER_EXECUTION_SUCCEEDED'
            });
          } else if (controller.signal.aborted && typeof authority.cancel === 'function') {
            authority.cancel(operationId, { reasonCode: clean(controller.signal.reason?.code || error?.code || 'MODEL_CANCELLED') }, {
              generation: runningOperation.generation,
              objectFingerprint: operationFingerprint,
              reasonCode: clean(controller.signal.reason?.code || error?.code || 'MODEL_CANCELLED')
            });
          } else {
            authority.fail(operationId, { errorCode: clean(error?.code || 'MODEL_BRAIN_JOB_FAILED') }, {
              retryable: false,
              generation: runningOperation.generation,
              objectFingerprint: operationFingerprint,
              reasonCode: clean(error?.code || 'MODEL_BRAIN_JOB_FAILED')
            });
          }
        }
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
      providerKey: background === true ? 'local-auxiliary' : 'model-brain',
      signal: controller.signal
    });
    this.queueIds.set(jobId, queued.id);
    this.queueAuthorities.set(jobId, scheduler);
    queued.promise.catch(error => {
      const durable = authority.read?.(operationId);
      if (durable?.state === 'SCHEDULED') {
        try {
          const started = authority.start(operationId, { progress: 0 }).operation;
          authority.cancel?.(operationId, { reasonCode: clean(error?.code || 'AI_QUEUE_CANCELLED') }, {
            generation: started.generation,
            objectFingerprint: operationFingerprint,
            reasonCode: clean(error?.code || 'AI_QUEUE_CANCELLED')
          });
        } catch (terminalError) {
          logger.error('ai', 'durable-ai-queue-terminalization-failed', { jobId, operationId, reasonCode: terminalError?.code || 'AI_DURABLE_TERMINALIZATION_FAILED', error: terminalError?.message || String(terminalError) });
        }
      }
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
      this.queueAuthorities.delete(jobId);
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
    const scheduler = this.queueAuthorities.get(jobId) || this.queue;
    const queued = queueId ? scheduler.cancel(queueId) : false;
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
      localAuxiliaryQueue: this.localAuxiliaryQueue.status(),
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
module.exports.validateRuntimePersistedOperation = validateRuntimePersistedOperation;
module.exports.durableAiOperationFingerprint = durableAiOperationFingerprint;

module.exports.PQueueSchedulerAdapter = PQueueSchedulerAdapter;
