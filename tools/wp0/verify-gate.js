'use strict';

const { CURRENT_STAGE, currentCommit, git, verifyWp0Gate } = require('./lib');

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

function main() {
  const targetStage = argValue('--target-stage', CURRENT_STAGE);
  const reviewedBranch = resolveReviewedBranch(argValue('--branch', ''));
  const options = { targetStage };
  if (reviewedBranch) options.branch = reviewedBranch;
  const result = verifyWp0Gate(options);
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
