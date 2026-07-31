'use strict';

const path = require('node:path');
const { fork } = require('node:child_process');
const { randomUUID } = require('node:crypto');

function executionError(value = {}) {
  const error = new Error(String(value.message || 'Isolated model execution failed'));
  error.code = String(value.code || 'MODEL_EXECUTION_FAILED');
  error.status = Number(value.status || 0);
  if (value.stack) error.stack = String(value.stack);
  if (value.details && typeof value.details === 'object') error.details = value.details;
  return error;
}

function terminatedError(executionId, reason) {
  return Object.assign(new Error('Isolated model execution was terminated'), {
    code: 'MODEL_EXECUTION_TERMINATED',
    executionId,
    reason: String(reason || 'hard-termination')
  });
}

function startModelExecution({
  executionId: requestedExecutionId = '',
  model,
  messages,
  options = {},
  signal = null,
  workerPath = path.join(__dirname, 'modelExecutionWorker.js'),
  terminationGraceMs = 250
} = {}) {
  const executionId = String(requestedExecutionId || '').trim() || randomUUID();
  const graceMs = Math.max(10, Number(terminationGraceMs || 250));
  const onToken = typeof options.onToken === 'function' ? options.onToken : null;
  const workerOptions = { ...options };
  delete workerOptions.onToken;
  if (onToken) workerOptions.streamTokens = true;
  const child = fork(workerPath, [], {
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    env: { ...process.env, YANCE_MODEL_EXECUTION_ID: executionId }
  });

  let resultMessage = null;
  let errorMessage = null;
  let terminationReason = '';
  let exited = false;
  let softKillTimer = null;
  let hardKillTimer = null;
  let resolveStarted;
  let rejectStarted;
  let resolveExit;
  let resolveResult;
  let rejectResult;

  const started = new Promise((resolve, reject) => {
    resolveStarted = resolve;
    rejectStarted = reject;
  });
  const exit = new Promise(resolve => {
    resolveExit = resolve;
  });
  const result = new Promise((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });

  const clearTerminationTimers = () => {
    if (softKillTimer) clearTimeout(softKillTimer);
    if (hardKillTimer) clearTimeout(hardKillTimer);
    softKillTimer = null;
    hardKillTimer = null;
  };

  child.once('spawn', () => {
    resolveStarted({ executionId, pid: child.pid });
    child.send({
      type: 'execute',
      executionId,
      model,
      messages,
      options: workerOptions
    });
  });

  child.on('message', message => {
    if (!message || String(message.executionId || executionId) !== executionId) return;
    if (message.type === 'token' && onToken) onToken(message.token);
    if (message.type === 'result') resultMessage = message.result;
    if (message.type === 'error') errorMessage = message.error || {};
  });

  child.once('error', error => {
    rejectStarted(error);
    if (!exited) {
      errorMessage = {
        code: error.code || 'MODEL_EXECUTION_SPAWN_FAILED',
        message: error.message,
        stack: error.stack
      };
    }
  });

  child.once('exit', (code, childSignal) => {
    exited = true;
    clearTerminationTimers();
    signal?.removeEventListener?.('abort', abortListener);
    const receipt = {
      terminated: true,
      executionId,
      exitCode: Number.isInteger(code) ? code : null,
      signal: String(childSignal || ''),
      pid: child.pid || 0
    };
    resolveExit(receipt);
    if (resultMessage !== null && code === 0) {
      resolveResult(resultMessage);
      return;
    }
    if (errorMessage) {
      rejectResult(executionError(errorMessage));
      return;
    }
    rejectResult(terminatedError(executionId, terminationReason || childSignal || code));
  });

  function requestTermination(reason = 'hard-termination') {
    terminationReason = String(reason?.code || reason?.message || reason || 'hard-termination');
    if (exited) return exit;
    try {
      if (child.connected) child.send({ type: 'terminate', executionId, reason: terminationReason });
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
    requestTermination(signal?.reason || 'caller-abort');
  };
  if (signal?.aborted) abortListener();
  else signal?.addEventListener?.('abort', abortListener, { once: true });

  return {
    executionId,
    pid: child.pid || 0,
    started,
    result,
    exit,
    requestTermination
  };
}

module.exports = {
  startModelExecution
};
