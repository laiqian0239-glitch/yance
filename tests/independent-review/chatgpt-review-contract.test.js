'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  REVIEW_MARKER,
  extractReviewPayload,
  validateReviewPayload,
  evaluateReview,
} = require('../../tools/independent-review/review-contract');

const HEAD = '1234567890abcdef1234567890abcdef12345678';

function validPayload(overrides = {}) {
  return {
    protocolVersion: 1,
    reviewerMode: 'CHATGPT_GITHUB_CONNECTED_SESSION',
    reviewedHead: HEAD,
    decision: 'ALLOW_MERGE',
    p0Count: 0,
    p1Count: 0,
    temporaryBypassDetected: false,
    missingEvidence: [],
    blockers: [],
    residualRisks: [],
    summaryZh: '未发现 P0/P1，受审提交与当前 HEAD 一致。',
    ...overrides,
  };
}

function bodyFor(payload) {
  return `${REVIEW_MARKER}\n\n\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\``;
}

test('extracts exactly one marked JSON payload', () => {
  const payload = validPayload();
  assert.deepEqual(extractReviewPayload(bodyFor(payload)), payload);
});

test('rejects a review without the protocol marker', () => {
  assert.throws(
    () => extractReviewPayload('```json\n{}\n```'),
    /REVIEW_MARKER_MISSING/,
  );
});

test('rejects malformed or multiple marked JSON blocks', () => {
  assert.throws(
    () => extractReviewPayload(`${REVIEW_MARKER}\n\`\`\`json\n{broken}\n\`\`\``),
    /REVIEW_JSON_INVALID/,
  );
  assert.throws(
    () => extractReviewPayload(`${bodyFor(validPayload())}\n${bodyFor(validPayload())}`),
    /REVIEW_MARKER_MULTIPLE/,
  );
});

test('accepts only the exact schema and field types', () => {
  const accepted = validateReviewPayload(validPayload(), {
    currentHead: HEAD,
    reviewCommitId: HEAD,
  });
  assert.equal(accepted.valid, true);
  assert.deepEqual(accepted.errors, []);

  const unknown = validateReviewPayload(validPayload({ emergencyOverride: true }), {
    currentHead: HEAD,
    reviewCommitId: HEAD,
  });
  assert.equal(unknown.valid, false);
  assert.match(unknown.errors.join('\n'), /UNKNOWN_FIELD:emergencyOverride/);

  const wrongType = validateReviewPayload(validPayload({ p0Count: '0' }), {
    currentHead: HEAD,
    reviewCommitId: HEAD,
  });
  assert.equal(wrongType.valid, false);
  assert.match(wrongType.errors.join('\n'), /P0_COUNT_INVALID/);
});

test('rejects malformed, stale, or unbound commit identities', () => {
  const malformed = validateReviewPayload(validPayload({ reviewedHead: 'abc' }), {
    currentHead: HEAD,
    reviewCommitId: HEAD,
  });
  assert.match(malformed.errors.join('\n'), /REVIEWED_HEAD_INVALID/);

  const staleHead = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const stale = validateReviewPayload(validPayload({ reviewedHead: staleHead }), {
    currentHead: HEAD,
    reviewCommitId: staleHead,
  });
  assert.match(stale.errors.join('\n'), /REVIEWED_HEAD_MISMATCH/);

  const unbound = validateReviewPayload(validPayload(), {
    currentHead: HEAD,
    reviewCommitId: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  });
  assert.match(unbound.errors.join('\n'), /REVIEW_COMMIT_ID_MISMATCH/);
});

test('fails closed for every blocker condition', () => {
  const cases = [
    [validPayload({ decision: 'REQUEST_CHANGES' }), 'DECISION_NOT_ALLOW'],
    [validPayload({ p0Count: 1 }), 'P0_BLOCKERS_PRESENT'],
    [validPayload({ p1Count: 1 }), 'P1_BLOCKERS_PRESENT'],
    [validPayload({ temporaryBypassDetected: true }), 'TEMPORARY_BYPASS_DETECTED'],
    [validPayload({ missingEvidence: ['Windows UAT'] }), 'MISSING_EVIDENCE_PRESENT'],
    [validPayload({ blockers: [{ severity: 'P1', file: 'db.js', rootCause: '事务不原子', requiredFix: '重构公共事务层' }] }), 'BLOCKERS_PRESENT'],
  ];

  for (const [payload, expectedError] of cases) {
    const result = evaluateReview(payload, {
      currentHead: HEAD,
      reviewCommitId: HEAD,
    });
    assert.equal(result.passed, false);
    assert.match(result.errors.join('\n'), new RegExp(expectedError));
  }
});

test('passes only a complete ALLOW review bound to the current HEAD', () => {
  const result = evaluateReview(validPayload(), {
    currentHead: HEAD,
    reviewCommitId: HEAD,
  });
  assert.equal(result.passed, true);
  assert.deepEqual(result.errors, []);
});
