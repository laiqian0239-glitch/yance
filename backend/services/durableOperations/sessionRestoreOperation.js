'use strict';

const { canonicalHash } = require('../canonicalSerialization');
const {
  OPERATION_KINDS,
  assertReferenceOnlyEnvelope
} = require('../durableOperationRegistry');

const OPERATION_KIND = OPERATION_KINDS.SESSION_RESTORE;
const RECONCILIATION_OUTCOMES = new Set([
  'REMOTE_SUCCESS_PROVEN',
  'REMOTE_ABSENCE_PROVEN',
  'REMOTE_RESULT_UNKNOWN'
]);
const INLINE_FIELDS = new Set([
  'sessiontoken',
  'password',
  'cookie',
  'credential',
  'rawsession',
  'sessionmaterial',
  'accesstoken',
  'refreshtoken',
  'oauthtoken',
  'authorization'
]);

function sessionError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, ...details });
}

function requiredString(value, field, maximum = 2048) {
  const result = String(value == null ? '' : value).trim();
  if (!result) {
    throw sessionError(
      field === 'attemptId' ? 'WP_B_SESSION_ATTEMPT_REQUIRED' : 'WP_B_SESSION_FIELD_REQUIRED',
      `${field} is required`,
      { field }
    );
  }
  if (result.length > maximum || /[\u0000-\u001f\u007f]/u.test(result)) {
    throw sessionError('WP_B_SESSION_FIELD_INVALID', `${field} is invalid`, { field, maximum });
  }
  return result;
}

function optionalString(value, field, maximum = 2048) {
  const result = String(value == null ? '' : value).trim();
  if (result.length > maximum || /[\u0000-\u001f\u007f]/u.test(result)) {
    throw sessionError('WP_B_SESSION_FIELD_INVALID', `${field} is invalid`, { field, maximum });
  }
  return result;
}

function safeInteger(value, field, minimum = 0) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < minimum) {
    throw sessionError('WP_B_SESSION_INTEGER_INVALID', `${field} must be a safe integer >= ${minimum}`, { field });
  }
  return result;
}

function requiredSha256(value, field) {
  const result = requiredString(value, field, 64);
  if (!/^[a-f0-9]{64}$/u.test(result)) {
    throw sessionError('WP_B_SESSION_HASH_INVALID', `${field} must be one lowercase SHA-256 digest`, { field });
  }
  return result;
}

function normalizedTimestamp(value, field) {
  const result = requiredString(value, field, 64);
  const milliseconds = Date.parse(result);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== result) {
    throw sessionError('WP_B_SESSION_TIMESTAMP_INVALID', `${field} must be normalized UTC ISO-8601`, { field });
  }
  return result;
}

function rejectInlineSessionMaterial(value, fieldPath = '', visited = new WeakSet()) {
  if (value == null || typeof value !== 'object' || visited.has(value)) return;
  visited.add(value);
  for (const [field, child] of Object.entries(value)) {
    const nextPath = fieldPath ? `${fieldPath}.${field}` : field;
    if (INLINE_FIELDS.has(field.toLowerCase())) {
      throw sessionError(
        'WP_B_SESSION_REFERENCE_ONLY_REQUIRED',
        'Session restoration envelopes may contain references only',
        { field, fieldPath: nextPath }
      );
    }
    rejectInlineSessionMaterial(child, nextPath, visited);
  }
}

function validateSessionEnvelope(envelope) {
  assertReferenceOnlyEnvelope(envelope);
  rejectInlineSessionMaterial(envelope);
  const request = envelope.request;
  if (!request || typeof request !== 'object' || Array.isArray(request) || !Object.isFrozen(request)) {
    throw sessionError('WP_B_SESSION_REQUEST_REQUIRED', 'Session restoration requires one frozen request');
  }
  return Object.freeze({
    executionId: requiredString(envelope.executionId, 'executionId'),
    intentId: requiredString(envelope.intentId, 'intentId'),
    attemptId: requiredString(envelope.attemptId, 'attemptId'),
    claimId: requiredString(envelope.claimId, 'claimId'),
    ownerId: requiredString(envelope.ownerId, 'ownerId'),
    generation: safeInteger(envelope.generation, 'generation', 1),
    hostGeneration: safeInteger(envelope.hostGeneration, 'hostGeneration', 1),
    fencingToken: safeInteger(envelope.fencingToken, 'fencingToken', 1),
    idempotencyKey: requiredString(envelope.idempotencyKey, 'idempotencyKey'),
    platform: requiredString(request.platform, 'request.platform', 64).toLowerCase(),
    accountReference: requiredString(request.accountReference, 'request.accountReference'),
    requestedSessionGeneration: safeInteger(
      request.requestedSessionGeneration,
      'request.requestedSessionGeneration',
      1
    ),
    sessionReference: requiredString(request.sessionReference, 'request.sessionReference'),
    credentialReference: requiredString(request.credentialReference, 'request.credentialReference'),
    commandContentSha256: requiredSha256(request.commandContentSha256, 'request.commandContentSha256')
  });
}

function validateDependencies(options = {}) {
  if (typeof options.resolveSessionCapability !== 'function') {
    throw new TypeError('Session restore operation requires a session capability resolver');
  }
  const sessionClient = options.sessionClient;
  if (!sessionClient || typeof sessionClient !== 'object' || !Object.isFrozen(sessionClient)
      || typeof sessionClient.restore !== 'function'
      || typeof sessionClient.probe !== 'function') {
    throw new TypeError('Session restore operation requires one frozen physical session client');
  }
  return Object.freeze({
    resolveSessionCapability: options.resolveSessionCapability,
    sessionClient
  });
}

function assertEphemeralCapability(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.isFrozen(value)) {
    throw sessionError(
      'WP_B_SESSION_CAPABILITY_INVALID',
      'Session resolver must return one frozen ephemeral capability'
    );
  }
  return value;
}

function custodyContext(attempt, boundary) {
  return Object.freeze({
    executionId: attempt.executionId,
    intentId: attempt.intentId,
    attemptId: attempt.attemptId,
    operationKind: OPERATION_KIND,
    accountReference: attempt.accountReference,
    requestedSessionGeneration: attempt.requestedSessionGeneration,
    boundary
  });
}

function physicalInput(attempt, sessionCapability) {
  return Object.freeze({
    executionId: attempt.executionId,
    intentId: attempt.intentId,
    attemptId: attempt.attemptId,
    claimId: attempt.claimId,
    ownerId: attempt.ownerId,
    generation: attempt.generation,
    hostGeneration: attempt.hostGeneration,
    fencingToken: attempt.fencingToken,
    idempotencyKey: attempt.idempotencyKey,
    platform: attempt.platform,
    accountReference: attempt.accountReference,
    requestedSessionGeneration: attempt.requestedSessionGeneration,
    sessionReference: attempt.sessionReference,
    commandContentSha256: attempt.commandContentSha256,
    sessionCapability
  });
}

function restoreObservation(value = {}) {
  return Object.freeze({
    state: optionalString(value.state, 'state', 64),
    providerSessionGeneration: optionalString(
      value.providerSessionGeneration,
      'providerSessionGeneration'
    ),
    evidenceReference: optionalString(value.evidenceReference, 'evidenceReference'),
    providerRequestId: optionalString(value.providerRequestId, 'providerRequestId'),
    failureCode: optionalString(value.failureCode, 'failureCode', 128),
    uncertain: value.uncertain === true
  });
}

function probeObservation(value = {}) {
  const outcome = requiredString(value.outcome, 'outcome', 64);
  if (!RECONCILIATION_OUTCOMES.has(outcome)) {
    throw sessionError(
      'WP_B_SESSION_RECONCILIATION_OUTCOME_INVALID',
      'Session probe returned an unsupported outcome',
      { outcome }
    );
  }
  return Object.freeze({
    outcome,
    providerSessionGeneration: optionalString(
      value.providerSessionGeneration,
      'providerSessionGeneration'
    ),
    evidenceReference: optionalString(value.evidenceReference, 'evidenceReference'),
    failureCode: optionalString(value.failureCode, 'failureCode', 128)
  });
}

function stableSessionRestoreIdempotencyKey(command) {
  const snapshot = assertReferenceOnlyEnvelope(command);
  return [
    'session-restore',
    requiredString(snapshot.platform, 'command.platform', 64).toLowerCase(),
    requiredString(snapshot.accountReference, 'command.accountReference'),
    safeInteger(snapshot.requestedSessionGeneration, 'command.requestedSessionGeneration', 1),
    requiredSha256(snapshot.commandContentSha256, 'command.commandContentSha256')
  ].join(':');
}

function prepareSessionRestore(options = {}) {
  const durableExecutionAuthority = options.durableExecutionAuthority;
  const outboxAuthority = options.outboxAuthority;
  const issueTimestamp = options.issueTimestamp;
  if (!durableExecutionAuthority || typeof durableExecutionAuthority.createExecution !== 'function') {
    throw new TypeError('Session restore preparation requires DurableExecutionAuthority.createExecution');
  }
  if (!outboxAuthority || typeof outboxAuthority.createIntent !== 'function') {
    throw new TypeError('Session restore preparation requires ExternalActionOutboxAuthority.createIntent');
  }
  if (typeof issueTimestamp !== 'function') {
    throw new TypeError('Session restore preparation requires an authority timestamp issuer');
  }
  const command = assertReferenceOnlyEnvelope(options.command);
  const idempotencyKey = optionalString(options.idempotencyKey, 'idempotencyKey')
    || stableSessionRestoreIdempotencyKey(command);
  const executionTimestamp = normalizedTimestamp(
    issueTimestamp('session-restore-execution'),
    'session-restore-execution'
  );
  const execution = durableExecutionAuthority.createExecution({
    operationKind: OPERATION_KIND,
    idempotencyKey,
    traceId: optionalString(options.traceId, 'traceId'),
    command,
    deadlineAt: optionalString(options.deadlineAt, 'deadlineAt'),
    maxAttempts: Math.max(1, Number(options.maxAttempts || 3)),
    authorityTimestamp: executionTimestamp
  });
  const executionId = requiredString(execution?.executionId, 'execution.executionId');
  const intentTimestamp = normalizedTimestamp(
    issueTimestamp('session-restore-intent'),
    'session-restore-intent'
  );
  const intent = outboxAuthority.createIntent({
    executionId,
    actionKind: OPERATION_KIND,
    idempotencyKey,
    payload: command,
    authorityTimestamp: intentTimestamp
  });
  return Object.freeze({
    executionId,
    intentId: requiredString(intent?.intentId, 'intent.intentId'),
    operationKind: OPERATION_KIND,
    idempotencyKey,
    commandContentSha256: canonicalHash(command)
  });
}

function createSessionRestoreOperation(options = {}) {
  const dependencies = validateDependencies(options);
  return Object.freeze({
    operationKind: OPERATION_KIND,

    async perform(envelope) {
      const attempt = validateSessionEnvelope(envelope);
      const sessionCapability = assertEphemeralCapability(
        await dependencies.resolveSessionCapability(
          attempt.credentialReference,
          custodyContext(attempt, 'EPHEMERAL_SESSION_RESTORE_BOUNDARY')
        )
      );
      return restoreObservation(
        await dependencies.sessionClient.restore(physicalInput(attempt, sessionCapability))
      );
    },

    async reconcile(envelope) {
      const attempt = validateSessionEnvelope(envelope);
      const sessionCapability = assertEphemeralCapability(
        await dependencies.resolveSessionCapability(
          attempt.credentialReference,
          custodyContext(attempt, 'EPHEMERAL_SESSION_PROBE_BOUNDARY')
        )
      );
      return probeObservation(
        await dependencies.sessionClient.probe(physicalInput(attempt, sessionCapability))
      );
    }
  });
}

module.exports = Object.freeze({
  OPERATION_KIND,
  createSessionRestoreOperation,
  prepareSessionRestore,
  probeObservation,
  restoreObservation,
  sessionError,
  stableSessionRestoreIdempotencyKey,
  validateSessionEnvelope
});
