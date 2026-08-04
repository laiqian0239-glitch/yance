'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const OSS_AUTHORIZATION_PATH = path.join(
  REPO_ROOT,
  'governance',
  'open-source-acceleration',
  'oss-0-implementation-authorization.json'
);
const OSS_AUTHORIZATION_RECEIPT_PATH = path.join(
  REPO_ROOT,
  'governance',
  'open-source-acceleration',
  'oss-0-authorization-receipt.json'
);

function loadJsonObject(filePath) {
  try {
    const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch (_) {
    return null;
  }
}

function loadOpenSourceWorkPackageAuthorization(filePath = OSS_AUTHORIZATION_PATH) {
  return loadJsonObject(filePath);
}

function loadOpenSourceWorkPackageAuthorizationReceipt(filePath = OSS_AUTHORIZATION_RECEIPT_PATH) {
  return loadJsonObject(filePath);
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

function isExactRepositoryPath(value) {
  const normalized = normalizeRepositoryPath(value);
  return Boolean(normalized && normalized === value && !/[*?[\]]/u.test(normalized));
}

function normalizeChangedFiles(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map(normalizeRepositoryPath).filter(Boolean))].sort();
}

function changedFileSetSha256(values) {
  const normalized = normalizeChangedFiles(values);
  return crypto.createHash('sha256').update(`${normalized.join('\n')}\n`, 'utf8').digest('hex');
}

function sha256File(filePath) {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  } catch (_) {
    return null;
  }
}

function exactGovernanceClosed(governance) {
  return governance?.exactPathScopeOnly === true
    && governance?.wildcardExpansionAllowed === false
    && governance?.prMustRemainDraft === true
    && governance?.mergeIntoMainAuthorized === false
    && governance?.productionUseAuthorized === false
    && governance?.formalRelease === false
    && governance?.publish === false
    && governance?.automaticNextWorkPackageAuthorization === false
    && governance?.temporaryBypassAllowed === false
    && governance?.warningOnlyClosureAllowed === false
    && governance?.readyForPromotion === false;
}

function isValidOpenSourceWorkPackageAuthorization(authorization) {
  if (!authorization || typeof authorization !== 'object' || Array.isArray(authorization)) return false;
  if (authorization.schemaVersion !== 1) return false;
  if (authorization.documentType !== 'YANCE_OPEN_SOURCE_WORK_PACKAGE_AUTHORIZATION') return false;
  if (authorization.program !== 'Open Source Acceleration') return false;
  if (authorization.repository !== 'laiqian0239-glitch/yance') return false;
  if (authorization.workPackage !== 'OSS-0') return false;
  if (authorization.status !== 'IMPLEMENTATION_AUTHORIZED') return false;
  if (authorization.authorizedBranch !== 'oss/0-provenance-foundation') return false;
  if (authorization.requiredBaseRef !== 'plan/open-source-acceleration') return false;
  if (!/^[a-f0-9]{40}$/u.test(String(authorization.approvedParentHead || ''))) return false;
  if (!isExactRepositoryPath(authorization.approvedPlanPath)) return false;
  if (!Array.isArray(authorization.exactPaths) || authorization.exactPaths.length === 0) return false;
  if (!authorization.exactPaths.every(isExactRepositoryPath)) return false;
  if (new Set(authorization.exactPaths).size !== authorization.exactPaths.length) return false;
  const normalized = normalizeChangedFiles(authorization.exactPaths);
  if (JSON.stringify(normalized) !== JSON.stringify(authorization.exactPaths)) return false;
  if (authorization.approvedChangedFileCount !== normalized.length) return false;
  if (authorization.approvedChangedFileSetSha256 !== changedFileSetSha256(normalized)) return false;
  return exactGovernanceClosed(authorization.governance);
}

function isValidOpenSourceWorkPackageAuthorizationReceipt(receipt, authorization, options = {}) {
  const authorizationPath = options.authorizationPath || OSS_AUTHORIZATION_PATH;
  if (!isValidOpenSourceWorkPackageAuthorization(authorization)) return false;
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) return false;
  if (receipt.schemaVersion !== 1) return false;
  if (receipt.documentType !== 'YANCE_OPEN_SOURCE_WORK_PACKAGE_AUTHORIZATION_RECEIPT') return false;
  if (receipt.program !== authorization.program || receipt.repository !== authorization.repository) return false;
  if (receipt.workPackage !== authorization.workPackage) return false;
  if (receipt.status !== 'SEALED_FOR_IMPLEMENTATION') return false;
  if (receipt.requiredBaseRef !== authorization.requiredBaseRef) return false;
  if (receipt.approvedParentHead !== authorization.approvedParentHead) return false;
  if (receipt.authorizedBranch !== authorization.authorizedBranch) return false;
  if (receipt.authorizationPath !== 'governance/open-source-acceleration/oss-0-implementation-authorization.json') return false;
  if (!/^[a-f0-9]{40}$/u.test(String(receipt.authorizationCommit || ''))) return false;
  if (!/^[a-f0-9]{40}$/u.test(String(receipt.authorizationBlobSha || ''))) return false;
  if (!/^[a-f0-9]{64}$/u.test(String(receipt.authorizationFileSha256 || ''))) return false;
  if (receipt.authorizationFileSha256 !== sha256File(authorizationPath)) return false;
  if (receipt.approvedChangedFileCount !== authorization.approvedChangedFileCount) return false;
  if (receipt.approvedChangedFileSetSha256 !== authorization.approvedChangedFileSetSha256) return false;
  if (receipt.governance?.authorizationPredatesImplementation !== true) return false;
  return exactGovernanceClosed(receipt.governance);
}

function resolveOpenSourceAuthorization(options = {}) {
  const authorization = Object.prototype.hasOwnProperty.call(options, 'authorization')
    ? options.authorization
    : loadOpenSourceWorkPackageAuthorization(options.authorizationPath || OSS_AUTHORIZATION_PATH);
  const receipt = Object.prototype.hasOwnProperty.call(options, 'receipt')
    ? options.receipt
    : loadOpenSourceWorkPackageAuthorizationReceipt(options.receiptPath || OSS_AUTHORIZATION_RECEIPT_PATH);
  return { authorization, receipt };
}

function isAuthorizedOpenSourceImplementationBranch(branch, options = {}) {
  const { authorization, receipt } = resolveOpenSourceAuthorization(options);
  return typeof branch === 'string'
    && branch === authorization?.authorizedBranch
    && isValidOpenSourceWorkPackageAuthorization(authorization)
    && isValidOpenSourceWorkPackageAuthorizationReceipt(receipt, authorization, options);
}

function authorizedOpenSourceImplementationBranchDescription(options = {}) {
  const { authorization, receipt } = resolveOpenSourceAuthorization(options);
  return isValidOpenSourceWorkPackageAuthorization(authorization)
    && isValidOpenSourceWorkPackageAuthorizationReceipt(receipt, authorization, options)
    ? `exact sealed open-source work-package branch ${authorization.authorizedBranch}`
    : 'no sealed open-source work-package branch';
}

function evaluateAuthorizedOpenSourceWorkPackageScope(options = {}) {
  const { authorization, receipt } = resolveOpenSourceAuthorization(options);
  const branch = String(options.branch || '');
  const rawChangedFiles = Array.isArray(options.changedFiles) ? options.changedFiles : [];
  const changedFiles = normalizeChangedFiles(rawChangedFiles);
  const changedFileSet = changedFileSetSha256(changedFiles);
  const invalidInput = rawChangedFiles.length !== changedFiles.length
    || rawChangedFiles.some(value => !isExactRepositoryPath(value));

  if (invalidInput) {
    return Object.freeze({
      pass: false,
      reasonCode: 'OSS_WORK_PACKAGE_CHANGED_PATH_INVALID',
      changedFileSetSha256: changedFileSet,
      unauthorizedPaths: rawChangedFiles,
      readyForPromotion: false
    });
  }
  if (!isAuthorizedOpenSourceImplementationBranch(branch, { ...options, authorization, receipt })) {
    return Object.freeze({
      pass: false,
      reasonCode: 'OSS_WORK_PACKAGE_AUTHORIZATION_INVALID',
      changedFileSetSha256: changedFileSet,
      unauthorizedPaths: changedFiles,
      readyForPromotion: false
    });
  }
  if (changedFiles.length !== authorization.approvedChangedFileCount
    || changedFileSet !== authorization.approvedChangedFileSetSha256) {
    return Object.freeze({
      pass: false,
      reasonCode: 'OSS_WORK_PACKAGE_CHANGED_FILE_SET_MISMATCH',
      changedFileSetSha256: changedFileSet,
      unauthorizedPaths: changedFiles.filter(file => !authorization.exactPaths.includes(file)),
      readyForPromotion: false
    });
  }
  const unauthorizedPaths = changedFiles.filter(file => !authorization.exactPaths.includes(file));
  return Object.freeze({
    pass: unauthorizedPaths.length === 0,
    reasonCode: unauthorizedPaths.length ? 'OSS_WORK_PACKAGE_SCOPE_VIOLATION' : null,
    workPackage: authorization.workPackage,
    branch,
    changedFileSetSha256: changedFileSet,
    changedFileCount: changedFiles.length,
    unauthorizedPaths,
    readyForPromotion: false
  });
}

module.exports = {
  OSS_AUTHORIZATION_PATH,
  OSS_AUTHORIZATION_RECEIPT_PATH,
  loadOpenSourceWorkPackageAuthorization,
  loadOpenSourceWorkPackageAuthorizationReceipt,
  normalizeRepositoryPath,
  changedFileSetSha256,
  isValidOpenSourceWorkPackageAuthorization,
  isValidOpenSourceWorkPackageAuthorizationReceipt,
  isAuthorizedOpenSourceImplementationBranch,
  authorizedOpenSourceImplementationBranchDescription,
  evaluateAuthorizedOpenSourceWorkPackageScope
};
