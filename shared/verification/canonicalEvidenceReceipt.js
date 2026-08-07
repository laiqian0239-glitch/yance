'use strict';

const { canonicalizeBytes, sha256Hex } = require('./jcs');
const { REASON_CODES } = require('./reasonCodes');

const TOP_LEVEL_KEYS = Object.freeze([
  'schemaVersion', 'recordType', 'repository', 'workPackage', 'gateId',
  'baseCommit', 'headCommit', 'adapterType', 'producer', 'commandSet',
  'execution', 'workspace', 'results', 'artifacts',
  'canonicalPayloadSha256', 'authenticity', 'receiptSha256'
]);
const HASH_RE = /^[0-9a-f]{64}$/u;
const COMMIT_RE = /^[0-9a-f]{40}$/u;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const REPOSITORY_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;

function ok(value) { return { pass: true, value }; }
function fail(reasonCode, details) { return { pass: false, reasonCode, details }; }
function exactKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}
function validId(value) { return typeof value === 'string' && ID_RE.test(value); }
function validHash(value) { return typeof value === 'string' && HASH_RE.test(value); }
function validSafeInteger(value, minimum = 0) { return Number.isSafeInteger(value) && value >= minimum; }
function validUtc(value) {
  if (typeof value !== 'string' || !UTC_RE.test(value)) return false;
  return Number.isFinite(Date.parse(value));
}
function validRelativePath(value) {
  if (typeof value !== 'string' || value.length === 0) return false;
  if (/^[A-Za-z]:/u.test(value) || value.startsWith('/') || value.includes('\\') || /[\u0000-\u001f\u007f]/u.test(value)) return false;
  return value.split('/').every((part) => part && part !== '.' && part !== '..');
}

function validateProducer(adapterType, producer) {
  if (adapterType === 'signed-executor-v1') {
    if (!exactKeys(producer, ['executorId', 'platform', 'architecture', 'nodeVersion', 'npmVersion', 'keyGeneration'])) return fail(REASON_CODES.EVIDENCE_SCHEMA_INVALID);
    if (!validId(producer.executorId) || !['linux', 'windows'].includes(producer.platform) || !validId(producer.architecture) || typeof producer.nodeVersion !== 'string' || typeof producer.npmVersion !== 'string' || !validSafeInteger(producer.keyGeneration, 1)) return fail(REASON_CODES.EVIDENCE_SCHEMA_INVALID);
    return ok(producer);
  }
  if (adapterType === 'github-actions-v1') {
    if (!exactKeys(producer, ['workflowRepository', 'workflowId', 'runId', 'runAttempt', 'jobIds', 'runnerEnvironment'])) return fail(REASON_CODES.EVIDENCE_SCHEMA_INVALID);
    if (!REPOSITORY_RE.test(producer.workflowRepository || '') || !validId(String(producer.workflowId)) || !validSafeInteger(producer.runId, 1) || !validSafeInteger(producer.runAttempt, 1) || !Array.isArray(producer.jobIds) || producer.jobIds.some((id) => !validSafeInteger(id, 1)) || typeof producer.runnerEnvironment !== 'string') return fail(REASON_CODES.EVIDENCE_SCHEMA_INVALID);
    return ok(producer);
  }
  return fail(REASON_CODES.EVIDENCE_ADAPTER_UNTRUSTED);
}

function validateAuthenticity(adapterType, authenticity, allowNull) {
  if (authenticity === null) return allowNull ? ok(null) : fail(REASON_CODES.EVIDENCE_SCHEMA_INVALID);
  if (adapterType === 'signed-executor-v1') {
    if (!exactKeys(authenticity, ['scheme', 'executorId', 'keyGeneration', 'signatureBase64'])) return fail(REASON_CODES.EVIDENCE_SCHEMA_INVALID);
    if (authenticity.scheme !== 'ed25519' || !validId(authenticity.executorId) || !validSafeInteger(authenticity.keyGeneration, 1) || typeof authenticity.signatureBase64 !== 'string') return fail(REASON_CODES.EVIDENCE_SCHEMA_INVALID);
    const decoded = Buffer.from(authenticity.signatureBase64, 'base64');
    if (decoded.length !== 64 || decoded.toString('base64') !== authenticity.signatureBase64) return fail(REASON_CODES.EVIDENCE_SCHEMA_INVALID);
    return ok(authenticity);
  }
  if (adapterType === 'github-actions-v1') {
    if (!exactKeys(authenticity, ['scheme', 'runId', 'runAttempt', 'workflowId', 'jobIds', 'artifactIds'])) return fail(REASON_CODES.EVIDENCE_SCHEMA_INVALID);
    if (authenticity.scheme !== 'github-api-rebind' || !validSafeInteger(authenticity.runId, 1) || !validSafeInteger(authenticity.runAttempt, 1) || !validId(String(authenticity.workflowId)) || !Array.isArray(authenticity.jobIds) || !Array.isArray(authenticity.artifactIds)) return fail(REASON_CODES.EVIDENCE_SCHEMA_INVALID);
    return ok(authenticity);
  }
  return fail(REASON_CODES.EVIDENCE_ADAPTER_UNTRUSTED);
}

function validateReceiptShape(receipt, { allowUnsigned }) {
  if (!exactKeys(receipt, TOP_LEVEL_KEYS)) return fail(REASON_CODES.EVIDENCE_SCHEMA_INVALID);
  if (receipt.schemaVersion !== 1 || receipt.recordType !== 'YANCE_PORTABLE_VERIFICATION_EVIDENCE_RECEIPT' || !REPOSITORY_RE.test(receipt.repository || '') || !validId(receipt.workPackage) || !validId(receipt.gateId) || !COMMIT_RE.test(receipt.baseCommit || '') || !COMMIT_RE.test(receipt.headCommit || '') || !['signed-executor-v1', 'github-actions-v1'].includes(receipt.adapterType)) return fail(REASON_CODES.EVIDENCE_SCHEMA_INVALID);

  const producer = validateProducer(receipt.adapterType, receipt.producer);
  if (!producer.pass) return producer;
  if (!exactKeys(receipt.commandSet, ['commandSetId', 'commandSetDigest', 'platform']) || !validId(receipt.commandSet.commandSetId) || !validHash(receipt.commandSet.commandSetDigest) || !['linux', 'windows'].includes(receipt.commandSet.platform)) return fail(REASON_CODES.EVIDENCE_SCHEMA_INVALID);
  if (receipt.producer.platform && receipt.producer.platform !== receipt.commandSet.platform) return fail(REASON_CODES.EVIDENCE_PLATFORM_MISMATCH);

  if (!exactKeys(receipt.execution, ['startedAt', 'completedAt', 'commands']) || !validUtc(receipt.execution.startedAt) || !validUtc(receipt.execution.completedAt)) return fail(REASON_CODES.EVIDENCE_TIMESTAMP_INVALID);
  if (Date.parse(receipt.execution.completedAt) < Date.parse(receipt.execution.startedAt) || !Array.isArray(receipt.execution.commands) || receipt.execution.commands.length === 0) return fail(REASON_CODES.EVIDENCE_SCHEMA_INVALID);
  const commandIds = new Set();
  for (const command of receipt.execution.commands) {
    if (!exactKeys(command, ['commandId', 'argvDigest', 'exitCode', 'startedAt', 'completedAt', 'stdoutSha256', 'stderrSha256']) || !validId(command.commandId) || !validHash(command.argvDigest) || !Number.isSafeInteger(command.exitCode) || !validHash(command.stdoutSha256) || !validHash(command.stderrSha256)) return fail(REASON_CODES.EVIDENCE_SCHEMA_INVALID);
    if (!validUtc(command.startedAt) || !validUtc(command.completedAt)) return fail(REASON_CODES.EVIDENCE_TIMESTAMP_INVALID);
    if (commandIds.has(command.commandId)) return fail(REASON_CODES.EVIDENCE_COMMAND_DUPLICATE);
    commandIds.add(command.commandId);
  }

  const workspaceKeys = ['preHead', 'postHead', 'preTrackedDiffSha256', 'postTrackedDiffSha256', 'preUnexpectedUntrackedPathSetSha256', 'postUnexpectedUntrackedPathSetSha256', 'allowedGeneratedRootSetSha256'];
  if (!exactKeys(receipt.workspace, workspaceKeys) || !COMMIT_RE.test(receipt.workspace.preHead || '') || !COMMIT_RE.test(receipt.workspace.postHead || '') || workspaceKeys.slice(2).some((key) => !validHash(receipt.workspace[key]))) return fail(REASON_CODES.EVIDENCE_SCHEMA_INVALID);

  if (!Array.isArray(receipt.results) || receipt.results.length !== receipt.execution.commands.length) return fail(REASON_CODES.EVIDENCE_SCHEMA_INVALID);
  const resultIds = new Set();
  for (const result of receipt.results) {
    if (!exactKeys(result, ['commandId', 'passed']) || !validId(result.commandId) || typeof result.passed !== 'boolean' || !commandIds.has(result.commandId) || resultIds.has(result.commandId)) return fail(REASON_CODES.EVIDENCE_SCHEMA_INVALID);
    resultIds.add(result.commandId);
  }

  if (!Array.isArray(receipt.artifacts)) return fail(REASON_CODES.EVIDENCE_SCHEMA_INVALID);
  const artifactIds = new Set();
  for (const artifact of receipt.artifacts) {
    if (!exactKeys(artifact, ['artifactId', 'relativePath', 'sha256', 'sizeBytes', 'mediaType', 'producerCommandId']) || !validId(artifact.artifactId) || !validHash(artifact.sha256) || !validSafeInteger(artifact.sizeBytes) || typeof artifact.mediaType !== 'string' || !commandIds.has(artifact.producerCommandId) || artifactIds.has(artifact.artifactId)) return fail(REASON_CODES.EVIDENCE_SCHEMA_INVALID);
    if (!validRelativePath(artifact.relativePath)) return fail(REASON_CODES.EVIDENCE_PATH_INVALID);
    artifactIds.add(artifact.artifactId);
  }

  if (!validHash(receipt.canonicalPayloadSha256)) return fail(REASON_CODES.EVIDENCE_SCHEMA_INVALID);
  const auth = validateAuthenticity(receipt.adapterType, receipt.authenticity, allowUnsigned);
  if (!auth.pass) return auth;
  if (allowUnsigned) {
    if (receipt.authenticity !== null || receipt.receiptSha256 !== null) return fail(REASON_CODES.EVIDENCE_SCHEMA_INVALID);
  } else if (!validHash(receipt.receiptSha256)) return fail(REASON_CODES.EVIDENCE_SCHEMA_INVALID);
  return ok(receipt);
}

function canonicalPayloadBytes(value) {
  const copy = structuredClone(value);
  delete copy.canonicalPayloadSha256;
  delete copy.authenticity;
  delete copy.receiptSha256;
  return canonicalizeBytes(copy);
}
function computeCanonicalPayloadSha256(value) { return sha256Hex(canonicalPayloadBytes(value)); }
function computeReceiptSha256(receipt) {
  const copy = structuredClone(receipt);
  delete copy.receiptSha256;
  return sha256Hex(canonicalizeBytes(copy));
}
function validateUnsignedCandidate(candidate) { return validateReceiptShape(candidate, { allowUnsigned: true }); }
function validateFinalReceipt(receipt) { return validateReceiptShape(receipt, { allowUnsigned: false }); }
function verifyReceiptDigests(receipt) {
  if (computeCanonicalPayloadSha256(receipt) !== receipt.canonicalPayloadSha256) return fail(REASON_CODES.EVIDENCE_CANONICAL_DIGEST_MISMATCH);
  if (computeReceiptSha256(receipt) !== receipt.receiptSha256) return fail(REASON_CODES.EVIDENCE_RECEIPT_DIGEST_MISMATCH);
  return ok(receipt);
}

module.exports = {
  TOP_LEVEL_KEYS,
  canonicalPayloadBytes,
  computeCanonicalPayloadSha256,
  computeReceiptSha256,
  validateFinalReceipt,
  validateUnsignedCandidate,
  verifyReceiptDigests,
  validRelativePath
};
