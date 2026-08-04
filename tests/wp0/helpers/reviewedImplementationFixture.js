'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const REVIEWED_FIXTURE_BRANCH = 'rebuild/windows-release-closure-20260804-verification-fixture';
const LFS_POINTER_ENV = Object.freeze({ ...process.env, GIT_LFS_SKIP_SMUDGE: '1' });

function git(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: LFS_POINTER_ENV,
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
}

function resolveSourceIdentityBranch(sourceRoot, sourceCommit, options = {}) {
  const candidate = Object.prototype.hasOwnProperty.call(options, 'sourceIdentityBranch')
    ? String(options.sourceIdentityBranch || '')
    : git(sourceRoot, ['branch', '--show-current']);
  if (!candidate) return null;
  try {
    git(sourceRoot, ['check-ref-format', '--branch', candidate]);
    const tip = git(sourceRoot, ['rev-parse', `refs/heads/${candidate}`]);
    return tip === sourceCommit ? candidate : null;
  } catch (_) {
    return null;
  }
}

function createReviewedImplementationClone(options = {}) {
  const sourceRoot = path.resolve(options.sourceRoot || REPO_ROOT);
  const sourceCommit = options.sourceCommit || git(sourceRoot, ['rev-parse', 'HEAD']);
  if (!/^[0-9a-f]{40}$/u.test(sourceCommit)) {
    throw new Error('reviewed implementation fixture requires an exact source commit');
  }
  const sourceIdentityBranch = resolveSourceIdentityBranch(sourceRoot, sourceCommit, options);
  const branch = options.branch || REVIEWED_FIXTURE_BRANCH;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-wp0-reviewed-fixture-'));
  const repo = path.join(root, 'repo');
  execFileSync('git', [
    '-c', 'core.autocrlf=false',
    '-c', 'core.eol=lf',
    'clone',
    '--config', 'core.autocrlf=false',
    '--config', 'core.eol=lf',
    '--quiet',
    '--no-local',
    sourceRoot,
    repo
  ], { encoding: 'utf8', env: LFS_POINTER_ENV });

  git(repo, ['checkout', '--quiet', '--force', '-B', branch, sourceCommit]);
  git(repo, ['update-ref', `refs/remotes/origin/${branch}`, sourceCommit]);
  if (sourceIdentityBranch && sourceIdentityBranch !== branch) {
    git(repo, ['update-ref', `refs/remotes/origin/${sourceIdentityBranch}`, sourceCommit]);
  }

  const head = git(repo, ['rev-parse', 'HEAD']);
  const currentBranch = git(repo, ['branch', '--show-current']);
  const remoteTip = git(repo, ['rev-parse', `refs/remotes/origin/${branch}`]);
  const sourceIdentityTip = sourceIdentityBranch
    ? git(repo, ['rev-parse', `refs/remotes/origin/${sourceIdentityBranch}`])
    : null;
  if (head !== sourceCommit
    || currentBranch !== branch
    || remoteTip !== sourceCommit
    || (sourceIdentityBranch && sourceIdentityTip !== sourceCommit)) {
    fs.rmSync(root, { recursive: true, force: true });
    throw new Error('reviewed implementation fixture identity binding failed');
  }
  const status = git(repo, ['status', '--porcelain=v1', '--untracked-files=all']);
  if (status) {
    fs.rmSync(root, { recursive: true, force: true });
    throw new Error('reviewed implementation fixture is not clean');
  }

  return Object.freeze({
    root,
    repo,
    branch,
    sourceCommit,
    sourceIdentityBranch,
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
}

module.exports = {
  LFS_POINTER_ENV,
  REVIEWED_FIXTURE_BRANCH,
  createReviewedImplementationClone,
  git
};
