'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const modeAuthority = require('../services/aiExecutionModeAuthority');
const traceAuthority = require('../services/aiExecutionTraceAuthority');

test('execution mode defaults fail-closed to production', () => {
  const policy = modeAuthority.policyFor();
  assert.equal(policy.mode, modeAuthority.EXECUTION_MODE.PRODUCTION);
  assert.equal(policy.allowConditional, false);
  assert.equal(policy.humanReviewRequired, false);
  assert.equal(policy.deliveryEligible, true);
  assert.equal(policy.learningEligible, true);
  assert.equal(policy.formalReceiptEligible, true);
});

test('candidate-only mode enforces human review and forbids delivery learning and formal receipts', () => {
  const policy = modeAuthority.policyFor('candidate-only');
  assert.equal(policy.mode, modeAuthority.EXECUTION_MODE.CANDIDATE_ONLY);
  assert.equal(policy.allowConditional, true);
  assert.equal(policy.humanReviewRequired, true);
  assert.equal(policy.deliveryEligible, false);
  assert.equal(policy.learningEligible, false);
  assert.equal(policy.formalReceiptEligible, false);
});

test('unknown execution mode is rejected instead of silently downgraded', () => {
  assert.throws(
    () => modeAuthority.policyFor('temporary-bypass'),
    error => error?.code === 'AI_EXECUTION_MODE_INVALID'
  );
});

test('route trace keeps one id across boundaries and redacts message content', () => {
  traceAuthority.clearForTests();
  const trace = traceAuthority.start({ task: 'quick_reply', executionMode: 'candidate-only', routeTestId: 'route-test-fixed', messages: [{ role: 'user', content: 'SECRET MESSAGE' }] });
  traceAuthority.record(trace.routeTestId, 'route-draft-validated', {
    requestedMode: 'auto', resolvedPrimary: 'cloud-a', allowConditional: true, apiKey: 'SECRET KEY'
  });
  traceAuthority.complete(trace.routeTestId, { modelId: 'cloud-a', providerRequestId: 'gen-123', preview: 'SECRET OUTPUT' });
  const stored = traceAuthority.get(trace.routeTestId);
  assert.equal(stored.routeTestId, 'route-test-fixed');
  assert.equal(stored.status, 'completed');
  assert.deepEqual(stored.stages.map(row => row.stage), ['route-test-started', 'route-draft-validated', 'route-test-completed']);
  const serialized = JSON.stringify(stored);
  assert.doesNotMatch(serialized, /SECRET MESSAGE|SECRET KEY|SECRET OUTPUT/);
  assert.match(serialized, /cloud-a|gen-123/);
});
