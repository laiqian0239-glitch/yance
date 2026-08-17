'use strict';

const {
  OPERATION_KINDS,
  assertReferenceOnlyEnvelope
} = require('../durableOperationRegistry');

const OPERATION_KIND = OPERATION_KINDS.MEDIA_TRANSFER;
const TRANSFER_KINDS = new Set(['FETCH', 'UPLOAD', 'TRANSCRIBE']);
const RECONCILIATION_OUTCOMES = new Set([
  'REMOTE_SUCCESS_PROVEN',
  'REMOTE_ABSENCE_PROVEN',
  'REMOTE_RESULT_UNKNOWN'
]);
const MEDIA_INLINE_FIELDS = new Set([
  'signedurl',
  'authorizationheader',
  'authorization',
  'sourceurl',
  'destinationurl',
  'caption',
  'transcript',
  'bytes',
  'buffer'
]);

function mediaTransferError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, ...details });
}

function requiredString(value, field, maximum = 2048) {
  const result = String(value == null ? '' : value).trim();
  if (!result) {
    throw mediaTransferError(
      field === 'attemptId'
        ? 'WP_B_MEDIA_TRANSFER_ATTEMPT_REQUIRED'
        : 'WP_B_MEDIA_TRANSFER_FIELD_REQUIRED',
      `${field} is required`,
      { field }
    );
  }
  if (result.length > maximum || /[\u0000-\u001f\u007f]/u.test(result)) {
    throw mediaTransferError(
      'WP_B_MEDIA_TRANSFER_FIELD_INVALID',
      `${field} is invalid`,
      { field, maximum }
    );
  }
  return result;
}

function optionalString(value, field, maximum = 2048) {
  const result = String(value == null ? '' : value).trim();
  if (result.length > maximum || /[\u0000-\u001f\u007f]/u.test(result)) {
    throw mediaTransferError(
      'WP_B_MEDIA_TRANSFER_FIELD_INVALID',
      `${field} is invalid`,
      { field, maximum }
    );
  }
  return result;
}

function safeInteger(value, field, minimum = 1) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < minimum) {
    throw mediaTransferError(
      'WP_B_MEDIA_TRANSFER_INTEGER_INVALID',
      `${field} must be a safe integer >= ${minimum}`,
      { field }
    );
  }
  return result;
}

function requiredSha256(value, field) {
  const result = requiredString(value, field, 64);
  if (!/^[a-f0-9]{64}$/u.test(result)) {
    throw mediaTransferError(
      'WP_B_MEDIA_TRANSFER_HASH_INVALID',
      `${field} must be one lowercase SHA-256 digest`,
      { field }
    );
  }
  return result;
}

function rejectInlineMedia(value, fieldPath = '', visited = new WeakSet()) {
  if (value == null || typeof value !== 'object' || visited.has(value)) return;
  visited.add(value);
  for (const [field, child] of Object.entries(value)) {
    const nextPath = fieldPath ? `${fieldPath}.${field}` : field;
    if (MEDIA_INLINE_FIELDS.has(field.toLowerCase())) {
      throw mediaTransferError(
        'WP_B_MEDIA_TRANSFER_REFERENCE_ONLY_REQUIRED',
        'Media transfer envelopes may contain references only',
        { field, fieldPath: nextPath }
      );
    }
    rejectInlineMedia(child, nextPath, visited);
  }
}

function validateTransferEnvelope(envelope) {
  assertReferenceOnlyEnvelope(envelope);
  rejectInlineMedia(envelope);
  const request = envelope.request;
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw mediaTransferError(
      'WP_B_MEDIA_TRANSFER_REQUEST_REQUIRED',
      'Media transfer requires one frozen reference-only request'
    );
  }
  const transferKind = requiredString(request.transferKind, 'request.transferKind', 64).toUpperCase();
  if (!TRANSFER_KINDS.has(transferKind)) {
    throw mediaTransferError(
      'WP_B_MEDIA_TRANSFER_KIND_INVALID',
      'Media transfer kind is not registered',
      { transferKind }
    );
  }
  return Object.freeze({
    executionId: requiredString(envelope.executionId, 'executionId'),
    intentId: requiredString(envelope.intentId, 'intentId'),
    attemptId: requiredString(envelope.attemptId, 'attemptId'),
    claimId: requiredString(envelope.claimId, 'claimId'),
    ownerId: requiredString(envelope.ownerId, 'ownerId'),
    generation: safeInteger(envelope.generation, 'generation'),
    hostGeneration: safeInteger(envelope.hostGeneration, 'hostGeneration'),
    fencingToken: safeInteger(envelope.fencingToken, 'fencingToken'),
    idempotencyKey: requiredString(envelope.idempotencyKey, 'idempotencyKey'),
    transferKind,
    mediaReference: requiredString(request.mediaReference, 'request.mediaReference'),
    sourceScopeReference: requiredString(request.sourceScopeReference, 'request.sourceScopeReference'),
    destinationScopeReference: requiredString(request.destinationScopeReference, 'request.destinationScopeReference'),
    metadataSha256: requiredSha256(request.metadataSha256, 'request.metadataSha256'),
    custodyReference: requiredString(request.custodyReference, 'request.custodyReference')
  });
}

function validateDependencies(options = {}) {
  if (typeof options.resolveCustodyReference !== 'function') {
    throw new TypeError('Media transfer operation requires a custody resolver');
  }
  const mediaClient = options.mediaClient;
  if (!mediaClient || typeof mediaClient !== 'object'
      || !Object.isFrozen(mediaClient)
      || typeof mediaClient.transfer !== 'function'
      || typeof mediaClient.transcribe !== 'function'
      || typeof mediaClient.lookup !== 'function') {
    throw new TypeError('Media transfer operation requires one frozen physical media client');
  }
  return Object.freeze({
    resolveCustodyReference: options.resolveCustodyReference,
    mediaClient
  });
}

function assertEphemeralCustody(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.isFrozen(value)) {
    throw mediaTransferError(
      'WP_B_MEDIA_TRANSFER_CUSTODY_INVALID',
      'Custody resolver must return one frozen ephemeral capability'
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
    transferKind: attempt.transferKind,
    boundary
  });
}

function physicalInput(attempt, custody) {
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
    transferKind: attempt.transferKind,
    mediaReference: attempt.mediaReference,
    sourceScopeReference: attempt.sourceScopeReference,
    destinationScopeReference: attempt.destinationScopeReference,
    metadataSha256: attempt.metadataSha256,
    custody
  });
}

function transferObservation(value = {}) {
  return Object.freeze({
    status: optionalString(value.status, 'status', 64),
    remoteTransferId: optionalString(value.remoteTransferId, 'remoteTransferId'),
    providerRequestId: optionalString(value.providerRequestId, 'providerRequestId'),
    outputReference: optionalString(value.outputReference, 'outputReference'),
    evidenceReference: optionalString(value.evidenceReference, 'evidenceReference'),
    failureCode: optionalString(value.failureCode, 'failureCode', 128),
    uncertain: value.uncertain === true
  });
}

function reconciliationObservation(value = {}) {
  const outcome = requiredString(value.outcome, 'outcome', 64);
  if (!RECONCILIATION_OUTCOMES.has(outcome)) {
    throw mediaTransferError(
      'WP_B_MEDIA_TRANSFER_RECONCILIATION_OUTCOME_INVALID',
      'Media reconciliation returned an unsupported outcome',
      { outcome }
    );
  }
  return Object.freeze({
    outcome,
    remoteTransferId: optionalString(value.remoteTransferId, 'remoteTransferId'),
    providerRequestId: optionalString(value.providerRequestId, 'providerRequestId'),
    outputReference: optionalString(value.outputReference, 'outputReference'),
    evidenceReference: optionalString(value.evidenceReference, 'evidenceReference'),
    failureCode: optionalString(value.failureCode, 'failureCode', 128)
  });
}

function createMediaTransferOperation(options = {}) {
  const dependencies = validateDependencies(options);
  const adapter = {
    operationKind: OPERATION_KIND,

    async perform(envelope) {
      const attempt = validateTransferEnvelope(envelope);
      const custody = assertEphemeralCustody(
        await dependencies.resolveCustodyReference(
          attempt.custodyReference,
          custodyContext(attempt, 'EPHEMERAL_MEDIA_TRANSFER_BOUNDARY')
        )
      );
      const input = physicalInput(attempt, custody);
      const result = attempt.transferKind === 'TRANSCRIBE'
        ? await dependencies.mediaClient.transcribe(input)
        : await dependencies.mediaClient.transfer(input);
      return transferObservation(result);
    },

    async reconcile(envelope) {
      const attempt = validateTransferEnvelope(envelope);
      const custody = assertEphemeralCustody(
        await dependencies.resolveCustodyReference(
          attempt.custodyReference,
          custodyContext(attempt, 'EPHEMERAL_MEDIA_RECONCILIATION_BOUNDARY')
        )
      );
      const result = await dependencies.mediaClient.lookup(physicalInput(attempt, custody));
      return reconciliationObservation(result);
    }
  };
  return Object.freeze(adapter);
}

module.exports = Object.freeze({
  OPERATION_KIND,
  createMediaTransferOperation,
  mediaTransferError,
  reconciliationObservation,
  transferObservation,
  validateTransferEnvelope
});
