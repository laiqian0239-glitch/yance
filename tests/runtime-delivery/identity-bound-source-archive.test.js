'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { execFileSync } = require('node:child_process');

const {
  createIdentityBoundSourceArchive,
  readZipTextEntry,
  verifyIdentityBoundSourceArchive,
} = require('../../tools/runtime-delivery/identity-bound-source-archive');

function git(repo, args) {
  return String(execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' })).trim();
}

function fixtureRepository() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-identity-archive-'));
  const repo = path.join(root, 'repo');
  fs.mkdirSync(repo, { recursive: true });
  execFileSync('git', ['init', '-q', repo]);
  execFileSync('git', ['-C', repo, 'config', 'user.name', 'Identity Archive Test']);
  execFileSync('git', ['-C', repo, 'config', 'user.email', 'identity@test.invalid']);
  fs.writeFileSync(path.join(repo, 'app.txt'), 'current source\n');
  fs.writeFileSync(path.join(repo, 'YANCE_SOURCE_CHECKPOINT.json'), JSON.stringify({ commit: 'stale-batch37' }) + '\n');
  fs.writeFileSync(path.join(repo, 'YANCE_ARTIFACT_DESCRIPTOR.json'), JSON.stringify({ artifactId: 'stale-batch37' }) + '\n');
  execFileSync('git', ['-C', repo, 'add', '.']);
  execFileSync('git', ['-C', repo, 'commit', '-qm', 'fixture']);
  return { root, repo };
}

test('identity-bound archive replaces stale tracked identity documents and verifies exact HEAD identity', () => {
  const { root, repo } = fixtureRepository();
  const outputPath = path.join(root, 'candidate.zip');
  const identity = {
    branch: git(repo, ['branch', '--show-current']),
    commit: git(repo, ['rev-parse', 'HEAD']),
    tree: git(repo, ['rev-parse', 'HEAD^{tree}']),
    parent: null,
  };

  const result = createIdentityBoundSourceArchive({
    repoRoot: repo,
    outputPath,
    identity,
    artifact: {
      artifactType: 'WINDOWS_FULL_ACCEPTANCE_SOURCE_CANDIDATE',
      artifactClass: 'FIX6C_WINDOWS_UI_SOURCE_CANDIDATE',
      artifactId: 'yance-batch40-fix6c-ui',
      formalRelease: false,
      readyForPromotion: false,
    },
  });

  const checkpoint = JSON.parse(readZipTextEntry(outputPath, 'YANCE_SOURCE_CHECKPOINT.json'));
  const descriptor = JSON.parse(readZipTextEntry(outputPath, 'YANCE_ARTIFACT_DESCRIPTOR.json'));
  assert.equal(checkpoint.commit, identity.commit);
  assert.equal(checkpoint.tree, identity.tree);
  assert.notEqual(checkpoint.commit, 'stale-batch37');
  assert.equal(descriptor.sourceIdentity.commit, identity.commit);
  assert.equal(descriptor.sourceIdentity.tree, identity.tree);
  assert.equal(descriptor.artifactId, 'yance-batch40-fix6c-ui');
  assert.equal(descriptor.artifactType, 'WINDOWS_FULL_ACCEPTANCE_SOURCE_CANDIDATE');
  assert.equal(result.verification.ok, true);
  assert.equal(verifyIdentityBoundSourceArchive({ archivePath: outputPath, identity, artifactId: descriptor.artifactId }).ok, true);
});

test('identity-bound archive verification rejects a declared identity that differs from archive content', () => {
  const { root, repo } = fixtureRepository();
  const outputPath = path.join(root, 'candidate.zip');
  const identity = {
    branch: git(repo, ['branch', '--show-current']),
    commit: git(repo, ['rev-parse', 'HEAD']),
    tree: git(repo, ['rev-parse', 'HEAD^{tree}']),
    parent: null,
  };
  createIdentityBoundSourceArchive({
    repoRoot: repo,
    outputPath,
    identity,
    artifact: { artifactClass: 'TEST', artifactId: 'candidate', formalRelease: false, readyForPromotion: false },
  });

  assert.throws(
    () => verifyIdentityBoundSourceArchive({ archivePath: outputPath, identity: { ...identity, tree: '0'.repeat(40) }, artifactId: 'candidate' }),
    /tree mismatch/u,
  );
});
