'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_AUTHORIZATION_PATH = path.join(
  REPO_ROOT,
  'governance',
  'architecture-closure-v2',
  'wp-a-promotion-authorization.json'
);

const EXACT_PROMOTION_FILES = Object.freeze([
  '.github/workflows/wp-a-promotion-authorization.yml',
  'governance/architecture-closure-v2/wp-a-promotion-authorization.json',
  'governance/layered-ci/wp0-routing-policy.json',
  'tests/layered-ci/wp0-routing.test.js',
  'tests/wp0/wp-a-promotion-authorization.test.js',
  'tools/architecture-closure-v2/verify-wp-a-promotion-authorization.js'
].sort());

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) throw new Error(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for --${key}`);
    values[key] = value;
    index += 1;
  }
  return values;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readSortedLines(filePath) {
  return [...new Set(fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/u)
    .map(value => value.trim().replace(/\\/gu, '/'))
    .filter(Boolean))].sort();
}

function changedFileSetSha256(files) {
  return crypto.createHash('sha256').update(`${[...files].sort().join('\n')}\n`, 'utf8').digest('hex');
}

function assertFullSha(value, field) {
  assert.match(String(value || ''), /^[a-f0-9]{40}$/u, `${field} must be a full lowercase commit SHA`);
}

function validateAuthorization(document) {
  assert.equal(document.schemaVersion, 1);
  assert.equal(document.documentType, 'YANCE_ACV2_PROMOTION_AUTHORIZATION');
  assert.equal(document.program, 'Architecture Closure V2');
  assert.equal(document.repository, 'laiqian0239-glitch/yance');
  assert.equal(document.workPackage, 'WP-A');
  assert.equal(document.status, 'APPROVED_PENDING_MERGE');

  const candidate = document.promotionCandidate;
  assert.equal(candidate.pullRequest, 5);
  assert.equal(candidate.baseRef, 'main');
  assert.equal(candidate.authorizedBranch, 'acv2/wp-a-identity-ledger-write-host');
  assertFullSha(candidate.candidateHead, 'promotionCandidate.candidateHead');
  assertFullSha(candidate.reviewedCodeHead, 'promotionCandidate.reviewedCodeHead');
  assert.equal(candidate.changedFileCount, 127);
  assert.match(candidate.changedFileSetSha256, /^[a-f0-9]{64}$/u);
  assert.equal(candidate.closureReceiptPath, 'governance/architecture-closure-v2/wp-a-a8-closure.json');
  assert.equal(candidate.independentReviewId, 4839751328);
  assert.equal(candidate.sourceClosureViolationCount, 0);

  assert.equal(document.verification.acv2.runId, 30769056193);
  assert.equal(document.verification.acv2.requiredConclusion, 'success');
  assert.equal(document.verification.wp0.runId, 30769056196);
  assert.equal(document.verification.wp0.requiredConclusion, 'success');

  assert.equal(document.activation.requiredDefaultBranch, 'main');
  assert.equal(document.activation.effectiveOnlyWhenPresentOnDefaultBranch, true);
  assert.equal(document.activation.candidateHeadMustRemainExact, true);
  assert.equal(document.activation.candidatePullRequestMustRemainDraftUntilActivation, true);
  assert.equal(document.activation.authorizationPullRequestMustContainGovernanceFilesOnly, true);
  assert.equal(document.activation.afterActivation.readyForPromotion, true);
  assert.equal(document.activation.afterActivation.candidatePullRequestMayLeaveDraft, true);
  assert.equal(document.activation.afterActivation.formalRelease, false);
  assert.equal(document.activation.afterActivation.publish, false);

  assert.equal(document.governance.readyForPromotion, false);
  assert.equal(document.governance.formalRelease, false);
  assert.equal(document.governance.publish, false);
  assert.equal(document.governance.automaticNextWorkPackageAuthorization, false);
  assert.equal(document.governance.wpBAuthorized, false);
  assert.equal(document.governance.temporaryBypassAllowed, false);
  assert.equal(document.governance.wildcardScopeExpansionAllowed, false);
  return true;
}

function validateRequiredJobs(jobsPayload, requiredJobs, label) {
  assert.ok(Array.isArray(jobsPayload.jobs), `${label} jobs payload must contain jobs[]`);
  const byId = new Map(jobsPayload.jobs.map(job => [job.id, job]));
  for (const [name, id] of Object.entries(requiredJobs)) {
    const job = byId.get(id);
    assert.ok(job, `${label} required job missing: ${name} (${id})`);
    assert.equal(job.status, 'completed', `${label} job not completed: ${name}`);
    assert.equal(job.conclusion, 'success', `${label} job not successful: ${name}`);
  }
}

function validatePromotionEvidence(input) {
  const {
    authorization,
    pullRequest,
    acv2Run,
    wp0Run,
    acv2Jobs,
    wp0Jobs,
    candidateFiles,
    promotionFiles,
    closureReceipt
  } = input;

  validateAuthorization(authorization);
  const candidate = authorization.promotionCandidate;

  assert.equal(pullRequest.number, candidate.pullRequest);
  assert.equal(pullRequest.state, 'open');
  assert.equal(pullRequest.draft, true, 'candidate PR must remain Draft until authorization enters main');
  assert.equal(pullRequest.merged, false);
  assert.equal(pullRequest.base.ref, candidate.baseRef);
  assert.equal(pullRequest.head.ref, candidate.authorizedBranch);
  assert.equal(pullRequest.head.sha, candidate.candidateHead, 'candidate PR Head drifted');
  assert.equal(pullRequest.changed_files, candidate.changedFileCount);

  assert.equal(candidateFiles.length, candidate.changedFileCount);
  assert.equal(changedFileSetSha256(candidateFiles), candidate.changedFileSetSha256);

  for (const [label, run, expected] of [
    ['ACV2', acv2Run, authorization.verification.acv2],
    ['WP0', wp0Run, authorization.verification.wp0]
  ]) {
    assert.equal(run.id, expected.runId, `${label} run identity drifted`);
    assert.equal(run.head_sha, candidate.candidateHead, `${label} run is not bound to candidate Head`);
    assert.equal(run.status, 'completed', `${label} run is not completed`);
    assert.equal(run.conclusion, expected.requiredConclusion, `${label} run is not successful`);
  }

  validateRequiredJobs(acv2Jobs, authorization.verification.acv2.jobs, 'ACV2');
  validateRequiredJobs(wp0Jobs, authorization.verification.wp0.jobs, 'WP0');

  assert.deepEqual(promotionFiles, EXACT_PROMOTION_FILES, 'promotion PR contains non-governance or missing files');

  assert.equal(closureReceipt.documentType, 'YANCE_ACV2_TASK_CLOSURE_RECEIPT');
  assert.equal(closureReceipt.workPackage, 'WP-A');
  assert.equal(closureReceipt.task, 'A8');
  assert.equal(closureReceipt.status, 'CLOSED');
  assert.equal(closureReceipt.pullRequest, candidate.pullRequest);
  assert.equal(closureReceipt.reviewedCodeHead, candidate.reviewedCodeHead);
  assert.equal(closureReceipt.reviewGateHead, candidate.reviewedCodeHead);
  assert.equal(closureReceipt.independentReview.reviewId, candidate.independentReviewId);
  assert.equal(closureReceipt.independentReview.decision, 'ALLOW_MERGE');
  assert.equal(closureReceipt.independentReview.openP0, 0);
  assert.equal(closureReceipt.independentReview.openP1, 0);
  assert.equal(closureReceipt.independentReview.temporaryBypassDetected, false);
  assert.equal(closureReceipt.verification.sourceClosureViolationCount, candidate.sourceClosureViolationCount);
  assert.equal(closureReceipt.governance.readyForPromotion, false);
  assert.equal(closureReceipt.governance.formalRelease, false);
  assert.equal(closureReceipt.governance.publish, false);

  return Object.freeze({
    ok: true,
    status: authorization.status,
    candidatePullRequest: candidate.pullRequest,
    candidateHead: candidate.candidateHead,
    changedFileCount: candidate.changedFileCount,
    changedFileSetSha256: candidate.changedFileSetSha256,
    promotionFileCount: promotionFiles.length,
    activation: 'MERGE_TO_MAIN_REQUIRED',
    readyForPromotionNow: false,
    readyForPromotionAfterActivation: true,
    formalRelease: false,
    publish: false,
    wpBAuthorized: false
  });
}

function runCli(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const required = [
    'pull-request', 'acv2-run', 'wp0-run', 'acv2-jobs', 'wp0-jobs',
    'candidate-files', 'promotion-files', 'closure-receipt'
  ];
  for (const key of required) {
    if (!args[key]) throw new Error(`Missing required --${key}`);
  }

  const result = validatePromotionEvidence({
    authorization: readJson(args.authorization || DEFAULT_AUTHORIZATION_PATH),
    pullRequest: readJson(args['pull-request']),
    acv2Run: readJson(args['acv2-run']),
    wp0Run: readJson(args['wp0-run']),
    acv2Jobs: readJson(args['acv2-jobs']),
    wp0Jobs: readJson(args['wp0-jobs']),
    candidateFiles: readSortedLines(args['candidate-files']),
    promotionFiles: readSortedLines(args['promotion-files']),
    closureReceipt: readJson(args['closure-receipt'])
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result;
}

if (require.main === module) {
  try {
    runCli();
  } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  EXACT_PROMOTION_FILES,
  changedFileSetSha256,
  validateAuthorization,
  validatePromotionEvidence,
  validateRequiredJobs,
  runCli
};
