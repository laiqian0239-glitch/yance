#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const https = require('node:https');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPOSITORY_ROOT = path.resolve(__dirname, '..', '..');
const RECEIPT_PATH = path.join(REPOSITORY_ROOT, 'governance', 'architecture-closure-v2', 'wp-b-m2-red-evidence.json');
const EXPECTED_DOCUMENT_TYPE = 'YANCE_ACV2_WP_B_M2_RED_EVIDENCE';
const EXPECTED_REPOSITORY = 'laiqian0239-glitch/yance';
const EXPECTED_BRANCH = 'acv2/wp-b-durable-execution-outbox';
const EXPECTED_AUTHORIZATION_HEAD = 'a0ed772ccd5ca7db56a2c3f22cb2e201c52bafa6';
const EXPECTED_RED_HEAD = '636d6feebaad4a49171750f4ec5f64bde12872fc';
const EXPECTED_WORKFLOW_NAME = 'WP-B M2 Contracts';
const EXPECTED_WORKFLOW_RUN_ID = 30837837145;
const EXPECTED_CHANGED_PATHS = Object.freeze([
  '.github/workflows/wp-b-m2-red.yml',
  'backend/tests/architectureClosureV2/wpB/m2LeakBoundaryRed.test.js',
  'backend/tests/architectureClosureV2/wpB/m2MandatoryOperationsRed.test.js',
  'backend/tests/architectureClosureV2/wpB/m2ProcessFaultRed.test.js',
  'backend/tests/architectureClosureV2/wpB/m2RecoveryRed.test.js',
  'tools/architecture-closure-v2/run-wp-b-m2-contracts.js'
]);
const EXPECTED_CHANGED_FILE_SET_SHA256 = '46e2eb53e00e777dc3a6ce3a61fb22b4d5d6e4feb87ae78e12ed6c4870209e7d';
const EXPECTED_BLOBS = Object.freeze({
  '.github/workflows/wp-b-m2-red.yml': '3e2436afe658d5ca24aa9a3f3616ca0bc575e399',
  'backend/tests/architectureClosureV2/wpB/m2LeakBoundaryRed.test.js': '4c948ab0bb3d0f6bc767d7a3c2a48d7079323784',
  'backend/tests/architectureClosureV2/wpB/m2MandatoryOperationsRed.test.js': '9349d8a2a3a31d72883462f0e7f0d9bbf44507b0',
  'backend/tests/architectureClosureV2/wpB/m2ProcessFaultRed.test.js': 'a6ccc8279fa3a6f8e5b38f2be75df0c44a0cfb76',
  'backend/tests/architectureClosureV2/wpB/m2RecoveryRed.test.js': 'db9ef500c07b1565712f67305ff2e2f3647b7bc5',
  'tools/architecture-closure-v2/run-wp-b-m2-contracts.js': 'e39623414ef01bb12aa766f30245454c949ca3f3'
});
const EXPECTED_FAILURE_CONTRACT_IDS = Object.freeze([
  'M2-FAULT-001', 'M2-FAULT-002', 'M2-FAULT-003', 'M2-FAULT-004', 'M2-FAULT-005',
  'M2-LEAK-001', 'M2-LEAK-002', 'M2-LEAK-003', 'M2-LEAK-004',
  'M2-OPS-001', 'M2-OPS-002', 'M2-OPS-003', 'M2-OPS-004', 'M2-OPS-005',
  'M2-OPS-006', 'M2-OPS-007', 'M2-OPS-008', 'M2-OPS-009', 'M2-OPS-010', 'M2-OPS-011',
  'M2-REC-001', 'M2-REC-002', 'M2-REC-003', 'M2-REC-004', 'M2-REC-005', 'M2-REC-006'
]);
const EXPECTED_PLATFORMS = Object.freeze({
  ubuntu: Object.freeze({
    runner: 'ubuntu-latest',
    jobId: 91767246534,
    artifactId: 8865542262,
    artifactName: 'wp-b-m2-contract-evidence-ubuntu-latest',
    artifactDigest: 'sha256:8cc7d62577b82cb599ecab6811b72699f075542ce7d89dc2ea0ec604ece8babc',
    normalizedOutputSha256: '492a4aef0ecf081f6f6ad3ea7e2ff364ac6feb1662fa362cf9a413ba63241e82'
  }),
  windows: Object.freeze({
    runner: 'windows-latest',
    jobId: 91767246437,
    artifactId: 8865572044,
    artifactName: 'wp-b-m2-contract-evidence-windows-latest',
    artifactDigest: 'sha256:e69d819b562251efbe6434161f6e6356739db5fe883b9f83e4cc7b73d8af16dd',
    normalizedOutputSha256: '727b03fd28836039d2764f9fff9fcdae32b4e8f828cf7761e3cff74200c68197'
  })
});
const CLOSED_GOVERNANCE_FIELDS = Object.freeze([
  'milestone3Authorized', 'mergeAuthorized', 'productionUseAuthorized', 'wpCAuthorized',
  'formalRelease', 'publish', 'temporaryBypassAllowed', 'warningOnlyClosureAllowed'
]);
const FULL_SHA = /^[a-f0-9]{40}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;

function evidenceError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, ...details });
}
function assertCondition(condition, code, message, details = {}) {
  if (!condition) throw evidenceError(code, message, details);
}
function sha256(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}
function changedFileSetSha256(paths) {
  return sha256(`${[...paths].sort().join('\n')}\n`);
}
function readReceipt(receiptPath = RECEIPT_PATH) {
  try {
    const document = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    assertCondition(document && typeof document === 'object' && !Array.isArray(document), 'WP_B_M2_RED_EVIDENCE_RECEIPT_INVALID', 'RED evidence must be one JSON object');
    return document;
  } catch (cause) {
    if (cause?.code?.startsWith?.('WP_B_M2_RED_EVIDENCE_')) throw cause;
    throw evidenceError('WP_B_M2_RED_EVIDENCE_RECEIPT_UNREADABLE', 'RED evidence receipt is unreadable', { receiptPath, cause: cause?.message || String(cause) });
  }
}
function validatePlatform(name, actual) {
  const expected = EXPECTED_PLATFORMS[name];
  assertCondition(actual && typeof actual === 'object' && !Array.isArray(actual), 'WP_B_M2_RED_EVIDENCE_PLATFORM_INVALID', `Missing ${name} platform evidence`, { platform: name });
  for (const field of ['runner', 'jobId', 'artifactId', 'artifactName', 'artifactDigest', 'normalizedOutputSha256']) {
    assertCondition(actual[field] === expected[field], 'WP_B_M2_RED_EVIDENCE_PLATFORM_INVALID', `${name} ${field} is invalid`, { platform: name, field });
  }
  assertCondition(actual.status === 'RED' && actual.exitCode === 1 && actual.signal === null, 'WP_B_M2_RED_EVIDENCE_PLATFORM_INVALID', `${name} must preserve a real contract RED`, { platform: name });
  assertCondition(actual.testCount === 26 && actual.passCount === 0 && actual.failCount === 26, 'WP_B_M2_RED_EVIDENCE_PLATFORM_INVALID', `${name} test counts are invalid`, { platform: name });
  assertCondition(JSON.stringify(actual.failureContractIds) === JSON.stringify(EXPECTED_FAILURE_CONTRACT_IDS), 'WP_B_M2_RED_EVIDENCE_PLATFORM_INVALID', `${name} failure IDs are invalid`, { platform: name });
  assertCondition(actual.matchedInfrastructurePattern === null, 'WP_B_M2_RED_EVIDENCE_PLATFORM_INVALID', `${name} has an infrastructure failure`, { platform: name });
  assertCondition(actual.secretLeakCount === 0 && actual.businessContentLeakCount === 0, 'WP_B_M2_RED_EVIDENCE_PLATFORM_INVALID', `${name} evidence contains leak counters`, { platform: name });
  assertCondition(SHA256.test(actual.normalizedOutputSha256), 'WP_B_M2_RED_EVIDENCE_PLATFORM_INVALID', `${name} output hash is invalid`, { platform: name });
}
function validateReceipt(document) {
  assertCondition(document && typeof document === 'object' && !Array.isArray(document), 'WP_B_M2_RED_EVIDENCE_RECEIPT_INVALID', 'RED evidence must be one JSON object');
  assertCondition(document.schemaVersion === 1 && document.documentType === EXPECTED_DOCUMENT_TYPE, 'WP_B_M2_RED_EVIDENCE_SCHEMA_INVALID', 'Unexpected RED evidence schema');
  assertCondition(document.program === 'Architecture Closure V2' && document.repository === EXPECTED_REPOSITORY && document.workPackage === 'WP-B', 'WP_B_M2_RED_EVIDENCE_IDENTITY_INVALID', 'RED evidence identity is invalid');
  assertCondition(document.pullRequest === 17 && document.branch === EXPECTED_BRANCH, 'WP_B_M2_RED_EVIDENCE_IDENTITY_INVALID', 'RED evidence PR or branch is invalid');
  assertCondition(document.authorizationHead === EXPECTED_AUTHORIZATION_HEAD, 'WP_B_M2_RED_EVIDENCE_AUTHORIZATION_HEAD_INVALID', 'RED evidence must descend from the exact authorization Head');
  assertCondition(document.redHead === EXPECTED_RED_HEAD && FULL_SHA.test(document.redHead), 'WP_B_M2_RED_EVIDENCE_HEAD_INVALID', 'RED evidence Head is invalid');
  assertCondition(document.workflowName === EXPECTED_WORKFLOW_NAME, 'WP_B_M2_RED_EVIDENCE_WORKFLOW_INVALID', 'RED workflow name is invalid');
  assertCondition(document.workflowRunId === EXPECTED_WORKFLOW_RUN_ID && document.workflowConclusion === 'failure', 'WP_B_M2_RED_EVIDENCE_RUN_INVALID', 'RED workflow run is invalid');
  assertCondition(document.contractStatus === 'CREDIBLE_RED_RECORDED', 'WP_B_M2_RED_EVIDENCE_STATUS_INVALID', 'Credible RED status is missing');
  assertCondition(JSON.stringify(document.expectedFailureContractIds) === JSON.stringify(EXPECTED_FAILURE_CONTRACT_IDS), 'WP_B_M2_RED_EVIDENCE_FAILURE_SET_INVALID', 'Expected failure set is invalid');
  const fileSet = document.changedFileSet || {};
  assertCondition(fileSet.baseHead === EXPECTED_AUTHORIZATION_HEAD && fileSet.head === EXPECTED_RED_HEAD, 'WP_B_M2_RED_EVIDENCE_FILE_SET_INVALID', 'Changed file range is invalid');
  assertCondition(fileSet.count === EXPECTED_CHANGED_PATHS.length, 'WP_B_M2_RED_EVIDENCE_FILE_SET_INVALID', 'Changed file count is invalid');
  assertCondition(JSON.stringify(fileSet.paths) === JSON.stringify(EXPECTED_CHANGED_PATHS), 'WP_B_M2_RED_EVIDENCE_FILE_SET_INVALID', 'Changed file paths are invalid');
  assertCondition(fileSet.sha256 === EXPECTED_CHANGED_FILE_SET_SHA256 && fileSet.sha256 === changedFileSetSha256(fileSet.paths), 'WP_B_M2_RED_EVIDENCE_FILE_SET_INVALID', 'Changed file digest is invalid');
  assertCondition(JSON.stringify(fileSet.blobs) === JSON.stringify(EXPECTED_BLOBS), 'WP_B_M2_RED_EVIDENCE_FILE_SET_INVALID', 'Changed file blob bindings are invalid');
  validatePlatform('ubuntu', document.platforms?.ubuntu);
  validatePlatform('windows', document.platforms?.windows);
  const governance = document.governance || {};
  assertCondition(governance.prMustRemainDraft === true && governance.milestone2Authorized === true && governance.credibleM2RedRecorded === true, 'WP_B_M2_RED_EVIDENCE_GOVERNANCE_INVALID', 'M2 RED governance state is invalid');
  for (const field of CLOSED_GOVERNANCE_FIELDS) {
    assertCondition(governance[field] === false, 'WP_B_M2_RED_EVIDENCE_GOVERNANCE_OPEN', `Governance field ${field} must remain false`, { field });
  }
  return Object.freeze({ ok: true, redHead: document.redHead, workflowRunId: document.workflowRunId, failureCount: EXPECTED_FAILURE_CONTRACT_IDS.length });
}
function git(repositoryRoot, args) {
  return execFileSync('git', args, { cwd: repositoryRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
function verifyLocalRepository(document = readReceipt(), options = {}) {
  const result = validateReceipt(document);
  const repositoryRoot = path.resolve(options.repositoryRoot || REPOSITORY_ROOT);
  try {
    git(repositoryRoot, ['cat-file', '-e', `${EXPECTED_AUTHORIZATION_HEAD}^{commit}`]);
    git(repositoryRoot, ['cat-file', '-e', `${EXPECTED_RED_HEAD}^{commit}`]);
    git(repositoryRoot, ['merge-base', '--is-ancestor', EXPECTED_AUTHORIZATION_HEAD, EXPECTED_RED_HEAD]);
    git(repositoryRoot, ['merge-base', '--is-ancestor', EXPECTED_RED_HEAD, 'HEAD']);
  } catch (cause) {
    throw evidenceError('WP_B_M2_RED_EVIDENCE_GIT_ANCESTRY_INVALID', 'RED evidence ancestry is invalid', { cause: cause?.message || String(cause) });
  }
  const paths = git(repositoryRoot, ['diff', '--name-only', EXPECTED_AUTHORIZATION_HEAD, EXPECTED_RED_HEAD]).split(/\r?\n/u).filter(Boolean).sort();
  assertCondition(JSON.stringify(paths) === JSON.stringify(EXPECTED_CHANGED_PATHS), 'WP_B_M2_RED_EVIDENCE_FILE_SET_INVALID', 'Git changed file set differs from receipt', { paths });
  assertCondition(changedFileSetSha256(paths) === EXPECTED_CHANGED_FILE_SET_SHA256, 'WP_B_M2_RED_EVIDENCE_FILE_SET_INVALID', 'Git changed file digest differs from receipt');
  for (const [repositoryPath, expectedBlob] of Object.entries(EXPECTED_BLOBS)) {
    const actualBlob = git(repositoryRoot, ['rev-parse', `${EXPECTED_RED_HEAD}:${repositoryPath}`]);
    assertCondition(actualBlob === expectedBlob, 'WP_B_M2_RED_EVIDENCE_BLOB_INVALID', 'RED source blob differs from receipt', { repositoryPath, expectedBlob, actualBlob });
  }
  const status = git(repositoryRoot, ['status', '--porcelain=v1', '--untracked-files=all']);
  assertCondition(status === '', 'WP_B_M2_RED_EVIDENCE_WORKTREE_DIRTY', 'RED evidence verification requires a clean worktree', { status });
  return Object.freeze({ ...result, currentHead: git(repositoryRoot, ['rev-parse', 'HEAD']), changedFileSetSha256: EXPECTED_CHANGED_FILE_SET_SHA256 });
}
function githubJson(apiPath, token = process.env.GITHUB_TOKEN) {
  assertCondition(Boolean(token), 'WP_B_M2_RED_EVIDENCE_TOKEN_REQUIRED', 'GITHUB_TOKEN is required for remote verification');
  return new Promise((resolve, reject) => {
    const request = https.get({ hostname: 'api.github.com', path: apiPath, headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'User-Agent': 'yance-acv2-wp-b-m2-red-verifier', 'X-GitHub-Api-Version': '2022-11-28' } }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => {
        if (response.statusCode < 200 || response.statusCode >= 300) return reject(evidenceError('WP_B_M2_RED_EVIDENCE_REMOTE_HTTP_FAILURE', 'GitHub API request failed', { apiPath, statusCode: response.statusCode, body: body.slice(0, 1000) }));
        try { resolve(JSON.parse(body)); } catch (cause) { reject(evidenceError('WP_B_M2_RED_EVIDENCE_REMOTE_JSON_FAILURE', 'GitHub API returned invalid JSON', { apiPath, cause: cause?.message || String(cause) })); }
      });
    });
    request.on('error', cause => reject(evidenceError('WP_B_M2_RED_EVIDENCE_REMOTE_REQUEST_FAILURE', 'GitHub API request failed', { apiPath, cause: cause?.message || String(cause) })));
  });
}
async function verifyRemoteEvidence(document = readReceipt(), options = {}) {
  const result = validateReceipt(document);
  const [run, jobsPage, artifactsPage] = await Promise.all([
    githubJson(`/repos/${EXPECTED_REPOSITORY}/actions/runs/${EXPECTED_WORKFLOW_RUN_ID}`, options.token),
    githubJson(`/repos/${EXPECTED_REPOSITORY}/actions/runs/${EXPECTED_WORKFLOW_RUN_ID}/jobs?per_page=100`, options.token),
    githubJson(`/repos/${EXPECTED_REPOSITORY}/actions/runs/${EXPECTED_WORKFLOW_RUN_ID}/artifacts?per_page=100`, options.token)
  ]);
  assertCondition(run.head_sha === EXPECTED_RED_HEAD && run.name === EXPECTED_WORKFLOW_NAME && run.conclusion === 'failure', 'WP_B_M2_RED_EVIDENCE_REMOTE_RUN_INVALID', 'Remote workflow run does not match receipt');
  for (const [platform, expected] of Object.entries(EXPECTED_PLATFORMS)) {
    const job = (jobsPage.jobs || []).find(candidate => candidate.id === expected.jobId);
    assertCondition(job && job.conclusion === 'failure' && job.head_sha === EXPECTED_RED_HEAD, 'WP_B_M2_RED_EVIDENCE_REMOTE_JOB_INVALID', 'Remote job does not match receipt', { platform });
    const artifact = (artifactsPage.artifacts || []).find(candidate => candidate.id === expected.artifactId);
    assertCondition(artifact && artifact.name === expected.artifactName && artifact.digest === expected.artifactDigest && artifact.workflow_run?.head_sha === EXPECTED_RED_HEAD, 'WP_B_M2_RED_EVIDENCE_REMOTE_ARTIFACT_INVALID', 'Remote artifact does not match receipt', { platform });
  }
  return Object.freeze({ ...result, remoteVerified: true });
}
async function main() {
  const receipt = readReceipt();
  const local = verifyLocalRepository(receipt);
  const remote = process.argv.includes('--remote') ? await verifyRemoteEvidence(receipt) : null;
  process.stdout.write(`${JSON.stringify({ status: 'PASS', local, remote }, null, 2)}\n`);
}
if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`${JSON.stringify({ status: 'FAIL', code: error?.code || 'WP_B_M2_RED_EVIDENCE_UNKNOWN_FAILURE', message: error?.message || String(error), details: Object.fromEntries(Object.entries(error || {}).filter(([key]) => !['name', 'message', 'stack'].includes(key))) }, null, 2)}\n`);
    process.exitCode = 1;
  });
}
module.exports = Object.freeze({
  EXPECTED_AUTHORIZATION_HEAD,
  EXPECTED_CHANGED_FILE_SET_SHA256,
  EXPECTED_CHANGED_PATHS,
  EXPECTED_FAILURE_CONTRACT_IDS,
  EXPECTED_PLATFORMS,
  EXPECTED_RED_HEAD,
  EXPECTED_WORKFLOW_RUN_ID,
  RECEIPT_PATH,
  changedFileSetSha256,
  readReceipt,
  validateReceipt,
  verifyLocalRepository,
  verifyRemoteEvidence
});
