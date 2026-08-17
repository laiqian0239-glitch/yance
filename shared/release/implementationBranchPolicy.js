'use strict';

const legacy = require('./implementationBranchPolicyLegacy');
const active = require('./acv2ActiveWorkPackageAuthority');
const openSourceWorkPackagePolicy = require('./openSourceWorkPackagePolicy');

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function hasExplicitLegacyAuthorizationContext(options = {}) {
  return [
    'authorization',
    'postMergeDefect',
    'taskScopeChain',
    'amendment'
  ].some(key => hasOwn(options, key));
}

function resolveWpBAuthority(options = {}) {
  if (hasOwn(options, 'wpBAuthority')) return options.wpBAuthority;
  if (hasExplicitLegacyAuthorizationContext(options)) return null;
  return active.resolveWpBImplementationAuthority(options);
}

function resolveLegacyAcv2Authorization(options = {}) {
  if (hasOwn(options, 'authorization')) return options.authorization;
  return legacy.loadWorkPackageAuthorization(options.authorizationPath);
}

function isAuthorizedLegacyNonOssBranch(branch, stageVersion, options = {}) {
  if (typeof branch !== 'string' || branch.length === 0) return false;
  if (branch === legacy.canonicalStageBranch(stageVersion)
      || legacy.isReleaseClosureRebuildBranch(branch)) return true;
  if (legacy.isAuthorizedAcv2WorkPackageBranch(branch, resolveLegacyAcv2Authorization(options))) return true;
  return legacy.isAuthorizedDelegatedGovernanceBranch(branch, options.delegatedGovernance || {});
}

function isAuthorizedImplementationBranch(branch, stageVersion, options = {}) {
  if (isAuthorizedLegacyNonOssBranch(branch, stageVersion, options)) return true;
  if (openSourceWorkPackagePolicy.isAuthorizedOpenSourceImplementationBranch(
    branch,
    options.openSource || {}
  )) return true;
  return active.isAuthorizedWpBImplementationBranch(branch, resolveWpBAuthority(options));
}

function authorizedImplementationBranchDescription(stageVersion, options = {}) {
  const base = `${legacy.canonicalStageBranch(stageVersion)} or rebuild/windows-release-closure-YYYYMMDD[-suffix]`;
  const authorization = resolveLegacyAcv2Authorization(options);
  const legacyDescription = legacy.isValidWorkPackageAuthorization(authorization)
    ? `${base} or exact machine-authorized branch ${authorization.authorizedBranch} or an exact trusted-main delegated governance branch or an exact sealed open-source work-package branch`
    : `${base} or an exact trusted-main delegated governance branch or an exact sealed open-source work-package branch`;
  const authority = resolveWpBAuthority(options);
  return authority
    ? `${legacyDescription} or exact active ${authority.workPackage} branch ${authority.authorizedBranch}`
    : legacyDescription;
}

module.exports = Object.freeze({
  ...legacy,
  ...active,
  isAuthorizedOpenSourceImplementationBranch:
    openSourceWorkPackagePolicy.isAuthorizedOpenSourceImplementationBranch,
  evaluateAuthorizedOpenSourceWorkPackageScope:
    openSourceWorkPackagePolicy.evaluateAuthorizedOpenSourceWorkPackageScope,
  isAuthorizedImplementationBranch,
  authorizedImplementationBranchDescription
});