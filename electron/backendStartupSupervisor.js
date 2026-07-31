'use strict';

const http = require('node:http');

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_POLL_INTERVAL_MS = 400;
const DEFAULT_REQUEST_TIMEOUT_MS = 1_500;
const DEFAULT_TAIL_BYTES = 12 * 1024;

function positiveInteger(value, fallback, minimum = 1) {
  const number = Number(value);
  return Number.isFinite(number) && number >= minimum ? Math.floor(number) : fallback;
}

function appendTail(current, addition, maxBytes = DEFAULT_TAIL_BYTES) {
  const combined = `${String(current || '')}${String(addition || '')}`;
  if (Buffer.byteLength(combined, 'utf8') <= maxBytes) return combined;
  let start = Math.max(0, combined.length - maxBytes);
  while (start < combined.length && Buffer.byteLength(combined.slice(start), 'utf8') > maxBytes) start += 1;
  return combined.slice(start);
}

function serializableError(error) {
  if (!error) return null;
  return {
    name: error.name || 'Error',
    code: error.code || '',
    message: error.message || String(error)
  };
}

function requestBackendReadiness(options = {}) {
  const baseUrl = String(options.baseUrl || '').replace(/\/$/, '');
  const path = String(options.path || '/api/ready');
  const apiToken = String(options.apiToken || '');
  const timeoutMs = positiveInteger(options.timeoutMs, DEFAULT_REQUEST_TIMEOUT_MS, 50);
  const httpModule = options.httpModule || http;

  return new Promise(resolve => {
    let completed = false;
    const finish = result => {
      if (completed) return;
      completed = true;
      resolve(result);
    };

    let request;
    try {
      const target = new URL(path, `${baseUrl}/`);
      request = httpModule.request(target, {
        method: 'GET',
        headers: {
          accept: 'application/json',
          ...(apiToken ? { 'x-yance-session': apiToken } : {})
        }
      }, response => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', chunk => {
          body = appendTail(body, chunk, 64 * 1024);
        });
        response.on('error', error => finish({ ok: false, statusCode: Number(response.statusCode || 0), error: serializableError(error) }));
        response.on('end', () => {
          let payload = null;
          try { payload = body ? JSON.parse(body) : null; } catch (error) {
            return finish({
              ok: false,
              statusCode: Number(response.statusCode || 0),
              error: serializableError(Object.assign(new Error('Readiness endpoint returned invalid JSON'), { code: 'READY_INVALID_JSON' })),
              body
            });
          }
          finish({
            ok: Number(response.statusCode || 0) === 200 && payload?.ready === true,
            statusCode: Number(response.statusCode || 0),
            payload
          });
        });
      });
    } catch (error) {
      finish({ ok: false, statusCode: 0, error: serializableError(error) });
      return;
    }

    request.setTimeout(timeoutMs, () => {
      request.destroy(Object.assign(new Error(`Readiness request timed out after ${timeoutMs}ms`), { code: 'READY_PROBE_TIMEOUT' }));
    });
    request.on('error', error => finish({ ok: false, statusCode: 0, error: serializableError(error) }));
    request.end();
  });
}

function readyIdentityMatches(payload, expectedPid, startupNonce, expectedStartupAttemptId = '', expectedBackendSessionId = '') {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  if (expectedPid && Number(payload.pid || 0) !== Number(expectedPid)) return false;
  if (startupNonce && String(payload.startupNonce || '') !== String(startupNonce)) return false;
  const runtimeContract = payload.runtimeContract && typeof payload.runtimeContract === 'object' ? payload.runtimeContract : {};
  if (expectedStartupAttemptId && String(runtimeContract.startupAttemptId || payload.startupAttemptId || '') !== String(expectedStartupAttemptId)) return false;
  if (expectedBackendSessionId && String(runtimeContract.backendSessionId || payload.backendSessionId || '') !== String(expectedBackendSessionId)) return false;
  return true;
}

function parseReadyMarker(text) {
  const source = String(text || '');
  const index = source.lastIndexOf('YANCE_R32_SERVER_READY');
  if (index < 0) return null;
  const line = source.slice(index).split(/\r?\n/, 1)[0];
  const jsonStart = line.indexOf('{');
  if (jsonStart < 0) return { legacy: true };
  try {
    return { legacy: false, payload: JSON.parse(line.slice(jsonStart)) };
  } catch (_) {
    return null;
  }
}

function createStartupError(message, code, snapshot, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code || 'BACKEND_STARTUP_FAILED';
  error.details = snapshot;
  return error;
}

function createBackendStartupSupervisor(options = {}) {
  const baseUrl = String(options.baseUrl || '').replace(/\/$/, '');
  const apiToken = String(options.apiToken || '');
  const expectedPid = Number(options.expectedPid || 0);
  const startupNonce = String(options.startupNonce || '');
  const expectedStartupAttemptId = String(options.startupAttemptId || options.expectedStartupAttemptId || '');
  const expectedBackendSessionId = String(options.backendSessionId || options.expectedBackendSessionId || '');
  const timeoutMs = positiveInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, 250);
  const pollIntervalMs = positiveInteger(options.pollIntervalMs, DEFAULT_POLL_INTERVAL_MS, 25);
  const requestTimeoutMs = positiveInteger(options.requestTimeoutMs, DEFAULT_REQUEST_TIMEOUT_MS, 50);
  const requestReady = options.requestReady || requestBackendReadiness;
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const log = typeof options.log === 'function' ? options.log : () => {};

  let started = false;
  let settled = false;
  let timeoutTimer = null;
  let pollTimer = null;
  let resolvePromise;
  let rejectPromise;
  let stdoutTail = '';
  let stderrTail = '';
  let lastProbe = null;
  let source = '';
  const startedAt = now();

  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  function snapshot() {
    return {
      baseUrl,
      expectedPid,
      startupNonce,
      expectedStartupAttemptId,
      expectedBackendSessionId,
      timeoutMs,
      pollIntervalMs,
      requestTimeoutMs,
      startedAt,
      elapsedMs: Math.max(0, now() - startedAt),
      settled,
      source,
      lastProbe,
      stdoutTail,
      stderrTail
    };
  }

  function clearTimers() {
    if (timeoutTimer) clearTimeout(timeoutTimer);
    if (pollTimer) clearTimeout(pollTimer);
    timeoutTimer = null;
    pollTimer = null;
  }

  function settleReady(readySource, payload = {}) {
    if (settled) return false;
    if (!readyIdentityMatches(payload, expectedPid, startupNonce, expectedStartupAttemptId, expectedBackendSessionId)) {
      log('identity-mismatch', { readySource, payload, expectedPid, startupNonce, expectedStartupAttemptId, expectedBackendSessionId });
      return false;
    }
    settled = true;
    source = readySource;
    clearTimers();
    resolvePromise({
      ok: true,
      source: readySource,
      pid: Number(payload.pid || expectedPid || 0),
      startupNonce: String(payload.startupNonce || startupNonce || ''),
      payload,
      elapsedMs: Math.max(0, now() - startedAt)
    });
    return true;
  }

  function settleFailure(error, fallbackCode = 'BACKEND_STARTUP_FAILED') {
    if (settled) return false;
    settled = true;
    clearTimers();
    const state = snapshot();
    if (error instanceof Error) {
      error.code = error.code || fallbackCode;
      error.details = error.details || state;
      rejectPromise(error);
    } else {
      rejectPromise(createStartupError(String(error || '本地服务启动失败'), fallbackCode, state));
    }
    return true;
  }

  async function poll() {
    if (settled) return;
    let probe;
    try {
      probe = await requestReady({ baseUrl, apiToken, timeoutMs: requestTimeoutMs });
    } catch (error) {
      probe = { ok: false, statusCode: 0, error: serializableError(error) };
    }
    lastProbe = probe;
    if (settled) return;

    const payload = probe?.payload;
    if (probe?.ok && readyIdentityMatches(payload, expectedPid, startupNonce, expectedStartupAttemptId, expectedBackendSessionId)) {
      settleReady('http-ready', payload);
      return;
    }
    if (payload?.phase === 'failed' || payload?.failure) {
      const failure = payload.failure || {};
      settleFailure(createStartupError(
        `本地服务初始化失败：${failure.message || payload.message || failure.code || 'unknown error'}`,
        failure.code || payload.code || 'BACKEND_STARTUP_FAILED',
        snapshot()
      ));
      return;
    }
    pollTimer = setTimeout(poll, pollIntervalMs);
  }

  function start() {
    if (started) return promise;
    started = true;
    timeoutTimer = setTimeout(() => {
      settleFailure(createStartupError(
        `本地服务启动超时（${timeoutMs}ms）。请查看 ${'desktop.jsonl'} 与 server.jsonl。`,
        'BACKEND_STARTUP_TIMEOUT',
        snapshot()
      ));
    }, timeoutMs);
    poll();
    return promise;
  }

  function observeMessage(message) {
    if (settled || !message || typeof message !== 'object') return false;
    if (message.type === 'backend:ready') return settleReady('ipc-ready', message);
    if (message.type === 'backend:startup-failed') {
      return settleFailure(createStartupError(
        `本地服务初始化失败：${message.message || message.code || 'unknown error'}`,
        message.code || 'BACKEND_STARTUP_FAILED',
        snapshot()
      ));
    }
    return false;
  }

  function observeStdout(data) {
    stdoutTail = appendTail(stdoutTail, data);
    if (settled) return false;
    const marker = parseReadyMarker(stdoutTail);
    if (!marker) return false;
    if (marker.legacy) {
      log('legacy-ready-marker-rejected', { expectedPid, startupNonce, expectedStartupAttemptId, expectedBackendSessionId });
      return false;
    }
    return settleReady('stdout-ready', marker.payload || {});
  }

  function observeStderr(data) {
    stderrTail = appendTail(stderrTail, data);
  }

  function observeError(error) {
    if (settled) return false;
    return settleFailure(createStartupError(
      `本地服务子进程启动失败：${error?.message || String(error || 'unknown error')}`,
      error?.code || 'BACKEND_CHILD_PROCESS_ERROR',
      snapshot(),
      error instanceof Error ? error : undefined
    ));
  }

  function observeExit(code, signal) {
    if (settled) return false;
    const label = code === null ? `signal ${signal || 'unknown'}` : `exit code ${code}`;
    return settleFailure(createStartupError(
      `本地服务在就绪前退出（${label}）。`,
      'BACKEND_EXIT_BEFORE_READY',
      snapshot()
    ));
  }

  function cancel(reason = 'Backend startup cancelled') {
    return settleFailure(createStartupError(reason, 'BACKEND_STARTUP_CANCELLED', snapshot()));
  }

  return {
    start,
    wait: start,
    observeMessage,
    observeStdout,
    observeStderr,
    observeError,
    observeExit,
    cancel,
    snapshot,
    get settled() { return settled; }
  };
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  DEFAULT_POLL_INTERVAL_MS,
  DEFAULT_REQUEST_TIMEOUT_MS,
  appendTail,
  requestBackendReadiness,
  readyIdentityMatches,
  parseReadyMarker,
  createBackendStartupSupervisor
};
