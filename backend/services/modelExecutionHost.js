'use strict';

const path = require('node:path');
const { fork } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const evidenceStore = require('./modelExecutionEvidenceStore');
const { resolveModelExecutionSpec } = require('./modelExecutionSpecResolver');
const systemPolicy = require('./systemPolicy');
const { createSystemPolicySnapshot } = require('./systemPolicySnapshotAuthority');
const { createModelExecutionEnvelope, verifyModelExecutionEnvelope } = require('./modelExecutionEnvelopeAuthority');
const aiQualityRouteAuthority = require('./aiQualityRouteAuthority');
const aiRoleQualificationReceiptAuthority = require('./aiRoleQualificationReceiptAuthority');

const MAX_CAPTURE_CHARS = 4096;
const DEFAULT_WORKER_PATH = path.join(__dirname, 'modelExecutionWorker.js');

function clean(value) { return String(value == null ? '' : value).trim(); }
function appendTail(current, chunk) {
  return `${current || ''}${String(chunk || '')}`.slice(-MAX_CAPTURE_CHARS);
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

function startModelExecution({
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
  const executionId = clean(requestedExecutionId) || randomUUID();
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
  const routeReceipt = options.routeReceipt || options.qualityRouteReceipt || aiQualityRouteAuthority.routeReceipt({
    task,
    selectedModel: model
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
  const child = childProcessFactory(DEFAULT_WORKER_PATH, [], {
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: {
      ...process.env,
      YANCE_PROCESS_ROLE: 'model-execution-worker',
      YANCE_SQLITE_ACCESS: 'forbidden',
      YANCE_MODEL_EXECUTION_ID: executionId,
      YANCE_MODEL_CORRELATION_ID: correlationId
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
  // The host owns a rejection handler so workers that terminate before their
  // first protocol envelope do not create an unhandled rejection for callers
  // that only await result/exit. Consumers can still await `started` and
  // receive the original rejection.
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
    resolveSpawned({ executionId, correlationId, pid: child.pid });
    child.send({ type: 'execute', envelope });
  });

  child.on('message', message => {
    if (!message || String(message.executionId || executionId) !== executionId) return;
    lastWorkerMessageType = clean(message.type);
    // Any valid execution envelope proves that the isolated worker reached
    // the application protocol. `started` therefore means protocol-ready,
    // not merely that Windows/Linux spawned a child process.
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
    let terminationClass = 'completed';
    let terminationReason = 'MODEL_EXECUTION_COMPLETED';
    let abortSource = '';
    if (requestedTermination) {
      terminationClass = requestedTermination.terminationClass;
      terminationReason = requestedTermination.code;
      abortSource = requestedTermination.abortSource;
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
      schemaVersion: 2,
      terminated: !successful,
      executionId,
      correlationId,
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

  return { executionId, correlationId, pid: child.pid || 0, spawned, started, result, exit, requestTermination };
}

module.exports = { startModelExecution };
