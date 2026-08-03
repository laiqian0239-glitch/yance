'use strict';

const engine = require('./acv2ActiveWorkPackageAuthorityEngine');

const INTERNAL_ENGINE_PATHS = Object.freeze([
  'backend/migrations/architectureClosureV2WpBEngine.js',
  'shared/release/acv2ActiveWorkPackageAuthorityEngine.js'
]);
const WP_B_CORE_SCOPE_PATTERNS = Object.freeze([
  ...engine.WP_B_CORE_SCOPE_PATTERNS,
  ...INTERNAL_ENGINE_PATHS
]);

function extendAuthority(authority) {
  if (!authority) return null;
  const allowedProductionPaths = Object.freeze([...new Set([
    ...authority.allowedProductionPaths,
    ...INTERNAL_ENGINE_PATHS
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
  INTERNAL_ENGINE_PATHS,
  WP_B_CORE_SCOPE_PATTERNS,
  resolveWpBImplementationAuthority,
  isAuthorizedWpBImplementationBranch,
  evaluateAuthorizedWpBScope
});
