#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPOSITORY_ROOT = path.resolve(__dirname, '..', '..');
const RECEIPT_PATH = path.join(
  REPOSITORY_ROOT,
  'governance',
  'architecture-closure-v2',
  'wp-b-m1-review.json'
);
const FULL_SHA = /^[a-f0-9]{40}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const EXPECTED_DOCUMENT_TYPE = 'YANCE_ACV2_WP_B_M1_REVIEW_SEAL';
const EXPECTED_REPOSITORY = 'laiqian0239-glitch/yance';
const EXPECTED_SEAL_PATHS = Object.freeze([
  '.github/workflows/wp-b-m1-independent-review-integrity.yml',
  'backend/tests/architectureClosureV2/wpB/m1ReviewSeal.test.js',
  'governance/architecture-closure-v2/wp-b-m1-review.json',
  'tools/architecture-closure-v2/verify-wp-b-m1-review.js'
]);

function governanceError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, ...details });
}

function assertCondition(condition, code, message, details = {}) {
  if (!condition) throw governanceError(code, message, details);
}

function sortedUnique(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map(value => String(value || '').trim().replace(/\\/gu, '/'))
    .filter(Boolean))].sort();
}

function changedFileSetSha256(values) {
  const normalized = sortedUnique(values);
  return crypto.createHash('sha256')
    .update(`${normalized.join('\n')}\n`, 'utf8')
    .digest('hex');
}

function git(args) {
  return execFileSync('git', args, {
    cwd: REPOSITORY_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
}

function readReceipt(receiptPath = RECEIPT_PATH) {
  try {
    const value = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    assertCondition(
      value && typeof value === 'object' && !Array.isArray(value),
      'WP_B_M1_REVIEW_RECEIPT_INVALID',
      'Milestone 1 review receipt must be one JSON object'
    );
    return value;
  } catch (cause) {
    if (cause?.code?.startsWith?.('WP_B_M1_REVIEW_')) throw cause;
    throw governanceError(
      'WP_B_M1_REVIEW_RECEIPT_UNREADABLE',
      'Milestone 1 review receipt must be readable canonical JSON',
      { receiptPath, cause: cause?.message || String(cause) }
    );
  }
}

function validateReceipt(document) {
  assertCondition(document && typeof document === 'object' && !Array.isArray(document), 'WP_B_M1_REVIEW_RECEIPT_INVALID', 'Milestone 1 review receipt must be one JSON object');
  assertCondition(document.schemaVersion === 1, 'WP_B_M1_REVIEW_SCHEMA_INVALID', 'Unexpected receipt schema version');
  assertCondition(document.documentType === EXPECTED_DOCUMENT_TYPE, 'WP_B_M1_REVIEW_TYPE_INVALID', 'Unexpected receipt document type');
  assertCondition(document.program === 'Architecture Closure V2', 'WP_B_M1_REVIEW_PROGRAM_INVALID', 'Unexpected program');
  assertCondition(document.repository === EXPECTED_REPOSITORY, 'WP_B_M1_REVIEW_REPOSITORY_INVALID', 'Unexpected repository');
  assertCondition(document.workPackage === 'WP-B', 'WP_B_M1_REVIEW_WORK_PACKAGE_INVALID', 'Unexpected work package');

  const reviewed = document.reviewedImplementation || {};
  assertCondition(FULL_SHA.test(String(reviewed.head || '')), 'WP_B_M1_REVIEW_HEAD_INVALID', 'Reviewed Head must be one full commit SHA');
  assertCondition(FULL_SHA.test(String(reviewed.baselineHead || '')), 'WP_B_M1_REVIEW_BASELINE_INVALID', 'Baseline Head must be one full commit SHA');
  assertCondition(Number.isInteger(reviewed.changedFileCount) && reviewed.changedFileCount > 0, 'WP_B_M1_REVIEW_FILE_COUNT_INVALID', 'Reviewed file count must be a positive integer');
  assertCondition(SHA256.test(String(reviewed.changedFileSetSha256 || '')), 'WP_B_M1_REVIEW_FILE_DIGEST_INVALID', 'Reviewed file-set digest must be SHA-256');

  const review = document.review || {};
  assertCondition(review.reviewerType === 'INDEPENDENT_SOFTWARE_AUDIT_AGENT', 'WP_B_M1_REVIEW_REVIEWER_TYPE_INVALID', 'Reviewer type is not independent audit agent');
  assertCondition(review.humanApprovalClaimed === false, 'WP_B_M1_REVIEW_HUMAN_CLAIM_INVALID', 'Receipt cannot claim human approval');
  assertCondition(review.reviewGate1 === 'APPROVED', 'WP_B_M1_REVIEW_GATE_NOT_APPROVED', 'Review Gate 1 is not approved');
  assertCondition(review.milestone1 === 'SEALED', 'WP_B_M1_REVIEW_MILESTONE_NOT_SEALED', 'Milestone 1 is not sealed');
  assertCondition(review.milestone2 === 'NOT_STARTED', 'WP_B_M1_REVIEW_MILESTONE2_INVALID', 'Milestone 1 receipt must preserve the historical Milestone 2 state at sealing time');

  assertCondition(Array.isArray(document.findings) && document.findings.length === 4, 'WP_B_M1_REVIEW_FINDINGS_INVALID', 'Receipt must preserve the four independent-review findings');
  assertCondition(document.findings.every(item => item && typeof item.id === 'string' && typeof item.resolution === 'string'), 'WP_B_M1_REVIEW_FINDING_SHAPE_INVALID', 'Every finding must have an id and resolution');

  const red = document.redEvidence || {};
  assertCondition(Number.isSafeInteger(red.workflowRunId) && red.workflowRunId > 0, 'WP_B_M1_REVIEW_RED_RUN_INVALID', 'RED run id is invalid');
  assertCondition(FULL_SHA.test(String(red.head || '')), 'WP_B_M1_REVIEW_RED_HEAD_INVALID', 'RED Head is invalid');
  assertCondition(red.expectedConclusion === 'failure', 'WP_B_M1_REVIEW_RED_CONCLUSION_INVALID', 'RED evidence must remain a failure');
  assertCondition(red.contractResult === '0_OF_6_PASS', 'WP_B_M1_REVIEW_RED_RESULT_INVALID', 'RED evidence must preserve 0/6 result');

  const validation = document.formalValidation;
  assertCondition(Array.isArray(validation) && validation.length === 5, 'WP_B_M1_REVIEW_VALIDATION_SET_INVALID', 'Exactly five formal validation workflows are required');
  const expectedNames = new Set([
    'WP-B M1 Independent Review Integrity',
    'WP-B Validation',
    'Stage 6.4.5.9 WP0 Architecture Gates',
    'ACV2 WP-A Architecture Gates',
    'WP-A Main Post-Merge Validation'
  ]);
  for (const run of validation) {
    assertCondition(expectedNames.delete(run.workflowName), 'WP_B_M1_REVIEW_VALIDATION_NAME_INVALID', 'Formal validation workflow is missing or duplicated', { workflowName: run.workflowName });
    assertCondition(Number.isSafeInteger(run.workflowRunId) && run.workflowRunId > 0, 'WP_B_M1_REVIEW_VALIDATION_RUN_INVALID', 'Formal validation run id is invalid', { workflowName: run.workflowName });
    assertCondition(run.expectedHead === reviewed.head, 'WP_B_M1_REVIEW_VALIDATION_HEAD_INVALID', 'Formal validation does not bind the reviewed Head', { workflowName: run.workflowName });
    assertCondition(run.expectedConclusion === 'success', 'WP_B_M1_REVIEW_VALIDATION_CONCLUSION_INVALID', 'Formal validation must require success', { workflowName: run.workflowName });
  }
  assertCondition(expectedNames.size === 0, 'WP_B_M1_REVIEW_VALIDATION_NAME_MISSING', 'Formal validation set is incomplete', { missing: [...expectedNames] });

  const blobs = document.reviewedBlobs || {};
  assertCondition(Object.keys(blobs).length >= 6, 'WP_B_M1_REVIEW_BLOB_SET_INVALID', 'Reviewed blob set is incomplete');
  for (const [filePath, blob] of Object.entries(blobs)) {
    assertCondition(filePath && !filePath.startsWith('/') && !filePath.includes('..'), 'WP_B_M1_REVIEW_BLOB_PATH_INVALID', 'Reviewed blob path is invalid', { filePath });
    assertCondition(FULL_SHA.test(String(blob || '')), 'WP_B_M1_REVIEW_BLOB_INVALID', 'Reviewed blob id must be one full SHA-1', { filePath });
  }

  const seal = document.seal || {};
  assertCondition(seal.status === 'SEALED', 'WP_B_M1_REVIEW_SEAL_STATUS_INVALID', 'Seal status must be SEALED');
  assertCondition(FULL_SHA.test(String(seal.head || '')), 'WP_B_M1_REVIEW_SEAL_HEAD_INVALID', 'Seal Head must be one full commit SHA');
  assertCondition(JSON.stringify(sortedUnique(seal.allowedPostReviewPaths)) === JSON.stringify(EXPECTED_SEAL_PATHS), 'WP_B_M1_REVIEW_SEAL_PATHS_INVALID', 'Post-review path set must be exact', { expected: EXPECTED_SEAL_PATHS, actual: sortedUnique(seal.allowedPostReviewPaths) });
  assertCondition(seal.temporaryBypassAllowed === false && seal.warningOnlyClosureAllowed === false, 'WP_B_M1_REVIEW_SEAL_POLICY_INVALID', 'Seal cannot permit bypass or warning-only closure');

  const governance = document.governance || {};
  const requiredFalse = [
    'mergeAuthorized',
    'milestone2Authorized',
    'wpCAuthorized',
    'productionUseAuthorized',
    'formalRelease',
    'publish',
    'temporaryBypassAllowed'
  ];
  assertCondition(governance.prMustRemainDraft === true, 'WP_B_M1_REVIEW_DRAFT_POLICY_INVALID', 'PR must remain Draft');
  for (const field of requiredFalse) {
    assertCondition(governance[field] === false, 'WP_B_M1_REVIEW_GOVERNANCE_OPEN', `Governance field ${field} must remain false`, { field });
  }
  return Object.freeze({
    ok: true,
    reviewedHead: reviewed.head,
    baselineHead: reviewed.baselineHead,
    sealHead: seal.head
  });
}

function verifyLocalRepository(document) {
  validateReceipt(document);
  const reviewed = document.reviewedImplementation;
  const sealHead = document.seal.head;
  let currentHead;
  try {
    for (const commit of [reviewed.baselineHead, reviewed.head, sealHead]) {
      git(['cat-file', '-e', `${commit}^{commit}`]);
    }
    currentHead = git(['rev-parse', 'HEAD']);
    git(['merge-base', '--is-ancestor', reviewed.baselineHead, reviewed.head]);
    git(['merge-base', '--is-ancestor', reviewed.head, sealHead]);
    git(['merge-base', '--is-ancestor', sealHead, currentHead]);
  } catch (cause) {
    throw governanceError(
      'WP_B_M1_REVIEW_GIT_ANCESTRY_INVALID',
      'Baseline, reviewed Head, fixed Seal Head, and current Head must form one monotonic ancestry chain',
      { cause: cause?.message || String(cause) }
    );
  }

  const reviewedFiles = sortedUnique(git([
    '-c', 'core.quotePath=false', 'diff', '--name-only', reviewed.baselineHead, reviewed.head, '--'
  ]).split(/\r?\n/u));
  const reviewedDigest = changedFileSetSha256(reviewedFiles);
  assertCondition(reviewedFiles.length === reviewed.changedFileCount, 'WP_B_M1_REVIEW_FILE_COUNT_MISMATCH', 'Reviewed changed-file count does not match Git', { expected: reviewed.changedFileCount, actual: reviewedFiles.length });
  assertCondition(reviewedDigest === reviewed.changedFileSetSha256, 'WP_B_M1_REVIEW_FILE_DIGEST_MISMATCH', 'Reviewed changed-file digest does not match Git', { expected: reviewed.changedFileSetSha256, actual: reviewedDigest });

  const sealFiles = sortedUnique(git([
    '-c', 'core.quotePath=false', 'diff', '--name-only', reviewed.head, sealHead, '--'
  ]).split(/\r?\n/u));
  assertCondition(JSON.stringify(sealFiles) === JSON.stringify(EXPECTED_SEAL_PATHS), 'WP_B_M1_REVIEW_POST_REVIEW_SCOPE_INVALID', 'Only the four exact seal paths may change between reviewed implementation and fixed Seal Head', { expected: EXPECTED_SEAL_PATHS, actual: sealFiles });

  for (const [filePath, expectedBlob] of Object.entries(document.reviewedBlobs)) {
    let actualBlob;
    try {
      actualBlob = git(['rev-parse', `${reviewed.head}:${filePath}`]);
    } catch (cause) {
      throw governanceError('WP_B_M1_REVIEW_BLOB_UNAVAILABLE', 'Reviewed blob is unavailable', { filePath, cause: cause?.message || String(cause) });
    }
    assertCondition(actualBlob === expectedBlob, 'WP_B_M1_REVIEW_BLOB_MISMATCH', 'Reviewed blob does not match receipt', { filePath, expected: expectedBlob, actual: actualBlob });
  }

  const status = git(['status', '--porcelain=v1', '--untracked-files=all']);
  assertCondition(status === '', 'WP_B_M1_REVIEW_WORKTREE_DIRTY', 'Seal verification requires a clean worktree', { status });
  return Object.freeze({
    ok: true,
    reviewedHead: reviewed.head,
    sealHead,
    currentHead,
    currentHeadDescendsFromSeal: true,
    reviewedFileCount: reviewedFiles.length,
    reviewedFileSetSha256: reviewedDigest,
    postReviewFiles: Object.freeze(sealFiles)
  });
}

async function fetchWorkflowRun(repository, runId, token, timeoutMs = 15000) {
  const url = `https://api.github.com/repos/${repository}/actions/runs/${runId}`;
  let response;
  try {
    response = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'User-Agent': 'yance-acv2-wp-b-m1-review-verifier',
        'X-GitHub-Api-Version': '2022-11-28'
      },
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (cause) {
    throw governanceError('WP_B_M1_REVIEW_REMOTE_REQUEST_FAILED', 'GitHub workflow run request failed or timed out', { runId, cause: cause?.message || String(cause) });
  }
  if (!response.ok) {
    const body = (await response.text()).slice(0, 1000);
    throw governanceError('WP_B_M1_REVIEW_REMOTE_STATUS_FAILED', 'GitHub workflow run request returned a non-success status', { runId, httpStatus: response.status, body });
  }
  return response.json();
}

async function verifyRemoteRuns(document, options = {}) {
  validateReceipt(document);
  const token = String(options.token || process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '');
  const repository = String(options.repository || process.env.GITHUB_REPOSITORY || document.repository || '');
  assertCondition(token.length > 0, 'WP_B_M1_REVIEW_REMOTE_TOKEN_REQUIRED', 'Authenticated GitHub token is required for remote run verification');
  assertCondition(repository === document.repository, 'WP_B_M1_REVIEW_REMOTE_REPOSITORY_INVALID', 'Remote repository must match the receipt', { repository, expected: document.repository });

  const formalRuns = [];
  for (const expected of document.formalValidation) {
    const actual = await fetchWorkflowRun(repository, expected.workflowRunId, token);
    assertCondition(actual.name === expected.workflowName, 'WP_B_M1_REVIEW_REMOTE_NAME_MISMATCH', 'Workflow run name does not match receipt', { runId: expected.workflowRunId, expected: expected.workflowName, actual: actual.name });
    assertCondition(actual.head_sha === expected.expectedHead, 'WP_B_M1_REVIEW_REMOTE_HEAD_MISMATCH', 'Workflow run is not bound to the reviewed Head', { runId: expected.workflowRunId, expected: expected.expectedHead, actual: actual.head_sha });
    assertCondition(actual.status === 'completed' && actual.conclusion === expected.expectedConclusion, 'WP_B_M1_REVIEW_REMOTE_CONCLUSION_MISMATCH', 'Workflow run is not completed with the required conclusion', { runId: expected.workflowRunId, status: actual.status, conclusion: actual.conclusion });
    assertCondition(Number(actual.run_number) === expected.runNumber, 'WP_B_M1_REVIEW_REMOTE_RUN_NUMBER_MISMATCH', 'Workflow run number does not match receipt', { runId: expected.workflowRunId, expected: expected.runNumber, actual: actual.run_number });
    formalRuns.push(Object.freeze({ runId: expected.workflowRunId, name: actual.name, head: actual.head_sha, conclusion: actual.conclusion }));
  }

  const red = document.redEvidence;
  const redRun = await fetchWorkflowRun(repository, red.workflowRunId, token);
  assertCondition(redRun.name === red.workflowName, 'WP_B_M1_REVIEW_REMOTE_RED_NAME_MISMATCH', 'RED workflow name does not match receipt');
  assertCondition(redRun.head_sha === red.head, 'WP_B_M1_REVIEW_REMOTE_RED_HEAD_MISMATCH', 'RED workflow does not bind the recorded RED Head');
  assertCondition(redRun.status === 'completed' && redRun.conclusion === red.expectedConclusion, 'WP_B_M1_REVIEW_REMOTE_RED_CONCLUSION_MISMATCH', 'RED workflow must remain a completed failure');
  return Object.freeze({ ok: true, formalRuns: Object.freeze(formalRuns), redRunId: red.workflowRunId });
}

async function main() {
  const document = readReceipt();
  const local = verifyLocalRepository(document);
  const remote = process.argv.includes('--remote')
    ? await verifyRemoteRuns(document)
    : null;
  process.stdout.write(`${JSON.stringify({ status: 'PASS', local, remote }, null, 2)}\n`);
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`${JSON.stringify({
      status: 'FAIL',
      code: error?.code || 'WP_B_M1_REVIEW_UNKNOWN_FAILURE',
      message: error?.message || String(error),
      details: Object.fromEntries(Object.entries(error || {}).filter(([key]) => !['name', 'message', 'stack'].includes(key)))
    }, null, 2)}\n`);
    process.exitCode = 1;
  });
}

module.exports = Object.freeze({
  EXPECTED_SEAL_PATHS,
  RECEIPT_PATH,
  changedFileSetSha256,
  readReceipt,
  validateReceipt,
  verifyLocalRepository,
  verifyRemoteRuns
});
