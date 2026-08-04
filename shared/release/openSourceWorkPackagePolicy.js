'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const OPEN_SOURCE_WORK_PACKAGE_REGISTRY_REPOSITORY_PATH = 'governance/open-source-acceleration/open-source-work-package-registry.json';
const OSS_AUTHORIZATION_REPOSITORY_PATH = 'governance/open-source-acceleration/oss-0-implementation-authorization.json';
const OSS_AUTHORIZATION_RECEIPT_REPOSITORY_PATH = 'governance/open-source-acceleration/oss-0-authorization-receipt.json';
const OSS1A_AUTHORIZATION_REPOSITORY_PATH = 'governance/open-source-acceleration/oss-1a-implementation-authorization.json';
const OSS1A_AUTHORIZATION_RECEIPT_REPOSITORY_PATH = 'governance/open-source-acceleration/oss-1a-authorization-receipt.json';
const OPEN_SOURCE_WORK_PACKAGE_REGISTRY_PATH = path.join(REPO_ROOT, ...OPEN_SOURCE_WORK_PACKAGE_REGISTRY_REPOSITORY_PATH.split('/'));
const OSS_AUTHORIZATION_PATH = path.join(REPO_ROOT, ...OSS_AUTHORIZATION_REPOSITORY_PATH.split('/'));
const OSS_AUTHORIZATION_RECEIPT_PATH = path.join(REPO_ROOT, ...OSS_AUTHORIZATION_RECEIPT_REPOSITORY_PATH.split('/'));

const OSS0_REGISTRY_ENTRY = Object.freeze({
  workPackage: 'OSS-0',
  authorizedBranch: 'oss/0-provenance-foundation',
  authorizationPath: OSS_AUTHORIZATION_REPOSITORY_PATH,
  receiptPath: OSS_AUTHORIZATION_RECEIPT_REPOSITORY_PATH
});

const OSS_PARENT_GOVERNANCE_PATHS = Object.freeze([
  OPEN_SOURCE_WORK_PACKAGE_REGISTRY_REPOSITORY_PATH,
  OSS_AUTHORIZATION_REPOSITORY_PATH,
  OSS_AUTHORIZATION_RECEIPT_REPOSITORY_PATH,
  OSS1A_AUTHORIZATION_REPOSITORY_PATH,
  OSS1A_AUTHORIZATION_RECEIPT_REPOSITORY_PATH
]);

function loadJsonObject(filePath) {
  try {
    const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch (_) {
    return null;
  }
}

function repositoryFilePath(repositoryPath) {
  const normalized = normalizeRepositoryPath(repositoryPath);
  return normalized ? path.join(REPO_ROOT, ...normalized.split('/')) : '';
}

function loadOpenSourceWorkPackageRegistry(filePath = OPEN_SOURCE_WORK_PACKAGE_REGISTRY_PATH) {
  return loadJsonObject(filePath);
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
  if (!normalized
    || normalized.startsWith('/')
    || /^[A-Za-z]:\//u.test(normalized)
    || /[\r\n]/u.test(normalized)) return '';
  const segments = normalized.split('/');
  if (segments.some(segment => !segment || segment === '.' || segment === '..')) return '';
  return normalized;
}

function isExactRepositoryPath(value) {
  const normalized = normalizeRepositoryPath(value);
  return Boolean(normalized && normalized === value && !/[*?[\]]/u.test(normalized));
}

function isExactBranchName(value) {
  const branch = String(value || '');
  if (!branch
    || branch !== branch.trim()
    || branch.startsWith('/')
    || branch.endsWith('/')
    || branch.includes('//')
    || /[\x00-\x20\x7f~^:?*\[\]\\]/u.test(branch)) return false;
  const segments = branch.split('/');
  return segments.every(segment => segment && segment !== '.' && segment !== '..' && !segment.endsWith('.lock'));
}

function normalizeChangedFiles(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map(normalizeRepositoryPath).filter(Boolean))].sort();
}

function registryGovernanceClosed(governance) {
  return governance?.explicitEntriesOnly === true
    && governance?.directoryAutoDiscoveryAllowed === false
    && governance?.exactBranchSelectionOnly === true
    && governance?.multipleMatchesFailClosed === true
    && governance?.automaticNextWorkPackageAuthorization === false
    && governance?.readyForPromotion === false;
}

function validRegistryEntry(entry) {
  return Boolean(entry
    && typeof entry === 'object'
    && !Array.isArray(entry)
    && /^OSS-[0-9]+[A-Z]?$/u.test(String(entry.workPackage || ''))
    && isExactBranchName(entry.authorizedBranch)
    && isExactRepositoryPath(entry.authorizationPath)
    && isExactRepositoryPath(entry.receiptPath)
    && entry.authorizationPath.startsWith('governance/open-source-acceleration/')
    && entry.receiptPath.startsWith('governance/open-source-acceleration/')
    && entry.authorizationPath.endsWith('.json')
    && entry.receiptPath.endsWith('.json')
    && entry.authorizationPath !== entry.receiptPath);
}

function validateOpenSourceWorkPackageRegistry(registry) {
  if (!registry || typeof registry !== 'object' || Array.isArray(registry)) return false;
  if (registry.schemaVersion !== 1
    || registry.documentType !== 'YANCE_OPEN_SOURCE_WORK_PACKAGE_REGISTRY'
    || registry.program !== 'Open Source Acceleration'
    || registry.repository !== 'laiqian0239-glitch/yance'
    || !Array.isArray(registry.entries)
    || registry.entries.length === 0
    || !registry.entries.every(validRegistryEntry)
    || !registryGovernanceClosed(registry.governance)) return false;

  const unique = field => new Set(registry.entries.map(entry => entry[field])).size === registry.entries.length;
  return unique('workPackage')
    && unique('authorizedBranch')
    && unique('authorizationPath')
    && unique('receiptPath');
}

function selectOpenSourceWorkPackageRegistryEntry(registry, branch) {
  if (!validateOpenSourceWorkPackageRegistry(registry) || !isExactBranchName(branch)) return null;
  const matches = registry.entries.filter(entry => entry.authorizedBranch === branch);
  return matches.length === 1 ? matches[0] : null;
}

function openSourceParentGovernancePaths(registry = loadOpenSourceWorkPackageRegistry()) {
  const paths = new Set(OSS_PARENT_GOVERNANCE_PATHS);
  if (validateOpenSourceWorkPackageRegistry(registry)) {
    for (const entry of registry.entries) {
      paths.add(entry.authorizationPath);
      paths.add(entry.receiptPath);
    }
  }
  return Object.freeze([...paths].sort());
}

function filterOpenSourceImplementationChangedFiles(values, options = {}) {
  if (!Array.isArray(values)) return [];
  const parentGovernancePaths = new Set(openSourceParentGovernancePaths(options.registry));
  return values.filter(value => !parentGovernancePaths.has(value));
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

function isValidOpenSourceWorkPackageAuthorizationForEntry(authorization, entry) {
  if (!validRegistryEntry(entry)) return false;
  if (!authorization || typeof authorization !== 'object' || Array.isArray(authorization)) return false;
  if (authorization.schemaVersion !== 1) return false;
  if (authorization.documentType !== 'YANCE_OPEN_SOURCE_WORK_PACKAGE_AUTHORIZATION') return false;
  if (authorization.program !== 'Open Source Acceleration') return false;
  if (authorization.repository !== 'laiqian0239-glitch/yance') return false;
  if (authorization.workPackage !== entry.workPackage) return false;
  if (authorization.status !== 'IMPLEMENTATION_AUTHORIZED') return false;
  if (authorization.authorizedBranch !== entry.authorizedBranch) return false;
  if (!isExactBranchName(authorization.requiredBaseRef)) return false;
  if (!/^[a-f0-9]{40}$/u.test(String(authorization.approvedParentHead || ''))) return false;
  if (!isExactRepositoryPath(authorization.approvedPlanPath)) return false;
  if (Object.prototype.hasOwnProperty.call(authorization, 'approvedPlanHead')
    && !/^[a-f0-9]{40}$/u.test(String(authorization.approvedPlanHead || ''))) return false;
  if (!Array.isArray(authorization.exactPaths) || authorization.exactPaths.length === 0) return false;
  if (!authorization.exactPaths.every(isExactRepositoryPath)) return false;
  if (new Set(authorization.exactPaths).size !== authorization.exactPaths.length) return false;
  const normalized = normalizeChangedFiles(authorization.exactPaths);
  if (JSON.stringify(normalized) !== JSON.stringify(authorization.exactPaths)) return false;
  if (authorization.approvedChangedFileCount !== normalized.length) return false;
  if (authorization.approvedChangedFileSetSha256 !== changedFileSetSha256(normalized)) return false;
  return exactGovernanceClosed(authorization.governance);
}

function isValidOpenSourceWorkPackageAuthorization(authorization) {
  return isValidOpenSourceWorkPackageAuthorizationForEntry(authorization, OSS0_REGISTRY_ENTRY);
}

function isValidOpenSourceWorkPackageAuthorizationReceiptForEntry(receipt, authorization, entry, options = {}) {
  if (!isValidOpenSourceWorkPackageAuthorizationForEntry(authorization, entry)) return false;
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) return false;
  if (receipt.schemaVersion !== 1) return false;
  if (receipt.documentType !== 'YANCE_OPEN_SOURCE_WORK_PACKAGE_AUTHORIZATION_RECEIPT') return false;
  if (receipt.program !== authorization.program || receipt.repository !== authorization.repository) return false;
  if (receipt.workPackage !== authorization.workPackage) return false;
  if (receipt.status !== 'SEALED_FOR_IMPLEMENTATION') return false;
  if (receipt.requiredBaseRef !== authorization.requiredBaseRef) return false;
  if (receipt.approvedParentHead !== authorization.approvedParentHead) return false;
  if (receipt.authorizedBranch !== authorization.authorizedBranch) return false;
  if (receipt.authorizationPath !== entry.authorizationPath) return false;
  if (receipt.approvedPlanPath !== undefined && receipt.approvedPlanPath !== authorization.approvedPlanPath) return false;
  if (authorization.approvedPlanHead !== undefined && receipt.approvedPlanHead !== authorization.approvedPlanHead) return false;
  if (!/^[a-f0-9]{40}$/u.test(String(receipt.authorizationCommit || ''))) return false;
  if (!/^[a-f0-9]{40}$/u.test(String(receipt.authorizationBlobSha || ''))) return false;
  if (!/^[a-f0-9]{64}$/u.test(String(receipt.authorizationFileSha256 || ''))) return false;

  const expectedFileSha256 = Object.prototype.hasOwnProperty.call(options, 'authorizationFileSha256')
    ? options.authorizationFileSha256
    : sha256File(options.authorizationPath || repositoryFilePath(entry.authorizationPath));
  if (receipt.authorizationFileSha256 !== expectedFileSha256) return false;
  if (receipt.approvedChangedFileCount !== authorization.approvedChangedFileCount) return false;
  if (receipt.approvedChangedFileSetSha256 !== authorization.approvedChangedFileSetSha256) return false;
  if (receipt.governance?.authorizationPredatesImplementation !== true) return false;
  return exactGovernanceClosed(receipt.governance);
}

function isValidOpenSourceWorkPackageAuthorizationReceipt(receipt, authorization, options = {}) {
  return isValidOpenSourceWorkPackageAuthorizationReceiptForEntry(
    receipt,
    authorization,
    OSS0_REGISTRY_ENTRY,
    {
      ...options,
      authorizationPath: options.authorizationPath || OSS_AUTHORIZATION_PATH
    }
  );
}

function loadRegistryEntryRecord(entry, options = {}) {
  if (!validRegistryEntry(entry)) return { entry: null, authorization: null, receipt: null };
  const authorization = options.authorizationByPath?.[entry.authorizationPath]
    ?? options.loadAuthorization?.(entry)
    ?? loadJsonObject(repositoryFilePath(entry.authorizationPath));
  const receipt = options.receiptByPath?.[entry.receiptPath]
    ?? options.loadReceipt?.(entry)
    ?? loadJsonObject(repositoryFilePath(entry.receiptPath));
  return { entry, authorization, receipt };
}

function resolveOpenSourceAuthorizationForBranch(branch, options = {}) {
  const registry = Object.prototype.hasOwnProperty.call(options, 'registry')
    ? options.registry
    : loadOpenSourceWorkPackageRegistry(options.registryPath || OPEN_SOURCE_WORK_PACKAGE_REGISTRY_PATH);
  const entry = selectOpenSourceWorkPackageRegistryEntry(registry, branch);
  if (!entry) return { registry, entry: null, authorization: null, receipt: null };
  return { registry, ...loadRegistryEntryRecord(entry, options) };
}

function resolveOpenSourceAuthorization(options = {}) {
  if (typeof options.branch === 'string' && options.branch) {
    return resolveOpenSourceAuthorizationForBranch(options.branch, options);
  }
  const authorization = Object.prototype.hasOwnProperty.call(options, 'authorization')
    ? options.authorization
    : loadOpenSourceWorkPackageAuthorization(options.authorizationPath || OSS_AUTHORIZATION_PATH);
  const receipt = Object.prototype.hasOwnProperty.call(options, 'receipt')
    ? options.receipt
    : loadOpenSourceWorkPackageAuthorizationReceipt(options.receiptPath || OSS_AUTHORIZATION_RECEIPT_PATH);
  return { entry: OSS0_REGISTRY_ENTRY, authorization, receipt };
}

function registryEntryForAuthorization(branch, authorization, options = {}) {
  if (options.entry) return options.entry;
  if (authorization?.workPackage === OSS0_REGISTRY_ENTRY.workPackage
    && branch === OSS0_REGISTRY_ENTRY.authorizedBranch) return OSS0_REGISTRY_ENTRY;
  const registry = Object.prototype.hasOwnProperty.call(options, 'registry')
    ? options.registry
    : loadOpenSourceWorkPackageRegistry(options.registryPath || OPEN_SOURCE_WORK_PACKAGE_REGISTRY_PATH);
  return selectOpenSourceWorkPackageRegistryEntry(registry, branch);
}

function isAuthorizedOpenSourceImplementationBranch(branch, options = {}) {
  const resolved = Object.prototype.hasOwnProperty.call(options, 'authorization')
    || Object.prototype.hasOwnProperty.call(options, 'receipt')
    ? {
      authorization: options.authorization,
      receipt: options.receipt,
      entry: registryEntryForAuthorization(branch, options.authorization, options)
    }
    : resolveOpenSourceAuthorizationForBranch(branch, options);

  return typeof branch === 'string'
    && branch === resolved.authorization?.authorizedBranch
    && isValidOpenSourceWorkPackageAuthorizationForEntry(resolved.authorization, resolved.entry)
    && isValidOpenSourceWorkPackageAuthorizationReceiptForEntry(
      resolved.receipt,
      resolved.authorization,
      resolved.entry,
      options
    );
}

function authorizedOpenSourceImplementationBranchDescription(options = {}) {
  const branch = String(options.branch || OSS0_REGISTRY_ENTRY.authorizedBranch);
  const resolved = Object.prototype.hasOwnProperty.call(options, 'authorization')
    || Object.prototype.hasOwnProperty.call(options, 'receipt')
    ? {
      authorization: options.authorization,
      receipt: options.receipt,
      entry: registryEntryForAuthorization(branch, options.authorization, options)
    }
    : resolveOpenSourceAuthorizationForBranch(branch, options);
  return isValidOpenSourceWorkPackageAuthorizationForEntry(resolved.authorization, resolved.entry)
    && isValidOpenSourceWorkPackageAuthorizationReceiptForEntry(
      resolved.receipt,
      resolved.authorization,
      resolved.entry,
      options
    )
    ? `exact sealed open-source work-package branch ${resolved.authorization.authorizedBranch}`
    : 'no sealed open-source work-package branch';
}

function evaluateAuthorizedOpenSourceWorkPackageScope(options = {}) {
  const authorization = options.authorization;
  const receipt = options.receipt;
  const branch = String(options.branch || '');
  const entry = registryEntryForAuthorization(branch, authorization, options);
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
  if (!isAuthorizedOpenSourceImplementationBranch(branch, {
    ...options,
    authorization,
    receipt,
    entry
  })) {
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
  OPEN_SOURCE_WORK_PACKAGE_REGISTRY_REPOSITORY_PATH,
  OPEN_SOURCE_WORK_PACKAGE_REGISTRY_PATH,
  OSS_AUTHORIZATION_REPOSITORY_PATH,
  OSS_AUTHORIZATION_RECEIPT_REPOSITORY_PATH,
  OSS_AUTHORIZATION_PATH,
  OSS_AUTHORIZATION_RECEIPT_PATH,
  OSS_PARENT_GOVERNANCE_PATHS,
  loadOpenSourceWorkPackageRegistry,
  loadOpenSourceWorkPackageAuthorization,
  loadOpenSourceWorkPackageAuthorizationReceipt,
  normalizeRepositoryPath,
  openSourceParentGovernancePaths,
  filterOpenSourceImplementationChangedFiles,
  changedFileSetSha256,
  validateOpenSourceWorkPackageRegistry,
  selectOpenSourceWorkPackageRegistryEntry,
  isValidOpenSourceWorkPackageAuthorizationForEntry,
  isValidOpenSourceWorkPackageAuthorizationReceiptForEntry,
  isValidOpenSourceWorkPackageAuthorization,
  isValidOpenSourceWorkPackageAuthorizationReceipt,
  resolveOpenSourceAuthorizationForBranch,
  isAuthorizedOpenSourceImplementationBranch,
  authorizedOpenSourceImplementationBranchDescription,
  evaluateAuthorizedOpenSourceWorkPackageScope
};
