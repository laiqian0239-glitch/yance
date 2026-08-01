'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const checkpointPath = path.join(repoRoot, 'YANCE_SOURCE_CHECKPOINT.json');
const descriptorPath = path.join(repoRoot, 'YANCE_ARTIFACT_DESCRIPTOR.json');

const EXPECTED = Object.freeze({
  branch: 'fix6d-runtime-authority-v1',
  commit: '91096c2eb1a9e289b1a68b351a326166cf9c379d',
  tree: 'de013fcf1f2547cdc48874976f2a719f9c73f57c',
  upstreamCommit: '514dc7a45e4891ed96c00a9046702676b9fe6d2c',
  upstreamTree: 'c594b6848c6bf588ec72eba6308eef21090cc5ec'
});

test('source ZIP binds Windows source UAT to its authoritative identity contract', () => {
  const derivedPath = path.join(repoRoot, 'YANCE_DERIVED_SOURCE_IDENTITY.json');
  if (fs.existsSync(derivedPath)) {
    const derived = JSON.parse(fs.readFileSync(derivedPath, 'utf8'));
    assert.equal(derived.documentType, 'YANCE_DERIVED_SOURCE_IDENTITY');
    assert.match(derived.derivedVersion, /^FIX6[A-Z0-9_]+$/u);
    assert.match(derived.baseCommit, /^[0-9a-f]{40}$/u);
    assert.match(derived.baseTree, /^[0-9a-f]{40}$/u);
    assert.match(derived.payloadManifestSha256, /^[0-9a-f]{64}$/u);
    assert.equal(derived.releaseGates.windowsUiUat, false);
    assert.equal(derived.releaseGates.readyForPromotion, false);
    assert.equal(derived.releaseGates.formalRelease, false);
    assert.equal(derived.releaseGates.candidatePackageGenerated, false);

    const descriptor = JSON.parse(fs.readFileSync(descriptorPath, 'utf8'));
    assert.equal(descriptor.artifactType, 'WINDOWS_SOURCE_UAT_HANDOFF');
    assert.match(descriptor.artifactClass, new RegExp(`^BATCH\\d+_${derived.derivedVersion}_WINDOWS_SOURCE_UAT$`, 'u'));
    const releaseBatch = descriptor.artifactClass.split('_')[0].toLowerCase();
    assert.equal(
      descriptor.artifactId,
      `yance-${releaseBatch}-${derived.derivedVersion.toLowerCase().replaceAll('_', '-')}-windows-source-uat`
    );
    assert.equal(descriptor.sourceIdentity.authority, 'YANCE_DERIVED_SOURCE_IDENTITY.json');
    assert.equal(descriptor.sourceIdentity.derivedVersion, derived.derivedVersion);
    assert.equal(descriptor.sourceIdentity.baseCommit, derived.baseCommit);
    assert.equal(descriptor.sourceIdentity.baseTree, derived.baseTree);
    assert.equal(descriptor.governance.windowsUiUat, false);
    assert.equal(descriptor.governance.readyForPromotion, false);
    assert.equal(descriptor.governance.formalRelease, false);
    assert.equal(descriptor.governance.candidatePackageGenerated, false);
    return;
  }

  const checkpoint = JSON.parse(fs.readFileSync(checkpointPath, 'utf8'));
  assert.equal(checkpoint.documentType, 'YANCE_SOURCE_CHECKPOINT');
  assert.equal(checkpoint.branch, EXPECTED.branch);
  assert.equal(checkpoint.commit, EXPECTED.commit);
  assert.equal(checkpoint.tree, EXPECTED.tree);
  assert.equal(checkpoint.upstream?.commit, EXPECTED.upstreamCommit);
  assert.equal(checkpoint.upstream?.tree, EXPECTED.upstreamTree);
  assert.equal(checkpoint.artifactClass, 'BATCH40_FIX6D_RUNTIME_AUTHORITY_V1_WINDOWS_SOURCE_UAT');
  assert.equal(checkpoint.windowsUiUat, false);
  assert.equal(checkpoint.readyForPromotion, false);
  assert.equal(checkpoint.formalRelease, false);
  assert.equal(checkpoint.candidatePackageGenerated, false);

  const descriptor = JSON.parse(fs.readFileSync(descriptorPath, 'utf8'));
  assert.equal(descriptor.artifactType, 'WINDOWS_SOURCE_UAT_HANDOFF');
  assert.equal(descriptor.artifactClass, 'BATCH40_FIX6D_RUNTIME_AUTHORITY_V1_WINDOWS_SOURCE_UAT');
  assert.deepEqual(descriptor.sourceIdentity, {
    branch: EXPECTED.branch,
    commit: EXPECTED.commit,
    tree: EXPECTED.tree,
    parent: '514dc7a45e4891ed96c00a9046702676b9fe6d2c'
  });
  assert.equal(descriptor.governance.windowsUiUat, false);
  assert.equal(descriptor.governance.readyForPromotion, false);
  assert.equal(descriptor.governance.formalRelease, false);
  assert.equal(descriptor.governance.candidatePackageGenerated, false);
});
