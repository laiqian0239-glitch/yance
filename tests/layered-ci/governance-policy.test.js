'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  classifyChangedFiles,
  validateLifecyclePolicy,
  validateRiskPolicy,
  validateTransition
} = require('../../tools/layered-ci/governance-policy');

const ROOT = path.resolve(__dirname, '..', '..');
const lifecycle = JSON.parse(fs.readFileSync(path.join(ROOT, 'governance/layered-ci/task-lifecycle.json'), 'utf8'));
const risk = JSON.parse(fs.readFileSync(path.join(ROOT, 'governance/layered-ci/risk-policy.json'), 'utf8'));

test('lifecycle policy is structurally valid and keeps provisional green open', () => {
  assert.equal(validateLifecyclePolicy(lifecycle).pass, true);
  assert.equal(lifecycle.greenProvisionalIsClosed, false);
  assert.equal(lifecycle.independentReviewBeforeClosed, true);
  assert.equal(lifecycle.readyForPromotion, false);
});

test('direct GREEN_PROVISIONAL to CLOSED transition is forbidden', () => {
  const result = validateTransition(lifecycle, 'GREEN_PROVISIONAL', 'CLOSED', {
    independentReviewPassed: true,
    l2EvidencePassed: true,
    candidateShaFrozen: true
  });
  assert.equal(result.pass, false);
  assert.equal(result.reasonCode, 'TASK_TRANSITION_NOT_ALLOWED');
});

test('INDEPENDENT_REVIEW to CLOSED requires frozen candidate, review and L2 evidence', () => {
  const denied = validateTransition(lifecycle, 'INDEPENDENT_REVIEW', 'CLOSED', {
    candidateShaFrozen: true,
    independentReviewPassed: true,
    l2EvidencePassed: false
  });
  assert.equal(denied.pass, false);
  assert.equal(denied.reasonCode, 'TASK_TRANSITION_REQUIREMENT_MISSING');
  assert.deepEqual(denied.missingRequirements, ['l2EvidencePassed']);

  const accepted = validateTransition(lifecycle, 'INDEPENDENT_REVIEW', 'CLOSED', {
    candidateShaFrozen: true,
    independentReviewPassed: true,
    l2EvidencePassed: true
  });
  assert.equal(accepted.pass, true);
  assert.equal(accepted.nextState, 'CLOSED');
});

test('closed task only reopens when original evidence is invalid', () => {
  const denied = validateTransition(lifecycle, 'CLOSED', 'REOPENED_INVALID_EVIDENCE', {
    reopenReasonAuthorized: true,
    reopenReasonCode: 'NEW_ATTACK_SURFACE'
  });
  assert.equal(denied.pass, false);
  assert.equal(denied.reasonCode, 'TASK_REOPEN_REASON_INVALID');

  const accepted = validateTransition(lifecycle, 'CLOSED', 'REOPENED_INVALID_EVIDENCE', {
    reopenReasonAuthorized: true,
    reopenReasonCode: 'VERIFIED_SHA_MISMATCH'
  });
  assert.equal(accepted.pass, true);
});

test('risk policy is strict and rejects wildcard escalation rules', () => {
  assert.equal(validateRiskPolicy(risk).pass, true);
  const invalid = validateRiskPolicy({
    ...risk,
    l2Prefixes: [...risk.l2Prefixes, 'backend/**']
  });
  assert.equal(invalid.pass, false);
  assert.equal(invalid.reasonCode, 'CI_RISK_RULE_INVALID');
});

test('documentation-only changes stay at L0', () => {
  const result = classifyChangedFiles(risk, [
    'docs/architecture/new-governance.md',
    'README.md'
  ]);
  assert.equal(result.pass, true);
  assert.equal(result.requiredLevel, 'L0');
});

test('README-like executable names are not treated as documentation', () => {
  const result = classifyChangedFiles(risk, ['README-run.js']);
  assert.equal(result.pass, false);
  assert.equal(result.reasonCode, 'CI_UNKNOWN_PATH');
});

test('ordinary product or test code uses L1', () => {
  const result = classifyChangedFiles(risk, [
    'frontend/components/ConversationHeader.jsx',
    'tests/uat/conversation-header.test.js'
  ]);
  assert.equal(result.pass, true);
  assert.equal(result.requiredLevel, 'L1');
});

test('runtime, SQLite, workflows, WP0 and package changes escalate to L2', () => {
  for (const file of [
    'backend/runtime/AppRuntime.js',
    'backend/lib/sqliteOwnership.js',
    '.github/workflows/release.yml',
    'tools/wp0/verify-gate.js',
    'shared/release/implementationBranchPolicy.js',
    'package-lock.json',
    'governance/layered-ci/risk-policy.json'
  ]) {
    const result = classifyChangedFiles(risk, [file]);
    assert.equal(result.pass, true, file);
    assert.equal(result.requiredLevel, 'L2', file);
  }
});

test('L3 is never selected automatically', () => {
  const result = classifyChangedFiles(risk, ['electron/main.js']);
  assert.equal(result.requiredLevel, 'L2');
  assert.equal(result.promotionRequired, false);
});

test('invalid repository paths fail closed', () => {
  const result = classifyChangedFiles(risk, ['../escape.js']);
  assert.equal(result.pass, false);
  assert.equal(result.reasonCode, 'CI_CHANGED_PATH_INVALID');
});

test('syntactically valid but unclassified paths fail closed', () => {
  const result = classifyChangedFiles(risk, ['unclassified/new-gate.js']);
  assert.equal(result.pass, false);
  assert.equal(result.reasonCode, 'CI_UNKNOWN_PATH');
  assert.deepEqual(result.unknownPaths, ['unclassified/new-gate.js']);
});
