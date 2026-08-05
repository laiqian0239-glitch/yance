'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const TRUSTED_POLICY_ROOT = path.resolve(__dirname, '..', '..');
const EVALUATED_REPOSITORY_ROOT = process.env.YANCE_EVALUATED_REPOSITORY_ROOT
  ? path.resolve(process.env.YANCE_EVALUATED_REPOSITORY_ROOT)
  : TRUSTED_POLICY_ROOT;
const REGISTRY_REPOSITORY_PATH = 'governance/open-source-acceleration/open-source-work-package-registry.json';
const SHA40 = /^[0-9a-f]{40}$/u;
const SHA64 = /^[0-9a-f]{64}$/u;
const WORK_PACKAGE = /^OSS-(?:[0-9]+[A-Z]?|[A-Z])$/u;
const PATH_CONTROL_OR_GLOB = /[\u0000-\u001f\u007f*?[\]]/u;

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
  const parts = candidate.split('/');
  return parts.some(part => !part || part === '.' || part === '..') ? '' : candidate;
}

function repositoryFilePath(repositoryPath, root = TRUSTED_POLICY_ROOT) {
  const exact = normalizeRepositoryPath(repositoryPath);
  return exact ? path.join(path.resolve(root), ...exact.split('/')) : '';
}

const OPEN_SOURCE_WORK_PACKAGE_REGISTRY_REPOSITORY_PATH = REGISTRY_REPOSITORY_PATH;
const OPEN_SOURCE_WORK_PACKAGE_REGISTRY_PATH = repositoryFilePath(
  REGISTRY_REPOSITORY_PATH,
  TRUSTED_POLICY_ROOT
);

function loadJson(filePath) {
  try {
    const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch (_) {
    return null;
  }
}

function exactBranch(value) {
  const branch = String(value || '');
  return Boolean(branch
    && branch === branch.trim()
    && !branch.startsWith('/')
    && !branch.endsWith('/')
    && !branch.includes('//')
    && !/[\u0000-\u0020\u007f~^:?*[\]\\]/u.test(branch)
    && branch.split('/').every(part => part && part !== '.' && part !== '..' && !part.endsWith('.lock')));
}

function normalizeChangedFiles(values) {
  if (!Array.isArray(values) || values.length === 0) return null;
  if (values.some(value => normalizeRepositoryPath(value) !== value)) return null;
  if (new Set(values).size !== values.length) return null;
  return [...values].sort();
}

function changedFileSetSha256(values) {
  const exact = normalizeChangedFiles(values);
  return exact
    ? crypto.createHash('sha256').update(`${exact.join('\n')}\n`, 'utf8').digest('hex')
    : null;
}

function sha256File(filePath) {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  } catch (_) {
    return null;
  }
}

function repositoryGit(root, args, options = {}) {
  return execFileSync('git', args, {
    cwd: path.resolve(root || EVALUATED_REPOSITORY_ROOT),
    encoding: options.encoding === null ? null : options.encoding || 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

function gitSha(root, args) {
  try {
    const value = repositoryGit(root, args).trim();
    return SHA40.test(value) ? value : null;
  } catch (_) {
    return null;
  }
}

function defaultBlob(commit, repositoryPath, root) {
  return gitSha(root, ['rev-parse', `${commit}:${repositoryPath}`]);
}

function defaultParents(commit, root) {
  try {
    const row = repositoryGit(root, ['rev-list', '--parents', '-n', '1', commit])
      .trim()
      .split(/\s+/u);
    return row.length === 3 && row[0] === commit && row.slice(1).every(value => SHA40.test(value))
      ? row.slice(1)
      : [];
  } catch (_) {
    return [];
  }
}

function defaultHead(root) {
  return gitSha(root, ['rev-parse', 'HEAD']);
}

function defaultAncestor(base, head, root) {
  try {
    repositoryGit(root, ['merge-base', '--is-ancestor', base, head]);
    return true;
  } catch (_) {
    return false;
  }
}

function loadOpenSourceWorkPackageRegistry(filePath = OPEN_SOURCE_WORK_PACKAGE_REGISTRY_PATH) {
  return loadJson(filePath);
}
function loadOpenSourceWorkPackageAuthorization(filePath) {
  return filePath ? loadJson(filePath) : null;
}
function loadOpenSourceWorkPackageAuthorizationReceipt(filePath) {
  return filePath ? loadJson(filePath) : null;
}

function registryGovernanceClosed(value) {
  return value?.explicitEntriesOnly === true
    && value?.directoryAutoDiscoveryAllowed === false
    && value?.exactBranchSelectionOnly === true
    && value?.multipleMatchesFailClosed === true
    && value?.automaticNextWorkPackageAuthorization === false
    && value?.readyForPromotion === false;
}

function validEntry(entry) {
  return Boolean(entry
    && typeof entry === 'object'
    && !Array.isArray(entry)
    && WORK_PACKAGE.test(String(entry.workPackage || ''))
    && exactBranch(entry.authorizedBranch)
    && normalizeRepositoryPath(entry.authorizationPath) === entry.authorizationPath
    && normalizeRepositoryPath(entry.receiptPath) === entry.receiptPath
    && entry.authorizationPath.startsWith('governance/open-source-acceleration/')
    && entry.receiptPath.startsWith('governance/open-source-acceleration/')
    && entry.authorizationPath.endsWith('.json')
    && entry.receiptPath.endsWith('.json')
    && entry.authorizationPath !== entry.receiptPath);
}

function validateOpenSourceWorkPackageRegistry(registry) {
  if (!registry
    || registry.schemaVersion !== 1
    || registry.documentType !== 'YANCE_OPEN_SOURCE_WORK_PACKAGE_REGISTRY'
    || registry.program !== 'Open Source Acceleration'
    || registry.repository !== 'laiqian0239-glitch/yance'
    || !Array.isArray(registry.entries)
    || registry.entries.length === 0
    || !registry.entries.every(validEntry)
    || !registryGovernanceClosed(registry.governance)) return false;
  return ['workPackage', 'authorizedBranch', 'authorizationPath', 'receiptPath']
    .every(field => new Set(registry.entries.map(entry => entry[field])).size === registry.entries.length);
}

function selectOpenSourceWorkPackageRegistryEntry(registry, branch) {
  if (!validateOpenSourceWorkPackageRegistry(registry) || !exactBranch(branch)) return null;
  const matches = registry.entries.filter(entry => entry.authorizedBranch === branch);
  return matches.length === 1 ? matches[0] : null;
}

function openSourceParentGovernancePaths(registry = loadOpenSourceWorkPackageRegistry()) {
  const values = new Set([REGISTRY_REPOSITORY_PATH]);
  if (validateOpenSourceWorkPackageRegistry(registry)) {
    for (const entry of registry.entries) {
      values.add(entry.authorizationPath);
      values.add(entry.receiptPath);
    }
  }
  return Object.freeze([...values].sort());
}

function registryContains(registry, entry) {
  return validateOpenSourceWorkPackageRegistry(registry)
    && validEntry(entry)
    && registry.entries.some(value => ['workPackage', 'authorizedBranch', 'authorizationPath', 'receiptPath']
      .every(field => value[field] === entry[field]));
}

function filterOpenSourceImplementationChangedFiles(values, options = {}) {
  if (!Array.isArray(values)) return [];
  if (!registryContains(options.registry, options.entry)) return [...values];
  return values.filter(value => value !== options.entry.receiptPath);
}

function exactGovernanceClosed(value) {
  return value?.exactPathScopeOnly === true
    && value?.wildcardExpansionAllowed === false
    && value?.prMustRemainDraft === true
    && value?.mergeIntoMainAuthorized === false
    && value?.productionUseAuthorized === false
    && value?.formalRelease === false
    && value?.publish === false
    && value?.automaticNextWorkPackageAuthorization === false
    && value?.temporaryBypassAllowed === false
    && value?.warningOnlyClosureAllowed === false
    && value?.readyForPromotion === false;
}

function validAuthorizationSeal(seal) {
  return Boolean(seal
    && typeof seal === 'object'
    && !Array.isArray(seal)
    && seal.status === 'SEALED_AFTER_TRUSTED_MERGE'
    && Number.isInteger(seal.pullRequest)
    && seal.pullRequest > 0
    && [seal.authorizationCommit, seal.mergeFirstParent, seal.mergeSecondParent,
      seal.reviewedHead, seal.authorizationBlobSha].every(value => SHA40.test(String(value || '')))
    && seal.mergeSecondParent === seal.reviewedHead
    && seal.mergeFirstParent !== seal.mergeSecondParent
    && Number.isInteger(seal.independentReviewId)
    && seal.independentReviewId > 0
    && seal.independentReviewDecision === 'ALLOW_MERGE'
    && seal.p0Count === 0
    && seal.p1Count === 0);
}

function isValidOpenSourceWorkPackageAuthorizationForEntry(authorization, entry) {
  if (!validEntry(entry)
    || !authorization
    || authorization.schemaVersion !== 1
    || authorization.documentType !== 'YANCE_OPEN_SOURCE_WORK_PACKAGE_AUTHORIZATION'
    || authorization.program !== 'Open Source Acceleration'
    || authorization.repository !== 'laiqian0239-glitch/yance'
    || authorization.workPackage !== entry.workPackage
    || authorization.status !== 'IMPLEMENTATION_AUTHORIZED'
    || authorization.authorizedBranch !== entry.authorizedBranch
    || !exactBranch(authorization.requiredBaseRef)
    || !SHA40.test(String(authorization.approvedParentHead || ''))
    || normalizeRepositoryPath(authorization.approvedPlanPath) !== authorization.approvedPlanPath
    || !SHA40.test(String(authorization.approvedPlanHead || ''))
    || (Object.prototype.hasOwnProperty.call(authorization, 'seal')
      && !validAuthorizationSeal(authorization.seal))) return false;
  const exact = normalizeChangedFiles(authorization.exactPaths);
  return Boolean(exact
    && JSON.stringify(exact) === JSON.stringify(authorization.exactPaths)
    && authorization.approvedChangedFileCount === exact.length
    && authorization.approvedChangedFileSetSha256 === changedFileSetSha256(exact)
    && exactGovernanceClosed(authorization.governance));
}

function isValidOpenSourceWorkPackageAuthorizationReceiptForEntry(receipt, authorization, entry, options = {}) {
  if (!isValidOpenSourceWorkPackageAuthorizationForEntry(authorization, entry)
    || !receipt
    || receipt.schemaVersion !== 1
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

  const seal = validAuthorizationSeal(authorization.seal) ? authorization.seal : null;
  if (!seal
    || receipt.authorizationCommit !== seal.authorizationCommit
    || receipt.authorizationBlobSha !== seal.authorizationBlobSha) return false;

  const trustedRoot = options.trustedPolicyRoot || TRUSTED_POLICY_ROOT;
  const trustedHead = Object.prototype.hasOwnProperty.call(options, 'trustedPolicyHead')
    ? options.trustedPolicyHead
    : defaultHead(trustedRoot);
  if (!SHA40.test(String(trustedHead || ''))
    || receipt.implementationBaseCommit !== trustedHead) return false;

  const trustedAncestor = options.isTrustedAncestor
    || ((base, head) => defaultAncestor(base, head, trustedRoot));
  const parents = (options.resolveCommitParents
    || (commit => defaultParents(commit, trustedRoot)))(seal.authorizationCommit);
  if (!Array.isArray(parents)
    || parents.length !== 2
    || parents[0] !== seal.mergeFirstParent
    || parents[1] !== seal.mergeSecondParent
    || trustedAncestor(authorization.approvedParentHead, seal.authorizationCommit) !== true
    || trustedAncestor(seal.authorizationCommit, trustedHead) !== true) return false;

  const authPath = options.authorizationPath
    || repositoryFilePath(entry.authorizationPath, trustedRoot);
  const fileSha = Object.prototype.hasOwnProperty.call(options, 'authorizationFileSha256')
    ? options.authorizationFileSha256
    : sha256File(authPath);
  if (receipt.authorizationFileSha256 !== fileSha) return false;

  const blob = (options.resolveCommitBlobSha
    || ((commit, repositoryPath) => defaultBlob(commit, repositoryPath, trustedRoot)))(
    receipt.authorizationCommit,
    entry.authorizationPath
  );
  if (blob !== seal.authorizationBlobSha) return false;

  const candidateRoot = options.repositoryRoot || EVALUATED_REPOSITORY_ROOT;
  const candidateHead = Object.prototype.hasOwnProperty.call(options, 'candidateHead')
    ? options.candidateHead
    : defaultHead(candidateRoot);
  if (!SHA40.test(String(candidateHead || ''))) return false;
  const ancestor = options.isAncestor || ((base, head) => defaultAncestor(base, head, candidateRoot));
  return ancestor(receipt.implementationBaseCommit, candidateHead) === true;
}

function loadRecord(entry, options = {}) {
  if (!validEntry(entry)) return { entry: null, authorization: null, receipt: null };
  const trustedRoot = options.trustedPolicyRoot || TRUSTED_POLICY_ROOT;
  const candidateRoot = options.repositoryRoot || EVALUATED_REPOSITORY_ROOT;
  return {
    entry,
    authorization: options.authorizationByPath?.[entry.authorizationPath]
      ?? options.loadAuthorization?.(entry)
      ?? loadOpenSourceWorkPackageAuthorization(repositoryFilePath(entry.authorizationPath, trustedRoot)),
    receipt: options.receiptByPath?.[entry.receiptPath]
      ?? options.loadReceipt?.(entry)
      ?? loadOpenSourceWorkPackageAuthorizationReceipt(repositoryFilePath(entry.receiptPath, candidateRoot))
  };
}

function resolveOpenSourceAuthorizationForBranch(branch, options = {}) {
  const registry = Object.prototype.hasOwnProperty.call(options, 'registry')
    ? options.registry
    : loadOpenSourceWorkPackageRegistry(options.registryPath
      || repositoryFilePath(REGISTRY_REPOSITORY_PATH, options.trustedPolicyRoot || TRUSTED_POLICY_ROOT));
  const entry = selectOpenSourceWorkPackageRegistryEntry(registry, branch);
  return entry ? { registry, ...loadRecord(entry, options) }
    : { registry, entry: null, authorization: null, receipt: null };
}

function isAuthorizedOpenSourceImplementationBranch(branch, options = {}) {
  const resolved = Object.prototype.hasOwnProperty.call(options, 'authorization')
    || Object.prototype.hasOwnProperty.call(options, 'receipt')
    ? {
      registry: options.registry,
      entry: options.entry || selectOpenSourceWorkPackageRegistryEntry(options.registry, branch),
      authorization: options.authorization,
      receipt: options.receipt
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
  const branch = String(options.branch || '');
  const resolved = resolveOpenSourceAuthorizationForBranch(branch, options);
  return isAuthorizedOpenSourceImplementationBranch(branch, { ...options, ...resolved })
    ? `exact sealed open-source work-package branch ${branch}`
    : 'no sealed open-source work-package branch';
}

function evaluateAuthorizedOpenSourceWorkPackageScope(options = {}) {
  const branch = String(options.branch || '');
  const raw = Array.isArray(options.changedFiles) ? options.changedFiles : [];
  const changedFiles = normalizeChangedFiles(raw);
  const resolved = Object.prototype.hasOwnProperty.call(options, 'authorization')
    || Object.prototype.hasOwnProperty.call(options, 'receipt')
    ? {
      registry: options.registry,
      entry: options.entry || selectOpenSourceWorkPackageRegistryEntry(options.registry, branch),
      authorization: options.authorization,
      receipt: options.receipt
    }
    : resolveOpenSourceAuthorizationForBranch(branch, options);
  const digest = changedFiles ? changedFileSetSha256(changedFiles) : null;
  if (!changedFiles || raw.length !== changedFiles.length) {
    return Object.freeze({
      pass: false,
      reasonCode: 'OSS_WORK_PACKAGE_CHANGED_PATH_INVALID',
      changedFileSetSha256: digest,
      unauthorizedPaths: raw,
      readyForPromotion: false
    });
  }
  if (!isAuthorizedOpenSourceImplementationBranch(branch, { ...options, ...resolved })) {
    return Object.freeze({
      pass: false,
      reasonCode: 'OSS_WORK_PACKAGE_AUTHORIZATION_INVALID',
      changedFileSetSha256: digest,
      unauthorizedPaths: changedFiles,
      readyForPromotion: false
    });
  }
  const unauthorizedPaths = changedFiles.filter(file => !resolved.authorization.exactPaths.includes(file));
  if (changedFiles.length !== resolved.authorization.approvedChangedFileCount
    || digest !== resolved.authorization.approvedChangedFileSetSha256) {
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
    workPackage: resolved.authorization.workPackage,
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
  validAuthorizationSeal,
  isValidOpenSourceWorkPackageAuthorizationForEntry,
  isValidOpenSourceWorkPackageAuthorizationReceiptForEntry,
  resolveOpenSourceAuthorizationForBranch,
  isAuthorizedOpenSourceImplementationBranch,
  authorizedOpenSourceImplementationBranchDescription,
  evaluateAuthorizedOpenSourceWorkPackageScope
});
