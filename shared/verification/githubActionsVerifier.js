'use strict';

const { sha256Hex } = require('./jcs');
const { verifyCommandFacts } = require('./commandFacts');
const { validateCommandSet, commandSetDigest } = require('./commandSetRegistry');
const { validateFinalReceipt, verifyReceiptDigests } = require('./canonicalEvidenceReceipt');
const { REASON_CODES } = require('./reasonCodes');

function fail(reasonCode, details) { return { pass: false, reasonCode, details }; }
function resolveCommandSet(registry, id) {
  if (!registry) return null;
  if (registry instanceof Map) return registry.get(id) || null;
  return registry[id] || null;
}
function sameScalarSet(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  const a = [...left].sort((x, y) => String(x).localeCompare(String(y)));
  const b = [...right].sort((x, y) => String(x).localeCompare(String(y)));
  return a.every((value, index) => value === b[index]);
}
function expectedMismatch(receipt, expected) {
  if (expected.repository && receipt.repository !== expected.repository) return REASON_CODES.EVIDENCE_REPOSITORY_MISMATCH;
  if (expected.baseCommit && receipt.baseCommit !== expected.baseCommit) return REASON_CODES.EVIDENCE_BASE_MISMATCH;
  if (expected.headCommit && receipt.headCommit !== expected.headCommit) return REASON_CODES.EVIDENCE_HEAD_MISMATCH;
  if (expected.workPackage && receipt.workPackage !== expected.workPackage) return REASON_CODES.EVIDENCE_SCHEMA_INVALID;
  if (expected.gateId && receipt.gateId !== expected.gateId) return REASON_CODES.EVIDENCE_SCHEMA_INVALID;
  return null;
}
function apiInvalid(details) { return fail(REASON_CODES.EVIDENCE_GITHUB_API_IDENTITY_INVALID, details); }
function normalizeWorkflowId(value) { return String(value); }

async function verifyGitHubActionsReceipt({ receipt, expected = {}, commandSetRegistry, client }) {
  const shape = validateFinalReceipt(receipt);
  if (!shape.pass) return shape;
  const digests = verifyReceiptDigests(receipt);
  if (!digests.pass) return digests;
  if (receipt.adapterType !== 'github-actions-v1') return fail(REASON_CODES.EVIDENCE_ADAPTER_UNTRUSTED);
  const mismatch = expectedMismatch(receipt, expected);
  if (mismatch) return fail(mismatch);

  const commandSet = resolveCommandSet(commandSetRegistry, receipt.commandSet.commandSetId);
  if (!commandSet) return fail(REASON_CODES.EVIDENCE_COMMAND_SET_UNKNOWN);
  const commandValidation = validateCommandSet(commandSet);
  if (!commandValidation.pass) return commandValidation;
  const digest = commandSetDigest(commandSet);
  if (digest !== receipt.commandSet.commandSetDigest) return fail(REASON_CODES.EVIDENCE_COMMAND_SET_DIGEST_MISMATCH);
  if (commandSet.platform !== receipt.commandSet.platform) return fail(REASON_CODES.EVIDENCE_PLATFORM_MISMATCH);
  const commandFacts = verifyCommandFacts(receipt, commandSet);
  if (!commandFacts.pass) return commandFacts;

  const { producer, authenticity } = receipt;
  if (
    producer.workflowRepository !== receipt.repository ||
    producer.runId !== authenticity.runId ||
    producer.runAttempt !== authenticity.runAttempt ||
    normalizeWorkflowId(producer.workflowId) !== normalizeWorkflowId(authenticity.workflowId) ||
    !sameScalarSet(producer.jobIds, authenticity.jobIds) ||
    !Array.isArray(authenticity.artifactIds) ||
    authenticity.artifactIds.length !== receipt.artifacts.length ||
    new Set(authenticity.artifactIds).size !== authenticity.artifactIds.length
  ) return apiInvalid({ stage: 'receipt-identity' });

  if (!client || typeof client.getWorkflowRun !== 'function' || typeof client.getRunJobs !== 'function' || typeof client.getArtifact !== 'function') return apiInvalid({ stage: 'client-unavailable' });

  let run;
  let jobsResponse;
  try {
    run = await client.getWorkflowRun(producer.runId);
    jobsResponse = await client.getRunJobs(producer.runId, producer.runAttempt);
  } catch (error) {
    return apiInvalid({ stage: 'api-query', error: error.message });
  }
  if (!run || !jobsResponse) return apiInvalid({ stage: 'api-query-empty' });
  if (
    run.id !== producer.runId ||
    run.run_attempt !== producer.runAttempt ||
    run.head_sha !== receipt.headCommit ||
    run.conclusion !== 'success' ||
    normalizeWorkflowId(run.workflow_id) !== normalizeWorkflowId(producer.workflowId) ||
    run.repository?.full_name !== receipt.repository
  ) return apiInvalid({ stage: 'workflow-run' });

  const jobs = Array.isArray(jobsResponse.jobs) ? jobsResponse.jobs : [];
  const actualJobIds = jobs.map((job) => job.id);
  if (!sameScalarSet(actualJobIds, producer.jobIds)) return apiInvalid({ stage: 'jobs-set' });
  for (const job of jobs) if (job.conclusion !== 'success') return apiInvalid({ stage: 'job-conclusion', jobId: job.id });

  for (let index = 0; index < authenticity.artifactIds.length; index += 1) {
    const artifactId = authenticity.artifactIds[index];
    const receiptArtifact = receipt.artifacts[index];
    let artifact;
    try { artifact = await client.getArtifact(artifactId); } catch (error) { return apiInvalid({ stage: 'artifact-query', artifactId, error: error.message }); }
    if (!artifact || artifact.id !== artifactId || artifact.expired === true || artifact.workflow_run?.id !== producer.runId || artifact.name !== receiptArtifact.artifactId) return apiInvalid({ stage: 'artifact-identity', artifactId });
    if (typeof client.getArtifactBytes === 'function') {
      let bytes;
      try { bytes = await client.getArtifactBytes(artifactId); } catch (error) { return fail(REASON_CODES.EVIDENCE_ARTIFACT_DIGEST_MISMATCH, { artifactId, error: error.message }); }
      if (!Buffer.isBuffer(bytes)) bytes = Buffer.from(bytes);
      if (bytes.length !== receiptArtifact.sizeBytes || sha256Hex(bytes) !== receiptArtifact.sha256) return fail(REASON_CODES.EVIDENCE_ARTIFACT_DIGEST_MISMATCH, { artifactId });
    }
  }

  return { pass: true, fact: {
    repository: receipt.repository,
    workPackage: receipt.workPackage,
    gateId: receipt.gateId,
    baseCommit: receipt.baseCommit,
    headCommit: receipt.headCommit,
    platform: receipt.commandSet.platform,
    commandSetId: receipt.commandSet.commandSetId,
    commandSetDigest: receipt.commandSet.commandSetDigest,
    verificationStatus: 'VERIFIED_PASS',
    adapterType: receipt.adapterType,
    receiptSha256: receipt.receiptSha256,
    producerIdentity: `github-actions:${receipt.producer.workflowId}:${receipt.producer.runId}:attempt-${receipt.producer.runAttempt}`
  } };
}

module.exports = { verifyGitHubActionsReceipt };
