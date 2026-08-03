'use strict';

const { canonicalSerialize } = require('./canonicalSerialization');
const { deepFreeze } = require('../lib/deepFreeze');

const OUTCOMES = Object.freeze({
  REMOTE_SUCCESS_PROVEN: 'REMOTE_SUCCESS_PROVEN',
  REMOTE_ABSENCE_PROVEN: 'REMOTE_ABSENCE_PROVEN',
  REMOTE_RESULT_UNKNOWN: 'REMOTE_RESULT_UNKNOWN'
});
const OUTCOME_VALUES = new Set(Object.values(OUTCOMES));
const OBSERVATION_FIELDS = new Set([
  'outcome',
  'provider',
  'operationId',
  'evidenceReference',
  'remoteReceiptId',
  'observedAt',
  'result'
]);
const MANUAL_RESOLUTION_FIELDS = new Set([
  'operationId',
  'outcome',
  'actor',
  'reasonCode',
  'evidenceReference',
  'authorityTimestamp'
]);

function reconciliationError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, ...details });
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactObjectDescriptors(input, allowedFields, code, name) {
  if (!isPlainObject(input) || Object.getOwnPropertySymbols(input).length !== 0) {
    throw reconciliationError(code, `${name} must be a plain object without symbol keys`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(input);
  for (const [field, descriptor] of Object.entries(descriptors)) {
    if (!allowedFields.has(field)
        || typeof descriptor.get === 'function'
        || typeof descriptor.set === 'function') {
      throw reconciliationError(code, `${name}.${field} is not registered plain data`, { field });
    }
  }
  return descriptors;
}

function requiredString(value, field, code = 'WP_B_RECONCILIATION_OBSERVATION_INVALID', maximum = 2048) {
  const result = String(value == null ? '' : value).trim();
  if (!result || result.length > maximum || /[\u0000-\u001f\u007f]/u.test(result)) {
    throw reconciliationError(code, `${field} is required and must be stable text`, { field });
  }
  return result;
}

function optionalString(value, field, maximum = 2048) {
  const result = String(value == null ? '' : value).trim();
  if (result.length > maximum || /[\u0000-\u001f\u007f]/u.test(result)) {
    throw reconciliationError(
      'WP_B_RECONCILIATION_OBSERVATION_INVALID',
      `${field} must be stable text when provided`,
      { field }
    );
  }
  return result;
}

function normalizeTimestamp(value, field, code = 'WP_B_RECONCILIATION_OBSERVATION_INVALID') {
  const source = isPlainObject(value) && Object.prototype.hasOwnProperty.call(value, 'iso')
    ? value.iso
    : value;
  const epochMs = Date.parse(String(source == null ? '' : source));
  if (!Number.isFinite(epochMs)) {
    throw reconciliationError(code, `${field} must be a valid timestamp`, { field });
  }
  const normalized = new Date(epochMs).toISOString();
  if (normalized !== String(source)) {
    throw reconciliationError(code, `${field} must be normalized UTC ISO-8601`, { field });
  }
  return normalized;
}

function normalizeOutcome(value) {
  const outcome = String(value == null ? '' : value).trim();
  if (!OUTCOME_VALUES.has(outcome)) {
    throw reconciliationError(
      'WP_B_RECONCILIATION_OUTCOME_INVALID',
      'Reconciliation outcome must be one of the three registered observations',
      { outcome }
    );
  }
  return outcome;
}

function canonicalPlainData(value, field) {
  try {
    return deepFreeze(JSON.parse(canonicalSerialize(value == null ? {} : value)));
  } catch (error) {
    throw reconciliationError(
      'WP_B_RECONCILIATION_OBSERVATION_INVALID',
      `${field} must be canonical plain data`,
      { field, causeCode: error?.code || '', causeMessage: error?.message || String(error) }
    );
  }
}

function normalizeReconciliationObservation(input) {
  const descriptors = exactObjectDescriptors(
    input,
    OBSERVATION_FIELDS,
    'WP_B_RECONCILIATION_OBSERVATION_INVALID',
    'observation'
  );
  const outcome = normalizeOutcome(descriptors.outcome?.value);
  const provider = requiredString(descriptors.provider?.value, 'observation.provider');
  const operationId = requiredString(descriptors.operationId?.value, 'observation.operationId');
  const evidenceReference = requiredString(
    descriptors.evidenceReference?.value,
    'observation.evidenceReference',
    outcome === OUTCOMES.REMOTE_SUCCESS_PROVEN
      ? 'WP_B_RECONCILIATION_PROOF_REQUIRED'
      : 'WP_B_RECONCILIATION_OBSERVATION_INVALID'
  );
  const remoteReceiptId = optionalString(
    descriptors.remoteReceiptId?.value,
    'observation.remoteReceiptId'
  );
  if (outcome === OUTCOMES.REMOTE_SUCCESS_PROVEN && !remoteReceiptId) {
    throw reconciliationError(
      'WP_B_RECONCILIATION_PROOF_REQUIRED',
      'Remote success requires a stable provider receipt identifier',
      { operationId }
    );
  }

  return deepFreeze({
    schemaVersion: 1,
    authority: 'ExternalOutcomeReconciliation',
    outcome,
    provider,
    operationId,
    evidenceReference,
    remoteReceiptId,
    observedAt: normalizeTimestamp(descriptors.observedAt?.value, 'observation.observedAt'),
    result: canonicalPlainData(descriptors.result?.value, 'observation.result')
  });
}

function canScheduleAnotherAttempt(outcome) {
  return normalizeOutcome(outcome) === OUTCOMES.REMOTE_ABSENCE_PROVEN;
}

function assertSynchronous(value, stage) {
  if (value && typeof value.then === 'function') {
    value.catch?.(() => undefined);
    throw reconciliationError(
      'WP_B_RECONCILIATION_ASYNC_CALLBACK_FORBIDDEN',
      `${stage} must complete synchronously inside its authority boundary`,
      { stage }
    );
  }
  return value;
}

function reconcileExternalOutcome(options = {}) {
  if (!isPlainObject(options)) {
    throw reconciliationError(
      'WP_B_RECONCILIATION_OPTIONS_INVALID',
      'Reconciliation options must be a plain object'
    );
  }
  const observation = normalizeReconciliationObservation(options.observation);
  const authorityTimestamp = normalizeTimestamp(
    options.authorityTimestamp,
    'authorityTimestamp',
    'WP_B_RECONCILIATION_AUTHORITY_TIMESTAMP_INVALID'
  );

  if (observation.outcome !== OUTCOMES.REMOTE_SUCCESS_PROVEN) {
    return deepFreeze({
      schemaVersion: 1,
      authority: 'ExternalOutcomeReconciliation',
      operationId: observation.operationId,
      outcome: observation.outcome,
      terminal: false,
      state: observation.outcome === OUTCOMES.REMOTE_RESULT_UNKNOWN
        ? 'REMOTE_RESULT_UNKNOWN'
        : 'REMOTE_ABSENCE_PROVEN',
      retryAllowed: canScheduleAnotherAttempt(observation.outcome),
      authorityTimestamp
    });
  }

  if (typeof options.transaction !== 'function') {
    throw reconciliationError(
      'WP_B_RECONCILIATION_TRANSACTION_REQUIRED',
      'Remote success requires one Authority transaction for receipt and terminal transition'
    );
  }
  if (typeof options.recordReceipt !== 'function') {
    throw reconciliationError(
      'WP_B_RECONCILIATION_RECORD_RECEIPT_REQUIRED',
      'Remote success requires the durable recordReceipt authority'
    );
  }
  if (typeof options.transitionExecution !== 'function') {
    throw reconciliationError(
      'WP_B_RECONCILIATION_TRANSITION_REQUIRED',
      'Remote success requires the durable execution transition authority'
    );
  }

  const trustedReceipt = deepFreeze({
    schemaVersion: 1,
    receiptType: 'REMOTE_SUCCESS_PROVEN',
    authority: 'ExternalOutcomeReconciliation',
    operationId: observation.operationId,
    provider: observation.provider,
    remoteReceiptId: observation.remoteReceiptId,
    evidenceReference: observation.evidenceReference,
    observedAt: observation.observedAt,
    authorityTimestamp,
    result: observation.result,
    appendOnly: true
  });

  return assertSynchronous(options.transaction(() => {
    const persisted = assertSynchronous(options.recordReceipt(trustedReceipt), 'recordReceipt');
    const trustedReceiptId = requiredString(
      persisted?.receiptId,
      'recordReceipt.receiptId',
      'WP_B_RECONCILIATION_TRUSTED_RECEIPT_INVALID'
    );
    const transition = deepFreeze({
      schemaVersion: 1,
      authority: 'DurableExecutionAuthority',
      operationId: observation.operationId,
      state: 'SUCCEEDED',
      trustedReceiptId,
      authorityTimestamp
    });
    assertSynchronous(options.transitionExecution(transition), 'transitionExecution');

    return deepFreeze({
      schemaVersion: 1,
      authority: 'ExternalOutcomeReconciliation',
      operationId: observation.operationId,
      outcome: observation.outcome,
      terminal: true,
      state: 'SUCCEEDED',
      retryAllowed: false,
      trustedReceiptId,
      authorityTimestamp
    });
  }), 'transaction');
}

function createManualResolutionReceipt(input) {
  const descriptors = exactObjectDescriptors(
    input,
    MANUAL_RESOLUTION_FIELDS,
    'WP_B_MANUAL_RESOLUTION_INPUT_INVALID',
    'manualResolution'
  );
  const operationId = requiredString(
    descriptors.operationId?.value,
    'manualResolution.operationId',
    'WP_B_MANUAL_RESOLUTION_FIELD_REQUIRED'
  );
  const actor = requiredString(
    descriptors.actor?.value,
    'manualResolution.actor',
    'WP_B_MANUAL_RESOLUTION_FIELD_REQUIRED'
  );
  const reasonCode = requiredString(
    descriptors.reasonCode?.value,
    'manualResolution.reasonCode',
    'WP_B_MANUAL_RESOLUTION_FIELD_REQUIRED',
    256
  );
  const evidenceReference = requiredString(
    descriptors.evidenceReference?.value,
    'manualResolution.evidenceReference',
    'WP_B_MANUAL_RESOLUTION_FIELD_REQUIRED'
  );

  return deepFreeze({
    schemaVersion: 1,
    receiptType: 'MANUAL_RESOLUTION',
    authority: 'ExternalOutcomeReconciliation',
    operationId,
    outcome: normalizeOutcome(descriptors.outcome?.value),
    actor,
    reasonCode,
    evidenceReference,
    authorityTimestamp: normalizeTimestamp(
      descriptors.authorityTimestamp?.value,
      'manualResolution.authorityTimestamp',
      'WP_B_MANUAL_RESOLUTION_FIELD_REQUIRED'
    ),
    appendOnly: true
  });
}

module.exports = Object.freeze({
  OUTCOMES,
  canScheduleAnotherAttempt,
  createManualResolutionReceipt,
  normalizeReconciliationObservation,
  reconcileExternalOutcome
});
