'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const test = require('node:test');
const assert = require('node:assert/strict');
const delivery = require('../../tools/runtime-delivery/source-uat-delivery');
const { assertSealedExportRoot } = require('../../tools/runtime-delivery/sealed-export-authority');

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

function createDirectoryLink(target, linkPath) {
  fs.symlinkSync(target, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
  return linkPath;
}

function comparablePhysicalPath(value) {
  const physical = fs.realpathSync.native(path.resolve(value));
  return process.platform === 'win32' ? physical.toLowerCase() : physical;
}

function samePhysicalPath(left, right) {
  try {
    return comparablePhysicalPath(left) === comparablePhysicalPath(right);
  } catch (_) {
    return false;
  }
}

function derivedIdentityCliArgs(exportRoot, derivedVersion) {
  return [
    path.join(REPO_ROOT, 'tools', 'runtime-delivery', 'create-derived-source-identity.js'),
    `--root=${exportRoot}`,
    `--derived-version=${derivedVersion}`,
    '--release-batch=BATCH40',
    `--base-commit=${'1'.repeat(40)}`,
    `--base-tree=${'2'.repeat(40)}`
  ];
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

test('derived identity API accepts a true Git-free export and binds its payload', () => {
  const exportRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-derived-git-free-'));
  try {
    createMinimalExport(exportRoot);
    const document = delivery.createDerivedSourceIdentity(exportRoot, VALID_IDENTITY_OPTIONS);
    assert.equal(document.documentType, 'YANCE_DERIVED_SOURCE_IDENTITY');
    assert.match(document.payloadManifestSha256, /^[0-9a-f]{64}$/u);
    assert.equal(delivery.resolveSourceIdentity(exportRoot).payloadManifestSha256, document.payloadManifestSha256);
  } finally {
    fs.rmSync(exportRoot, { recursive: true, force: true });
  }
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
        && error?.details?.relation === 'GIT_REV_PARSE_CONTEXT'
        && Boolean(error?.details?.gitMetadataPath),
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
    const child = spawnSync(process.execPath, derivedIdentityCliArgs(nestedExport, 'NESTED_WORKTREE_MUST_BE_REJECTED'), {
      cwd: nestedExport,
      encoding: 'utf8'
    });
    assert.notEqual(child.status, 0);
    const error = JSON.parse(child.stderr);
    assert.equal(error.reasonCode, 'SOURCE_UAT_DERIVED_IDENTITY_GIT_ROOT_FORBIDDEN');
    assert.equal(error.details?.relation, 'GIT_REV_PARSE_CONTEXT');
    assert.ok(error.details?.gitMetadataPath);
  } finally {
    fs.rmSync(repositoryRoot, { recursive: true, force: true });
  }
});

test('derived identity API rejects a root-level .git file even when its target is invalid', () => {
  const exportRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-derived-git-file-'));
  try {
    createMinimalExport(exportRoot);
    const gitFile = path.join(exportRoot, '.git');
    fs.writeFileSync(gitFile, 'gitdir: ../missing-git-directory\n', 'utf8');
    assert.throws(
      () => delivery.createDerivedSourceIdentity(exportRoot, VALID_IDENTITY_OPTIONS),
      error => error?.reasonCode === 'SOURCE_UAT_DERIVED_IDENTITY_GIT_ROOT_FORBIDDEN'
        && samePhysicalPath(error?.details?.gitMetadataPath || '', gitFile),
      'a .git file is mutable repository metadata and must invalidate the export seal'
    );
  } finally {
    fs.rmSync(exportRoot, { recursive: true, force: true });
  }
});

test('derived identity CLI isolates Git discovery from inherited GIT environment', () => {
  const repositoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-derived-env-git-'));
  const exportRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-derived-env-export-'));
  try {
    execFileSync('git', ['init', '--quiet', repositoryRoot], { encoding: 'utf8' });
    createMinimalExport(exportRoot);
    const child = spawnSync(process.execPath, derivedIdentityCliArgs(exportRoot, 'ENV_GIT_CONTEXT_MUST_BE_IGNORED'), {
      cwd: exportRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_DIR: path.join(repositoryRoot, '.git'),
        GIT_WORK_TREE: repositoryRoot,
        GIT_COMMON_DIR: path.join(repositoryRoot, '.git'),
        GIT_CEILING_DIRECTORIES: exportRoot,
        GIT_DISCOVERY_ACROSS_FILESYSTEM: '0',
        git_index_file: path.join(repositoryRoot, '.git', 'index')
      }
    });
    assert.equal(child.status, 0, child.stderr || child.stdout);
    assert.ok(fs.existsSync(path.join(exportRoot, DERIVED_IDENTITY)));
    assert.equal(delivery.resolveSourceIdentity(exportRoot).source, DERIVED_IDENTITY);
  } finally {
    fs.rmSync(repositoryRoot, { recursive: true, force: true });
    fs.rmSync(exportRoot, { recursive: true, force: true });
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
        && samePhysicalPath(error?.details?.gitMetadataPath || '', embeddedGit),
      'embedded mutable VCS metadata must invalidate the entire export seal'
    );
  } finally {
    fs.rmSync(exportRoot, { recursive: true, force: true });
  }
});

test('derived identity API rejects a root symlink or Windows junction before any export mutation', () => {
  const targetRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-derived-link-target-'));
  const linkParent = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-derived-link-parent-'));
  const linkedRoot = path.join(linkParent, 'candidate');
  try {
    createMinimalExport(targetRoot);
    createDirectoryLink(targetRoot, linkedRoot);
    assert.throws(
      () => delivery.createDerivedSourceIdentity(linkedRoot, VALID_IDENTITY_OPTIONS),
      error => error?.reasonCode === 'SOURCE_UAT_DERIVED_IDENTITY_ROOT_LINK_FORBIDDEN'
        && error?.details?.relation === 'ROOT_SYMBOLIC_LINK_OR_REPARSE_POINT'
        && path.resolve(error?.details?.logicalRoot || '') === path.resolve(linkedRoot)
        && samePhysicalPath(error?.details?.canonicalRoot || '', linkedRoot),
      'root links and Windows junctions must be rejected by the shared authority'
    );
    assert.equal(fs.existsSync(path.join(targetRoot, DERIVED_IDENTITY)), false);
    assert.equal(fs.existsSync(path.join(targetRoot, 'YANCE_ARTIFACT_DESCRIPTOR.json')), false);
  } finally {
    fs.rmSync(linkParent, { recursive: true, force: true });
    fs.rmSync(targetRoot, { recursive: true, force: true });
  }
});

test('derived identity CLI rejects a linked Git subtree even when GIT_CEILING_DIRECTORIES hides discovery', () => {
  const repositoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-derived-linked-worktree-'));
  const linkParent = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-derived-linked-worktree-alias-'));
  const linkedRoot = path.join(linkParent, 'candidate');
  try {
    execFileSync('git', ['init', '--quiet', repositoryRoot], { encoding: 'utf8' });
    const physicalExport = createMinimalExport(path.join(repositoryRoot, 'exports', 'candidate'));
    createDirectoryLink(physicalExport, linkedRoot);
    const child = spawnSync(process.execPath, derivedIdentityCliArgs(linkedRoot, 'LINKED_WORKTREE_MUST_BE_REJECTED'), {
      cwd: linkParent,
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_CEILING_DIRECTORIES: physicalExport,
        GIT_DISCOVERY_ACROSS_FILESYSTEM: '0'
      }
    });
    assert.notEqual(child.status, 0);
    const error = JSON.parse(child.stderr);
    assert.equal(error.reasonCode, 'SOURCE_UAT_DERIVED_IDENTITY_ROOT_LINK_FORBIDDEN');
    assert.equal(error.details?.relation, 'ROOT_SYMBOLIC_LINK_OR_REPARSE_POINT');
    assert.ok(samePhysicalPath(error.details?.canonicalRoot || '', linkedRoot));
  } finally {
    fs.rmSync(linkParent, { recursive: true, force: true });
    fs.rmSync(repositoryRoot, { recursive: true, force: true });
  }
});

test('sealed export authority returns one physical canonical root for linked parent components', () => {
  const physicalParent = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-derived-physical-parent-'));
  const aliasContainer = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-derived-parent-alias-'));
  const aliasParent = path.join(aliasContainer, 'physical-parent');
  try {
    const physicalExport = createMinimalExport(path.join(physicalParent, 'candidate'));
    createDirectoryLink(physicalParent, aliasParent);
    const logicalExport = path.join(aliasParent, 'candidate');
    const canonicalExport = fs.realpathSync.native(logicalExport);
    assert.equal(comparablePhysicalPath(assertSealedExportRoot(logicalExport)), comparablePhysicalPath(canonicalExport));
    delivery.createDerivedSourceIdentity(logicalExport, VALID_IDENTITY_OPTIONS);
    assert.ok(fs.existsSync(path.join(canonicalExport, DERIVED_IDENTITY)));
    assert.ok(fs.existsSync(path.join(canonicalExport, 'YANCE_ARTIFACT_DESCRIPTOR.json')));
    assert.ok(samePhysicalPath(canonicalExport, physicalExport));
  } finally {
    fs.rmSync(aliasContainer, { recursive: true, force: true });
    fs.rmSync(physicalParent, { recursive: true, force: true });
  }
});
