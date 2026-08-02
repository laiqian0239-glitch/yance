'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const test = require('node:test');
const assert = require('node:assert/strict');
const delivery = require('../../tools/runtime-delivery/source-uat-delivery');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DERIVED_IDENTITY = 'YANCE_DERIVED_SOURCE_IDENTITY.json';
const VALID_IDENTITY_OPTIONS = Object.freeze({
  derivedVersion: 'SEALED_EXPORT_AUTHORITY_TEST',
  releaseBatch: 'BATCH40',
  baseCommit: '1'.repeat(40),
  baseTree: '2'.repeat(40),
  generatedAtUtc: '2026-08-02T00:00:00.000Z'
});

function git(args) {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
}

function createMinimalExport(root) {
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'payload.txt'), 'sealed payload\n', 'utf8');
  return root;
}

test('mutable Git repository does not track an export-derived source identity', () => {
  const tracked = spawnSync('git', ['ls-files', '--error-unmatch', DERIVED_IDENTITY], {
    cwd: REPO_ROOT,
    encoding: 'utf8'
  });
  assert.notEqual(tracked.status, 0, `${DERIVED_IDENTITY} must not be tracked in a mutable repository`);

  const ignored = spawnSync('git', ['check-ignore', '--quiet', '--', DERIVED_IDENTITY], {
    cwd: REPO_ROOT,
    encoding: 'utf8'
  });
  assert.equal(ignored.status, 0, `${DERIVED_IDENTITY} must be ignored at repository root`);
});

test('repository artifact descriptor truthfully declares runtime Git identity and no payload seal', () => {
  const descriptor = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'YANCE_ARTIFACT_DESCRIPTOR.json'), 'utf8'));
  assert.equal(descriptor.schemaVersion, 3);
  assert.equal(descriptor.documentType, 'YANCE_ARTIFACT_DESCRIPTOR');
  assert.equal(descriptor.artifactType, 'MUTABLE_GIT_IMPLEMENTATION_REPOSITORY');
  assert.equal(descriptor.candidate, false);
  assert.equal(descriptor.formalRelease, false);
  assert.equal(descriptor.sourceIdentity?.authority, 'GIT_HEAD_AT_RUNTIME');
  assert.equal(descriptor.sourceIdentity?.commitResolution, 'git rev-parse HEAD');
  assert.equal(descriptor.sourceIdentity?.treeResolution, 'git rev-parse HEAD^{tree}');
  assert.equal(descriptor.governance?.readyForPromotion, false);
  assert.equal(descriptor.governance?.candidatePackageGenerated, false);
  assert.equal(descriptor.identityProtocol?.derivedPayloadBoundBySha256, false);
  assert.equal(descriptor.identityProtocol?.trackedDerivedIdentityForbidden, true);
  assert.equal(descriptor.identityProtocol?.derivedIdentityGeneratedAtExport, true);

  const identity = delivery.resolveSourceIdentity(REPO_ROOT, { allowDirty: true });
  assert.equal(identity.source, 'git');
  assert.equal(identity.commit, git(['rev-parse', 'HEAD']));
  assert.equal(identity.tree, git(['rev-parse', 'HEAD^{tree}']));
});

test('derived identity CLI rejects a mutable Git repository root', () => {
  const child = spawnSync(process.execPath, [
    'tools/runtime-delivery/create-derived-source-identity.js',
    '--derived-version=REPOSITORY_ROOT_MUST_BE_REJECTED',
    '--release-batch=BATCH40',
    `--base-commit=${'1'.repeat(40)}`,
    `--base-tree=${'2'.repeat(40)}`
  ], {
    cwd: REPO_ROOT,
    encoding: 'utf8'
  });
  assert.notEqual(child.status, 0);
  const error = JSON.parse(child.stderr);
  assert.equal(error.reasonCode, 'SOURCE_UAT_DERIVED_IDENTITY_GIT_ROOT_FORBIDDEN');
});

test('derived identity API rejects an export directory nested inside a Git worktree', () => {
  const repositoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-derived-parent-git-'));
  try {
    execFileSync('git', ['init', '--quiet', repositoryRoot], { encoding: 'utf8' });
    const nestedExport = createMinimalExport(path.join(repositoryRoot, 'exports', 'candidate'));
    assert.throws(
      () => delivery.createDerivedSourceIdentity(nestedExport, VALID_IDENTITY_OPTIONS),
      error => error?.reasonCode === 'SOURCE_UAT_DERIVED_IDENTITY_GIT_ROOT_FORBIDDEN'
        && error?.details?.gitMetadataPath,
      'a subdirectory of a mutable worktree must never be treated as a sealed export'
    );
  } finally {
    fs.rmSync(repositoryRoot, { recursive: true, force: true });
  }
});

test('derived identity CLI rejects an export directory nested inside a Git worktree', () => {
  const repositoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-derived-cli-parent-git-'));
  try {
    execFileSync('git', ['init', '--quiet', repositoryRoot], { encoding: 'utf8' });
    const nestedExport = createMinimalExport(path.join(repositoryRoot, 'exports', 'candidate'));
    const child = spawnSync(process.execPath, [
      path.join(REPO_ROOT, 'tools', 'runtime-delivery', 'create-derived-source-identity.js'),
      `--root=${nestedExport}`,
      '--derived-version=NESTED_WORKTREE_MUST_BE_REJECTED',
      '--release-batch=BATCH40',
      `--base-commit=${'1'.repeat(40)}`,
      `--base-tree=${'2'.repeat(40)}`
    ], {
      cwd: nestedExport,
      encoding: 'utf8'
    });
    assert.notEqual(child.status, 0);
    const error = JSON.parse(child.stderr);
    assert.equal(error.reasonCode, 'SOURCE_UAT_DERIVED_IDENTITY_GIT_ROOT_FORBIDDEN');
    assert.ok(error.details?.gitMetadataPath);
  } finally {
    fs.rmSync(repositoryRoot, { recursive: true, force: true });
  }
});

test('derived identity API rejects embedded Git metadata below the export root', () => {
  const exportRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-derived-embedded-git-'));
  try {
    createMinimalExport(exportRoot);
    const embeddedGit = path.join(exportRoot, 'vendor', 'source', '.git');
    fs.mkdirSync(embeddedGit, { recursive: true });
    fs.writeFileSync(path.join(embeddedGit, 'HEAD'), 'ref: refs/heads/main\n', 'utf8');
    assert.throws(
      () => delivery.createDerivedSourceIdentity(exportRoot, VALID_IDENTITY_OPTIONS),
      error => error?.reasonCode === 'SOURCE_UAT_DERIVED_IDENTITY_GIT_ROOT_FORBIDDEN'
        && path.resolve(error?.details?.gitMetadataPath || '') === path.resolve(embeddedGit),
      'embedded mutable VCS metadata must invalidate the entire export seal'
    );
  } finally {
    fs.rmSync(exportRoot, { recursive: true, force: true });
  }
});
