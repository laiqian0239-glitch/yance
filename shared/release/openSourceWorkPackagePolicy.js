'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const TRUSTED_POLICY_ROOT = path.resolve(__dirname, '..', '..');
const EVALUATED_REPOSITORY_ROOT = process.env.YANCE_EVALUATED_REPOSITORY_ROOT
  ? path.resolve(process.env.YANCE_EVALUATED_REPOSITORY_ROOT)
  : TRUSTED_POLICY_ROOT;
const SHA40 = /^[0-9a-f]{40}$/u;
const SHA64 = /^[0-9a-f]{64}$/u;
const WORK_PACKAGE = /^OSS-(?:[0-9]+[A-Z]?|[A-Z])$/u;
const PATH_CONTROL_OR_GLOB = /[\u0000-\u001f\u007f*?[\]]/u;
const OPEN_SOURCE_WORK_PACKAGE_REGISTRY_REPOSITORY_PATH =
  'governance/open-source-acceleration/open-source-work-package-registry.json';
const OPEN_SOURCE_WORK_PACKAGE_REGISTRY_PATH = repositoryFilePath(
  OPEN_SOURCE_WORK_PACKAGE_REGISTRY_REPOSITORY_PATH,
  TRUSTED_POLICY_ROOT
);

function loadJsonObject(filePath) {
  try {
    const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch (_) {
    return null;
  }
}

function normalizeRepositoryPath(value) {
  const candidate = String(value || '');
  if (!candidate
    || candidate !== candidate.trim()
    || candidate.startsWith('/')
    || candidate.startsWith('./')
    || candidate.endsWith('/')
    || candidate.includes('\\')
    || /^[A-Za-z]:\//u.test(candidate)
    || PATH_CONTROL_OR_GLOB.test(candidate)) return '';
  const segments = candidate.split('/');
  if (segments.some(segment => !segment || segment === '.' || segment === '..')) return '';
  return candidate;
}

function isExactRepositoryPath(value) {
  return Boolean(normalizeRepositoryPath(value));
}

function isExactBranchName(value) {
  const branch = String(value || '');
  if (!branch
    || branch !== branch.trim()
    || branch.startsWith('/')
    || branch.endsWith('/')
    || branch.includes('//')
    || /[\u0000-\u0020\u007f~^:?*[\]\\]/u.test(branch)) return false;
  return branch.split('/').every(segment => segment
    && segment !== '.'
    && segment !== '..'
    && !segment.endsWith('.lock'));
}

function repositoryFilePath(repositoryPath, repositoryRoot = TRUSTED_POLICY_ROOT) {
  const normalized = normalizeRepositoryPath(repositoryPath);
  return normalized
    ? path.join(path.resolve(repositoryRoot), ...normalized.split('/'))
    : '';
}

function normalizeChangedFiles(values) {
  if (!Array.isArray(values) || values.length === 0) return null;
  if (values.some(value => !isExactRepositoryPath(value))) return null;
  if (new Set(values).size !== values.length) return null;
  return [...values].sort();
}

function changedFileSetSha256(values) {
  const normalized = normalizeChangedFiles(values);
  if (!normalized) return null;
  return crypto
    .createHash('sha256')
    .update(`${normalized.join('\n')}\n`, 'utf8')
    .digest('hex');
}

function sha256File(filePath) {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  } catch (_) {
    return null;
  }
}

function repositoryGit(repositoryRoot, args, options = {}) {
  return execFileSync('git', args, {
    cwd: path.resolve(repositoryRoot || EVALUATED_REPOSITORY_ROOT),
    encoding: options.encoding === null ? null : options.encoding || 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

function defaultResolveCommitBlobSha(commit, repositoryPath, repositoryRoot) {
  try {
    const value = repositoryGit(
      repositoryRoot,
      ['rev-parse', `${commit}:${repositoryPath}`]
    ).trim();
    return SHA40.test(value) ? value : null;
  } catch (_) {
    return null;
  }
}

function defaultIsAncestor(base, head, repositoryRoot) {
  try {
    repositoryGit(repositoryRoot, ['merge-base', '--is-ancestor', base, head]);
    return true;
  } catch (_) {
    return false;
  }
}

function loadOpenSourceWorkPackageRegistry(
  filePath = OPEN_SOURCE_WORK_PACKAGE_REGISTRY_PATH
) {
  return loadJsonObject(filePath);
}

function loadOpenSourceWorkPackageAuthorization(filePath) {
  return filePath ? loadJsonObject(filePath) : null;
}

function loadOpenSourceWorkPackageAuthorizationReceipt(filePath) {
  return filePath ? loadJsonObject(filePath) : null;
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
    && WORK_PACKAGE.test(String(entry.workPackage || ''))
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
  const unique = field => new Set(registry.entries.map(entry => entry[field])).size
    === registry.entries.length;
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
  const paths = new Set([OPEN_SOURCE_WORK_PACKAGE_REGISTRY_REPOSITORY_PATH]);
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
  const parentPaths = new Set(openSourceParentGovernancePaths(options.registry));
  return values.filter(value => !parentPaths.has(value));
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
  if (!validRegistryEntry(entry)
    || !authorization
    || typeof authorization !== 'object'
    || Array.isArray(authorization)) return false;
  if (authorization.schemaVersion !== 1
    || authorization.documentType !== 'YANCE_OPEN_SOURCE_WORK_PACKAGE_AUTHORIZATION'
    || authorization.program !== 'Open Source Acceleration'
    || authorization.repository !== 'laiqian0239-glitch/yance'
    || authorization.workPackage !== entry.workPackage
    || authorization.status !== 'IMPLEMENTATION_AUTHORIZED'
    || authorization.authorizedBranch !== entry.authorizedBranch
    || !isExactBranchName(authorization.requiredBaseRef)
    || !SHA40.test(String(authorization.approvedParentHead || ''))
    || !isExactRepositoryPath(authorization.approvedPlanPath)
    || !SHA40.test(String(authorization.approvedPlanHead || ''))
    || !Array.isArray(authorization.exactPaths)
    || authorization.exactPaths.length === 0) return false;
  const exactPaths = normalizeChangedFiles(authorization.exactPaths);
  if (!exactPaths
    || JSON.stringify(exactPaths) !== JSON.stringify(authorization.exactPaths)
    || authorization.approvedChangedFileCount !== exactPaths.length
    || authorization.approvedChangedFileSetSha256 !== changedFileSetSha256(exactPaths)) return false;
  return exactGovernanceClosed(authorization.governance);
}

function isValidOpenSourceWorkPackageAuthorizationReceiptForEntry(
  receipt,
  authorization,
  entry,
  options = {}
) {
  if (!isValidOpenSourceWorkPackageAuthorizationForEntry(authorization, entry)
    || !receipt
    || typeof receipt !== 'object'
    || Array.isArray(receipt)) return false;
  if (receipt.schemaVersion !== 1
    || receipt.documentType !== 'YANCE_OPEN_SOURCE_WORK_PACKAGE_AUTHORIZATION_RECEIPT'
    || receipt.program !== authorization.program
    || receipt.repository !== authorization.repository
    || receipt.workPackage !== authorization.workPackage
    || receipt.status !== 'SEALED_FOR_IMPLEMENTATION'
    || receipt.requiredBaseRef !== authorization.requiredBaseRef
    || receipt.approvedParentHead !== authorization.approvedParentHead
    || receipt.authorizedBranch !== authorization.authorizedBranch
    || receipt.authorizationPath !== entry.authorizationPath
    || receipt.approvedPlanPath !== authorization.approvedPlanPath
    || receipt.approvedPlanHead !== authorization.approvedPlanHead
    || !SHA40.test(String(receipt.authorizationCommit || ''))
    || !SHA40.test(String(receipt.authorizationBlobSha || ''))
    || !SHA64.test(String(receipt.authorizationFileSha256 || ''))
    || !SHA40.test(String(receipt.implementationBaseCommit || ''))
    || receipt.approvedChangedFileCount !== authorization.approvedChangedFileCount
    || receipt.approvedChangedFileSetSha256 !== authorization.approvedChangedFileSetSha256
    || receipt.governance?.authorizationPredatesImplementation !== true
    || !exactGovernanceClosed(receipt.governance)) return false;

  const trustedAuthorizationPath = options.authorizationPath
    || repositoryFilePath(entry.authorizationPath, options.trustedPolicyRoot || TRUSTED_POLICY_ROOT);
  const expectedFileSha = Object.prototype.hasOwnProperty.call(options, 'authorizationFileSha256')
    ? options.authorizationFileSha256
    : sha256File(trustedAuthorizationPath);
  if (receipt.authorizationFileSha256 !== expectedFileSha) return false;

  const repositoryRoot = options.repositoryRoot || EVALUATED_REPOSITORY_ROOT;
  const resolveCommitBlobSha = options.resolveCommitBlobSha
    || ((commit, repositoryPath) => defaultResolveCommitBlobSha(
      commit,
      repositoryPath,
      repositoryRoot
    ));
  if (resolveCommitBlobSha(receipt.authorizationCommit, entry.authorizationPath)
    !== receipt.authorizationBlobSha) return false;

  const isAncestor = options.isAncestor
    || ((base, head) => defaultIsAncestor(base, head, repositoryRoot));
  return isAncestor(receipt.authorizationCommit, receipt.implementationBaseCommit) === true;
}

function loadRegistryEntryRecord(entry, options = {}) {
  if (!validRegistryEntry(entry)) return { entry: null, authorization: null, receipt: null };
  const trustedPolicyRoot = options.trustedPolicyRoot || TRUSTED_POLICY_ROOT;
  const evaluatedRepositoryRoot = options.repositoryRoot || EVALUATED_REPOSITORY_ROOT;
  const authorization = options.authorizationByPath?.[entry.authorizationPath]
    ?? options.loadAuthorization?.(entry)
    ?? loadOpenSourceWorkPackageAuthorization(
      repositoryFilePath(entry.authorizationPath, trustedPolicyRoot)
    );
  const receipt = options.receiptByPath?.[entry.receiptPath]
    ?? options.loadReceipt?.(entry)
    ?? loadOpenSourceWorkPackageAuthorizationReceipt(
      repositoryFilePath(entry.receiptPath, evaluatedRepositoryRoot)
    );
  return { entry, authorization, receipt };
}

function resolveOpenSourceAuthorizationForBranch(branch, options = {}) {
  const registry = Object.prototype.hasOwnProperty.call(options, 'registry')
    ? options.registry
    : loadOpenSourceWorkPackageRegistry(
      options.registryPath
      || repositoryFilePath(
        OPEN_SOURCE_WORK_PACKAGE_REGISTRY_REPOSITORY_PATH,
        options.trustedPolicyRoot || TRUSTED_POLICY_ROOT
      )
    );
  const entry = selectOpenSourceWorkPackageRegistryEntry(registry, branch);
  if (!entry) return { registry, entry: null, authorization: null, receipt: null };
  return { registry, ...loadRegistryEntryRecord(entry, options) };
}

function isAuthorizedOpenSourceImplementationBranch(branch, options = {}) {
  const resolved = Object.prototype.hasOwnProperty.call(options, 'authorization')
    || Object.prototype.hasOwnProperty.call(options, 'receipt')
    ? {
      registry: options.registry,
      entry: options.entry
        || selectOpenSourceWorkPackageRegistryEntry(options.registry, branch),
      authorization: options.authorization,
      receipt: options.receipt
    }
    : resolveOpenSourceAuthorizationForBranch(branch, options);
  return typeof branch === 'string'
    && branch === resolved.authorization?.authorizedBranch
    && isValidOpenSourceWorkPackageAuthorizationForEntry(
      resolved.authorization,
      resolved.entry
    )
    && isValidOpenSourceWorkPackageAuthorizationReceiptForEntry(
      resolved.receipt,
      resolved.authorization,
      resolved.entry,
      options
    );
}

function authorizedOpenSourceImplementationBranchDescription(options = {}) {
  const branch = String(options.branch || '');
  const resolved = resolveOpenSourceAuthorizationForBranch(branch, options);
  return isAuthorizedOpenSourceImplementationBranch(branch, {
    ...options,
    ...resolved
  })
    ? `exact sealed open-source work-package branch ${branch}`
    : 'no sealed open-source work-package branch';
}

function evaluateAuthorizedOpenSourceWorkPackageScope(options = {}) {
  const branch = String(options.branch || '');
  const rawChangedFiles = Array.isArray(options.changedFiles) ? options.changedFiles : [];
  const changedFiles = normalizeChangedFiles(rawChangedFiles);
  const resolved = Object.prototype.hasOwnProperty.call(options, 'authorization')
    || Object.prototype.hasOwnProperty.call(options, 'receipt')
    ? {
      registry: options.registry,
      entry: options.entry
        || selectOpenSourceWorkPackageRegistryEntry(options.registry, branch),
      authorization: options.authorization,
      receipt: options.receipt
    }
    : resolveOpenSourceAuthorizationForBranch(branch, options);
  const digest = changedFiles ? changedFileSetSha256(changedFiles) : null;

  if (!changedFiles || rawChangedFiles.length !== changedFiles.length) {
    return Object.freeze({
      pass: false,
      reasonCode: 'OSS_WORK_PACKAGE_CHANGED_PATH_INVALID',
      changedFileSetSha256: digest,
      unauthorizedPaths: rawChangedFiles,
      readyForPromotion: false
    });
  }
  if (!isAuthorizedOpenSourceImplementationBranch(branch, {
    ...options,
    ...resolved
  })) {
    return Object.freeze({
      pass: false,
      reasonCode: 'OSS_WORK_PACKAGE_AUTHORIZATION_INVALID',
      changedFileSetSha256: digest,
      unauthorizedPaths: changedFiles,
      readyForPromotion: false
    });
  }
  const authorization = resolved.authorization;
  const unauthorizedPaths = changedFiles.filter(file => !authorization.exactPaths.includes(file));
  if (changedFiles.length !== authorization.approvedChangedFileCount
    || digest !== authorization.approvedChangedFileSetSha256) {
    return Object.freeze({
      pass: false,
      reasonCode: 'OSS_WORK_PACKAGE_CHANGED_FILE_SET_MISMATCH',
      changedFileSetSha256: digest,
      unauthorizedPaths,
      readyForPromotion: false
    });
  }
  return Object.freeze({
    pass: unauthorizedPaths.length === 0,
    reasonCode: unauthorizedPaths.length ? 'OSS_WORK_PACKAGE_SCOPE_VIOLATION' : null,
    workPackage: authorization.workPackage,
    branch,
    changedFileSetSha256: digest,
    changedFileCount: changedFiles.length,
    unauthorizedPaths,
    readyForPromotion: false
  });
}

module.exports = Object.freeze({
  TRUSTED_POLICY_ROOT,
  EVALUATED_REPOSITORY_ROOT,
  OPEN_SOURCE_WORK_PACKAGE_REGISTRY_REPOSITORY_PATH,
  OPEN_SOURCE_WORK_PACKAGE_REGISTRY_PATH,
  repositoryFilePath,
  normalizeRepositoryPath,
  normalizeChangedFiles,
  changedFileSetSha256,
  loadOpenSourceWorkPackageRegistry,
  loadOpenSourceWorkPackageAuthorization,
  loadOpenSourceWorkPackageAuthorizationReceipt,
  validateOpenSourceWorkPackageRegistry,
  selectOpenSourceWorkPackageRegistryEntry,
  openSourceParentGovernancePaths,
  filterOpenSourceImplementationChangedFiles,
  isValidOpenSourceWorkPackageAuthorizationForEntry,
  isValidOpenSourceWorkPackageAuthorizationReceiptForEntry,
  resolveOpenSourceAuthorizationForBranch,
  isAuthorizedOpenSourceImplementationBranch,
  authorizedOpenSourceImplementationBranchDescription,
  evaluateAuthorizedOpenSourceWorkPackageScope
});