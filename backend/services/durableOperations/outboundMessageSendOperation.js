'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const {
  OPERATION_KINDS,
  assertReferenceOnlyEnvelope
} = require('../durableOperationRegistry');

const OPERATION_KIND = OPERATION_KINDS.OUTBOUND_MESSAGE_SEND;
const ALLOWED_RECONCILIATION_OUTCOMES = new Set([
  'REMOTE_SUCCESS_PROVEN',
  'REMOTE_ABSENCE_PROVEN',
  'REMOTE_RESULT_UNKNOWN'
]);

function outboundMessageOperationError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, ...details });
}

function requiredString(value, field, maximum = 2048) {
  const result = String(value == null ? '' : value).trim();
  if (!result) {
    throw outboundMessageOperationError(
      field === 'attemptId'
        ? 'WP_B_OUTBOUND_MESSAGE_ATTEMPT_ID_REQUIRED'
        : 'WP_B_OUTBOUND_MESSAGE_FIELD_REQUIRED',
      `${field} is required`,
      { field }
    );
  }
  if (result.length > maximum || /[\u0000-\u001f\u007f]/u.test(result)) {
    throw outboundMessageOperationError(
      'WP_B_OUTBOUND_MESSAGE_FIELD_INVALID',
      `${field} is invalid`,
      { field, maximum }
    );
  }
  return result;
}

function optionalString(value, field, maximum = 2048) {
  const result = String(value == null ? '' : value).trim();
  if (result.length > maximum || /[\u0000-\u001f\u007f]/u.test(result)) {
    throw outboundMessageOperationError(
      'WP_B_OUTBOUND_MESSAGE_FIELD_INVALID',
      `${field} is invalid`,
      { field, maximum }
    );
  }
  return result;
}

function requiredPositiveInteger(value, field) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 1) {
    throw outboundMessageOperationError(
      'WP_B_OUTBOUND_MESSAGE_INTEGER_INVALID',
      `${field} must be a safe integer >= 1`,
      { field }
    );
  }
  return result;
}

function requiredSha256(value) {
  const result = requiredString(value, 'requestContentSha256', 64);
  if (!/^[a-f0-9]{64}$/u.test(result)) {
    throw outboundMessageOperationError(
      'WP_B_OUTBOUND_MESSAGE_CONTENT_HASH_INVALID',
      'requestContentSha256 must be one lowercase SHA-256 digest'
    );
  }
  return result;
}

function validateAttemptEnvelope(envelope) {
  assertReferenceOnlyEnvelope(envelope);
  const request = envelope.request;
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw outboundMessageOperationError(
      'WP_B_OUTBOUND_MESSAGE_REQUEST_REQUIRED',
      'Outbound message attempt requires one frozen reference-only request'
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
    commandReference: requiredString(request.commandReference, 'commandReference'),
    credentialReference: requiredString(request.credentialReference, 'credentialReference'),
    requestContentSha256: requiredSha256(request.requestContentSha256),
    providerRequestId: optionalString(envelope.providerRequestId, 'providerRequestId'),
    platformMessageId: optionalString(envelope.platformMessageId, 'platformMessageId')
  });
}

function defaultLocalPersistenceRepairEnqueue(input) {
  return require('../localPersistenceRepairService').enqueue(input);
}

function validateDependencies(options = {}) {
  if (typeof options.resolveCommandReference !== 'function') {
    throw new TypeError('Outbound message operation requires a command custody resolver');
  }
  if (typeof options.resolveCredentialReference !== 'function') {
    throw new TypeError('Outbound message operation requires a credential custody resolver');
  }
  const channelClient = options.channelClient;
  if (!channelClient || typeof channelClient !== 'object'
      || !Object.isFrozen(channelClient)
      || typeof channelClient.perform !== 'function'
      || typeof channelClient.lookup !== 'function') {
    throw new TypeError('Outbound message operation requires a frozen physical channel client');
  }
  const enqueueLocalPersistenceRepair = options.enqueueLocalPersistenceRepair || defaultLocalPersistenceRepairEnqueue;
  if (typeof enqueueLocalPersistenceRepair !== 'function') {
    throw new TypeError('Outbound message operation requires a local persistence repair enqueue capability');
  }
  return Object.freeze({
    channelClient,
    resolveCommandReference: options.resolveCommandReference,
    resolveCredentialReference: options.resolveCredentialReference,
    enqueueLocalPersistenceRepair
  });
}

function assertEphemeralCapability(value, code, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.isFrozen(value)) {
    throw outboundMessageOperationError(
      code,
      `${label} resolver must return one frozen ephemeral capability`
    );
  }
  return value;
}

function physicalContext(attempt, custody) {
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

function physicalInput(attempt, capabilities = {}) {
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
    requestContentSha256: attempt.requestContentSha256,
    providerRequestId: attempt.providerRequestId,
    platformMessageId: attempt.platformMessageId,
    ...capabilities
  });
}

function localPersistenceRepairInput(attempt, observation = {}) {
  if (observation.localPersistencePending !== true) return null;
  const payload = observation.localPersistenceRepair;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw outboundMessageOperationError(
      'WP_B_OUTBOUND_LOCAL_REPAIR_PLAN_REQUIRED',
      'Platform accepted the outbound action but no local persistence repair plan was returned',
      { attemptId: attempt.attemptId }
    );
  }
  const conversationId = optionalString(
    payload.message?.conversationId
      || payload.reaction?.conversationId
      || payload.revoke?.conversationId,
    'conversationId'
  );
  return Object.freeze({
    id: `local-repair-${attempt.attemptId}`,
    queueId: attempt.commandReference,
    platform: attempt.platform,
    accountId: attempt.accountReference,
    conversationId,
    payload
  });
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function takeFileRepairCustody(attempt, repairInput) {
  if (!repairInput || !['whatsapp', 'telegram'].includes(attempt.platform)) return repairInput;
  const payload = repairInput.payload;
  if (!payload || String(payload.kind || '').trim() !== 'outbound-media-upsert') return repairInput;
  const source = payload.source && typeof payload.source === 'object' && !Array.isArray(payload.source)
    ? payload.source
    : null;

  const filePath = String(source?.filePath || payload.sourceFile || '').trim();
  if (!filePath) return repairInput;

  const bytes = fs.readFileSync(filePath);
  const expectedSha256 = String(source?.expectedSha256 || payload.expectedSha256 || '').trim().toLowerCase();
  if (expectedSha256 && (!/^[a-f0-9]{64}$/u.test(expectedSha256) || sha256(bytes) !== expectedSha256)) {
    throw outboundMessageOperationError(
      'WP_B_OUTBOUND_LOCAL_REPAIR_MEDIA_HASH_MISMATCH',
      'File-backed local persistence repair source failed SHA-256 verification before durable custody',
      { attemptId: attempt.attemptId }
    );
  }

  const canonicalPayload = { ...payload };
  delete canonicalPayload.sourceFile;
  delete canonicalPayload.expectedSha256;

  return Object.freeze({
    ...repairInput,
    payload: Object.freeze({
      ...canonicalPayload,
      source: Object.freeze({
        bufferBase64: bytes.toString('base64'),
        ...(expectedSha256 ? { expectedSha256 } : {})
      })
    })
  });
}

function persistLocalPersistenceRepair(dependencies, attempt, observation = {}) {
  if (observation.localPersistencePending !== true) return null;
  const platformMessageId = optionalString(observation.platformMessageId, 'platformMessageId');
  try {
    const repairInput = takeFileRepairCustody(
      attempt,
      localPersistenceRepairInput(attempt, observation)
    );
    const repair = dependencies.enqueueLocalPersistenceRepair(repairInput);
    if (!repair || typeof repair !== 'object') {
      throw outboundMessageOperationError(
        'WP_B_OUTBOUND_LOCAL_REPAIR_RECEIPT_REQUIRED',
        'Local persistence repair enqueue did not return a durable repair receipt'
      );
    }
    return repair;
  } catch (cause) {
    const wrapped = outboundMessageOperationError(
      'WP_B_OUTBOUND_LOCAL_REPAIR_DURABILITY_UNCERTAIN',
      'Platform accepted the outbound action but the local persistence repair plan could not be durably recorded',
      {
        attemptId: attempt.attemptId,
        causeCode: String(cause?.code || ''),
        causeMessage: String(cause?.message || cause)
      }
    );
    wrapped.platformAccepted = true;
    wrapped.platformMessageId = platformMessageId;
    wrapped.remoteOutcomeUnknown = true;
    wrapped.outcomeUnknown = true;
    wrapped.automaticRetryBlocked = true;
    wrapped.evidenceReference = `local-repair:${attempt.attemptId}:durability-uncertain`;
    throw wrapped;
  }
}

function redactedPhysicalObservation(value = {}) {
  return Object.freeze({
    accepted: value.accepted === true,
    platformMessageId: optionalString(value.platformMessageId, 'platformMessageId'),
    providerRequestId: optionalString(value.providerRequestId, 'providerRequestId'),
    evidenceReference: optionalString(value.evidenceReference, 'evidenceReference')
  });
}

function redactedReconciliationObservation(value = {}) {
  const outcome = requiredString(value.outcome, 'outcome', 64);
  if (!ALLOWED_RECONCILIATION_OUTCOMES.has(outcome)) {
    throw outboundMessageOperationError(
      'WP_B_OUTBOUND_MESSAGE_RECONCILIATION_OUTCOME_INVALID',
      'Outbound message reconciliation returned an unsupported outcome',
      { outcome }
    );
  }
  return Object.freeze({
    outcome,
    platformMessageId: optionalString(value.platformMessageId, 'platformMessageId'),
    providerRequestId: optionalString(value.providerRequestId, 'providerRequestId'),
    evidenceReference: optionalString(value.evidenceReference, 'evidenceReference')
  });
}

function createOutboundMessageSendOperation(options = {}) {
  const dependencies = validateDependencies(options);

  const adapter = {
    operationKind: OPERATION_KIND,

    async perform(attemptEnvelope) {
      const attempt = validateAttemptEnvelope(attemptEnvelope);
      const command = assertEphemeralCapability(
        await dependencies.resolveCommandReference(
          attempt.commandReference,
          physicalContext(attempt, 'EPHEMERAL_MESSAGE_COMMAND_BOUNDARY')
        ),
        'WP_B_OUTBOUND_MESSAGE_COMMAND_CAPABILITY_INVALID',
        'Command custody'
      );
      const credential = assertEphemeralCapability(
        await dependencies.resolveCredentialReference(
          attempt.credentialReference,
          physicalContext(attempt, 'EPHEMERAL_PHYSICAL_BOUNDARY')
        ),
        'WP_B_OUTBOUND_MESSAGE_CREDENTIAL_CAPABILITY_INVALID',
        'Credential custody'
      );
      const observation = await dependencies.channelClient.perform(
        physicalInput(attempt, { command, credential })
      );
      persistLocalPersistenceRepair(dependencies, attempt, observation);
      return redactedPhysicalObservation(observation);
    },

    async reconcile(reconciliationEnvelope) {
      const attempt = validateAttemptEnvelope(reconciliationEnvelope);
      const credential = assertEphemeralCapability(
        await dependencies.resolveCredentialReference(
          attempt.credentialReference,
          physicalContext(attempt, 'EPHEMERAL_RECONCILIATION_BOUNDARY')
        ),
        'WP_B_OUTBOUND_MESSAGE_CREDENTIAL_CAPABILITY_INVALID',
        'Credential custody'
      );
      const observation = await dependencies.channelClient.lookup(
        physicalInput(attempt, { command: Object.freeze({ lookupOnly: true }), credential })
      );
      return redactedReconciliationObservation(observation);
    }
  };

  return Object.freeze(adapter);
}

module.exports = Object.freeze({
  OPERATION_KIND,
  createOutboundMessageSendOperation,
  outboundMessageOperationError,
  localPersistenceRepairInput,
  persistLocalPersistenceRepair,
  physicalInput,
  redactedPhysicalObservation,
  redactedReconciliationObservation,
  validateAttemptEnvelope
});