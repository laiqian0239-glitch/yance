'use strict';

const providerDomainAuthority = require('./modelProviderFailureDomainAuthority');

const AUTHORITY = 'ModelServiceTaskRoutingAuthority';
const SCHEMA_VERSION = 1;
const MAX_RETRY_AFTER_MS = 15 * 60 * 1000;

function clean(value) { return String(value == null ? '' : value).trim(); }
function upper(value) { return clean(value).toUpperCase(); }
function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function headerValue(headers, name) {
  if (!headers) return '';
  if (typeof headers.get === 'function') return clean(headers.get(name));
  if (typeof headers !== 'object') return '';
  const target = name.toLowerCase();
  const key = Object.keys(headers).find(item => String(item).toLowerCase() === target);
  return key ? clean(headers[key]) : '';
}

function retryAfterMs(error = {}, options = {}) {
  const nowMs = finite(options.nowMs, Date.now());
  const direct = finite(error.retryAfterMs ?? error.retry_after_ms, 0);
  if (direct > 0) return Math.min(MAX_RETRY_AFTER_MS, Math.max(1, Math.round(direct)));
  const raw = clean(
    error.retryAfter
    || error.retry_after
    || headerValue(error.headers, 'retry-after')
    || headerValue(error.response?.headers, 'retry-after')
    || headerValue(error.error?.headers, 'retry-after')
  );
  if (!raw) return 0;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(MAX_RETRY_AFTER_MS, Math.max(1, Math.round(seconds * 1000)));
  }
  const timestamp = Date.parse(raw);
  if (!Number.isFinite(timestamp)) return 0;
  return Math.min(MAX_RETRY_AFTER_MS, Math.max(1, timestamp - nowMs));
}

function classifyFailure(error = {}) {
  const code = upper(error.code || error.reasonCode);
  const status = finite(error.status || error.httpStatus, 0);

  if (['MODEL_CANCELLED', 'JOB_CANCELLED', 'MODEL_REQUEST_DISCONNECTED', 'AI_STALE_EXECUTION_RESULT'].includes(code)) {
    return { reasonCode: 'CANCELLED_OR_STALE', fallbackAllowed: false, retrySameModel: false, countsForCircuit: false, outcomeUnknown: false };
  }
  if (status === 401 || status === 403 || /AUTH|CREDENTIAL|PERMISSION|FORBIDDEN|UNAUTHORIZED/.test(code)) {
    return { reasonCode: 'PROVIDER_AUTHORIZATION_FAILED', fallbackAllowed: false, retrySameModel: false, countsForCircuit: false, outcomeUnknown: false };
  }
  if (status === 404 || /MODEL_NOT_FOUND|MODEL_REMOVED/.test(code)) {
    return { reasonCode: 'MODEL_UNAVAILABLE', fallbackAllowed: true, retrySameModel: false, countsForCircuit: false, outcomeUnknown: false };
  }
  if ((status >= 400 && status < 500 && ![408, 409, 429].includes(status)) || /INVALID_REQUEST|BAD_REQUEST|UNSUPPORTED|MISCONFIGURED|SCHEMA_REQUEST/.test(code)) {
    return { reasonCode: 'REQUEST_NOT_RETRYABLE', fallbackAllowed: false, retrySameModel: false, countsForCircuit: false, outcomeUnknown: false };
  }
  if (status === 429 || /RATE|QUOTA|THROTTLE/.test(code)) {
    return { reasonCode: 'RATE_LIMITED', fallbackAllowed: true, retrySameModel: false, countsForCircuit: true, outcomeUnknown: false };
  }
  if (/EMPTY_REPLY|MODEL_EMPTY_RESPONSE|WRONG_LANGUAGE|CHINESE_LEAK|PERSONA|HALLUCINATION|DUPLICATE|JSON|PARSE|STRUCTURED_OUTPUT/.test(code)) {
    return { reasonCode: 'QUALITY_FAILURE', fallbackAllowed: true, retrySameModel: false, countsForCircuit: false, outcomeUnknown: false };
  }
  if (status === 408 || /TIMEOUT|DEADLINE/.test(code)) {
    return { reasonCode: 'TIMEOUT', fallbackAllowed: true, retrySameModel: true, countsForCircuit: true, outcomeUnknown: true };
  }
  if (status >= 500 || /NETWORK|ECONN|OFFLINE|HTTP_5|PROVIDER_UNAVAILABLE/.test(code)) {
    return { reasonCode: 'PROVIDER_TRANSIENT_FAILURE', fallbackAllowed: true, retrySameModel: false, countsForCircuit: true, outcomeUnknown: true };
  }
  return { reasonCode: 'MODEL_INVOCATION_FAILED', fallbackAllowed: false, retrySameModel: false, countsForCircuit: false, outcomeUnknown: false };
}

function createBudget(options = {}) {
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const totalBudgetMs = Math.max(1, Math.round(finite(options.totalBudgetMs, 1)));
  const startedAtMs = finite(options.startedAtMs, now());
  const deadlineAtMs = startedAtMs + totalBudgetMs;
  return Object.freeze({
    authority: AUTHORITY,
    schemaVersion: SCHEMA_VERSION,
    totalBudgetMs,
    startedAtMs,
    deadlineAtMs,
    elapsedMs: () => Math.max(0, Math.round(now() - startedAtMs)),
    remainingMs: () => Math.max(0, Math.round(deadlineAtMs - now())),
    attemptTimeoutMs: requested => Math.max(0, Math.min(Math.max(1, Math.round(finite(requested, totalBudgetMs))), Math.max(0, Math.round(deadlineAtMs - now()))))
  });
}

function assertUsableResult(result = {}) {
  const text = clean(result.text);
  if (text) return result;
  throw Object.assign(new Error('Model returned an empty response'), {
    code: 'MODEL_EMPTY_RESPONSE',
    status: 502,
    providerRequestId: clean(result.providerRequestId || result.requestId)
  });
}

function fallbackIndependent(primary = {}, fallback = {}) {
  return providerDomainAuthority.independent(primary, fallback);
}

function attemptReceipt(input = {}) {
  return {
    attemptId: clean(input.attemptId),
    modelId: clean(input.modelId),
    model: clean(input.model),
    provider: clean(input.provider),
    failureDomain: clean(input.failureDomain),
    role: clean(input.role),
    status: clean(input.status),
    code: clean(input.code),
    reasonCode: clean(input.reasonCode),
    fallbackAllowed: input.fallbackAllowed === true,
    retrySameModel: input.retrySameModel === true,
    retryAfterMs: Math.max(0, Math.round(finite(input.retryAfterMs, 0))),
    nextRetryAt: clean(input.nextRetryAt),
    providerRequestId: clean(input.providerRequestId),
    httpStatus: Math.max(0, Math.round(finite(input.httpStatus, 0))),
    timeoutMs: Math.max(0, Math.round(finite(input.timeoutMs, 0))),
    remainingBudgetMs: Math.max(0, Math.round(finite(input.remainingBudgetMs, 0))),
    latencyMs: Math.max(0, Math.round(finite(input.latencyMs, 0))),
    outcomeUnknown: input.outcomeUnknown === true,
    emergencyMode: input.emergencyMode === true,
    qualityTier: clean(input.qualityTier),
    message: clean(input.message).slice(0, 500)
  };
}

module.exports = {
  AUTHORITY,
  SCHEMA_VERSION,
  MAX_RETRY_AFTER_MS,
  retryAfterMs,
  classifyFailure,
  createBudget,
  assertUsableResult,
  fallbackIndependent,
  attemptReceipt
};
