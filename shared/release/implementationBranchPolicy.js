'use strict';

const legacy = require('./implementationBranchPolicyLegacy');
const active = require('./acv2ActiveWorkPackageAuthority');

function hasExplicitLegacyAuthorizationContext(options = {}) {
  return [
    'authorization',
    'postMergeDefect',
    'taskScopeChain',
    'amendment'
  ].some(key => Object.prototype.hasOwnProperty.call(options, key));
}

function resolveWpBAuthority(options = {}) {
  if (Object.prototype.hasOwnProperty.call(options, 'wpBAuthority')) return options.wpBAuthority;
  if (hasExplicitLegacyAuthorizationContext(options)) return null;
  return active.resolveWpBImplementationAuthority(options);
}

function isAuthorizedImplementationBranch(branch, stageVersion, options = {}) {
  if (legacy.isAuthorizedImplementationBranch(branch, stageVersion, options)) return true;
  return active.isAuthorizedWpBImplementationBranch(branch, resolveWpBAuthority(options));
}

function authorizedImplementationBranchDescription(stageVersion, options = {}) {
  const legacyDescription = legacy.authorizedImplementationBranchDescription(stageVersion, options);
  const authority = resolveWpBAuthority(options);
  return authority
    ? `${legacyDescription} or exact active ${authority.workPackage} branch ${authority.authorizedBranch}`
    : legacyDescription;
}

module.exports = Object.freeze({
  ...legacy,
  ...active,
  isAuthorizedImplementationBranch,
  authorizedImplementationBranchDescription
});