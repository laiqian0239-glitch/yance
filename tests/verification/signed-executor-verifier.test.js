'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { verifySignedExecutorReceipt } = require('../../shared/verification/signedExecutorVerifier');
const { createContext } = require('./fixtures/receiptFactory');

function verify(context, receipt = context.receipt, extra = {}) {
  return verifySignedExecutorReceipt({ receipt, expected: context.expected, executorRegistry: context.executorRegistry, commandSetRegistry: context.commandSetRegistry, ...extra });
}

test('valid detached Ed25519 receipt produces a normalized VERIFIED_PASS fact', () => {
  const context = createContext();
  const result = verify(context, context.receipt, { artifactResolver: () => context.artifactBytes });
  assert.equal(result.pass, true);
  assert.deepEqual(Object.keys(result.fact).sort(), ['adapterType', 'baseCommit', 'commandSetDigest', 'commandSetId', 'gateId', 'headCommit', 'platform', 'producerIdentity', 'receiptSha256', 'repository', 'verificationStatus', 'workPackage'].sort());
  assert.equal(result.fact.verificationStatus, 'VERIFIED_PASS');
});

test('signature, command result and exact identity mutations fail closed', () => {
  const signature = createContext();
  signature.receipt.authenticity.signatureBase64 = Buffer.alloc(64, 3).toString('base64');
  signature.receipt.receiptSha256 = require('../../shared/verification/canonicalEvidenceReceipt').computeReceiptSha256(signature.receipt);
  assert.equal(verify(signature).reasonCode, 'EVIDENCE_SIGNATURE_INVALID');

  const exit = createContext();
  exit.receipt.execution.commands[0].exitCode = 1;
  exit.receipt.results[0].passed = false;
  exit.reseal();
  assert.equal(verify(exit).reasonCode, 'EVIDENCE_COMMAND_FAILED');

  const argv = createContext();
  argv.receipt.execution.commands[0].argvDigest = 'f'.repeat(64);
  argv.reseal();
  assert.equal(verify(argv).reasonCode, 'EVIDENCE_COMMAND_RESULT_MISMATCH');

  const base = createContext();
  base.receipt.baseCommit = '3'.repeat(40);
  base.reseal();
  assert.equal(verify(base).reasonCode, 'EVIDENCE_BASE_MISMATCH');

  const head = createContext();
  head.receipt.headCommit = '4'.repeat(40);
  head.receipt.workspace.preHead = head.receipt.headCommit;
  head.receipt.workspace.postHead = head.receipt.headCommit;
  head.reseal();
  assert.equal(verify(head).reasonCode, 'EVIDENCE_HEAD_MISMATCH');
});

test('executor identity, platform, generation and artifact bytes are independently verified', () => {
  const platform = createContext();
  platform.receipt.producer.platform = 'windows';
  platform.receipt.commandSet.platform = 'windows';
  platform.reseal();
  assert.equal(verify(platform).reasonCode, 'EVIDENCE_PLATFORM_MISMATCH');

  const generation = createContext();
  generation.receipt.producer.keyGeneration = 2;
  generation.reseal();
  assert.equal(verify(generation).reasonCode, 'EVIDENCE_EXECUTOR_GENERATION_MISMATCH');

  const executor = createContext();
  executor.receipt.producer.executorId = 'other-executor';
  executor.reseal();
  assert.equal(verify(executor).reasonCode, 'EVIDENCE_EXECUTOR_UNKNOWN');

  const artifact = createContext();
  assert.equal(verify(artifact, artifact.receipt, { artifactResolver: () => Buffer.from('tampered') }).reasonCode, 'EVIDENCE_ARTIFACT_DIGEST_MISMATCH');
});

test('workspace cleanliness, generated roots, architecture and executor activation are policy facts', () => {
  const tracked = createContext();
  tracked.receipt.workspace.preTrackedDiffSha256 = 'f'.repeat(64);
  tracked.reseal();
  assert.equal(verify(tracked).reasonCode, 'EVIDENCE_WORKSPACE_DIRTY');

  const untracked = createContext();
  untracked.receipt.workspace.postUnexpectedUntrackedPathSetSha256 = 'e'.repeat(64);
  untracked.reseal();
  assert.equal(verify(untracked).reasonCode, 'EVIDENCE_UNEXPECTED_UNTRACKED_PATHS');

  const roots = createContext();
  roots.receipt.workspace.allowedGeneratedRootSetSha256 = 'd'.repeat(64);
  roots.reseal();
  assert.equal(verify(roots).reasonCode, 'EVIDENCE_WORKSPACE_DIRTY');

  const architecture = createContext();
  architecture.receipt.producer.architecture = 'arm64';
  architecture.reseal();
  assert.equal(verify(architecture).reasonCode, 'EVIDENCE_EXECUTOR_ARCHITECTURE_MISMATCH');

  const future = createContext();
  future.executorRegistry.executors[0].validFrom = '2026-08-08T00:00:00.000Z';
  assert.equal(verify(future).reasonCode, 'EVIDENCE_EXECUTOR_NOT_YET_VALID');

  const undeclaredArtifact = createContext();
  undeclaredArtifact.receipt.artifacts[0].relativePath = '.pvep-output/other.json';
  undeclaredArtifact.reseal();
  assert.equal(verify(undeclaredArtifact).reasonCode, 'EVIDENCE_ARTIFACT_DIGEST_MISMATCH');
});
