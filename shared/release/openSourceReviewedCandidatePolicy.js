'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  isValidOpenSourceWorkPackageAuthorizationForEntry,
  isValidOpenSourceWorkPackageAuthorizationReceiptForEntry,
  normalizeRepositoryPath,
  validateOpenSourceWorkPackageRegistry
} = require('./openSourceWorkPackagePolicy');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const OPEN_SOURCE_REVIEWED_CANDIDATE_MANIFEST_REPOSITORY_PATH =
  'governance/open-source-acceleration/oss-1a-reviewed-candidate-task11.json';
const OPEN_SOURCE_REVIEWED_CANDIDATE_MANIFEST_PATH = path.join(
  REPO_ROOT,
  ...OPEN_SOURCE_REVIEWED_CANDIDATE_MANIFEST_REPOSITORY_PATH.split('/')
);
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

function loadOpenSourceReviewedCandidateManifest(
  filePath = OPEN_SOURCE_REVIEWED_CANDIDATE_MANIFEST_PATH
) {
  return loadJsonObject(filePath);
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
  return segments.every(segment => segment
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

function validateOpenSourceReviewedCandidateManifest(manifest) {
  const errors = [];
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return Object.freeze(['MANIFEST_INVALID']);
  }
  if (manifest.schemaVersion !== 1) errors.push('SCHEMA_VERSION_INVALID');
  if (manifest.documentType !== 'YANCE_OSS_REVIEWED_CANDIDATE') errors.push('DOCUMENT_TYPE_INVALID');
  if (manifest.repository !== 'laiqian0239-glitch/yance') errors.push('REPOSITORY_INVALID');
  if (!WORK_PACKAGE_PATTERN.test(String(manifest.workPackage || ''))) errors.push('WORK_PACKAGE_INVALID');
  if (!Number.isSafeInteger(manifest.task) || manifest.task < 1) errors.push('TASK_INVALID');
  if (!Number.isSafeInteger(manifest.pullRequest) || manifest.pullRequest < 1) errors.push('PULL_REQUEST_INVALID');
  if (!Number.isSafeInteger(manifest.continuationPullRequest)
    || manifest.continuationPullRequest < 1) errors.push('CONTINUATION_PULL_REQUEST_INVALID');
  if (!isExactBranchName(manifest.sourceBranch)) errors.push('SOURCE_BRANCH_INVALID');
  if (!isExactBranchName(manifest.reviewedCandidateBranch)
    || !String(manifest.reviewedCandidateBranch || '').startsWith('reviewed-candidate/')) {
    errors.push('REVIEWED_CANDIDATE_BRANCH_INVALID');
  }
  for (const field of ['governanceBase', 'reviewedHead', 'branchTip']) {
    if (!SHA_PATTERN.test(String(manifest[field] || ''))) errors.push(`${field.toUpperCase()}_INVALID`);
  }
  if (manifest.reviewedHead === manifest.branchTip
    || manifest.governanceBase === manifest.branchTip) errors.push('EVIDENCE_TIP_REQUIRED');
  if (!Number.isSafeInteger(manifest.reviewedChangedFileCount)
    || manifest.reviewedChangedFileCount < 1) errors.push('REVIEWED_FILE_COUNT_INVALID');

  const postReviewEvidencePaths = normalizeExactPaths(manifest.postReviewEvidencePaths);
  if (!postReviewEvidencePaths
    || JSON.stringify(postReviewEvidencePaths) !== JSON.stringify(manifest.postReviewEvidencePaths)) {
    errors.push('POST_REVIEW_EVIDENCE_PATHS_INVALID');
  }

  const review = manifest.review || {};
  if (!Number.isSafeInteger(review.id) || review.id < 1) errors.push('REVIEW_ID_INVALID');
  if (review.protocolVersion !== 1
    || review.reviewerMode !== 'CHATGPT_GITHUB_CONNECTED_SESSION'
    || review.decision !== 'ALLOW_MERGE') errors.push('REVIEW_IDENTITY_INVALID');
  if (review.p0Count !== 0
    || review.p1Count !== 0
    || review.temporaryBypassDetected !== false) errors.push('REVIEW_BLOCKERS_PRESENT');
  if (!Array.isArray(review.missingEvidence)
    || review.missingEvidence.length !== 0
    || !Array.isArray(review.blockers)
    || review.blockers.length !== 0) errors.push('REVIEW_EVIDENCE_INVALID');

  const requiredEvidence = manifest.requiredEvidence;
  if (!requiredEvidence
    || typeof requiredEvidence !== 'object'
    || Array.isArray(requiredEvidence)
    || Object.keys(requiredEvidence).length === 0
    || Object.values(requiredEvidence).some(value => !Number.isSafeInteger(value) || value < 1)) {
    errors.push('REQUIRED_EVIDENCE_INVALID');
  }

  const governance = manifest.governance || {};
  if (governance.exactPostReviewEvidenceOnly !== true
    || governance.wildcardAuthorizationAllowed !== false
    || governance.temporaryBypassAllowed !== false
    || governance.warningOnlyClosureAllowed !== false) errors.push('GOVERNANCE_FAIL_CLOSED_INVALID');
  if (governance.sourceMergeOnly !== true
    || governance.productionUseAuthorized !== false
    || governance.formalRelease !== false
    || governance.automaticNextWorkPackageAuthorization !== false
    || manifest.readyForPromotion !== false) errors.push('RELEASE_SEPARATION_INVALID');
  return Object.freeze(errors);
}

function frozenResult(values) {
  return Object.freeze({
    pass: false,
    reasonCode: 'OSS_REVIEWED_CANDIDATE_INVALID',
    workPackage: null,
    branch: null,
    reviewedHead: null,
    branchTip: null,
    governanceBase: null,
    changedFiles: Object.freeze([]),
    errors: Object.freeze([]),
    readyForPromotion: false,
    ...values,
    readyForPromotion: false
  });
}

function fail(errors, values = {}) {
  const normalizedErrors = Array.isArray(errors) ? errors : [errors];
  return frozenResult({
    ...values,
    pass: false,
    reasonCode: 'OSS_REVIEWED_CANDIDATE_INVALID',
    errors: Object.freeze(normalizedErrors.filter(Boolean))
  });
}

function recordForEntry(entry, options) {
  const authorization = options.authorization
    ?? options.authorizationByPath?.[entry.authorizationPath]
    ?? options.loadAuthorization?.(entry)
    ?? null;
  const receipt = options.receipt
    ?? options.receiptByPath?.[entry.receiptPath]
    ?? options.loadReceipt?.(entry)
    ?? null;
  return { authorization, receipt };
}

function evaluateOpenSourceReviewedCandidateIdentity(options = {}) {
  const manifest = options.manifest;
  const manifestErrors = validateOpenSourceReviewedCandidateManifest(manifest);
  const branch = String(options.branch || '');
  if (manifestErrors.length) return fail(manifestErrors, { branch });

  const registry = options.registry;
  if (!validateOpenSourceWorkPackageRegistry(registry)) {
    return fail('REGISTRY_INVALID', { branch, workPackage: manifest.workPackage });
  }
  const matchingEntries = registry.entries.filter(entry => entry.workPackage === manifest.workPackage
    && entry.authorizedBranch === manifest.sourceBranch);
  if (matchingEntries.length !== 1) {
    return fail('REGISTRY_ENTRY_INVALID', { branch, workPackage: manifest.workPackage });
  }
  const [entry] = matchingEntries;
  const { authorization, receipt } = recordForEntry(entry, options);
  const validateAuthorization = options.validateAuthorization
    ?? isValidOpenSourceWorkPackageAuthorizationForEntry;
  const validateReceipt = options.validateReceipt
    ?? isValidOpenSourceWorkPackageAuthorizationReceiptForEntry;
  if (!validateAuthorization(authorization, entry)
    || !validateReceipt(receipt, authorization, entry)) {
    return fail('AUTHORITY_INVALID', { branch, workPackage: manifest.workPackage });
  }

  const currentHead = String(options.currentHead || '');
  const remoteTip = options.resolveRemoteTip?.(branch) ?? null;
  if (branch !== manifest.reviewedCandidateBranch
    || currentHead !== manifest.branchTip
    || remoteTip !== manifest.branchTip) {
    return fail('IDENTITY_MISMATCH', { branch, workPackage: manifest.workPackage });
  }

  const parents = options.resolveCommitParents?.(manifest.branchTip);
  if (!Array.isArray(parents)
    || parents.length !== 2
    || parents[0] !== manifest.reviewedHead
    || parents[1] !== manifest.governanceBase) {
    return fail('PARENT_CHAIN_INVALID', { branch, workPackage: manifest.workPackage });
  }

  const changedFiles = normalizeExactPaths(
    options.changedFilesBetween?.(manifest.reviewedHead, manifest.branchTip)
  );
  if (!changedFiles
    || JSON.stringify(changedFiles) !== JSON.stringify(manifest.postReviewEvidencePaths)) {
    return fail('POST_REVIEW_SCOPE_INVALID', {
      branch,
      workPackage: manifest.workPackage,
      changedFiles: Object.freeze(changedFiles || [])
    });
  }

  return frozenResult({
    pass: true,
    reasonCode: null,
    workPackage: manifest.workPackage,
    branch,
    reviewedHead: manifest.reviewedHead,
    branchTip: manifest.branchTip,
    governanceBase: manifest.governanceBase,
    changedFiles: Object.freeze(changedFiles),
    reviewId: manifest.review.id,
    sourceMergeOnly: true,
    errors: Object.freeze([])
  });
}

module.exports = Object.freeze({
  OPEN_SOURCE_REVIEWED_CANDIDATE_MANIFEST_PATH,
  OPEN_SOURCE_REVIEWED_CANDIDATE_MANIFEST_REPOSITORY_PATH,
  evaluateOpenSourceReviewedCandidateIdentity,
  isExactBranchName,
  loadOpenSourceReviewedCandidateManifest,
  normalizeExactPaths,
  validateOpenSourceReviewedCandidateManifest
});
