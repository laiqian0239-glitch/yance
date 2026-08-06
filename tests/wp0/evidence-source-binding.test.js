'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const test = require('node:test');
const assert = require('node:assert/strict');
const { REPO_ROOT } = require('../../tools/wp0/lib');

const FIXED_TIME = '2026-07-03T00:00:00Z';
const FIXTURE_BRANCH = 'stage/6.4.5.9-architecture-closure';
const ELECTRON_LFS_PATH = 'vendor/electron/electron-v39.8.5-win32-x64.zip';
const POST_MERGE_DEFECT_PATH = path.join(
  REPO_ROOT,
  'governance',
  'architecture-closure-v2',
  'wp-a-post-merge-defect-001.json'
);
const LFS_POINTER_ENV = Object.freeze({ ...process.env, GIT_LFS_SKIP_SMUDGE: '1' });

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: LFS_POINTER_ENV }).trim();
}

function assertPointerPreserved(repo) {
  const pointer = fs.readFileSync(path.join(repo, ELECTRON_LFS_PATH), 'utf8');
  assert.match(pointer, /^version https:\/\/git-lfs\.github\.com\/spec\/v1\r?\n/u);
  assert.match(pointer, /^oid sha256:d75c0057fd58c08023ff82ed9dd38443f90b4a962c9a9359aa74d9070f4add34$/mu);
  assert.match(pointer, /^size 136644393$/mu);
}

function makeCleanClone() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-wp0-source-binding-'));
  const repo = path.join(root, 'repo');
  const sourceCommit = git(REPO_ROOT, ['rev-parse', 'HEAD']);
  const args = [
    '-c', 'core.autocrlf=false',
    '-c', 'core.eol=lf',
    'clone',
    '--config', 'core.autocrlf=false',
    '--config', 'core.eol=lf',
    '--quiet',
    '--no-local',
    REPO_ROOT,
    repo
  ];
  execFileSync('git', args, { encoding: 'utf8', env: LFS_POINTER_ENV });
  execFileSync('git', ['switch', '--force-create', FIXTURE_BRANCH, sourceCommit], {
    cwd: repo,
    encoding: 'utf8',
    env: LFS_POINTER_ENV
  });
  assert.equal(git(repo, ['rev-parse', 'HEAD']), sourceCommit, 'WP0 evidence fixture must use the tested HEAD');
  assert.equal(git(repo, ['branch', '--show-current']), FIXTURE_BRANCH);
  assertPointerPreserved(repo);
  return { root, repo, sourceBranch: FIXTURE_BRANCH, sourceCommit };
}

function runGenerator(repo, args = []) {
  const result = spawnSync(process.execPath, ['tools/wp0/generate-evidence.js', ...args], {
    cwd: repo,
    encoding: 'utf8',
    env: LFS_POINTER_ENV
  });
  let json = null;
  try { json = JSON.parse(result.stdout); } catch { json = null; }
  return { ...result, json };
}

function fileMap(root) {
  const map = new Map();
  for (const name of fs.readdirSync(root).sort()) {
    const full = path.join(root, name);
    if (fs.statSync(full).isFile()) map.set(name, fs.readFileSync(full));
  }
  return map;
}

test('evidence generator rejects an existing commit that is not the tested HEAD', () => {
  const { repo } = makeCleanClone();
  const wrongCommit = git(repo, ['rev-parse', 'HEAD^']);
  const result = runGenerator(repo, ['--source-commit', wrongCommit, '--generated-at-utc', FIXED_TIME]);
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  assert.equal(result.json?.reasonCode, 'WP0_EVIDENCE_SOURCE_COMMIT_MISMATCH');
  assert.equal(result.json?.actualHead, git(repo, ['rev-parse', 'HEAD']));
});

test('evidence generator rejects a nonexistent sourceCommit', () => {
  const { repo } = makeCleanClone();
  const result = runGenerator(repo, ['--source-commit', '0000000000000000000000000000000000000000', '--generated-at-utc', FIXED_TIME]);
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  assert.equal(result.json?.reasonCode, 'WP0_EVIDENCE_SOURCE_COMMIT_NOT_FOUND');
});

test('evidence generator rejects a dirty worktree before executing any branch gate', () => {
  const { repo } = makeCleanClone();
  const head = git(repo, ['rev-parse', 'HEAD']);
  fs.appendFileSync(path.join(repo, 'governance', 'stage-policy.json'), '\n');
  const result = runGenerator(repo, ['--source-commit', head, '--generated-at-utc', FIXED_TIME]);
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  assert.equal(result.json?.reasonCode, 'WP0_EVIDENCE_REPOSITORY_DIRTY');
  assert.equal(result.json?.repositoryClean, false);
});

test('correct clean HEAD records commit tree and produces byte-identical evidence in isolated canonical-stage fixtures', () => {
  const { root, repo } = makeCleanClone();
  const head = git(repo, ['rev-parse', 'HEAD']);
  const tree = git(repo, ['rev-parse', 'HEAD^{tree}']);
  const outA = path.join(root, 'evidence-a');
  const outB = path.join(root, 'evidence-b');
  const args = ['--source-commit', head, '--generated-at-utc', FIXED_TIME];
  const first = runGenerator(repo, [...args, '--output-dir', outA]);
  const second = runGenerator(repo, [...args, '--output-dir', outB]);
  assert.equal(first.status, 0, first.stdout + first.stderr);
  assert.equal(second.status, 0, second.stdout + second.stderr);
  const required = JSON.parse(fs.readFileSync(path.join(outA, 'required-tests.json'), 'utf8'));
  assert.equal(required.sourceCommit, head);
  assert.equal(required.sourceTree, tree);
  assert.equal(required.repositoryClean, true);
  assert.equal(required.branch, FIXTURE_BRANCH);
  const index = JSON.parse(fs.readFileSync(path.join(outA, 'evidence-index.json'), 'utf8'));
  assert.equal(index.evidenceOutputDirectory, '.');
  assert.equal(JSON.stringify(index).includes(outA), false);
  assert.equal(JSON.stringify(index).includes(outB), false);
  const mapA = fileMap(outA);
  const mapB = fileMap(outB);
  assert.deepEqual([...mapA.keys()], [...mapB.keys()]);
  for (const [name, bytes] of mapA) assert.deepEqual(bytes, mapB.get(name), `${name} differs across output directories`);
});

test('historical detached evidence succeeds only at the frozen post-merge defect closure commit', () => {
  const { root, repo } = makeCleanClone();
  const defect = JSON.parse(fs.readFileSync(POST_MERGE_DEFECT_PATH, 'utf8'));
  const historical = defect.scope.closedHead;
  assert.notEqual(git(repo, ['rev-parse', 'HEAD']), historical);
  git(repo, ['cat-file', '-e', `${historical}^{commit}`]);
  const worktree = path.join(root, 'historical-worktree');
  execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'core.eol=lf', 'worktree', 'add', '--quiet', '--detach', worktree, historical], {
    cwd: repo,
    encoding: 'utf8',
    env: LFS_POINTER_ENV
  });
  assertPointerPreserved(worktree);
  const out = path.join(root, 'historical-evidence');
  const result = runGenerator(worktree, ['--source-commit', historical, '--generated-at-utc', FIXED_TIME, '--output-dir', out]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const required = JSON.parse(fs.readFileSync(path.join(out, 'required-tests.json'), 'utf8'));
  assert.equal(required.sourceCommit, historical);
  assert.equal(required.sourceTree, git(worktree, ['rev-parse', 'HEAD^{tree}']));
  assert.equal(required.repositoryClean, true);
  assert.equal(required.branch, null);
});
