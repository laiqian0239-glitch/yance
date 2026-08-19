#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { isAuthorizedWpBImplementationBranch } = require('../../shared/release/acv2ActiveWorkPackageAuthority');

const REPOSITORY_ROOT = path.resolve(__dirname, '..', '..');
const RECEIPT_PATH = path.join(REPOSITORY_ROOT, 'governance', 'architecture-closure-v2', 'wp-b-m3-authorization.json');
const INVENTORY_PATH = 'governance/architecture-closure-v2/wp-b-operation-inventory.json';
const INVENTORY_EXTENSION_PATH = 'governance/architecture-closure-v2/wp-b-operation-inventory-m3-extension.json';
const EXPECTED_REPOSITORY = 'laiqian0239-glitch/yance';
const EXPECTED_BRANCH = 'acv2/wp-b-durable-execution-outbox';
const FULL_SHA = /^[a-f0-9]{40}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;

const EXPECTED = Object.freeze({
  m2EvidenceHead: '9f82377119e16f8e02d3b83f0795b452e36f769e',
  m2SealHead: '5f08a5a75aeae4d3baeb5a1d34a470f21ac0180d',
  m2ReviewedHead: '3e5d71f68afccb64d0f61a776170d815fed77747',
  designHead: '237061c6ff20c5424d26ea8dc56618db4c521c0e',
  m3RedHead: '3164b8c26f736b166d30f1a6bb368e950d8c80d4',
  m3RedRunId: 30890446016,
  m3RedUbuntuJobId: 91931025684,
  m3RedWindowsJobId: 91931025737,
  inventoryAnchorBlob: 'c564fd0c225ddc24317ac2f10c46aa0ad52db691',
  inventoryPathCount: 45,
  inventoryPathSha256: '579cc85774c1c26a433b4ed167a153df1a8a4bbabc7159a8f9925cacddfd2990',
  scope002TrustedMain: '7ab4b85f6bdbce34ea96b608a807ca120618bb87',
  scope002RedHead: '8c9edef0c2e19f56081f769d3d509d76cb797a84',
  scope002Pr17Parent: '708ce1290f3bfcaec3a3a8c6589248fde5961c47',
  scope003RedHead: '99019a999ef591049fcf45d2b108df6b0e5e676c',
  scope004RedHead: 'bcb2a96b85d0ca67765bea7f53b4c381cfeae60d',
  scope005RedHead: '2418b77009742758a03442ea00a6f987002cd5ce',
  scope006RedHead: '5813135f6386a235a85a5a580dc370bd89093422',
  scope006AuthorizationMerge: '5d1929a22666ecd694090a210963b56ac02ad4a0'
});

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

const SCOPE_001 = Object.freeze({
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

const SCOPE_002 = Object.freeze({
  amendmentId: 'WP-B-M3-SCOPE-002',
  authorizedAt: '2026-08-17T00:14:00+07:00',
  approvedBy: 'PROJECT_OWNER',
  approvalSource: 'Project owner explicit WP-B-M3-SCOPE-002 authorization in the 独立软件工程审计 conversation',
  reasonCode: 'WP_B_M3_FRESH_MAIN_OPERATION_AND_BINDING_CLOSURE',
  trustedMainHead: EXPECTED.scope002TrustedMain,
  causalRedEvidence: Object.freeze({
    head: EXPECTED.scope002RedHead,
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

const SCOPE_003 = Object.freeze({
  amendmentId: 'WP-B-M3-SCOPE-003',
  authorizedAt: '2026-08-17T01:44:00+07:00',
  approvedBy: 'PROJECT_OWNER',
  approvalSource: 'Project owner explicit WP-B-M3-SCOPE-003 authorization in the 独立软件工程审计 conversation',
  reasonCode: 'WP_B_M3_LEGACY_FACADE_AND_OSS_POLICY_SOURCE_CLOSURE',
  causalRedEvidence: Object.freeze({
    head: EXPECTED.scope003RedHead,
    stageRunId: 31965010070,
    wpBValidationRunId: 31965010021,
    wpBM2ContractsRunId: 31965010115,
    unknownBlockers: 0
  }),
  addedPaths: Object.freeze([
    'shared/release/implementationBranchPolicy.js',
    'shared/release/implementationBranchPolicyLegacy.js',
    'backend/services/accountLifecycleSagaService.js',
    'backend/services/aiTaskRuntimeRegistry.js',
    'backend/services/messageTranslationService.js',
    'backend/services/platformAuthWorkflowAuthority.js',
    'backend/services/systemCenterService.js',
    'backend/repositories/messageRepository.js',
    'backend/services/aiBrainOrchestrator.js',
    'backend/services/avatarService.js',
    'backend/services/runtimeSafetySupervisor.js'
  ])
});

const SCOPE_004 = Object.freeze({
  amendmentId: 'WP-B-M3-SCOPE-004',
  authorizedAt: '2026-08-17T11:55:00+07:00',
  approvedBy: 'PROJECT_OWNER',
  approvalSource: 'Project owner full continuous-execution authorization in the 独立软件工程审计 conversation; exact-head source-closure RED requires the listed physical legacy owners/importers to be removed rather than bypassed',
  reasonCode: 'WP_B_M3_CAUSAL_LEGACY_OWNER_AND_COMPOSITION_CLOSURE',
  causalRedEvidence: Object.freeze({
    head: EXPECTED.scope004RedHead,
    wpBValidationRunId: 31995895141,
    ubuntuArtifactId: 9276807628,
    windowsArtifactId: 9276821982,
    m3SourceClosureDiagnostic: 'M3-SC-DIAG-005_AND_M3-SC-DIAG-007',
    unknownBlockers: 0
  }),
  addedPaths: Object.freeze([
    'backend/runtime/AppRuntimeComposition.js',
    'backend/services/aiGateway.js',
    'backend/services/asyncOperationLifecycleAuthority.js',
    'backend/services/asyncOperationLifecycleAuthorityCore.js',
    'backend/services/backgroundJobAuthority.js',
    'backend/services/backgroundJobAuthorityCore.js',
    'backend/services/jobQueue.js',
    'backend/services/jobQueueCore.js',
    'backend/services/platformAdapterPorts.js',
    'backend/services/telegramAdapter.js',
    'backend/services/whatsappHistoryMediaRecovery.js'
  ])
});

const SCOPE_005 = Object.freeze({
  amendmentId: 'WP-B-M3-SCOPE-005',
  authorizedAt: '2026-08-17T17:32:52+07:00',
  approvedBy: 'PROJECT_OWNER',
  approvalSource: 'Project owner full continuous-execution authorization in the 独立软件工程审计 conversation; exact-head M3-SC-DIAG-014 causal RED requires the registered account manager Core to preserve persisted operation identity through the existing driver chain rather than bypass it',
  reasonCode: 'WP_B_M3_SESSION_SYNC_PHYSICAL_IDENTITY_PROPAGATION',
  causalRedEvidence: Object.freeze({
    head: EXPECTED.scope005RedHead,
    wpBValidationRunId: 32020504382,
    ubuntuArtifactId: 9285191065,
    windowsArtifactId: 9285194089,
    m3SourceClosureDiagnostic: 'M3-SC-DIAG-014',
    unknownBlockers: 0
  }),
  addedPaths: Object.freeze([
    'backend/services/accountManagerCore.js'
  ])
});

const SCOPE_006 = Object.freeze({
  amendmentId: 'WP-B-M3-SCOPE-006',
  authorizedAt: '2026-08-19T16:14:48+07:00',
  approvedBy: 'PROJECT_OWNER',
  approvalSource: 'Project owner full continuous-execution authorization in the 独立软件工程审计 conversation; Amendment-2 authorization merge 5d1929a22666ecd694090a210963b56ac02ad4a0 authorizes the exact Facebook Personal mautrix/meta physical-I/O closure path',
  reasonCode: 'WP_B_M3_FACEBOOK_PERSONAL_MAUTRIX_META_PHYSICAL_IO_CLOSURE',
  causalRedEvidence: Object.freeze({
    head: EXPECTED.scope006RedHead,
    wpBValidationRunId: 32233168698,
    governanceUbuntuJobId: 96007235653,
    operationInventoryDiagnostic: 'NETWORK_CLIENT_CALL_PLATFORM_OR_PROVIDER_CALL_OPERATIONAL_RETRY_OR_TIMER',
    amendment2AuthorizationMerge: EXPECTED.scope006AuthorizationMerge,
    unknownBlockers: 0
  }),
  addedPaths: Object.freeze([
    'backend/services/facebookPersonalMessengerMautrixAdapter.js'
  ])
});

const EXPECTED_AMENDMENTS = Object.freeze([SCOPE_001, SCOPE_002, SCOPE_003, SCOPE_004, SCOPE_005, SCOPE_006]);
const EXPECTED_ALLOWED_PATHS = Object.freeze(
  [...new Set([...BASE_ALLOWED_PATHS, ...EXPECTED_AMENDMENTS.flatMap(value => value.addedPaths)])].sort()
);
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
const EXTENSION_STATES = new Set(['OPEN', 'DELEGATES_TO_WP_B_AUTHORITY', 'READ_ONLY_PROJECTION', 'DELETED']);

function fail(code, message, details = {}) {
  throw Object.assign(new Error(message), { code, ...details });
}
function requireThat(value, code, message, details = {}) {
  if (!value) fail(code, message, details);
}
function normalizeRepositoryPath(value) {
  const normalized = String(value || '').trim().replace(/\\/gu, '/').replace(/^\.\//u, '').replace(/\/$/u, '');
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:\//u.test(normalized)) return '';
  if (normalized.split('/').some(segment => !segment || segment === '.' || segment === '..')) return '';
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
  requireThat(inventory?.schemaVersion === 2
    && inventory.documentType === 'YANCE_ACV2_WP_B_OPERATION_INVENTORY'
    && inventory.workPackage === 'WP-B', 'WP_B_M3_AUTHORIZATION_INVENTORY_SCHEMA_INVALID', 'Inventory identity changed');
  const paths = (inventory.entries || []).map(entry => normalizeRepositoryPath(entry?.path));
  requireThat(paths.length === EXPECTED.inventoryPathCount
    && paths.every(Boolean)
    && paths.every((value, index) => value === inventory.entries[index].path)
    && new Set(paths).size === paths.length
    && paths.every(value => !value.includes('*')),
  'WP_B_M3_AUTHORIZATION_INVENTORY_PATH_INVALID', 'Inventory path set is invalid');
  const sha256 = pathSetSha256(paths);
  requireThat(sha256 === EXPECTED.inventoryPathSha256, 'WP_B_M3_AUTHORIZATION_INVENTORY_DIGEST_INVALID', 'Inventory digest changed');
  return Object.freeze({ paths: Object.freeze([...paths].sort()), count: paths.length, sha256 });
}
function validateInventoryExtension(extension) {
  requireThat(extension?.schemaVersion === 1
    && extension.documentType === 'YANCE_ACV2_WP_B_OPERATION_INVENTORY_EXTENSION'
    && extension.workPackage === 'WP-B'
    && extension.milestone === 3, 'WP_B_M3_AUTHORIZATION_INVENTORY_EXTENSION_SCHEMA_INVALID', 'Inventory extension identity changed');
  requireThat(extension.authorizationAmendmentId === SCOPE_001.amendmentId
    && JSON.stringify(extension.authorizationAmendmentIds) === JSON.stringify(EXPECTED_AMENDMENTS.map(value => value.amendmentId)),
  'WP_B_M3_AUTHORIZATION_INVENTORY_EXTENSION_AMENDMENT_INVALID', 'Inventory extension amendment chain changed');
  requireThat(Array.isArray(extension.entries) && extension.entries.length === 3,
    'WP_B_M3_AUTHORIZATION_INVENTORY_EXTENSION_ENTRIES_INVALID', 'Inventory extension must contain exactly three operation entries');
  const [internal, facebook, facebookPersonal] = extension.entries;
  requireThat(internal?.id === 'WPB-DURABLE-INTERNAL-OPERATION-AUTHORITY'
    && internal.path === 'backend/services/durableInternalOperationAuthority.js'
    && internal.authorizationAmendmentId === SCOPE_001.amendmentId
    && internal.classification === 'RUNTIME_COMPOSITION'
    && EXTENSION_STATES.has(internal.closureState)
    && internal.targetAuthority === 'DurableExecutionAuthorityV2'
    && Array.isArray(internal.operationKinds) && internal.operationKinds.length === 6,
  'WP_B_M3_AUTHORIZATION_INVENTORY_EXTENSION_ENTRY_INVALID', 'Internal authority extension entry changed');
  requireThat(facebook?.id === 'WPB-FACEBOOK-CHATWOOT-MATRIX-BRIDGE'
    && facebook.path === 'backend/services/facebookChatwootMatrixBridge.js'
    && facebook.authorizationAmendmentId === SCOPE_002.amendmentId
    && facebook.classification === 'PHYSICAL_IO_ADAPTER'
    && EXTENSION_STATES.has(facebook.closureState)
    && facebook.targetAuthority === 'CHANNEL_OPERATION_ADAPTER',
  'WP_B_M3_AUTHORIZATION_INVENTORY_EXTENSION_ENTRY_INVALID', 'Facebook bridge extension entry changed');
  requireThat(facebookPersonal?.id === 'WPB-FACEBOOK-PERSONAL-MAUTRIX-META-ADAPTER'
    && facebookPersonal.path === 'backend/services/facebookPersonalMessengerMautrixAdapter.js'
    && facebookPersonal.authorizationAmendmentId === SCOPE_006.amendmentId
    && facebookPersonal.classification === 'PHYSICAL_IO_ADAPTER'
    && EXTENSION_STATES.has(facebookPersonal.closureState)
    && facebookPersonal.targetAuthority === 'CHANNEL_OPERATION_ADAPTER'
    && JSON.stringify(facebookPersonal.operationKinds) === JSON.stringify([
      'OUTBOUND_MESSAGE_SEND',
      'DELIVERY_RECEIPT_RECONCILIATION',
      'MEDIA_TRANSFER',
      'HISTORY_SYNCHRONIZATION',
      'SESSION_RESTORE'
    ]),
  'WP_B_M3_AUTHORIZATION_INVENTORY_EXTENSION_ENTRY_INVALID', 'Facebook Personal mautrix/meta adapter extension entry changed');
  return Object.freeze({
    paths: Object.freeze([internal.path, facebook.path, facebookPersonal.path]),
    entries: Object.freeze(extension.entries)
  });
}
function validateReceipt(document) {
  requireThat(document?.schemaVersion === 1
    && document.documentType === 'YANCE_ACV2_WP_B_M3_AUTHORIZATION'
    && document.program === 'Architecture Closure V2'
    && document.repository === EXPECTED_REPOSITORY
    && document.workPackage === 'WP-B'
    && document.milestone === 3, 'WP_B_M3_AUTHORIZATION_SCHEMA_INVALID', 'Authorization identity changed');
  requireThat(document.status === 'AUTHORIZED_FOR_SOURCE_CLOSURE_AND_FINAL_GATES'
    && document.approvedBy === 'PROJECT_OWNER'
    && document.approvalSource === 'Explicit full authorization in the 独立软件工程审计 conversation'
    && document.authorizedAt === '2026-08-04T14:56:00+07:00'
    && document.pullRequest === 17
    && document.branch === EXPECTED_BRANCH, 'WP_B_M3_AUTHORIZATION_PR_INVALID', 'Authorization owner/PR/branch changed');

  const heads = [
    ['parentMilestone2EvidenceHead', EXPECTED.m2EvidenceHead],
    ['parentMilestone2SealHead', EXPECTED.m2SealHead],
    ['parentMilestone2ReviewedHead', EXPECTED.m2ReviewedHead],
    ['approvedDesignHead', EXPECTED.designHead]
  ];
  for (const [field, expected] of heads) {
    requireThat(document[field] === expected && FULL_SHA.test(document[field]),
      'WP_B_M3_AUTHORIZATION_HEAD_INVALID', `${field} changed`, { field });
  }
  const red = document.authorizationContractRedEvidence || {};
  requireThat(red.head === EXPECTED.m3RedHead
    && red.workflowName === 'WP-B M3 Authorization'
    && red.workflowRunId === EXPECTED.m3RedRunId
    && red.ubuntuJobId === EXPECTED.m3RedUbuntuJobId
    && red.windowsJobId === EXPECTED.m3RedWindowsJobId
    && red.expectedConclusion === 'failure'
    && red.contractResult === '0_OF_6_PASS'
    && JSON.stringify(red.failureIds) === JSON.stringify(EXPECTED_FAILURE_IDS),
  'WP_B_M3_AUTHORIZATION_RED_RESULT_INVALID', 'Original M3 RED evidence changed');
  requireThat(JSON.stringify(document.executionStages) === JSON.stringify(EXPECTED_EXECUTION_STAGES),
    'WP_B_M3_AUTHORIZATION_EXECUTION_ORDER_INVALID', 'M3 execution order changed');

  const inventory = document.inventoryAuthority || {};
  requireThat(inventory.path === INVENTORY_PATH
    && JSON.stringify(inventory.extensionPaths) === JSON.stringify([INVENTORY_EXTENSION_PATH])
    && inventory.anchorHead === EXPECTED.m2EvidenceHead
    && inventory.anchorBlobSha === EXPECTED.inventoryAnchorBlob
    && inventory.authorizedPathCount === EXPECTED.inventoryPathCount
    && inventory.authorizedPathSetSha256 === EXPECTED.inventoryPathSha256
    && SHA256.test(inventory.authorizedPathSetSha256)
    && inventory.authorizationAmendmentRequiredForNewPath === true,
  'WP_B_M3_AUTHORIZATION_INVENTORY_DIGEST_INVALID', 'Inventory authority changed');

  requireThat(JSON.stringify(document.authorizationAmendments) === JSON.stringify(EXPECTED_AMENDMENTS),
    'WP_B_M3_AUTHORIZATION_AMENDMENT_INVALID', 'M3 scope amendment chain changed');
  requireThat(document.authorizationAmendments.slice(1).every(amendment => amendment.causalRedEvidence?.unknownBlockers === 0),
  'WP_B_M3_AUTHORIZATION_AMENDMENT_INVALID', 'Scope amendment causal RED matrix is not closed');

  const normalized = (document.allowedPaths || []).map(normalizeRepositoryPath);
  requireThat(normalized.length === document.allowedPaths?.length
    && normalized.every(Boolean)
    && normalized.every((value, index) => value === document.allowedPaths[index])
    && normalized.every(value => !value.includes('*'))
    && new Set(normalized).size === normalized.length
    && JSON.stringify(normalized) === JSON.stringify(EXPECTED_ALLOWED_PATHS),
  'WP_B_M3_AUTHORIZATION_PATH_SCOPE_INVALID', 'Allowed path set changed or is non-exact');

  for (const field of AUTHORIZATION_FIELDS) {
    requireThat(document.authorization?.[field] === true, 'WP_B_M3_AUTHORIZATION_CAPABILITY_INVALID', 'Authorization capability must stay true', { field });
  }
  const governance = document.governance || {};
  requireThat(governance.prMustRemainDraft === true
    && governance.milestone1Sealed === true
    && governance.milestone2Sealed === true
    && governance.milestone3Authorized === true,
  'WP_B_M3_AUTHORIZATION_GOVERNANCE_PREREQUISITE_INVALID', 'M3 prerequisites changed');
  for (const field of NON_WAIVABLE_GATES) {
    requireThat(document.nonWaivableGates?.[field] === true, 'WP_B_M3_AUTHORIZATION_GATE_INVALID', 'Non-waivable gate changed', { field });
  }
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
  const root = path.resolve(options.repositoryRoot || REPOSITORY_ROOT);
  const base = validateBaseInventory(readJsonObject(path.join(root, INVENTORY_PATH), 'WP_B_M3_AUTHORIZATION_INVENTORY_UNREADABLE'));
  const extension = validateInventoryExtension(readJsonObject(path.join(root, INVENTORY_EXTENSION_PATH), 'WP_B_M3_AUTHORIZATION_INVENTORY_EXTENSION_UNREADABLE'));
  return Object.freeze(sortedUnique([...document.allowedPaths, ...base.paths, ...extension.paths]));
}
function isAuthorizedPath(document, repositoryPath, options = {}) {
  try {
    const normalized = normalizeRepositoryPath(repositoryPath);
    return Boolean(normalized && resolveAuthorizedPaths(document, options).includes(normalized));
  } catch (_) {
    return false;
  }
}
function git(root, args) {
  return execFileSync('git', args, {
    cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' },
    timeout: 15000, maxBuffer: 4 * 1024 * 1024, windowsHide: true
  }).trim();
}
function verifyLocalRepository(document = readReceipt(), options = {}) {
  const validation = validateReceipt(document);
  const root = path.resolve(options.repositoryRoot || REPOSITORY_ROOT);
  const m2VerifierPath = path.join(root, 'tools', 'architecture-closure-v2', 'verify-wp-b-m2-review.js');
  delete require.cache[require.resolve(m2VerifierPath)];
  const m2Verifier = require(m2VerifierPath);
  const m2 = m2Verifier.validateReceipt(m2Verifier.readReceipt(path.join(root, 'governance', 'architecture-closure-v2', 'wp-b-m2-review.json')));
  requireThat(m2.sealStatus === 'SEALED'
    && m2.sealHead === EXPECTED.m2SealHead
    && m2.reviewedHead === EXPECTED.m2ReviewedHead,
  'WP_B_M3_AUTHORIZATION_M2_SEAL_INVALID', 'M2 seal prerequisite changed');

  const currentHead = git(root, ['rev-parse', 'HEAD']);
  for (const commit of [
    EXPECTED.m2ReviewedHead, EXPECTED.m2SealHead, EXPECTED.m2EvidenceHead, EXPECTED.designHead,
    EXPECTED.m3RedHead, EXPECTED.scope002TrustedMain, EXPECTED.scope002RedHead, EXPECTED.scope003RedHead,
    EXPECTED.scope004RedHead, EXPECTED.scope005RedHead, EXPECTED.scope006RedHead, EXPECTED.scope006AuthorizationMerge
  ]) {
    git(root, ['cat-file', '-e', `${commit}^{commit}`]);
  }
  for (const ancestor of [
    EXPECTED.m2EvidenceHead, EXPECTED.designHead, EXPECTED.m3RedHead,
    EXPECTED.scope002TrustedMain, EXPECTED.scope002RedHead, EXPECTED.scope003RedHead,
    EXPECTED.scope004RedHead, EXPECTED.scope005RedHead, EXPECTED.scope006RedHead, EXPECTED.scope006AuthorizationMerge
  ]) {
    git(root, ['merge-base', '--is-ancestor', ancestor, currentHead]);
  }
  const scope002Parents = git(root, ['show', '-s', '--format=%P', EXPECTED.scope002RedHead]).split(/\s+/u).filter(Boolean);
  requireThat(JSON.stringify(scope002Parents) === JSON.stringify([EXPECTED.scope002Pr17Parent, EXPECTED.scope002TrustedMain]),
    'WP_B_M3_AUTHORIZATION_SCOPE_002_MERGE_TOPOLOGY_INVALID', 'Scope-002 causal RED topology changed');
  requireThat(git(root, ['rev-parse', `${EXPECTED.m2EvidenceHead}:${INVENTORY_PATH}`]) === EXPECTED.inventoryAnchorBlob,
    'WP_B_M3_AUTHORIZATION_INVENTORY_ANCHOR_INVALID', 'Inventory anchor blob changed');
  const currentBranch = git(root, ['branch', '--show-current']);
  requireThat(isAuthorizedWpBImplementationBranch(currentBranch, undefined, { repositoryRoot: root }),
    'WP_B_M3_AUTHORIZATION_BRANCH_CHECKOUT_INVALID', 'Wrong or unauthorized branch checked out');
  requireThat(git(root, ['status', '--porcelain=v1', '--untracked-files=all']) === '',
    'WP_B_M3_AUTHORIZATION_WORKTREE_DIRTY', 'Authorization verification requires clean worktree');
  const authorizedPaths = resolveAuthorizedPaths(document, { repositoryRoot: root });
  return Object.freeze({
    ok: true, currentHead, currentBranch,
    parentMilestone2EvidenceHead: validation.parentMilestone2EvidenceHead,
    parentMilestone2SealHead: validation.parentMilestone2SealHead,
    parentMilestone2ReviewedHead: validation.parentMilestone2ReviewedHead,
    approvedDesignHead: validation.approvedDesignHead,
    scope002TrustedMainHead: EXPECTED.scope002TrustedMain,
    scope002CausalRedHead: EXPECTED.scope002RedHead,
    scope003CausalRedHead: EXPECTED.scope003RedHead,
    scope004CausalRedHead: EXPECTED.scope004RedHead,
    scope005CausalRedHead: EXPECTED.scope005RedHead,
    scope006CausalRedHead: EXPECTED.scope006RedHead,
    scope006AuthorizationMerge: EXPECTED.scope006AuthorizationMerge,
    authorizedPathCount: authorizedPaths.length,
    m2SealVerified: true
  });
}
function resolveImplementationAuthority(options = {}) {
  const root = path.resolve(options.repositoryRoot || REPOSITORY_ROOT);
  try {
    const receipt = readReceipt(options.receiptPath || path.join(root, 'governance', 'architecture-closure-v2', 'wp-b-m3-authorization.json'));
    const validation = validateReceipt(receipt);
    return Object.freeze({
      workPackage: 'WP-B',
      milestone: 3,
      status: receipt.status,
      authorizedBranch: validation.branch,
      parentMilestone2EvidenceHead: validation.parentMilestone2EvidenceHead,
      parentMilestone2SealHead: validation.parentMilestone2SealHead,
      parentMilestone2ReviewedHead: validation.parentMilestone2ReviewedHead,
      approvedDesignHead: validation.approvedDesignHead,
      allowedProductionPaths: resolveAuthorizedPaths(receipt, { repositoryRoot: root }),
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
  if (!response.ok) fail(code, 'GitHub API returned non-success', { url, status: response.status });
  return response.json();
}
async function verifyRun(api, token, runId, name, head, conclusion, code) {
  const run = await fetchJson(`${api}/actions/runs/${runId}`, token, code);
  requireThat(run.name === name && run.head_sha === head && run.status === 'completed' && run.conclusion === conclusion,
    code, 'Remote workflow evidence changed', { runId, name, expectedConclusion: conclusion });
  return run;
}
async function verifyRemoteEvidence(document = readReceipt(), options = {}) {
  validateReceipt(document);
  const token = String(options.token || process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '');
  const repository = String(options.repository || process.env.GITHUB_REPOSITORY || document.repository || '');
  requireThat(token && repository === EXPECTED_REPOSITORY,
    'WP_B_M3_AUTHORIZATION_REMOTE_TOKEN_REQUIRED', 'Authenticated repository token required');
  const api = `https://api.github.com/repos/${repository}`;

  await verifyRun(api, token, EXPECTED.m3RedRunId, 'WP-B M3 Authorization', EXPECTED.m3RedHead, 'failure',
    'WP_B_M3_AUTHORIZATION_REMOTE_RED_MISMATCH');
  const originalJobs = await fetchJson(`${api}/actions/runs/${EXPECTED.m3RedRunId}/jobs?per_page=100`, token,
    'WP_B_M3_AUTHORIZATION_REMOTE_JOBS_REQUEST_FAILED');
  const jobs = new Map((originalJobs.jobs || []).map(job => [Number(job.id), job]));
  for (const [jobId, name] of [
    [EXPECTED.m3RedUbuntuJobId, 'wp-b-m3-authorization-ubuntu-latest'],
    [EXPECTED.m3RedWindowsJobId, 'wp-b-m3-authorization-windows-latest']
  ]) {
    const job = jobs.get(jobId);
    requireThat(job?.name === name && job.status === 'completed' && job.conclusion === 'failure',
      'WP_B_M3_AUTHORIZATION_REMOTE_RED_JOB_MISMATCH', 'Original M3 RED job changed', { jobId });
  }

  await verifyRun(api, token, SCOPE_002.causalRedEvidence.stageRunId,
    'Stage 6.4.5.9 WP0 Architecture Gates', SCOPE_002.causalRedEvidence.head, 'failure',
    'WP_B_M3_SCOPE_002_REMOTE_RED_MISMATCH');
  await verifyRun(api, token, SCOPE_002.causalRedEvidence.wpBValidationRunId,
    'WP-B Validation', SCOPE_002.causalRedEvidence.head, 'failure',
    'WP_B_M3_SCOPE_002_REMOTE_RED_MISMATCH');
  await verifyRun(api, token, SCOPE_002.causalRedEvidence.wpBM2ContractsRunId,
    'WP-B M2 Contracts', SCOPE_002.causalRedEvidence.head, 'failure',
    'WP_B_M3_SCOPE_002_REMOTE_RED_MISMATCH');

  await verifyRun(api, token, SCOPE_003.causalRedEvidence.stageRunId,
    'Stage 6.4.5.9 WP0 Architecture Gates', SCOPE_003.causalRedEvidence.head, 'failure',
    'WP_B_M3_SCOPE_003_REMOTE_RED_MISMATCH');
  await verifyRun(api, token, SCOPE_003.causalRedEvidence.wpBValidationRunId,
    'WP-B Validation', SCOPE_003.causalRedEvidence.head, 'failure',
    'WP_B_M3_SCOPE_003_REMOTE_RED_MISMATCH');
  await verifyRun(api, token, SCOPE_003.causalRedEvidence.wpBM2ContractsRunId,
    'WP-B M2 Contracts', SCOPE_003.causalRedEvidence.head, 'success',
    'WP_B_M3_SCOPE_003_REMOTE_M2_GREEN_MISMATCH');

  await verifyRun(api, token, SCOPE_004.causalRedEvidence.wpBValidationRunId,
    'WP-B Validation', SCOPE_004.causalRedEvidence.head, 'failure',
    'WP_B_M3_SCOPE_004_REMOTE_RED_MISMATCH');
  const scope004Artifacts = await fetchJson(
    `${api}/actions/runs/${SCOPE_004.causalRedEvidence.wpBValidationRunId}/artifacts?per_page=100`,
    token,
    'WP_B_M3_SCOPE_004_REMOTE_ARTIFACTS_REQUEST_FAILED'
  );
  const scope004ArtifactIds = new Set((scope004Artifacts.artifacts || []).map(artifact => Number(artifact.id)));
  requireThat(scope004ArtifactIds.has(SCOPE_004.causalRedEvidence.ubuntuArtifactId)
    && scope004ArtifactIds.has(SCOPE_004.causalRedEvidence.windowsArtifactId),
  'WP_B_M3_SCOPE_004_REMOTE_ARTIFACT_MISMATCH', 'Scope-004 source-closure diagnostic artifacts changed');

  await verifyRun(api, token, SCOPE_005.causalRedEvidence.wpBValidationRunId,
    'WP-B Validation', SCOPE_005.causalRedEvidence.head, 'failure',
    'WP_B_M3_SCOPE_005_REMOTE_RED_MISMATCH');
  const scope005Artifacts = await fetchJson(
    `${api}/actions/runs/${SCOPE_005.causalRedEvidence.wpBValidationRunId}/artifacts?per_page=100`,
    token,
    'WP_B_M3_SCOPE_005_REMOTE_ARTIFACTS_REQUEST_FAILED'
  );
  const scope005ArtifactIds = new Set((scope005Artifacts.artifacts || []).map(artifact => Number(artifact.id)));
  requireThat(scope005ArtifactIds.has(SCOPE_005.causalRedEvidence.ubuntuArtifactId)
    && scope005ArtifactIds.has(SCOPE_005.causalRedEvidence.windowsArtifactId),
  'WP_B_M3_SCOPE_005_REMOTE_ARTIFACT_MISMATCH', 'Scope-005 M3-SC-DIAG-014 artifacts changed');

  await verifyRun(api, token, SCOPE_006.causalRedEvidence.wpBValidationRunId,
    'WP-B Validation', SCOPE_006.causalRedEvidence.head, 'failure',
    'WP_B_M3_SCOPE_006_REMOTE_RED_MISMATCH');

  const currentHead = String(options.currentHead || git(REPOSITORY_ROOT, ['rev-parse', 'HEAD']));
  const currentBranch = String(options.currentBranch || git(REPOSITORY_ROOT, ['branch', '--show-current']));
  requireThat(isAuthorizedWpBImplementationBranch(currentBranch, undefined, { repositoryRoot: REPOSITORY_ROOT }),
    'WP_B_M3_AUTHORIZATION_REMOTE_BRANCH_INVALID', 'Current branch is not an authorized WP-B implementation branch');

  const historicalPr = await fetchJson(`${api}/pulls/${document.pullRequest}`, token, 'WP_B_M3_AUTHORIZATION_REMOTE_PR_REQUEST_FAILED');
  requireThat(historicalPr.state === 'open' && historicalPr.draft === true && historicalPr.merged_at == null,
    'WP_B_M3_AUTHORIZATION_REMOTE_PR_STATE_INVALID', 'Historical PR must remain Draft/open/unmerged');
  requireThat(historicalPr.head?.ref === document.branch && historicalPr.base?.ref === 'main',
    'WP_B_M3_AUTHORIZATION_REMOTE_PR_HEAD_INVALID', 'Historical PR refs changed');

  if (currentBranch === EXPECTED_BRANCH) {
    requireThat(historicalPr.head?.sha === currentHead,
      'WP_B_M3_AUTHORIZATION_REMOTE_PR_HEAD_INVALID', 'Historical PR Head changed');
  } else {
    const owner = repository.split('/')[0];
    const candidatePrs = await fetchJson(
      `${api}/pulls?state=open&base=main&head=${encodeURIComponent(`${owner}:${currentBranch}`)}&per_page=10`,
      token,
      'WP_B_M3_AUTHORIZATION_REMOTE_SUCCESSOR_PR_REQUEST_FAILED'
    );
    const matches = Array.isArray(candidatePrs)
      ? candidatePrs.filter(candidate => candidate?.head?.ref === currentBranch && candidate?.base?.ref === 'main')
      : [];
    requireThat(matches.length === 1
      && matches[0].draft === true
      && matches[0].merged_at == null
      && matches[0].head?.sha === currentHead,
    'WP_B_M3_AUTHORIZATION_REMOTE_SUCCESSOR_PR_INVALID', 'Successor PR must be exact Draft/open/unmerged Head',
    { currentBranch, currentHead, matches: matches.map(candidate => ({ number: candidate.number, head: candidate.head?.sha, draft: candidate.draft })) });
  }
  return Object.freeze({
    ok: true,
    credibleRedVerified: true,
    scope002CausalRedVerified: true,
    scope003CausalRedVerified: true,
    scope003M2PreservationVerified: true,
    scope004CausalRedVerified: true,
    scope004DiagnosticArtifactsVerified: true,
    scope005CausalRedVerified: true,
    scope005DiagnosticArtifactsVerified: true,
    prDraftOpenUnmerged: true,
    currentHead,
    currentBranch
  });
}
async function main() {
  const document = readReceipt();
  const local = verifyLocalRepository(document);
  const result = process.argv.includes('--remote')
    ? { local, remote: await verifyRemoteEvidence(document, { currentHead: local.currentHead, currentBranch: local.currentBranch }) }
    : { local };
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`${error?.code || 'WP_B_M3_AUTHORIZATION_FAILED'}: ${error?.message || String(error)}\n`);
    process.exitCode = 1;
  });
}
module.exports = Object.freeze({
  BASE_ALLOWED_PATHS,
  EXPECTED_ALLOWED_PATHS,
  EXPECTED_AMENDMENTS,
  INVENTORY_EXTENSION_PATH,
  INVENTORY_PATH,
  SCOPE_001,
  SCOPE_002,
  SCOPE_003,
  SCOPE_004,
  SCOPE_005,
  isAuthorizedPath,
  normalizeRepositoryPath,
  pathSetSha256,
  readReceipt,
  resolveAuthorizedPaths,
  resolveImplementationAuthority,
  validateBaseInventory,
  validateInventoryExtension,
  validateReceipt,
  verifyLocalRepository,
  verifyRemoteEvidence
});