'use strict';

const engine = require('./acv2ActiveWorkPackageAuthorityEngine');

const AUTHORITY_DOCUMENT_PATHS = Object.freeze({
  design: 'governance/architecture-closure-v2/wp-b-design-authorization.json',
  baseline: 'governance/architecture-closure-v2/wp-b-baseline.json',
  inventory: 'governance/architecture-closure-v2/wp-b-operation-inventory.json'
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
const ADDITIONAL_WP_B_AUTHORITY_PATHS = Object.freeze([
  ...INTERNAL_ENGINE_PATHS,
  ...APPLICATION_EVIDENCE_PATHS
]);
const WP_B_CORE_SCOPE_PATTERNS = Object.freeze([
  ...engine.WP_B_CORE_SCOPE_PATTERNS,
  ...ADDITIONAL_WP_B_AUTHORITY_PATHS,
  ...PERMANENT_REVIEW_WORKFLOW_PATHS
]);

function extendAuthority(authority) {
  if (!authority) return null;
  for (const [field, expected] of Object.entries(GOVERNANCE_INVARIANTS)) {
    if (authority.governance?.[field] !== expected) return null;
  }
  const allowedProductionPaths = Object.freeze([...new Set([
    ...authority.allowedProductionPaths,
    ...ADDITIONAL_WP_B_AUTHORITY_PATHS,
    ...PERMANENT_REVIEW_WORKFLOW_PATHS
  ])]);
  return Object.freeze({ ...authority, allowedProductionPaths });
}

function resolveWpBImplementationAuthority(options = {}) {
  return extendAuthority(engine.resolveWpBImplementationAuthority(options));
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
  PERMANENT_REVIEW_WORKFLOW_PATHS,
  WP_B_CORE_SCOPE_PATTERNS,
  resolveWpBImplementationAuthority,
  isAuthorizedWpBImplementationBranch,
  evaluateAuthorizedWpBScope
});