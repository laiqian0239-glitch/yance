'use strict';

const engine = require('./acv2ActiveWorkPackageAuthorityEngine');
const m2Authorization = require('../../tools/architecture-closure-v2/verify-wp-b-m2-authorization');
const m3Authorization = require('../../tools/architecture-closure-v2/verify-wp-b-m3-authorization');

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

function hasRequiredGovernanceInvariants(authority) {
  if (!authority) return false;
  for (const [field, expected] of Object.entries(GOVERNANCE_INVARIANTS)) {
    if (authority.governance?.[field] !== expected) return false;
  }
  return true;
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

function resolveWpBM2ImplementationAuthority(options = {}) {
  const authority = m2Authorization.resolveImplementationAuthority(options);
  if (!hasRequiredGovernanceInvariants(authority)) return null;
  return Object.freeze({
    schemaVersion: 2,
    documentType: 'YANCE_ACV2_ACTIVE_WORK_PACKAGE_AUTHORITY',
    program: 'Architecture Closure V2',
    repository: 'laiqian0239-glitch/yance',
    workPackage: 'WP-B',
    milestone: 2,
    status: 'AUTHORIZED_FOR_RED_AND_IMPLEMENTATION',
    authorizedBranch: authority.authorizedBranch,
    baseHead: authority.parentMilestone1SealHead,
    parentMilestone1SealHead: authority.parentMilestone1SealHead,
    targetMigrationId: '023_architecture_closure_v2_wp_b',
    targetSchemaVersion: 23,
    operationKinds: authority.operationKinds,
    allowedProductionPaths: authority.allowedProductionPaths,
    governance: authority.governance
  });
}

function resolveWpBM3ImplementationAuthority(options = {}) {
  const authority = m3Authorization.resolveImplementationAuthority(options);
  const inheritedMilestone2 = resolveWpBM2ImplementationAuthority(options);
  if (!hasRequiredGovernanceInvariants(authority) || !inheritedMilestone2) return null;
  return Object.freeze({
    schemaVersion: 3,
    documentType: 'YANCE_ACV2_ACTIVE_WORK_PACKAGE_AUTHORITY',
    program: 'Architecture Closure V2',
    repository: 'laiqian0239-glitch/yance',
    workPackage: 'WP-B',
    milestone: 3,
    status: 'AUTHORIZED_FOR_SOURCE_CLOSURE_AND_FINAL_GATES',
    authorizedBranch: authority.authorizedBranch,
    baseHead: authority.parentMilestone2EvidenceHead,
    parentMilestone1SealHead: inheritedMilestone2.parentMilestone1SealHead,
    parentMilestone2EvidenceHead: authority.parentMilestone2EvidenceHead,
    parentMilestone2SealHead: authority.parentMilestone2SealHead,
    parentMilestone2ReviewedHead: authority.parentMilestone2ReviewedHead,
    approvedDesignHead: authority.approvedDesignHead,
    targetMigrationId: inheritedMilestone2.targetMigrationId,
    targetSchemaVersion: inheritedMilestone2.targetSchemaVersion,
    operationKinds: inheritedMilestone2.operationKinds,
    allowedProductionPaths: authority.allowedProductionPaths,
    governance: authority.governance
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
  authority = resolveWpBImplementationAuthority()
) {
  return Boolean(authority && typeof branch === 'string' && branch === authority.authorizedBranch);
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
  resolveWpBM2ImplementationAuthority,
  resolveWpBM3ImplementationAuthority,
  resolveWpBImplementationAuthority,
  isAuthorizedWpBImplementationBranch,
  evaluateAuthorizedWpBScope
});
