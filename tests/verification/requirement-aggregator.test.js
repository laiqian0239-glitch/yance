'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { aggregateRequirementSet } = require('../../shared/verification/requirementAggregator');
const { verifyEvidenceReceipt } = require('../../shared/verification/trustedEvidencePolicy');

const BASE = '1'.repeat(40);
const HEAD = '2'.repeat(40);
const LINUX_DIGEST = 'a'.repeat(64);
const WINDOWS_DIGEST = 'b'.repeat(64);

function fact(overrides = {}) {
  return {
    repository: 'laiqian0239-glitch/yance',
    workPackage: 'PVEP',
    gateId: 'pvep-linux-selftest',
    baseCommit: BASE,
    headCommit: HEAD,
    platform: 'linux',
    commandSetId: 'pvep-linux-selftest-v1',
    commandSetDigest: LINUX_DIGEST,
    verificationStatus: 'VERIFIED_PASS',
    adapterType: 'signed-executor-v1',
    receiptSha256: 'c'.repeat(64),
    producerIdentity: 'executor:linux:g1',
    ...overrides
  };
}

function requirements() {
  return [
    { gateId: 'pvep-linux-selftest', platform: 'linux', commandSetDigest: LINUX_DIGEST },
    { gateId: 'pvep-windows-selftest', platform: 'windows', commandSetDigest: WINDOWS_DIGEST }
  ];
}

test('complete Linux and Windows exact-SHA facts satisfy the requirement set', () => {
  const linux = fact();
  const windows = fact({
    gateId: 'pvep-windows-selftest',
    platform: 'windows',
    commandSetId: 'pvep-windows-selftest-v1',
    commandSetDigest: WINDOWS_DIGEST,
    receiptSha256: 'd'.repeat(64),
    producerIdentity: 'executor:windows:g1'
  });
  const result = aggregateRequirementSet({ requirements: requirements(), facts: [linux, windows], expectedBaseCommit: BASE, expectedHeadCommit: HEAD });
  assert.equal(result.pass, true);
  assert.equal(result.matchedFacts.length, 2);
});

test('missing, platform mismatch and command-set drift never satisfy a requirement', () => {
  const onlyLinux = aggregateRequirementSet({ requirements: requirements(), facts: [fact()], expectedBaseCommit: BASE, expectedHeadCommit: HEAD });
  assert.equal(onlyLinux.reasonCode, 'EVIDENCE_REQUIREMENT_SET_INCOMPLETE');

  const wrongPlatform = fact({ gateId: 'pvep-windows-selftest', commandSetDigest: WINDOWS_DIGEST, receiptSha256: '9'.repeat(64), producerIdentity: 'executor:wrong-platform' });
  assert.equal(aggregateRequirementSet({ requirements: requirements(), facts: [fact(), wrongPlatform], expectedBaseCommit: BASE, expectedHeadCommit: HEAD }).reasonCode, 'EVIDENCE_REQUIREMENT_SET_INCOMPLETE');

  const drift = fact({ gateId: 'pvep-windows-selftest', platform: 'windows', commandSetDigest: 'e'.repeat(64), commandSetId: 'pvep-windows-selftest-v1', receiptSha256: 'e'.repeat(64) });
  assert.equal(aggregateRequirementSet({ requirements: requirements(), facts: [fact(), drift], expectedBaseCommit: BASE, expectedHeadCommit: HEAD }).reasonCode, 'EVIDENCE_REQUIREMENT_SET_INCOMPLETE');
});

test('mixed Heads and duplicate receipt identities fail closed', () => {
  const windows = fact({ gateId: 'pvep-windows-selftest', platform: 'windows', commandSetDigest: WINDOWS_DIGEST, commandSetId: 'pvep-windows-selftest-v1', headCommit: '3'.repeat(40), receiptSha256: 'd'.repeat(64) });
  assert.equal(aggregateRequirementSet({ requirements: requirements(), facts: [fact(), windows], expectedBaseCommit: BASE, expectedHeadCommit: HEAD }).reasonCode, 'EVIDENCE_MIXED_HEADS');

  const duplicate = fact({ adapterType: 'github-actions-v1', producerIdentity: 'github:1' });
  assert.equal(aggregateRequirementSet({ requirements: [requirements()[0]], facts: [fact(), duplicate], expectedBaseCommit: BASE, expectedHeadCommit: HEAD }).reasonCode, 'EVIDENCE_TRUSTED_SOURCE_CONFLICT');
});

test('equivalent GitHub and signed facts are semantically interchangeable', () => {
  const signed = fact();
  const github = fact({ adapterType: 'github-actions-v1', receiptSha256: 'f'.repeat(64), producerIdentity: 'github-actions:98765:123456:attempt-2' });
  const result = aggregateRequirementSet({ requirements: [requirements()[0]], facts: [signed, github], expectedBaseCommit: BASE, expectedHeadCommit: HEAD });
  assert.equal(result.pass, true);
  assert.equal(result.matchedFacts.length, 2);
});

test('trusted-source disagreement fails instead of choosing the greener fact', () => {
  const passFact = fact();
  const failedFact = fact({ adapterType: 'github-actions-v1', receiptSha256: 'f'.repeat(64), producerIdentity: 'github:failed', verificationStatus: 'VERIFIED_FAIL' });
  assert.equal(aggregateRequirementSet({ requirements: [requirements()[0]], facts: [passFact, failedFact], expectedBaseCommit: BASE, expectedHeadCommit: HEAD }).reasonCode, 'EVIDENCE_TRUSTED_SOURCE_CONFLICT');
});

test('trusted adapter dispatch rejects unknown adapters and passes only bounded dependencies', async () => {
  const receipt = { adapterType: 'signed-executor-v1' };
  let call = null;
  const signedResult = await verifyEvidenceReceipt({
    receipt,
    expected: { headCommit: HEAD },
    registries: { executorRegistry: { schemaVersion: 1, executors: [] }, commandSetRegistry: {} },
    adapters: {
      signedExecutorVerifier: async (input) => { call = input; return { pass: true, fact: fact() }; }
    }
  });
  assert.equal(signedResult.pass, true);
  assert.equal(call.receipt, receipt);
  assert.equal(call.expected.headCommit, HEAD);

  const unknown = await verifyEvidenceReceipt({ receipt: { adapterType: 'local-trust-me-v1' }, expected: {}, registries: {}, adapters: {} });
  assert.equal(unknown.reasonCode, 'EVIDENCE_ADAPTER_UNTRUSTED');
});
