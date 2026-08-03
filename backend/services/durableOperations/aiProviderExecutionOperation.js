'use strict';

const {
  OPERATION_KINDS,
  assertReferenceOnlyEnvelope
} = require('../durableOperationRegistry');

const OPERATION_KIND = OPERATION_KINDS.AI_PROVIDER_EXECUTION;
const ALLOWED_RECONCILIATION_OUTCOMES = new Set([
  'REMOTE_SUCCESS_PROVEN',
  'REMOTE_ABSENCE_PROVEN',
  'REMOTE_RESULT_UNKNOWN'
]);

function aiProviderOperationError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, ...details });
}

function requiredString(value, field, maximum = 2048) {
  const result = String(value == null ? '' : value).trim();
  if (!result) {
    throw aiProviderOperationError(
      field === 'attemptId'
        ? 'WP_B_AI_PROVIDER_ATTEMPT_ID_REQUIRED'
        : 'WP_B_AI_PROVIDER_FIELD_REQUIRED',
      `${field} is required`,
      { field }
    );
  }
  if (result.length > maximum || /[\u0000-\u001f\u007f]/u.test(result)) {
    throw aiProviderOperationError(
      'WP_B_AI_PROVIDER_FIELD_INVALID',
      `${field} is invalid`,
      { field, maximum }
    );
  }
  return result;
}

function optionalString(value, field, maximum = 2048) {
  const result = String(value == null ? '' : value).trim();
  if (result.length > maximum || /[\u0000-\u001f\u007f]/u.test(result)) {
    throw aiProviderOperationError(
      'WP_B_AI_PROVIDER_FIELD_INVALID',
      `${field} is invalid`,
      { field, maximum }
    );
  }
  return result;
}

function validateAttemptEnvelope(envelope) {
  assertReferenceOnlyEnvelope(envelope);
  const request = envelope.request;
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw aiProviderOperationError(
      'WP_B_AI_PROVIDER_REQUEST_REQUIRED',
      'AI provider attempt requires one frozen reference-only request'
    );
  }
  return Object.freeze({
    executionId: requiredString(envelope.executionId, 'executionId'),
    intentId: requiredString(envelope.intentId, 'intentId'),
    attemptId: requiredString(envelope.attemptId, 'attemptId'),
    idempotencyKey: requiredString(envelope.idempotencyKey, 'idempotencyKey'),
    modelReference: requiredString(request.modelReference, 'modelReference'),
    promptReference: requiredString(request.promptReference, 'promptReference'),
    credentialReference: requiredString(request.credentialReference, 'credentialReference'),
    requestContentSha256: requiredString(request.requestContentSha256, 'requestContentSha256', 64),
    providerRequestId: optionalString(envelope.providerRequestId, 'providerRequestId')
  });
}

function validateDependencies(options = {}) {
  if (typeof options.resolveCredentialReference !== 'function') {
    throw new TypeError('AI provider operation requires a credential custody resolver');
  }
  const providerClient = options.providerClient;
  if (!providerClient || typeof providerClient !== 'object' || !Object.isFrozen(providerClient)
      || typeof providerClient.perform !== 'function'
      || typeof providerClient.lookup !== 'function') {
    throw new TypeError('AI provider operation requires a frozen physical provider client');
  }
  return Object.freeze({
    providerClient,
    resolveCredentialReference: options.resolveCredentialReference
  });
}

function redactedPhysicalObservation(value = {}) {
  return Object.freeze({
    providerRequestId: optionalString(value.providerRequestId, 'providerRequestId'),
    providerReceiptId: optionalString(value.providerReceiptId, 'providerReceiptId'),
    evidenceReference: optionalString(value.evidenceReference, 'evidenceReference'),
    accepted: value.accepted === true
  });
}

function redactedReconciliationObservation(value = {}) {
  const outcome = requiredString(value.outcome, 'outcome', 64);
  if (!ALLOWED_RECONCILIATION_OUTCOMES.has(outcome)) {
    throw aiProviderOperationError(
      'WP_B_AI_PROVIDER_RECONCILIATION_OUTCOME_INVALID',
      'AI provider reconciliation returned an unsupported outcome',
      { outcome }
    );
  }
  return Object.freeze({
    outcome,
    providerRequestId: optionalString(value.providerRequestId, 'providerRequestId'),
    providerReceiptId: optionalString(value.providerReceiptId, 'providerReceiptId'),
    evidenceReference: optionalString(value.evidenceReference, 'evidenceReference')
  });
}

function createAiProviderExecutionOperation(options = {}) {
  const dependencies = validateDependencies(options);

  const adapter = {
    operationKind: OPERATION_KIND,

    async perform(attemptEnvelope) {
      const attempt = validateAttemptEnvelope(attemptEnvelope);
      const credential = await dependencies.resolveCredentialReference(
        attempt.credentialReference,
        Object.freeze({
          executionId: attempt.executionId,
          intentId: attempt.intentId,
          attemptId: attempt.attemptId,
          operationKind: OPERATION_KIND,
          custody: 'EPHEMERAL_PHYSICAL_BOUNDARY'
        })
      );
      if (!credential || typeof credential !== 'object' || !Object.isFrozen(credential)) {
        throw aiProviderOperationError(
          'WP_B_AI_PROVIDER_CREDENTIAL_CAPABILITY_INVALID',
          'Credential custody resolver must return one frozen ephemeral capability'
        );
      }
      const physicalResult = await dependencies.providerClient.perform(Object.freeze({
        executionId: attempt.executionId,
        intentId: attempt.intentId,
        attemptId: attempt.attemptId,
        idempotencyKey: attempt.idempotencyKey,
        modelReference: attempt.modelReference,
        promptReference: attempt.promptReference,
        requestContentSha256: attempt.requestContentSha256,
        credential
      }));
      return redactedPhysicalObservation(physicalResult);
    },

    async reconcile(reconciliationEnvelope) {
      const attempt = validateAttemptEnvelope(reconciliationEnvelope);
      const credential = await dependencies.resolveCredentialReference(
        attempt.credentialReference,
        Object.freeze({
          executionId: attempt.executionId,
          intentId: attempt.intentId,
          attemptId: attempt.attemptId,
          operationKind: OPERATION_KIND,
          custody: 'EPHEMERAL_RECONCILIATION_BOUNDARY'
        })
      );
      if (!credential || typeof credential !== 'object' || !Object.isFrozen(credential)) {
        throw aiProviderOperationError(
          'WP_B_AI_PROVIDER_CREDENTIAL_CAPABILITY_INVALID',
          'Credential custody resolver must return one frozen ephemeral capability'
        );
      }
      const observation = await dependencies.providerClient.lookup(Object.freeze({
        executionId: attempt.executionId,
        intentId: attempt.intentId,
        attemptId: attempt.attemptId,
        idempotencyKey: attempt.idempotencyKey,
        providerRequestId: attempt.providerRequestId,
        modelReference: attempt.modelReference,
        requestContentSha256: attempt.requestContentSha256,
        credential
      }));
      return redactedReconciliationObservation(observation);
    }
  };

  return Object.freeze(adapter);
}

module.exports = Object.freeze({
  OPERATION_KIND,
  aiProviderOperationError,
  createAiProviderExecutionOperation,
  redactedPhysicalObservation,
  redactedReconciliationObservation,
  validateAttemptEnvelope
});
