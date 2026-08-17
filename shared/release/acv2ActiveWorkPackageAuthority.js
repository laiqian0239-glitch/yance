'use strict';

const fs = require('node:fs');
const path = require('node:path');
const engine = require('./acv2ActiveWorkPackageAuthorityEngine');
const implementationBranchPolicyLegacy = require('./implementationBranchPolicyLegacy');

const AUTHORITY_DOCUMENT_PATHS = Object.freeze({
  design: 'governance/architecture-closure-v2/wp-b-design-authorization.json',
  baseline: 'governance/architecture-closure-v2/wp-b-baseline.json',
  inventory: 'governance/architecture-closure-v2/wp-b-operation-inventory.json',
  milestone2: 'governance/architecture-closure-v2/wp-b-m2-authorization.json',
  milestone3: 'governance/architecture-closure-v2/wp-b-m3-authorization.json'
});
const GOVERNANCE_INVARIANTS = Object.freeze({
  temporaryBypassAllowed: false,
  formalRelease: false,
  publish: false
});
const INTERNAL_ENGINE_PATHS = Object.freeze([
  'backend/lib/r32SqliteStoreEngineLegacy.js',
  'backend/migrations/architectureClosureV2WpBEngine.js',
  'shared/release/acv2ActiveWorkPackageAuthorityEngine.js'
]);
const APPLICATION_EVIDENCE_PATHS = Object.freeze([
  'release/architecture-closure-v2/wp-b-governance-package.json'
]);
const PERMANENT_REVIEW_WORKFLOW_PATHS = Object.freeze([
  '.github/workflows/wp-b-m1-independent-review-integrity.yml'
]);
const MILESTONE_TWO_WORKFLOW_PATHS = Object.freeze([
  '.github/workflows/wp-b-m2-authorization.yml',
  '.github/workflows/wp-b-m2-red.yml',
  '.github/workflows/wp-b-m2-independent-review-integrity.yml'
]);
const MILESTONE_THREE_WORKFLOW_PATHS = Object.freeze([
  '.github/workflows/wp-b-m3-authorization.yml',
  '.github/workflows/wp-b-post-merge-validation.yml'
]);
const ADDITIONAL_WP_B_AUTHORITY_PATHS = Object.freeze([
  ...INTERNAL_ENGINE_PATHS,
  ...APPLICATION_EVIDENCE_PATHS
]);
const WP_B_CORE_SCOPE_PATTERNS = Object.freeze([
  ...engine.WP_B_CORE_SCOPE_PATTERNS,
  ...ADDITIONAL_WP_B_AUTHORITY_PATHS,
  ...PERMANENT_REVIEW_WORKFLOW_PATHS,
  ...MILESTONE_TWO_WORKFLOW_PATHS,
  ...MILESTONE_THREE_WORKFLOW_PATHS
]);
const FULL_SHA = /^[a-f0-9]{40}$/u;
const EXPECTED_BRANCH = 'acv2/wp-b-durable-execution-outbox';
const WP_B_M3_SUCCESSOR_AUTHORIZATION_PATH = 'governance/layered-ci/acv2-wp-b-m3-source-closure-successor-authorization.json';
const EXPECTED_M1_SEAL_HEAD = '1e3d600f0647af35e737ff92a200c67e69224c82';
const EXPECTED_M2_EVIDENCE_HEAD = '9f82377119e16f8e02d3b83f0795b452e36f769e';
const EXPECTED_M2_SEAL_HEAD = '5f08a5a75aeae4d3baeb5a1d34a470f21ac0180d';
const EXPECTED_M2_REVIEWED_HEAD = '3e5d71f68afccb64d0f61a776170d815fed77747';
const EXPECTED_DESIGN_HEAD = '237061c6ff20c5424d26ea8dc56618db4c521c0e';
const EXPECTED_OPERATION_KINDS = Object.freeze([
  'AI_PROVIDER_EXECUTION',
  'OUTBOUND_MESSAGE_SEND',
  'DELIVERY_RECEIPT_RECONCILIATION',
  'MEDIA_TRANSFER',
  'HISTORY_SYNCHRONIZATION',
  'SESSION_RESTORE'
]);
const M2_CLOSED_GOVERNANCE_FIELDS = Object.freeze([
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
const M3_CLOSED_GOVERNANCE_FIELDS = Object.freeze([
  'readyForPromotion',
  'mergeAuthorized',
  'productionUseAuthorized',
  'wpCAuthorized',
  'formalRelease',
  'publish',
  'temporaryBypassAllowed',
  'warningOnlyClosureAllowed'
]);
const M3_AUTHORIZATION_FIELDS = Object.freeze([
  'redContractsMayBeWritten',
  'productionSourceClosureMayBeginAfterCredibleRed',
  'inventoryPathsMayBeDeletedOrDelegated',
  'sourceScannerMayBeGeneralized',
  'provenanceAndSbomMayBeGenerated',
  'permanentPostMergeValidationMayBeAdded',
  'independentReviewRemediationMayBeApplied',
  'authorizationAmendmentRequiredForNewPath'
]);
const M3_NON_WAIVABLE_GATES = Object.freeze([
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
const EXPECTED_SCOPE_002_PATHS = Object.freeze([
  'backend/services/facebookChatwootMatrixBridge.js',
  'governance/architecture-closure-v2/wp-b-xstate-supply-chain-lock.json',
  'release/production-dependency-binding.json',
  'tests/wp0/open-source-work-package-authorization.test.js',
  'tests/wp0/v21-voice-brain-authority-cutover.test.js'
]);

function repositoryRoot(options = {}) {
  return path.resolve(options.repositoryRoot || path.resolve(__dirname, '..', '..'));
}

function authorityDocumentPath(root, repositoryPath) {
  return path.join(root, ...repositoryPath.split('/'));
}

function loadJsonObject(filePath) {
  try {
    const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch (_) {
    return null;
  }
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

function exactPathSet(values) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const normalized = values.map(normalizeRepositoryPath);
  if (normalized.some((value, index) => !value || value !== values[index] || value.includes('*'))) return null;
  if (new Set(normalized).size !== normalized.length) return null;
  return Object.freeze([...normalized]);
}

function sameOrderedValues(actual, expected) {
  return Array.isArray(actual)
    && actual.length === expected.length
    && actual.every((value, index) => value === expected[index]);
}

function hasRequiredGovernanceInvariants(authority) {
  if (!authority) return false;
  for (const [field, expected] of Object.entries(GOVERNANCE_INVARIANTS)) {
    if (authority.governance?.[field] !== expected) return false;
  }
  return true;
}

function closedGovernance(document, fields) {
  return fields.every(field => document?.governance?.[field] === false);
}

function extendLegacyAuthority(authority) {
  if (!hasRequiredGovernanceInvariants(authority)) return null;
  const allowedProductionPaths = Object.freeze([...new Set([
    ...authority.allowedProductionPaths,
    ...ADDITIONAL_WP_B_AUTHORITY_PATHS,
    ...PERMANENT_REVIEW_WORKFLOW_PATHS
  ])]);
  return Object.freeze({ ...authority, allowedProductionPaths });
}

function loadM2Receipt(options = {}) {
  const root = repositoryRoot(options);
  return loadJsonObject(options.m2ReceiptPath || authorityDocumentPath(root, AUTHORITY_DOCUMENT_PATHS.milestone2));
}

function validM2Receipt(document) {
  const allowedPaths = exactPathSet(document?.allowedPaths);
  if (!allowedPaths) return null;
  if (document.schemaVersion !== 1
      || document.documentType !== 'YANCE_ACV2_WP_B_M2_AUTHORIZATION'
      || document.program !== 'Architecture Closure V2'
      || document.repository !== 'laiqian0239-glitch/yance'
      || document.workPackage !== 'WP-B'
      || document.status !== 'AUTHORIZED_FOR_RED_AND_IMPLEMENTATION'
      || document.approvedBy !== 'PROJECT_OWNER'
      || document.pullRequest !== 17
      || document.branch !== EXPECTED_BRANCH
      || document.parentMilestone1SealHead !== EXPECTED_M1_SEAL_HEAD
      || !FULL_SHA.test(String(document.parentMilestone1SealHead || ''))
      || !sameOrderedValues(document.operationKinds, EXPECTED_OPERATION_KINDS)
      || document.governance?.prMustRemainDraft !== true
      || document.governance?.milestone2Authorized !== true
      || !closedGovernance(document, M2_CLOSED_GOVERNANCE_FIELDS)) return null;
  const red = document.authorizationContractRedEvidence || {};
  if (!FULL_SHA.test(String(red.head || ''))
      || red.workflowName !== 'WP-B M2 Authorization'
      || !Number.isSafeInteger(red.workflowRunId)
      || !Number.isSafeInteger(red.ubuntuJobId)
      || !Number.isSafeInteger(red.windowsJobId)
      || red.expectedConclusion !== 'failure'
      || red.contractResult !== '0_OF_8_PASS') return null;
  return Object.freeze({ allowedPaths });
}

function resolveWpBM2ImplementationAuthority(options = {}) {
  const baseAuthority = engine.resolveWpBImplementationAuthority(options);
  const receipt = loadM2Receipt(options);
  const validation = validM2Receipt(receipt);
  if (!baseAuthority || !validation || !hasRequiredGovernanceInvariants(receipt)) return null;
  return Object.freeze({
    schemaVersion: 2,
    documentType: 'YANCE_ACV2_ACTIVE_WORK_PACKAGE_AUTHORITY',
    program: 'Architecture Closure V2',
    repository: 'laiqian0239-glitch/yance',
    workPackage: 'WP-B',
    milestone: 2,
    status: receipt.status,
    authorizedBranch: receipt.branch,
    baseHead: receipt.parentMilestone1SealHead,
    parentMilestone1SealHead: receipt.parentMilestone1SealHead,
    targetMigrationId: baseAuthority.targetMigrationId,
    targetSchemaVersion: baseAuthority.targetSchemaVersion,
    operationKinds: Object.freeze([...receipt.operationKinds]),
    allowedProductionPaths: validation.allowedPaths,
    governance: Object.freeze({ ...receipt.governance })
  });
}

function loadM3Receipt(options = {}) {
  const root = repositoryRoot(options);
  return loadJsonObject(options.m3ReceiptPath || authorityDocumentPath(root, AUTHORITY_DOCUMENT_PATHS.milestone3));
}

function validM3Receipt(document) {
  const allowedPaths = exactPathSet(document?.allowedPaths);
  if (!allowedPaths) return null;
  if (document.schemaVersion !== 1
      || document.documentType !== 'YANCE_ACV2_WP_B_M3_AUTHORIZATION'
      || document.program !== 'Architecture Closure V2'
      || document.repository !== 'laiqian0239-glitch/yance'
      || document.workPackage !== 'WP-B'
      || document.milestone !== 3
      || document.status !== 'AUTHORIZED_FOR_SOURCE_CLOSURE_AND_FINAL_GATES'
      || document.approvedBy !== 'PROJECT_OWNER'
      || document.pullRequest !== 17
      || document.branch !== EXPECTED_BRANCH
      || document.parentMilestone2EvidenceHead !== EXPECTED_M2_EVIDENCE_HEAD
      || document.parentMilestone2SealHead !== EXPECTED_M2_SEAL_HEAD
      || document.parentMilestone2ReviewedHead !== EXPECTED_M2_REVIEWED_HEAD
      || document.approvedDesignHead !== EXPECTED_DESIGN_HEAD
      || document.governance?.prMustRemainDraft !== true
      || document.governance?.milestone1Sealed !== true
      || document.governance?.milestone2Sealed !== true
      || document.governance?.milestone3Authorized !== true
      || !closedGovernance(document, M3_CLOSED_GOVERNANCE_FIELDS)) return null;
  if (!M3_AUTHORIZATION_FIELDS.every(field => document.authorization?.[field] === true)) return null;
  if (!M3_NON_WAIVABLE_GATES.every(field => document.nonWaivableGates?.[field] === true)) return null;
  const inventory = document.inventoryAuthority || {};
  if (inventory.path !== AUTHORITY_DOCUMENT_PATHS.inventory
      || inventory.authorizedPathCount !== 45
      || inventory.authorizedPathSetSha256 !== '579cc85774c1c26a433b4ed167a153df1a8a4bbabc7159a8f9925cacddfd2990'
      || inventory.authorizationAmendmentRequiredForNewPath !== true) return null;
  const amendments = Array.isArray(document.authorizationAmendments) ? document.authorizationAmendments : [];
  const scope002 = amendments.find(value => value?.amendmentId === 'WP-B-M3-SCOPE-002');
  if (!scope002
      || scope002.approvedBy !== 'PROJECT_OWNER'
      || scope002.reasonCode !== 'WP_B_M3_FRESH_MAIN_OPERATION_AND_BINDING_CLOSURE'
      || scope002.trustedMainHead !== '7ab4b85f6bdbce34ea96b608a807ca120618bb87'
      || !sameOrderedValues(scope002.addedPaths, EXPECTED_SCOPE_002_PATHS)) return null;
  if (!EXPECTED_SCOPE_002_PATHS.every(repositoryPath => allowedPaths.includes(repositoryPath))) return null;
  return Object.freeze({ allowedPaths });
}

function resolveWpBM3ImplementationAuthority(options = {}) {
  const root = repositoryRoot(options);
  const baseAuthority = engine.resolveWpBImplementationAuthority(options);
  const inheritedMilestone2 = resolveWpBM2ImplementationAuthority(options);
  const receipt = loadM3Receipt(options);
  const validation = validM3Receipt(receipt);
  const inventory = engine.loadWpBOperationInventory(
    options.inventoryPath || authorityDocumentPath(root, AUTHORITY_DOCUMENT_PATHS.inventory)
  );
  if (!baseAuthority
      || !inheritedMilestone2
      || !validation
      || !engine.isValidWpBOperationInventory(inventory, baseAuthority.baseline)
      || !hasRequiredGovernanceInvariants(receipt)) return null;
  const allowedProductionPaths = Object.freeze([...new Set([
    ...inheritedMilestone2.allowedProductionPaths,
    ...validation.allowedPaths,
    ...inventory.entries.map(entry => entry.path)
  ])]);
  return Object.freeze({
    schemaVersion: 3,
    documentType: 'YANCE_ACV2_ACTIVE_WORK_PACKAGE_AUTHORITY',
    program: 'Architecture Closure V2',
    repository: 'laiqian0239-glitch/yance',
    workPackage: 'WP-B',
    milestone: 3,
    status: receipt.status,
    authorizedBranch: receipt.branch,
    baseHead: receipt.parentMilestone2EvidenceHead,
    parentMilestone1SealHead: inheritedMilestone2.parentMilestone1SealHead,
    parentMilestone2EvidenceHead: receipt.parentMilestone2EvidenceHead,
    parentMilestone2SealHead: receipt.parentMilestone2SealHead,
    parentMilestone2ReviewedHead: receipt.parentMilestone2ReviewedHead,
    approvedDesignHead: receipt.approvedDesignHead,
    targetMigrationId: baseAuthority.targetMigrationId,
    targetSchemaVersion: baseAuthority.targetSchemaVersion,
    operationKinds: inheritedMilestone2.operationKinds,
    allowedProductionPaths,
    governance: Object.freeze({ ...receipt.governance })
  });
}

function resolveWpBImplementationAuthority(options = {}) {
  const milestone3 = resolveWpBM3ImplementationAuthority(options);
  if (milestone3) return milestone3;
  const milestone2 = resolveWpBM2ImplementationAuthority(options);
  if (milestone2) return milestone2;
  return extendLegacyAuthority(engine.resolveWpBImplementationAuthority(options));
}

function isAuthorizedWpBImplementationBranch(
  branch,
  authority = resolveWpBImplementationAuthority(),
  options = {}
) {
  if (!authority || typeof branch !== 'string' || branch.length === 0) return false;
  if (branch === authority.authorizedBranch) return true;

  const evaluateTrustedDelegatedGovernanceBranch = options.evaluateTrustedDelegatedGovernanceBranch
    || implementationBranchPolicyLegacy.evaluateTrustedDelegatedGovernanceBranch;
  const delegated = evaluateTrustedDelegatedGovernanceBranch({
    branch,
    trustedPolicyRoot: repositoryRoot(options),
    ...(options.delegatedGovernance || {})
  });
  return Boolean(delegated?.pass === true
    && delegated.authorizationPath === WP_B_M3_SUCCESSOR_AUTHORIZATION_PATH);
}

function evaluateAuthorizedWpBScope(options = {}) {
  const authority = options.authority || resolveWpBImplementationAuthority(options);
  return engine.evaluateAuthorizedWpBScope({ ...options, authority });
}

module.exports = Object.freeze({
  ...engine,
  ADDITIONAL_WP_B_AUTHORITY_PATHS,
  APPLICATION_EVIDENCE_PATHS,
  AUTHORITY_DOCUMENT_PATHS,
  GOVERNANCE_INVARIANTS,
  INTERNAL_ENGINE_PATHS,
  MILESTONE_TWO_WORKFLOW_PATHS,
  MILESTONE_THREE_WORKFLOW_PATHS,
  PERMANENT_REVIEW_WORKFLOW_PATHS,
  WP_B_CORE_SCOPE_PATTERNS,
  WP_B_M3_SUCCESSOR_AUTHORIZATION_PATH,
  resolveWpBM2ImplementationAuthority,
  resolveWpBM3ImplementationAuthority,
  resolveWpBImplementationAuthority,
  isAuthorizedWpBImplementationBranch,
  evaluateAuthorizedWpBScope
});