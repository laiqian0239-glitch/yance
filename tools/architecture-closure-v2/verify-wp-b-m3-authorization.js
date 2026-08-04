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
  'wp-b-m3-authorization.json'
);
const INVENTORY_PATH = 'governance/architecture-closure-v2/wp-b-operation-inventory.json';
const M2_REVIEW_PATH = path.join(
  REPOSITORY_ROOT,
  'tools',
  'architecture-closure-v2',
  'verify-wp-b-m2-review.js'
);
const FULL_SHA = /^[a-f0-9]{40}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const EXPECTED_REPOSITORY = 'laiqian0239-glitch/yance';
const EXPECTED_BRANCH = 'acv2/wp-b-durable-execution-outbox';
const EXPECTED_M2_EVIDENCE_HEAD = '9f82377119e16f8e02d3b83f0795b452e36f769e';
const EXPECTED_M2_SEAL_HEAD = '5f08a5a75aeae4d3baeb5a1d34a470f21ac0180d';
const EXPECTED_M2_REVIEWED_HEAD = '3e5d71f68afccb64d0f61a776170d815fed77747';
const EXPECTED_DESIGN_HEAD = '237061c6ff20c5424d26ea8dc56618db4c521c0e';
const EXPECTED_RED_HEAD = '3164b8c26f736b166d30f1a6bb368e950d8c80d4';
const EXPECTED_RED_RUN_ID = 30890446016;
const EXPECTED_RED_UBUNTU_JOB_ID = 91931025684;
const EXPECTED_RED_WINDOWS_JOB_ID = 91931025737;
const EXPECTED_INVENTORY_ANCHOR_BLOB = 'c564fd0c225ddc24317ac2f10c46aa0ad52db691';
const EXPECTED_INVENTORY_PATH_COUNT = 45;
const EXPECTED_INVENTORY_PATH_SHA256 = '579cc85774c1c26a433b4ed167a153df1a8a4bbabc7159a8f9925cacddfd2990';
const EXPECTED_FAILURE_IDS = Object.freeze([
  'M3-AUTH-001',
  'M3-AUTH-002',
  'M3-AUTH-003',
  'M3-AUTH-004',
  'M3-AUTH-005',
  'M3-AUTH-006'
]);
const EXPECTED_EXECUTION_STAGES = Object.freeze([
  'M3_AUTHORIZATION',
  'SOURCE_CLOSURE_CREDIBLE_RED',
  'GENERALIZED_SOURCE_CLOSURE_AUTHORITY',
  'RECOVERY_RETRY_TIMER_REMOVAL',
  'DIRECT_WRITER_AND_PHYSICAL_BYPASS_REMOVAL',
  'FINAL_ISOLATED_AND_CROSS_PLATFORM_MATRIX',
  'PROVENANCE_NOTICE_LICENSE_SBOM',
  'PERMANENT_POST_MERGE_VALIDATION',
  'INDEPENDENT_REVIEW_GATE_3',
  'WP_B_FINAL_CLOSURE_SEAL'
]);
const EXPECTED_ALLOWED_PATHS = Object.freeze([
  '.github/workflows/wp-b-m3-authorization.yml',
  '.github/workflows/wp-b-post-merge-validation.yml',
  '.github/workflows/wp-b-validation.yml',
  'THIRD_PARTY_NOTICES_WP_B.md',
  'backend/tests/architectureClosureV2/wpA/sourceClosureFinal.test.js',
  'backend/tests/architectureClosureV2/wpA/sourceClosureInventory.test.js',
  'backend/tests/architectureClosureV2/wpB/finalClosureIntegrity.test.js',
  'backend/tests/architectureClosureV2/wpB/finalClosureSeal.test.js',
  'backend/tests/architectureClosureV2/wpB/finalMatrixContract.test.js',
  'backend/tests/architectureClosureV2/wpB/m3Authorization.test.js',
  'backend/tests/architectureClosureV2/wpB/openSourceProvenanceClosure.test.js',
  'backend/tests/architectureClosureV2/wpB/postMergeWorkflowContract.test.js',
  'backend/tests/architectureClosureV2/wpB/sourceClosureDiagnostics.test.js',
  'backend/tests/architectureClosureV2/wpB/sourceClosureFinal.test.js',
  'docs/architecture/YANCE_ACV2_WP_B_SOURCE_REVIEW_ZH.md',
  'docs/superpowers/plans/2026-08-04-yance-acv2-wp-b-milestone-3-implementation.md',
  'docs/superpowers/specs/2026-08-04-yance-acv2-wp-b-milestone-3-design.md',
  'governance/architecture-closure-v2/wp-b-closure.json',
  'governance/architecture-closure-v2/wp-b-m3-authorization.json',
  'governance/architecture-closure-v2/wp-b-open-source-adoption-gate.json',
  'governance/architecture-closure-v2/wp-b-open-source-adoption-registry.json',
  'governance/architecture-closure-v2/wp-b-operation-inventory.json',
  'governance/architecture-closure-v2/wp-b-provenance.json',
  'governance/architecture-closure-v2/wp-b-sbom.spdx.json',
  'governance/architecture-closure-v2/wp-b-source-closure-baseline.json',
  'package.json',
  'release/architecture-closure-v2/wp-b-governance-package.json',
  'shared/release/acv2ActiveWorkPackageAuthority.js',
  'tests/wp0/acv2-work-package-scope-wiring.test.js',
  'tests/wp0/implementation-branch-policy.test.js',
  'tools/architecture-closure-v2/generate-wp-b-sbom.js',
  'tools/architecture-closure-v2/run-wp-b-contracts.js',
  'tools/architecture-closure-v2/run-wp-b-isolated-regressions.js',
  'tools/architecture-closure-v2/run-wp-b-post-merge-contracts.js',
  'tools/architecture-closure-v2/source-capability-authority.js',
  'tools/architecture-closure-v2/source-closure-scan.js',
  'tools/architecture-closure-v2/verify-wp-b-closure.js',
  'tools/architecture-closure-v2/verify-wp-b-m3-authorization.js',
  'tools/architecture-closure-v2/verify-wp-b-open-source-adoption.js',
  'tools/architecture-closure-v2/verify-wp-b-post-merge.js',
  'tools/architecture-closure-v2/verify-wp-b-provenance.js'
]);
const AUTHORIZATION_FIELDS = Object.freeze([
  'redContractsMayBeWritten',
  'productionSourceClosureMayBeginAfterCredibleRed',
  'inventoryPathsMayBeDeletedOrDelegated',
  'sourceScannerMayBeGeneralized',
  'provenanceAndSbomMayBeGenerated',
  'permanentPostMergeValidationMayBeAdded',
  'independentReviewRemediationMayBeApplied',
  'authorizationAmendmentRequiredForNewPath'
]);
const NON_WAIVABLE_GATES = Object.freeze([
  'testFirstRequired',
  'credibleSameHeadUbuntuWindowsRedRequired',
  'wpASemanticsPreserved',
  'inventoryDrivenClosureRequired',
  'legacyCallablePathCountMustReachZero',
  'blindRetryPathCountMustReachZero',
  'ubuntuWindowsFinalMatrixRequired',
  'noticeLicenseSbomProvenanceRequired',
  'independentReviewGate3Required',
  'permanentPostMergeValidationRequired'
]);
const CLOSED_GOVERNANCE_FIELDS = Object.freeze([
  'readyForPromotion',
  'mergeAuthorized',
  'productionUseAuthorized',
  'wpCAuthorized',
  'formalRelease',
  'publish',
  'temporaryBypassAllowed',
  'warningOnlyClosureAllowed'
]);

function fail(code, message, details = {}) {
  throw Object.assign(new Error(message), { code, ...details });
}

function requireThat(value, code, message, details = {}) {
  if (!value) fail(code, message, details);
}

function normalizeRepositoryPath(value) {
  const normalized = String(value || '')
    .trim()
    .replace(/\\/gu, '/')
    .replace(/^\.\//u, '')
    .replace(/\/$/u, '');
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:\//u.test(normalized)) return '';
  const segments = normalized.split('/');
  if (segments.some(segment => !segment || segment === '.' || segment === '..')) return '';
  return normalized;
}

function sortedUnique(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map(normalizeRepositoryPath)
    .filter(Boolean))].sort();
}

function pathSetSha256(values) {
  const paths = sortedUnique(values);
  return crypto.createHash('sha256').update(`${paths.join('\n')}\n`, 'utf8').digest('hex');
}

function readJsonObject(filePath, code) {
  try {
    const document = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    requireThat(document && typeof document === 'object' && !Array.isArray(document), code, 'Expected one JSON object', { filePath });
    return document;
  } catch (cause) {
    if (String(cause?.code || '').startsWith('WP_B_M3_')) throw cause;
    fail(code, 'JSON document is unreadable', { filePath, cause: cause?.message || String(cause) });
  }
}

function readReceipt(receiptPath = RECEIPT_PATH) {
  return readJsonObject(receiptPath, 'WP_B_M3_AUTHORIZATION_RECEIPT_UNREADABLE');
}

function validateInventory(inventory) {
  requireThat(inventory?.schemaVersion === 2, 'WP_B_M3_AUTHORIZATION_INVENTORY_SCHEMA_INVALID', 'Inventory schema is invalid');
  requireThat(inventory.documentType === 'YANCE_ACV2_WP_B_OPERATION_INVENTORY' && inventory.workPackage === 'WP-B', 'WP_B_M3_AUTHORIZATION_INVENTORY_IDENTITY_INVALID', 'Inventory identity is invalid');
  requireThat(Array.isArray(inventory.entries) && inventory.entries.length > 0, 'WP_B_M3_AUTHORIZATION_INVENTORY_ENTRIES_REQUIRED', 'Inventory entries are required');
  const paths = inventory.entries.map(entry => normalizeRepositoryPath(entry?.path));
  requireThat(paths.every(Boolean), 'WP_B_M3_AUTHORIZATION_INVENTORY_PATH_INVALID', 'Inventory contains an invalid path');
  requireThat(paths.every((value, index) => value === inventory.entries[index].path), 'WP_B_M3_AUTHORIZATION_INVENTORY_PATH_INVALID', 'Inventory paths must be canonical');
  requireThat(paths.every(value => !value.includes('*')), 'WP_B_M3_AUTHORIZATION_INVENTORY_PATH_INVALID', 'Inventory wildcards are forbidden');
  requireThat(new Set(paths).size === paths.length, 'WP_B_M3_AUTHORIZATION_INVENTORY_PATH_DUPLICATE', 'Inventory paths must be unique');
  return Object.freeze({
    paths: Object.freeze([...paths].sort()),
    count: paths.length,
    sha256: pathSetSha256(paths)
  });
}

function validateReceipt(document) {
  requireThat(document?.schemaVersion === 1, 'WP_B_M3_AUTHORIZATION_SCHEMA_INVALID', 'Authorization schema is invalid');
  requireThat(document.documentType === 'YANCE_ACV2_WP_B_M3_AUTHORIZATION', 'WP_B_M3_AUTHORIZATION_TYPE_INVALID', 'Authorization type is invalid');
  requireThat(document.program === 'Architecture Closure V2' && document.repository === EXPECTED_REPOSITORY && document.workPackage === 'WP-B' && document.milestone === 3, 'WP_B_M3_AUTHORIZATION_IDENTITY_INVALID', 'Authorization identity is invalid');
  requireThat(document.status === 'AUTHORIZED_FOR_SOURCE_CLOSURE_AND_FINAL_GATES', 'WP_B_M3_AUTHORIZATION_STATUS_INVALID', 'Milestone 3 is not authorized');
  requireThat(document.approvedBy === 'PROJECT_OWNER' && document.approvalSource === 'Explicit full authorization in the 独立软件工程审计 conversation', 'WP_B_M3_AUTHORIZATION_APPROVER_INVALID', 'Project-owner authorization is required');
  requireThat(document.authorizedAt === '2026-08-04T14:56:00+07:00', 'WP_B_M3_AUTHORIZATION_TIME_INVALID', 'Authorization time is invalid');
  requireThat(document.pullRequest === 17 && document.branch === EXPECTED_BRANCH, 'WP_B_M3_AUTHORIZATION_PR_INVALID', 'PR or branch binding is invalid');
  requireThat(document.parentMilestone2EvidenceHead === EXPECTED_M2_EVIDENCE_HEAD, 'WP_B_M3_AUTHORIZATION_M2_EVIDENCE_INVALID', 'M2 evidence Head changed');
  requireThat(document.parentMilestone2SealHead === EXPECTED_M2_SEAL_HEAD, 'WP_B_M3_AUTHORIZATION_M2_SEAL_INVALID', 'M2 Seal Head changed');
  requireThat(document.parentMilestone2ReviewedHead === EXPECTED_M2_REVIEWED_HEAD, 'WP_B_M3_AUTHORIZATION_M2_REVIEWED_INVALID', 'M2 reviewed Head changed');
  requireThat(document.approvedDesignHead === EXPECTED_DESIGN_HEAD, 'WP_B_M3_AUTHORIZATION_DESIGN_HEAD_INVALID', 'Approved design Head changed');
  for (const value of [
    document.parentMilestone2EvidenceHead,
    document.parentMilestone2SealHead,
    document.parentMilestone2ReviewedHead,
    document.approvedDesignHead
  ]) requireThat(FULL_SHA.test(String(value || '')), 'WP_B_M3_AUTHORIZATION_HEAD_INVALID', 'Authorization contains an invalid full SHA');

  const red = document.authorizationContractRedEvidence || {};
  requireThat(red.head === EXPECTED_RED_HEAD && FULL_SHA.test(String(red.head || '')), 'WP_B_M3_AUTHORIZATION_RED_HEAD_INVALID', 'Authorization RED Head changed');
  requireThat(red.workflowName === 'WP-B M3 Authorization' && red.workflowRunId === EXPECTED_RED_RUN_ID, 'WP_B_M3_AUTHORIZATION_RED_RUN_INVALID', 'Authorization RED run changed');
  requireThat(red.ubuntuJobId === EXPECTED_RED_UBUNTU_JOB_ID && red.windowsJobId === EXPECTED_RED_WINDOWS_JOB_ID, 'WP_B_M3_AUTHORIZATION_RED_JOB_INVALID', 'Authorization RED jobs changed');
  requireThat(red.expectedConclusion === 'failure' && red.contractResult === '0_OF_6_PASS', 'WP_B_M3_AUTHORIZATION_RED_RESULT_INVALID', 'Authorization RED result changed');
  requireThat(JSON.stringify(red.failureIds) === JSON.stringify(EXPECTED_FAILURE_IDS), 'WP_B_M3_AUTHORIZATION_RED_FAILURE_SET_INVALID', 'Authorization RED failure set changed');

  requireThat(JSON.stringify(document.executionStages) === JSON.stringify(EXPECTED_EXECUTION_STAGES), 'WP_B_M3_AUTHORIZATION_EXECUTION_ORDER_INVALID', 'M3 execution order changed');

  const inventory = document.inventoryAuthority || {};
  requireThat(inventory.path === INVENTORY_PATH, 'WP_B_M3_AUTHORIZATION_INVENTORY_PATH_INVALID', 'Inventory path changed');
  requireThat(inventory.anchorHead === EXPECTED_M2_EVIDENCE_HEAD, 'WP_B_M3_AUTHORIZATION_INVENTORY_ANCHOR_INVALID', 'Inventory anchor Head changed');
  requireThat(inventory.anchorBlobSha === EXPECTED_INVENTORY_ANCHOR_BLOB && FULL_SHA.test(String(inventory.anchorBlobSha || '')), 'WP_B_M3_AUTHORIZATION_INVENTORY_BLOB_INVALID', 'Inventory anchor blob changed');
  requireThat(inventory.authorizedPathCount === EXPECTED_INVENTORY_PATH_COUNT, 'WP_B_M3_AUTHORIZATION_INVENTORY_COUNT_INVALID', 'Inventory path count changed');
  requireThat(inventory.authorizedPathSetSha256 === EXPECTED_INVENTORY_PATH_SHA256 && SHA256.test(String(inventory.authorizedPathSetSha256 || '')), 'WP_B_M3_AUTHORIZATION_INVENTORY_DIGEST_INVALID', 'Inventory path digest changed');
  requireThat(inventory.authorizationAmendmentRequiredForNewPath === true, 'WP_B_M3_AUTHORIZATION_INVENTORY_AMENDMENT_INVALID', 'New inventory paths require an authorization amendment');

  requireThat(Array.isArray(document.allowedPaths), 'WP_B_M3_AUTHORIZATION_PATH_SCOPE_INVALID', 'Allowed paths are required');
  const normalized = document.allowedPaths.map(normalizeRepositoryPath);
  requireThat(normalized.every(Boolean), 'WP_B_M3_AUTHORIZATION_PATH_SCOPE_INVALID', 'Allowed paths contain an invalid path');
  requireThat(normalized.every((value, index) => value === document.allowedPaths[index]), 'WP_B_M3_AUTHORIZATION_PATH_SCOPE_INVALID', 'Allowed paths must be canonical');
  requireThat(normalized.every(value => !value.includes('*')), 'WP_B_M3_AUTHORIZATION_PATH_SCOPE_INVALID', 'Wildcards are forbidden');
  requireThat(new Set(normalized).size === normalized.length, 'WP_B_M3_AUTHORIZATION_PATH_SCOPE_INVALID', 'Allowed paths contain duplicates');
  requireThat(JSON.stringify(normalized) === JSON.stringify(EXPECTED_ALLOWED_PATHS), 'WP_B_M3_AUTHORIZATION_PATH_SCOPE_INVALID', 'Allowed path set changed');

  for (const field of AUTHORIZATION_FIELDS) {
    requireThat(document.authorization?.[field] === true, 'WP_B_M3_AUTHORIZATION_CAPABILITY_INVALID', 'Authorization capability must be true', { field });
  }
  for (const field of NON_WAIVABLE_GATES) {
    requireThat(document.nonWaivableGates?.[field] === true, 'WP_B_M3_AUTHORIZATION_GATE_INVALID', 'Non-waivable gate must be true', { field });
  }

  const governance = document.governance || {};
  requireThat(governance.prMustRemainDraft === true && governance.milestone1Sealed === true && governance.milestone2Sealed === true && governance.milestone3Authorized === true, 'WP_B_M3_AUTHORIZATION_GOVERNANCE_PREREQUISITE_INVALID', 'M3 governance prerequisites are invalid');
  for (const field of CLOSED_GOVERNANCE_FIELDS) {
    requireThat(governance[field] === false, 'WP_B_M3_AUTHORIZATION_GOVERNANCE_OPEN', 'Downstream governance must remain closed', { field });
  }

  return Object.freeze({
    ok: true,
    branch: document.branch,
    parentMilestone2EvidenceHead: document.parentMilestone2EvidenceHead,
    parentMilestone2SealHead: document.parentMilestone2SealHead,
    parentMilestone2ReviewedHead: document.parentMilestone2ReviewedHead,
    approvedDesignHead: document.approvedDesignHead,
    allowedPaths: Object.freeze([...normalized])
  });
}

function resolveAuthorizedPaths(document = readReceipt(), options = {}) {
  validateReceipt(document);
  const repositoryRoot = path.resolve(options.repositoryRoot || REPOSITORY_ROOT);
  const inventoryPath = path.join(repositoryRoot, INVENTORY_PATH);
  const inventory = readJsonObject(inventoryPath, 'WP_B_M3_AUTHORIZATION_INVENTORY_UNREADABLE');
  const validated = validateInventory(inventory);
  requireThat(validated.count === document.inventoryAuthority.authorizedPathCount, 'WP_B_M3_AUTHORIZATION_INVENTORY_COUNT_INVALID', 'Current inventory path count is outside authorization', { expected: document.inventoryAuthority.authorizedPathCount, actual: validated.count });
  requireThat(validated.sha256 === document.inventoryAuthority.authorizedPathSetSha256, 'WP_B_M3_AUTHORIZATION_INVENTORY_DIGEST_INVALID', 'Current inventory path set is outside authorization', { expected: document.inventoryAuthority.authorizedPathSetSha256, actual: validated.sha256 });
  return Object.freeze(sortedUnique([...document.allowedPaths, ...validated.paths]));
}

function isAuthorizedPath(document, repositoryPath, options = {}) {
  try {
    const normalized = normalizeRepositoryPath(repositoryPath);
    if (!normalized) return false;
    return resolveAuthorizedPaths(document, options).includes(normalized);
  } catch (_) {
    return false;
  }
}

function git(repositoryRoot, args) {
  return execFileSync('git', args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
}

function verifyLocalRepository(document = readReceipt(), options = {}) {
  const validation = validateReceipt(document);
  const repositoryRoot = path.resolve(options.repositoryRoot || REPOSITORY_ROOT);
  requireThat(fs.existsSync(M2_REVIEW_PATH), 'WP_B_M3_AUTHORIZATION_M2_VERIFIER_MISSING', 'M2 review verifier is missing');
  delete require.cache[require.resolve(M2_REVIEW_PATH)];
  const m2Verifier = require(M2_REVIEW_PATH);
  const m2Receipt = m2Verifier.readReceipt();
  const m2 = m2Verifier.validateReceipt(m2Receipt);
  requireThat(m2.sealStatus === 'SEALED' && m2.sealHead === EXPECTED_M2_SEAL_HEAD && m2.reviewedHead === EXPECTED_M2_REVIEWED_HEAD, 'WP_B_M3_AUTHORIZATION_M2_SEAL_INVALID', 'M2 review receipt is not the exact sealed prerequisite');

  let currentHead;
  let anchorBlob;
  try {
    for (const commit of [
      EXPECTED_M2_REVIEWED_HEAD,
      EXPECTED_M2_SEAL_HEAD,
      EXPECTED_M2_EVIDENCE_HEAD,
      EXPECTED_DESIGN_HEAD,
      EXPECTED_RED_HEAD
    ]) git(repositoryRoot, ['cat-file', '-e', `${commit}^{commit}`]);
    currentHead = git(repositoryRoot, ['rev-parse', 'HEAD']);
    git(repositoryRoot, ['merge-base', '--is-ancestor', EXPECTED_M2_REVIEWED_HEAD, EXPECTED_M2_SEAL_HEAD]);
    git(repositoryRoot, ['merge-base', '--is-ancestor', EXPECTED_M2_SEAL_HEAD, EXPECTED_M2_EVIDENCE_HEAD]);
    git(repositoryRoot, ['merge-base', '--is-ancestor', EXPECTED_M2_EVIDENCE_HEAD, currentHead]);
    git(repositoryRoot, ['merge-base', '--is-ancestor', EXPECTED_DESIGN_HEAD, currentHead]);
    git(repositoryRoot, ['merge-base', '--is-ancestor', EXPECTED_RED_HEAD, currentHead]);
    anchorBlob = git(repositoryRoot, ['rev-parse', `${EXPECTED_M2_EVIDENCE_HEAD}:${INVENTORY_PATH}`]);
  } catch (cause) {
    fail('WP_B_M3_AUTHORIZATION_GIT_ANCESTRY_INVALID', 'Current Head does not preserve the exact M2/design/RED ancestry', { cause: cause?.message || String(cause) });
  }
  requireThat(anchorBlob === EXPECTED_INVENTORY_ANCHOR_BLOB, 'WP_B_M3_AUTHORIZATION_INVENTORY_BLOB_INVALID', 'Inventory anchor blob changed', { expected: EXPECTED_INVENTORY_ANCHOR_BLOB, actual: anchorBlob });
  const authorizedPaths = resolveAuthorizedPaths(document, { repositoryRoot });
  requireThat(git(repositoryRoot, ['branch', '--show-current']) === EXPECTED_BRANCH, 'WP_B_M3_AUTHORIZATION_BRANCH_CHECKOUT_INVALID', 'Wrong implementation branch is checked out');
  const status = git(repositoryRoot, ['status', '--porcelain=v1', '--untracked-files=all']);
  requireThat(status === '', 'WP_B_M3_AUTHORIZATION_WORKTREE_DIRTY', 'Authorization verification requires a clean worktree', { status });

  return Object.freeze({
    ok: true,
    currentHead,
    parentMilestone2EvidenceHead: validation.parentMilestone2EvidenceHead,
    parentMilestone2SealHead: validation.parentMilestone2SealHead,
    parentMilestone2ReviewedHead: validation.parentMilestone2ReviewedHead,
    approvedDesignHead: validation.approvedDesignHead,
    inventoryPathCount: EXPECTED_INVENTORY_PATH_COUNT,
    authorizedPathCount: authorizedPaths.length,
    m2SealVerified: true
  });
}

function resolveImplementationAuthority(options = {}) {
  const repositoryRoot = path.resolve(options.repositoryRoot || REPOSITORY_ROOT);
  const receiptPath = options.receiptPath || path.join(
    repositoryRoot,
    'governance',
    'architecture-closure-v2',
    'wp-b-m3-authorization.json'
  );
  try {
    const receipt = readReceipt(receiptPath);
    const validation = validateReceipt(receipt);
    const allowedProductionPaths = resolveAuthorizedPaths(receipt, { repositoryRoot });
    return Object.freeze({
      workPackage: 'WP-B',
      milestone: 3,
      status: receipt.status,
      authorizedBranch: validation.branch,
      parentMilestone2EvidenceHead: validation.parentMilestone2EvidenceHead,
      parentMilestone2SealHead: validation.parentMilestone2SealHead,
      parentMilestone2ReviewedHead: validation.parentMilestone2ReviewedHead,
      approvedDesignHead: validation.approvedDesignHead,
      allowedProductionPaths,
      governance: Object.freeze({ ...receipt.governance })
    });
  } catch (_) {
    return null;
  }
}

async function fetchJson(url, token, code) {
  let response;
  try {
    response = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'User-Agent': 'yance-acv2-wp-b-m3-authorization-verifier',
        'X-GitHub-Api-Version': '2022-11-28'
      },
      signal: AbortSignal.timeout(20000)
    });
  } catch (cause) {
    fail(code, 'GitHub API request failed', { url, cause: cause?.message || String(cause) });
  }
  if (!response.ok) fail(code, 'GitHub API returned non-success', { url, status: response.status, body: (await response.text()).slice(0, 1000) });
  return response.json();
}

async function verifyRemoteEvidence(document = readReceipt(), options = {}) {
  validateReceipt(document);
  const token = String(options.token || process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '');
  const repository = String(options.repository || process.env.GITHUB_REPOSITORY || document.repository || '');
  requireThat(token && repository === EXPECTED_REPOSITORY, 'WP_B_M3_AUTHORIZATION_REMOTE_TOKEN_REQUIRED', 'Authenticated repository token is required');
  const api = `https://api.github.com/repos/${repository}`;
  const red = document.authorizationContractRedEvidence;
  const run = await fetchJson(`${api}/actions/runs/${red.workflowRunId}`, token, 'WP_B_M3_AUTHORIZATION_REMOTE_RUN_REQUEST_FAILED');
  requireThat(run.name === red.workflowName && run.head_sha === red.head && run.status === 'completed' && run.conclusion === 'failure', 'WP_B_M3_AUTHORIZATION_REMOTE_RED_MISMATCH', 'Remote authorization RED run changed');
  const jobsPage = await fetchJson(`${api}/actions/runs/${red.workflowRunId}/jobs?per_page=100`, token, 'WP_B_M3_AUTHORIZATION_REMOTE_JOBS_REQUEST_FAILED');
  const jobs = new Map((jobsPage.jobs || []).map(job => [Number(job.id), job]));
  for (const [jobId, expectedName] of [
    [red.ubuntuJobId, 'wp-b-m3-authorization-ubuntu-latest'],
    [red.windowsJobId, 'wp-b-m3-authorization-windows-latest']
  ]) {
    const job = jobs.get(jobId);
    requireThat(job?.name === expectedName && job.status === 'completed' && job.conclusion === 'failure', 'WP_B_M3_AUTHORIZATION_REMOTE_RED_JOB_MISMATCH', 'Remote authorization RED job changed', { jobId });
  }
  const currentHead = String(options.currentHead || git(REPOSITORY_ROOT, ['rev-parse', 'HEAD']));
  const pr = await fetchJson(`${api}/pulls/${document.pullRequest}`, token, 'WP_B_M3_AUTHORIZATION_REMOTE_PR_REQUEST_FAILED');
  requireThat(pr.state === 'open' && pr.draft === true && pr.merged_at == null, 'WP_B_M3_AUTHORIZATION_REMOTE_PR_STATE_INVALID', 'PR must remain Draft/open/unmerged');
  requireThat(pr.head?.ref === document.branch && pr.head?.sha === currentHead && pr.base?.ref === 'main', 'WP_B_M3_AUTHORIZATION_REMOTE_PR_HEAD_INVALID', 'PR refs changed', { expectedHead: currentHead, actualHead: pr.head?.sha });
  return Object.freeze({ ok: true, credibleRedVerified: true, prDraftOpenUnmerged: true, currentHead });
}

async function main() {
  const receipt = readReceipt();
  const local = verifyLocalRepository(receipt);
  const remote = process.argv.includes('--remote')
    ? await verifyRemoteEvidence(receipt, { currentHead: local.currentHead })
    : null;
  process.stdout.write(`${JSON.stringify({ status: 'PASS', local, remote }, null, 2)}\n`);
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`${JSON.stringify({
      status: 'FAIL',
      code: error?.code || 'WP_B_M3_AUTHORIZATION_UNKNOWN_FAILURE',
      message: error?.message || String(error),
      details: Object.fromEntries(Object.entries(error || {}).filter(([key]) => !['name', 'message', 'stack'].includes(key)))
    }, null, 2)}\n`);
    process.exitCode = 1;
  });
}

module.exports = Object.freeze({
  EXPECTED_ALLOWED_PATHS,
  EXPECTED_BRANCH,
  EXPECTED_EXECUTION_STAGES,
  EXPECTED_M2_EVIDENCE_HEAD,
  EXPECTED_M2_REVIEWED_HEAD,
  EXPECTED_M2_SEAL_HEAD,
  RECEIPT_PATH,
  isAuthorizedPath,
  normalizeRepositoryPath,
  pathSetSha256,
  readReceipt,
  resolveAuthorizedPaths,
  resolveImplementationAuthority,
  sortedUnique,
  validateInventory,
  validateReceipt,
  verifyLocalRepository,
  verifyRemoteEvidence
});
