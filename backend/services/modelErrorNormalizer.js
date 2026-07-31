'use strict';

const MESSAGE_KEYS = ['message', 'detail', 'reason', 'error_description', 'title', 'description'];
const CODE_KEYS = ['code', 'reasonCode', 'errorCode', 'error_code', 'type'];

function primitiveText(value) {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    const text = String(value).trim();
    return text && text !== '[object Object]' ? text : '';
  }
  return '';
}

function extractText(value, fallback = '', seen = new Set(), depth = 0) {
  const direct = primitiveText(value);
  if (direct) return direct;
  if (!value || depth > 6 || typeof value !== 'object' || seen.has(value)) return primitiveText(fallback);
  seen.add(value);
  if (value instanceof Error) {
    return extractText(value.message, fallback, seen, depth + 1)
      || extractText(value.cause, fallback, seen, depth + 1);
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const text = extractText(item, '', seen, depth + 1);
      if (text) return text;
    }
    return primitiveText(fallback);
  }
  for (const key of MESSAGE_KEYS) {
    const text = extractText(value[key], '', seen, depth + 1);
    if (text) return text;
  }
  for (const key of ['error', 'errors', 'response', 'body', 'data', 'cause']) {
    const text = extractText(value[key], '', seen, depth + 1);
    if (text) return text;
  }
  return primitiveText(fallback);
}

function extractCode(value, fallback = 'MODEL_INVOCATION_FAILED', seen = new Set(), depth = 0) {
  const direct = primitiveText(value);
  if (!value || depth > 6 || typeof value !== 'object' || seen.has(value)) return direct || primitiveText(fallback);
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const code = extractCode(item, '', seen, depth + 1);
      if (code) return code;
    }
    return primitiveText(fallback);
  }
  for (const key of CODE_KEYS) {
    const code = primitiveText(value[key]);
    if (code) return code;
  }
  for (const key of ['error', 'errors', 'response', 'body', 'data', 'cause']) {
    const code = extractCode(value[key], '', seen, depth + 1);
    if (code) return code;
  }
  return primitiveText(fallback);
}

function normalizeModelError(value, options = {}) {
  const message = extractText(value, options.fallbackMessage || '模型调用失败').slice(0, 500);
  const code = extractCode(value, options.fallbackCode || 'MODEL_INVOCATION_FAILED').slice(0, 120);
  const status = Number(value?.status || value?.statusCode || value?.response?.status || value?.error?.status || 0) || 0;
  return { message, code, status };
}

function createAllModelsFailedError(attempts = [], options = {}) {
  const failures = attempts.filter(row => row.status !== 'circuit_open');
  const skipped = attempts.filter(row => row.status === 'circuit_open');
  const last = failures[failures.length - 1] || skipped[skipped.length - 1] || null;
  const count = attempts.length;
  const message = count
    ? `已尝试 ${count} 个模型，均未完成任务${last?.message ? `：${last.message}` : ''}`
    : '没有可执行的模型';
  const error = new Error(message);
  error.code = options.code || 'ALL_MODELS_FAILED';
  error.status = Number(last?.httpStatus || 0) || 0;
  error.attempts = attempts;
  if (options.cause) error.cause = options.cause;
  return error;
}

module.exports = { extractText, extractCode, normalizeModelError, createAllModelsFailedError };
