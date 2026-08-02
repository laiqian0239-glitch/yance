'use strict';

const {
  ACV2_WP_A_PARENT_GOVERNANCE_HEAD,
  evaluateAuthorizedWorkPackageScope,
  loadWorkPackageAuthorization,
  loadWorkPackageScopeAmendment
} = require('../../shared/release/implementationBranchPolicy');
const { CURRENT_STAGE, currentBranch, currentCommit, git, verifyWp0Gate } = require('./lib');

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function gateInputError(reasonCode, message, details = {}) {
  return Object.assign(new Error(message), { reasonCode, details });
}

function resolveReviewedBranch(branch) {
  if (!branch) return undefined;
  try {
    git(['check-ref-format', '--branch', branch]);
  } catch {
    throw gateInputError('WP0_REVIEWED_BRANCH_INVALID', 'reviewed implementation branch is not a valid Git branch name', { branch });
  }
  const remoteRef = `refs/remotes/origin/${branch}`;
  let remoteHead;
  try {
    remoteHead = git(['rev-parse', '--verify', remoteRef]);
  } catch {
    throw gateInputError('WP0_REVIEWED_BRANCH_REF_MISSING', 'reviewed implementation branch was not fetched into the trusted origin namespace', {
      branch,
      remoteRef
    });
  }
  const head = currentCommit();
  if (!head || remoteHead !== head) {
    throw gateInputError('WP0_REVIEWED_BRANCH_HEAD_MISMATCH', 'reviewed implementation branch tip must equal the checked-out HEAD', {
      branch,
      remoteRef,
      remoteHead,
      head
    });
  }
  return branch;
}

function evaluateWorkPackageScopeForGate(branch) {
  const authorization = loadWorkPackageAuthorization();
  if (!authorization || branch !== authorization.authorizedBranch) {
    return Object.freeze({
      applicable: false,
      pass: true,
      reasonCode: null,
      parentGovernanceHead: ACV2_WP_A_PARENT_GOVERNANCE_HEAD,
      changedFileCount: 0,
      unauthorizedPaths: []
    });
  }

  try {
    git(['cat-file', '-e', `${ACV2_WP_A_PARENT_GOVERNANCE_HEAD}^{commit}`]);
    git(['merge-base', '--is-ancestor', ACV2_WP_A_PARENT_GOVERNANCE_HEAD, 'HEAD']);
  } catch (cause) {
    return Object.freeze({
      applicable: true,
      pass: false,
      reasonCode: 'ACV2_WORK_PACKAGE_SCOPE_PARENT_UNAVAILABLE',
      parentGovernanceHead: ACV2_WP_A_PARENT_GOVERNANCE_HEAD,
      changedFileCount: 0,
      unauthorizedPaths: [],
      error: cause?.message || String(cause)
    });
  }

  let changedFiles;
  try {
    const raw = git(['diff', '--name-only', ACV2_WP_A_PARENT_GOVERNANCE_HEAD, 'HEAD']);
    changedFiles = raw ? raw.split(/\r?\n/u).map(value => value.trim()).filter(Boolean).sort() : [];
  } catch (cause) {
    return Object.freeze({
      applicable: true,
      pass: false,
      reasonCode: 'ACV2_WORK_PACKAGE_SCOPE_DIFF_FAILED',
      parentGovernanceHead: ACV2_WP_A_PARENT_GOVERNANCE_HEAD,
      changedFileCount: 0,
      unauthorizedPaths: [],
      error: cause?.message || String(cause)
    });
  }

  const amendment = loadWorkPackageScopeAmendment();
  const evaluation = evaluateAuthorizedWorkPackageScope({
    branch,
    changedFiles,
    authorization,
    amendment
  });
  return Object.freeze({
    applicable: true,
    parentGovernanceHead: ACV2_WP_A_PARENT_GOVERNANCE_HEAD,
    changedFileCount: changedFiles.length,
    ...evaluation
  });
}

function main() {
  const targetStage = argValue('--target-stage', CURRENT_STAGE);
  const reviewedBranch = resolveReviewedBranch(argValue('--branch', ''));
  const branch = reviewedBranch || currentBranch();
  const options = { targetStage };
  if (reviewedBranch) options.branch = reviewedBranch;
  const wp0 = verifyWp0Gate(options);
  const workPackageScope = evaluateWorkPackageScopeForGate(branch);
  const status = wp0.status === 'PASS' && workPackageScope.pass ? 'PASS' : 'FAIL';
  const result = Object.freeze({
    ...wp0,
    status,
    reasonCode: wp0.status !== 'PASS' ? wp0.reasonCode : workPackageScope.reasonCode,
    workPackageScope
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.status !== 'PASS') process.exitCode = 1;
}

try {
  main();
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    status: 'FAIL',
    reasonCode: error.reasonCode || error.code || 'WP0_GATE_INPUT_INVALID',
    message: error.message,
    details: error.details || {}
  }, null, 2)}\n`);
  process.exitCode = 1;
}
