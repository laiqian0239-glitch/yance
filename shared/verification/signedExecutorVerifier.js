'use strict';

const crypto = require('node:crypto');
const { canonicalSha256, sha256Hex } = require('./jcs');
const { validateCommandSet, commandSetDigest } = require('./commandSetRegistry');
const { resolveActiveExecutor } = require('./executorRegistry');
const { canonicalPayloadBytes, validateFinalReceipt, verifyReceiptDigests } = require('./canonicalEvidenceReceipt');
const { REASON_CODES } = require('./reasonCodes');

function fail(reasonCode, details) { return { pass: false, reasonCode, details }; }
function resolveCommandSet(registry, id) {
  if (!registry) return null;
  if (registry instanceof Map) return registry.get(id) || null;
  return registry[id] || null;
}
function expectedMismatch(receipt, expected) {
  if (expected.repository && receipt.repository !== expected.repository) return REASON_CODES.EVIDENCE_REPOSITORY_MISMATCH;
  if (expected.baseCommit && receipt.baseCommit !== expected.baseCommit) return REASON_CODES.EVIDENCE_BASE_MISMATCH;
  if (expected.headCommit && receipt.headCommit !== expected.headCommit) return REASON_CODES.EVIDENCE_HEAD_MISMATCH;
  if (expected.workPackage && receipt.workPackage !== expected.workPackage) return REASON_CODES.EVIDENCE_SCHEMA_INVALID;
  if (expected.gateId && receipt.gateId !== expected.gateId) return REASON_CODES.EVIDENCE_SCHEMA_INVALID;
  return null;
}

function verifySignedExecutorReceipt({ receipt, expected = {}, executorRegistry, commandSetRegistry, artifactResolver = null }) {
  const shape = validateFinalReceipt(receipt);
  if (!shape.pass) return shape;
  const digests = verifyReceiptDigests(receipt);
  if (!digests.pass) return digests;
  if (receipt.adapterType !== 'signed-executor-v1') return fail(REASON_CODES.EVIDENCE_ADAPTER_UNTRUSTED);
  const mismatch = expectedMismatch(receipt, expected);
  if (mismatch) return fail(mismatch);

  const commandSet = resolveCommandSet(commandSetRegistry, receipt.commandSet.commandSetId);
  if (!commandSet) return fail(REASON_CODES.EVIDENCE_COMMAND_SET_UNTRUSTED);
  const commandValidation = validateCommandSet(commandSet);
  if (!commandValidation.pass) return commandValidation;
  const digest = commandSetDigest(commandSet);
  if (digest !== receipt.commandSet.commandSetDigest) return fail(REASON_CODES.EVIDENCE_COMMAND_SET_DIGEST_MISMATCH);
  if (commandSet.platform !== receipt.commandSet.platform || receipt.producer.platform !== commandSet.platform) return fail(REASON_CODES.EVIDENCE_PLATFORM_MISMATCH);

  if (receipt.authenticity.executorId !== receipt.producer.executorId || receipt.authenticity.keyGeneration !== receipt.producer.keyGeneration) return fail(REASON_CODES.EVIDENCE_SIGNATURE_INVALID);
  const executorResult = resolveActiveExecutor({ registry: executorRegistry, executorId: receipt.producer.executorId, keyGeneration: receipt.producer.keyGeneration, platform: receipt.producer.platform, commandSetDigest: digest });
  if (!executorResult.pass) return executorResult;

  const signature = Buffer.from(receipt.authenticity.signatureBase64, 'base64');
  if (!crypto.verify(null, canonicalPayloadBytes(receipt), executorResult.executor.publicKeyPem, signature)) return fail(REASON_CODES.EVIDENCE_SIGNATURE_INVALID);

  if (receipt.workspace.preHead !== receipt.headCommit || receipt.workspace.postHead !== receipt.headCommit) return fail(REASON_CODES.EVIDENCE_WORKSPACE_HEAD_MISMATCH);
  if (receipt.execution.commands.length !== commandSet.commands.length) return fail(REASON_CODES.EVIDENCE_COMMAND_RESULT_MISMATCH);
  const resultsById = new Map(receipt.results.map((row) => [row.commandId, row]));
  const executionsById = new Map(receipt.execution.commands.map((row) => [row.commandId, row]));
  for (const command of commandSet.commands) {
    const execution = executionsById.get(command.commandId);
    const result = resultsById.get(command.commandId);
    if (!execution || !result) return fail(REASON_CODES.EVIDENCE_COMMAND_RESULT_MISMATCH);
    const argvDigest = canonicalSha256({ executable: command.executable, argv: command.argv });
    if (execution.argvDigest !== argvDigest) return fail(REASON_CODES.EVIDENCE_COMMAND_RESULT_MISMATCH);
    const passed = execution.exitCode === command.expectedExitCode;
    if (result.passed !== passed) return fail(REASON_CODES.EVIDENCE_COMMAND_RESULT_MISMATCH);
    if (!passed) return fail(REASON_CODES.EVIDENCE_COMMAND_FAILED);
  }

  if (artifactResolver) {
    for (const artifact of receipt.artifacts) {
      let bytes;
      try { bytes = artifactResolver(artifact); } catch (error) { return fail(REASON_CODES.EVIDENCE_ARTIFACT_DIGEST_MISMATCH, { error: error.message }); }
      if (!Buffer.isBuffer(bytes)) bytes = Buffer.from(bytes);
      if (bytes.length !== artifact.sizeBytes || sha256Hex(bytes) !== artifact.sha256) return fail(REASON_CODES.EVIDENCE_ARTIFACT_DIGEST_MISMATCH);
    }
  }

  return { pass: true, fact: {
    repository: receipt.repository, workPackage: receipt.workPackage, gateId: receipt.gateId,
    baseCommit: receipt.baseCommit, headCommit: receipt.headCommit, platform: receipt.commandSet.platform,
    commandSetId: receipt.commandSet.commandSetId, commandSetDigest: receipt.commandSet.commandSetDigest,
    verificationStatus: 'VERIFIED_PASS', adapterType: receipt.adapterType, receiptSha256: receipt.receiptSha256,
    producerIdentity: `${receipt.producer.executorId}:generation-${receipt.producer.keyGeneration}`
  } };
}

module.exports = { verifySignedExecutorReceipt };
