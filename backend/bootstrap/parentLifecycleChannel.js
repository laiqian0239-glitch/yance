'use strict';

const crypto = require('node:crypto');

const BOOT_FAILURE_REASON_MESSAGES = Object.freeze({
  NODE_SQLITE_UNAVAILABLE: 'Required backend database runtime is unavailable.',
  BOOT_DESKTOP_STARTUP_TIMEOUT: 'Desktop startup handshake timed out.',
  BOOT_DESKTOP_STARTUP_FRAME_TOO_LARGE: 'Desktop startup handshake was rejected.',
  BOOT_DESKTOP_STARTUP_FRAME_INVALID: 'Desktop startup handshake was rejected.',
  BOOT_DESKTOP_STARTUP_PIPE_FAILED: 'Desktop startup handshake failed.',
  BOOT_DESKTOP_STARTUP_FRAME_INCOMPLETE: 'Desktop startup handshake was incomplete.',
  BOOT_MANIFEST_HASH_MISMATCH: 'Release identity verification failed.',
  BOOT_BUILD_ID_MISMATCH: 'Release identity verification failed.',
  BOOT_MANIFEST_HASH_FORMAT_INVALID: 'Release identity verification failed.',
  BOOT_MANIFEST_HASH_MISSING: 'Release identity verification failed.',
  BOOT_MANIFEST_LOCATION_INVALID: 'Release identity verification failed.',
  BOOT_MANIFEST_MISSING: 'Release identity verification failed.',
  BOOT_MANIFEST_SCHEMA_INVALID: 'Release identity verification failed.',
  BOOT_RUNTIME_MUTEX_HELD: 'Backend runtime ownership could not be acquired.',
  BOOT_RUNTIME_MUTEX_UNAVAILABLE: 'Backend runtime ownership could not be acquired.',
  BOOT_RUNTIME_OWNERSHIP_FAILED: 'Backend runtime ownership could not be acquired.',
  BOOT_SQLITE_BUSY_OR_LOCKED: 'Backend database ownership is temporarily busy.',
  BOOT_SQLITE_CANNOT_OPEN: 'Backend database file could not be opened.',
  BOOT_SQLITE_READ_ONLY: 'Backend database is not writable.',
  BOOT_SQLITE_IO_FAILED: 'Backend database I/O failed.',
  BOOT_SQLITE_CORRUPT: 'Backend database integrity is invalid.',
  BOOT_SQLITE_DISK_FULL: 'Backend database storage is full.',
  BOOT_SQLITE_CONSTRAINT_FAILED: 'Backend database ownership record was rejected.',
  BOOT_SQLITE_SCHEMA_MISSING: 'Backend database schema is incomplete.',
  BOOT_SQLITE_SCHEMA_MISMATCH: 'Backend database schema is incompatible.',
  BOOT_SQLITE_TRANSACTION_STATE_INVALID: 'Backend database transaction state is invalid.',
  BOOT_SQLITE_LOGIC_FAILED: 'Backend database initialization failed.',
  BOOT_PHASE_0_RESTORE_FAILED: 'Backend startup restore phase failed.',
  BOOT_SQLITE_BROKER_FAILED: 'Backend database initialization failed.',
  BOOT_RUNTIME_INITIALIZATION_FAILED: 'Backend runtime initialization failed.',
  BOOT_SERVER_IMPORT_FAILED: 'Backend server initialization failed.',
  WP4_CREDENTIAL_HYDRATION_REFERENCE_MISMATCH: 'Credential startup verification failed.',
  CREDENTIAL_GENERATION_MISMATCH: 'Credential startup verification failed.',
  BOOT_DESKTOP_STARTUP_FAILED: 'Backend startup failed.'
});

const SERVER_STARTUP_FAILURE_REASON_MESSAGES = Object.freeze({
  BACKEND_STARTUP_FAILED: 'Backend startup failed.',
  SERVER_LISTEN_FAILED: 'Backend network listener could not start.',
  BACKEND_HTTP_SERVER_CLOSED_AFTER_READY: 'Backend network listener stopped unexpectedly.',
  STORE_MANAGER_STARTUP_FAILED: 'Backend storage services could not start.',
  GLOBAL_FRAMEWORK_STARTUP_FAILED: 'Backend core services could not start.',
  WP2_PRODUCTION_PATH_PROBE_FAILED: 'Backend production runtime verification failed.',
  WP2_PRODUCTION_PATH_PROBE_CONFIGURATION_INVALID: 'Backend production runtime verification failed.',
  WP2_PRODUCTION_PATH_PROBE_INCOMPLETE: 'Backend production runtime verification failed.',
  WP2_PRODUCTION_PATH_SURFACE_MISSING: 'Backend production runtime verification failed.',
  BACKEND_HTTP_SERVER_NOT_LISTENING: 'Backend network listener is unavailable.'
});

const STARTUP_FAILURE_PHASES = Object.freeze({
  'early-boot': BOOT_FAILURE_REASON_MESSAGES,
  'server-startup': SERVER_STARTUP_FAILURE_REASON_MESSAGES
});

const RUNTIME_FAILURE_SUBPHASES = Object.freeze(new Set([
  'ownership_acquire',
  'ownership_store_open',
  'ownership_lease_acquire',
  'runtime_authority_migration',
  'lifecycle_initialization',
  'credential_hydration_read',
  'credential_snapshot_apply',
  'credential_authority_accept',
  'runtime_factory_create',
  'credential_authority_bind',
  'operating_mode_reconcile',
  'critical_workers_start',
  'local_ready_finalize',
  'runtime_boot',
  'server_startup',
  'unknown'
]));

const MESSAGE_FIELDS = Object.freeze({
  'backend:credential-hydrated': Object.freeze([
    'type', 'pid', 'startupNonce', 'vaultEpoch', 'generation', 'authorityEventId',
    'authorityHeadDigest', 'vaultReferenceCount', 'decryptedEntryCount',
    'frameEntryCount', 'entryCount', 'payloadBytes', 'restoredReferenceCount'
  ]),
  'backend:startup-failed': Object.freeze([
    'type', 'reasonCode', 'code', 'phase', 'message', 'stackHash', 'causeCodeHash', 'runtimeSubphase', 'pid'
  ])
});

function fail(reasonCode, message, details = {}) {
  const error = new Error(message);
  error.reasonCode = reasonCode;
  error.code = reasonCode;
  error.details = details;
  throw error;
}

function assertString(value, field) {
  if (typeof value !== 'string' || value.length === 0) {
    fail('PARENT_LIFECYCLE_MESSAGE_INVALID', `Parent lifecycle field ${field} must be a non-empty string`, { field });
  }
}

function assertInteger(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail('PARENT_LIFECYCLE_MESSAGE_INVALID', `Parent lifecycle field ${field} must be a non-negative safe integer`, { field });
  }
}

function normalizeBootFailureReason(error) {
  const candidate = typeof error?.reasonCode === 'string'
    ? error.reasonCode
    : (typeof error?.code === 'string' ? error.code : '');
  return Object.hasOwn(BOOT_FAILURE_REASON_MESSAGES, candidate)
    ? candidate
    : 'BOOT_DESKTOP_STARTUP_FAILED';
}

function normalizeServerStartupFailureReason(error, fallbackReasonCode) {
  const candidate = typeof error?.reasonCode === 'string'
    ? error.reasonCode
    : (typeof error?.code === 'string' ? error.code : '');
  if (Object.hasOwn(SERVER_STARTUP_FAILURE_REASON_MESSAGES, candidate)) return candidate;
  if (Object.hasOwn(SERVER_STARTUP_FAILURE_REASON_MESSAGES, fallbackReasonCode)) return fallbackReasonCode;
  return 'BACKEND_STARTUP_FAILED';
}

function bootFailureStackHash(error) {
  const stack = error && typeof error.stack === 'string' && error.stack.length > 0
    ? error.stack
    : 'BOOT_FAILURE_STACK_UNAVAILABLE';
  return crypto.createHash('sha256').update(stack, 'utf8').digest('hex');
}

function deepestFailureCauseCode(error, fallbackReasonCode = 'BOOT_DESKTOP_STARTUP_FAILED') {
  let current = error;
  let candidate = String(fallbackReasonCode || 'BOOT_DESKTOP_STARTUP_FAILED');
  const visited = new Set();
  for (let depth = 0; depth < 8 && current && typeof current === 'object'; depth += 1) {
    if (visited.has(current)) break;
    visited.add(current);
    const nextCandidate = typeof current.reasonCode === 'string' && current.reasonCode
      ? current.reasonCode
      : (typeof current.code === 'string' && current.code ? current.code : '');
    if (nextCandidate) candidate = nextCandidate;
    current = current.cause;
  }
  return candidate;
}

function failureCauseCodeHash(error, fallbackReasonCode = 'BOOT_DESKTOP_STARTUP_FAILED') {
  const candidate = deepestFailureCauseCode(error, fallbackReasonCode);
  return crypto.createHash('sha256').update(String(candidate), 'utf8').digest('hex');
}

function normalizeRuntimeSubphase(error, fallback = 'unknown') {
  const candidate = String(error?.failedPhase || error?.runtimeSubphase || fallback || 'unknown');
  return RUNTIME_FAILURE_SUBPHASES.has(candidate) ? candidate : 'unknown';
}

function buildBootFailureLifecycleMessage(error, options = {}) {
  const pid = options.pid === undefined ? process.pid : options.pid;
  assertInteger(pid, 'pid');
  const reasonCode = normalizeBootFailureReason(error);
  return Object.freeze({
    type: 'backend:startup-failed',
    reasonCode,
    code: reasonCode,
    phase: 'early-boot',
    message: BOOT_FAILURE_REASON_MESSAGES[reasonCode],
    stackHash: bootFailureStackHash(error),
    causeCodeHash: failureCauseCodeHash(error, reasonCode),
    runtimeSubphase: normalizeRuntimeSubphase(error, 'runtime_boot'),
    pid
  });
}

function buildServerStartupFailureLifecycleMessage(error, options = {}) {
  const pid = options.pid === undefined ? process.pid : options.pid;
  assertInteger(pid, 'pid');
  const reasonCode = normalizeServerStartupFailureReason(error, options.reasonCode);
  return Object.freeze({
    type: 'backend:startup-failed',
    reasonCode,
    code: reasonCode,
    phase: 'server-startup',
    message: SERVER_STARTUP_FAILURE_REASON_MESSAGES[reasonCode],
    stackHash: bootFailureStackHash(error),
    causeCodeHash: failureCauseCodeHash(error, reasonCode),
    runtimeSubphase: 'server_startup',
    pid
  });
}

function sanitizeParentLifecycleMessage(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    fail('PARENT_LIFECYCLE_MESSAGE_INVALID', 'Parent lifecycle payload must be an object');
  }
  const type = payload.type;
  const fields = MESSAGE_FIELDS[type];
  if (!fields) fail('PARENT_LIFECYCLE_MESSAGE_TYPE_DENIED', 'Parent lifecycle message type is not allowed', { type });

  const unexpected = Object.keys(payload).filter((field) => !fields.includes(field));
  if (unexpected.length) {
    fail('PARENT_LIFECYCLE_MESSAGE_FIELD_DENIED', 'Parent lifecycle payload contains unapproved fields', { type, unexpected: unexpected.sort() });
  }

  assertInteger(payload.pid, 'pid');
  if (type === 'backend:credential-hydrated') {
    for (const field of ['startupNonce', 'vaultEpoch', 'authorityEventId', 'authorityHeadDigest']) assertString(payload[field], field);
    for (const field of ['generation', 'vaultReferenceCount', 'decryptedEntryCount', 'frameEntryCount', 'entryCount', 'payloadBytes', 'restoredReferenceCount']) assertInteger(payload[field], field);
  } else {
    for (const field of ['reasonCode', 'code', 'phase', 'message', 'stackHash']) assertString(payload[field], field);
    const reasonMessages = STARTUP_FAILURE_PHASES[payload.phase];
    if (!reasonMessages) {
      fail('PARENT_LIFECYCLE_MESSAGE_INVALID', 'Parent lifecycle phase is not an approved startup-failure phase', { phase: payload.phase });
    }
    if (!Object.hasOwn(reasonMessages, payload.reasonCode)) {
      fail('PARENT_LIFECYCLE_MESSAGE_INVALID', 'Parent lifecycle reasonCode is not an approved boot-failure reason', { reasonCode: payload.reasonCode });
    }
    if (payload.code !== payload.reasonCode) fail('PARENT_LIFECYCLE_MESSAGE_INVALID', 'Parent lifecycle code must equal reasonCode');
    if (payload.message !== reasonMessages[payload.reasonCode]) {
      fail('PARENT_LIFECYCLE_MESSAGE_INVALID', 'Parent lifecycle message must use the fixed safe diagnostic text', { reasonCode: payload.reasonCode });
    }
    if (!/^[0-9a-f]{64}$/.test(payload.stackHash)) fail('PARENT_LIFECYCLE_MESSAGE_INVALID', 'Parent lifecycle stackHash must be lowercase SHA256');
    if (!/^[0-9a-f]{64}$/.test(payload.causeCodeHash)) fail('PARENT_LIFECYCLE_MESSAGE_INVALID', 'Parent lifecycle causeCodeHash must be lowercase SHA256');
    if (!RUNTIME_FAILURE_SUBPHASES.has(payload.runtimeSubphase)) fail('PARENT_LIFECYCLE_MESSAGE_INVALID', 'Parent lifecycle runtimeSubphase is not approved');
    if (payload.phase === 'server-startup' && payload.runtimeSubphase !== 'server_startup') fail('PARENT_LIFECYCLE_MESSAGE_INVALID', 'Server startup failure must use server_startup subphase');
  }

  return Object.freeze(Object.fromEntries(fields.map((field) => [field, payload[field]])));
}

function sendViaProcess(message) {
  if (typeof process.send !== 'function' || !process.connected) return false;
  process.send(message);
  return true;
}

function sendParentLifecycleMessage(payload, options = {}) {
  const message = sanitizeParentLifecycleMessage(payload);
  if (typeof options.sender === 'function') return options.sender(message) !== false;
  return sendViaProcess(message);
}

module.exports = {
  BOOT_FAILURE_REASON_MESSAGES,
  SERVER_STARTUP_FAILURE_REASON_MESSAGES,
  MESSAGE_FIELDS,
  RUNTIME_FAILURE_SUBPHASES,
  buildBootFailureLifecycleMessage,
  buildServerStartupFailureLifecycleMessage,
  sanitizeParentLifecycleMessage,
  sendParentLifecycleMessage
};
