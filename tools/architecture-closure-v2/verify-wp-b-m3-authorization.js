#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPOSITORY_ROOT = path.resolve(__dirname, '..', '..');
const RECEIPT_PATH = path.join(REPOSITORY_ROOT, 'governance', 'architecture-closure-v2', 'wp-b-m3-authorization.json');
const INVENTORY_PATH = 'governance/architecture-closure-v2/wp-b-operation-inventory.json';
const INVENTORY_EXTENSION_PATH = 'governance/architecture-closure-v2/wp-b-operation-inventory-m3-extension.json';
const M2_REVIEW_PATH = path.join(REPOSITORY_ROOT, 'tools', 'architecture-closure-v2', 'verify-wp-b-m2-review.js');
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
const EXPECTED_SCOPE_002_TRUSTED_MAIN = '7ab4b85f6bdbce34ea96b608a807ca120618bb87';
const EXPECTED_SCOPE_002_RED_HEAD = '8c9edef0c2e19f56081f769d3d509d76cb797a84';
const EXPECTED_SCOPE_002_PR17_PARENT = '708ce1290f3bfcaec3a3a8c6589248fde5961c47';
const EXPECTED_FAILURE_IDS = Object.freeze([
  'M3-AUTH-001', 'M3-AUTH-002', 'M3-AUTH-003',
  'M3-AUTH-004', 'M3-AUTH-005', 'M3-AUTH-006'
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
const BASE_ALLOWED_PATHS = Object.freeze([
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
const EXPECTED_AMENDMENT = Object.freeze({
  amendmentId: 'WP-B-M3-SCOPE-001',
  authorizedAt: '2026-08-04T16:05:00+07:00',
  approvedBy: 'PROJECT_OWNER',
  approvalSource: 'Project owner full Milestone 3 execution authorization in the 独立软件工程审计 conversation',
  reasonCode: 'WP_B_M3_CANONICAL_INTERNAL_OPERATION_AUTHORITY',
  addedPaths: Object.freeze([
    'backend/services/durableInternalOperationAuthority.js',
    INVENTORY_EXTENSION_PATH
  ])
});
const EXPECTED_SCOPE_002_AMENDMENT = Object.freeze({
  amendmentId: 'WP-B-M3-SCOPE-002',
  authorizedAt: '2026-08-17T00:14:00+07:00',
  approvedBy: 'PROJECT_OWNER',
  approvalSource: 'Project owner explicit WP-B-M3-SCOPE-002 authorization in the 独立软件工程审计 conversation',
  reasonCode: 'WP_B_M3_FRESH_MAIN_OPERATION_AND_BINDING_CLOSURE',
  trustedMainHead: EXPECTED_SCOPE_002_TRUSTED_MAIN,
  causalRedEvidence: Object.freeze({
    head: EXPECTED_SCOPE_002_RED_HEAD,
    stageRunId: 31960025396,
    wpBValidationRunId: 31960025418,
    wpBM2ContractsRunId: 31960025398,
    unknownBlockers: 0
  }),
  addedPaths: Object.freeze([
    'backend/services/facebookChatwootMatrixBridge.js',
    'governance/architecture-closure-v2/wp-b-xstate-supply-chain-lock.json',
    'release/production-dependency-binding.json',
    'tests/wp0/open-source-work-package-authorization.test.js',
    'tests/wp0/v21-voice-brain-authority-cutover.test.js'
  ])
});
const EXPECTED_AMENDMENTS = Object.freeze([EXPECTED_AMENDMENT, EXPECTED_SCOPE_002_AMENDMENT]);
const EXPECTED_ALLOWED_PATHS = Object.freeze([
  ...BASE_ALLOWED_PATHS,
  ...EXPECTED_AMENDMENT.addedPaths,
  ...EXPECTED_SCOPE_002_AMENDMENT.addedPaths
].sort());
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
  'readyForPromotion', 'mergeAuthorized', 'productionUseAuthorized', 'wpCAuthorized',
  'formalRelease', 'publish', 'temporaryBypassAllowed', 'warningOnlyClosureAllowed'
]);
const TERMINAL_OR_ACTIVE_EXTENSION_STATES = new Set(['OPEN', 'DELEGATES_TO_WP_B_AUTHORITY', 'READ_ONLY_PROJECTION', 'DELETED']);

function fail(code, message, details = {}) {
  throw Object.assign(new Error(message), { code, ...details });
}
function requireThat(value, code, message, details = {}) {
  if (!value) fail(code, message, details);
}
function normalizeRepositoryPath(value) {
  const normalized = String(value || '').trim().replace(/\\/gu, '/').replace(/^\.\//u, '').replace(/\/$/u, '');
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:\//u.test(normalized)) return '';
  const segments = normalized.split('/');
  if (segments.some(segment => !segment || segment === '.' || segment === '..')) return '';
  return normalized;
}
function sortedUnique(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(normalizeRepositoryPath).filter(Boolean))].sort();
}
function pathSetSha256(values) {
  return crypto.createHash('sha256').update(`${sortedUnique(values).join('\n')}\n`, 'utf8').digest('hex');
}
function readJsonObject(filePath, code) {
  try {
    const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    requireThat(value && typeof value === 'object' && !Array.isArray(value), code, 'Expected one JSON object', { filePath });
    return value;
  } catch (cause) {
    if (String(cause?.code || '').startsWith('WP_B_M3_')) throw cause;
    fail(code, 'JSON document is unreadable', { filePath, cause: cause?.message || String(cause) });
  }
}
function readReceipt(receiptPath = RECEIPT_PATH) {
  return readJsonObject(receiptPath, 'WP_B_M3_AUTHORIZATION_RECEIPT_UNREADABLE');
}
function validateBaseInventory(inventory) {
  requireThat(inventory?.schemaVersion === 2, 'WP_B_M3_AUTHORIZATION_INVENTORY_SCHEMA_INVALID', 'Inventory schema is invalid');
  requireThat(inventory.documentType === 'YANCE_ACV2_WP_B_OPERATION_INVENTORY' && inventory.workPackage === 'WP-B', 'WP_B_M3_AUTHORIZATION_INVENTORY_IDENTITY_INVALID', 'Inventory identity is invalid');
  const paths = (inventory.entries || []).map(entry => normalizeRepositoryPath(entry?.path));
  requireThat(paths.length > 0 && paths.every(Boolean), 'WP_B_M3_AUTHORIZATION_INVENTORY_PATH_INVALID', 'Inventory contains invalid paths');
  requireThat(paths.every((value, index) => value === inventory.entries[index].path), 'WP_B_M3_AUTHORIZATION_INVENTORY_PATH_INVALID', 'Inventory paths must be canonical');
  requireThat(paths.every(value => !value.includes('*')) && new Set(paths).size === paths.length, 'WP_B_M3_AUTHORIZATION_INVENTORY_PATH_INVALID', 'Inventory paths must be exact and unique');
  return Object.freeze({ paths: Object.freeze([...paths].sort()), count: paths.length, sha256: pathSetSha256(paths) });
}
function validateInventoryExtension(extension) {
  requireThat(extension?.schemaVersion === 1, 'WP_B_M3_AUTHORIZATION_INVENTORY_EXTENSION_SCHEMA_INVALID', 'Inventory extension schema is invalid');
  requireThat(extension.documentType === 'YANCE_ACV2_WP_B_OPERATION_INVENTORY_EXTENSION' && extension.workPackage === 'WP-B' && extension.milestone === 3, 'WP_B_M3_AUTHORIZATION_INVENTORY_EXTENSION_IDENTITY_INVALID', 'Inventory extension identity is invalid');
  requireThat(extension.authorizationAmendmentId === EXPECTED_AMENDMENT.amendmentId, 'WP_B_M3_AUTHORIZATION_INVENTORY_EXTENSION_AMENDMENT_INVALID', 'Legacy extension amendment identity changed');
  requireThat(JSON.stringify(extension.authorizationAmendmentIds) === JSON.stringify(EXPECTED_AMENDMENTS.map(value => value.amendmentId)), 'WP_B_M3_AUTHORIZATION_INVENTORY_EXTENSION_AMENDMENT_INVALID', 'Inventory extension amendment chain changed');
  requireThat(Array.isArray(extension.entries) && extension.entries.length === 2, 'WP_B_M3_AUTHORIZATION_INVENTORY_EXTENSION_ENTRIES_INVALID', 'Inventory extension must contain exactly two authorized entries');
  const internal = extension.entries[0];
  requireThat(internal?.id === 'WPB-DURABLE-INTERNAL-OPERATION-AUTHORITY' && internal.path === 'backend/services/durableInternalOperationAuthority.js', 'WP_B_M3_AUTHORIZATION_INVENTORY_EXTENSION_ENTRY_INVALID', 'Internal authority extension identity changed');
  requireThat(internal.authorizationAmendmentId === EXPECTED_AMENDMENT.amendmentId, 'WP_B_M3_AUTHORIZATION_INVENTORY_EXTENSION_ENTRY_INVALID', 'Internal authority amendment binding changed');
  requireThat(internal.classification === 'RUNTIME_COMPOSITION' && TERMINAL_OR_ACTIVE_EXTENSION_STATES.has(internal.closureState), 'WP_B_M3_AUTHORIZATION_INVENTORY_EXTENSION_ENTRY_INVALID', 'Internal authority classification/state is invalid');
  requireThat(Array.isArray(internal.operationKinds) && internal.operationKinds.length === 6 && internal.currentResponsibilities?.includes('DURABLE_INTERNAL_OPERATION_LIFECYCLE'), 'WP_B_M3_AUTHORIZATION_INVENTORY_EXTENSION_ENTRY_INVALID', 'Internal authority operation contract changed');
  requireThat(internal.targetAuthority === 'DurableExecutionAuthorityV2', 'WP_B_M3_AUTHORIZATION_INVENTORY_EXTENSION_ENTRY_INVALID', 'Internal authority target changed');

  const facebook = extension.entries[1];
  requireThat(facebook?.id === 'WPB-FACEBOOK-CHATWOOT-MATRIX-BRIDGE' && facebook.path === 'backend/services/facebookChatwootMatrixBridge.js', 'WP_B_M3_AUTHORIZATION_INVENTORY_EXTENSION_ENTRY_INVALID', 'Facebook bridge extension identity changed');
  requireThat(facebook.authorizationAmendmentId === EXPECTED_SCOPE_002_AMENDMENT.amendmentId, 'WP_B_M3_AUTHORIZATION_INVENTORY_EXTENSION_ENTRY_INVALID', 'Facebook bridge amendment binding changed');
  requireThat(facebook.classification === 'PHYSICAL_IO_ADAPTER' && TERMINAL_OR_ACTIVE_EXTENSION_STATES.has(facebook.closureState), 'WP_B_M3_AUTHORIZATION_INVENTORY_EXTENSION_ENTRY_INVALID', 'Facebook bridge classification/state is invalid');
  requireThat(JSON.stringify(facebook.operationKinds) === JSON.stringify(['OUTBOUND_MESSAGE_SEND', 'MEDIA_TRANSFER', 'HISTORY_SYNCHRONIZATION', 'SESSION_RESTORE']), 'WP_B_M3_AUTHORIZATION_INVENTORY_EXTENSION_ENTRY_INVALID', 'Facebook bridge operation kinds changed');
  requireThat(JSON.stringify(facebook.currentResponsibilities) === JSON.stringify(['CHATWOOT_NETWORK_CALL', 'MATRIX_NETWORK_CALL', 'REMOTE_MEDIA_TRANSFER', 'SESSION_AND_SYNC_PHYSICAL_IO']), 'WP_B_M3_AUTHORIZATION_INVENTORY_EXTENSION_ENTRY_INVALID', 'Facebook bridge responsibilities changed');
  requireThat(facebook.targetAuthority === 'CHANNEL_OPERATION_ADAPTER' && String(facebook.removalCondition || '').trim(), 'WP_B_M3_AUTHORIZATION_INVENTORY_EXTENSION_ENTRY_INVALID', 'Facebook bridge authority contract changed');
  return Object.freeze({
    paths: Object.freeze([internal.path, facebook.path]),
    entries: Object.freeze(extension.entries.map(entry => Object.freeze({ ...entry })))
  });
}
function validateReceipt(document) {
  requireThat(document?.schemaVersion === 1 && document.documentType === 'YANCE_ACV2_WP_B_M3_AUTHORIZATION', 'WP_B_M3_AUTHORIZATION_SCHEMA_INVALID', 'Authorization schema/type is invalid');
  requireThat(document.program === 'Architecture Closure V2' && document.repository === EXPECTED_REPOSITORY && document.workPackage === 'WP-B' && document.milestone === 3, 'WP_B_M3_AUTHORIZATION_IDENTITY_INVALID', 'Authorization identity is invalid');
  requireThat(document.status === 'AUTHORIZED_FOR_SOURCE_CLOSURE_AND_FINAL_GATES', 'WP_B_M3_AUTHORIZATION_STATUS_INVALID', 'Milestone 3 is not authorized');
  requireThat(document.approvedBy === 'PROJECT_OWNER' && document.approvalSource === 'Explicit full authorization in the 独立软件工程审计 conversation', 'WP_B_M3_AUTHORIZATION_APPROVER_INVALID', 'Project-owner authorization is required');
  requireThat(document.authorizedAt === '2026-08-04T14:56:00+07:00' && document.pullRequest === 17 && document.branch === EXPECTED_BRANCH, 'WP_B_M3_AUTHORIZATION_PR_INVALID', 'Authorization time/PR/branch is invalid');
  requireThat(document.parentMilestone2EvidenceHead === EXPECTED_M2_EVIDENCE_HEAD, 'WP_B_M3_AUTHORIZATION_M2_EVIDENCE_INVALID', 'M2 evidence Head changed');
  requireThat(document.parentMilestone2SealHead === EXPECTED_M2_SEAL_HEAD, 'WP_B_M3_AUTHORIZATION_M2_SEAL_INVALID', 'M2 Seal Head changed');
  requireThat(document.parentMilestone2ReviewedHead === EXPECTED_M2_REVIEWED_HEAD, 'WP_B_M3_AUTHORIZATION_M2_REVIEWED_INVALID', 'M2 reviewed Head changed');
  requireThat(document.approvedDesignHead === EXPECTED_DESIGN_HEAD, 'WP_B_M3_AUTHORIZATION_DESIGN_HEAD_INVALID', 'Approved design Head changed');
  for (const value of [document.parentMilestone2EvidenceHead, document.parentMilestone2SealHead, document.parentMilestone2ReviewedHead, document.approvedDesignHead]) {
    requireThat(FULL_SHA.test(String(value || '')), 'WP_B_M3_AUTHORIZATION_HEAD_INVALID', 'Authorization contains an invalid full SHA');
  }
  const red = document.authorizationContractRedEvidence || {};
  requireThat(red.head === EXPECTED_RED_HEAD && red.workflowName === 'WP-B M3 Authorization' && red.workflowRunId === EXPECTED_RED_RUN_ID, 'WP_B_M3_AUTHORIZATION_RED_RUN_INVALID', 'Authorization RED run changed');
  requireThat(red.ubuntuJobId === EXPECTED_RED_UBUNTU_JOB_ID && red.windowsJobId === EXPECTED_RED_WINDOWS_JOB_ID, 'WP_B_M3_AUTHORIZATION_RED_JOB_INVALID', 'Authorization RED jobs changed');
  requireThat(red.expectedConclusion === 'failure' && red.contractResult === '0_OF_6_PASS' && JSON.stringify(red.failureIds) === JSON.stringify(EXPECTED_FAILURE_IDS), 'WP_B_M3_AUTHORIZATION_RED_RESULT_INVALID', 'Authorization RED result changed');
  requireThat(JSON.stringify(document.executionStages) === JSON.stringify(EXPECTED_EXECUTION_STAGES), 'WP_B_M3_AUTHORIZATION_EXECUTION_ORDER_INVALID', 'M3 execution order changed');
  const inventory = document.inventoryAuthority || {};
  requireThat(inventory.path === INVENTORY_PATH && JSON.stringify(inventory.extensionPaths) === JSON.stringify([INVENTORY_EXTENSION_PATH]), 'WP_B_M3_AUTHORIZATION_INVENTORY_PATH_INVALID', 'Inventory paths changed');
  requireThat(inventory.anchorHead === EXPECTED_M2_EVIDENCE_HEAD && inventory.anchorBlobSha === EXPECTED_INVENTORY_ANCHOR_BLOB, 'WP_B_M3_AUTHORIZATION_INVENTORY_ANCHOR_INVALID', 'Inventory anchor changed');
  requireThat(inventory.authorizedPathCount === EXPECTED_INVENTORY_PATH_COUNT && inventory.authorizedPathSetSha256 === EXPECTED_INVENTORY_PATH_SHA256 && SHA256.test(inventory.authorizedPathSetSha256), 'WP_B_M3_AUTHORIZATION_INVENTORY_DIGEST_INVALID', 'Inventory anchor digest changed');
  requireThat(inventory.authorizationAmendmentRequiredForNewPath === true, 'WP_B_M3_AUTHORIZATION_INVENTORY_AMENDMENT_INVALID', 'New paths require amendment');
  requireThat(JSON.stringify(document.authorizationAmendments) === JSON.stringify(EXPECTED_AMENDMENTS), 'WP_B_M3_AUTHORIZATION_AMENDMENT_INVALID', 'M3 scope amendment chain changed');
  requireThat(document.authorizationAmendments[1]?.causalRedEvidence?.unknownBlockers === 0, 'WP_B_M3_AUTHORIZATION_AMENDMENT_INVALID', 'Scope-002 must bind a closed causal RED matrix');
  const normalized = (document.allowedPaths || []).map(normalizeRepositoryPath);
  requireThat(normalized.every(Boolean) && normalized.every((value, index) => value === document.allowedPaths[index]), 'WP_B_M3_AUTHORIZATION_PATH_SCOPE_INVALID', 'Allowed paths must be canonical');
  requireThat(normalized.every(value => !value.includes('*')) && new Set(normalized).size === normalized.length, 'WP_B_M3_AUTHORIZATION_PATH_SCOPE_INVALID', 'Allowed paths must be exact and unique');
  requireThat(JSON.stringify(normalized) === JSON.stringify(EXPECTED_ALLOWED_PATHS), 'WP_B_M3_AUTHORIZATION_PATH_SCOPE_INVALID', 'Allowed path set changed');
  for (const field of AUTHORIZATION_FIELDS) requireThat(document.authorization?.[field] === true, 'WP_B_M3_AUTHORIZATION_CAPABILITY_INVALID', 'Authorization capability must be true', { field });
  for (const field of NON_WAIVABLE_GATES) requireThat(document.nonWaivableGates?.[field] === true, 'WP_B_M3_AUTHORIZATION_GATE_INVALID', 'Non-waivable gate must be true', { field });
  const governance = document.governance || {};
  requireThat(governance.prMustRemainDraft === true && governance.milestone1Sealed === true && governance.milestone2Sealed === true && governance.milestone3Authorized === true, 'WP_B_M3_AUTHORIZATION_GOVERNANCE_PREREQUISITE_INVALID', 'M3 prerequisites invalid');
  for (const field of CLOSED_GOVERNANCE_FIELDS) requireThat(governance[field] === false, 'WP_B_M3_AUTHORIZATION_GOVERNANCE_OPEN', 'Downstream governance must remain closed', { field });
  return Object.freeze({ ok: true, branch: document.branch, parentMilestone2EvidenceHead: document.parentMilestone2EvidenceHead, parentMilestone2SealHead: document.parentMilestone2SealHead, parentMilestone2ReviewedHead: document.parentMilestone2ReviewedHead, approvedDesignHead: document.approvedDesignHead, allowedPaths: Object.freeze([...normalized]) });
}
function resolveAuthorizedPaths(document = readReceipt(), options = {}) {
  validateReceipt(document);
  const root = path.resolve(options.repositoryRoot || REPOSITORY_ROOT);
  const base = validateBaseInventory(readJsonObject(path.join(root, INVENTORY_PATH), 'WP_B_M3_AUTHORIZATION_INVENTORY_UNREADABLE'));
  requireThat(base.count === EXPECTED_INVENTORY_PATH_COUNT && base.sha256 === EXPECTED_INVENTORY_PATH_SHA256, 'WP_B_M3_AUTHORIZATION_INVENTORY_DIGEST_INVALID', 'Base inventory path set changed');
  const extension = validateInventoryExtension(readJsonObject(path.join(root, INVENTORY_EXTENSION_PATH), 'WP_B_M3_AUTHORIZATION_INVENTORY_EXTENSION_UNREADABLE'));
  return Object.freeze(sortedUnique([...document.allowedPaths, ...base.paths, ...extension.paths]));
}
function isAuthorizedPath(document, repositoryPath, options = {}) {
  try {
    const normalized = normalizeRepositoryPath(repositoryPath);
    return Boolean(normalized && resolveAuthorizedPaths(document, options).includes(normalized));
  } catch (_) { return false; }
}
function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
function verifyLocalRepository(document = readReceipt(), options = {}) {
  const validation = validateReceipt(document);
  const root = path.resolve(options.repositoryRoot || REPOSITORY_ROOT);
  const m2ReviewPath = path.join(root, 'tools', 'architecture-closure-v2', 'verify-wp-b-m2-review.js');
  requireThat(fs.existsSync(m2ReviewPath), 'WP_B_M3_AUTHORIZATION_M2_VERIFIER_MISSING', 'M2 verifier missing');
  delete require.cache[require.resolve(m2ReviewPath)];
  const m2Verifier = require(m2ReviewPath);
  const m2 = m2Verifier.validateReceipt(m2Verifier.readReceipt(path.join(root, 'governance', 'architecture-closure-v2', 'wp-b-m2-review.json')));
  requireThat(m2.sealStatus === 'SEALED' && m2.sealHead === EXPECTED_M2_SEAL_HEAD && m2.reviewedHead === EXPECTED_M2_REVIEWED_HEAD, 'WP_B_M3_AUTHORIZATION_M2_SEAL_INVALID', 'M2 seal prerequisite changed');
  let currentHead;
  let anchorBlob;
  let scope002Parents;
  try {
    for (const commit of [EXPECTED_M2_REVIEWED_HEAD, EXPECTED_M2_SEAL_HEAD, EXPECTED_M2_EVIDENCE_HEAD, EXPECTED_DESIGN_HEAD, EXPECTED_RED_HEAD, EXPECTED_SCOPE_002_TRUSTED_MAIN, EXPECTED_SCOPE_002_RED_HEAD]) git(root, ['cat-file', '-e', `${commit}^{commit}`]);
    currentHead = git(root, ['rev-parse', 'HEAD']);
    git(root, ['merge-base', '--is-ancestor', EXPECTED_M2_REVIEWED_HEAD, EXPECTED_M2_SEAL_HEAD]);
    git(root, ['merge-base', '--is-ancestor', EXPECTED_M2_SEAL_HEAD, EXPECTED_M2_EVIDENCE_HEAD]);
    git(root, ['merge-base', '--is-ancestor', EXPECTED_M2_EVIDENCE_HEAD, currentHead]);
    git(root, ['merge-base', '--is-ancestor', EXPECTED_DESIGN_HEAD, currentHead]);
    git(root, ['merge-base', '--is-ancestor', EXPECTED_RED_HEAD, currentHead]);
    git(root, ['merge-base', '--is-ancestor', EXPECTED_SCOPE_002_TRUSTED_MAIN, currentHead]);
    git(root, ['merge-base', '--is-ancestor', EXPECTED_SCOPE_002_RED_HEAD, currentHead]);
    scope002Parents = git(root, ['show', '-s', '--format=%P', EXPECTED_SCOPE_002_RED_HEAD]).split(/\s+/u).filter(Boolean);
    anchorBlob = git(root, ['rev-parse', `${EXPECTED_M2_EVIDENCE_HEAD}:${INVENTORY_PATH}`]);
  } catch (cause) {
    fail('WP_B_M3_AUTHORIZATION_GIT_ANCESTRY_INVALID', 'Current Head does not preserve exact authorization ancestry', { cause: cause?.message || String(cause) });
  }
  requireThat(JSON.stringify(scope002Parents) === JSON.stringify([EXPECTED_SCOPE_002_PR17_PARENT, EXPECTED_SCOPE_002_TRUSTED_MAIN]), 'WP_B_M3_AUTHORIZATION_SCOPE_002_MERGE_TOPOLOGY_INVALID', 'Scope-002 causal RED must be the exact fresh-main integration merge');
  requireThat(anchorBlob === EXPECTED_INVENTORY_ANCHOR_BLOB, 'WP_B_M3_AUTHORIZATION_INVENTORY_ANCHOR_INVALID', 'Inventory anchor blob changed');
  const authorizedPaths = resolveAuthorizedPaths(document, { repositoryRoot: root });
  requireThat(git(root, ['branch', '--show-current']) === EXPECTED_BRANCH, 'WP_B_M3_AUTHORIZATION_BRANCH_CHECKOUT_INVALID', 'Wrong branch checked out');
  const status = git(root, ['status', '--porcelain=v1', '--untracked-files=all']);
  requireThat(status === '', 'WP_B_M3_AUTHORIZATION_WORKTREE_DIRTY', 'Authorization verification requires clean worktree', { status });
  return Object.freeze({ ok: true, currentHead, parentMilestone2EvidenceHead: validation.parentMilestone2EvidenceHead, parentMilestone2SealHead: validation.parentMilestone2SealHead, parentMilestone2ReviewedHead: validation.parentMilestone2ReviewedHead, approvedDesignHead: validation.approvedDesignHead, scope002TrustedMainHead: EXPECTED_SCOPE_002_TRUSTED_MAIN, scope002CausalRedHead: EXPECTED_SCOPE_002_RED_HEAD, baseInventoryPathCount: baseCount(), authorizedPathCount: authorizedPaths.length, m2SealVerified: true });
}
function baseCount() { return EXPECTED_INVENTORY_PATH_COUNT; }
function resolveImplementationAuthority(options = {}) {
  const root = path.resolve(options.repositoryRoot || REPOSITORY_ROOT);
  try {
    const receipt = readReceipt(options.receiptPath || path.join(root, 'governance', 'architecture-closure-v2', 'wp-b-m3-authorization.json'));
    const validation = validateReceipt(receipt);
    return Object.freeze({ workPackage: 'WP-B', milestone: 3, status: receipt.status, authorizedBranch: validation.branch, parentMilestone2EvidenceHead: validation.parentMilestone2EvidenceHead, parentMilestone2SealHead: validation.parentMilestone2SealHead, parentMilestone2ReviewedHead: validation.parentMilestone2ReviewedHead, approvedDesignHead: validation.approvedDesignHead, allowedProductionPaths: resolveAuthorizedPaths(receipt, { repositoryRoot: root }), governance: Object.freeze({ ...receipt.governance }) });
  } catch (_) { return null; }
}
async function fetchJson(url, token, code) {
  let response;
  try { response = await fetch(url, { headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'User-Agent': 'yance-acv2-wp-b-m3-authorization-verifier', 'X-GitHub-Api-Version': '2022-11-28' }, signal: AbortSignal.timeout(20000) }); }
  catch (cause) { fail(code, 'GitHub API request failed', { url, cause: cause?.message || String(cause) }); }
  if (!response.ok) fail(code, 'GitHub API returned non-success', { url, status: response.status, body: (await response.text()).slice(0, 1000) });
  return response.json();
}
async function verifyRemoteEvidence(document = readReceipt(), options = {}) {
  validateReceipt(document);
  const token = String(options.token || process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '');
  const repository = String(options.repository || process.env.GITHUB_REPOSITORY || document.repository || '');
  requireThat(token && repository === EXPECTED_REPOSITORY, 'WP_B_M3_AUTHORIZATION_REMOTE_TOKEN_REQUIRED', 'Authenticated repository token required');
  const api = `https://api.github.com/repos/${repository}`;
  const red = document.authorizationContractRedEvidence;
  const run = await fetchJson(`${api}/actions/runs/${red.workflowRunId}`, token, 'WP_B_M3_AUTHORIZATION_REMOTE_RUN_REQUEST_FAILED');
  requireThat(run.name === red.workflowName && run.head_sha === red.head && run.status === 'completed' && run.conclusion === 'failure', 'WP_B_M3_AUTHORIZATION_REMOTE_RED_MISMATCH', 'Remote M3 RED run changed');
  const page = await fetchJson(`${api}/actions/runs/${red.workflowRunId}/jobs?per_page=100`, token, 'WP_B_M3_AUTHORIZATION_REMOTE_JOBS_REQUEST_FAILED');
  const jobs = new Map((page.jobs || []).map(job => [Number(job.id), job]));
  for (const [jobId, name] of [[red.ubuntuJobId, 'wp-b-m3-authorization-ubuntu-latest'], [red.windowsJobId, 'wp-b-m3-authorization-windows-latest']]) {
    const job = jobs.get(jobId);
    requireThat(job?.name === name && job.status === 'completed' && job.conclusion === 'failure', 'WP_B_M3_AUTHORIZATION_REMOTE_RED_JOB_MISMATCH', 'Remote M3 RED job changed', { jobId });
  }
  const scope002 = document.authorizationAmendments[1].causalRedEvidence;
  for (const [runId, name] of [
    [scope002.stageRunId, 'Stage 6.4.5.9 WP0 Architecture Gates'],
    [scope002.wpBValidationRunId, 'WP-B Validation'],
    [scope002.wpBM2ContractsRunId, 'WP-B M2 Contracts']
  ]) {
    const causalRun = await fetchJson(`${api}/actions/runs/${runId}`, token, 'WP_B_M3_SCOPE_002_REMOTE_RED_REQUEST_FAILED');
    requireThat(causalRun.name === name && causalRun.head_sha === EXPECTED_SCOPE_002_RED_HEAD && causalRun.status === 'completed' && causalRun.conclusion === 'failure', 'WP_B_M3_SCOPE_002_REMOTE_RED_MISMATCH', 'Scope-002 causal RED run changed', { runId, name });
  }
  const currentHead = String(options.currentHead || git(REPOSITORY_ROOT, ['rev-parse', 'HEAD']));
  const pr = await fetchJson(`${api}/pulls/${document.pullRequest}`, token, 'WP_B_M3_AUTHORIZATION_REMOTE_PR_REQUEST_FAILED');
  requireThat(pr.state === 'open' && pr.draft === true && pr.merged_at == null, 'WP_B_M3_AUTHORIZATION_REMOTE_PR_STATE_INVALID', 'PR must remain Draft/open/unmerged');
  requireThat(pr.head?.ref === document.branch && pr.head?.sha === currentHead && pr.base?.ref === 'main', 'WP_B_M3_AUTHORIZATION_REMOTE_PR_HEAD_INVALID', 'PR refs changed');
  return Object.freeze({ ok: true, credibleRedVerified: true, scope002CausalRedVerified: true, prDraftOpenUnmerged: true, currentHead });
}
async function main() {
  const receipt = readReceipt();
  const local = verifyLocalRepository(receipt);
  const remote = process.argv.includes('--remote') ? await verifyRemoteEvidence(receipt, { currentHead: local.currentHead }) : null;
  process.stdout.write(`${JSON.stringify({ status: 'PASS', local, remote }, null, 2)}\n`);
}
if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`${JSON.stringify({ status: 'FAIL', code: error?.code || 'WP_B_M3_AUTHORIZATION_UNKNOWN_FAILURE', message: error?.message || String(error), details: Object.fromEntries(Object.entries(error || {}).filter(([key]) => !['name', 'message', 'stack'].includes(key))) }, null, 2)}\n`);
    process.exitCode = 1;
  });
}
module.exports = Object.freeze({
  BASE_ALLOWED_PATHS,
  EXPECTED_ALLOWED_PATHS,
  EXPECTED_AMENDMENT,
  EXPECTED_AMENDMENTS,
  EXPECTED_SCOPE_002_AMENDMENT,
  EXPECTED_BRANCH,
  EXPECTED_EXECUTION_STAGES,
  EXPECTED_M2_EVIDENCE_HEAD,
  EXPECTED_M2_REVIEWED_HEAD,
  EXPECTED_M2_SEAL_HEAD,
  INVENTORY_EXTENSION_PATH,
  RECEIPT_PATH,
  isAuthorizedPath,
  normalizeRepositoryPath,
  pathSetSha256,
  readReceipt,
  resolveAuthorizedPaths,
  resolveImplementationAuthority,
  sortedUnique,
  validateBaseInventory,
  validateInventoryExtension,
  validateReceipt,
  verifyLocalRepository,
  verifyRemoteEvidence
});
