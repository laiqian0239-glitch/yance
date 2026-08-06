'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validateUnsignedCandidate,
  validateFinalReceipt,
  canonicalPayloadBytes,
  computeCanonicalPayloadSha256,
  computeReceiptSha256,
  verifyReceiptDigests
} = require('../../shared/verification/canonicalEvidenceReceipt');

const SHA_A = '1'.repeat(40);
const SHA_B = '2'.repeat(40);
const HASH = 'a'.repeat(64);

function baseReceipt() {
  const receipt = {
    schemaVersion: 1,
    recordType: 'YANCE_PORTABLE_VERIFICATION_EVIDENCE_RECEIPT',
    repository: 'laiqian0239-glitch/yance',
    workPackage: 'PVEP',
    gateId: 'pvep-linux-selftest',
    baseCommit: SHA_A,
    headCommit: SHA_B,
    adapterType: 'signed-executor-v1',
    producer: {
      executorId: 'linux-executor-01',
      platform: 'linux',
      architecture: 'x64',
      nodeVersion: '22.16.0',
      npmVersion: '10.9.2',
      keyGeneration: 1
    },
    commandSet: {
      commandSetId: 'pvep-linux-selftest-v1',
      commandSetDigest: HASH,
      platform: 'linux'
    },
    execution: {
      startedAt: '2026-08-07T00:00:00.000Z',
      completedAt: '2026-08-07T00:00:01.000Z',
      commands: [{
        commandId: 'pvep-required-tests',
        argvDigest: HASH,
        exitCode: 0,
        startedAt: '2026-08-07T00:00:00.000Z',
        completedAt: '2026-08-07T00:00:01.000Z',
        stdoutSha256: HASH,
        stderrSha256: HASH
      }]
    },
    workspace: {
      preHead: SHA_B,
      postHead: SHA_B,
      preTrackedDiffSha256: HASH,
      postTrackedDiffSha256: HASH,
      preUnexpectedUntrackedPathSetSha256: HASH,
      postUnexpectedUntrackedPathSetSha256: HASH,
      allowedGeneratedRootSetSha256: HASH
    },
    results: [{ commandId: 'pvep-required-tests', passed: true }],
    artifacts: [{
      artifactId: 'report',
      relativePath: '.pvep-output/report.json',
      sha256: HASH,
      sizeBytes: 12,
      mediaType: 'application/json',
      producerCommandId: 'pvep-required-tests'
    }],
    canonicalPayloadSha256: null,
    authenticity: {
      scheme: 'ed25519',
      executorId: 'linux-executor-01',
      keyGeneration: 1,
      signatureBase64: Buffer.alloc(64, 7).toString('base64')
    },
    receiptSha256: null
  };
  receipt.canonicalPayloadSha256 = computeCanonicalPayloadSha256(receipt);
  receipt.receiptSha256 = computeReceiptSha256(receipt);
  return receipt;
}

test('valid final receipt has separate payload and full receipt digests', () => {
  const receipt = baseReceipt();
  assert.equal(validateFinalReceipt(receipt).pass, true);
  assert.equal(computeCanonicalPayloadSha256(receipt), receipt.canonicalPayloadSha256);
  assert.equal(computeReceiptSha256(receipt), receipt.receiptSha256);
  assert.notEqual(receipt.canonicalPayloadSha256, receipt.receiptSha256);
  assert.ok(Buffer.isBuffer(canonicalPayloadBytes(receipt)));
});

test('unknown fields and unsigned candidates fail closed at final verification', () => {
  const receipt = baseReceipt();
  const unknown = structuredClone(receipt);
  unknown.unrecognized = true;
  assert.equal(validateFinalReceipt(unknown).reasonCode, 'EVIDENCE_SCHEMA_INVALID');

  const pending = structuredClone(receipt);
  pending.authenticity = null;
  pending.receiptSha256 = null;
  assert.equal(validateUnsignedCandidate(pending).pass, true);
  assert.equal(validateFinalReceipt(pending).pass, false);
});

test('tampering payload or receipt authenticity breaks the correct digest', () => {
  const payloadTampered = baseReceipt();
  payloadTampered.headCommit = 'f'.repeat(40);
  assert.equal(verifyReceiptDigests(payloadTampered).reasonCode, 'EVIDENCE_CANONICAL_DIGEST_MISMATCH');

  const authenticityTampered = baseReceipt();
  authenticityTampered.authenticity.signatureBase64 = Buffer.alloc(64, 8).toString('base64');
  assert.equal(verifyReceiptDigests(authenticityTampered).reasonCode, 'EVIDENCE_RECEIPT_DIGEST_MISMATCH');
});

test('artifact paths, integers, timestamps, command IDs and commit SHAs are strict', () => {
  for (const invalidPath of ['/abs/report.json', '../report.json', 'dir\\report.json', 'dir/\u0000report.json']) {
    const receipt = baseReceipt();
    receipt.artifacts[0].relativePath = invalidPath;
    assert.equal(validateFinalReceipt(receipt).reasonCode, 'EVIDENCE_PATH_INVALID');
  }

  const unsafeSize = baseReceipt();
  unsafeSize.artifacts[0].sizeBytes = Number.MAX_SAFE_INTEGER + 1;
  assert.equal(validateFinalReceipt(unsafeSize).reasonCode, 'EVIDENCE_SCHEMA_INVALID');

  const localTime = baseReceipt();
  localTime.execution.startedAt = '2026-08-07T07:00:00+07:00';
  assert.equal(validateFinalReceipt(localTime).reasonCode, 'EVIDENCE_TIMESTAMP_INVALID');

  const duplicate = baseReceipt();
  duplicate.execution.commands.push(structuredClone(duplicate.execution.commands[0]));
  assert.equal(validateFinalReceipt(duplicate).reasonCode, 'EVIDENCE_COMMAND_DUPLICATE');

  for (const field of ['baseCommit', 'headCommit']) {
    const invalidSha = baseReceipt();
    invalidSha[field] = 'A'.repeat(40);
    assert.equal(validateFinalReceipt(invalidSha).reasonCode, 'EVIDENCE_SCHEMA_INVALID');
  }
});
