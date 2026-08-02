'use strict';

const REVIEW_MARKER = '<!-- YANCE_INDEPENDENT_REVIEW_V1 -->';
const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const DECISIONS = new Set(['ALLOW_MERGE', 'REQUEST_CHANGES']);
const REVIEWER_MODES = new Set(['CHATGPT_GITHUB_CONNECTED_SESSION']);
const EXACT_FIELDS = Object.freeze([
  'protocolVersion',
  'reviewerMode',
  'reviewedHead',
  'decision',
  'p0Count',
  'p1Count',
  'temporaryBypassDetected',
  'missingEvidence',
  'blockers',
  'residualRisks',
  'summaryZh'
]);

function contractError(code, details = {}) {
  const error = new Error(code);
  error.code = code;
  error.details = details;
  return error;
}

function extractReviewPayload(body) {
  const text = String(body || '');
  const markerCount = text.split(REVIEW_MARKER).length - 1;
  if (markerCount === 0) throw contractError('REVIEW_MARKER_MISSING');
  if (markerCount !== 1) throw contractError('REVIEW_MARKER_MULTIPLE');

  const markerIndex = text.indexOf(REVIEW_MARKER);
  const afterMarker = text.slice(markerIndex + REVIEW_MARKER.length);
  const blocks = [...afterMarker.matchAll(/```json\s*\n([\s\S]*?)\n```/gu)];
  if (blocks.length !== 1) {
    throw contractError(blocks.length === 0 ? 'REVIEW_JSON_BLOCK_MISSING' : 'REVIEW_JSON_BLOCK_MULTIPLE');
  }
  try {
    return JSON.parse(blocks[0][1]);
  } catch (cause) {
    throw contractError('REVIEW_JSON_INVALID', { cause: cause?.message || String(cause) });
  }
}

function isStringArray(value) {
  return Array.isArray(value) && value.every(item => typeof item === 'string' && item.trim().length > 0);
}

function isBlockerArray(value) {
  if (!Array.isArray(value)) return false;
  return value.every(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
    const keys = Object.keys(item).sort();
    const expected = ['file', 'requiredFix', 'rootCause', 'severity'];
    if (keys.length !== expected.length || !keys.every((key, index) => key === expected[index])) return false;
    return ['P0', 'P1'].includes(item.severity)
      && typeof item.file === 'string' && item.file.trim().length > 0
      && typeof item.rootCause === 'string' && item.rootCause.trim().length > 0
      && typeof item.requiredFix === 'string' && item.requiredFix.trim().length > 0;
  });
}

function validateReviewPayload(payload, context = {}) {
  const errors = [];
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return Object.freeze({ valid: false, errors: ['REVIEW_PAYLOAD_INVALID'] });
  }

  const keys = Object.keys(payload);
  for (const key of keys) {
    if (!EXACT_FIELDS.includes(key)) errors.push(`UNKNOWN_FIELD:${key}`);
  }
  for (const field of EXACT_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(payload, field)) errors.push(`MISSING_FIELD:${field}`);
  }

  if (payload.protocolVersion !== 1) errors.push('PROTOCOL_VERSION_INVALID');
  if (!REVIEWER_MODES.has(payload.reviewerMode)) errors.push('REVIEWER_MODE_INVALID');
  if (!SHA_PATTERN.test(String(payload.reviewedHead || ''))) errors.push('REVIEWED_HEAD_INVALID');
  if (!DECISIONS.has(payload.decision)) errors.push('DECISION_INVALID');
  if (!Number.isSafeInteger(payload.p0Count) || payload.p0Count < 0) errors.push('P0_COUNT_INVALID');
  if (!Number.isSafeInteger(payload.p1Count) || payload.p1Count < 0) errors.push('P1_COUNT_INVALID');
  if (typeof payload.temporaryBypassDetected !== 'boolean') errors.push('TEMPORARY_BYPASS_FLAG_INVALID');
  if (!isStringArray(payload.missingEvidence)) errors.push('MISSING_EVIDENCE_INVALID');
  if (!isBlockerArray(payload.blockers)) errors.push('BLOCKERS_INVALID');
  if (!isStringArray(payload.residualRisks)) errors.push('RESIDUAL_RISKS_INVALID');
  if (typeof payload.summaryZh !== 'string' || payload.summaryZh.trim().length === 0) errors.push('SUMMARY_ZH_INVALID');

  const currentHead = String(context.currentHead || '');
  const reviewCommitId = String(context.reviewCommitId || '');
  if (!SHA_PATTERN.test(currentHead)) errors.push('CURRENT_HEAD_INVALID');
  if (!SHA_PATTERN.test(reviewCommitId)) errors.push('REVIEW_COMMIT_ID_INVALID');
  if (SHA_PATTERN.test(String(payload.reviewedHead || '')) && SHA_PATTERN.test(currentHead) && payload.reviewedHead !== currentHead) {
    errors.push('REVIEWED_HEAD_MISMATCH');
  }
  if (SHA_PATTERN.test(reviewCommitId) && SHA_PATTERN.test(currentHead) && reviewCommitId !== currentHead) {
    errors.push('REVIEW_COMMIT_ID_MISMATCH');
  }

  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}

function evaluateReview(payload, context = {}) {
  const validation = validateReviewPayload(payload, context);
  const errors = [...validation.errors];
  if (validation.valid) {
    if (payload.decision !== 'ALLOW_MERGE') errors.push('DECISION_NOT_ALLOW');
    if (payload.p0Count > 0) errors.push('P0_BLOCKERS_PRESENT');
    if (payload.p1Count > 0) errors.push('P1_BLOCKERS_PRESENT');
    if (payload.temporaryBypassDetected === true) errors.push('TEMPORARY_BYPASS_DETECTED');
    if (payload.missingEvidence.length > 0) errors.push('MISSING_EVIDENCE_PRESENT');
    if (payload.blockers.length > 0) errors.push('BLOCKERS_PRESENT');
  }
  return Object.freeze({
    passed: errors.length === 0,
    errors: Object.freeze(errors),
    reviewedHead: payload?.reviewedHead || null,
    decision: payload?.decision || null,
    readyForPromotion: false
  });
}

module.exports = {
  DECISIONS,
  EXACT_FIELDS,
  REVIEWER_MODES,
  REVIEW_MARKER,
  evaluateReview,
  extractReviewPayload,
  validateReviewPayload
};
