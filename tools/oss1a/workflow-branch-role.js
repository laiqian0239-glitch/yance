'use strict';

const fs = require('node:fs');
const openSourceReviewedCandidatePolicy = require('../../shared/release/openSourceReviewedCandidatePolicy');

const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const BRANCH_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/u;
const ROLES = Object.freeze({
  GOVERNANCE: 'GOVERNANCE',
  IMPLEMENTATION: 'IMPLEMENTATION',
  REVIEWED_CANDIDATE: 'REVIEWED_CANDIDATE',
  UNKNOWN: 'UNKNOWN'
});
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
  if (!BRANCH_PATTERN.test(branch)
    || branch.includes('..')
    || branch.endsWith('/')) return '';
  return branch;
}

function branchFromContext({ eventName, headRef, gitRef } = {}) {
  if (eventName === 'pull_request') return normalizeBranch(headRef);
  if (eventName === 'push' && String(gitRef || '').startsWith('refs/heads/')) {
    return normalizeBranch(String(gitRef).slice('refs/heads/'.length));
  }
  return '';
}

const validateReviewedCandidateManifest =
  openSourceReviewedCandidatePolicy.validateOpenSourceReviewedCandidateManifest;

function resolveWorkflowBranchRole(context = {}, manifest = null) {
  const branch = branchFromContext(context);
  const currentHead = String(context.reviewedHead || '');
  if (!branch || !SHA_PATTERN.test(currentHead)) {
    return Object.freeze({ role: ROLES.UNKNOWN, branch, errors: ['CONTEXT_INVALID'] });
  }
  if (GOVERNANCE_BRANCHES.has(branch)) {
    return Object.freeze({ role: ROLES.GOVERNANCE, branch, errors: [] });
  }
  if (branch === 'oss/1a-baileys-lifecycle') {
    return Object.freeze({ role: ROLES.IMPLEMENTATION, branch, errors: [] });
  }

  const errors = validateReviewedCandidateManifest(manifest);
  if (errors.length) {
    return Object.freeze({ role: ROLES.UNKNOWN, branch, errors: Object.freeze([...errors]) });
  }
  if (branch !== manifest.reviewedCandidateBranch || currentHead !== manifest.branchTip) {
    return Object.freeze({
      role: ROLES.UNKNOWN,
      branch,
      errors: ['REVIEWED_CANDIDATE_IDENTITY_MISMATCH']
    });
  }
  return Object.freeze({
    role: ROLES.REVIEWED_CANDIDATE,
    branch,
    reviewedHead: manifest.reviewedHead,
    reviewedCandidateBranch: manifest.reviewedCandidateBranch,
    branchTip: manifest.branchTip,
    errors: []
  });
}

function main() {
  const [eventName, headRef, gitRef, currentHead, manifestPath] = process.argv.slice(2);
  const manifest = manifestPath ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : null;
  const result = resolveWorkflowBranchRole(
    { eventName, headRef, gitRef, reviewedHead: currentHead },
    manifest
  );
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.role === ROLES.UNKNOWN) process.exitCode = 1;
}

if (require.main === module) main();

module.exports = Object.freeze({
  GOVERNANCE_BRANCHES,
  ROLES,
  branchFromContext,
  normalizeBranch,
  resolveWorkflowBranchRole,
  validateReviewedCandidateManifest
});
