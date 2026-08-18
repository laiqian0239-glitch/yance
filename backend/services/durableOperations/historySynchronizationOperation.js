'use strict';

const {
  OPERATION_KINDS,
  assertReferenceOnlyEnvelope
} = require('../durableOperationRegistry');

const OPERATION_KIND = OPERATION_KINDS.HISTORY_SYNCHRONIZATION;
const STREAM_KINDS = new Set(['contacts', 'conversations', 'messages']);
const RECONCILIATION_OUTCOMES = new Set([
  'REMOTE_SUCCESS_PROVEN',
  'REMOTE_ABSENCE_PROVEN',
  'REMOTE_RESULT_UNKNOWN'
]);
const INLINE_FIELDS = new Set([
  'messagebody',
  'messages',
  'authorizationheader',
  'authorization',
  'sessiontoken',
  'token',
  'cookie',
  'credential',
  'payload',
  'rawmessage'
]);

function historyError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, ...details });
}

function requiredString(value, field, maximum = 2048) {
  const result = String(value == null ? '' : value).trim();
  if (!result) {
    throw historyError(
      field === 'attemptId'
        ? 'WP_B_HISTORY_ATTEMPT_REQUIRED'
        : 'WP_B_HISTORY_FIELD_REQUIRED',
      `${field} is required`,
      { field }
    );
  }
  if (result.length > maximum || /[\u0000-\u001f\u007f]/u.test(result)) {
    throw historyError('WP_B_HISTORY_FIELD_INVALID', `${field} is invalid`, { field, maximum });
  }
  return result;
}

function optionalString(value, field, maximum = 2048) {
  const result = String(value == null ? '' : value).trim();
  if (result.length > maximum || /[\u0000-\u001f\u007f]/u.test(result)) {
    throw historyError('WP_B_HISTORY_FIELD_INVALID', `${field} is invalid`, { field, maximum });
  }
  return result;
}

function safeInteger(value, field, minimum = 0) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < minimum) {
    throw historyError('WP_B_HISTORY_INTEGER_INVALID', `${field} must be a safe integer >= ${minimum}`, { field });
  }
  return result;
}

function requiredSha256(value, field) {
  const result = requiredString(value, field, 64);
  if (!/^[a-f0-9]{64}$/u.test(result)) {
    throw historyError('WP_B_HISTORY_HASH_INVALID', `${field} must be one lowercase SHA-256 digest`, { field });
  }
  return result;
}

function rejectInlineHistory(value, fieldPath = '', visited = new WeakSet()) {
  if (value == null || typeof value !== 'object' || visited.has(value)) return;
  visited.add(value);
  for (const [field, child] of Object.entries(value)) {
    const nextPath = fieldPath ? `${fieldPath}.${field}` : field;
    if (INLINE_FIELDS.has(field.toLowerCase())) {
      throw historyError(
        'WP_B_HISTORY_REFERENCE_ONLY_REQUIRED',
        'History synchronization envelopes may contain references only',
        { field, fieldPath: nextPath }
      );
    }
    rejectInlineHistory(child, nextPath, visited);
  }
}

function validateHistoryEnvelope(envelope) {
  assertReferenceOnlyEnvelope(envelope);
  rejectInlineHistory(envelope);
  const request = envelope.request;
  if (!request || typeof request !== 'object' || Array.isArray(request) || !Object.isFrozen(request)) {
    throw historyError('WP_B_HISTORY_REQUEST_REQUIRED', 'History synchronization requires one frozen request');
  }
  const streamKind = requiredString(request.streamKind, 'request.streamKind', 64).toLowerCase();
  if (!STREAM_KINDS.has(streamKind)) {
    throw historyError('WP_B_HISTORY_STREAM_KIND_INVALID', 'History stream kind is not registered', { streamKind });
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
    streamKind,
    scopeReference: requiredString(request.scopeReference, 'request.scopeReference'),
    checkpointReference: requiredString(request.checkpointReference, 'request.checkpointReference'),
    checkpointVersion: safeInteger(request.checkpointVersion, 'request.checkpointVersion'),
    cursorReference: optionalString(request.cursorReference, 'request.cursorReference'),
    requestContentSha256: requiredSha256(request.requestContentSha256, 'request.requestContentSha256'),
    credentialReference: requiredString(request.credentialReference, 'request.credentialReference'),
    pageSize: safeInteger(request.pageSize, 'request.pageSize', 1)
  });
}

function validateDependencies(options = {}) {
  if (typeof options.resolveCredentialReference !== 'function') {
    throw new TypeError('History synchronization operation requires a credential resolver');
  }
  const historyClient = options.historyClient;
  if (!historyClient || typeof historyClient !== 'object' || !Object.isFrozen(historyClient)
      || typeof historyClient.fetchPage !== 'function'
      || typeof historyClient.compareCursor !== 'function') {
    throw new TypeError('History synchronization operation requires one frozen physical history client');
  }
  return Object.freeze({
    resolveCredentialReference: options.resolveCredentialReference,
    historyClient
  });
}

function assertEphemeralCredential(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.isFrozen(value)) {
    throw historyError(
      'WP_B_HISTORY_CREDENTIAL_INVALID',
      'Credential resolver must return one frozen ephemeral capability'
    );
  }
  return value;
}

function credentialContext(attempt, boundary) {
  return Object.freeze({
    executionId: attempt.executionId,
    intentId: attempt.intentId,
    attemptId: attempt.attemptId,
    operationKind: OPERATION_KIND,
    streamKind: attempt.streamKind,
    boundary
  });
}

function physicalInput(attempt, credential) {
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
    streamKind: attempt.streamKind,
    scopeReference: attempt.scopeReference,
    checkpointReference: attempt.checkpointReference,
    checkpointVersion: attempt.checkpointVersion,
    cursorReference: attempt.cursorReference,
    requestContentSha256: attempt.requestContentSha256,
    pageSize: attempt.pageSize,
    credential
  });
}

function pageObservation(value = {}) {
  return Object.freeze({
    status: optionalString(value.status, 'status', 64),
    segmentReference: optionalString(value.segmentReference, 'segmentReference'),
    nextCursorReference: optionalString(value.nextCursorReference, 'nextCursorReference'),
    remoteHighWatermark: optionalString(value.remoteHighWatermark, 'remoteHighWatermark'),
    gapClosed: value.gapClosed === true,
    providerRequestId: optionalString(value.providerRequestId, 'providerRequestId'),
    evidenceReference: optionalString(value.evidenceReference, 'evidenceReference'),
    failureCode: optionalString(value.failureCode, 'failureCode', 128),
    uncertain: value.uncertain === true
  });
}

function cursorObservation(value = {}) {
  const outcome = requiredString(value.outcome, 'outcome', 64);
  if (!RECONCILIATION_OUTCOMES.has(outcome)) {
    throw historyError(
      'WP_B_HISTORY_RECONCILIATION_OUTCOME_INVALID',
      'History reconciliation returned an unsupported outcome',
      { outcome }
    );
  }
  return Object.freeze({
    outcome,
    remoteCursorReference: optionalString(value.remoteCursorReference, 'remoteCursorReference'),
    remoteHighWatermark: optionalString(value.remoteHighWatermark, 'remoteHighWatermark'),
    evidenceReference: optionalString(value.evidenceReference, 'evidenceReference'),
    failureCode: optionalString(value.failureCode, 'failureCode', 128)
  });
}

function createHistorySynchronizationOperation(options = {}) {
  const dependencies = validateDependencies(options);
  return Object.freeze({
    operationKind: OPERATION_KIND,

    async perform(envelope) {
      const attempt = validateHistoryEnvelope(envelope);
      const credential = assertEphemeralCredential(
        await dependencies.resolveCredentialReference(
          attempt.credentialReference,
          credentialContext(attempt, 'EPHEMERAL_HISTORY_PAGE_BOUNDARY')
        )
      );
      return pageObservation(await dependencies.historyClient.fetchPage(physicalInput(attempt, credential)));
    },

    async reconcile(envelope) {
      const attempt = validateHistoryEnvelope(envelope);
      const credential = assertEphemeralCredential(
        await dependencies.resolveCredentialReference(
          attempt.credentialReference,
          credentialContext(attempt, 'EPHEMERAL_HISTORY_RECONCILIATION_BOUNDARY')
        )
      );
      return cursorObservation(await dependencies.historyClient.compareCursor(physicalInput(attempt, credential)));
    }
  });
}

module.exports = Object.freeze({
  OPERATION_KIND,
  createHistorySynchronizationOperation,
  cursorObservation,
  historyError,
  pageObservation,
  validateHistoryEnvelope
});
