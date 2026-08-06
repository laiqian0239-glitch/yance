'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { REASON_CODES } = require('../../shared/verification/reasonCodes');
const { verifySignedExecutorReceipt } = require('../../shared/verification/signedExecutorVerifier');
const { verifyEvidenceReceipt } = require('../../shared/verification/trustedEvidencePolicy');
const { aggregateRequirementSet } = require('../../shared/verification/requirementAggregator');
const { computeReceiptSha256 } = require('../../shared/verification/canonicalEvidenceReceipt');
const { commandSetDigest } = require('../../shared/verification/commandSetRegistry');
const { createContext, BASE, HEAD } = require('./fixtures/receiptFactory');

const APPROVED_CODES = Object.freeze([
  'EVIDENCE_SCHEMA_INVALID',
  'EVIDENCE_REPOSITORY_MISMATCH',
  'EVIDENCE_BASE_MISMATCH',
  'EVIDENCE_HEAD_MISMATCH',
  'EVIDENCE_CANONICAL_DIGEST_MISMATCH',
  'EVIDENCE_RECEIPT_DIGEST_MISMATCH',
  'EVIDENCE_ADAPTER_UNTRUSTED',
  'EVIDENCE_EXECUTOR_UNKNOWN',
  'EVIDENCE_EXECUTOR_REVOKED',
  'EVIDENCE_KEY_GENERATION_INVALID',
  'EVIDENCE_SIGNATURE_INVALID',
  'EVIDENCE_SIGNER_ISOLATION_INVALID',
  'EVIDENCE_PLATFORM_MISMATCH',
  'EVIDENCE_COMMAND_SET_UNKNOWN',
  'EVIDENCE_COMMAND_SET_DIGEST_MISMATCH',
  'EVIDENCE_COMMAND_MISSING',
  'EVIDENCE_COMMAND_UNEXPECTED',
  'EVIDENCE_COMMAND_FAILED',
  'EVIDENCE_WORKSPACE_DIRTY',
  'EVIDENCE_ARTIFACT_DIGEST_MISMATCH',
  'EVIDENCE_GITHUB_API_IDENTITY_INVALID',
  'EVIDENCE_REQUIREMENT_SET_INCOMPLETE',
  'EVIDENCE_MIXED_HEADS',
  'EVIDENCE_TRUSTED_SOURCE_CONFLICT'
]);

function verify(context, overrides = {}) {
  return verifySignedExecutorReceipt({
    receipt: context.receipt,
    expected: context.expected,
    executorRegistry: context.executorRegistry,
    commandSetRegistry: context.commandSetRegistry,
    artifactResolver: () => context.artifactBytes,
    ...overrides
  });
}

function normalizedFact(overrides = {}) {
  return {
    repository: 'laiqian0239-glitch/yance', workPackage: 'PVEP', gateId: 'pvep-linux-selftest',
    baseCommit: BASE, headCommit: HEAD, platform: 'linux', commandSetId: 'pvep-linux-selftest-v1',
    commandSetDigest: 'a'.repeat(64), verificationStatus: 'VERIFIED_PASS', adapterType: 'signed-executor-v1',
    receiptSha256: 'b'.repeat(64), producerIdentity: 'executor:g1', ...overrides
  };
}

test('approved fail-closed reason-code vocabulary is present', () => {
  for (const code of APPROVED_CODES) assert.equal(REASON_CODES[code], code, code);
});

test('repository/base/head/adapter/executor/generation/signature/platform mutations fail specifically', async () => {
  const repository = createContext(); repository.receipt.repository = 'other/repo'; repository.reseal();
  assert.equal(verify(repository).reasonCode, 'EVIDENCE_REPOSITORY_MISMATCH');

  const base = createContext(); base.receipt.baseCommit = '3'.repeat(40); base.reseal();
  assert.equal(verify(base).reasonCode, 'EVIDENCE_BASE_MISMATCH');

  const head = createContext(); head.receipt.headCommit = '4'.repeat(40); head.receipt.workspace.preHead = head.receipt.headCommit; head.receipt.workspace.postHead = head.receipt.headCommit; head.reseal();
  assert.equal(verify(head).reasonCode, 'EVIDENCE_HEAD_MISMATCH');

  assert.equal((await verifyEvidenceReceipt({ receipt: { adapterType: 'trust-me-v1' }, expected: {}, registries: {}, adapters: {} })).reasonCode, 'EVIDENCE_ADAPTER_UNTRUSTED');

  const executor = createContext(); executor.receipt.producer.executorId = 'other-executor'; executor.reseal();
  assert.equal(verify(executor).reasonCode, 'EVIDENCE_EXECUTOR_UNKNOWN');

  const generation = createContext(); generation.receipt.producer.keyGeneration = 2; generation.reseal();
  assert.equal(verify(generation).reasonCode, 'EVIDENCE_KEY_GENERATION_INVALID');

  const signature = createContext(); signature.receipt.authenticity.signatureBase64 = Buffer.alloc(64, 9).toString('base64'); signature.receipt.receiptSha256 = computeReceiptSha256(signature.receipt);
  assert.equal(verify(signature).reasonCode, 'EVIDENCE_SIGNATURE_INVALID');

  const platform = createContext(); platform.receipt.producer.platform = 'windows'; platform.receipt.commandSet.platform = 'windows'; platform.reseal();
  assert.equal(verify(platform).reasonCode, 'EVIDENCE_PLATFORM_MISMATCH');
});

test('command-set drift, missing/unexpected commands and failed exits cannot be promoted', () => {
  const unknown = createContext();
  unknown.commandSetRegistry = {};
  assert.equal(verify(unknown).reasonCode, 'EVIDENCE_COMMAND_SET_UNKNOWN');

  const drift = createContext(); drift.receipt.commandSet.commandSetDigest = 'f'.repeat(64); drift.reseal();
  assert.equal(verify(drift).reasonCode, 'EVIDENCE_COMMAND_SET_DIGEST_MISMATCH');

  const missing = createContext();
  const second = { commandId: 'second-check', executable: 'node', argv: ['tests/verification/jcs.test.js'], expectedExitCode: 0, generatedRoots: ['.pvep-output'], artifacts: [] };
  missing.commandSet.commands.push(second);
  const newDigest = commandSetDigest(missing.commandSet);
  missing.receipt.commandSet.commandSetDigest = newDigest;
  missing.executorRegistry.executors[0].allowedCommandSetDigests = [newDigest];
  missing.commandSetRegistry[missing.commandSet.commandSetId] = missing.commandSet;
  missing.reseal();
  assert.equal(verify(missing).reasonCode, 'EVIDENCE_COMMAND_MISSING');

  const unexpected = createContext();
  unexpected.receipt.execution.commands.push({ ...structuredClone(unexpected.receipt.execution.commands[0]), commandId: 'unexpected-check' });
  unexpected.receipt.results.push({ commandId: 'unexpected-check', passed: true });
  unexpected.reseal();
  assert.equal(verify(unexpected).reasonCode, 'EVIDENCE_COMMAND_UNEXPECTED');

  const failed = createContext(); failed.receipt.execution.commands[0].exitCode = 1; failed.receipt.results[0].passed = false; failed.reseal();
  assert.equal(verify(failed).reasonCode, 'EVIDENCE_COMMAND_FAILED');
});

test('unsigned field tampering, workspace and artifact mutations are independently caught', () => {
  const stdout = createContext(); stdout.receipt.execution.commands[0].stdoutSha256 = 'f'.repeat(64);
  assert.equal(verify(stdout).reasonCode, 'EVIDENCE_CANONICAL_DIGEST_MISMATCH');

  const stderr = createContext(); stderr.receipt.execution.commands[0].stderrSha256 = 'f'.repeat(64);
  assert.equal(verify(stderr).reasonCode, 'EVIDENCE_CANONICAL_DIGEST_MISMATCH');

  const workspace = createContext(); workspace.receipt.workspace.postTrackedDiffSha256 = 'f'.repeat(64); workspace.reseal();
  assert.equal(verify(workspace).reasonCode, 'EVIDENCE_WORKSPACE_DIRTY');

  const artifact = createContext(); artifact.receipt.artifacts[0].sha256 = 'f'.repeat(64); artifact.reseal();
  assert.equal(verify(artifact).reasonCode, 'EVIDENCE_ARTIFACT_DIGEST_MISMATCH');

  const canonical = createContext(); canonical.receipt.canonicalPayloadSha256 = 'f'.repeat(64); canonical.receipt.receiptSha256 = computeReceiptSha256(canonical.receipt);
  assert.equal(verify(canonical).reasonCode, 'EVIDENCE_CANONICAL_DIGEST_MISMATCH');

  const full = createContext(); full.receipt.receiptSha256 = 'f'.repeat(64);
  assert.equal(verify(full).reasonCode, 'EVIDENCE_RECEIPT_DIGEST_MISMATCH');
});

test('duplicate identity, mixed Head and trusted-source conflicts fail aggregation', () => {
  const requirement = [{ gateId: 'pvep-linux-selftest', platform: 'linux', commandSetDigest: 'a'.repeat(64) }];
  const one = normalizedFact();
  const duplicate = normalizedFact({ adapterType: 'github-actions-v1', producerIdentity: 'github:1' });
  assert.equal(aggregateRequirementSet({ requirements: requirement, facts: [one, duplicate], expectedBaseCommit: BASE, expectedHeadCommit: HEAD }).reasonCode, 'EVIDENCE_TRUSTED_SOURCE_CONFLICT');

  const mixed = normalizedFact({ headCommit: '4'.repeat(40), receiptSha256: 'c'.repeat(64) });
  assert.equal(aggregateRequirementSet({ requirements: requirement, facts: [one, mixed], expectedBaseCommit: BASE, expectedHeadCommit: HEAD }).reasonCode, 'EVIDENCE_MIXED_HEADS');

  const conflict = normalizedFact({ verificationStatus: 'VERIFIED_FAIL', adapterType: 'github-actions-v1', receiptSha256: 'd'.repeat(64), producerIdentity: 'github:failed' });
  assert.equal(aggregateRequirementSet({ requirements: requirement, facts: [one, conflict], expectedBaseCommit: BASE, expectedHeadCommit: HEAD }).reasonCode, 'EVIDENCE_TRUSTED_SOURCE_CONFLICT');
});

test('offline CLIs expose no private-key, registry override or success-override flags', () => {
  const verifyReceipt = require('../../tools/verification/verify-receipt');
  const verifySet = require('../../tools/verification/verify-requirement-set');
  for (const args of [
    ['--receipt', 'r.json', '--expected-base', BASE, '--expected-head', HEAD, '--registry', 'other.json'],
    ['--receipt', 'r.json', '--expected-base', BASE, '--expected-head', HEAD, '--private-key', 'key.pem'],
    ['--receipt', 'r.json', '--expected-base', BASE, '--expected-head', HEAD, '--success', 'true']
  ]) assert.throws(() => verifyReceipt.parse(args), /EVIDENCE_CLI_ARGUMENT_INVALID/u);
  assert.throws(() => verifySet.parse(['--manifest', 'm.json', '--receipts', 'out', '--expected-base', BASE, '--expected-head', HEAD, '--registry', 'other.json']), /EVIDENCE_CLI_ARGUMENT_INVALID/u);
});


test('self-test requirement manifest is exactly bound to checked-in command-set digests', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const { validateRequirementManifest } = require('../../tools/verification/verify-requirement-set');
  const repoRoot = path.resolve(__dirname, '..', '..');
  const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'governance/verification/requirements/pvep-selftest-v1.json'), 'utf8'));
  const valid = validateRequirementManifest({ manifest, repoRoot });
  assert.equal(valid.pass, true);
  assert.equal(valid.requirements.length, 2);
  const tampered = structuredClone(manifest);
  tampered.requirements[0].commandSetDigest = 'f'.repeat(64);
  assert.equal(validateRequirementManifest({ manifest: tampered, repoRoot }).reasonCode, 'EVIDENCE_COMMAND_SET_DIGEST_MISMATCH');
});
