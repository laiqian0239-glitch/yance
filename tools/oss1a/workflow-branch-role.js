'use strict';

const fs = require('node:fs');

const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const BRANCH_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/u;
const ROLES = Object.freeze({ GOVERNANCE: 'GOVERNANCE', IMPLEMENTATION: 'IMPLEMENTATION', REVIEWED_CANDIDATE: 'REVIEWED_CANDIDATE', UNKNOWN: 'UNKNOWN' });
const GOVERNANCE_BRANCHES = new Set([
  'governance/oss-1a-runtime-ci-authorization',
  'governance/oss-1a-detached-evidence-baseline-v3',
  'governance/oss-1a-pre-ready-fd6-authorization',
  'governance/oss-1a-event-batch-authorization',
  'governance/oss-1a-lifecycle-milestone-authorization',
  'governance/oss-1a-async-store-capability-authorization',
  'governance/oss-1a-canonical-projection-checkpoint-authorization',
  'governance/oss1a-reviewed-candidate-registration',
  'governance/oss1a-reviewed-candidate-tip-binding'
]);

function normalizeBranch(value) {
  const branch = String(value || '').trim();
  if (!BRANCH_PATTERN.test(branch) || branch.includes('..') || branch.endsWith('/')) return '';
  return branch;
}

function branchFromContext({ eventName, headRef, gitRef } = {}) {
  if (eventName === 'pull_request') return normalizeBranch(headRef);
  if (eventName === 'push' && String(gitRef || '').startsWith('refs/heads/')) return normalizeBranch(String(gitRef).slice(11));
  return '';
}

function exactPath(value) {
  const path = String(value || '');
  return Boolean(path && path === path.trim() && !path.startsWith('/') && !path.includes('..') && !/[*?[\]]/u.test(path));
}

function validateReviewedCandidateManifest(manifest) {
  const errors = [];
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return ['MANIFEST_INVALID'];
  if (manifest.schemaVersion !== 1) errors.push('SCHEMA_VERSION_INVALID');
  if (manifest.documentType !== 'YANCE_OSS_REVIEWED_CANDIDATE') errors.push('DOCUMENT_TYPE_INVALID');
  if (manifest.repository !== 'laiqian0239-glitch/yance') errors.push('REPOSITORY_INVALID');
  if (manifest.workPackage !== 'OSS-1A' || manifest.task !== 11) errors.push('WORK_PACKAGE_INVALID');
  if (!Number.isSafeInteger(manifest.pullRequest) || manifest.pullRequest < 1) errors.push('PULL_REQUEST_INVALID');
  if (!Number.isSafeInteger(manifest.continuationPullRequest) || manifest.continuationPullRequest < 1) errors.push('CONTINUATION_PULL_REQUEST_INVALID');
  if (!normalizeBranch(manifest.sourceBranch)) errors.push('SOURCE_BRANCH_INVALID');
  if (!normalizeBranch(manifest.reviewedCandidateBranch)) errors.push('REVIEWED_CANDIDATE_BRANCH_INVALID');
  for (const field of ['governanceBase', 'reviewedHead', 'branchTip']) if (!SHA_PATTERN.test(String(manifest[field] || ''))) errors.push(`${field.toUpperCase()}_INVALID`);
  if (manifest.reviewedHead === manifest.branchTip) errors.push('EVIDENCE_TIP_REQUIRED');
  if (!Number.isSafeInteger(manifest.reviewedChangedFileCount) || manifest.reviewedChangedFileCount < 1) errors.push('REVIEWED_FILE_COUNT_INVALID');
  if (!Array.isArray(manifest.postReviewEvidencePaths) || manifest.postReviewEvidencePaths.length !== 4 || !manifest.postReviewEvidencePaths.every(exactPath) || new Set(manifest.postReviewEvidencePaths).size !== manifest.postReviewEvidencePaths.length) errors.push('POST_REVIEW_EVIDENCE_PATHS_INVALID');
  if (!Number.isSafeInteger(manifest.review?.id) || manifest.review.id < 1) errors.push('REVIEW_ID_INVALID');
  if (manifest.review?.protocolVersion !== 1 || manifest.review?.reviewerMode !== 'CHATGPT_GITHUB_CONNECTED_SESSION' || manifest.review?.decision !== 'ALLOW_MERGE') errors.push('REVIEW_IDENTITY_INVALID');
  if (manifest.review?.p0Count !== 0 || manifest.review?.p1Count !== 0 || manifest.review?.temporaryBypassDetected !== false) errors.push('REVIEW_BLOCKERS_PRESENT');
  if (!Array.isArray(manifest.review?.missingEvidence) || manifest.review.missingEvidence.length || !Array.isArray(manifest.review?.blockers) || manifest.review.blockers.length) errors.push('REVIEW_EVIDENCE_INVALID');
  if (manifest.governance?.exactPostReviewEvidenceOnly !== true || manifest.governance?.wildcardAuthorizationAllowed !== false || manifest.governance?.temporaryBypassAllowed !== false || manifest.governance?.warningOnlyClosureAllowed !== false) errors.push('GOVERNANCE_FAIL_CLOSED_INVALID');
  if (manifest.governance?.sourceMergeOnly !== true || manifest.governance?.productionUseAuthorized !== false || manifest.governance?.formalRelease !== false || manifest.governance?.automaticNextWorkPackageAuthorization !== false || manifest.readyForPromotion !== false) errors.push('RELEASE_SEPARATION_INVALID');
  return errors;
}

function resolveWorkflowBranchRole(context = {}, manifest = null) {
  const branch = branchFromContext(context);
  const currentHead = String(context.reviewedHead || '');
  if (!branch || !SHA_PATTERN.test(currentHead)) return Object.freeze({ role: ROLES.UNKNOWN, branch, errors: ['CONTEXT_INVALID'] });
  if (GOVERNANCE_BRANCHES.has(branch)) return Object.freeze({ role: ROLES.GOVERNANCE, branch, errors: [] });
  if (branch === 'oss/1a-baileys-lifecycle') return Object.freeze({ role: ROLES.IMPLEMENTATION, branch, errors: [] });
  const errors = validateReviewedCandidateManifest(manifest);
  if (errors.length) return Object.freeze({ role: ROLES.UNKNOWN, branch, errors: Object.freeze(errors) });
  if (branch !== manifest.reviewedCandidateBranch || currentHead !== manifest.branchTip) return Object.freeze({ role: ROLES.UNKNOWN, branch, errors: ['REVIEWED_CANDIDATE_IDENTITY_MISMATCH'] });
  return Object.freeze({ role: ROLES.REVIEWED_CANDIDATE, branch, errors: [] });
}

function main() {
  const [eventName, headRef, gitRef, currentHead, manifestPath] = process.argv.slice(2);
  const manifest = manifestPath ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : null;
  const result = resolveWorkflowBranchRole({ eventName, headRef, gitRef, reviewedHead: currentHead }, manifest);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.role === ROLES.UNKNOWN) process.exitCode = 1;
}

if (require.main === module) main();
module.exports = Object.freeze({ GOVERNANCE_BRANCHES, ROLES, branchFromContext, normalizeBranch, resolveWorkflowBranchRole, validateReviewedCandidateManifest });
