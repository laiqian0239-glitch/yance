'use strict';

const settingsRepository = require('../repositories/settingsRepository');
const logger = require('./logger');

const NAMESPACE = 'whatsapp-version-discovery';
const KEY = 'authority';
const BASE_BACKOFF_MS = 5 * 60 * 1000;
const MAX_BACKOFF_MS = 6 * 60 * 60 * 1000;
let memory = null;

function cleanVersion(value) {
  return Array.isArray(value) && value.length === 3 && value.every(Number.isInteger) ? value.slice(0, 3) : null;
}

function readStorage(storage = settingsRepository) {
  try { return storage.get(NAMESPACE, KEY, null); }
  catch (error) {
    logger.warn('whatsapp', 'version-discovery-authority-read-failed', { code: error.code || 'VERSION_DISCOVERY_AUTHORITY_READ_FAILED', message: error.message });
    return null;
  }
}
function writeStorage(value, storage = settingsRepository) {
  try { storage.set(NAMESPACE, KEY, value); return true; }
  catch (error) {
    logger.warn('whatsapp', 'version-discovery-authority-write-failed', { code: error.code || 'VERSION_DISCOVERY_AUTHORITY_WRITE_FAILED', message: error.message });
    return false;
  }
}
function read(options = {}) {
  if (!memory || options.reload === true) {
    const stored = readStorage(options.storage);
    memory = {
      schemaVersion: 1,
      version: cleanVersion(stored?.version),
      isLatest: stored?.isLatest === true,
      consecutiveFailures: Math.max(0, Number(stored?.consecutiveFailures || 0)),
      nextAttemptAt: String(stored?.nextAttemptAt || ''),
      lastAttemptAt: String(stored?.lastAttemptAt || ''),
      lastSuccessAt: String(stored?.lastSuccessAt || ''),
      lastFailureAt: String(stored?.lastFailureAt || ''),
      lastFailureCode: String(stored?.lastFailureCode || ''),
      lastWarningAt: String(stored?.lastWarningAt || '')
    };
  }
  return { ...memory, version: cleanVersion(memory.version) };
}
function beforeAttempt(options = {}) {
  const now = Number(options.nowMs || Date.now());
  const state = read(options);
  const next = Date.parse(state.nextAttemptAt || '');
  const allowed = !Number.isFinite(next) || next <= now;
  return {
    attempt: allowed,
    cachedVersion: cleanVersion(state.version),
    isLatest: state.isLatest === true,
    nextAttemptAt: state.nextAttemptAt,
    consecutiveFailures: state.consecutiveFailures,
    reasonCode: allowed ? 'VERSION_DISCOVERY_ATTEMPT_ALLOWED' : 'VERSION_DISCOVERY_BACKOFF_ACTIVE'
  };
}
function recordSuccess(result = {}, options = {}) {
  const now = new Date(Number(options.nowMs || Date.now())).toISOString();
  memory = {
    schemaVersion: 1,
    version: cleanVersion(result.version),
    isLatest: result.isLatest === true,
    consecutiveFailures: 0,
    nextAttemptAt: '',
    lastAttemptAt: now,
    lastSuccessAt: now,
    lastFailureAt: '',
    lastFailureCode: '',
    lastWarningAt: ''
  };
  writeStorage(memory, options.storage);
  return read();
}
function recordFailure(reasonCode, options = {}) {
  const nowMs = Number(options.nowMs || Date.now());
  const current = read(options);
  const failures = current.consecutiveFailures + 1;
  const backoffMs = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * (2 ** Math.min(10, failures - 1)));
  memory = {
    ...current,
    consecutiveFailures: failures,
    nextAttemptAt: new Date(nowMs + backoffMs).toISOString(),
    lastAttemptAt: new Date(nowMs).toISOString(),
    lastFailureAt: new Date(nowMs).toISOString(),
    lastFailureCode: String(reasonCode || 'VERSION_DISCOVERY_FAILED')
  };
  writeStorage(memory, options.storage);
  return { ...read(), backoffMs };
}
function markWarning(options = {}) {
  const state = read(options);
  memory = { ...state, lastWarningAt: new Date(Number(options.nowMs || Date.now())).toISOString() };
  writeStorage(memory, options.storage);
  return read();
}
function shouldLogWarning(options = {}) {
  const now = Number(options.nowMs || Date.now());
  const state = read(options);
  const last = Date.parse(state.lastWarningAt || '');
  return !Number.isFinite(last) || now - last >= Math.max(BASE_BACKOFF_MS, Number(options.intervalMs || BASE_BACKOFF_MS));
}
function resetForTests() { memory = null; }

module.exports = {
  NAMESPACE,
  KEY,
  BASE_BACKOFF_MS,
  MAX_BACKOFF_MS,
  beforeAttempt,
  recordSuccess,
  recordFailure,
  markWarning,
  shouldLogWarning,
  read,
  resetForTests
};
