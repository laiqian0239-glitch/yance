'use strict';

const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { TextDecoder } = require('node:util');
const {
  TRUSTED_MAIN_DELEGATED_GOVERNANCE_MODE,
  buildTrustedGitEnvironment,
  evaluateTrustedDelegatedGovernanceBranch,
  workPackageChangedFilesSha256
} = require('../../shared/release/implementationBranchPolicy');
const { argValue, runJsonCli } = require('./cli-support');

const ROOT = path.resolve(__dirname, '..', '..');
const SHA40 = /^[0-9a-f]{40}$/u;

function isExactBranch(value) {
  const branch = String(value || '');
  return Boolean(branch
    && branch === branch.trim()
    && !branch.startsWith('-')
    && !branch.startsWith('/')
    && !branch.endsWith('/')
    && !branch.includes('//')
    && !/[\u0000-\u0020\u007f~^:?*[\]\\]/u.test(branch)
    && branch.split('/').every(part => part && part !== '.' && part !== '..' && !part.endsWith('.lock')));
}

function frozenFailure(reasonCode, extra = {}) {
  return Object.freeze({
    pass: false,
    reasonCode,
    route: null,
    readyForPromotion: false,
    ...extra
  });
}

function normalizeExactPaths(value) {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !item.length)) return null;
  const normalized = [...new Set(value)].sort();
  return normalized.length === value.length ? normalized : null;
}

function verifyDelegatedProductL2Candidate(input = {}, dependencies = {}) {
  const candidateBranch = String(input.candidateBranch || '');
  const candidateSha = String(input.candidateSha || '');
  const expectedTree = String(input.expectedTree || '');
  const requiredLevel = String(input.requiredLevel || '');
  const suite = String(input.suite || '');

  if (!isExactBranch(candidateBranch)
    || !SHA40.test(candidateSha)
    || !SHA40.test(expectedTree)
    || requiredLevel !== 'L2'
    || suite !== 'full_work_package') {
    return frozenFailure('L2_DELEGATED_PRODUCT_ROUTE_INVALID');
  }

  if (typeof dependencies.evaluateAuthority !== 'function') {
    return frozenFailure('WP0_DELEGATED_GOVERNANCE_AUTHORITY_INVALID');
  }
  const authority = dependencies.evaluateAuthority({ candidateBranch, candidateSha });
  if (!authority || authority.pass !== true) {
    return frozenFailure(
      authority?.reasonCode || 'WP0_DELEGATED_GOVERNANCE_AUTHORITY_INVALID'
    );
  }
  if (authority.authorityMode !== TRUSTED_MAIN_DELEGATED_GOVERNANCE_MODE
    || typeof authority.authorizationPath !== 'string'
    || !SHA40.test(String(authority.authorizationMergeCommit || ''))
    || !SHA40.test(String(authority.implementationBase || ''))) {
    return frozenFailure('WP0_DELEGATED_GOVERNANCE_AUTHORITY_INVALID');
  }

  if (typeof dependencies.loadAuthorizationAtTrustedHead !== 'function') {
    return frozenFailure('L2_DELEGATED_PRODUCT_AUTHORIZATION_INVALID');
  }
  const authorization = dependencies.loadAuthorizationAtTrustedHead(authority.authorizationPath);
  const implementation = authorization?.implementation;
  const allowedPaths = normalizeExactPaths(implementation?.allowedChangedPaths);
  if (!implementation
    || implementation.branch !== candidateBranch
    || !allowedPaths
    || !Number.isSafeInteger(implementation.approvedChangedFileCount)
    || !/^[0-9a-f]{64}$/u.test(String(implementation.approvedChangedFileSetSha256 || ''))) {
    return frozenFailure('L2_DELEGATED_PRODUCT_AUTHORIZATION_INVALID');
  }

  if (typeof dependencies.resolveCandidateTree !== 'function'
    || dependencies.resolveCandidateTree(candidateSha) !== expectedTree) {
    return frozenFailure('L2_DELEGATED_PRODUCT_TREE_MISMATCH');
  }
  if (typeof dependencies.resolveRemoteBranchTip !== 'function'
    || dependencies.resolveRemoteBranchTip(candidateBranch) !== candidateSha) {
    return frozenFailure('L2_DELEGATED_PRODUCT_REMOTE_REF_MISMATCH');
  }
  if (typeof dependencies.resolveChangedFilesBetween !== 'function') {
    return frozenFailure('L2_DELEGATED_PRODUCT_SCOPE_MISMATCH');
  }

  const actualPaths = normalizeExactPaths(
    dependencies.resolveChangedFilesBetween(authority.implementationBase, candidateSha)
  );
  const approvedDigest = implementation.approvedChangedFileSetSha256;
  if (!actualPaths
    || actualPaths.length !== implementation.approvedChangedFileCount
    || allowedPaths.length !== implementation.approvedChangedFileCount
    || JSON.stringify(actualPaths) !== JSON.stringify(allowedPaths)
    || workPackageChangedFilesSha256(actualPaths) !== approvedDigest
    || workPackageChangedFilesSha256(allowedPaths) !== approvedDigest) {
    return frozenFailure('L2_DELEGATED_PRODUCT_SCOPE_MISMATCH');
  }

  return Object.freeze({
    pass: true,
    reasonCode: null,
    route: 'DELEGATED_PRODUCT_L2',
    readyForPromotion: false,
    candidateBranch,
    candidateSha,
    expectedTree,
    authorizationPath: authority.authorizationPath,
    authorizationMergeCommit: authority.authorizationMergeCommit,
    changedFileCount: actualPaths.length,
    changedFileSetSha256: approvedDigest
  });
}

function git(args, options = {}) {
  return execFileSync('git', args, {
    cwd: ROOT,
    encoding: options.encoding === null ? null : 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: buildTrustedGitEnvironment(process.env),
    timeout: 15000,
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true
  });
}

function exactCommit(ref) {
  try {
    const value = git(['rev-parse', `${ref}^{commit}`]).trim();
    return SHA40.test(value) ? value : null;
  } catch (_) {
    return null;
  }
}

function loadJsonAt(commit, repositoryPath) {
  try {
    const value = JSON.parse(git(['show', `${commit}:${repositoryPath}`]));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch (_) {
    return null;
  }
}

function changedFilesBetween(base, head) {
  try {
    const output = git(['diff', '--no-renames', '--name-only', '-z', base, head, '--'], { encoding: null });
    if (output.length === 0) return [];
    if (output[output.length - 1] !== 0) return null;
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(output.subarray(0, -1));
    if (!decoded.length) return [];
    const values = decoded.split('\0');
    return values.some(value => !value.length) ? null : values;
  } catch (_) {
    return null;
  }
}

function prepareGitDependencies(candidateBranch, candidateSha) {
  if (!isExactBranch(candidateBranch) || !SHA40.test(candidateSha)) {
    return null;
  }
  try {
    git(['fetch', '--no-tags', '--force', 'origin',
      'main:refs/remotes/origin/main',
      `${candidateBranch}:refs/remotes/origin/${candidateBranch}`,
      candidateSha]);
  } catch (_) {
    return null;
  }

  const trustedMainHead = exactCommit('refs/remotes/origin/main');
  if (!trustedMainHead) return null;
  return Object.freeze({
    evaluateAuthority: () => evaluateTrustedDelegatedGovernanceBranch({
      branch: candidateBranch,
      evaluatedHead: candidateSha,
      trustedMainHead
    }),
    loadAuthorizationAtTrustedHead: repositoryPath => loadJsonAt(trustedMainHead, repositoryPath),
    resolveCandidateTree: sha => {
      try {
        const value = git(['rev-parse', `${sha}^{tree}`]).trim();
        return SHA40.test(value) ? value : null;
      } catch (_) {
        return null;
      }
    },
    resolveRemoteBranchTip: branch => exactCommit(`refs/remotes/origin/${branch}`),
    resolveChangedFilesBetween: changedBase => changedFilesBetween(changedBase, candidateSha)
  });
}

function cliInput(argv) {
  return {
    candidateSha: argValue(argv, '--candidate-sha'),
    candidateBranch: argValue(argv, '--candidate-branch'),
    expectedTree: argValue(argv, '--expected-tree'),
    requiredLevel: argValue(argv, '--required-level'),
    suite: argValue(argv, '--suite')
  };
}

if (require.main === module) {
  runJsonCli(() => {
    const input = cliInput(process.argv.slice(2));
    const dependencies = prepareGitDependencies(input.candidateBranch, input.candidateSha);
    if (!dependencies) return frozenFailure('L2_DELEGATED_PRODUCT_GIT_IDENTITY_INVALID');
    return verifyDelegatedProductL2Candidate(input, dependencies);
  }, 'L2_DELEGATED_PRODUCT_VERIFICATION_FAILED');
}

module.exports = {
  verifyDelegatedProductL2Candidate,
  prepareGitDependencies
};
