'use strict';

const REBUILD_BRANCH_PATTERN_SOURCE = '^rebuild/windows-release-closure-([0-9]{4})([0-9]{2})([0-9]{2})(?:-[a-z0-9][a-z0-9._-]*)?$';
const REBUILD_BRANCH_PATTERN = new RegExp(REBUILD_BRANCH_PATTERN_SOURCE);

function canonicalStageBranch(stageVersion) {
  if (typeof stageVersion !== 'string' || !/^\d+\.\d+\.\d+\.\d+$/.test(stageVersion)) {
    throw new TypeError('stageVersion must use the numeric x.x.x.x form');
  }
  return `stage/${stageVersion}-architecture-closure`;
}

function isValidUtcCalendarDate(year, month, day) {
  const value = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return value.getUTCFullYear() === Number(year)
    && value.getUTCMonth() === Number(month) - 1
    && value.getUTCDate() === Number(day);
}

function isReleaseClosureRebuildBranch(branch) {
  if (typeof branch !== 'string') return false;
  const match = branch.match(REBUILD_BRANCH_PATTERN);
  return Boolean(match && isValidUtcCalendarDate(match[1], match[2], match[3]));
}

function isAuthorizedImplementationBranch(branch, stageVersion) {
  if (typeof branch !== 'string' || branch.length === 0) return false;
  return branch === canonicalStageBranch(stageVersion) || isReleaseClosureRebuildBranch(branch);
}

function authorizedImplementationBranchDescription(stageVersion) {
  return `${canonicalStageBranch(stageVersion)} or rebuild/windows-release-closure-YYYYMMDD[-suffix]`;
}

module.exports = {
  REBUILD_BRANCH_PATTERN_SOURCE,
  canonicalStageBranch,
  isReleaseClosureRebuildBranch,
  isAuthorizedImplementationBranch,
  authorizedImplementationBranchDescription
};
