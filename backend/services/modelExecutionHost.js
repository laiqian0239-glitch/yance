'use strict';

const path = require('node:path');
const { fork } = require('node:child_process');
const evidenceStore = require('./modelExecutionEvidenceStore');
const { resolveModelExecutionSpec } = require('./modelExecutionSpecResolver');
const systemPolicy = require('./systemPolicy');
const { createSystemPolicySnapshot } = require('./systemPolicySnapshotAuthority');
const { createModelExecutionEnvelope, verifyModelExecutionEnvelope } = require('./modelExecutionEnvelopeAuthority');
const aiRoleQualificationReceiptAuthority = require('./aiRoleQualificationReceiptAuthority');
const { ExternalActionDispatcher } = require('./externalActionDispatcher');
const {
  OPERATION_KINDS,
  assertReferenceOnlyEnvelope
} = require('./durableOperationRegistry');

const MAX_CAPTURE_CHARS = 4096;
const DEFAULT_WORKER_PATH = path.join(__dirname, 'modelExecutionWorker.js');
const DURABLE_PREPARATION_STATE = new WeakMap();

function clean(value) { return String(value == null ? '' : value).trim(); }
function appendTail(current, chunk) {
  return `${current || ''}${String(chunk || '')}`.slice(-MAX_CAPTURE_CHARS);
}
function hostError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, ...details });
}
function requiredString(value, field, maximum = 2048) {
  const result = clean(value);
  if (!result) throw hostError('WP_B_MODEL_EXECUTION_FIELD_REQUIRED', `${field} is required`, { field });
  if (result.length > maximum || /[\u0000-\u001f\u007f]/u.test(result)) {
    throw hostError('WP_B_MODEL_EXECUTION_FIELD_INVALID', `${field} is invalid`, { field, maximum });
  }
  return result;
}
function safeInteger(value, field, minimum = 0) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < minimum) {
    throw hostError('WP_B_MODEL_EXECUTION_INTEGER_INVALID', `${field} must be a safe integer >= ${minimum}`, { field });
  }
  return result;
}
function normalizedTimestamp(value, field) {
  const source = String(value == null ? '' : value);
  const milliseconds = Date.parse(source);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== source) {
    throw hostError('WP_B_MODEL_EXECUTION_TIMESTAMP_INVALID', `${field} must be normalized UTC ISO-8601`, { field });
  }
  return source;
}
function requireCapability(target, method, code) {
  if (!target || typeof target[method] !== 'function') throw new TypeError(code);
  return target;
}
function issueAuthorityTimestamp(issueTimestamp, purpose) {
  if (typeof issueTimestamp !== 'function') {
    throw new TypeError('Durable model execution requires an authority timestamp issuer');
  }
  return normalizedTimestamp(issueTimestamp(purpose), purpose);
}
function validateReferenceDocument(value, field) {
  try {
    assertReferenceOnlyEnvelope(value);
    return value;
  } catch (error) {
    if (error?.code) throw error;
    throw hostError('WP_B_MODEL_EXECUTION_REFERENCE_DOCUMENT_INVALID', `${field} must be reference-only`, { field });
  }
}
function validatePersistedAttempt(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw hostError(
      'WP_B_MODEL_EXECUTION_PERSISTED_ATTEMPT_REQUIRED',
      'Worker execution requires one persisted attempt envelope before fork'
    );
  }
  validateReferenceDocument(value, 'persistedAttempt');
  const attempt = Object.freeze({
    executionId: requiredString(value.executionId, 'persistedAttempt.executionId'),
    intentId: requiredString(value.intentId, 'persistedAttempt.intentId'),
    attemptId: requiredString(value.attemptId, 'persistedAttempt.attemptId'),
    idempotencyKey: requiredString(value.idempotencyKey, 'persistedAttempt.idempotencyKey'),
    ownerId: requiredString(value.ownerId, 'persistedAttempt.ownerId'),
    claimId: requiredString(value.claimId, 'persistedAttempt.claimId'),
    generation: safeInteger(value.generation, 'persistedAttempt.generation', 1),
    hostGeneration: safeInteger(value.hostGeneration, 'persistedAttempt.hostGeneration', 1),
    fencingToken: safeInteger(value.fencingToken, 'persistedAttempt.fencingToken', 1),
    leaseExpiresAt: normalizedTimestamp(value.leaseExpiresAt, 'persistedAttempt.leaseExpiresAt'),
    request: value.request
  });
  if (!attempt.request || typeof attempt.request !== 'object') {
    throw hostError('WP_B_MODEL_EXECUTION_ATTEMPT_REQUEST_REQUIRED', 'Persisted attempt request is required');
  }
  return attempt;
}
function redactText(value, secrets = []) {
  let text = String(value == null ? '' : value);
  text = text.replace(/authorization\s*[:=]\s*bearer\s+[^\s,;]+/giu, 'authorization=[REDACTED]');
  text = text.replace(/bearer\s+[^\s,;]+/giu, 'bearer [REDACTED]');
  for (const secret of secrets.filter(Boolean)) text = text.split(secret).join('[REDACTED]');
  return text;
}
function redactValue(value, secrets = [], key = '') {
  if (/^(?:authorization|credentialRef|apiKey)$/iu.test(key)) return '[REDACTED]';
  if (Array.isArray(value)) return value.map(item => redactValue(item, secrets));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, redactValue(item, secrets, name)]));
  }
  return typeof value === 'string' ? redactText(value, secrets) : value;
}
function executionError(value = {}, receipt = {}) {
  const error = new Error(String(value.message || 'Isolated model execution failed'));
  error.code = String(value.code || 'MODEL_EXECUTION_FAILED');
  error.status = Number(value.status || 0);
  if (value.stack) error.stack = String(value.stack);
  if (value.details && typeof value.details === 'object') error.details = value.details;
  Object.assign(error, {
    executionId: receipt.executionId,
    correlationId: receipt.correlationId,
    intentId: receipt.intentId,
    attemptId: receipt.attemptId,
    exitCode: receipt.exitCode,
    signal: receipt.signal,
    terminationClass: receipt.terminationClass,
    terminationReason: receipt.terminationReason,
    abortSource: receipt.abortSource,
    stderrTail: receipt.stderrTail,
    providerRequestId: receipt.providerRequestId
  });
  return error;
}
function terminatedError(receipt = {}) {
  return Object.assign(new Error('Isolated model execution was terminated'), {
    code: 'MODEL_EXECUTION_TERMINATED',
    executionId: receipt.executionId,
    correlationId: receipt.correlationId,
    intentId: receipt.intentId,
    attemptId: receipt.attemptId,
    reason: receipt.terminationReason || 'hard-termination',
    exitCode: receipt.exitCode,
    signal: receipt.signal,
    terminationClass: receipt.terminationClass,
    terminationReason: receipt.terminationReason,
    abortSource: receipt.abortSource,
    stderrTail: receipt.stderrTail,
    providerRequestId: receipt.providerRequestId
  });
}
function uncertainOutcomeError(receipt = {}) {
  return Object.assign(new Error('Provider accepted the request but the trusted result was not observed'), {
    code: 'UNCERTAIN_REMOTE_OUTCOME',
    status: 409,
    remoteOutcomeUnknown: true,
    executionId: receipt.executionId,
    correlationId: receipt.correlationId,
    intentId: receipt.intentId,
    attemptId: receipt.attemptId,
    providerRequestId: receipt.providerRequestId,
    terminationClass: receipt.terminationClass,
    terminationReason: receipt.terminationReason
  });
}
function reasonMetadata(reason, fallbackSource = 'runtime') {
  const code = clean(reason?.code || reason?.message || reason || 'hard-termination');
  const abortSource = clean(reason?.abortSource || fallbackSource);
  const upper = code.toUpperCase();
  const terminationClass = /TIMEOUT|DEADLINE/u.test(upper)
    ? 'timeout'
    : abortSource === 'caller' || /CANCEL|ABORT|DISCONNECT/u.test(upper)
      ? 'caller-abort'
      : 'requested-termination';
  return { code, abortSource, terminationClass };
}

function prepareDurableModelExecution({
  operationKind = OPERATION_KINDS.AI_PROVIDER_EXECUTION,
  idempotencyKey,
  traceId = '',
  command,
  durableExecutionAuthority,
  outboxAuthority,
  issueTimestamp,
  deadlineAt = '',
  maxAttempts = 3
} = {}) {
  if (operationKind !== OPERATION_KINDS.AI_PROVIDER_EXECUTION) {
    throw hostError('WP_B_MODEL_EXECUTION_OPERATION_KIND_INVALID', 'Model execution requires AI_PROVIDER_EXECUTION', { operationKind });
  }
  const normalizedIdempotencyKey = requiredString(idempotencyKey, 'idempotencyKey');
  const referenceCommand = validateReferenceDocument(command, 'command');
  requireCapability(durableExecutionAuthority, 'createExecution', 'Durable model execution requires DurableExecutionAuthority.createExecution');
  requireCapability(outboxAuthority, 'createIntent', 'Durable model execution requires ExternalActionOutboxAuthority.createIntent');
  const execution = durableExecutionAuthority.createExecution({
    operationKind,
    idempotencyKey: normalizedIdempotencyKey,
    traceId: clean(traceId),
    command: referenceCommand,
    deadlineAt: clean(deadlineAt),
    maxAttempts,
    authorityTimestamp: issueAuthorityTimestamp(issueTimestamp, 'durable-model-execution')
  });
  const executionId = requiredString(execution?.executionId, 'execution.executionId');
  const intent = outboxAuthority.createIntent({
    executionId,
    actionKind: operationKind,
    idempotencyKey: normalizedIdempotencyKey,
    payload: referenceCommand,
    authorityTimestamp: issueAuthorityTimestamp(issueTimestamp, 'durable-model-intent')
  });
  const intentId = requiredString(intent?.intentId, 'intent.intentId');
  const result = {
    executionId,
    intentId,
    operationKind,
    idempotencyKey: normalizedIdempotencyKey
  };
  DURABLE_PREPARATION_STATE.set(result, Object.freeze({ execution, intent }));
  return Object.freeze(result);
}

function startDurableModelExecution(input = {}) {
  const durableExecutionAuthority = requireCapability(
    input.durableExecutionAuthority,
    'schedule',
    'Durable model start requires DurableExecutionAuthority.schedule'
  );
  requireCapability(durableExecutionAuthority, 'claim', 'Durable model start requires DurableExecutionAuthority.claim');
  const outboxAuthority = requireCapability(
    input.outboxAuthority,
    'claimIntent',
    'Durable model start requires ExternalActionOutboxAuthority.claimIntent'
  );
  requireCapability(outboxAuthority, 'startAttempt', 'Durable model start requires ExternalActionOutboxAuthority.startAttempt');
  const adapter = input.adapter;
  if (!adapter || !Object.isFrozen(adapter)
      || adapter.operationKind !== OPERATION_KINDS.AI_PROVIDER_EXECUTION
      || typeof adapter.perform !== 'function') {
    throw new TypeError('Durable model start requires the frozen AI_PROVIDER_EXECUTION Adapter');
  }
  const request = validateReferenceDocument(input.request, 'request');
  const ownerId = requiredString(input.ownerId, 'ownerId');
  const claimId = requiredString(input.claimId, 'claimId');
  const hostId = requiredString(input.hostId, 'hostId');
  const hostGeneration = safeInteger(input.hostGeneration, 'hostGeneration', 1);
  const fencingToken = safeInteger(input.fencingToken, 'fencingToken', 1);
  const leaseExpiresAt = normalizedTimestamp(input.leaseExpiresAt, 'leaseExpiresAt');

  const prepared = prepareDurableModelExecution(input);
  const state = DURABLE_PREPARATION_STATE.get(prepared);
  const executionCreated = state.execution;
  const intentCreated = state.intent;
  const scheduled = durableExecutionAuthority.schedule({
    executionId: prepared.executionId,
    stateVersion: safeInteger(executionCreated.stateVersion ?? 0, 'execution.stateVersion'),
    generation: safeInteger(executionCreated.generation ?? 0, 'execution.generation'),
    operationKind: prepared.operationKind,
    hostId,
    hostGeneration,
    fencingToken,
    authorityTimestamp: issueAuthorityTimestamp(input.issueTimestamp, 'durable-model-schedule')
  });
  const leaseStartedAt = issueAuthorityTimestamp(input.issueTimestamp, 'durable-model-claim');
  const executionClaim = durableExecutionAuthority.claim({
    executionId: prepared.executionId,
    stateVersion: safeInteger(scheduled.stateVersion, 'scheduled.stateVersion'),
    generation: safeInteger(scheduled.generation, 'scheduled.generation'),
    ownerId,
    claimId,
    hostId,
    hostGeneration,
    fencingToken,
    leaseStartedAt,
    leaseExpiresAt
  });
  const intentClaim = outboxAuthority.claimIntent({
    intentId: prepared.intentId,
    stateVersion: safeInteger(intentCreated.claim?.stateVersion ?? 0, 'intent.claim.stateVersion'),
    generation: safeInteger(intentCreated.claim?.generation ?? 0, 'intent.claim.generation'),
    ownerId,
    claimId,
    hostId,
    hostGeneration,
    fencingToken,
    leaseStartedAt,
    leaseExpiresAt
  });
  const dispatcher = new ExternalActionDispatcher({
    outboxAuthority,
    adapter,
    issueTimestamp: input.issueTimestamp
  });
  const result = dispatcher.dispatch({
    executionId: prepared.executionId,
    intentId: prepared.intentId,
    idempotencyKey: prepared.idempotencyKey,
    ownerId,
    claimId,
    hostId,
    stateVersion: safeInteger(intentClaim.claim?.stateVersion, 'claimedIntent.stateVersion'),
    generation: safeInteger(intentClaim.claim?.generation, 'claimedIntent.generation', 1),
    hostGeneration,
    fencingToken,
    leaseExpiresAt,
    request
  });
  return Object.freeze({
    executionId: prepared.executionId,
    intentId: prepared.intentId,
    claimId,
    generation: safeInteger(executionClaim.generation, 'executionClaim.generation', 1),
    result,
    requestTermination(reason = 'durable-model-termination-requested') {
      if (typeof input.requestTermination === 'function') return input.requestTermination(reason);
      return Promise.resolve(null);
    }
  });
}

function externalModelSelectionBinding({ task, model, suppliedReceipt } = {}) {
  if (suppliedReceipt && typeof suppliedReceipt === 'object' && !Array.isArray(suppliedReceipt)) {
    return Object.freeze({ ...suppliedReceipt });
  }
  return Object.freeze({
    schemaVersion: 1,
    authority: 'MODEL_BRAIN_EXTERNAL_SELECTION_BINDING',
    routingAuthority: 'LiteLLM Model Brain',
    task: clean(task),
    selectedModelId: clean(model?.id),
    routingDecisionOwnedExternally: true,
    hostRoutingPerformed: false
  });
}

function startModelExecution({
  persistedAttempt: persistedAttemptInput,
  executionId: requestedExecutionId = '',
  correlationId: requestedCorrelationId = '',
  task = '',
  model,
  messages,
  options = {},
  signal = null,
  workerPath = DEFAULT_WORKER_PATH,
  resolveExecutionSpec = null,
  childProcessFactory = fork,
  evidenceWriter = receipt => evidenceStore.append(receipt),
  readSystemPolicy = () => systemPolicy.read(),
  now = () => new Date(),
  terminationGraceMs = 250
} = {}) {
  const persistedAttempt = validatePersistedAttempt(persistedAttemptInput);
  const requested = clean(requestedExecutionId);
  if (requested && requested !== persistedAttempt.executionId) {
    throw hostError('WP_B_MODEL_EXECUTION_ATTEMPT_EXECUTION_MISMATCH', 'Requested executionId differs from persisted attempt', {
      requestedExecutionId: requested,
      persistedExecutionId: persistedAttempt.executionId
    });
  }
  const executionId = persistedAttempt.executionId;
  const correlationId = clean(requestedCorrelationId || options.correlationId) || executionId;
  const clockNow = now();
  const startedAt = clockNow.toISOString();
  const startedAtMs = Date.now();
  const graceMs = Math.max(10, Number(terminationGraceMs || 250));
  const onToken = typeof options.onToken === 'function' ? options.onToken : null;
  const workerOptions = { ...options };
  delete workerOptions.onToken;
  delete workerOptions.routeReceipt;
  delete workerOptions.qualityRouteReceipt;
  if (onToken) workerOptions.streamTokens = true;
  const specResolver = typeof resolveExecutionSpec === 'function' ? resolveExecutionSpec : resolveModelExecutionSpec;
  const executionSpec = specResolver(model);
  const routeReceipt = externalModelSelectionBinding({
    task,
    model,
    suppliedReceipt: options.routeReceipt || options.qualityRouteReceipt
  });
  const qualificationReceipt = aiRoleQualificationReceiptAuthority.receiptFor(model, task) || {
    schemaVersion: aiRoleQualificationReceiptAuthority.SCHEMA_VERSION,
    authority: aiRoleQualificationReceiptAuthority.AUTHORITY,
    modelId: clean(model?.id),
    task: clean(task),
    pass: false,
    reason: 'ROLE_RECEIPT_MISSING'
  };
  const policySnapshot = createSystemPolicySnapshot(readSystemPolicy(), {
    createdAt: startedAt
  });
  const timeoutMs = Math.max(1, Number(workerOptions.timeoutMs || 120000));
  const envelope = verifyModelExecutionEnvelope(createModelExecutionEnvelope({
    executionId,
    correlationId,
    task,
    executionSpec,
    policySnapshot,
    routeReceipt,
    qualificationReceipt,
    messages,
    options: workerOptions,
    deadlineAt: new Date(clockNow.getTime() + timeoutMs).toISOString()
  }));
  const secrets = [clean(executionSpec.credential?.apiKey), clean(model?.credentialRef)];
  const child = childProcessFactory(workerPath, [], {
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: {
      ...process.env,
      YANCE_PROCESS_ROLE: 'model-execution-worker',
      YANCE_SQLITE_ACCESS: 'forbidden',
      YANCE_MODEL_EXECUTION_ID: executionId,
      YANCE_MODEL_CORRELATION_ID: correlationId,
      YANCE_MODEL_INTENT_ID: persistedAttempt.intentId,
      YANCE_MODEL_ATTEMPT_ID: persistedAttempt.attemptId
    }
  });

  let resultMessage = null;
  let errorMessage = null;
  let requestedTermination = null;
  let exited = false;
  let workerStarted = false;
  let lastWorkerMessageType = '';
  let providerRequestId = '';
  let stdoutTail = '';
  let stderrTail = '';
  let softKillTimer = null;
  let hardKillTimer = null;
  let resolveSpawned;
  let rejectSpawned;
  let resolveStarted;
  let rejectStarted;
  let startedSettled = false;
  let resolveExit;
  let resolveResult;
  let rejectResult;

  child.stdout?.on('data', chunk => { stdoutTail = appendTail(stdoutTail, chunk); });
  child.stderr?.on('data', chunk => { stderrTail = appendTail(stderrTail, chunk); });

  const spawned = new Promise((resolve, reject) => { resolveSpawned = resolve; rejectSpawned = reject; });
  const started = new Promise((resolve, reject) => { resolveStarted = resolve; rejectStarted = reject; });
  started.catch(() => {});
  const exit = new Promise(resolve => { resolveExit = resolve; });
  const result = new Promise((resolve, reject) => { resolveResult = resolve; rejectResult = reject; });

  const clearTerminationTimers = () => {
    if (softKillTimer) clearTimeout(softKillTimer);
    if (hardKillTimer) clearTimeout(hardKillTimer);
    softKillTimer = null;
    hardKillTimer = null;
  };

  child.once('spawn', () => {
    resolveSpawned({ executionId, correlationId, intentId: persistedAttempt.intentId, attemptId: persistedAttempt.attemptId, pid: child.pid });
    child.send({ type: 'execute', envelope, persistedAttempt });
  });

  child.on('message', message => {
    if (!message || String(message.executionId || executionId) !== executionId) return;
    lastWorkerMessageType = clean(message.type);
    workerStarted = true;
    if (!startedSettled) {
      startedSettled = true;
      resolveStarted({ executionId, correlationId, pid: child.pid, workerStarted: true, messageType: lastWorkerMessageType });
    }
    if (message.type === 'token' && onToken) onToken(message.token);
    if (message.type === 'provider-request') providerRequestId = clean(message.providerRequestId);
    if (message.type === 'result') {
      resultMessage = message.result;
      providerRequestId = clean(message.providerRequestId || message.result?.providerRequestId || message.result?.requestId || providerRequestId);
    }
    if (message.type === 'error') {
      errorMessage = redactValue(message.error || {}, secrets);
      providerRequestId = clean(message.providerRequestId || errorMessage?.providerRequestId || errorMessage?.requestId || providerRequestId);
    }
  });

  child.once('error', error => {
    rejectSpawned(error);
    if (!startedSettled) {
      startedSettled = true;
      rejectStarted(error);
    }
    if (!exited) errorMessage = { code: error.code || 'MODEL_EXECUTION_SPAWN_FAILED', message: error.message, stack: error.stack };
  });

  child.once('exit', (code, childSignal) => {
    exited = true;
    clearTerminationTimers();
    signal?.removeEventListener?.('abort', abortListener);
    const exitCode = Number.isInteger(code) ? code : null;
    const successful = resultMessage !== null && exitCode === 0 && !requestedTermination;
    const remoteOutcomeUnknown = !successful
      && !requestedTermination
      && resultMessage === null
      && Boolean(providerRequestId);
    let terminationClass = 'completed';
    let terminationReason = 'MODEL_EXECUTION_COMPLETED';
    let abortSource = '';
    if (requestedTermination) {
      terminationClass = requestedTermination.terminationClass;
      terminationReason = requestedTermination.code;
      abortSource = requestedTermination.abortSource;
    } else if (remoteOutcomeUnknown) {
      terminationClass = 'uncertain-remote-outcome';
      terminationReason = 'UNCERTAIN_REMOTE_OUTCOME';
    } else if (resultMessage === null && exitCode === 0 && !errorMessage) {
      terminationClass = 'result-envelope-lost';
      terminationReason = 'WORKER_EXITED_WITHOUT_RESULT';
    } else if (errorMessage) {
      terminationClass = 'worker-reported-error';
      terminationReason = clean(errorMessage.code || 'WORKER_REPORTED_ERROR');
    } else if (exitCode !== 0) {
      terminationClass = 'worker-nonzero-exit';
      terminationReason = `WORKER_EXIT_CODE_${exitCode == null ? 'UNKNOWN' : exitCode}`;
    } else if (childSignal) {
      terminationClass = 'worker-signalled';
      terminationReason = `WORKER_SIGNAL_${childSignal}`;
    }
    if (!startedSettled) {
      startedSettled = true;
      const notStarted = Object.assign(new Error('Isolated model worker exited before protocol readiness'), {
        code: 'MODEL_EXECUTION_NOT_STARTED',
        executionId,
        correlationId,
        exitCode,
        signal: clean(childSignal)
      });
      rejectStarted(notStarted);
    }
    const receipt = {
      authority: 'ModelExecutionHost',
      schemaVersion: 3,
      terminated: !successful,
      executionId,
      correlationId,
      intentId: persistedAttempt.intentId,
      attemptId: persistedAttempt.attemptId,
      claimId: persistedAttempt.claimId,
      generation: persistedAttempt.generation,
      hostGeneration: persistedAttempt.hostGeneration,
      fencingToken: persistedAttempt.fencingToken,
      modelId: clean(model?.id),
      task: clean(task),
      exitCode,
      signal: clean(childSignal),
      pid: child.pid || 0,
      workerStarted,
      lastWorkerMessageType,
      terminationClass,
      terminationReason,
      abortSource,
      stderrTail: redactText(stderrTail, secrets),
      stdoutTail: redactText(stdoutTail, secrets),
      providerRequestId,
      envelopeSchemaVersion: Number(envelope.schemaVersion),
      envelopeDigest: clean(envelope.integrity?.digest),
      policySnapshotVersion: Number(envelope.policySnapshot?.sourceVersion || 0),
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Math.max(0, Date.now() - startedAtMs)
    };
    void Promise.resolve(evidenceWriter(receipt)).catch(() => {});
    resolveExit(receipt);
    if (successful) {
      resolveResult(resultMessage);
      return;
    }
    if (remoteOutcomeUnknown) {
      rejectResult(uncertainOutcomeError(receipt));
      return;
    }
    if (errorMessage) {
      rejectResult(executionError(errorMessage, receipt));
      return;
    }
    rejectResult(terminatedError(receipt));
  });

  function requestTermination(reason = 'hard-termination') {
    requestedTermination ||= reasonMetadata(reason, clean(reason?.abortSource) || 'runtime');
    if (exited) return exit;
    try {
      if (child.connected) child.send({ type: 'terminate', executionId, correlationId, reason: requestedTermination.code, abortSource: requestedTermination.abortSource });
    } catch (_) {}
    softKillTimer ||= setTimeout(() => {
      if (exited) return;
      try { child.kill('SIGTERM'); } catch (_) {}
      hardKillTimer ||= setTimeout(() => {
        if (exited) return;
        try { child.kill('SIGKILL'); } catch (_) {}
      }, graceMs);
      hardKillTimer.unref?.();
    }, graceMs);
    softKillTimer.unref?.();
    return exit;
  }

  const abortListener = () => {
    const reason = signal?.reason || 'caller-abort';
    if (reason && typeof reason === 'object' && !reason.abortSource) reason.abortSource = 'caller';
    requestTermination(reasonMetadata(reason, 'caller'));
  };
  if (signal?.aborted) abortListener();
  else signal?.addEventListener?.('abort', abortListener, { once: true });

  return Object.freeze({
    executionId,
    correlationId,
    intentId: persistedAttempt.intentId,
    attemptId: persistedAttempt.attemptId,
    pid: child.pid || 0,
    spawned,
    started,
    result,
    exit,
    requestTermination
  });
}

module.exports = Object.freeze({
  prepareDurableModelExecution,
  startDurableModelExecution,
  startModelExecution,
  validatePersistedAttempt
});
