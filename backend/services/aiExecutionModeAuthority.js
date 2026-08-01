'use strict';

const AUTHORITY = 'AIExecutionModeAuthority';
const SCHEMA_VERSION = 1;
const EXECUTION_MODE = Object.freeze({
  CANDIDATE_ONLY: 'candidate-only',
  PRODUCTION: 'production'
});

function clean(value) { return String(value == null ? '' : value).trim().toLowerCase(); }

function normalize(value) {
  const mode = clean(value) || EXECUTION_MODE.PRODUCTION;
  if (!Object.values(EXECUTION_MODE).includes(mode)) {
    throw Object.assign(new Error(`Unsupported AI execution mode: ${mode}`), {
      code: 'AI_EXECUTION_MODE_INVALID',
      status: 400,
      executionMode: mode
    });
  }
  return mode;
}

function policyFor(value) {
  const mode = normalize(value);
  if (mode === EXECUTION_MODE.CANDIDATE_ONLY) {
    return Object.freeze({
      authority: AUTHORITY,
      schemaVersion: SCHEMA_VERSION,
      mode,
      allowConditional: true,
      humanReviewRequired: true,
      deliveryEligible: false,
      learningEligible: false,
      formalReceiptEligible: false
    });
  }
  return Object.freeze({
    authority: AUTHORITY,
    schemaVersion: SCHEMA_VERSION,
    mode,
    allowConditional: false,
    humanReviewRequired: false,
    deliveryEligible: true,
    learningEligible: true,
    formalReceiptEligible: true
  });
}

module.exports = { AUTHORITY, SCHEMA_VERSION, EXECUTION_MODE, normalize, policyFor };
