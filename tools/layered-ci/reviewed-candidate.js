'use strict';

const crypto = require('node:crypto');

const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const ALLOWED_POST_REVIEW_CLASSIFICATIONS = new Set([
  'EVIDENCE_ONLY',
  'GOVERNANCE_METADATA_ONLY',
  'CI_RETRY_METADATA_ONLY'
]);

function result(values = {}) {
  return Object.freeze({
    pass: false,
    reasonCode: 'CANDIDATE_UNKNOWN_FAILURE',
    governanceBaseVerified: false,
    reviewedHeadVerified: false,
    branchTipVerified: false,
    reviewedScopeVerified: false,
    postReviewCommitsVerified: false,
    postReviewPathsVerified: false,
    ...values,
    // Pinned after the spread so no caller can claim promotion readiness.
    readyForPromotion: false
  });
}

function fail(reasonCode, details = {}) {
  return result({ reasonCode, ...details });
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
  if (/[*?[\]]/u.test(normalized)) return '';
  return normalized;
}

function normalizedSortedPaths(values) {
  if (!Array.isArray(values)) return null;
  const normalized = values.map(normalizeRepositoryPath);
  if (normalized.some(value => !value)) return null;
  return [...new Set(normalized)].sort();
}

function lines(value) {
  return String(value || '')
    .split(/\r?\n/u)
    .map(item => item.trim())
    .filter(Boolean);
}

function changedFileSetSha256(values = []) {
  const normalized = normalizedSortedPaths(values);
  if (!normalized) throw new TypeError('changed file paths must be exact repository-relative paths');
  return crypto.createHash('sha256').update(`${normalized.join('\n')}\n`, 'utf8').digest('hex');
}

function validateManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return fail('CANDIDATE_MANIFEST_INVALID');
  }
  if (manifest.schemaVersion !== 1 || manifest.documentType !== 'YANCE_REVIEWED_CANDIDATE') {
    return fail('CANDIDATE_SCHEMA_INVALID');
  }
  if (manifest.repository !== 'laiqian0239-glitch/yance') {
    return fail('CANDIDATE_REPOSITORY_INVALID');
  }
  if (!Number.isSafeInteger(manifest.pullRequest) || manifest.pullRequest < 1) {
    return fail('CANDIDATE_PULL_REQUEST_INVALID');
  }
  if (
    typeof manifest.authorizedBranch !== 'string'
    || !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/u.test(manifest.authorizedBranch)
    || manifest.authorizedBranch.includes('..')
    || manifest.authorizedBranch.endsWith('/')
  ) {
    return fail('CANDIDATE_BRANCH_INVALID');
  }
  for (const field of ['governanceBase', 'reviewedHead', 'branchTip']) {
    if (!SHA_PATTERN.test(String(manifest[field] || ''))) {
      return fail('CANDIDATE_SHA_INVALID', { field });
    }
  }
  if (!Number.isSafeInteger(manifest.reviewedChangedFileCount) || manifest.reviewedChangedFileCount < 0) {
    return fail('CANDIDATE_REVIEWED_FILE_COUNT_INVALID');
  }
  if (!DIGEST_PATTERN.test(String(manifest.reviewedChangedFileSetSha256 || ''))) {
    return fail('CANDIDATE_REVIEWED_FILE_DIGEST_INVALID');
  }
  if (!Array.isArray(manifest.allowedPostReviewCommits)) {
    return fail('CANDIDATE_POST_REVIEW_COMMITS_INVALID');
  }
  const commitShas = [];
  for (const entry of manifest.allowedPostReviewCommits) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || !SHA_PATTERN.test(String(entry.sha || ''))) {
      return fail('CANDIDATE_POST_REVIEW_COMMIT_INVALID');
    }
    if (!ALLOWED_POST_REVIEW_CLASSIFICATIONS.has(entry.classification)) {
      return fail('CANDIDATE_POST_REVIEW_CLASSIFICATION_INVALID', { classification: entry.classification || null });
    }
    commitShas.push(entry.sha);
  }
  if (new Set(commitShas).size !== commitShas.length) {
    return fail('CANDIDATE_POST_REVIEW_COMMIT_DUPLICATE');
  }
  if (commitShas.length === 0 && manifest.reviewedHead !== manifest.branchTip) {
    return fail('CANDIDATE_POST_REVIEW_COMMITS_MISSING');
  }
  if (commitShas.length > 0 && commitShas[commitShas.length - 1] !== manifest.branchTip) {
    return fail('CANDIDATE_POST_REVIEW_TIP_NOT_FROZEN');
  }
  const paths = normalizedSortedPaths(manifest.allowedPostReviewPaths);
  if (!paths || paths.length !== manifest.allowedPostReviewPaths.length) {
    return fail('CANDIDATE_POST_REVIEW_PATH_INVALID');
  }
  if (manifest.governance?.wildcardAuthorizationAllowed !== false) {
    return fail('CANDIDATE_WILDCARD_AUTHORIZATION_FORBIDDEN');
  }
  if (manifest.governance?.pr5MustRemainDraft !== true) {
    return fail('CANDIDATE_PR5_DRAFT_REQUIRED');
  }
  if (manifest.governance?.automaticClosure !== false) {
    return fail('CANDIDATE_AUTOMATIC_CLOSURE_FORBIDDEN');
  }
  if (manifest.governance?.readyForPromotion !== false || manifest.readyForPromotion !== false) {
    return fail('CANDIDATE_PROMOTION_MUST_REMAIN_FALSE');
  }
  return result({ pass: true, reasonCode: null });
}

function sameArray(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function evaluateReviewedCandidate(options = {}) {
  const manifest = options.manifest;
  const git = options.git;
  const validation = validateManifest(manifest);
  if (!validation.pass) return validation;
  if (typeof git !== 'function') return fail('CANDIDATE_GIT_REQUIRED');

  for (const [field, sha] of [
    ['governanceBase', manifest.governanceBase],
    ['reviewedHead', manifest.reviewedHead],
    ['branchTip', manifest.branchTip]
  ]) {
    try {
      git(['cat-file', '-e', `${sha}^{commit}`]);
    } catch (cause) {
      return fail('CANDIDATE_GIT_OBJECT_MISSING', { field, sha, error: cause?.message || String(cause) });
    }
  }

  try {
    git(['merge-base', '--is-ancestor', manifest.governanceBase, manifest.reviewedHead]);
  } catch (cause) {
    return fail('GOVERNANCE_BASE_NOT_ANCESTOR', { error: cause?.message || String(cause) });
  }

  try {
    git(['merge-base', '--is-ancestor', manifest.reviewedHead, manifest.branchTip]);
  } catch (cause) {
    return fail('REVIEWED_HEAD_NOT_ANCESTOR', {
      governanceBaseVerified: true,
      error: cause?.message || String(cause)
    });
  }

  let remoteTip;
  try {
    remoteTip = git(['rev-parse', `refs/remotes/origin/${manifest.authorizedBranch}`]);
  } catch (cause) {
    return fail('AUTHORIZED_BRANCH_REF_MISSING', {
      governanceBaseVerified: true,
      reviewedHeadVerified: true,
      error: cause?.message || String(cause)
    });
  }
  if (remoteTip !== manifest.branchTip) {
    return fail('BRANCH_TIP_MISMATCH', {
      governanceBaseVerified: true,
      reviewedHeadVerified: true,
      expectedBranchTip: manifest.branchTip,
      actualBranchTip: remoteTip
    });
  }

  let reviewedFiles;
  try {
    reviewedFiles = normalizedSortedPaths(lines(git([
      '-c', 'core.quotePath=false', 'diff', '--name-only',
      manifest.governanceBase, manifest.reviewedHead, '--'
    ])));
  } catch (cause) {
    return fail('REVIEWED_SCOPE_UNAVAILABLE', {
      governanceBaseVerified: true,
      reviewedHeadVerified: true,
      branchTipVerified: true,
      error: cause?.message || String(cause)
    });
  }
  if (!reviewedFiles) return fail('REVIEWED_SCOPE_PATH_INVALID');
  const reviewedDigest = changedFileSetSha256(reviewedFiles);
  if (
    reviewedFiles.length !== manifest.reviewedChangedFileCount
    || reviewedDigest !== manifest.reviewedChangedFileSetSha256
  ) {
    return fail('REVIEWED_SCOPE_MISMATCH', {
      governanceBaseVerified: true,
      reviewedHeadVerified: true,
      branchTipVerified: true,
      expectedChangedFileCount: manifest.reviewedChangedFileCount,
      actualChangedFileCount: reviewedFiles.length,
      expectedChangedFileSetSha256: manifest.reviewedChangedFileSetSha256,
      actualChangedFileSetSha256: reviewedDigest
    });
  }

  let postReviewCommits;
  try {
    postReviewCommits = lines(git([
      'rev-list', '--reverse', `${manifest.reviewedHead}..${manifest.branchTip}`
    ]));
  } catch (cause) {
    return fail('POST_REVIEW_COMMITS_UNAVAILABLE', {
      governanceBaseVerified: true,
      reviewedHeadVerified: true,
      branchTipVerified: true,
      reviewedScopeVerified: true,
      error: cause?.message || String(cause)
    });
  }
  const expectedCommits = manifest.allowedPostReviewCommits.map(entry => entry.sha);
  if (!sameArray(postReviewCommits, expectedCommits)) {
    return fail('POST_REVIEW_COMMIT_MISMATCH', {
      governanceBaseVerified: true,
      reviewedHeadVerified: true,
      branchTipVerified: true,
      reviewedScopeVerified: true,
      expectedPostReviewCommits: expectedCommits,
      actualPostReviewCommits: postReviewCommits
    });
  }

  let postReviewPaths;
  try {
    postReviewPaths = normalizedSortedPaths(lines(git([
      '-c', 'core.quotePath=false', 'diff', '--name-only',
      manifest.reviewedHead, manifest.branchTip, '--'
    ])));
  } catch (cause) {
    return fail('POST_REVIEW_PATHS_UNAVAILABLE', {
      governanceBaseVerified: true,
      reviewedHeadVerified: true,
      branchTipVerified: true,
      reviewedScopeVerified: true,
      postReviewCommitsVerified: true,
      error: cause?.message || String(cause)
    });
  }
  const expectedPaths = normalizedSortedPaths(manifest.allowedPostReviewPaths);
  if (!postReviewPaths || !sameArray(postReviewPaths, expectedPaths)) {
    return fail('POST_REVIEW_PATH_MISMATCH', {
      governanceBaseVerified: true,
      reviewedHeadVerified: true,
      branchTipVerified: true,
      reviewedScopeVerified: true,
      postReviewCommitsVerified: true,
      expectedPostReviewPaths: expectedPaths,
      actualPostReviewPaths: postReviewPaths || []
    });
  }

  return result({
    pass: true,
    reasonCode: null,
    governanceBaseVerified: true,
    reviewedHeadVerified: true,
    branchTipVerified: true,
    reviewedScopeVerified: true,
    postReviewCommitsVerified: true,
    postReviewPathsVerified: true,
    reviewedChangedFileCount: reviewedFiles.length,
    reviewedChangedFileSetSha256: reviewedDigest,
    reviewedHead: manifest.reviewedHead,
    branchTip: manifest.branchTip
  });
}

module.exports = {
  ALLOWED_POST_REVIEW_CLASSIFICATIONS,
  changedFileSetSha256,
  evaluateReviewedCandidate,
  normalizeRepositoryPath,
  validateManifest
};
