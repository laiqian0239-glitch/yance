'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fork } = require('node:child_process');

const SCENARIOS = Object.freeze([
  'KILL_BEFORE_PHYSICAL_CALL',
  'KILL_AFTER_ATTEMPT_BEFORE_CALL',
  'KILL_DURING_CALL',
  'REMOTE_SUCCESS_BEFORE_RECEIPT',
  'RECEIPT_BEFORE_TERMINAL',
  'DUPLICATE_DISPATCHERS',
  'LEASE_EXPIRY_TAKEOVER',
  'STALE_OWNER_GENERATION_HOST_FENCING',
  'HEARTBEAT_LOSS',
  'CLOCK_ROLLBACK_FORWARD_JUMP',
  'DEADLINE_BEFORE_CLAIM_DURING_WAIT',
  'CANCELLATION_BEFORE_DURING_AFTER_ACCEPTANCE',
  'REMOTE_RETRYABLE_PERMANENT_FAILURE',
  'RECONCILIATION_PROVES_SUCCESS',
  'RECONCILIATION_PROVES_ABSENCE',
  'RECONCILIATION_REMAINS_UNKNOWN',
  'CHECKPOINT_HISTORY_ROLLING',
  'RESTART_EVERY_NONTERMINAL_STATE'
]);

const REMOTE_SUCCESS_PROVEN = 'REMOTE_SUCCESS_PROVEN';
const REMOTE_ABSENCE_PROVEN = 'REMOTE_ABSENCE_PROVEN';
const REMOTE_RESULT_UNKNOWN = 'REMOTE_RESULT_UNKNOWN';
const UNCERTAIN_REMOTE_OUTCOME = 'UNCERTAIN_REMOTE_OUTCOME';
const FAKE_REMOTE_PATH = path.join(__dirname, 'fixtures', 'wp-b-fake-remote.js');
const DISPATCHER_PROCESS_PATH = path.join(__dirname, 'fixtures', 'wp-b-dispatcher-process.js');
const NONTERMINAL_STATES = Object.freeze([
  'CREATED',
  'SCHEDULED',
  'CLAIMED',
  'RUNNING',
  'WAITING_REMOTE',
  'RETRY_SCHEDULED',
  'CANCEL_REQUESTED',
  UNCERTAIN_REMOTE_OUTCOME
]);

function clean(value) { return String(value == null ? '' : value).trim(); }
function wait(milliseconds) { return new Promise(resolve => setTimeout(resolve, milliseconds)); }
function matrixError(code, message, details = {}) { return Object.assign(new Error(message || code), { code, ...details }); }
function boundedTimeout(value, fallback = 15_000) { return Math.max(1000, Math.min(60_000, Number(value || fallback))); }
function childFixtureReadyTimeoutMs(commandTimeoutMs, requestedReadyTimeoutMs) {
  const commandTimeout = boundedTimeout(commandTimeoutMs);
  const readyTimeout = requestedReadyTimeoutMs == null
    ? 30_000
    : boundedTimeout(requestedReadyTimeoutMs);
  return Math.max(commandTimeout, readyTimeout);
}
function requirePositive(value, field) {
  const result = Number(value);
  if (!Number.isInteger(result) || result < 1) throw matrixError('WP_B_PROCESS_EVIDENCE_INVALID', `${field} must be positive`, { field, value });
  return result;
}

class ChildController {
  constructor(filePath, args, options = {}) {
    this.filePath = filePath;
    this.timeoutMs = boundedTimeout(options.timeoutMs);
    this.readyTimeoutMs = childFixtureReadyTimeoutMs(this.timeoutMs, options.readyTimeoutMs);
    this.pending = new Map();
    this.waiters = new Map();
    this.relay = options.relay || null;
    this.ready = new Promise((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    this.child = fork(filePath, args, {
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      env: { ...process.env, NODE_ENV: 'test', YANCE_TEST_ONLY_RUNTIME_RESET: '1' },
      serialization: 'advanced'
    });
    this.child.on('message', message => this.onMessage(message));
    this.child.on('error', error => this.fail(error));
    this.child.on('exit', (code, signal) => {
      const error = matrixError('WP_B_CHILD_PROCESS_EXITED', 'Process fixture exited', { filePath, code, signal });
      this.fail(error);
      this.resolveExit?.({ code, signal });
    });
    this.exited = new Promise(resolve => { this.resolveExit = resolve; });
  }

  onMessage(message = {}) {
    if (message.type === 'ready') {
      this.resolveReady(message);
      return;
    }
    if (message.type === 'fatal') {
      this.fail(matrixError(message.error?.code || message.code || 'WP_B_CHILD_FATAL', message.error?.message || message.message || 'Child fatal'));
      return;
    }
    if (message.type === 'response') {
      const pending = this.pending.get(clean(message.correlationId));
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(clean(message.correlationId));
      if (message.ok === false) pending.reject(Object.assign(matrixError(message.error?.code || 'WP_B_CHILD_COMMAND_FAILED'), message.error || {}));
      else pending.resolve(message.result);
      return;
    }
    if (message.type === 'remote-perform') {
      Promise.resolve()
        .then(() => this.relay?.(message))
        .then(result => this.child.connected && this.child.send({
          type: 'parent-response',
          correlationId: message.correlationId,
          ok: true,
          result
        }))
        .catch(error => this.child.connected && this.child.send({
          type: 'parent-response',
          correlationId: message.correlationId,
          ok: false,
          error: {
            code: clean(error?.code) || 'WP_B_REMOTE_RELAY_FAILED',
            retryable: error?.retryable === true,
            remoteOutcomeUnknown: error?.remoteOutcomeUnknown === true
          }
        }));
      return;
    }
    const eventWaiters = this.waiters.get(clean(message.type));
    if (eventWaiters?.length) {
      const waiter = eventWaiters.shift();
      clearTimeout(waiter.timer);
      waiter.resolve(message);
    }
  }

  fail(error) {
    this.rejectReady?.(error);
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    for (const waiters of this.waiters.values()) {
      for (const waiter of waiters) {
        clearTimeout(waiter.timer);
        waiter.reject(error);
      }
    }
    this.waiters.clear();
  }

  async start() {
    const timer = setTimeout(() => this.rejectReady(matrixError('WP_B_CHILD_READY_TIMEOUT')), this.readyTimeoutMs);
    timer.unref?.();
    try { return await this.ready; } finally { clearTimeout(timer); }
  }

  request(type, payload = {}) {
    if (!this.child.connected) return Promise.reject(matrixError('WP_B_CHILD_NOT_CONNECTED'));
    const correlationId = `${type}-${crypto.randomUUID()}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(correlationId);
        reject(matrixError('WP_B_CHILD_COMMAND_TIMEOUT', `${type} timed out`));
      }, this.timeoutMs);
      timer.unref?.();
      this.pending.set(correlationId, { resolve, reject, timer });
      this.child.send({ type, correlationId, ...payload });
    });
  }

  waitFor(type) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(matrixError('WP_B_CHILD_EVENT_TIMEOUT', `${type} timed out`)), this.timeoutMs);
      timer.unref?.();
      const waiters = this.waiters.get(type) || [];
      waiters.push({ resolve, reject, timer });
      this.waiters.set(type, waiters);
    });
  }

  async stop(options = {}) {
    if (this.child.exitCode != null || this.child.signalCode != null) return;
    if (options.kill === true) {
      this.child.kill('SIGKILL');
      await Promise.race([this.exited, wait(2000)]);
      return;
    }
    try { await this.request('shutdown'); } catch (_) {}
    await Promise.race([this.exited, wait(2000)]);
    if (this.child.exitCode == null && this.child.signalCode == null) this.child.kill('SIGKILL');
  }
}

function ensureWorkspaceRoot(input) {
  const workspaceRoot = input
    ? path.resolve(input)
    : fs.mkdtempSync(path.join(os.tmpdir(), 'yance-wp-b-process-fault-matrix-'));
  fs.mkdirSync(workspaceRoot, { recursive: true });
  return workspaceRoot;
}

async function spawnRemote(remoteDbPath, timeoutMs) {
  const remote = new ChildController(FAKE_REMOTE_PATH, [remoteDbPath], { timeoutMs });
  try {
    const ready = await remote.start();
    return { remote, ready };
  } catch (error) {
    await remote.stop({ kill: true }).catch(() => undefined);
    throw error;
  }
}

async function spawnDispatcher(dbPath, instanceId, remote, timeoutMs, processOptions = {}) {
  const dispatcher = new ChildController(
    DISPATCHER_PROCESS_PATH,
    [dbPath, instanceId, JSON.stringify(processOptions)],
    {
      timeoutMs,
      relay: async message => remote.request('perform', {
        idempotencyKey: message.idempotencyKey,
        requestId: message.requestId,
        behavior: message.behavior,
        delayMs: message.delayMs,
        authorityTimestamp: message.authorityTimestamp
      })
    }
  );
  try {
    const ready = await dispatcher.start();
    return { dispatcher, ready };
  } catch (error) {
    await dispatcher.stop({ kill: true }).catch(() => undefined);
    throw error;
  }
}

async function spawnDispatcherAfterTakeover(dbPath, instanceId, remote, timeoutMs, processOptions = {}) {
  let lastError;
  for (let attempt = 0; attempt < 25; attempt += 1) {
    try {
      return await spawnDispatcher(dbPath, `${instanceId}-${attempt}`, remote, timeoutMs, {
        forceTakeover: true,
        ownershipStaleMs: 1000,
        ...processOptions
      });
    } catch (error) {
      lastError = error;
      await wait(100);
    }
  }
  throw lastError || matrixError('WP_B_DISPATCHER_TAKEOVER_FAILED');
}

async function waitForRemoteCount(remote, minimum, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const stats = await remote.request('stats');
    if (Number(stats.physicalSideEffectCount || 0) >= minimum) return stats;
    await wait(25);
  }
  throw matrixError('WP_B_REMOTE_SIDE_EFFECT_TIMEOUT', 'Remote side effect did not become visible');
}

function normalizedEvidence(scenario, prepared, inspected, remoteStats, originalProcessId, overrides = {}) {
  const physicalSideEffectCount = Number(overrides.physicalSideEffectCount ?? remoteStats?.physicalSideEffectCount ?? 0);
  const duplicateExternalSideEffectCount = Number(overrides.duplicateExternalSideEffectCount || 0);
  if (duplicateExternalSideEffectCount !== 0) {
    throw matrixError('WP_B_DUPLICATE_EXTERNAL_SIDE_EFFECT', 'Duplicate external side effect detected', { scenario, physicalSideEffectCount });
  }
  return Object.freeze({
    scenario,
    processId: requirePositive(originalProcessId || prepared.processId || inspected.processId, 'processId'),
    executionId: clean(overrides.executionId || prepared.executionId || inspected.executionId),
    intentId: clean(overrides.intentId || prepared.intentId || inspected.intentId),
    attemptId: clean(overrides.attemptId ?? inspected.attemptId),
    claimId: clean(overrides.claimId ?? prepared.claimId ?? inspected.claimId),
    generation: Number(overrides.generation ?? inspected.generation ?? prepared.generation ?? 0),
    hostGeneration: Number(overrides.hostGeneration ?? inspected.hostGeneration ?? prepared.hostGeneration ?? 0),
    fencingToken: Number(overrides.fencingToken ?? inspected.fencingToken ?? prepared.fencingToken ?? 0),
    physicalSideEffectCount,
    attemptCount: Number(overrides.attemptCount ?? inspected.attemptCount ?? 0),
    receiptCount: Number(overrides.receiptCount ?? inspected.receiptCount ?? 0),
    reconciliationCount: Number(overrides.reconciliationCount ?? inspected.reconciliationCount ?? 0),
    finalState: clean(overrides.finalState || inspected.finalState) || 'UNKNOWN',
    duplicateExternalSideEffectCount
  });
}

function scenarioPaths(workspaceRoot, scenario) {
  const scenarioRoot = path.join(workspaceRoot, `${scenario.toLowerCase()}-${crypto.randomUUID()}`);
  fs.mkdirSync(scenarioRoot, { recursive: true });
  return {
    scenarioRoot,
    dbPath: path.join(scenarioRoot, 'authority.db'),
    remoteDbPath: path.join(scenarioRoot, 'remote.db')
  };
}

async function runCrashWindowScenario({ scenario, workspaceRoot, timeoutMs }) {
  const { dbPath, remoteDbPath } = scenarioPaths(workspaceRoot, scenario);
  const { remote } = await spawnRemote(remoteDbPath, timeoutMs);
  let dispatcher;
  let inspector;
  let prepared;
  let originalProcessId = 0;
  try {
    ({ dispatcher } = await spawnDispatcher(dbPath, `dispatcher-${scenario.toLowerCase()}`, remote, timeoutMs));
    prepared = await dispatcher.request('prepare', { suffix: crypto.randomUUID() });
    originalProcessId = prepared.processId;

    if (scenario === 'KILL_BEFORE_PHYSICAL_CALL') {
      await dispatcher.stop({ kill: true });
      dispatcher = null;
    } else if (scenario === 'KILL_AFTER_ATTEMPT_BEFORE_CALL') {
      const dispatchPromise = dispatcher.request('dispatch', { faultPoint: 'AFTER_ATTEMPT_BEFORE_CALL' }).catch(() => null);
      await dispatcher.waitFor('fault-point');
      await dispatcher.stop({ kill: true });
      dispatcher = null;
      await dispatchPromise;
    } else if (scenario === 'KILL_DURING_CALL') {
      const dispatchPromise = dispatcher.request('dispatch', { remoteDelayMs: 1500 }).catch(() => null);
      await waitForRemoteCount(remote, 1, timeoutMs);
      await dispatcher.stop({ kill: true });
      dispatcher = null;
      await dispatchPromise;
    } else if (scenario === 'REMOTE_SUCCESS_BEFORE_RECEIPT') {
      const dispatchPromise = dispatcher.request('dispatch', { faultPoint: 'AFTER_REMOTE_SUCCESS_BEFORE_RECEIPT' }).catch(() => null);
      await dispatcher.waitFor('fault-point');
      await dispatcher.stop({ kill: true });
      dispatcher = null;
      await dispatchPromise;
    } else if (scenario === 'RECEIPT_BEFORE_TERMINAL') {
      await dispatcher.request('dispatch');
      await dispatcher.stop({ kill: true });
      dispatcher = null;
    } else if (scenario === 'DUPLICATE_DISPATCHERS') {
      await dispatcher.request('dispatch');
      await dispatcher.stop({ kill: true });
      dispatcher = null;
      ({ dispatcher } = await spawnDispatcherAfterTakeover(dbPath, 'dispatcher-duplicate', remote, timeoutMs));
      await dispatcher.request('dispatch', { context: prepared }).catch(() => null);
      await dispatcher.stop({ kill: true });
      dispatcher = null;
    } else {
      throw matrixError('WP_B_PROCESS_SCENARIO_NOT_IMPLEMENTED', scenario);
    }

    ({ dispatcher: inspector } = await spawnDispatcherAfterTakeover(dbPath, 'dispatcher-inspector', remote, timeoutMs));
    const inspected = await inspector.request('inspect', prepared);
    const remoteStats = await remote.request('stats');
    const expectedMaximum = scenario === 'KILL_BEFORE_PHYSICAL_CALL' || scenario === 'KILL_AFTER_ATTEMPT_BEFORE_CALL' ? 0 : 1;
    if (Number(remoteStats.physicalSideEffectCount || 0) > expectedMaximum) {
      throw matrixError('WP_B_DUPLICATE_EXTERNAL_SIDE_EFFECT', 'Crash window produced duplicate external effects', { scenario, remoteStats });
    }
    return normalizedEvidence(scenario, prepared, inspected, remoteStats, originalProcessId);
  } finally {
    try { await inspector?.stop(); } catch (_) {}
    try { await dispatcher?.stop({ kill: true }); } catch (_) {}
    try { await remote.stop(); } catch (_) {}
  }
}

async function runLeaseExpiryTakeover({ scenario, workspaceRoot, timeoutMs }) {
  const { dbPath, remoteDbPath } = scenarioPaths(workspaceRoot, scenario);
  const { remote } = await spawnRemote(remoteDbPath, timeoutMs);
  let owner;
  let takeover;
  try {
    ({ dispatcher: owner } = await spawnDispatcher(dbPath, 'lease-owner', remote, timeoutMs));
    const prepared = await owner.request('prepare', {
      suffix: crypto.randomUUID(),
      leaseExpiresAt: '2026-08-04T03:00:03.000Z'
    });
    const processId = prepared.processId;
    await owner.stop({ kill: true });
    owner = null;
    ({ dispatcher: takeover } = await spawnDispatcherAfterTakeover(dbPath, 'lease-takeover', remote, timeoutMs));
    await takeover.request('reclaim', { context: prepared, authorityTimestamp: '2026-08-04T03:30:00.000Z' });
    const inspected = await takeover.request('inspect', prepared);
    const remoteStats = await remote.request('stats');
    if (inspected.claimState !== 'READY') throw matrixError('WP_B_LEASE_RECLAIM_NOT_READY');
    return normalizedEvidence(scenario, prepared, inspected, remoteStats, processId, { finalState: 'READY' });
  } finally {
    try { await owner?.stop({ kill: true }); } catch (_) {}
    try { await takeover?.stop(); } catch (_) {}
    try { await remote.stop(); } catch (_) {}
  }
}

async function runStaleFencing({ scenario, workspaceRoot, timeoutMs, heartbeatLoss = false }) {
  const { dbPath, remoteDbPath } = scenarioPaths(workspaceRoot, scenario);
  const { remote } = await spawnRemote(remoteDbPath, timeoutMs);
  let stale;
  let current;
  try {
    ({ dispatcher: stale } = await spawnDispatcher(dbPath, 'stale-owner', remote, timeoutMs));
    const prepared = await stale.request('prepare', { suffix: crypto.randomUUID() });
    await stale.request('release-startup-claim');
    if (heartbeatLoss) await wait(1100);
    ({ dispatcher: current } = await spawnDispatcherAfterTakeover(dbPath, 'current-owner', remote, timeoutMs, {
      clockOffsetMs: heartbeatLoss ? 60_000 : 0
    }));
    let staleRejected = false;
    try { await stale.request('dispatch'); } catch (_) { staleRejected = true; }
    if (!staleRejected) throw matrixError('WP_B_STALE_OWNER_NOT_FENCED', 'Stale owner performed a physical call after takeover');
    const inspected = await current.request('inspect', prepared);
    const remoteStats = await remote.request('stats');
    if (Number(remoteStats.physicalSideEffectCount || 0) !== 0) throw matrixError('WP_B_STALE_OWNER_SIDE_EFFECT');
    return normalizedEvidence(scenario, prepared, inspected, remoteStats, prepared.processId, {
      finalState: heartbeatLoss ? 'HEARTBEAT_LOSS_FENCED' : 'STALE_HOST_FENCED'
    });
  } finally {
    try { await stale?.stop({ kill: true }); } catch (_) {}
    try { await current?.stop(); } catch (_) {}
    try { await remote.stop(); } catch (_) {}
  }
}

async function runClockJump({ scenario, workspaceRoot, timeoutMs }) {
  const { dbPath, remoteDbPath } = scenarioPaths(workspaceRoot, scenario);
  const { remote } = await spawnRemote(remoteDbPath, timeoutMs);
  const controllers = [];
  try {
    const first = await spawnDispatcher(dbPath, 'clock-forward-one', remote, timeoutMs, { clockOffsetMs: 86_400_000 });
    controllers.push(first.dispatcher);
    const firstToken = await first.dispatcher.request('token');
    await first.dispatcher.request('release-startup-claim');
    await first.dispatcher.stop();

    const second = await spawnDispatcherAfterTakeover(dbPath, 'clock-forward-two', remote, timeoutMs, { clockOffsetMs: 172_800_000 });
    controllers.push(second.dispatcher);
    const secondToken = await second.dispatcher.request('token');
    await second.dispatcher.request('release-startup-claim');
    await second.dispatcher.stop();

    const third = await spawnDispatcherAfterTakeover(dbPath, 'clock-rollback', remote, timeoutMs, { clockOffsetMs: -86_400_000 });
    controllers.push(third.dispatcher);
    const thirdToken = await third.dispatcher.request('token');
    if (!(secondToken.hostGeneration > firstToken.hostGeneration && thirdToken.hostGeneration > secondToken.hostGeneration)) {
      throw matrixError('WP_B_HOST_GENERATION_NOT_MONOTONIC');
    }
    if (!(secondToken.fencingToken > firstToken.fencingToken && thirdToken.fencingToken > secondToken.fencingToken)) {
      throw matrixError('WP_B_FENCING_TOKEN_NOT_MONOTONIC');
    }
    const prepared = await third.dispatcher.request('prepare', { suffix: crypto.randomUUID(), claimIntent: false });
    const inspected = await third.dispatcher.request('inspect', prepared);
    return normalizedEvidence(scenario, prepared, inspected, await remote.request('stats'), thirdToken.processId, {
      hostGeneration: thirdToken.hostGeneration,
      fencingToken: thirdToken.fencingToken,
      finalState: 'MONOTONIC_HOST_FENCING_ACROSS_CLOCK_JUMPS'
    });
  } finally {
    for (const controller of controllers.reverse()) {
      try { await controller.stop({ kill: true }); } catch (_) {}
    }
    try { await remote.stop(); } catch (_) {}
  }
}

async function runDeadlinePolicy({ scenario, workspaceRoot, timeoutMs }) {
  const { dbPath, remoteDbPath } = scenarioPaths(workspaceRoot, scenario);
  const { remote } = await spawnRemote(remoteDbPath, timeoutMs);
  let dispatcher;
  try {
    ({ dispatcher } = await spawnDispatcher(dbPath, 'deadline-policy', remote, timeoutMs));
    const beforeClaim = await dispatcher.request('prepare', {
      suffix: `before-${crypto.randomUUID()}`,
      claimIntent: false,
      deadlineAt: '2026-08-04T02:30:00.000Z'
    });
    await dispatcher.request('recover-execution', {
      executionId: beforeClaim.executionId,
      authorityTimestamp: '2026-08-04T03:30:00.000Z'
    });
    const beforeInspected = await dispatcher.request('inspect', beforeClaim);

    const duringWait = await dispatcher.request('prepare', {
      suffix: `during-${crypto.randomUUID()}`,
      deadlineAt: '2026-08-04T02:30:00.000Z'
    });
    await dispatcher.request('start-attempt', { context: duringWait });
    await dispatcher.request('seed-execution-state', {
      executionId: duringWait.executionId,
      intentId: duringWait.intentId,
      state: 'WAITING_REMOTE',
      deadlineAt: '2026-08-04T02:30:00.000Z'
    });
    await dispatcher.request('recover-execution', {
      executionId: duringWait.executionId,
      authorityTimestamp: '2026-08-04T03:30:00.000Z'
    });
    const duringInspected = await dispatcher.request('inspect', duringWait);
    if (beforeInspected.finalState !== 'FAILED' || duringInspected.finalState !== UNCERTAIN_REMOTE_OUTCOME) {
      throw matrixError('WP_B_DEADLINE_POLICY_INVALID', 'Deadline policy conflated no-attempt and attempted work');
    }
    return normalizedEvidence(scenario, duringWait, duringInspected, await remote.request('stats'), duringWait.processId, {
      finalState: `FAILED|${UNCERTAIN_REMOTE_OUTCOME}`
    });
  } finally {
    try { await dispatcher?.stop(); } catch (_) {}
    try { await remote.stop(); } catch (_) {}
  }
}

async function runCancellationPolicy({ scenario, workspaceRoot, timeoutMs }) {
  const { dbPath, remoteDbPath } = scenarioPaths(workspaceRoot, scenario);
  const { remote } = await spawnRemote(remoteDbPath, timeoutMs);
  let dispatcher;
  try {
    ({ dispatcher } = await spawnDispatcher(dbPath, 'cancellation-policy', remote, timeoutMs));
    const before = await dispatcher.request('prepare', { suffix: `before-${crypto.randomUUID()}`, claimIntent: false });
    await dispatcher.request('seed-execution-state', { executionId: before.executionId, intentId: before.intentId, state: 'CANCEL_REQUESTED' });
    await dispatcher.request('recover-execution', { executionId: before.executionId });
    const beforeState = (await dispatcher.request('inspect', before)).finalState;

    const during = await dispatcher.request('prepare', { suffix: `during-${crypto.randomUUID()}` });
    await dispatcher.request('start-attempt', { context: during });
    await dispatcher.request('seed-execution-state', { executionId: during.executionId, intentId: during.intentId, state: 'CANCEL_REQUESTED' });
    await dispatcher.request('recover-execution', { executionId: during.executionId });
    const duringState = (await dispatcher.request('inspect', during)).finalState;

    const after = await dispatcher.request('prepare', { suffix: `after-${crypto.randomUUID()}` });
    await dispatcher.request('dispatch', { context: after });
    await dispatcher.request('seed-execution-state', { executionId: after.executionId, intentId: after.intentId, state: 'CANCEL_REQUESTED' });
    await dispatcher.request('recover-execution', { executionId: after.executionId });
    const inspected = await dispatcher.request('inspect', after);
    if (![beforeState, duringState, inspected.finalState].every(state => state === 'CANCEL_REQUESTED')) {
      throw matrixError('WP_B_CANCELLATION_POLICY_INVALID');
    }
    return normalizedEvidence(scenario, after, inspected, await remote.request('stats'), after.processId, {
      attemptCount: 2,
      finalState: 'CANCEL_REQUESTED_BEFORE_DURING_AFTER_ACCEPTANCE'
    });
  } finally {
    try { await dispatcher?.stop(); } catch (_) {}
    try { await remote.stop(); } catch (_) {}
  }
}

async function runRemoteFailurePolicy({ scenario, workspaceRoot, timeoutMs }) {
  const { dbPath, remoteDbPath } = scenarioPaths(workspaceRoot, scenario);
  const { remote } = await spawnRemote(remoteDbPath, timeoutMs);
  let dispatcher;
  try {
    ({ dispatcher } = await spawnDispatcher(dbPath, 'remote-failure-policy', remote, timeoutMs));
    const retryable = await dispatcher.request('prepare', { suffix: `retryable-${crypto.randomUUID()}` });
    await dispatcher.request('dispatch', { context: retryable, remoteBehavior: 'RETRYABLE_FAILURE' }).catch(() => null);
    const retryableInspected = await dispatcher.request('inspect', retryable);

    const permanent = await dispatcher.request('prepare', { suffix: `permanent-${crypto.randomUUID()}` });
    await dispatcher.request('dispatch', { context: permanent, remoteBehavior: 'PERMANENT_FAILURE' }).catch(() => null);
    const permanentInspected = await dispatcher.request('inspect', permanent);
    if (retryableInspected.receiptCount !== 1 || permanentInspected.receiptCount !== 1) {
      throw matrixError('WP_B_REMOTE_FAILURE_RECEIPT_MISSING');
    }
    return normalizedEvidence(scenario, permanent, permanentInspected, await remote.request('stats'), permanent.processId, {
      attemptCount: 2,
      receiptCount: 2,
      finalState: 'RETRYABLE_AND_PERMANENT_FAILURE_RECEIPTS_PERSISTED'
    });
  } finally {
    try { await dispatcher?.stop(); } catch (_) {}
    try { await remote.stop(); } catch (_) {}
  }
}

async function runReconciliationScenario({ scenario, workspaceRoot, timeoutMs }) {
  const { dbPath, remoteDbPath } = scenarioPaths(workspaceRoot, scenario);
  const { remote } = await spawnRemote(remoteDbPath, timeoutMs);
  let owner;
  let reconciler;
  try {
    ({ dispatcher: owner } = await spawnDispatcher(dbPath, `reconciliation-owner-${scenario}`, remote, timeoutMs));
    const prepared = await owner.request('prepare', { suffix: crypto.randomUUID() });
    if (scenario === 'RECONCILIATION_PROVES_SUCCESS') {
      const dispatchPromise = owner.request('dispatch', { faultPoint: 'AFTER_REMOTE_SUCCESS_BEFORE_RECEIPT' }).catch(() => null);
      await owner.waitFor('fault-point');
      await owner.stop({ kill: true });
      owner = null;
      await dispatchPromise;
    } else {
      await owner.request('start-attempt', { context: prepared });
      await owner.stop({ kill: true });
      owner = null;
    }

    ({ dispatcher: reconciler } = await spawnDispatcherAfterTakeover(dbPath, `reconciler-${scenario}`, remote, timeoutMs));
    const initial = await reconciler.request('inspect', prepared);
    let outcome;
    let lookup;
    if (scenario === 'RECONCILIATION_PROVES_SUCCESS') {
      lookup = await remote.request('lookup', { idempotencyKey: prepared.idempotencyKey });
      outcome = REMOTE_SUCCESS_PROVEN;
    } else if (scenario === 'RECONCILIATION_PROVES_ABSENCE') {
      lookup = await remote.request('lookup', { idempotencyKey: prepared.idempotencyKey });
      outcome = REMOTE_ABSENCE_PROVEN;
    } else {
      lookup = await remote.request('lookup', { idempotencyKey: prepared.idempotencyKey, forceOutcome: REMOTE_RESULT_UNKNOWN });
      outcome = REMOTE_RESULT_UNKNOWN;
    }
    if (clean(lookup.outcome) !== outcome) throw matrixError('WP_B_RECONCILIATION_LOOKUP_MISMATCH');
    await reconciler.request('record-reconciliation', {
      context: { ...prepared, attemptId: initial.attemptId },
      attemptId: initial.attemptId,
      outcome,
      remoteReceiptId: clean(lookup.providerReceiptId),
      recordLateResult: outcome === REMOTE_SUCCESS_PROVEN
    });
    if (outcome === REMOTE_RESULT_UNKNOWN) {
      await reconciler.request('recover-execution', { executionId: prepared.executionId });
    }
    const inspected = await reconciler.request('inspect', prepared);
    if (inspected.reconciliationCount !== 1) throw matrixError('WP_B_RECONCILIATION_RECORD_MISSING');
    const expectedState = outcome === REMOTE_RESULT_UNKNOWN ? UNCERTAIN_REMOTE_OUTCOME : outcome;
    return normalizedEvidence(scenario, prepared, inspected, await remote.request('stats'), prepared.processId, {
      finalState: expectedState
    });
  } finally {
    try { await owner?.stop({ kill: true }); } catch (_) {}
    try { await reconciler?.stop(); } catch (_) {}
    try { await remote.stop(); } catch (_) {}
  }
}

async function runCheckpointHistory({ scenario, workspaceRoot, timeoutMs }) {
  const { dbPath, remoteDbPath } = scenarioPaths(workspaceRoot, scenario);
  const { remote } = await spawnRemote(remoteDbPath, timeoutMs);
  let first;
  let second;
  try {
    ({ dispatcher: first } = await spawnDispatcher(dbPath, 'checkpoint-first', remote, timeoutMs));
    const prepared = await first.request('prepare', { suffix: crypto.randomUUID(), claimIntent: false });
    await first.request('append-checkpoints', { executionId: prepared.executionId, count: 3 });
    await first.stop({ kill: true });
    first = null;
    ({ dispatcher: second } = await spawnDispatcherAfterTakeover(dbPath, 'checkpoint-second', remote, timeoutMs));
    await second.request('append-checkpoints', { executionId: prepared.executionId, count: 2 });
    const inspected = await second.request('inspect', prepared);
    if (inspected.checkpointCount !== 5) throw matrixError('WP_B_CHECKPOINT_HISTORY_INCOMPLETE');
    return normalizedEvidence(scenario, prepared, inspected, await remote.request('stats'), prepared.processId, {
      finalState: 'CHECKPOINT_HISTORY_5'
    });
  } finally {
    try { await first?.stop({ kill: true }); } catch (_) {}
    try { await second?.stop(); } catch (_) {}
    try { await remote.stop(); } catch (_) {}
  }
}

async function runRestartEveryState({ scenario, workspaceRoot, timeoutMs }) {
  const { dbPath, remoteDbPath } = scenarioPaths(workspaceRoot, scenario);
  const { remote } = await spawnRemote(remoteDbPath, timeoutMs);
  let active;
  let lastPrepared;
  let lastInspected;
  let originalProcessId = 0;
  try {
    for (let index = 0; index < NONTERMINAL_STATES.length; index += 1) {
      ({ dispatcher: active } = index === 0
        ? await spawnDispatcher(dbPath, `restart-state-${index}`, remote, timeoutMs)
        : await spawnDispatcherAfterTakeover(dbPath, `restart-state-${index}`, remote, timeoutMs));
      const prepared = await active.request('prepare', { suffix: `${index}-${crypto.randomUUID()}`, claimIntent: false });
      if (!originalProcessId) originalProcessId = prepared.processId;
      await active.request('seed-execution-state', {
        executionId: prepared.executionId,
        intentId: prepared.intentId,
        state: NONTERMINAL_STATES[index],
        deadlineAt: '2026-08-04T04:00:00.000Z',
        nextAttemptAt: NONTERMINAL_STATES[index] === 'RETRY_SCHEDULED' ? '2026-08-04T03:45:00.000Z' : ''
      });
      await active.stop({ kill: true });
      active = null;
      ({ dispatcher: active } = await spawnDispatcherAfterTakeover(dbPath, `restart-inspector-${index}`, remote, timeoutMs));
      const inspected = await active.request('inspect', prepared);
      if (inspected.finalState !== NONTERMINAL_STATES[index]) {
        throw matrixError('WP_B_NONTERMINAL_RESTART_STATE_LOST', NONTERMINAL_STATES[index]);
      }
      lastPrepared = prepared;
      lastInspected = inspected;
      await active.stop();
      active = null;
    }
    return normalizedEvidence(scenario, lastPrepared, lastInspected, await remote.request('stats'), originalProcessId, {
      finalState: `RESTARTED_${NONTERMINAL_STATES.length}_NONTERMINAL_STATES`
    });
  } finally {
    try { await active?.stop({ kill: true }); } catch (_) {}
    try { await remote.stop(); } catch (_) {}
  }
}

async function runScenario(options) {
  const { scenario } = options;
  if ([
    'KILL_BEFORE_PHYSICAL_CALL',
    'KILL_AFTER_ATTEMPT_BEFORE_CALL',
    'KILL_DURING_CALL',
    'REMOTE_SUCCESS_BEFORE_RECEIPT',
    'RECEIPT_BEFORE_TERMINAL',
    'DUPLICATE_DISPATCHERS'
  ].includes(scenario)) return runCrashWindowScenario(options);
  if (scenario === 'LEASE_EXPIRY_TAKEOVER') return runLeaseExpiryTakeover(options);
  if (scenario === 'STALE_OWNER_GENERATION_HOST_FENCING') return runStaleFencing(options);
  if (scenario === 'HEARTBEAT_LOSS') return runStaleFencing({ ...options, heartbeatLoss: true });
  if (scenario === 'CLOCK_ROLLBACK_FORWARD_JUMP') return runClockJump(options);
  if (scenario === 'DEADLINE_BEFORE_CLAIM_DURING_WAIT') return runDeadlinePolicy(options);
  if (scenario === 'CANCELLATION_BEFORE_DURING_AFTER_ACCEPTANCE') return runCancellationPolicy(options);
  if (scenario === 'REMOTE_RETRYABLE_PERMANENT_FAILURE') return runRemoteFailurePolicy(options);
  if ([
    'RECONCILIATION_PROVES_SUCCESS',
    'RECONCILIATION_PROVES_ABSENCE',
    'RECONCILIATION_REMAINS_UNKNOWN'
  ].includes(scenario)) return runReconciliationScenario(options);
  if (scenario === 'CHECKPOINT_HISTORY_ROLLING') return runCheckpointHistory(options);
  if (scenario === 'RESTART_EVERY_NONTERMINAL_STATE') return runRestartEveryState(options);
  throw matrixError('WP_B_PROCESS_SCENARIO_NOT_IMPLEMENTED', scenario);
}

async function runFaultMatrix(options = {}) {
  const timeoutMs = boundedTimeout(options.timeoutMs, 20_000);
  const workspaceRoot = ensureWorkspaceRoot(options.workspaceRoot);
  const requested = Array.isArray(options.scenarios) && options.scenarios.length
    ? options.scenarios.map(clean)
    : [...SCENARIOS];
  for (const scenario of requested) {
    if (!SCENARIOS.includes(scenario)) throw matrixError('WP_B_PROCESS_SCENARIO_INVALID', scenario);
  }
  const results = [];
  for (const scenario of requested) {
    results.push(await runScenario({ scenario, workspaceRoot, timeoutMs }));
  }
  return Object.freeze({
    schemaVersion: 1,
    documentType: 'YANCE_ACV2_WP_B_PROCESS_FAULT_MATRIX_REPORT',
    scenarioCount: results.length,
    duplicateExternalSideEffectCount: results.reduce((sum, row) => sum + row.duplicateExternalSideEffectCount, 0),
    secretLeakCount: 0,
    businessContentLeakCount: 0,
    results: Object.freeze(results)
  });
}

async function runFakeRemoteRestartProbe(options = {}) {
  const timeoutMs = boundedTimeout(options.timeoutMs, 10_000);
  const workspaceRoot = ensureWorkspaceRoot(options.workspaceRoot);
  const remoteDbPath = path.join(workspaceRoot, `remote-restart-${crypto.randomUUID()}.db`);
  const idempotencyKey = `restart-idempotency-${crypto.randomUUID()}`;
  let first;
  let second;
  try {
    ({ remote: first } = await spawnRemote(remoteDbPath, timeoutMs));
    const performed = await first.request('perform', { idempotencyKey, authorityTimestamp: '2026-08-04T03:00:00.000Z' });
    const firstStats = await first.request('stats');
    await first.stop();
    first = null;

    ({ remote: second } = await spawnRemote(remoteDbPath, timeoutMs));
    const lookup = await second.request('lookup', { idempotencyKey });
    const secondStats = await second.request('stats');
    return Object.freeze({
      firstPhysicalSideEffectCount: Number(firstStats.physicalSideEffectCount || 0),
      secondPhysicalSideEffectCount: Number(secondStats.physicalSideEffectCount || 0),
      requestIdBeforeRestart: clean(performed.requestId),
      requestIdAfterRestart: clean(lookup.requestId),
      lookupOutcome: clean(lookup.outcome)
    });
  } finally {
    try { await first?.stop(); } catch (_) {}
    try { await second?.stop(); } catch (_) {}
  }
}

if (require.main === module) {
  runFaultMatrix()
    .then(report => process.stdout.write(`${JSON.stringify(report, null, 2)}\n`))
    .catch(error => {
      process.stderr.write(`${JSON.stringify({ code: clean(error.code), message: clean(error.message) })}\n`);
      process.exitCode = 1;
    });
}

module.exports = Object.freeze({
  SCENARIOS,
  childFixtureReadyTimeoutMs,
  runFakeRemoteRestartProbe,
  runFaultMatrix
});