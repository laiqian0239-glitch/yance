'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { verifySourceZip } = require('../../tools/wp7/verify-convergence-pre-review-candidate');

const REPO = path.resolve(__dirname, '..', '..');

function git(args) {
  return execFileSync('git', args, { cwd: REPO, encoding: 'utf8' }).trim();
}

test('candidate Source ZIP is independently verified as exact Git content and mode projection', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wp7-candidate-source-'));
  try {
    const zipPath = path.join(root, 'source.zip');
    const head = git(['rev-parse', 'HEAD']);
    execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'core.eol=lf', 'archive', '--format=zip', `--output=${zipPath}`, head], { cwd: REPO });
    const result = await verifySourceZip(REPO, head, zipPath);
    assert.equal(result.trackedBlobCount, result.zipFileCount);
    assert.equal(result.missing, 0);
    assert.equal(result.extra, 0);
    assert.equal(result.contentOrModeMismatches, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test('candidate Source ZIP verifier rejects an unreviewed extra file', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wp7-candidate-source-extra-'));
  try {
    const zipPath = path.join(root, 'source.zip');
    const head = git(['rev-parse', 'HEAD']);
    const mutatedRepo = path.join(root, 'mutated-repo');
    execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'core.eol=lf', 'clone', '--config', 'core.autocrlf=false', '--config', 'core.eol=lf', '--quiet', '--no-hardlinks', REPO, mutatedRepo]);
    execFileSync('git', ['config', 'user.email', 'wp7-candidate-test@example.invalid'], { cwd: mutatedRepo });
    execFileSync('git', ['config', 'user.name', 'WP7 Candidate Test'], { cwd: mutatedRepo });
    fs.writeFileSync(path.join(mutatedRepo, 'unreviewed-extra.txt'), 'not reviewed\n');
    execFileSync('git', ['add', 'unreviewed-extra.txt'], { cwd: mutatedRepo });
    execFileSync('git', ['commit', '--quiet', '-m', 'unreviewed extra fixture'], { cwd: mutatedRepo });
    const mutatedHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: mutatedRepo, encoding: 'utf8' }).trim();
    execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'core.eol=lf', 'archive', '--format=zip', `--output=${zipPath}`, mutatedHead], { cwd: mutatedRepo });
    await assert.rejects(() => verifySourceZip(REPO, head, zipPath), (error) => error?.reasonCode === 'WP7_CANDIDATE_SOURCE_ZIP_INVALID');
  } finally {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});
