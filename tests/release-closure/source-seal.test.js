'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const projectRoot = path.resolve(__dirname, '..', '..');
const createScript = path.join(projectRoot, 'tools', 'release-closure', 'create-source-seal.js');
const verifyScript = path.join(projectRoot, 'tools', 'release-closure', 'verify-source-seal.js');

function run(command, args, cwd) {
  return spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true
  });
}

function git(repo, args) {
  const result = run('git', ['-C', repo, ...args], repo);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-source-seal-test-'));
  const repo = path.join(root, 'repo');
  const seal = path.join(root, 'seal');
  fs.mkdirSync(repo);
  fs.mkdirSync(seal);
  git(repo, ['init', '--quiet']);
  git(repo, ['config', 'user.name', 'Yance Seal Test']);
  git(repo, ['config', 'user.email', 'seal-test@yance.invalid']);
  git(repo, ['switch', '-c', 'rebuild/windows-release-closure-20260712-test']);
  fs.writeFileSync(path.join(repo, 'README.md'), 'stage6\n');
  fs.writeFileSync(path.join(repo, 'run.sh'), '#!/bin/sh\necho stage6\n');
  fs.chmodSync(path.join(repo, 'run.sh'), 0o755);
  git(repo, ['add', '--all']);
  git(repo, ['commit', '--quiet', '-m', 'stage6 fixture']);
  const base = git(repo, ['rev-parse', 'HEAD']);
  fs.writeFileSync(path.join(repo, 'README.md'), 'release closure\n');
  fs.writeFileSync(path.join(repo, 'binary.bin'), Buffer.from([0, 1, 2, 3, 255]));
  git(repo, ['add', '--all']);
  git(repo, ['commit', '--quiet', '-m', 'release closure fixture']);
  return { root, repo, seal, base, head: git(repo, ['rev-parse', 'HEAD']), tree: git(repo, ['rev-parse', 'HEAD^{tree}']) };
}

test('source seal creates independently verifiable Bundle, ZIP, patch and standard checksums', () => {
  const fixture = createFixture();
  try {
    const created = run(process.execPath, [createScript, '--repo', fixture.repo, '--base-commit', fixture.base, '--output-dir', fixture.seal], projectRoot);
    assert.equal(created.status, 0, `${created.stdout}\n${created.stderr}`);
    const identity = JSON.parse(fs.readFileSync(path.join(fixture.seal, 'SOURCE_SEAL_IDENTITY.json'), 'utf8'));
    assert.equal(identity.head, fixture.head);
    assert.equal(identity.tree, fixture.tree);

    const patchBytes = fs.readFileSync(path.join(fixture.seal, identity.patchFile));
    assert.notDeepEqual([...patchBytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);

    const checksumLines = fs.readFileSync(path.join(fixture.seal, 'SHA256SUMS.txt'), 'utf8').trim().split(/\r?\n/);
    assert.ok(checksumLines.length >= 6);
    for (const line of checksumLines) assert.match(line, /^[0-9a-f]{64}  [^\\]+$/);

    const verified = run(process.execPath, [verifyScript, '--seal-dir', fixture.seal], fixture.root);
    assert.equal(verified.status, 0, `${verified.stdout}\n${verified.stderr}`);
    assert.equal(JSON.parse(verified.stdout).pass, true);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test('source seal verifier rejects a tampered artifact', () => {
  const fixture = createFixture();
  try {
    const created = run(process.execPath, [createScript, '--repo', fixture.repo, '--base-commit', fixture.base, '--output-dir', fixture.seal], projectRoot);
    assert.equal(created.status, 0, `${created.stdout}\n${created.stderr}`);
    const identity = JSON.parse(fs.readFileSync(path.join(fixture.seal, 'SOURCE_SEAL_IDENTITY.json'), 'utf8'));
    fs.appendFileSync(path.join(fixture.seal, identity.patchFile), '\nTAMPERED\n');
    const verified = run(process.execPath, [verifyScript, '--seal-dir', fixture.seal], fixture.root);
    assert.equal(verified.status, 1);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test('accepted fix ledger is machine-readable and anchored to verified WP4/WP7 commits', () => {
  const ledger = JSON.parse(fs.readFileSync(path.join(projectRoot, 'governance', 'windows-release-closure', 'source-fix-ledger.json'), 'utf8'));
  assert.equal(ledger.authoritativeHistory.activationCommit, '4ac6d2185bed28823210849704f3850cd875b5fb');
  assert.equal(ledger.acceptedFixes[0].commit, '84a30d21477850034da66552099b44ea4cfb4f14');
  assert.equal(ledger.acceptedFixes[1].commit, '4352f8f800ce819aa608117260a6b28e11d8ff90');
  assert.equal(ledger.sealContract.generatedEvidenceMustRemainExternal, true);
});
