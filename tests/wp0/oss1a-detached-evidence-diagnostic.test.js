'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  LFS_POINTER_ENV,
  createReviewedImplementationClone,
  git
} = require('./helpers/reviewedImplementationFixture');

const FIXED_TIME = '2026-07-03T00:00:00Z';

function readJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch (_) { return null; }
}

function conciseFailure(outputDir) {
  const required = readJson(path.join(outputDir, 'required-tests.json'));
  const local = readJson(path.join(outputDir, 'local-command-gates.json'));
  return {
    requiredFailedReasonCodes: required?.failedReasonCodes || [],
    requiredFailures: (required?.results || [])
      .filter(item => item?.pass !== true)
      .map(item => ({
        reasonCode: item?.reasonCode || null,
        scopeReasonCode: item?.details?.workPackageScope?.reasonCode
          || item?.details?.scope?.reasonCode
          || item?.workPackageScope?.reasonCode
          || null,
        scopeChangedFileCount: item?.details?.workPackageScope?.changedFileCount
          ?? item?.details?.scope?.changedFileCount
          ?? item?.workPackageScope?.changedFileCount
          ?? null,
        scopeUnauthorizedPaths: item?.details?.workPackageScope?.unauthorizedPaths
          || item?.details?.scope?.unauthorizedPaths
          || item?.workPackageScope?.unauthorizedPaths
          || []
      })),
    localStatus: local?.status || null,
    localExecutions: (local?.executions || []).map(item => ({
      command: item?.command || null,
      status: item?.status || null,
      reasonCode: item?.reasonCode || null,
      scopeReasonCode: item?.scope?.reasonCode || item?.workPackageScope?.reasonCode || null,
      scopeChangedFileCount: item?.scope?.changedFileCount ?? item?.workPackageScope?.changedFileCount ?? null,
      scopeUnauthorizedPaths: item?.scope?.unauthorizedPaths || item?.workPackageScope?.unauthorizedPaths || []
    }))
  };
}

test('diagnostic: detached evidence with OSS-1A identity emits exact failing sub-gates', t => {
  const fixture = createReviewedImplementationClone();
  t.after(() => fixture.cleanup());
  git(fixture.repo, ['update-ref', 'refs/remotes/origin/oss/1a-baileys-lifecycle', fixture.sourceCommit]);

  const historical = git(fixture.repo, ['rev-parse', 'HEAD']);
  execFileSync('git', ['config', 'user.name', 'WP0 Diagnostic'], { cwd: fixture.repo, env: LFS_POINTER_ENV });
  execFileSync('git', ['config', 'user.email', 'wp0-diagnostic@example.invalid'], { cwd: fixture.repo, env: LFS_POINTER_ENV });
  execFileSync('git', ['commit', '--allow-empty', '--quiet', '-m', 'temporary newer commit'], { cwd: fixture.repo, env: LFS_POINTER_ENV });

  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-oss1a-evidence-diagnostic-'));
  t.after(() => fs.rmSync(worktree, { recursive: true, force: true }));
  execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'core.eol=lf', 'worktree', 'add', '--quiet', '--detach', worktree, historical], {
    cwd: fixture.repo,
    encoding: 'utf8',
    env: LFS_POINTER_ENV
  });
  const outputDir = path.join(fixture.root, 'diagnostic-evidence');
  const result = spawnSync(process.execPath, [
    'tools/wp0/generate-evidence.js',
    '--source-commit', historical,
    '--generated-at-utc', FIXED_TIME,
    '--output-dir', outputDir
  ], {
    cwd: worktree,
    encoding: 'utf8',
    env: LFS_POINTER_ENV
  });

  assert.fail(JSON.stringify({
    generatorExitCode: result.status,
    generatorStdout: String(result.stdout || '').trim(),
    generatorStderr: String(result.stderr || '').trim(),
    ...conciseFailure(outputDir)
  }));
});
