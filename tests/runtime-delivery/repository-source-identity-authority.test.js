'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const test = require('node:test');
const assert = require('node:assert/strict');
const delivery = require('../../tools/runtime-delivery/source-uat-delivery');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DERIVED_IDENTITY = 'YANCE_DERIVED_SOURCE_IDENTITY.json';

function git(args) {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
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
