'use strict';

const { randomUUID } = require('crypto');
const eventBus = require('./eventBus');
function cleanJobId(value) { return String(value == null ? '' : value).trim().slice(0, 240); }

class JobQueue {
  constructor({ concurrency = 2, providerConcurrency = {}, name = 'default', maxCompleted = 200, reservedHighPrioritySlots = 0, highPriorityThreshold = 70, maxPhysicalZombiesPerProvider = 1, providerCircuitCooldownMs = 60_000, physicalPersistence = null } = {}) {
    this.name = name;
    this.concurrency = Math.max(1, Number(concurrency || 1));
    this.providerConcurrency = Object.fromEntries(Object.entries(providerConcurrency || {})
      .map(([key, value]) => [this.providerKey({ providerKey: key }), Number(value)])
      .filter(([, value]) => Number.isInteger(value) && value > 0));
    this.maxCompleted = Math.max(10, Number(maxCompleted || 200));
    this.reservedHighPrioritySlots = Math.max(0, Math.min(this.concurrency - 1, Number(reservedHighPrioritySlots || 0)));
    this.highPriorityThreshold = Number.isFinite(Number(highPriorityThreshold)) ? Number(highPriorityThreshold) : 70;
    this.pending = [];
    this.running = new Map();
    this.physicalInFlight = new Map();
    this.providerCircuits = new Map();
    this.maxPhysicalZombiesPerProvider = Math.max(1, Number(maxPhysicalZombiesPerProvider || 1));
    this.providerCircuitCooldownMs = Math.max(1000, Number(providerCircuitCooldownMs || 60_000));
    this.completed = new Map();
    this.persistenceHealth = {
      state: 'healthy',
      firstFailedAt: '',
      lastErrorCode: '',
      retryCount: 0,
      unresolved: [],
      recoveryStage: ''
    };
    this.physicalPersistence = physicalPersistence || {
      write: input => this.writePhysicalStore(input),
      probe: () => this.probePhysicalStore(),
      listUnresolved: () => this.listUnresolvedPhysicalStore(),
      reconcile: () => []
    };
  }


  eventContext(job = {}) {
    const meta = job.meta || {};
    const context = meta.context || {};
    return {
      correlationId: String(meta.correlationId || context.requestId || context.correlationId || '').trim(),
      operationId: String(meta.operationId || meta.jobId || job.id || '').trim(),
      executionGeneration: String(job.id || meta.executionGeneration || '').trim(),
      accountLane: String(meta.accountLane || context.scopeKey || [context.platform, context.sourceAccountId].filter(Boolean).join(':') || '').trim()
    };
  }

  physicalStore() {
    try {
      const store = require('../repositories/storeProvider').getStore();
      const exists = store?.db?.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='ai_provider_physical_execution_state'").get();
      return exists ? store : null;
    } catch (_) { return null; }
  }

  writePhysicalStore({ job, state, details = {} }) {
    const store = this.physicalStore();
    if (!store) {
      throw Object.assign(new Error('AI runtime physical persistence authority is unavailable'), {
        code: 'AI_RUNTIME_PERSISTENCE_UNAVAILABLE'
      });
    }
    const at = new Date().toISOString();
    const startedAt = job.startedAt ? new Date(job.startedAt).toISOString() : at;
    const deadlineAt = Number(job.meta?.executionTimeoutMs || 0) > 0
      ? new Date(Number(job.startedAt || Date.now()) + Number(job.meta.executionTimeoutMs)).toISOString()
      : '';
    const finishedAt = ['completed','terminated'].includes(state) ? at : '';
    const receipt = store.db.prepare(`INSERT INTO ai_provider_physical_execution_state(
      execution_id,queue_name,provider_key,generation,job_id,state,logical_state,
      started_at,deadline_at,finished_at,last_error_code,metadata_json,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(execution_id) DO UPDATE SET state=excluded.state,logical_state=excluded.logical_state,
      provider_key=excluded.provider_key,
      finished_at=CASE WHEN excluded.finished_at<>'' THEN excluded.finished_at ELSE ai_provider_physical_execution_state.finished_at END,
      last_error_code=excluded.last_error_code,metadata_json=excluded.metadata_json,updated_at=excluded.updated_at`)
      .run(job.physicalExecutionId || job.id, this.name, job.providerKey, job.id, cleanJobId(job.meta?.jobId || job.id), state,
        String(details.logicalState || (job.settled ? 'settled' : 'running')), startedAt, deadlineAt,
        finishedAt, String(details.errorCode || ''), JSON.stringify({ priority: job.priority, task: job.meta?.task || '', zombie: job.physicalZombie === true }), at);
    if (!receipt || Number(receipt.changes || 0) < 1) {
      throw Object.assign(new Error('AI runtime physical persistence write was not committed'), {
        code: 'AI_RUNTIME_PERSISTENCE_NOT_COMMITTED'
      });
    }
    return { committed: true, changes: Number(receipt.changes) };
  }

  probePhysicalStore() {
    const store = this.physicalStore();
    if (!store) return { ok: false, code: 'AI_RUNTIME_PERSISTENCE_UNAVAILABLE' };
    const row = store.db.prepare('PRAGMA quick_check').get();
    const result = row && Object.values(row)[0];
    return { ok: String(result || '').toLowerCase() === 'ok' };
  }

  listUnresolvedPhysicalStore() {
    const store = this.physicalStore();
    if (!store) {
      throw Object.assign(new Error('AI runtime physical persistence authority is unavailable'), {
        code: 'AI_RUNTIME_PERSISTENCE_UNAVAILABLE'
      });
    }
    return store.db.prepare(`SELECT execution_id AS executionId,generation,provider_key AS providerKey,state
      FROM ai_provider_physical_execution_state
      WHERE queue_name=? AND state IN ('physical-running','zombie')`).all(this.name);
  }

  markPersistenceDegraded(error) {
    const at = new Date().toISOString();
    if (!this.persistenceHealth.firstFailedAt) this.persistenceHealth.firstFailedAt = at;
    this.persistenceHealth.state = 'degraded';
    this.persistenceHealth.lastErrorCode = String(error?.code || error?.message || 'AI_RUNTIME_PERSISTENCE_WRITE_FAILED');
    this.persistenceHealth.retryCount += 1;
    this.persistenceHealth.recoveryStage = '';
  }

  persistenceError() {
    return Object.assign(new Error('AI runtime persistence is degraded'), {
      code: 'AI_RUNTIME_PERSISTENCE_DEGRADED',
      reason: this.persistenceHealth.lastErrorCode || 'PERSISTENCE_UNHEALTHY',
      retryable: true
    });
  }

  persistPhysical(job, state, details = {}) {
    if (this.persistenceHealth.state !== 'healthy') return false;
    try {
      this.physicalPersistence.write({ queueName: this.name, job, state, details });
      return true;
    } catch (error) {
      this.markPersistenceDegraded(error);
      return false;
    }
  }

  verifiedReconciliationReceipt(unresolved, receipt) {
    return Boolean(
      receipt
      && receipt.terminated === true
      && String(receipt.executionId || '').trim() === String(unresolved.executionId || '').trim()
      && (Number.isInteger(receipt.exitCode) || Boolean(String(receipt.signal || '').trim()))
    );
  }

  async recoverPersistence() {
    if (this.persistenceHealth.state === 'healthy') return { recovered: true, unresolved: [] };
    try {
      this.persistenceHealth.state = 'probing';
      this.persistenceHealth.recoveryStage = 'probing';
      const probe = await this.physicalPersistence.probe({ queueName: this.name });
      if (!(probe === true || probe?.ok === true)) {
        throw Object.assign(new Error('AI runtime persistence probe failed'), {
          code: 'AI_RUNTIME_PERSISTENCE_DEGRADED'
        });
      }

      this.persistenceHealth.state = 'reconciling';
      this.persistenceHealth.recoveryStage = 'reconciling';
      const rows = await this.physicalPersistence.listUnresolved({ queueName: this.name });
      const unresolved = (Array.isArray(rows) ? rows : []).map(row => ({
        executionId: String(row.executionId || '').trim(),
        generation: String(row.generation || '').trim(),
        providerKey: String(row.providerKey || 'default').trim(),
        state: 'UNKNOWN'
      }));
      this.persistenceHealth.unresolved = unresolved;
      const receipts = await this.physicalPersistence.reconcile({
        queueName: this.name,
        unresolved: unresolved.map(row => ({ ...row }))
      });
      const receiptRows = Array.isArray(receipts) ? receipts : [];
      const allVerified = unresolved.every(row =>
        receiptRows.some(receipt => this.verifiedReconciliationReceipt(row, receipt))
      );
      if (!allVerified) {
        throw Object.assign(new Error('AI runtime reconciliation requires verified execution receipts'), {
          code: 'AI_RUNTIME_RECONCILIATION_REQUIRED'
        });
      }

      this.persistenceHealth = {
        state: 'healthy',
        firstFailedAt: '',
        lastErrorCode: '',
        retryCount: 0,
        unresolved: [],
        recoveryStage: ''
      };
      this._drain();
      return { recovered: true, unresolved: [] };
    } catch (error) {
      this.markPersistenceDegraded(error);
      throw error;
    }
  }

  providerKey(meta = {}) {
    return String(meta.providerKey || meta.providerId || meta.provider || meta.modelId || meta.model || 'default').trim().toLowerCase() || 'default';
  }

  providerLimit(providerKey) {
    const configured = Number(this.providerConcurrency[this.providerKey({ providerKey })]);
    return Number.isInteger(configured) && configured > 0 ? configured : this.concurrency;
  }

  providerExecutionDecision(providerKey, now = Date.now()) {
    const key = this.providerKey({ providerKey });
    const limit = this.providerLimit(key);
    const executions = [...this.physicalInFlight.values()].filter(job => job.providerKey === key);
    const inFlight = executions.length;
    const circuit = this.providerCircuits.get(key) || {};
    const zombies = Math.max(
      executions.filter(job => job.physicalZombie === true).length,
      Number(circuit.zombies || 0)
    );
    const openUntil = Number(circuit.openUntil || 0);
    let allowed = true;
    let action = 'run';
    let reason = 'PROVIDER_CAPACITY_AVAILABLE';
    if (zombies >= this.maxPhysicalZombiesPerProvider) {
      allowed = false;
      action = 'reject';
      reason = 'PROVIDER_ZOMBIE_THRESHOLD';
    } else if (openUntil > Number(now)) {
      allowed = false;
      action = 'reject';
      reason = 'PROVIDER_COOLDOWN_OPEN';
    } else if (inFlight >= limit) {
      allowed = false;
      action = 'wait';
      reason = 'PROVIDER_CAPACITY_REACHED';
    }
    return { allowed, action, reason, providerKey: key, limit, inFlight, zombies, openUntil };
  }

  verifiedExitReceipt(job, receipt) {
    return Boolean(
      receipt
      && receipt.terminated === true
      && String(receipt.executionId || '').trim() === String(job.physicalExecutionId || job.id)
      && (Number.isInteger(receipt.exitCode) || Boolean(String(receipt.signal || '').trim()))
    );
  }

  bindPhysicalExecution(job, input = {}) {
    if (!this.physicalInFlight.has(job.id)) return false;
    const executionId = String(input.executionId || '').trim();
    if (!executionId) {
      throw Object.assign(new Error('Physical execution ID is required'), {
        code: 'AI_PHYSICAL_EXECUTION_ID_REQUIRED',
        jobId: job.id
      });
    }
    const previousExecutionId = String(job.physicalExecutionId || job.id);
    if (executionId !== previousExecutionId) {
      const store = this.physicalStore();
      if (!store) {
        const error = Object.assign(new Error('AI runtime physical persistence authority is unavailable during execution binding'), {
          code: 'AI_RUNTIME_PERSISTENCE_UNAVAILABLE'
        });
        this.markPersistenceDegraded(error);
        throw error;
      }
      const at = new Date().toISOString();
      try {
        const receipt = store.db.prepare(`UPDATE ai_provider_physical_execution_state
          SET execution_id=?,provider_key=?,updated_at=?
          WHERE execution_id=? AND queue_name=?`)
          .run(executionId, this.providerKey(input), at, previousExecutionId, this.name);
        if (Number(receipt?.changes || 0) !== 1) {
          throw Object.assign(new Error('Physical execution identity rebind did not update exactly one row'), {
            code: 'AI_RUNTIME_PERSISTENCE_NOT_COMMITTED'
          });
        }
      } catch (error) {
        this.markPersistenceDegraded(error);
        throw error;
      }
      job.physicalExecutionId = executionId;
    }
    this.updatePhysicalProvider(job, input.providerKey);
    eventBus.publish('queue:physical-execution-bound', {
      queue: this.name,
      jobId: job.id,
      generation: job.id,
      executionId,
      providerKey: job.providerKey,
      previousExecutionId,
      ...this.eventContext(job),
      at: new Date().toISOString()
    });
    return true;
  }

  updatePhysicalProvider(job, providerKey) {
    if (!this.physicalInFlight.has(job.id)) return false;
    const next = this.providerKey({ providerKey });
    if (next === job.providerKey) return true;
    const decision = this.providerExecutionDecision(next);
    if (!decision.allowed) {
      throw Object.assign(new Error('AI provider capacity lease is unavailable'), {
        code: decision.action === 'reject'
          ? 'AI_PROVIDER_PHYSICAL_CIRCUIT_OPEN'
          : 'AI_PROVIDER_CAPACITY_REACHED',
        providerKey: next,
        reason: decision.reason,
        retryable: decision.action === 'wait'
      });
    }
    const previous = job.providerKey;
    job.providerKey = next;
    job.meta.providerKey = next;
    if (!this.persistPhysical(job, job.physicalZombie ? 'zombie' : 'physical-running', {
      logicalState: job.settled ? 'settled' : 'running',
      errorCode: job.physicalZombie ? 'AI_PHYSICAL_ZOMBIE' : ''
    })) {
      job.providerKey = previous;
      job.meta.providerKey = previous;
      throw this.persistenceError();
    }
    eventBus.publish('queue:physical-provider-updated', {
      queue: this.name,
      jobId: job.id,
      generation: job.id,
      previousProviderKey: previous,
      providerKey: next,
      ...this.eventContext(job),
      at: new Date().toISOString()
    });
    return true;
  }

  providerCircuit(providerKey) {
    const key = String(providerKey || 'default');
    const current = this.providerCircuits.get(key);
    if (!current) return null;
    if (current.openUntil && Date.now() >= current.openUntil && current.zombies <= 0) {
      this.providerCircuits.delete(key);
      eventBus.publish('queue:provider-physical-circuit-closed', { queue: this.name, providerKey: key, at: new Date().toISOString() });
      return null;
    }
    return current;
  }

  requestHardTermination(job, error, reason = 'timeout-or-cancel') {
    if (job.hardTerminationRequested) return job.hardTerminationPromise || Promise.resolve(false);
    job.hardTerminationRequested = true;
    const terminate = typeof job.meta?.hardTerminate === 'function' ? job.meta.hardTerminate : null;
    if (!terminate) {
      eventBus.publish('queue:physical-hard-terminate-unavailable', {
        queue: this.name, jobId: job.id, providerKey: job.providerKey,
        generation: job.id, reason, errorCode: String(error?.code || error?.message || ''), at: new Date().toISOString()
      });
      return Promise.resolve(false);
    }
    eventBus.publish('queue:physical-hard-terminate-requested', {
      queue: this.name, jobId: job.id, providerKey: job.providerKey,
      generation: job.id, reason, errorCode: String(error?.code || error?.message || ''), at: new Date().toISOString()
    });
    job.hardTerminationPromise = Promise.resolve().then(() => terminate({
      queue: this.name, jobId: job.id, executionId: job.physicalExecutionId || job.id,
      generation: job.id, providerKey: job.providerKey,
      reason, error, signal: job.controller.signal
    })).then(result => {
      const terminated = this.verifiedExitReceipt(job, result);
      eventBus.publish('queue:physical-hard-terminate-completed', {
        queue: this.name, jobId: job.id, providerKey: job.providerKey,
        generation: job.id, reason, terminated,
        receiptExecutionId: String(result?.executionId || ''),
        exitCode: Number.isInteger(result?.exitCode) ? result.exitCode : null,
        signal: String(result?.signal || ''),
        at: new Date().toISOString()
      });
      if (terminated) this.releasePhysical(job, { ok: false, error, terminated: true });
      return terminated;
    }, terminateError => {
      eventBus.publish('queue:physical-hard-terminate-failed', {
        queue: this.name, jobId: job.id, providerKey: job.providerKey,
        generation: job.id, reason, errorCode: String(terminateError?.code || terminateError?.message || 'HARD_TERMINATE_FAILED'), at: new Date().toISOString()
      });
      return false;
    });
    return job.hardTerminationPromise;
  }

  markPhysicalZombie(job, error, reason = 'timeout-or-cancel') {
    if (job.physicalZombie) return;
    job.physicalZombie = true;
    this.requestHardTermination(job, error, reason);
    const key = job.providerKey;
    const state = this.providerCircuits.get(key) || { zombies: 0, openedAt: '', openUntil: 0, lastErrorCode: '' };
    state.zombies += 1;
    state.lastErrorCode = String(error?.code || error?.message || 'AI_PHYSICAL_ZOMBIE');
    if (state.zombies >= this.maxPhysicalZombiesPerProvider) {
      state.openedAt = new Date().toISOString();
      state.openUntil = Date.now() + this.providerCircuitCooldownMs;
    }
    this.providerCircuits.set(key, state);
    this.persistPhysical(job, 'zombie', { logicalState: 'timed-out-or-cancelled', errorCode: state.lastErrorCode });
    eventBus.publish('queue:physical-zombie-created', {
      queue: this.name, jobId: job.id, providerKey: key, generation: job.id,
      zombies: state.zombies, circuitOpen: state.zombies >= this.maxPhysicalZombiesPerProvider,
      errorCode: state.lastErrorCode, ...this.eventContext(job), at: new Date().toISOString()
    });
  }

  releasePhysical(job, outcome = {}) {
    if (!this.physicalInFlight.has(job.id)) return;
    this.physicalInFlight.delete(job.id);
    this.persistPhysical(job, outcome.terminated === true ? 'terminated' : 'completed', { logicalState: job.settled ? 'settled' : 'running', errorCode: outcome.error?.code || outcome.error?.message || '' });
    if (job.physicalZombie) {
      const state = this.providerCircuits.get(job.providerKey);
      if (state) {
        state.zombies = Math.max(0, Number(state.zombies || 0) - 1);
        if (state.zombies === 0 && Date.now() >= Number(state.openUntil || 0)) this.providerCircuits.delete(job.providerKey);
        else this.providerCircuits.set(job.providerKey, state);
      }
    }
    eventBus.publish('queue:physical-execution-settled', {
      queue: this.name, jobId: job.id, providerKey: job.providerKey,
      generation: job.id, zombie: job.physicalZombie === true, ok: outcome.ok === true,
      terminated: outcome.terminated === true,
      errorCode: String(outcome.error?.code || outcome.error?.message || ''),
      physicalInFlight: this.physicalInFlight.size, ...this.eventContext(job), at: new Date().toISOString()
    });
    this._drain();
  }

  add(task, meta = {}) {
    const id = randomUUID();
    const controller = new AbortController();
    if (this.persistenceHealth.state !== 'healthy') {
      const error = this.persistenceError();
      return {
        id,
        promise: Promise.reject(error),
        cancel: () => false
      };
    }
    const promise = new Promise((resolve, reject) => {
      const createdAt = Date.now();
      const priority = Number.isFinite(Number(meta.priority)) ? Number(meta.priority) : 0;
      const queueTimeoutMs = Math.max(0, Number(meta.queueTimeoutMs || 0));
      const executionTimeoutMs = Math.max(0, Number(meta.executionTimeoutMs || meta.runTimeoutMs || 0));
      const job = {
        id,
        task,
        meta: { ...meta, priority, queueTimeoutMs, executionTimeoutMs },
        controller,
        resolve,
        reject,
        createdAt,
        priority,
        timeoutTimer: null,
        executionTimer: null,
        settled: false,
        forced: false,
        settle: null,
        providerKey: this.providerKey(meta),
        physicalExecutionId: id,
        physicalZombie: false,
        hardTerminationRequested: false,
        hardTerminationPromise: null
      };
      if (queueTimeoutMs > 0) {
        job.timeoutTimer = setTimeout(() => {
          const pendingIndex = this.pending.findIndex(item => item.id === id);
          if (pendingIndex < 0) return;
          this.pending.splice(pendingIndex, 1);
          const error = Object.assign(new Error('AI任务排队超时，尚未开始运行'), { code: 'AI_QUEUE_TIMEOUT' });
          controller.abort(error);
          job.settled = true;
          reject(error);
          eventBus.publish('queue:timeout', { queue: this.name, jobId: id, meta: job.meta, phase: 'queued', queueWaitMs: Date.now() - createdAt, ...this.eventContext(job) });
        }, queueTimeoutMs);
      }
      this.pending.push(job);
      this.pending.sort((left, right) => right.priority - left.priority || left.createdAt - right.createdAt);
      eventBus.publish('queue:queued', { queue: this.name, jobId: id, meta: job.meta, ...this.eventContext(job) });
      this._drain();
    });
    return { id, promise, cancel: () => this.cancel(id) };
  }

  cancel(id) {
    const pendingIndex = this.pending.findIndex(job => job.id === id);
    if (pendingIndex >= 0) {
      const [job] = this.pending.splice(pendingIndex, 1);
      if (job.timeoutTimer) clearTimeout(job.timeoutTimer);
      const error = Object.assign(new Error('任务已取消'), { code: 'JOB_CANCELLED' });
      job.controller.abort(error);
      job.settled = true;
      job.reject(error);
      eventBus.publish('queue:cancelled', { queue: this.name, jobId: id, state: 'pending', ...this.eventContext(job) });
      this._drain();
      return true;
    }
    const running = this.running.get(id);
    if (running) {
      const error = Object.assign(new Error('任务已取消'), { code: 'JOB_CANCELLED' });
      if (!running.controller.signal.aborted) running.controller.abort(error);
      running.forced = true;
      this.markPhysicalZombie(running, error, 'cancelled');
      running.settle?.(false, error, { forced: true, cancelled: true });
      eventBus.publish('queue:cancelled', { queue: this.name, jobId: id, state: 'running', logicalSlotReleased: true, physicalSlotReleased: false, ...this.eventContext(running) });
      return true;
    }
    return false;
  }

  _rememberCompletion(id, row) {
    this.completed.set(id, row);
    while (this.completed.size > this.maxCompleted) {
      const oldest = this.completed.keys().next().value;
      if (!oldest) break;
      this.completed.delete(oldest);
    }
  }

  status() {
    const providerKeys = new Set([
      ...Object.keys(this.providerConcurrency),
      ...this.providerCircuits.keys(),
      ...[...this.physicalInFlight.values()].map(job => job.providerKey),
      ...this.pending.map(job => job.providerKey)
    ]);
    return {
      name: this.name,
      concurrency: this.concurrency,
      reservedHighPrioritySlots: this.reservedHighPrioritySlots,
      highPriorityThreshold: this.highPriorityThreshold,
      pending: this.pending.map(job => ({ id: job.id, meta: job.meta, createdAt: job.createdAt })),
      running: [...this.running.values()].map(job => ({ id: job.id, meta: job.meta, startedAt: job.startedAt })),
      physicalInFlight: [...this.physicalInFlight.values()].map(job => ({ id: job.id, executionId: job.physicalExecutionId || job.id, providerKey: job.providerKey, startedAt: job.startedAt, zombie: job.physicalZombie === true, hardTerminationRequested: job.hardTerminationRequested === true })),
      physicalInFlightCount: this.physicalInFlight.size,
      providerCircuits: Object.fromEntries([...this.providerCircuits.entries()].map(([key, value]) => [key, { ...value, open: value.zombies >= this.maxPhysicalZombiesPerProvider || Date.now() < Number(value.openUntil || 0) }])),
      providerDecisions: Object.fromEntries([...providerKeys].map(key => [key, this.providerExecutionDecision(key)])),
      completed: [...this.completed.values()].slice(-50),
      persistenceHealth: {
        ...this.persistenceHealth,
        unresolved: this.persistenceHealth.unresolved.map(row => ({ ...row }))
      }
    };
  }

  nextRunnableIndex() {
    if (!this.pending.length) return -1;
    if (this.physicalInFlight.size >= this.concurrency) return -1;
    const runnable = job => this.providerExecutionDecision(job.providerKey).allowed;
    const highIndex = this.pending.findIndex(job => job.priority >= this.highPriorityThreshold && runnable(job));
    if (highIndex >= 0) return highIndex;
    return this.pending.findIndex(job => {
      if (!runnable(job)) return false;
      const backgroundCapacity = Math.max(1, this.providerLimit(job.providerKey) - this.reservedHighPrioritySlots);
      const runningBackground = [...this.physicalInFlight.values()]
        .filter(item => item.providerKey === job.providerKey && item.priority < this.highPriorityThreshold).length;
      return runningBackground < backgroundCapacity;
    });
  }

  _start(job) {
    job.startedAt = Date.now();
    this.running.set(job.id, job);
    this.physicalInFlight.set(job.id, job);
    if (!this.persistPhysical(job, 'physical-running', { logicalState: 'running' })) {
      this.running.delete(job.id);
      this.physicalInFlight.delete(job.id);
      job.settled = true;
      job.reject(this.persistenceError());
      return;
    }
    eventBus.publish('queue:started', { queue: this.name, jobId: job.id, meta: job.meta, ...this.eventContext(job) });

    const settle = (ok, value, flags = {}) => {
      if (job.settled) return false;
      job.settled = true;
      if (job.executionTimer) clearTimeout(job.executionTimer);
      this.running.delete(job.id);
      const durationMs = Date.now() - job.startedAt;
      if (ok) {
        this._rememberCompletion(job.id, { id: job.id, ok: true, durationMs, at: new Date().toISOString() });
        job.resolve(value);
        eventBus.publish('queue:completed', { queue: this.name, jobId: job.id, durationMs, ...this.eventContext(job) });
      } else {
        const error = value instanceof Error ? value : Object.assign(new Error(String(value || 'JOB_FAILED')), { code: 'JOB_FAILED' });
        this._rememberCompletion(job.id, { id: job.id, ok: false, error: error.message, errorCode: error.code || 'JOB_FAILED', durationMs, forced: flags.forced === true, at: new Date().toISOString() });
        job.reject(error);
        eventBus.publish(flags.timeout ? 'queue:execution-timeout' : 'queue:failed', { queue: this.name, jobId: job.id, error: error.message, errorCode: error.code || 'JOB_FAILED', durationMs, logicalSlotReleased: true, physicalSlotReleased: false, ...this.eventContext(job) });
      }
      this._drain();
      return true;
    };
    job.settle = settle;

    const executionTimeoutMs = Number(job.meta.executionTimeoutMs || 0);
    if (executionTimeoutMs > 0) {
      job.executionTimer = setTimeout(() => {
        const error = Object.assign(new Error('AI任务运行超时，执行槽位已强制回收'), {
          code: job.meta.executionTimeoutCode || 'AI_EXECUTION_TIMEOUT',
          timeoutMs: executionTimeoutMs,
          jobId: job.id,
          executionGeneration: job.id
        });
        if (!job.controller.signal.aborted) job.controller.abort(error);
        job.forced = true;
        this.markPhysicalZombie(job, error, 'execution-timeout');
        settle(false, error, { forced: true, timeout: true });
      }, executionTimeoutMs);
    }

    const raw = Promise.resolve().then(() => job.task({
      signal: job.controller.signal,
      jobId: job.id,
      generation: job.id,
      updateProvider: providerKey => this.updatePhysicalProvider(job, providerKey),
      bindExecution: input => this.bindPhysicalExecution(job, input)
    }));
    raw.then(
      result => {
        this.releasePhysical(job, { ok: true });
        if (!settle(true, result) && job.forced) {
          eventBus.publish('queue:late-result-ignored', { queue: this.name, jobId: job.id, ok: true, ...this.eventContext(job), at: new Date().toISOString() });
        }
      },
      error => {
        this.releasePhysical(job, { ok: false, error });
        if (!settle(false, error) && job.forced) {
          eventBus.publish('queue:late-result-ignored', { queue: this.name, jobId: job.id, ok: false, errorCode: error?.code || 'JOB_FAILED', ...this.eventContext(job), at: new Date().toISOString() });
        }
      }
    );
  }

  async _drain() {
    if (this.persistenceHealth.state !== 'healthy') return;
    // Fail queued jobs for providers whose physical circuit is open. This is
    // preferable to spawning more ignored-abort calls and exhausting sockets,
    // descriptors or paid provider quota.
    for (let index = this.pending.length - 1; index >= 0; index -= 1) {
      const job = this.pending[index];
      const decision = this.providerExecutionDecision(job.providerKey);
      if (decision.action !== 'reject') continue;
      this.pending.splice(index, 1);
      if (job.timeoutTimer) clearTimeout(job.timeoutTimer);
      const error = Object.assign(new Error('AI provider physical execution circuit is open'), {
        code: 'AI_PROVIDER_PHYSICAL_CIRCUIT_OPEN', providerKey: job.providerKey,
        zombies: decision.zombies, reason: decision.reason, openUntil: decision.openUntil
      });
      job.settled = true;
      job.reject(error);
      eventBus.publish('queue:provider-physical-circuit-rejected', { queue: this.name, jobId: job.id, providerKey: job.providerKey, zombies: decision.zombies, reason: decision.reason, ...this.eventContext(job), at: new Date().toISOString() });
    }
    while (this.pending.length) {
      const index = this.nextRunnableIndex();
      if (index < 0) break;
      const [job] = this.pending.splice(index, 1);
      if (job.timeoutTimer) clearTimeout(job.timeoutTimer);
      this._start(job);
    }
  }
}

module.exports = { JobQueue };
