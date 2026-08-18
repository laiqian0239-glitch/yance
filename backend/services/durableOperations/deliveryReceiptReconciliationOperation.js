'use strict';

const {
  OPERATION_KINDS,
  assertReferenceOnlyEnvelope
} = require('../durableOperationRegistry');

const OPERATION_KIND = OPERATION_KINDS.DELIVERY_RECEIPT_RECONCILIATION;
const ALLOWED_RECONCILIATION_OUTCOMES = new Set([
  'REMOTE_SUCCESS_PROVEN',
  'REMOTE_ABSENCE_PROVEN',
  'REMOTE_RESULT_UNKNOWN'
]);

function deliveryReceiptOperationError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, ...details });
}

function requiredString(value, field, maximum = 2048) {
  const result = String(value == null ? '' : value).trim();
  if (!result) {
    throw deliveryReceiptOperationError(
      field === 'attemptId'
        ? 'WP_B_DELIVERY_RECEIPT_ATTEMPT_ID_REQUIRED'
        : 'WP_B_DELIVERY_RECEIPT_FIELD_REQUIRED',
      `${field} is required`,
      { field }
    );
  }
  if (result.length > maximum || /[\u0000-\u001f\u007f]/u.test(result)) {
    throw deliveryReceiptOperationError(
      'WP_B_DELIVERY_RECEIPT_FIELD_INVALID',
      `${field} is invalid`,
      { field, maximum }
    );
  }
  return result;
}

function optionalString(value, field, maximum = 2048) {
  const result = String(value == null ? '' : value).trim();
  if (result.length > maximum || /[\u0000-\u001f\u007f]/u.test(result)) {
    throw deliveryReceiptOperationError(
      'WP_B_DELIVERY_RECEIPT_FIELD_INVALID',
      `${field} is invalid`,
      { field, maximum }
    );
  }
  return result;
}

function requiredPositiveInteger(value, field) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 1) {
    throw deliveryReceiptOperationError(
      'WP_B_DELIVERY_RECEIPT_INTEGER_INVALID',
      `${field} must be a safe integer >= 1`,
      { field }
    );
  }
  return result;
}

function requiredSha256(value) {
  const result = requiredString(value, 'requestContentSha256', 64);
  if (!/^[a-f0-9]{64}$/u.test(result)) {
    throw deliveryReceiptOperationError(
      'WP_B_DELIVERY_RECEIPT_CONTENT_HASH_INVALID',
      'requestContentSha256 must be one lowercase SHA-256 digest'
    );
  }
  return result;
}

function validateReconciliationEnvelope(envelope) {
  assertReferenceOnlyEnvelope(envelope);
  const request = envelope.request;
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw deliveryReceiptOperationError(
      'WP_B_DELIVERY_RECEIPT_REQUEST_REQUIRED',
      'Delivery receipt reconciliation requires one frozen reference-only request'
    );
  }
  const providerRequestId = optionalString(envelope.providerRequestId, 'providerRequestId');
  const platformMessageId = optionalString(envelope.platformMessageId, 'platformMessageId');
  if (!providerRequestId && !platformMessageId) {
    throw deliveryReceiptOperationError(
      'WP_B_DELIVERY_RECEIPT_REMOTE_IDENTITY_REQUIRED',
      'Delivery receipt reconciliation requires one persisted remote identity'
    );
  }
  return Object.freeze({
    executionId: requiredString(envelope.executionId, 'executionId'),
    intentId: requiredString(envelope.intentId, 'intentId'),
    attemptId: requiredString(envelope.attemptId, 'attemptId'),
    claimId: requiredString(envelope.claimId, 'claimId'),
    ownerId: requiredString(envelope.ownerId, 'ownerId'),
    generation: requiredPositiveInteger(envelope.generation, 'generation'),
    hostGeneration: requiredPositiveInteger(envelope.hostGeneration, 'hostGeneration'),
    fencingToken: requiredPositiveInteger(envelope.fencingToken, 'fencingToken'),
    idempotencyKey: requiredString(envelope.idempotencyKey, 'idempotencyKey'),
    platform: requiredString(request.platform, 'platform', 64).toLowerCase(),
    accountReference: requiredString(request.accountReference, 'accountReference'),
    deliveryAttemptReference: requiredString(request.deliveryAttemptReference, 'deliveryAttemptReference'),
    credentialReference: requiredString(request.credentialReference, 'credentialReference'),
    requestContentSha256: requiredSha256(request.requestContentSha256),
    providerRequestId,
    platformMessageId
  });
}

function validateDependencies(options = {}) {
  if (typeof options.resolveCredentialReference !== 'function') {
    throw new TypeError('Delivery receipt operation requires a credential custody resolver');
  }
  const deliveryClient = options.deliveryClient;
  if (!deliveryClient || typeof deliveryClient !== 'object'
      || !Object.isFrozen(deliveryClient)
      || typeof deliveryClient.query !== 'function'
      || typeof deliveryClient.lookup !== 'function') {
    throw new TypeError('Delivery receipt operation requires a frozen physical delivery client');
  }
  return Object.freeze({
    deliveryClient,
    resolveCredentialReference: options.resolveCredentialReference
  });
}

function assertEphemeralCredential(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.isFrozen(value)) {
    throw deliveryReceiptOperationError(
      'WP_B_DELIVERY_RECEIPT_CREDENTIAL_CAPABILITY_INVALID',
      'Credential custody resolver must return one frozen ephemeral capability'
    );
  }
  return value;
}

function custodyContext(attempt, custody) {
  return Object.freeze({
    executionId: attempt.executionId,
    intentId: attempt.intentId,
    attemptId: attempt.attemptId,
    claimId: attempt.claimId,
    ownerId: attempt.ownerId,
    generation: attempt.generation,
    hostGeneration: attempt.hostGeneration,
    fencingToken: attempt.fencingToken,
    operationKind: OPERATION_KIND,
    platform: attempt.platform,
    custody
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
    deliveryAttemptReference: attempt.deliveryAttemptReference,
    requestContentSha256: attempt.requestContentSha256,
    providerRequestId: attempt.providerRequestId,
    platformMessageId: attempt.platformMessageId,
    credential
  });
}

function redactedDeliveryObservation(value = {}) {
  return Object.freeze({
    deliveryStatus: optionalString(value.deliveryStatus, 'deliveryStatus', 64),
    platformMessageId: optionalString(value.platformMessageId, 'platformMessageId'),
    providerRequestId: optionalString(value.providerRequestId, 'providerRequestId'),
    evidenceReference: optionalString(value.evidenceReference, 'evidenceReference'),
    failureCode: optionalString(value.failureCode, 'failureCode', 128)
  });
}

function redactedReconciliationObservation(value = {}) {
  const outcome = requiredString(value.outcome, 'outcome', 64);
  if (!ALLOWED_RECONCILIATION_OUTCOMES.has(outcome)) {
    throw deliveryReceiptOperationError(
      'WP_B_DELIVERY_RECEIPT_RECONCILIATION_OUTCOME_INVALID',
      'Delivery receipt reconciliation returned an unsupported outcome',
      { outcome }
    );
  }
  return Object.freeze({
    outcome,
    deliveryStatus: optionalString(value.deliveryStatus, 'deliveryStatus', 64),
    platformMessageId: optionalString(value.platformMessageId, 'platformMessageId'),
    providerRequestId: optionalString(value.providerRequestId, 'providerRequestId'),
    evidenceReference: optionalString(value.evidenceReference, 'evidenceReference'),
    failureCode: optionalString(value.failureCode, 'failureCode', 128)
  });
}

function createDeliveryReceiptReconciliationOperation(options = {}) {
  const dependencies = validateDependencies(options);

  const adapter = {
    operationKind: OPERATION_KIND,

    async perform(reconciliationEnvelope) {
      const attempt = validateReconciliationEnvelope(reconciliationEnvelope);
      const credential = assertEphemeralCredential(
        await dependencies.resolveCredentialReference(
          attempt.credentialReference,
          custodyContext(attempt, 'EPHEMERAL_DELIVERY_QUERY_BOUNDARY')
        )
      );
      const observation = await dependencies.deliveryClient.query(
        physicalInput(attempt, credential)
      );
      return redactedDeliveryObservation(observation);
    },

    async reconcile(reconciliationEnvelope) {
      const attempt = validateReconciliationEnvelope(reconciliationEnvelope);
      const credential = assertEphemeralCredential(
        await dependencies.resolveCredentialReference(
          attempt.credentialReference,
          custodyContext(attempt, 'EPHEMERAL_RECONCILIATION_BOUNDARY')
        )
      );
      const observation = await dependencies.deliveryClient.lookup(
        physicalInput(attempt, credential)
      );
      return redactedReconciliationObservation(observation);
    }
  };

  return Object.freeze(adapter);
}

module.exports = Object.freeze({
  OPERATION_KIND,
  createDeliveryReceiptReconciliationOperation,
  custodyContext,
  deliveryReceiptOperationError,
  physicalInput,
  redactedDeliveryObservation,
  redactedReconciliationObservation,
  validateReconciliationEnvelope
});
