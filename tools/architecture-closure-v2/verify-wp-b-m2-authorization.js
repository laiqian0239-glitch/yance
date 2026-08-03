#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPOSITORY_ROOT = path.resolve(__dirname, '..', '..');
const RECEIPT_PATH = path.join(
  REPOSITORY_ROOT,
  'governance',
  'architecture-closure-v2',
  'wp-b-m2-authorization.json'
);
const M1_RECEIPT_PATH = path.join(
  REPOSITORY_ROOT,
  'governance',
  'architecture-closure-v2',
  'wp-b-m1-review.json'
);
const FULL_SHA = /^[a-f0-9]{40}$/u;
const EXPECTED_DOCUMENT_TYPE = 'YANCE_ACV2_WP_B_M2_AUTHORIZATION';
const EXPECTED_REPOSITORY = 'laiqian0239-glitch/yance';
const EXPECTED_BRANCH = 'acv2/wp-b-durable-execution-outbox';
const EXPECTED_PARENT_SEAL_HEAD = '1e3d600f0647af35e737ff92a200c67e69224c82';
const EXPECTED_OPERATION_KINDS = Object.freeze([
  'AI_PROVIDER_EXECUTION',
  'OUTBOUND_MESSAGE_SEND',
  'DELIVERY_RECEIPT_RECONCILIATION',
  'MEDIA_TRANSFER',
  'HISTORY_SYNCHRONIZATION',
  'SESSION_RESTORE'
]);
const REQUIRED_CLOSED_GOVERNANCE_FIELDS = Object.freeze([
  'readyForPromotion',
  'milestone3Authorized',
  'mergeAuthorized',
  'productionUseAuthorized',
  'wpCAuthorized',
  'formalRelease',
  'publish',
  'temporaryBypassAllowed',
  'warningOnlyClosureAllowed'
]);
const FORBIDDEN_SCOPE_PATTERNS = Object.freeze([
  '**',
  '.github/workflows/**',
  'backend/**',
  'electron/**'
]);
const REQUIRED_PATHS = Object.freeze([
  '.github/workflows/wp-b-m1-independent-review-integrity.yml',
  '.github/workflows/wp-b-m2-authorization.yml',
  'backend/services/modelExecutionEvidenceStore.js',
  'backend/tests/architectureClosureV2/wpB/deliveryReceiptReconciliationOperation.test.js',
  'backend/tests/architectureClosureV2/wpB/m1SealContinuation.test.js',
  'backend/tests/architectureClosureV2/wpB/m2Authorization.test.js',
  'backend/tests/architectureClosureV2/wpB/m2ContractEvidenceDiagnostics.test.js',
  'backend/tests/architectureClosureV2/wpB/modelExecutionEvidenceBoundary.test.js',
  'governance/architecture-closure-v2/wp-b-m1-review.json',
  'governance/architecture-closure-v2/wp-b-m2-authorization.json',
  'shared/release/acv2ActiveWorkPackageAuthority.js',
  'shared/release/acv2ActiveWorkPackageAuthorityEngine.js',
  'tools/architecture-closure-v2/verify-wp-b-m1-review.js',
  'tools/architecture-closure-v2/verify-wp-b-m2-authorization.js'
]);

function authorizationError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, ...details });
}

function assertCondition(condition, code, message, details = {}) {
  if (!condition) throw authorizationError(code, message, details);
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

function normalizePaths(values) {
  return (Array.isArray(values) ? values : []).map(normalizeRepositoryPath);
}

function readJsonObject(filePath, code) {
  try {
    const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    assertCondition(value && typeof value === 'object' && !Array.isArray(value), code, 'Expected one JSON object', { filePath });
    return value;
  } catch (cause) {
    if (cause?.code?.startsWith?.('WP_B_M2_')) throw cause;
    throw authorizationError(code, 'Authorization JSON is unreadable', {
      filePath,
      cause: cause?.message || String(cause)
    });
  }
}

function readReceipt(receiptPath = RECEIPT_PATH) {
  return readJsonObject(receiptPath, 'WP_B_M2_AUTHORIZATION_RECEIPT_UNREADABLE');
}

function validateReceipt(document) {
  assertCondition(document && typeof document === 'object' && !Array.isArray(document), 'WP_B_M2_AUTHORIZATION_RECEIPT_INVALID', 'Milestone 2 authorization must be one JSON object');
  assertCondition(document.schemaVersion === 1, 'WP_B_M2_AUTHORIZATION_SCHEMA_INVALID', 'Unexpected authorization schema version');
  assertCondition(document.documentType === EXPECTED_DOCUMENT_TYPE, 'WP_B_M2_AUTHORIZATION_TYPE_INVALID', 'Unexpected authorization document type');
  assertCondition(document.program === 'Architecture Closure V2', 'WP_B_M2_AUTHORIZATION_PROGRAM_INVALID', 'Unexpected program');
  assertCondition(document.repository === EXPECTED_REPOSITORY, 'WP_B_M2_AUTHORIZATION_REPOSITORY_INVALID', 'Unexpected repository');
  assertCondition(document.workPackage === 'WP-B', 'WP_B_M2_AUTHORIZATION_WORK_PACKAGE_INVALID', 'Unexpected work package');
  assertCondition(document.status === 'AUTHORIZED_FOR_RED_AND_IMPLEMENTATION', 'WP_B_M2_AUTHORIZATION_STATUS_INVALID', 'Milestone 2 is not authorized for RED and implementation');
  assertCondition(document.approvedBy === 'PROJECT_OWNER', 'WP_B_M2_AUTHORIZATION_APPROVER_INVALID', 'Authorization must be issued by the project owner');
  assertCondition(document.pullRequest === 17, 'WP_B_M2_AUTHORIZATION_PR_INVALID', 'Authorization must bind PR #17');
  assertCondition(document.branch === EXPECTED_BRANCH, 'WP_B_M2_AUTHORIZATION_BRANCH_INVALID', 'Authorization branch is invalid');
  assertCondition(document.parentMilestone1SealHead === EXPECTED_PARENT_SEAL_HEAD, 'WP_B_M2_AUTHORIZATION_PARENT_SEAL_INVALID', 'Authorization must bind the exact Milestone 1 Seal Head');
  assertCondition(FULL_SHA.test(String(document.parentMilestone1SealHead || '')), 'WP_B_M2_AUTHORIZATION_PARENT_SEAL_INVALID', 'Parent Seal Head must be a full SHA');
  assertCondition(JSON.stringify(document.operationKinds) === JSON.stringify(EXPECTED_OPERATION_KINDS), 'WP_B_M2_AUTHORIZATION_OPERATION_ORDER_INVALID', 'Mandatory operation order must be exact');

  const red = document.authorizationContractRedEvidence || {};
  assertCondition(FULL_SHA.test(String(red.head || '')), 'WP_B_M2_AUTHORIZATION_RED_HEAD_INVALID', 'Authorization RED Head is invalid');
  assertCondition(red.workflowName === 'WP-B M2 Authorization', 'WP_B_M2_AUTHORIZATION_RED_WORKFLOW_INVALID', 'Authorization RED workflow is invalid');
  assertCondition(Number.isSafeInteger(red.workflowRunId) && red.workflowRunId > 0, 'WP_B_M2_AUTHORIZATION_RED_RUN_INVALID', 'Authorization RED run is invalid');
  assertCondition(Number.isSafeInteger(red.ubuntuJobId) && red.ubuntuJobId > 0, 'WP_B_M2_AUTHORIZATION_RED_JOB_INVALID', 'Ubuntu RED job is invalid');
  assertCondition(Number.isSafeInteger(red.windowsJobId) && red.windowsJobId > 0, 'WP_B_M2_AUTHORIZATION_RED_JOB_INVALID', 'Windows RED job is invalid');
  assertCondition(red.expectedConclusion === 'failure' && red.contractResult === '0_OF_8_PASS', 'WP_B_M2_AUTHORIZATION_RED_RESULT_INVALID', 'Authorization RED evidence must preserve 0/8 failure');

  const normalizedPaths = normalizePaths(document.allowedPaths);
  assertCondition(Array.isArray(document.allowedPaths) && document.allowedPaths.length > 0, 'WP_B_M2_AUTHORIZATION_PATH_SCOPE_INVALID', 'Allowed path set is empty');
  assertCondition(normalizedPaths.every(Boolean), 'WP_B_M2_AUTHORIZATION_PATH_SCOPE_INVALID', 'Allowed path set contains an invalid path');
  assertCondition(normalizedPaths.every((value, index) => value === document.allowedPaths[index]), 'WP_B_M2_AUTHORIZATION_PATH_SCOPE_INVALID', 'Allowed paths must already be canonical repository paths');
  assertCondition(new Set(normalizedPaths).size === normalizedPaths.length, 'WP_B_M2_AUTHORIZATION_PATH_SCOPE_INVALID', 'Allowed path set contains duplicates');
  assertCondition(normalizedPaths.every(value => !FORBIDDEN_SCOPE_PATTERNS.includes(value)), 'WP_B_M2_AUTHORIZATION_PATH_SCOPE_INVALID', 'Authorization contains a forbidden global wildcard');
  assertCondition(normalizedPaths.every(value => !value.includes('*')), 'WP_B_M2_AUTHORIZATION_PATH_SCOPE_INVALID', 'Milestone 2 authorization requires exact paths, not wildcard paths');
  for (const requiredPath of REQUIRED_PATHS) {
    assertCondition(normalizedPaths.includes(requiredPath), 'WP_B_M2_AUTHORIZATION_REQUIRED_PATH_MISSING', 'Required authorization path is missing', { requiredPath });
  }

  const authorization = document.authorization || {};
  for (const field of [
    'redContractsMayBeWritten',
    'productionCodeMayBeChangedAfterCredibleM2Red',
    'ciAndFaultInjectionMayBeRun',
    'independentReviewRemediationMayBeApplied',
    'migratedOperationLegacyPathsMayBeDeletedOrDelegated',
    'authorizationAmendmentRequiredForNewPath'
  ]) {
    assertCondition(authorization[field] === true, 'WP_B_M2_AUTHORIZATION_CAPABILITY_INVALID', `Authorization capability ${field} must be true`, { field });
  }

  const gates = document.nonWaivableGates || {};
  for (const field of [
    'testFirstRequired',
    'credibleSameHeadUbuntuWindowsRedRequired',
    'databaseCasAndFencingRequired',
    'attemptBeforePhysicalCallRequired',
    'unknownOutcomeBlindRetryForbidden',
    'ubuntuWindowsFaultMatrixRequired',
    'independentReviewGate2Required'
  ]) {
    assertCondition(gates[field] === true, 'WP_B_M2_AUTHORIZATION_GATE_INVALID', `Non-waivable gate ${field} must be true`, { field });
  }

  const governance = document.governance || {};
  assertCondition(governance.prMustRemainDraft === true, 'WP_B_M2_AUTHORIZATION_DRAFT_POLICY_INVALID', 'PR #17 must remain Draft');
  assertCondition(governance.milestone2Authorized === true, 'WP_B_M2_AUTHORIZATION_NOT_OPEN', 'Milestone 2 must be explicitly authorized');
  for (const field of REQUIRED_CLOSED_GOVERNANCE_FIELDS) {
    assertCondition(governance[field] === false, 'WP_B_M2_AUTHORIZATION_GOVERNANCE_OPEN', `Governance field ${field} must remain false`, { field });
  }

  return Object.freeze({
    ok: true,
    repository: document.repository,
    pullRequest: document.pullRequest,
    branch: document.branch,
    parentMilestone1SealHead: document.parentMilestone1SealHead,
    operationKinds: Object.freeze([...document.operationKinds]),
    allowedPaths: Object.freeze([...normalizedPaths])
  });
}

function isAuthorizedPath(document, repositoryPath) {
  try {
    validateReceipt(document);
  } catch (_) {
    return false;
  }
  const normalized = normalizeRepositoryPath(repositoryPath);
  return Boolean(normalized && document.allowedPaths.includes(normalized));
}

function git(repositoryRoot, args) {
  return execFileSync('git', args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
}

function verifyLocalRepository(document = readReceipt(), options = {}) {
  const result = validateReceipt(document);
  const repositoryRoot = path.resolve(options.repositoryRoot || REPOSITORY_ROOT);
  const m1VerifierPath = path.join(repositoryRoot, 'tools', 'architecture-closure-v2', 'verify-wp-b-m1-review.js');
  const m1ReceiptPath = path.join(repositoryRoot, 'governance', 'architecture-closure-v2', 'wp-b-m1-review.json');
  assertCondition(fs.existsSync(m1VerifierPath), 'WP_B_M2_AUTHORIZATION_M1_VERIFIER_MISSING', 'Milestone 1 verifier is missing');
  assertCondition(fs.existsSync(m1ReceiptPath), 'WP_B_M2_AUTHORIZATION_M1_RECEIPT_MISSING', 'Milestone 1 receipt is missing');

  delete require.cache[require.resolve(m1VerifierPath)];
  const m1Verifier = require(m1VerifierPath);
  const m1Receipt = m1Verifier.readReceipt(m1ReceiptPath);
  const m1Validation = m1Verifier.validateReceipt(m1Receipt);
  assertCondition(m1Validation.sealHead === result.parentMilestone1SealHead, 'WP_B_M2_AUTHORIZATION_M1_SEAL_MISMATCH', 'Milestone 2 parent does not match the immutable M1 Seal Head');
  const m1Local = m1Verifier.verifyLocalRepository(m1Receipt);

  let currentHead;
  try {
    git(repositoryRoot, ['cat-file', '-e', `${result.parentMilestone1SealHead}^{commit}`]);
    currentHead = git(repositoryRoot, ['rev-parse', 'HEAD']);
    git(repositoryRoot, ['merge-base', '--is-ancestor', result.parentMilestone1SealHead, currentHead]);
  } catch (cause) {
    throw authorizationError('WP_B_M2_AUTHORIZATION_GIT_ANCESTRY_INVALID', 'Current Head must descend from the exact Milestone 1 Seal Head', { cause: cause?.message || String(cause) });
  }

  const status = git(repositoryRoot, ['status', '--porcelain=v1', '--untracked-files=all']);
  assertCondition(status === '', 'WP_B_M2_AUTHORIZATION_WORKTREE_DIRTY', 'Authorization verification requires a clean worktree', { status });
  return Object.freeze({
    ok: true,
    currentHead,
    parentMilestone1SealHead: result.parentMilestone1SealHead,
    m1SealVerified: m1Local.ok === true,
    operationKinds: result.operationKinds,
    allowedPathCount: result.allowedPaths.length
  });
}

function resolveImplementationAuthority(options = {}) {
  const receiptPath = options.receiptPath || path.join(
    path.resolve(options.repositoryRoot || REPOSITORY_ROOT),
    'governance',
    'architecture-closure-v2',
    'wp-b-m2-authorization.json'
  );
  let receipt;
  try {
    receipt = readReceipt(receiptPath);
    const result = validateReceipt(receipt);
    return Object.freeze({
      workPackage: 'WP-B',
      milestone: 2,
      authorizedBranch: result.branch,
      parentMilestone1SealHead: result.parentMilestone1SealHead,
      operationKinds: Object.freeze([...result.operationKinds]),
      allowedProductionPaths: Object.freeze([...result.allowedPaths]),
      governance: Object.freeze({ ...receipt.governance })
    });
  } catch (_) {
    return null;
  }
}

function main() {
  const receipt = readReceipt();
  const local = verifyLocalRepository(receipt);
  process.stdout.write(`${JSON.stringify({ status: 'PASS', local }, null, 2)}\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      status: 'FAIL',
      code: error?.code || 'WP_B_M2_AUTHORIZATION_UNKNOWN_FAILURE',
      message: error?.message || String(error),
      details: Object.fromEntries(Object.entries(error || {}).filter(([key]) => !['name', 'message', 'stack'].includes(key)))
    }, null, 2)}\n`);
    process.exitCode = 1;
  }
}

module.exports = Object.freeze({
  EXPECTED_BRANCH,
  EXPECTED_OPERATION_KINDS,
  EXPECTED_PARENT_SEAL_HEAD,
  RECEIPT_PATH,
  REQUIRED_CLOSED_GOVERNANCE_FIELDS,
  isAuthorizedPath,
  normalizeRepositoryPath,
  readReceipt,
  resolveImplementationAuthority,
  validateReceipt,
  verifyLocalRepository
});
