'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const REBUILD_BRANCH_PATTERN_SOURCE = '^rebuild/windows-release-closure-([0-9]{4})([0-9]{2})([0-9]{2})(?:-[a-z0-9][a-z0-9._-]*)?$';
const REBUILD_BRANCH_PATTERN = new RegExp(REBUILD_BRANCH_PATTERN_SOURCE);
const ACV2_BRANCH_PATTERN = /^acv2\/wp-([a-h])-[a-z0-9][a-z0-9-]*$/;
const ACV2_AUTHORIZATION_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  'governance',
  'architecture-closure-v2',
  'implementation-plan-authorization.json'
);
const ACV2_SCOPE_AMENDMENT_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  'governance',
  'architecture-closure-v2',
  'wp-a-a6-scope-amendment.json'
);
const ACV2_AUTHORIZATION_REPOSITORY_PATH = 'governance/architecture-closure-v2/implementation-plan-authorization.json';
const ACV2_AUTHORIZATION_BLOB_SHA = '203697b36c06e0dc72c92113ef58f1a8f2394312';

function canonicalStageBranch(stageVersion) {
  if (typeof stageVersion !== 'string' || !/^\d+\.\d+\.\d+\.\d+$/.test(stageVersion)) {
    throw new TypeError('stageVersion must use the numeric x.x.x.x form');
  }
  return `stage/${stageVersion}-architecture-closure`;
}

function isValidUtcCalendarDate(year, month, day) {
  const value = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return value.getUTCFullYear() === Number(year)
    && value.getUTCMonth() === Number(month) - 1
    && value.getUTCDate() === Number(day);
}

function isReleaseClosureRebuildBranch(branch) {
  if (typeof branch !== 'string') return false;
  const match = branch.match(REBUILD_BRANCH_PATTERN);
  return Boolean(match && isValidUtcCalendarDate(match[1], match[2], match[3]));
}

function loadJsonObject(filePath) {
  try {
    const document = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return document && typeof document === 'object' && !Array.isArray(document) ? document : null;
  } catch (_) {
    return null;
  }
}

function loadWorkPackageAuthorization(filePath = ACV2_AUTHORIZATION_PATH) {
  return loadJsonObject(filePath);
}

function loadWorkPackageScopeAmendment(filePath = ACV2_SCOPE_AMENDMENT_PATH) {
  return loadJsonObject(filePath);
}

function authorizationWorkPackageLetter(authorization) {
  const branchMatch = String(authorization?.authorizedBranch || '').match(ACV2_BRANCH_PATTERN);
  return branchMatch ? branchMatch[1].toUpperCase() : '';
}

function isValidWorkPackageAuthorization(authorization) {
  if (!authorization || typeof authorization !== 'object' || Array.isArray(authorization)) return false;
  if (authorization.schemaVersion !== 1) return false;
  if (authorization.documentType !== 'YANCE_ACV2_WORK_PACKAGE_AUTHORIZATION') return false;
  if (authorization.program !== 'Architecture Closure V2') return false;
  if (authorization.repository !== 'laiqian0239-glitch/yance') return false;
  if (authorization.governance?.automaticNextWorkPackageAuthorization !== false) return false;
  if (authorization.governance?.pr4MustRemainDraft !== true) return false;
  if (typeof authorization.requiredBaseRef !== 'string' || !authorization.requiredBaseRef.trim()) return false;
  if (typeof authorization.approvedParentHead !== 'string' || !/^[a-f0-9]{40}$/u.test(authorization.approvedParentHead)) return false;
  if (!Array.isArray(authorization.allowedProductionPaths) || authorization.allowedProductionPaths.length === 0) return false;

  const letter = authorizationWorkPackageLetter(authorization);
  if (!letter) return false;
  if (authorization.currentAuthorizedWorkPackage !== `WP-${letter}`) return false;
  if (authorization.status !== `WP_${letter}_IMPLEMENTATION_AUTHORIZED`) return false;
  if (authorization.productionScope !== `WP_${letter}_ONLY`) return false;
  if (!Array.isArray(authorization.lockedWorkPackages)) return false;
  if (authorization.lockedWorkPackages.includes(`WP-${letter}`)) return false;
  return true;
}

function resolveAuthorization(options = {}) {
  if (Object.prototype.hasOwnProperty.call(options, 'authorization')) return options.authorization;
  return loadWorkPackageAuthorization(options.authorizationPath || ACV2_AUTHORIZATION_PATH);
}

function isAuthorizedAcv2WorkPackageBranch(branch, authorization) {
  if (typeof branch !== 'string' || !isValidWorkPackageAuthorization(authorization)) return false;
  return branch === authorization.authorizedBranch;
}

function isAuthorizedImplementationBranch(branch, stageVersion, options = {}) {
  if (typeof branch !== 'string' || branch.length === 0) return false;
  if (branch === canonicalStageBranch(stageVersion) || isReleaseClosureRebuildBranch(branch)) return true;
  return isAuthorizedAcv2WorkPackageBranch(branch, resolveAuthorization(options));
}

function authorizedImplementationBranchDescription(stageVersion, options = {}) {
  const base = `${canonicalStageBranch(stageVersion)} or rebuild/windows-release-closure-YYYYMMDD[-suffix]`;
  const authorization = resolveAuthorization(options);
  return isValidWorkPackageAuthorization(authorization)
    ? `${base} or exact machine-authorized branch ${authorization.authorizedBranch}`
    : base;
}

function normalizeRepositoryPath(value) {
  const normalized = String(value || '').trim().replace(/\\/gu, '/').replace(/^\.\//u, '').replace(/\/$/u, '');
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:\//u.test(normalized)) return '';
  const segments = normalized.split('/');
  if (segments.some(segment => !segment || segment === '.' || segment === '..')) return '';
  return normalized;
}

function globPatternToRegExp(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/gu, '\\$&');
  const source = escaped
    .replace(/\*\*/gu, '\u0000')
    .replace(/\*/gu, '[^/]*')
    .replace(/\u0000/gu, '.*');
  return new RegExp(`^${source}$`, 'u');
}

function matchesAuthorizedProductionPath(relativePath, pattern) {
  const pathValue = normalizeRepositoryPath(relativePath);
  const patternValue = normalizeRepositoryPath(pattern);
  if (!pathValue || !patternValue) return false;
  if (!/[?*[]/u.test(patternValue)) return pathValue === patternValue;
  return globPatternToRegExp(patternValue).test(pathValue);
}

function workPackageChangedFilesSha256(values = []) {
  const normalized = [...new Set((Array.isArray(values) ? values : [])
    .map(normalizeRepositoryPath)
    .filter(Boolean))].sort();
  return crypto.createHash('sha256').update(`${normalized.join('\n')}\n`, 'utf8').digest('hex');
}

function isExactAdditionalPath(value) {
  const normalized = normalizeRepositoryPath(value);
  return Boolean(normalized && normalized === value && !/[?*[]/u.test(normalized));
}

function isValidWorkPackageScopeAmendment(amendment, authorization) {
  if (!isValidWorkPackageAuthorization(authorization)) return false;
  if (!amendment || typeof amendment !== 'object' || Array.isArray(amendment)) return false;
  if (amendment.schemaVersion !== 1) return false;
  if (amendment.documentType !== 'YANCE_ACV2_WORK_PACKAGE_SCOPE_AMENDMENT') return false;
  if (amendment.status !== 'APPROVED_INDEPENDENT_REVIEW_SCOPE_AMENDMENT') return false;
  if (amendment.repository !== authorization.repository) return false;
  if (amendment.workPackage !== authorization.currentAuthorizedWorkPackage) return false;
  if (amendment.authorizedBranch !== authorization.authorizedBranch) return false;
  if (amendment.baseAuthorizationPath !== ACV2_AUTHORIZATION_REPOSITORY_PATH) return false;
  if (amendment.baseAuthorizationBlobSha !== ACV2_AUTHORIZATION_BLOB_SHA) return false;
  if (!/^[a-f0-9]{40}$/u.test(String(amendment.parentGovernanceHead || ''))) return false;
  if (!/^[a-f0-9]{64}$/u.test(String(amendment.approvedChangedFileSetSha256 || ''))) return false;
  if (!Array.isArray(amendment.additionalAllowedPaths) || amendment.additionalAllowedPaths.length === 0) return false;
  if (!amendment.additionalAllowedPaths.every(isExactAdditionalPath)) return false;
  if (new Set(amendment.additionalAllowedPaths).size !== amendment.additionalAllowedPaths.length) return false;
  const governance = amendment.governance || {};
  if (governance.exactPathExpansionOnly !== true) return false;
  if (governance.wildcardExpansionAllowed !== false) return false;
  if (governance.prMustRemainDraft !== true) return false;
  if (governance.automaticNextTaskAuthorization !== false) return false;
  if (governance.automaticNextWorkPackageAuthorization !== false) return false;
  if (governance.readyForPromotion !== false) return false;
  return true;
}

function effectiveAllowedProductionPaths(authorization, amendment = null) {
  if (!isValidWorkPackageAuthorization(authorization)) return [];
  const base = [...authorization.allowedProductionPaths];
  if (!isValidWorkPackageScopeAmendment(amendment, authorization)) return Object.freeze(base);
  return Object.freeze([...new Set([...base, ...amendment.additionalAllowedPaths])]);
}

function evaluateAuthorizedWorkPackageScope(options = {}) {
  const authorization = options.authorization;
  const amendment = options.amendment || null;
  const branch = String(options.branch || '');
  const changedFiles = [...new Set((Array.isArray(options.changedFiles) ? options.changedFiles : [])
    .map(normalizeRepositoryPath)
    .filter(Boolean))].sort();
  const changedFileSetSha256 = workPackageChangedFilesSha256(changedFiles);

  if (!isValidWorkPackageAuthorization(authorization) || branch !== authorization.authorizedBranch) {
    return Object.freeze({
      pass: false,
      reasonCode: 'ACV2_WORK_PACKAGE_AUTHORIZATION_INVALID',
      changedFileSetSha256,
      amendmentApplied: false,
      unauthorizedPaths: changedFiles
    });
  }

  if (amendment && !isValidWorkPackageScopeAmendment(amendment, authorization)) {
    return Object.freeze({
      pass: false,
      reasonCode: 'ACV2_SCOPE_AMENDMENT_INVALID',
      changedFileSetSha256,
      amendmentApplied: false,
      unauthorizedPaths: changedFiles.filter(file => !authorization.allowedProductionPaths.some(pattern => matchesAuthorizedProductionPath(file, pattern)))
    });
  }
  if (amendment && amendment.approvedChangedFileSetSha256 !== changedFileSetSha256) {
    return Object.freeze({
      pass: false,
      reasonCode: 'ACV2_CHANGED_FILE_SET_MISMATCH',
      changedFileSetSha256,
      amendmentApplied: true,
      unauthorizedPaths: []
    });
  }

  const allowedPaths = effectiveAllowedProductionPaths(authorization, amendment);
  const unauthorizedPaths = changedFiles.filter(file => !allowedPaths.some(pattern => matchesAuthorizedProductionPath(file, pattern)));
  return Object.freeze({
    pass: unauthorizedPaths.length === 0,
    reasonCode: unauthorizedPaths.length ? 'ACV2_WORK_PACKAGE_SCOPE_VIOLATION' : null,
    changedFileSetSha256,
    amendmentApplied: Boolean(amendment),
    unauthorizedPaths,
    allowedPathCount: allowedPaths.length
  });
}

module.exports = {
  REBUILD_BRANCH_PATTERN_SOURCE,
  ACV2_AUTHORIZATION_PATH,
  ACV2_SCOPE_AMENDMENT_PATH,
  ACV2_AUTHORIZATION_REPOSITORY_PATH,
  ACV2_AUTHORIZATION_BLOB_SHA,
  canonicalStageBranch,
  isReleaseClosureRebuildBranch,
  loadWorkPackageAuthorization,
  loadWorkPackageScopeAmendment,
  isValidWorkPackageAuthorization,
  isValidWorkPackageScopeAmendment,
  isAuthorizedAcv2WorkPackageBranch,
  isAuthorizedImplementationBranch,
  authorizedImplementationBranchDescription,
  normalizeRepositoryPath,
  matchesAuthorizedProductionPath,
  workPackageChangedFilesSha256,
  effectiveAllowedProductionPaths,
  evaluateAuthorizedWorkPackageScope
};
