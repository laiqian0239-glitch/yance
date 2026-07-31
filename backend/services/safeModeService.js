'use strict';

const crypto = require('node:crypto');

let authorityProvider = null;
let lastBootAttempt = null;
let lastHealthyAt = '';
let consecutiveBootFailures = 0;

function now() { return new Date().toISOString(); }
function hash(value) { return crypto.createHash('sha256').update(String(value || '')).digest('hex'); }

function bindAuthority(provider) {
  if (typeof provider !== 'function') throw new TypeError('safe mode authority provider must be a function');
  authorityProvider = provider;
}

function authoritySnapshot() {
  const snapshot = authorityProvider?.() || null;
  const operatingMode = String(snapshot?.operatingMode || 'normal');
  return {
    schemaVersion: 2,
    authority: 'runtime_state.operating_mode',
    active: operatingMode === 'safeMode',
    operatingMode,
    reason: String(snapshot?.reason || ''),
    reasons: [],
    enteredAt: '',
    updatedAt: String(snapshot?.updatedAtUtc || ''),
    updatedBy: 'runtime-authority',
    trigger: '',
    consecutiveBootFailures,
    lastBootAttempt,
    lastHealthyAt,
    lastClearedAt: '',
    lastClearActor: '',
    recoveryGeneration: 0
  };
}

function read() { return authoritySnapshot(); }
function isActive() { return authoritySnapshot().active; }
function snapshot() { return { ...authoritySnapshot(), stateFile: '', compatibilityWritesAllowed: false, confirmationHashExample: hash('EXIT_SAFE_MODE').slice(0, 12) }; }

function beginBoot(options = {}) {
  const attempt = {
    id: `boot-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
    startedAt: now(), completed: false, pid: process.pid,
    version: String(options.version || '').slice(0, 120), build: String(options.build || '').slice(0, 120)
  };
  const previousIncomplete = Boolean(lastBootAttempt && lastBootAttempt.completed !== true);
  if (previousIncomplete) consecutiveBootFailures += 1;
  lastBootAttempt = attempt;
  return { state: read(), attempt, previousIncomplete, autoTriggered: false, requested: false };
}

function markBootReady(attemptId, metadata = {}) {
  if (!lastBootAttempt || (attemptId && lastBootAttempt.id !== attemptId)) return read();
  consecutiveBootFailures = 0;
  lastHealthyAt = now();
  lastBootAttempt = { ...lastBootAttempt, completed: true, completedAt: lastHealthyAt, outcome: 'ready', metadata };
  return read();
}

function markBootFailed(attemptId, error = {}) {
  if (!lastBootAttempt) lastBootAttempt = { id: attemptId || `boot-${Date.now()}`, startedAt: now(), pid: process.pid };
  consecutiveBootFailures += 1;
  lastBootAttempt = { ...lastBootAttempt, completed: false, failedAt: now(), outcome: 'failed', error: { code: String(error.code || 'BOOT_FAILED'), message: String(error.message || error) } };
  return read();
}

function forbidden() {
  const error = new Error('safeModeService is a read-only compatibility projection; use OperatingModeTransitionGateway');
  error.code = 'SAFE_MODE_COMPATIBILITY_WRITE_FORBIDDEN';
  error.status = 409;
  throw error;
}

module.exports = {
  STATE_FILE: '',
  DEFAULT_FAILURE_THRESHOLD: 0,
  bindAuthority,
  read,
  snapshot,
  isActive,
  beginBoot,
  markBootReady,
  markBootFailed,
  enter: forbidden,
  clear: forbidden
};
