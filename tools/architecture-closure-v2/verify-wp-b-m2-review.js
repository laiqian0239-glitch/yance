#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { isAuthorizedWpBImplementationBranch } = require('../../shared/release/acv2ActiveWorkPackageAuthority');

const ROOT = path.resolve(__dirname, '..', '..');
const RECEIPT = path.join(ROOT, 'governance', 'architecture-closure-v2', 'wp-b-m2-review.json');
const RED_RECEIPT = path.join(ROOT, 'governance', 'architecture-closure-v2', 'wp-b-m2-red-evidence.json');
const REPOSITORY = 'laiqian0239-glitch/yance';
const BRANCH = 'acv2/wp-b-durable-execution-outbox';
const M1_SEAL = '1e3d600f0647af35e737ff92a200c67e69224c82';
const FULL_SHA = /^[a-f0-9]{40}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const TRUSTED_POLICY_PATHS = Object.freeze([
  'shared/release/implementationBranchPolicy.js',
  'shared/release/implementationBranchPolicyLegacy.js',
  'release/release-source.json'
]);
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
const PENDING_PATHS = Object.freeze([
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
const FINDINGS = Object.freeze(['WP-B-M2-IR-001', 'WP-B-M2-IR-002', 'WP-B-M2-IR-003']);
const IMPLEMENTATION_PR_ROLES = Object.freeze({
  WP_B_SUCCESSOR: 'WP_B_SUCCESSOR',
  GENERIC_DELEGATED: 'GENERIC_DELEGATED'
});

function fail(code, message, details = {}) {
  throw Object.assign(new Error(message), { code, ...details });
}
function requireThat(value, code, message, details = {}) {
  if (!value) fail(code, message, details);
}
function isHistoricalPrStateValidForBranch(historicalPr, currentBranch, historicalBranch = BRANCH) {
  const openDraftUnmerged = historicalPr?.state === 'open'
    && historicalPr?.draft === true
    && historicalPr?.merged_at == null;
  const closedMerged = historicalPr?.state === 'closed'
    && historicalPr?.merged_at != null;
  return currentBranch === historicalBranch
    ? openDraftUnmerged
    : (openDraftUnmerged || closedMerged);
}
function isRemoteArtifactIdentityValid(artifact, expectedArtifact, expectedHead) {
  return Number(artifact?.id) === Number(expectedArtifact?.artifactId)
    && artifact?.name === expectedArtifact?.name
    && artifact?.digest === expectedArtifact?.digest
    && artifact?.workflow_run?.head_sha === expectedHead;
}
function sortedUnique(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map(value => String(value || '').trim().replace(/\\/gu, '/'))
    .filter(Boolean))].sort();
}
function changedFileSetSha256(values) {
  const files = sortedUnique(values);
  return crypto.createHash('sha256').update(`${files.join('\n')}\n`, 'utf8').digest('hex');
}
function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
function gitAt(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
function isAuthorizedReviewImplementationBranch(currentBranch, options = {}) {
  const repositoryRoot = path.resolve(options.repositoryRoot || ROOT);
  try {
    if (isAuthorizedWpBImplementationBranch(currentBranch, undefined, { repositoryRoot })) return true;

    const trustedPolicyRootValue = String(options.trustedPolicyRoot || process.env.TRUSTED_POLICY_ROOT || '').trim();
    const trustedMainHead = String(options.trustedMainHead || process.env.TRUSTED_POLICY_SHA || '').trim();
    const evaluatedHead = String(options.evaluatedHead || process.env.VALIDATION_SHA || '').trim();
    if (!trustedPolicyRootValue || !FULL_SHA.test(trustedMainHead) || !FULL_SHA.test(evaluatedHead)) return false;

    const repositoryRealRoot = fs.realpathSync(repositoryRoot);
    const trustedPolicyRoot = fs.realpathSync(path.resolve(trustedPolicyRootValue));
    if (repositoryRealRoot === trustedPolicyRoot) return false;
    if (gitAt(repositoryRealRoot, ['rev-parse', 'HEAD']) !== evaluatedHead) return false;
    if (gitAt(trustedPolicyRoot, ['rev-parse', 'HEAD']) !== trustedMainHead) return false;
    gitAt(trustedPolicyRoot, ['cat-file', '-e', `${trustedMainHead}^{commit}`]);

    for (const repoPath of TRUSTED_POLICY_PATHS) {
      const expectedBlob = gitAt(trustedPolicyRoot, ['rev-parse', `${trustedMainHead}:${repoPath}`]);
      const actualBlob = gitAt(trustedPolicyRoot, ['hash-object', repoPath]);
      if (actualBlob !== expectedBlob) return false;
    }

    const releaseSource = JSON.parse(fs.readFileSync(path.join(trustedPolicyRoot, 'release', 'release-source.json'), 'utf8'));
    const policy = require(path.join(trustedPolicyRoot, 'shared', 'release', 'implementationBranchPolicy'));
    return policy.isAuthorizedImplementationBranch(currentBranch, releaseSource.stageVersion, {
      delegatedGovernance: { trustedMainHead, evaluatedHead }
    }) === true;
  } catch (_) {
    return false;
  }
}
function resolveDelegatedImplementationPrRole(currentBranch, options = {}) {
  if (currentBranch === BRANCH) return null;
  const repositoryRoot = path.resolve(options.repositoryRoot || ROOT);
  try {
    if (!isAuthorizedReviewImplementationBranch(currentBranch, options)) return null;
    const trustedPolicyRootValue = String(options.trustedPolicyRoot || process.env.TRUSTED_POLICY_ROOT || '').trim();
    const trustedMainHead = String(options.trustedMainHead || process.env.TRUSTED_POLICY_SHA || '').trim();
    const evaluatedHead = String(options.evaluatedHead || process.env.VALIDATION_SHA || '').trim();
    if (!trustedPolicyRootValue || !FULL_SHA.test(trustedMainHead) || !FULL_SHA.test(evaluatedHead)) return null;
    const trustedPolicyRoot = fs.realpathSync(path.resolve(trustedPolicyRootValue));
    const repositoryRealRoot = fs.realpathSync(repositoryRoot);
    if (repositoryRealRoot === trustedPolicyRoot) return null;
    const isWpBLineage = isAuthorizedWpBImplementationBranch(currentBranch, undefined, {
      repositoryRoot: trustedPolicyRoot,
      delegatedGovernance: { trustedMainHead, evaluatedHead }
    });
    return isWpBLineage
      ? IMPLEMENTATION_PR_ROLES.WP_B_SUCCESSOR
      : IMPLEMENTATION_PR_ROLES.GENERIC_DELEGATED;
  } catch (_) {
    return null;
  }
}
function isCurrentImplementationPrValid(candidate, currentBranch, currentHead, role) {
  return (role === IMPLEMENTATION_PR_ROLES.WP_B_SUCCESSOR
      || role === IMPLEMENTATION_PR_ROLES.GENERIC_DELEGATED)
    && candidate?.state === 'open'
    && candidate?.merged_at == null
    && candidate?.head?.ref === currentBranch
    && candidate?.base?.ref === 'main'
    && candidate?.head?.sha === currentHead
    && typeof candidate?.draft === 'boolean'
    && (role !== IMPLEMENTATION_PR_ROLES.WP_B_SUCCESSOR || candidate.draft === true);
}
function isCurrentImplementationPrSetValid(candidatePrs, currentBranch, currentHead, role) {
  const matches = Array.isArray(candidatePrs)
    ? candidatePrs.filter(candidate => candidate?.head?.ref === currentBranch && candidate?.base?.ref === 'main')
    : [];
  return matches.length === 1
    && isCurrentImplementationPrValid(matches[0], currentBranch, currentHead, role);
}
function readJson(file, code) {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    requireThat(value && typeof value === 'object' && !Array.isArray(value), code, 'Expected JSON object', { file });
    return value;
  } catch (cause) {
    if (cause?.code?.startsWith?.('WP_B_M2_REVIEW_')) throw cause;
    fail(code, 'Unreadable JSON', { file, cause: cause?.message || String(cause) });
  }
}
function readReceipt(file = RECEIPT) {
  return readJson(file, 'WP_B_M2_REVIEW_RECEIPT_UNREADABLE');
}

function validateRunSet(runs, expectedHead, prefix) {
  requireThat(Array.isArray(runs) && runs.length === EXPECTED_FORMAL_WORKFLOWS.length, `${prefix}_SET_INVALID`, 'Exactly eight workflows are required');
  requireThat(JSON.stringify(sortedUnique(runs.map(run => run?.workflowName))) === JSON.stringify(EXPECTED_FORMAL_WORKFLOWS), `${prefix}_NAMES_INVALID`, 'Workflow set is invalid');
  const runIds = new Set();
  const jobIds = new Set();
  for (const run of runs) {
    requireThat(Number.isSafeInteger(run?.workflowRunId) && run.workflowRunId > 0 && !runIds.has(run.workflowRunId), `${prefix}_RUN_INVALID`, 'Run id is invalid or duplicated', { workflowName: run?.workflowName });
    runIds.add(run.workflowRunId);
    requireThat(Number.isSafeInteger(run.runNumber) && run.runNumber > 0, `${prefix}_RUN_NUMBER_INVALID`, 'Run number is invalid', { workflowName: run.workflowName });
    requireThat(run.expectedHead === expectedHead, `${prefix}_HEAD_INVALID`, 'Run is not bound to expected Head', { workflowName: run.workflowName });
    requireThat(run.expectedConclusion === 'success', `${prefix}_CONCLUSION_INVALID`, 'Run must require success', { workflowName: run.workflowName });
    requireThat(Array.isArray(run.jobs) && run.jobs.length > 0, `${prefix}_JOBS_INVALID`, 'Successful jobs are required', { workflowName: run.workflowName });
    for (const job of run.jobs) {
      requireThat(Number.isSafeInteger(job?.jobId) && job.jobId > 0 && !jobIds.has(job.jobId), `${prefix}_JOB_ID_INVALID`, 'Job id is invalid or duplicated', { workflowName: run.workflowName, jobId: job?.jobId });
      jobIds.add(job.jobId);
      requireThat(typeof job.name === 'string' && job.name.trim(), `${prefix}_JOB_NAME_INVALID`, 'Job name is invalid', { jobId: job.jobId });
    }
  }
  return true;
}

function validateReceipt(document) {
  requireThat(document?.schemaVersion === 1, 'WP_B_M2_REVIEW_SCHEMA_INVALID', 'Schema is invalid');
  requireThat(document.documentType === 'YANCE_ACV2_WP_B_M2_REVIEW', 'WP_B_M2_REVIEW_TYPE_INVALID', 'Type is invalid');
  requireThat(document.program === 'Architecture Closure V2' && document.repository === REPOSITORY && document.workPackage === 'WP-B', 'WP_B_M2_REVIEW_IDENTITY_INVALID', 'Program identity is invalid');
  requireThat(document.pullRequest === 17 && document.branch === BRANCH, 'WP_B_M2_REVIEW_PR_INVALID', 'PR binding is invalid');

  const reviewed = document.reviewedImplementation || {};
  requireThat(FULL_SHA.test(String(reviewed.head || '')), 'WP_B_M2_REVIEW_HEAD_INVALID', 'Reviewed Head is invalid');
  requireThat(FULL_SHA.test(String(reviewed.baselineHead || '')), 'WP_B_M2_REVIEW_BASELINE_INVALID', 'Baseline is invalid');
  requireThat(reviewed.parentMilestone1SealHead === M1_SEAL, 'WP_B_M2_REVIEW_PARENT_SEAL_INVALID', 'M1 Seal changed');
  requireThat(Number.isInteger(reviewed.changedFileCount) && reviewed.changedFileCount > 0, 'WP_B_M2_REVIEW_FILE_COUNT_INVALID', 'File count is invalid');
  requireThat(SHA256.test(String(reviewed.changedFileSetSha256 || '')), 'WP_B_M2_REVIEW_FILE_DIGEST_INVALID', 'File digest is invalid');
  requireThat(JSON.stringify(reviewed.operationKinds) === JSON.stringify(EXPECTED_OPERATION_KINDS), 'WP_B_M2_REVIEW_OPERATION_ORDER_INVALID', 'Operation order is invalid');

  const review = document.review || {};
  requireThat(review.reviewerType === 'INDEPENDENT_SOFTWARE_AUDIT_AGENT', 'WP_B_M2_REVIEW_REVIEWER_TYPE_INVALID', 'Reviewer type is invalid');
  requireThat(review.reviewerIdentity === 'OpenAI GPT-5.6 Thinking', 'WP_B_M2_REVIEW_REVIEWER_IDENTITY_INVALID', 'Reviewer identity is invalid');
  requireThat(review.reviewContext === '独立软件工程审计' && review.reviewMode === 'POST_REMEDIATION_SEPARATE_REVIEW_PASS', 'WP_B_M2_REVIEW_MODE_INVALID', 'Review mode is invalid');
  requireThat(review.humanApprovalClaimed === false, 'WP_B_M2_REVIEW_HUMAN_CLAIM_INVALID', 'Human approval cannot be claimed');
  requireThat(review.reviewGate2 === 'APPROVED' && review.milestone1 === 'SEALED' && review.milestone3 === 'NOT_STARTED', 'WP_B_M2_REVIEW_GATE_NOT_APPROVED', 'Review states are invalid');
  requireThat(['REVIEWED_NOT_SEALED', 'SEALED'].includes(review.milestone2), 'WP_B_M2_REVIEW_M2_STATE_INVALID', 'M2 state is invalid');
  requireThat(typeof review.conclusion === 'string' && review.conclusion.length > 40, 'WP_B_M2_REVIEW_CONCLUSION_INVALID', 'Conclusion is incomplete');

  const red = document.redEvidence || {};
  requireThat(red.workflowName === 'WP-B M2 Contracts' && Number.isSafeInteger(red.workflowRunId), 'WP_B_M2_REVIEW_RED_RUN_INVALID', 'RED run is invalid');
  requireThat(FULL_SHA.test(String(red.head || '')) && red.expectedConclusion === 'failure' && red.contractResult === '0_OF_26_PASS', 'WP_B_M2_REVIEW_RED_RESULT_INVALID', 'Credible RED changed');
  for (const field of ['ubuntuJobId', 'windowsJobId', 'ubuntuArtifactId', 'windowsArtifactId']) requireThat(Number.isSafeInteger(red[field]) && red[field] > 0, 'WP_B_M2_REVIEW_RED_ID_INVALID', 'RED id is invalid', { field });
  requireThat(red.secretLeakCount === 0 && red.businessContentLeakCount === 0, 'WP_B_M2_REVIEW_RED_LEAK_INVALID', 'RED leak counts changed');

  requireThat(Array.isArray(document.findings) && JSON.stringify(document.findings.map(item => item?.id)) === JSON.stringify(FINDINGS), 'WP_B_M2_REVIEW_FINDINGS_INVALID', 'Finding set is invalid');
  for (const finding of document.findings) {
    requireThat(finding.severity === 'P0', 'WP_B_M2_REVIEW_FINDING_SEVERITY_INVALID', 'Finding severity changed', { findingId: finding.id });
    for (const field of ['invariant', 'title', 'reproducibleContract', 'resolution']) requireThat(typeof finding[field] === 'string' && finding[field].trim(), 'WP_B_M2_REVIEW_FINDING_SHAPE_INVALID', 'Finding is incomplete', { findingId: finding.id, field });
  }

  validateRunSet(document.formalValidation, reviewed.head, 'WP_B_M2_REVIEW_VALIDATION');
  const contracts = document.formalValidation.find(run => run.workflowName === 'WP-B M2 Contracts');
  requireThat(Array.isArray(contracts?.artifacts) && contracts.artifacts.length === 2, 'WP_B_M2_REVIEW_CONTRACT_ARTIFACTS_INVALID', 'Two contract artifacts are required');
  for (const artifact of contracts.artifacts) {
    requireThat(Number.isSafeInteger(artifact.artifactId) && artifact.artifactId > 0 && DIGEST.test(String(artifact.digest || '')) && SHA256.test(String(artifact.normalizedOutputSha256 || '')), 'WP_B_M2_REVIEW_CONTRACT_ARTIFACT_INVALID', 'Contract artifact is invalid');
  }
  const evidence = contracts.contractEvidence || {};
  requireThat(evidence.testCount === 89 && evidence.passCount === 89 && evidence.failCount === 0, 'WP_B_M2_REVIEW_CONTRACT_COUNTS_INVALID', 'Contract counts changed');
  requireThat(evidence.matchedInfrastructurePattern === null && evidence.secretLeakCount === 0 && evidence.businessContentLeakCount === 0, 'WP_B_M2_REVIEW_CONTRACT_EVIDENCE_INVALID', 'Contract evidence changed');

  const blobs = document.reviewedBlobs || {};
  requireThat(Object.keys(blobs).length >= 10, 'WP_B_M2_REVIEW_BLOB_SET_INVALID', 'Blob set is incomplete');
  for (const [file, blob] of Object.entries(blobs)) requireThat(file && !file.startsWith('/') && !file.includes('..') && FULL_SHA.test(String(blob || '')), 'WP_B_M2_REVIEW_BLOB_INVALID', 'Blob binding is invalid', { file });

  const seal = document.seal || {};
  requireThat(['PENDING', 'SEALED'].includes(seal.status), 'WP_B_M2_REVIEW_SEAL_STATUS_INVALID', 'Seal state is invalid');
  requireThat(JSON.stringify(sortedUnique(seal.allowedPostReviewPaths)) === JSON.stringify(EXPECTED_POST_REVIEW_PATHS), 'WP_B_M2_REVIEW_SEAL_PATHS_INVALID', 'Seal path set is invalid');
  requireThat(seal.temporaryBypassAllowed === false && seal.warningOnlyClosureAllowed === false, 'WP_B_M2_REVIEW_SEAL_POLICY_INVALID', 'Seal policy is invalid');
  if (seal.status === 'PENDING') {
    requireThat(seal.head === '' && review.milestone2 === 'REVIEWED_NOT_SEALED', 'WP_B_M2_REVIEW_PENDING_STATE_INVALID', 'Pending state is invalid');
    requireThat(seal.formalValidation == null || (Array.isArray(seal.formalValidation) && seal.formalValidation.length === 0), 'WP_B_M2_REVIEW_PENDING_SEAL_VALIDATION_INVALID', 'Pending receipt cannot claim Seal validation');
  } else {
    requireThat(FULL_SHA.test(String(seal.head || '')) && review.milestone2 === 'SEALED', 'WP_B_M2_REVIEW_SEALED_STATE_INVALID', 'Sealed state is invalid');
    validateRunSet(seal.formalValidation, seal.head, 'WP_B_M2_REVIEW_SEAL_VALIDATION');
  }

  const governance = document.governance || {};
  requireThat(governance.prMustRemainDraft === true && governance.milestone2Authorized === true && governance.credibleM2RedRecorded === true && governance.milestone2Reviewed === true, 'WP_B_M2_REVIEW_GOVERNANCE_PREREQUISITE_INVALID', 'Governance prerequisites changed');
  requireThat(governance.milestone2Sealed === (seal.status === 'SEALED'), 'WP_B_M2_REVIEW_GOVERNANCE_SEAL_MISMATCH', 'Governance seal state is inconsistent');
  for (const field of ['readyForPromotion', 'milestone3Authorized', 'mergeAuthorized', 'productionUseAuthorized', 'wpCAuthorized', 'formalRelease', 'publish', 'temporaryBypassAllowed', 'warningOnlyClosureAllowed']) requireThat(governance[field] === false, 'WP_B_M2_REVIEW_GOVERNANCE_OPEN', 'Downstream authority opened', { field });

  return Object.freeze({ ok: true, reviewedHead: reviewed.head, baselineHead: reviewed.baselineHead, parentMilestone1SealHead: reviewed.parentMilestone1SealHead, sealStatus: seal.status, sealHead: seal.head });
}

function prerequisites() {
  const m1Path = path.join(ROOT, 'tools', 'architecture-closure-v2', 'verify-wp-b-m1-review.js');
  const authorizationPath = path.join(ROOT, 'tools', 'architecture-closure-v2', 'verify-wp-b-m2-authorization.js');
  delete require.cache[require.resolve(m1Path)];
  delete require.cache[require.resolve(authorizationPath)];
  const m1 = require(m1Path);
  const authorization = require(authorizationPath);
  const m1Receipt = m1.readReceipt();
  const m1Validation = m1.validateReceipt(m1Receipt);
  const m1Local = m1.verifyLocalRepository(m1Receipt);
  const authorizationReceipt = authorization.readReceipt();
  const authorizationValidation = authorization.validateReceipt(authorizationReceipt);
  const authorizationLocal = authorization.verifyLocalRepository(authorizationReceipt);
  requireThat(m1Validation.sealHead === M1_SEAL && authorizationValidation.parentMilestone1SealHead === M1_SEAL, 'WP_B_M2_REVIEW_PREREQUISITE_INVALID', 'Prerequisite seal changed');
  return { m1SealVerified: m1Local.ok === true, m2AuthorizationVerified: authorizationLocal.ok === true };
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
    fail('WP_B_M2_REVIEW_GIT_ANCESTRY_INVALID', 'Git ancestry is invalid', { cause: cause?.message || String(cause) });
  }
  const reviewedFiles = sortedUnique(git(['-c', 'core.quotePath=false', 'diff', '--name-only', reviewed.baselineHead, reviewed.head, '--']).split(/\r?\n/u));
  const reviewedDigest = changedFileSetSha256(reviewedFiles);
  requireThat(reviewedFiles.length === reviewed.changedFileCount, 'WP_B_M2_REVIEW_FILE_COUNT_MISMATCH', 'File count does not match Git', { expected: reviewed.changedFileCount, actual: reviewedFiles.length });
  requireThat(reviewedDigest === reviewed.changedFileSetSha256, 'WP_B_M2_REVIEW_FILE_DIGEST_MISMATCH', 'File digest does not match Git', { expected: reviewed.changedFileSetSha256, actual: reviewedDigest });
  const anchor = seal.status === 'SEALED' ? seal.head : currentHead;
  const postReviewFiles = sortedUnique(git(['-c', 'core.quotePath=false', 'diff', '--name-only', reviewed.head, anchor, '--']).split(/\r?\n/u));
  requireThat(postReviewFiles.length > 0 && postReviewFiles.every(file => EXPECTED_POST_REVIEW_PATHS.includes(file)), 'WP_B_M2_REVIEW_POST_REVIEW_SCOPE_INVALID', 'Post-review scope is invalid', { actual: postReviewFiles });
  if (seal.status === 'PENDING') for (const file of PENDING_PATHS) requireThat(postReviewFiles.includes(file), 'WP_B_M2_REVIEW_EVIDENCE_PATH_MISSING', 'Pending evidence path is missing', { file });
  else requireThat(JSON.stringify(postReviewFiles) === JSON.stringify(EXPECTED_POST_REVIEW_PATHS), 'WP_B_M2_REVIEW_SEAL_DELTA_INVALID', 'Seal delta is not exact', { actual: postReviewFiles });

  for (const [file, expected] of Object.entries(document.reviewedBlobs)) {
    let actual;
    try { actual = git(['rev-parse', `${reviewed.head}:${file}`]); }
    catch (cause) { fail('WP_B_M2_REVIEW_BLOB_UNAVAILABLE', 'Reviewed blob is unavailable', { file, cause: cause?.message || String(cause) }); }
    requireThat(actual === expected, 'WP_B_M2_REVIEW_BLOB_MISMATCH', 'Reviewed blob changed', { file, expected, actual });
  }
  const redReceipt = readJson(RED_RECEIPT, 'WP_B_M2_REVIEW_RED_RECEIPT_UNREADABLE');
  const red = document.redEvidence;
  requireThat(redReceipt.redHead === red.head && redReceipt.workflowRunId === red.workflowRunId, 'WP_B_M2_REVIEW_RED_RECEIPT_MISMATCH', 'RED receipt changed');
  requireThat(redReceipt.platforms?.ubuntu?.jobId === red.ubuntuJobId && redReceipt.platforms?.windows?.jobId === red.windowsJobId, 'WP_B_M2_REVIEW_RED_JOB_MISMATCH', 'RED jobs changed');
  requireThat(redReceipt.platforms?.ubuntu?.artifactId === red.ubuntuArtifactId && redReceipt.platforms?.windows?.artifactId === red.windowsArtifactId, 'WP_B_M2_REVIEW_RED_ARTIFACT_MISMATCH', 'RED artifacts changed');
  const currentBranch = git(['branch', '--show-current']);
  requireThat(isAuthorizedReviewImplementationBranch(currentBranch),
    'WP_B_M2_REVIEW_BRANCH_CHECKOUT_INVALID', 'Wrong or unauthorized branch');
  const status = git(['status', '--porcelain=v1', '--untracked-files=all']);
  requireThat(status === '', 'WP_B_M2_REVIEW_WORKTREE_DIRTY', 'Worktree must be clean', { status });
  return Object.freeze({ ok: true, reviewedHead: validation.reviewedHead, currentHead, currentBranch, sealStatus: validation.sealStatus, sealHead: validation.sealHead, reviewedFileCount: reviewedFiles.length, reviewedFileSetSha256: reviewedDigest, postReviewFiles: Object.freeze(postReviewFiles), ...prerequisites() });
}

async function fetchJson(url, token, code) {
  let response;
  try {
    response = await fetch(url, {
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'User-Agent': 'yance-acv2-wp-b-m2-review-verifier', 'X-GitHub-Api-Version': '2022-11-28' },
      signal: AbortSignal.timeout(20000)
    });
  } catch (cause) { fail(code, 'GitHub API request failed', { url, cause: cause?.message || String(cause) }); }
  if (!response.ok) fail(code, 'GitHub API returned non-success', { url, status: response.status, body: (await response.text()).slice(0, 1000) });
  return response.json();
}

async function verifyRunSetRemote(api, token, runs, expectedHead, prefix) {
  const verified = [];
  for (const expected of runs) {
    const run = await fetchJson(`${api}/actions/runs/${expected.workflowRunId}`, token, `${prefix}_RUN_REQUEST_FAILED`);
    requireThat(run.name === expected.workflowName && run.head_sha === expectedHead, `${prefix}_IDENTITY_MISMATCH`, 'Remote run identity changed', { runId: expected.workflowRunId });
    requireThat(run.status === 'completed' && run.conclusion === 'success' && Number(run.run_number) === expected.runNumber, `${prefix}_CONCLUSION_MISMATCH`, 'Remote run is not exact success', { runId: expected.workflowRunId });
    const page = await fetchJson(`${api}/actions/runs/${expected.workflowRunId}/jobs?per_page=100`, token, `${prefix}_JOBS_REQUEST_FAILED`);
    const jobs = new Map((page.jobs || []).map(job => [Number(job.id), job]));
    for (const expectedJob of expected.jobs) {
      const job = jobs.get(expectedJob.jobId);
      requireThat(job?.name === expectedJob.name && job.status === 'completed' && job.conclusion === 'success', `${prefix}_JOB_MISMATCH`, 'Remote job is not exact success', { jobId: expectedJob.jobId });
    }
    if (Array.isArray(expected.artifacts)) {
      const artifactPage = await fetchJson(`${api}/actions/runs/${expected.workflowRunId}/artifacts?per_page=100`, token, `${prefix}_ARTIFACTS_REQUEST_FAILED`);
      const artifacts = new Map((artifactPage.artifacts || []).map(item => [Number(item.id), item]));
      for (const expectedArtifact of expected.artifacts) {
        const artifact = artifacts.get(expectedArtifact.artifactId);
        requireThat(isRemoteArtifactIdentityValid(artifact, expectedArtifact, expectedHead), `${prefix}_ARTIFACT_MISMATCH`, 'Remote artifact changed', { artifactId: expectedArtifact.artifactId });
      }
    }
    verified.push(Object.freeze({ runId: expected.workflowRunId, name: run.name, head: run.head_sha, conclusion: run.conclusion }));
  }
  return Object.freeze(verified);
}

async function verifyRemoteEvidence(document = readReceipt(), options = {}) {
  validateReceipt(document);
  const token = String(options.token || process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '');
  const repository = String(options.repository || process.env.GITHUB_REPOSITORY || document.repository || '');
  const currentHead = String(options.currentHead || git(['rev-parse', 'HEAD']));
  const currentBranch = String(options.currentBranch || git(['branch', '--show-current']));
  requireThat(isAuthorizedReviewImplementationBranch(currentBranch),
    'WP_B_M2_REVIEW_REMOTE_BRANCH_INVALID', 'Current branch is not an authorized WP-B implementation branch');
  requireThat(token && repository === REPOSITORY, 'WP_B_M2_REVIEW_REMOTE_TOKEN_REQUIRED', 'Authenticated repository token is required');
  const api = `https://api.github.com/repos/${repository}`;
  const reviewedRuns = await verifyRunSetRemote(api, token, document.formalValidation, document.reviewedImplementation.head, 'WP_B_M2_REVIEW_REMOTE');
  const sealRuns = document.seal.status === 'SEALED'
    ? await verifyRunSetRemote(api, token, document.seal.formalValidation, document.seal.head, 'WP_B_M2_REVIEW_REMOTE_SEAL')
    : Object.freeze([]);

  const red = document.redEvidence;
  const redRun = await fetchJson(`${api}/actions/runs/${red.workflowRunId}`, token, 'WP_B_M2_REVIEW_REMOTE_RED_RUN_REQUEST_FAILED');
  requireThat(redRun.name === red.workflowName && redRun.head_sha === red.head && redRun.status === 'completed' && redRun.conclusion === 'failure', 'WP_B_M2_REVIEW_REMOTE_RED_MISMATCH', 'Remote RED changed');
  const redJobsPage = await fetchJson(`${api}/actions/runs/${red.workflowRunId}/jobs?per_page=100`, token, 'WP_B_M2_REVIEW_REMOTE_RED_JOBS_REQUEST_FAILED');
  const redJobs = new Map((redJobsPage.jobs || []).map(job => [Number(job.id), job]));
  for (const id of [red.ubuntuJobId, red.windowsJobId]) requireThat(redJobs.get(id)?.conclusion === 'failure', 'WP_B_M2_REVIEW_REMOTE_RED_JOB_MISSING', 'RED job changed', { jobId: id });
  const redArtifactsPage = await fetchJson(`${api}/actions/runs/${red.workflowRunId}/artifacts?per_page=100`, token, 'WP_B_M2_REVIEW_REMOTE_RED_ARTIFACTS_REQUEST_FAILED');
  const redArtifacts = new Set((redArtifactsPage.artifacts || []).map(item => Number(item.id)));
  requireThat(redArtifacts.has(red.ubuntuArtifactId) && redArtifacts.has(red.windowsArtifactId), 'WP_B_M2_REVIEW_REMOTE_RED_ARTIFACT_MISSING', 'RED artifacts changed');

  const historicalPr = await fetchJson(`${api}/pulls/${document.pullRequest}`, token, 'WP_B_M2_REVIEW_REMOTE_PR_REQUEST_FAILED');
  requireThat(isHistoricalPrStateValidForBranch(historicalPr, currentBranch, BRANCH),
    'WP_B_M2_REVIEW_REMOTE_PR_STATE_INVALID',
    currentBranch === BRANCH
      ? 'Historical branch PR must remain Draft/open/unmerged'
      : 'Historical PR state is invalid for successor evidence');
  requireThat(historicalPr.head?.ref === document.branch && historicalPr.base?.ref === 'main',
    'WP_B_M2_REVIEW_REMOTE_PR_HEAD_INVALID', 'Historical PR refs changed');

  let currentPrRole = 'WP_B_HISTORICAL';
  let prDraftOpenUnmerged = true;
  if (currentBranch === BRANCH) {
    requireThat(historicalPr.head?.sha === currentHead,
      'WP_B_M2_REVIEW_REMOTE_PR_HEAD_INVALID', 'Historical PR Head changed', { currentHead, actual: historicalPr.head?.sha });
  } else {
    currentPrRole = resolveDelegatedImplementationPrRole(currentBranch);
    requireThat(currentPrRole !== null,
      'WP_B_M2_REVIEW_REMOTE_SUCCESSOR_PR_INVALID', 'Current implementation PR role could not be proven');
    const owner = repository.split('/')[0];
    const candidatePrs = await fetchJson(
      `${api}/pulls?state=open&base=main&head=${encodeURIComponent(`${owner}:${currentBranch}`)}&per_page=10`,
      token,
      'WP_B_M2_REVIEW_REMOTE_SUCCESSOR_PR_REQUEST_FAILED'
    );
    requireThat(isCurrentImplementationPrSetValid(candidatePrs, currentBranch, currentHead, currentPrRole),
      'WP_B_M2_REVIEW_REMOTE_SUCCESSOR_PR_INVALID', 'Current implementation PR must be exact/open/unmerged and satisfy WP-B Draft lifecycle when applicable',
      { currentBranch, currentHead, currentPrRole, matches: Array.isArray(candidatePrs) ? candidatePrs.map(candidate => ({ number: candidate.number, state: candidate.state, base: candidate.base?.ref, head: candidate.head?.sha, draft: candidate.draft })) : [] });
    const currentPr = candidatePrs.find(candidate => candidate?.head?.ref === currentBranch && candidate?.base?.ref === 'main');
    prDraftOpenUnmerged = currentPr.draft === true;
  }

  return Object.freeze({ ok: true, reviewedHead: document.reviewedImplementation.head, currentHead, currentBranch, verifiedRunCount: reviewedRuns.length, verifiedRuns: reviewedRuns, verifiedSealRunCount: sealRuns.length, verifiedSealRuns: sealRuns, credibleRedVerified: true, currentPrRole, prExactOpenUnmerged: true, prDraftOpenUnmerged });
}

async function main() {
  const document = readReceipt();
  const local = verifyLocalRepository(document);
  const remote = process.argv.includes('--remote') ? await verifyRemoteEvidence(document, { currentHead: local.currentHead, currentBranch: local.currentBranch }) : null;
  process.stdout.write(`${JSON.stringify({ ok: true, local, remote }, null, 2)}\n`);
}
if (require.main === module) main().catch(error => {
  process.stderr.write(`${JSON.stringify({ ok: false, code: error?.code || 'WP_B_M2_REVIEW_VERIFICATION_FAILED', message: error?.message || String(error), details: Object.fromEntries(Object.entries(error || {}).filter(([key]) => !['stack', 'message'].includes(key))) }, null, 2)}\n`);
  process.exitCode = 1;
});
module.exports = Object.freeze({ EXPECTED_FORMAL_WORKFLOWS, EXPECTED_OPERATION_KINDS, EXPECTED_POST_REVIEW_PATHS, IMPLEMENTATION_PR_ROLES, changedFileSetSha256, isAuthorizedReviewImplementationBranch, isCurrentImplementationPrSetValid, isCurrentImplementationPrValid, isHistoricalPrStateValidForBranch, isRemoteArtifactIdentityValid, readReceipt, resolveDelegatedImplementationPrRole, sortedUnique, validateReceipt, verifyLocalRepository, verifyRemoteEvidence });
