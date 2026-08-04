#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPOSITORY_ROOT = path.resolve(__dirname, '..', '..');
const RECEIPT_PATH = path.join(REPOSITORY_ROOT, 'governance', 'architecture-closure-v2', 'wp-b-m2-review.json');
const RED_RECEIPT_PATH = path.join(REPOSITORY_ROOT, 'governance', 'architecture-closure-v2', 'wp-b-m2-red-evidence.json');
const FULL_SHA = /^[a-f0-9]{40}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const ARTIFACT_DIGEST = /^sha256:[a-f0-9]{64}$/u;
const EXPECTED_DOCUMENT_TYPE = 'YANCE_ACV2_WP_B_M2_REVIEW';
const EXPECTED_REPOSITORY = 'laiqian0239-glitch/yance';
const EXPECTED_BRANCH = 'acv2/wp-b-durable-execution-outbox';
const EXPECTED_PARENT_M1_SEAL = '1e3d600f0647af35e737ff92a200c67e69224c82';
const EXPECTED_OPERATION_KINDS = Object.freeze([
  'AI_PROVIDER_EXECUTION',
  'OUTBOUND_MESSAGE_SEND',
  'DELIVERY_RECEIPT_RECONCILIATION',
  'MEDIA_TRANSFER',
  'HISTORY_SYNCHRONIZATION',
  'SESSION_RESTORE'
]);
const EXPECTED_POST_REVIEW_PATHS = Object.freeze([
  '.github/workflows/wp-b-m2-independent-review-integrity.yml',
  'backend/tests/architectureClosureV2/wpB/m2ReviewSeal.test.js',
  'governance/architecture-closure-v2/wp-b-m2-review.json',
  'tools/architecture-closure-v2/verify-wp-b-m2-review.js'
]);
const REQUIRED_PENDING_EVIDENCE_PATHS = Object.freeze([
  '.github/workflows/wp-b-m2-independent-review-integrity.yml',
  'governance/architecture-closure-v2/wp-b-m2-review.json',
  'tools/architecture-closure-v2/verify-wp-b-m2-review.js'
]);
const EXPECTED_FORMAL_WORKFLOWS = Object.freeze([
  'ACV2 WP-A Architecture Gates',
  'Stage 6.4.5.9 WP0 Architecture Gates',
  'WP-A Main Post-Merge Validation',
  'WP-B M1 Independent Review Integrity',
  'WP-B M2 Authorization',
  'WP-B M2 Contracts',
  'WP-B M2 Independent Review Integrity',
  'WP-B Validation'
]);
const EXPECTED_FINDING_IDS = Object.freeze([
  'WP-B-M2-IR-001',
  'WP-B-M2-IR-002',
  'WP-B-M2-IR-003'
]);

function reviewError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, ...details });
}

function assertCondition(condition, code, message, details = {}) {
  if (!condition) throw reviewError(code, message, details);
}

function sortedUnique(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map(value => String(value || '').trim().replace(/\\/gu, '/'))
    .filter(Boolean))].sort();
}

function changedFileSetSha256(values) {
  const normalized = sortedUnique(values);
  return crypto.createHash('sha256').update(`${normalized.join('\n')}\n`, 'utf8').digest('hex');
}

function git(args) {
  return execFileSync('git', args, {
    cwd: REPOSITORY_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
}

function readJsonObject(filePath, code) {
  try {
    const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    assertCondition(value && typeof value === 'object' && !Array.isArray(value), code, 'Expected one JSON object', { filePath });
    return value;
  } catch (cause) {
    if (cause?.code?.startsWith?.('WP_B_M2_REVIEW_')) throw cause;
    throw reviewError(code, 'Review JSON is unreadable', { filePath, cause: cause?.message || String(cause) });
  }
}

function readReceipt(receiptPath = RECEIPT_PATH) {
  return readJsonObject(receiptPath, 'WP_B_M2_REVIEW_RECEIPT_UNREADABLE');
}

function validateReceipt(document) {
  assertCondition(document && typeof document === 'object' && !Array.isArray(document), 'WP_B_M2_REVIEW_RECEIPT_INVALID', 'Milestone 2 review receipt must be one JSON object');
  assertCondition(document.schemaVersion === 1, 'WP_B_M2_REVIEW_SCHEMA_INVALID', 'Unexpected review schema version');
  assertCondition(document.documentType === EXPECTED_DOCUMENT_TYPE, 'WP_B_M2_REVIEW_TYPE_INVALID', 'Unexpected review document type');
  assertCondition(document.program === 'Architecture Closure V2', 'WP_B_M2_REVIEW_PROGRAM_INVALID', 'Unexpected program');
  assertCondition(document.repository === EXPECTED_REPOSITORY, 'WP_B_M2_REVIEW_REPOSITORY_INVALID', 'Unexpected repository');
  assertCondition(document.workPackage === 'WP-B', 'WP_B_M2_REVIEW_WORK_PACKAGE_INVALID', 'Unexpected work package');
  assertCondition(document.pullRequest === 17, 'WP_B_M2_REVIEW_PR_INVALID', 'Review must bind PR #17');
  assertCondition(document.branch === EXPECTED_BRANCH, 'WP_B_M2_REVIEW_BRANCH_INVALID', 'Review must bind the implementation branch');

  const reviewed = document.reviewedImplementation || {};
  assertCondition(FULL_SHA.test(String(reviewed.head || '')), 'WP_B_M2_REVIEW_HEAD_INVALID', 'Reviewed Head must be one full commit SHA');
  assertCondition(FULL_SHA.test(String(reviewed.baselineHead || '')), 'WP_B_M2_REVIEW_BASELINE_INVALID', 'Baseline Head must be one full commit SHA');
  assertCondition(reviewed.parentMilestone1SealHead === EXPECTED_PARENT_M1_SEAL, 'WP_B_M2_REVIEW_PARENT_SEAL_INVALID', 'Review must bind the exact Milestone 1 Seal Head');
  assertCondition(Number.isInteger(reviewed.changedFileCount) && reviewed.changedFileCount > 0, 'WP_B_M2_REVIEW_FILE_COUNT_INVALID', 'Reviewed file count must be positive');
  assertCondition(SHA256.test(String(reviewed.changedFileSetSha256 || '')), 'WP_B_M2_REVIEW_FILE_DIGEST_INVALID', 'Reviewed file digest must be SHA-256');
  assertCondition(JSON.stringify(reviewed.operationKinds) === JSON.stringify(EXPECTED_OPERATION_KINDS), 'WP_B_M2_REVIEW_OPERATION_ORDER_INVALID', 'Reviewed operation order must be exact');

  const review = document.review || {};
  assertCondition(review.reviewerType === 'INDEPENDENT_SOFTWARE_AUDIT_AGENT', 'WP_B_M2_REVIEW_REVIEWER_TYPE_INVALID', 'Reviewer type is invalid');
  assertCondition(review.reviewerIdentity === 'OpenAI GPT-5.6 Thinking', 'WP_B_M2_REVIEW_REVIEWER_IDENTITY_INVALID', 'Reviewer identity is invalid');
  assertCondition(review.reviewContext === '独立软件工程审计', 'WP_B_M2_REVIEW_CONTEXT_INVALID', 'Review context is invalid');
  assertCondition(review.reviewMode === 'POST_REMEDIATION_SEPARATE_REVIEW_PASS', 'WP_B_M2_REVIEW_MODE_INVALID', 'Review mode is invalid');
  assertCondition(review.humanApprovalClaimed === false, 'WP_B_M2_REVIEW_HUMAN_CLAIM_INVALID', 'Receipt cannot claim human approval');
  assertCondition(review.reviewGate2 === 'APPROVED', 'WP_B_M2_REVIEW_GATE_NOT_APPROVED', 'Review Gate 2 is not approved');
  assertCondition(review.milestone1 === 'SEALED', 'WP_B_M2_REVIEW_M1_INVALID', 'Milestone 1 must remain sealed');
  assertCondition(['REVIEWED_NOT_SEALED', 'SEALED'].includes(review.milestone2), 'WP_B_M2_REVIEW_M2_STATE_INVALID', 'Milestone 2 review state is invalid');
  assertCondition(review.milestone3 === 'NOT_STARTED', 'WP_B_M2_REVIEW_M3_STATE_INVALID', 'Milestone 3 must remain not started');
  assertCondition(typeof review.conclusion === 'string' && review.conclusion.length > 40, 'WP_B_M2_REVIEW_CONCLUSION_INVALID', 'Review conclusion is incomplete');

  const red = document.redEvidence || {};
  assertCondition(red.workflowName === 'WP-B M2 Contracts', 'WP_B_M2_REVIEW_RED_WORKFLOW_INVALID', 'RED workflow is invalid');
  assertCondition(Number.isSafeInteger(red.workflowRunId) && red.workflowRunId > 0, 'WP_B_M2_REVIEW_RED_RUN_INVALID', 'RED run is invalid');
  assertCondition(FULL_SHA.test(String(red.head || '')), 'WP_B_M2_REVIEW_RED_HEAD_INVALID', 'RED Head is invalid');
  assertCondition(red.expectedConclusion === 'failure' && red.contractResult === '0_OF_26_PASS', 'WP_B_M2_REVIEW_RED_RESULT_INVALID', 'Credible RED must preserve 0/26 failure');
  for (const field of ['ubuntuJobId', 'windowsJobId', 'ubuntuArtifactId', 'windowsArtifactId']) {
    assertCondition(Number.isSafeInteger(red[field]) && red[field] > 0, 'WP_B_M2_REVIEW_RED_ID_INVALID', `RED evidence ${field} is invalid`, { field });
  }
  assertCondition(red.secretLeakCount === 0 && red.businessContentLeakCount === 0, 'WP_B_M2_REVIEW_RED_LEAK_INVALID', 'Credible RED evidence must contain zero leak counts');

  assertCondition(Array.isArray(document.findings) && document.findings.length === EXPECTED_FINDING_IDS.length, 'WP_B_M2_REVIEW_FINDINGS_INVALID', 'Review must preserve the exact finding set');
  const findingIds = document.findings.map(item => item?.id);
  assertCondition(JSON.stringify(findingIds) === JSON.stringify(EXPECTED_FINDING_IDS), 'WP_B_M2_REVIEW_FINDING_ORDER_INVALID', 'Finding order is invalid');
  for (const finding of document.findings) {
    assertCondition(finding.severity === 'P0', 'WP_B_M2_REVIEW_FINDING_SEVERITY_INVALID', 'Every recorded blocker must retain P0 severity', { findingId: finding.id });
    for (const field of ['invariant', 'title', 'reproducibleContract', 'resolution']) {
      assertCondition(typeof finding[field] === 'string' && finding[field].trim().length > 0, 'WP_B_M2_REVIEW_FINDING_SHAPE_INVALID', `Finding ${field} is missing`, { findingId: finding.id, field });
    }
  }

  const formal = document.formalValidation;
  assertCondition(Array.isArray(formal) && formal.length === EXPECTED_FORMAL_WORKFLOWS.length, 'WP_B_M2_REVIEW_VALIDATION_SET_INVALID', 'Exactly eight formal workflow runs are required');
  const names = sortedUnique(formal.map(row => row?.workflowName));
  assertCondition(JSON.stringify(names) === JSON.stringify(EXPECTED_FORMAL_WORKFLOWS), 'WP_B_M2_REVIEW_VALIDATION_NAMES_INVALID', 'Formal workflow set is incomplete or duplicated', { expected: EXPECTED_FORMAL_WORKFLOWS, actual: names });
  const runIds = new Set();
  const jobIds = new Set();
  for (const run of formal) {
    assertCondition(Number.isSafeInteger(run.workflowRunId) && run.workflowRunId > 0 && !runIds.has(run.workflowRunId), 'WP_B_M2_REVIEW_VALIDATION_RUN_INVALID', 'Formal workflow run id is invalid or duplicated', { workflowName: run.workflowName });
    runIds.add(run.workflowRunId);
    assertCondition(Number.isSafeInteger(run.runNumber) && run.runNumber > 0, 'WP_B_M2_REVIEW_VALIDATION_RUN_NUMBER_INVALID', 'Formal run number is invalid', { workflowName: run.workflowName });
    assertCondition(run.expectedHead === reviewed.head, 'WP_B_M2_REVIEW_VALIDATION_HEAD_INVALID', 'Formal workflow is not bound to the reviewed Head', { workflowName: run.workflowName });
    assertCondition(run.expectedConclusion === 'success', 'WP_B_M2_REVIEW_VALIDATION_CONCLUSION_INVALID', 'Formal workflow must require success', { workflowName: run.workflowName });
    assertCondition(Array.isArray(run.jobs) && run.jobs.length > 0, 'WP_B_M2_REVIEW_VALIDATION_JOBS_INVALID', 'Formal workflow must record successful jobs', { workflowName: run.workflowName });
    for (const job of run.jobs) {
      assertCondition(Number.isSafeInteger(job?.jobId) && job.jobId > 0 && !jobIds.has(job.jobId), 'WP_B_M2_REVIEW_VALIDATION_JOB_ID_INVALID', 'Formal job id is invalid or duplicated', { workflowName: run.workflowName, jobId: job?.jobId });
      jobIds.add(job.jobId);
      assertCondition(typeof job.name === 'string' && job.name.trim().length > 0, 'WP_B_M2_REVIEW_VALIDATION_JOB_NAME_INVALID', 'Formal job name is invalid', { workflowName: run.workflowName, jobId: job.jobId });
    }
  }

  const contractRun = formal.find(row => row.workflowName === 'WP-B M2 Contracts');
  assertCondition(Array.isArray(contractRun?.artifacts) && contractRun.artifacts.length === 2, 'WP_B_M2_REVIEW_CONTRACT_ARTIFACTS_INVALID', 'M2 contract run must record two platform artifacts');
  for (const artifact of contractRun.artifacts) {
    assertCondition(Number.isSafeInteger(artifact.artifactId) && artifact.artifactId > 0, 'WP_B_M2_REVIEW_CONTRACT_ARTIFACT_ID_INVALID', 'M2 artifact id is invalid');
    assertCondition(typeof artifact.name === 'string' && artifact.name.includes('wp-b-m2-contract-evidence-'), 'WP_B_M2_REVIEW_CONTRACT_ARTIFACT_NAME_INVALID', 'M2 artifact name is invalid');
    assertCondition(ARTIFACT_DIGEST.test(String(artifact.digest || '')), 'WP_B_M2_REVIEW_CONTRACT_ARTIFACT_DIGEST_INVALID', 'M2 artifact digest is invalid');
    assertCondition(SHA256.test(String(artifact.normalizedOutputSha256 || '')), 'WP_B_M2_REVIEW_CONTRACT_OUTPUT_DIGEST_INVALID', 'M2 normalized output digest is invalid');
  }
  const evidence = contractRun.contractEvidence || {};
  assertCondition(evidence.testCount === 89 && evidence.passCount === 89 && evidence.failCount === 0, 'WP_B_M2_REVIEW_CONTRACT_COUNTS_INVALID', 'M2 formal contract counts must remain 89/89/0');
  assertCondition(evidence.matchedInfrastructurePattern === null, 'WP_B_M2_REVIEW_CONTRACT_INFRASTRUCTURE_INVALID', 'M2 evidence cannot contain an infrastructure failure match');
  assertCondition(evidence.secretLeakCount === 0 && evidence.businessContentLeakCount === 0, 'WP_B_M2_REVIEW_CONTRACT_LEAK_INVALID', 'M2 evidence must retain zero leak counts');

  const blobs = document.reviewedBlobs || {};
  assertCondition(Object.keys(blobs).length >= 10, 'WP_B_M2_REVIEW_BLOB_SET_INVALID', 'Reviewed blob set is incomplete');
  for (const [filePath, blob] of Object.entries(blobs)) {
    assertCondition(filePath && !filePath.startsWith('/') && !filePath.includes('..'), 'WP_B_M2_REVIEW_BLOB_PATH_INVALID', 'Reviewed blob path is invalid', { filePath });
    assertCondition(FULL_SHA.test(String(blob || '')), 'WP_B_M2_REVIEW_BLOB_INVALID', 'Reviewed blob must be a full Git SHA-1', { filePath });
  }

  const seal = document.seal || {};
  assertCondition(['PENDING', 'SEALED'].includes(seal.status), 'WP_B_M2_REVIEW_SEAL_STATUS_INVALID', 'Seal status is invalid');
  assertCondition(JSON.stringify(sortedUnique(seal.allowedPostReviewPaths)) === JSON.stringify(EXPECTED_POST_REVIEW_PATHS), 'WP_B_M2_REVIEW_SEAL_PATHS_INVALID', 'Post-review path set must be exact');
  assertCondition(seal.temporaryBypassAllowed === false && seal.warningOnlyClosureAllowed === false, 'WP_B_M2_REVIEW_SEAL_POLICY_INVALID', 'Review cannot permit bypass or warning-only closure');
  if (seal.status === 'PENDING') {
    assertCondition(seal.head === '', 'WP_B_M2_REVIEW_PENDING_SEAL_HEAD_INVALID', 'Pending seal cannot claim a seal Head');
    assertCondition(review.milestone2 === 'REVIEWED_NOT_SEALED', 'WP_B_M2_REVIEW_PENDING_STATE_INVALID', 'Pending seal must preserve reviewed-not-sealed state');
  } else {
    assertCondition(FULL_SHA.test(String(seal.head || '')), 'WP_B_M2_REVIEW_SEAL_HEAD_INVALID', 'Seal Head must be a full commit SHA');
    assertCondition(review.milestone2 === 'SEALED', 'WP_B_M2_REVIEW_SEALED_STATE_INVALID', 'Sealed receipt must mark Milestone 2 sealed');
  }

  const governance = document.governance || {};
  assertCondition(governance.prMustRemainDraft === true, 'WP_B_M2_REVIEW_DRAFT_POLICY_INVALID', 'PR must remain Draft');
  assertCondition(governance.milestone2Authorized === true && governance.credibleM2RedRecorded === true && governance.milestone2Reviewed === true, 'WP_B_M2_REVIEW_GOVERNANCE_PREREQUISITE_INVALID', 'Milestone 2 prerequisites must remain true');
  assertCondition(governance.milestone2Sealed === (seal.status === 'SEALED'), 'WP_B_M2_REVIEW_GOVERNANCE_SEAL_MISMATCH', 'Governance seal state must match receipt');
  for (const field of ['readyForPromotion', 'milestone3Authorized', 'mergeAuthorized', 'productionUseAuthorized', 'wpCAuthorized', 'formalRelease', 'publish', 'temporaryBypassAllowed', 'warningOnlyClosureAllowed']) {
    assertCondition(governance[field] === false, 'WP_B_M2_REVIEW_GOVERNANCE_OPEN', `Governance field ${field} must remain false`, { field });
  }

  return Object.freeze({
    ok: true,
    reviewedHead: reviewed.head,
    baselineHead: reviewed.baselineHead,
    parentMilestone1SealHead: reviewed.parentMilestone1SealHead,
    sealStatus: seal.status,
    sealHead: seal.head
  });
}

function verifyPrerequisiteReceipts() {
  const m1VerifierPath = path.join(REPOSITORY_ROOT, 'tools', 'architecture-closure-v2', 'verify-wp-b-m1-review.js');
  const m2AuthorizationVerifierPath = path.join(REPOSITORY_ROOT, 'tools', 'architecture-closure-v2', 'verify-wp-b-m2-authorization.js');
  for (const verifierPath of [m1VerifierPath, m2AuthorizationVerifierPath]) {
    assertCondition(fs.existsSync(verifierPath), 'WP_B_M2_REVIEW_PREREQUISITE_VERIFIER_MISSING', 'Prerequisite verifier is missing', { verifierPath });
  }
  delete require.cache[require.resolve(m1VerifierPath)];
  delete require.cache[require.resolve(m2AuthorizationVerifierPath)];
  const m1Verifier = require(m1VerifierPath);
  const m2AuthorizationVerifier = require(m2AuthorizationVerifierPath);
  const m1Receipt = m1Verifier.readReceipt();
  const m1Validation = m1Verifier.validateReceipt(m1Receipt);
  const m1Local = m1Verifier.verifyLocalRepository(m1Receipt);
  const authorization = m2AuthorizationVerifier.readReceipt();
  const authorizationValidation = m2AuthorizationVerifier.validateReceipt(authorization);
  const authorizationLocal = m2AuthorizationVerifier.verifyLocalRepository(authorization);
  assertCondition(m1Validation.sealHead === EXPECTED_PARENT_M1_SEAL, 'WP_B_M2_REVIEW_PARENT_M1_VERIFICATION_FAILED', 'Milestone 1 Seal Head changed');
  assertCondition(authorizationValidation.parentMilestone1SealHead === EXPECTED_PARENT_M1_SEAL, 'WP_B_M2_REVIEW_AUTHORIZATION_PARENT_INVALID', 'M2 authorization parent seal changed');
  return Object.freeze({ m1SealVerified: m1Local.ok === true, m2AuthorizationVerified: authorizationLocal.ok === true });
}

function verifyLocalRepository(document = readReceipt()) {
  const validation = validateReceipt(document);
  const reviewed = document.reviewedImplementation;
  const seal = document.seal;
  let currentHead;
  try {
    for (const commit of [reviewed.baselineHead, reviewed.parentMilestone1SealHead, reviewed.head]) git(['cat-file', '-e', `${commit}^{commit}`]);
    currentHead = git(['rev-parse', 'HEAD']);
    git(['merge-base', '--is-ancestor', reviewed.baselineHead, reviewed.parentMilestone1SealHead]);
    git(['merge-base', '--is-ancestor', reviewed.parentMilestone1SealHead, reviewed.head]);
    git(['merge-base', '--is-ancestor', reviewed.head, currentHead]);
    if (seal.status === 'SEALED') {
      git(['cat-file', '-e', `${seal.head}^{commit}`]);
      git(['merge-base', '--is-ancestor', reviewed.head, seal.head]);
      git(['merge-base', '--is-ancestor', seal.head, currentHead]);
    }
  } catch (cause) {
    throw reviewError('WP_B_M2_REVIEW_GIT_ANCESTRY_INVALID', 'Baseline, M1 Seal, reviewed Head, evidence/seal Head, and current Head must form one monotonic chain', { cause: cause?.message || String(cause) });
  }

  const reviewedFiles = sortedUnique(git(['-c', 'core.quotePath=false', 'diff', '--name-only', reviewed.baselineHead, reviewed.head, '--']).split(/\r?\n/u));
  const reviewedDigest = changedFileSetSha256(reviewedFiles);
  assertCondition(reviewedFiles.length === reviewed.changedFileCount, 'WP_B_M2_REVIEW_FILE_COUNT_MISMATCH', 'Reviewed file count does not match Git', { expected: reviewed.changedFileCount, actual: reviewedFiles.length });
  assertCondition(reviewedDigest === reviewed.changedFileSetSha256, 'WP_B_M2_REVIEW_FILE_DIGEST_MISMATCH', 'Reviewed file digest does not match Git', { expected: reviewed.changedFileSetSha256, actual: reviewedDigest });

  const postReviewAnchor = seal.status === 'SEALED' ? seal.head : currentHead;
  const postReviewFiles = sortedUnique(git(['-c', 'core.quotePath=false', 'diff', '--name-only', reviewed.head, postReviewAnchor, '--']).split(/\r?\n/u));
  assertCondition(postReviewFiles.length > 0, 'WP_B_M2_REVIEW_EVIDENCE_DELTA_MISSING', 'Review evidence delta is missing');
  assertCondition(postReviewFiles.every(filePath => EXPECTED_POST_REVIEW_PATHS.includes(filePath)), 'WP_B_M2_REVIEW_POST_REVIEW_SCOPE_INVALID', 'Post-review changes exceed the exact seal-only path set', { expected: EXPECTED_POST_REVIEW_PATHS, actual: postReviewFiles });
  if (seal.status === 'PENDING') {
    for (const requiredPath of REQUIRED_PENDING_EVIDENCE_PATHS) {
      assertCondition(postReviewFiles.includes(requiredPath), 'WP_B_M2_REVIEW_EVIDENCE_PATH_MISSING', 'Pending review evidence path is missing', { requiredPath, actual: postReviewFiles });
    }
  } else {
    assertCondition(JSON.stringify(postReviewFiles) === JSON.stringify(EXPECTED_POST_REVIEW_PATHS), 'WP_B_M2_REVIEW_SEAL_DELTA_INVALID', 'Sealed delta must contain the exact four seal paths', { expected: EXPECTED_POST_REVIEW_PATHS, actual: postReviewFiles });
  }

  for (const [filePath, expectedBlob] of Object.entries(document.reviewedBlobs)) {
    let actualBlob;
    try { actualBlob = git(['rev-parse', `${reviewed.head}:${filePath}`]); }
    catch (cause) { throw reviewError('WP_B_M2_REVIEW_BLOB_UNAVAILABLE', 'Reviewed blob is unavailable', { filePath, cause: cause?.message || String(cause) }); }
    assertCondition(actualBlob === expectedBlob, 'WP_B_M2_REVIEW_BLOB_MISMATCH', 'Reviewed blob does not match receipt', { filePath, expected: expectedBlob, actual: actualBlob });
  }

  const redReceipt = readJsonObject(RED_RECEIPT_PATH, 'WP_B_M2_REVIEW_RED_RECEIPT_UNREADABLE');
  const red = document.redEvidence;
  assertCondition(redReceipt.redHead === red.head && redReceipt.workflowRunId === red.workflowRunId, 'WP_B_M2_REVIEW_RED_RECEIPT_MISMATCH', 'M2 RED receipt does not match review evidence');
  assertCondition(redReceipt.platforms?.ubuntu?.jobId === red.ubuntuJobId && redReceipt.platforms?.windows?.jobId === red.windowsJobId, 'WP_B_M2_REVIEW_RED_JOB_MISMATCH', 'M2 RED job IDs do not match');
  assertCondition(redReceipt.platforms?.ubuntu?.artifactId === red.ubuntuArtifactId && redReceipt.platforms?.windows?.artifactId === red.windowsArtifactId, 'WP_B_M2_REVIEW_RED_ARTIFACT_MISMATCH', 'M2 RED artifact IDs do not match');
  assertCondition(redReceipt.platforms?.ubuntu?.secretLeakCount === 0 && redReceipt.platforms?.windows?.secretLeakCount === 0, 'WP_B_M2_REVIEW_RED_SECRET_LEAK_INVALID', 'M2 RED receipt secret leak count changed');
  assertCondition(redReceipt.platforms?.ubuntu?.businessContentLeakCount === 0 && redReceipt.platforms?.windows?.businessContentLeakCount === 0, 'WP_B_M2_REVIEW_RED_CONTENT_LEAK_INVALID', 'M2 RED receipt business leak count changed');

  const branch = git(['branch', '--show-current']);
  assertCondition(branch === EXPECTED_BRANCH, 'WP_B_M2_REVIEW_BRANCH_CHECKOUT_INVALID', 'Review verification must run on the exact implementation branch', { expected: EXPECTED_BRANCH, actual: branch });
  const status = git(['status', '--porcelain=v1', '--untracked-files=all']);
  assertCondition(status === '', 'WP_B_M2_REVIEW_WORKTREE_DIRTY', 'Review verification requires a clean worktree', { status });
  const prerequisites = verifyPrerequisiteReceipts();

  return Object.freeze({
    ok: true,
    reviewedHead: validation.reviewedHead,
    currentHead,
    sealStatus: validation.sealStatus,
    sealHead: validation.sealHead,
    reviewedFileCount: reviewedFiles.length,
    reviewedFileSetSha256: reviewedDigest,
    postReviewFiles: Object.freeze(postReviewFiles),
    ...prerequisites
  });
}

async function fetchJson(url, token, code, timeoutMs = 20000) {
  let response;
  try {
    response = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'User-Agent': 'yance-acv2-wp-b-m2-review-verifier',
        'X-GitHub-Api-Version': '2022-11-28'
      },
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (cause) {
    throw reviewError(code, 'GitHub API request failed or timed out', { url, cause: cause?.message || String(cause) });
  }
  if (!response.ok) {
    const body = (await response.text()).slice(0, 1000);
    throw reviewError(code, 'GitHub API request returned a non-success status', { url, httpStatus: response.status, body });
  }
  return response.json();
}

async function verifyRemoteEvidence(document = readReceipt(), options = {}) {
  validateReceipt(document);
  const token = String(options.token || process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '');
  const repository = String(options.repository || process.env.GITHUB_REPOSITORY || document.repository || '');
  const currentHead = String(options.currentHead || git(['rev-parse', 'HEAD']));
  assertCondition(token.length > 0, 'WP_B_M2_REVIEW_REMOTE_TOKEN_REQUIRED', 'Authenticated GitHub token is required');
  assertCondition(repository === document.repository, 'WP_B_M2_REVIEW_REMOTE_REPOSITORY_INVALID', 'Remote repository must match receipt', { repository, expected: document.repository });

  const apiRoot = `https://api.github.com/repos/${repository}`;
  const verifiedRuns = [];
  for (const expected of document.formalValidation) {
    const actual = await fetchJson(`${apiRoot}/actions/runs/${expected.workflowRunId}`, token, 'WP_B_M2_REVIEW_REMOTE_RUN_REQUEST_FAILED');
    assertCondition(actual.name === expected.workflowName, 'WP_B_M2_REVIEW_REMOTE_NAME_MISMATCH', 'Workflow name does not match receipt', { runId: expected.workflowRunId, expected: expected.workflowName, actual: actual.name });
    assertCondition(actual.head_sha === expected.expectedHead, 'WP_B_M2_REVIEW_REMOTE_HEAD_MISMATCH', 'Workflow is not bound to reviewed Head', { runId: expected.workflowRunId, expected: expected.expectedHead, actual: actual.head_sha });
    assertCondition(actual.status === 'completed' && actual.conclusion === expected.expectedConclusion, 'WP_B_M2_REVIEW_REMOTE_CONCLUSION_MISMATCH', 'Workflow did not complete successfully', { runId: expected.workflowRunId, status: actual.status, conclusion: actual.conclusion });
    assertCondition(Number(actual.run_number) === expected.runNumber, 'WP_B_M2_REVIEW_REMOTE_RUN_NUMBER_MISMATCH', 'Workflow run number does not match receipt', { runId: expected.workflowRunId, expected: expected.runNumber, actual: actual.run_number });

    const jobsPage = await fetchJson(`${apiRoot}/actions/runs/${expected.workflowRunId}/jobs?per_page=100`, token, 'WP_B_M2_REVIEW_REMOTE_JOBS_REQUEST_FAILED');
    const actualJobs = new Map((jobsPage.jobs || []).map(job => [Number(job.id), job]));
    for (const expectedJob of expected.jobs) {
      const actualJob = actualJobs.get(expectedJob.jobId);
      assertCondition(Boolean(actualJob), 'WP_B_M2_REVIEW_REMOTE_JOB_MISSING', 'Recorded workflow job is missing', { runId: expected.workflowRunId, jobId: expectedJob.jobId });
      assertCondition(actualJob.name === expectedJob.name, 'WP_B_M2_REVIEW_REMOTE_JOB_NAME_MISMATCH', 'Workflow job name does not match receipt', { jobId: expectedJob.jobId, expected: expectedJob.name, actual: actualJob.name });
      assertCondition(actualJob.status === 'completed' && actualJob.conclusion === 'success', 'WP_B_M2_REVIEW_REMOTE_JOB_CONCLUSION_MISMATCH', 'Recorded workflow job is not successful', { jobId: expectedJob.jobId, status: actualJob.status, conclusion: actualJob.conclusion });
    }

    if (Array.isArray(expected.artifacts)) {
      const artifactsPage = await fetchJson(`${apiRoot}/actions/runs/${expected.workflowRunId}/artifacts?per_page=100`, token, 'WP_B_M2_REVIEW_REMOTE_ARTIFACTS_REQUEST_FAILED');
      const actualArtifacts = new Map((artifactsPage.artifacts || []).map(artifact => [Number(artifact.id), artifact]));
      for (const expectedArtifact of expected.artifacts) {
        const actualArtifact = actualArtifacts.get(expectedArtifact.artifactId);
        assertCondition(Boolean(actualArtifact), 'WP_B_M2_REVIEW_REMOTE_ARTIFACT_MISSING', 'Recorded artifact is missing', { artifactId: expectedArtifact.artifactId });
        assertCondition(actualArtifact.name === expectedArtifact.name, 'WP_B_M2_REVIEW_REMOTE_ARTIFACT_NAME_MISMATCH', 'Artifact name does not match receipt', { artifactId: expectedArtifact.artifactId });
        assertCondition(actualArtifact.digest === expectedArtifact.digest, 'WP_B_M2_REVIEW_REMOTE_ARTIFACT_DIGEST_MISMATCH', 'Artifact digest does not match receipt', { artifactId: expectedArtifact.artifactId, expected: expectedArtifact.digest, actual: actualArtifact.digest });
        assertCondition(actualArtifact.expired === false, 'WP_B_M2_REVIEW_REMOTE_ARTIFACT_EXPIRED', 'Reviewed artifact is expired', { artifactId: expectedArtifact.artifactId });
        assertCondition(actualArtifact.workflow_run?.head_sha === expected.expectedHead, 'WP_B_M2_REVIEW_REMOTE_ARTIFACT_HEAD_MISMATCH', 'Artifact is not bound to reviewed Head', { artifactId: expectedArtifact.artifactId });
      }
    }
    verifiedRuns.push(Object.freeze({ runId: expected.workflowRunId, name: actual.name, head: actual.head_sha, conclusion: actual.conclusion }));
  }

  const red = document.redEvidence;
  const redRun = await fetchJson(`${apiRoot}/actions/runs/${red.workflowRunId}`, token, 'WP_B_M2_REVIEW_REMOTE_RED_RUN_REQUEST_FAILED');
  assertCondition(redRun.name === red.workflowName && redRun.head_sha === red.head, 'WP_B_M2_REVIEW_REMOTE_RED_IDENTITY_MISMATCH', 'Credible RED workflow identity changed');
  assertCondition(redRun.status === 'completed' && redRun.conclusion === 'failure', 'WP_B_M2_REVIEW_REMOTE_RED_CONCLUSION_MISMATCH', 'Credible RED workflow must remain failed');
  const redJobsPage = await fetchJson(`${apiRoot}/actions/runs/${red.workflowRunId}/jobs?per_page=100`, token, 'WP_B_M2_REVIEW_REMOTE_RED_JOBS_REQUEST_FAILED');
  const redJobs = new Map((redJobsPage.jobs || []).map(job => [Number(job.id), job]));
  for (const jobId of [red.ubuntuJobId, red.windowsJobId]) {
    const job = redJobs.get(jobId);
    assertCondition(Boolean(job), 'WP_B_M2_REVIEW_REMOTE_RED_JOB_MISSING', 'Credible RED job is missing', { jobId });
    assertCondition(job.status === 'completed' && job.conclusion === 'failure', 'WP_B_M2_REVIEW_REMOTE_RED_JOB_CONCLUSION_MISMATCH', 'Credible RED job must remain failed', { jobId, status: job.status, conclusion: job.conclusion });
  }
  const redArtifactsPage = await fetchJson(`${apiRoot}/actions/runs/${red.workflowRunId}/artifacts?per_page=100`, token, 'WP_B_M2_REVIEW_REMOTE_RED_ARTIFACTS_REQUEST_FAILED');
  const redArtifactIds = new Set((redArtifactsPage.artifacts || []).map(artifact => Number(artifact.id)));
  assertCondition(redArtifactIds.has(red.ubuntuArtifactId) && redArtifactIds.has(red.windowsArtifactId), 'WP_B_M2_REVIEW_REMOTE_RED_ARTIFACT_MISSING', 'Credible RED artifacts are missing');

  const pullRequest = await fetchJson(`${apiRoot}/pulls/${document.pullRequest}`, token, 'WP_B_M2_REVIEW_REMOTE_PR_REQUEST_FAILED');
  assertCondition(pullRequest.state === 'open' && pullRequest.draft === true && pullRequest.merged_at == null, 'WP_B_M2_REVIEW_REMOTE_PR_STATE_INVALID', 'PR #17 must remain open, Draft, and unmerged', { state: pullRequest.state, draft: pullRequest.draft, mergedAt: pullRequest.merged_at });
  assertCondition(pullRequest.head?.ref === document.branch && pullRequest.head?.sha === currentHead, 'WP_B_M2_REVIEW_REMOTE_PR_HEAD_INVALID', 'PR Head does not match current evidence/seal Head', { expectedBranch: document.branch, expectedHead: currentHead, actualBranch: pullRequest.head?.ref, actualHead: pullRequest.head?.sha });
  assertCondition(pullRequest.base?.ref === 'main', 'WP_B_M2_REVIEW_REMOTE_PR_BASE_INVALID', 'PR base must remain main');

  return Object.freeze({
    ok: true,
    reviewedHead: document.reviewedImplementation.head,
    currentHead,
    verifiedRunCount: verifiedRuns.length,
    verifiedRuns: Object.freeze(verifiedRuns),
    credibleRedVerified: true,
    prDraftOpenUnmerged: true
  });
}

async function main() {
  const document = readReceipt();
  const local = verifyLocalRepository(document);
  const remote = process.argv.includes('--remote') ? await verifyRemoteEvidence(document, { currentHead: local.currentHead }) : null;
  process.stdout.write(`${JSON.stringify({ ok: true, local, remote }, null, 2)}\n`);
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`${JSON.stringify({
      ok: false,
      code: error?.code || 'WP_B_M2_REVIEW_VERIFICATION_FAILED',
      message: error?.message || String(error),
      details: Object.fromEntries(Object.entries(error || {}).filter(([key]) => !['stack', 'message'].includes(key)))
    }, null, 2)}\n`);
    process.exitCode = 1;
  });
}

module.exports = Object.freeze({
  EXPECTED_FORMAL_WORKFLOWS,
  EXPECTED_OPERATION_KINDS,
  EXPECTED_POST_REVIEW_PATHS,
  changedFileSetSha256,
  readReceipt,
  sortedUnique,
  validateReceipt,
  verifyLocalRepository,
  verifyRemoteEvidence
});
