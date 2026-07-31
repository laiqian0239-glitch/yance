'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validate } = require('../../tools/protocol/validate-v3-protocols');

test('six Yance V3 protocols are present and fail closed', () => {
  const result = validate();
  assert.equal(result.ok, true);
  assert.equal(result.schemaVersion, 3);
  assert.equal(result.files.length, 6);
});

test('V3 protocols forbid self-approval, truncated evidence and unverified promotion', () => {
  const policy = require('../../YANCE_TOOL_PERMISSION_POLICY.json');
  const evidence = require('../../YANCE_EVIDENCE_MANIFEST.json');
  const agent = require('../../YANCE_AGENT_CAPABILITY_MANIFEST.json');
  assert.equal(policy.roleSeparation.selfApprovalForbidden, true);
  assert.equal(policy.levels.L3.explicitAuthorizationRequired, true);
  assert.equal(evidence.promotionState, 'BLOCKED');
  assert.equal(evidence.acceptancePolicy.truncated, false);
  assert.equal(agent.capabilities.independentReleaseApproval, false);
});
