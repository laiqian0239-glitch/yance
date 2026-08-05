'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  isValidOpenSourceWorkPackageAuthorizationForEntry,
  isValidOpenSourceWorkPackageAuthorizationReceiptForEntry,
  normalizeRepositoryPath,
  validateOpenSourceWorkPackageRegistry
} = require('./openSourceWorkPackagePolicy');
const {
  validateOpenSourceReviewedCandidateManifest
} = require('./openSourceReviewedCandidatePolicy');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const WORK_PACKAGE_PATTERN = /^OSS-[0-9]+[A-Z]?$/u;

function loadJsonObject(filePath) {
  try {
    const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch (_) {
    return null;
  }
}

function repositoryFile(repositoryPath, repositoryRoot = REPO_ROOT) {
  return path.join(repositoryRoot, ...String(repositoryPath || '').split('/'));
}

function loadOpenSourceSourceMergeReceipt(repositoryPath, repositoryRoot = REPO_ROOT) {
  return loadJsonObject(repositoryFile(repositoryPath, repositoryRoot));
}

function isExactRepositoryPath(value) {
  const normalized = normalizeRepositoryPath(value);
  return Boolean(normalized
    && normalized === value
    && !/[*?[\]]/u.test(normalized)
    && normalized.startsWith('governance/open-source-acceleration/')
    && normalized.endsWith('.json'));
}

function isExactBranchName(value) {
  const branch = String(value || '');
  if (!branch
    || branch !== branch.trim()
    || branch.startsWith('/')
    || branch.endsWith('/')
    || branch.includes('//')
    || /[\x00-\x20\x7f~^:?*\[\]\\]/u.test(branch)) return false;
  return branch.split('/').every(segment => segment
    && segment !== '.'
    && segment !== '..'
    && !segment.endsWith('.lock'));
}

function normalizeExactPaths(values) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const normalized = values.map(value => normalizeRepositoryPath(value));
  if (normalized.some((value, index) => !value
    || value !== values[index]
    || /[*?[\]]/u.test(value))) return null;
  const unique = [...new Set(normalized)].sort();
  return unique.length === normalized.length ? unique : null;
}

function validateOpenSourceSourceMergeReceipt(receipt, entry) {
  const errors = [];
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return Object.freeze(['REGISTRY_ENTRY_INVALID']);
  }
  if (!isExactRepositoryPath(entry.sourceMergeReceiptPath)) {
    errors.push('SOURCE_MERGE_RECEIPT_PATH_INVALID');
  }
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) {
    return Object.freeze([...errors, 'SOURCE_MERGE_RECEIPT_INVALID']);
  }
  if (receipt.schemaVersion !== 1) errors.push('SCHEMA_VERSION_INVALID');
  if (receipt.documentType !== 'YANCE_OPEN_SOURCE_SOURCE_MERGE_RECEIPT') {
    errors.push('DOCUMENT_TYPE_INVALID');
  }
  if (receipt.program !== 'Open Source Acceleration'
    || receipt.repository !== 'laiqian0239-glitch/yance') errors.push('PROGRAM_IDENTITY_INVALID');
  if (!WORK_PACKAGE_PATTERN.test(String(receipt.workPackage || ''))
    || receipt.workPackage !== entry.workPackage) errors.push('WORK_PACKAGE_INVALID');
  if (receipt.status !== 'SOURCE_MERGED_BASELINE_SEALED') errors.push('STATUS_INVALID');
  if (!Number.isSafeInteger(receipt.sourcePullRequest) || receipt.sourcePullRequest < 1) {
    errors.push('SOURCE_PULL_REQUEST_INVALID');
  }
  if (!isExactBranchName(receipt.sourceBranch)
    || !String(receipt.sourceBranch || '').startsWith('reviewed-candidate/')) {
    errors.push('SOURCE_BRANCH_INVALID');
  }
  if (!isExactBranchName(receipt.targetBranch)) errors.push('TARGET_BRANCH_INVALID');
  if (!isExactRepositoryPath(receipt.reviewedCandidateManifestPath)) {
    errors.push('REVIEWED_CANDIDATE_MANIFEST_PATH_INVALID');
  }
  if (receipt.authorizationPath !== entry.authorizationPath
    || receipt.authorizationReceiptPath !== entry.receiptPath) {
    errors.push('CURRENT_AUTHORITY_BINDING_INVALID');
  }
  for (const field of [
    'reviewedHead',
    'reviewedCandidateTip',
    'trustedBase',
    'sourceMergeCommit'
  ]) {
    if (!SHA_PATTERN.test(String(receipt[field] || ''))) errors.push(`${field.toUpperCase()}_INVALID`);
  }
  if (!Array.isArray(receipt.sourceMergeParents)
    || receipt.sourceMergeParents.length !== 2
    || receipt.sourceMergeParents[0] !== receipt.trustedBase
    || receipt.sourceMergeParents[1] !== receipt.reviewedCandidateTip) {
    errors.push('SOURCE_MERGE_PARENT_IDENTITY_INVALID');
  }
  const postMergePaths = normalizeExactPaths(receipt.postMergeGovernancePaths);
  if (!postMergePaths
    || JSON.stringify(postMergePaths) !== JSON.stringify(receipt.postMergeGovernancePaths)) {
    errors.push('POST_MERGE_GOVERNANCE_PATHS_INVALID');
  }
  const evidence = receipt.evidence || {};
  for (const field of [
    'preMergeOss1aRunId',
    'preMergeProvenanceRunId',
    'preMergeWp0RunId',
    'postMergeOss1aRunId',
    'postMergeProvenanceRunId',
    'postMergeWp0RunId',
    'postMergeWp0ProductJobId',
    'redContractRunId',
    'redContractJobId'
  ]) {
    if (!Number.isSafeInteger(evidence[field]) || evidence[field] < 1) {
      errors.push(`${field.toUpperCase()}_INVALID`);
    }
  }
  if (evidence.observedPostMergeReasonCode !== 'WP0_PRODUCT_ROUTE_BRANCH_ROLE_UNKNOWN'
    || evidence.redContractTests !== 3
    || evidence.redContractPassed !== 0
    || evidence.redContractFailed !== 3) errors.push('RED_EVIDENCE_INVALID');
  const governance = receipt.governance || {};
  if (governance.exactParentOrderRequired !== true
    || governance.exactPostMergeGovernancePathsOnly !== true
    || governance.sourceMergeOnly !== true
    || governance.productionUseAuthorized !== false
    || governance.formalRelease !== false
    || governance.publish !== false
    || governance.automaticNextWorkPackageAuthorization !== false
    || governance.temporaryBypassAllowed !== false
    || governance.warningOnlyClosureAllowed !== false
    || governance.readyForPromotion !== false
    || receipt.readyForPromotion !== false) errors.push('GOVERNANCE_CLOSURE_INVALID');
  return Object.freeze(errors);
}

function fail(errors, values = {}) {
  return Object.freeze({
    pass: false,
    reasonCode: 'OSS_SOURCE_MERGE_INVALID',
    workPackage: values.workPackage || null,
    branch: values.branch || null,
    sourceMergeCommit: values.sourceMergeCommit || null,
    currentHead: values.currentHead || null,
    changedFiles: Object.freeze(values.changedFiles || []),
    errors: Object.freeze((Array.isArray(errors) ? errors : [errors]).filter(Boolean)),
    readyForPromotion: false
  });
}

function evaluateOpenSourceSourceMergeIdentity(options = {}) {
  const registry = options.registry;
  const entry = options.entry;
  const receipt = options.sourceMergeReceipt;
  const branch = String(options.branch || '');
  const currentHead = String(options.currentHead || '');
  if (!validateOpenSourceWorkPackageRegistry(registry)
    || !registry.entries.includes(entry)) {
    return fail('REGISTRY_INVALID', { branch, currentHead });
  }
  const receiptErrors = validateOpenSourceSourceMergeReceipt(receipt, entry);
  if (receiptErrors.length) {
    return fail(receiptErrors, {
      branch,
      currentHead,
      workPackage: receipt?.workPackage,
      sourceMergeCommit: receipt?.sourceMergeCommit
    });
  }

  const validateAuthorization = options.validateAuthorization
    ?? isValidOpenSourceWorkPackageAuthorizationForEntry;
  const validateAuthorizationReceipt = options.validateReceipt
    ?? isValidOpenSourceWorkPackageAuthorizationReceiptForEntry;
  if (!validateAuthorization(options.authorization, entry)
    || !validateAuthorizationReceipt(options.authorizationReceipt, options.authorization, entry)) {
    return fail('CURRENT_AUTHORITY_INVALID', {
      branch,
      currentHead,
      workPackage: receipt.workPackage,
      sourceMergeCommit: receipt.sourceMergeCommit
    });
  }

  const manifestErrors = validateOpenSourceReviewedCandidateManifest(
    options.reviewedCandidateManifest
  );
  const manifest = options.reviewedCandidateManifest;
  if (manifestErrors.length
    || manifest.workPackage !== receipt.workPackage
    || manifest.reviewedCandidateBranch !== receipt.sourceBranch
    || manifest.reviewedHead !== receipt.reviewedHead
    || manifest.branchTip !== receipt.reviewedCandidateTip
    || manifest.continuationPullRequest !== receipt.sourcePullRequest) {
    return fail(['REVIEWED_CANDIDATE_BINDING_INVALID', ...manifestErrors], {
      branch,
      currentHead,
      workPackage: receipt.workPackage,
      sourceMergeCommit: receipt.sourceMergeCommit
    });
  }

  const remoteTip = options.resolveRemoteTip?.(branch) ?? null;
  if (branch !== receipt.targetBranch
    || !SHA_PATTERN.test(currentHead)
    || remoteTip !== currentHead) {
    return fail('TARGET_IDENTITY_INVALID', {
      branch,
      currentHead,
      workPackage: receipt.workPackage,
      sourceMergeCommit: receipt.sourceMergeCommit
    });
  }
  const parents = options.resolveCommitParents?.(receipt.sourceMergeCommit);
  if (!Array.isArray(parents)
    || JSON.stringify(parents) !== JSON.stringify(receipt.sourceMergeParents)) {
    return fail('SOURCE_MERGE_TOPOLOGY_INVALID', {
      branch,
      currentHead,
      workPackage: receipt.workPackage,
      sourceMergeCommit: receipt.sourceMergeCommit
    });
  }
  if (options.isAncestor?.(receipt.sourceMergeCommit, currentHead) !== true) {
    return fail('SOURCE_MERGE_ANCESTRY_INVALID', {
      branch,
      currentHead,
      workPackage: receipt.workPackage,
      sourceMergeCommit: receipt.sourceMergeCommit
    });
  }
  const changedFiles = normalizeExactPaths(
    options.changedFilesBetween?.(receipt.sourceMergeCommit, currentHead)
  );
  if (!changedFiles
    || JSON.stringify(changedFiles) !== JSON.stringify(receipt.postMergeGovernancePaths)) {
    return fail('POST_MERGE_SCOPE_INVALID', {
      branch,
      currentHead,
      workPackage: receipt.workPackage,
      sourceMergeCommit: receipt.sourceMergeCommit,
      changedFiles: changedFiles || []
    });
  }

  return Object.freeze({
    pass: true,
    reasonCode: null,
    role: 'SOURCE_MERGED_BASELINE',
    workPackage: receipt.workPackage,
    branch,
    sourceMergeCommit: receipt.sourceMergeCommit,
    reviewedHead: receipt.reviewedHead,
    reviewedCandidateTip: receipt.reviewedCandidateTip,
    trustedBase: receipt.trustedBase,
    currentHead,
    changedFiles: Object.freeze(changedFiles),
    sourceMergeOnly: true,
    productionUseAuthorized: false,
    formalRelease: false,
    readyForPromotion: false,
    errors: Object.freeze([])
  });
}

module.exports = Object.freeze({
  evaluateOpenSourceSourceMergeIdentity,
  isExactBranchName,
  isExactRepositoryPath,
  loadOpenSourceSourceMergeReceipt,
  normalizeExactPaths,
  validateOpenSourceSourceMergeReceipt
});
