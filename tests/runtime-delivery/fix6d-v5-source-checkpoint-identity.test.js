'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const checkpointPath = path.join(repoRoot, 'YANCE_SOURCE_CHECKPOINT.json');
const descriptorPath = path.join(repoRoot, 'YANCE_ARTIFACT_DESCRIPTOR.json');

test('mutable repository and exported Windows source ZIP keep distinct source identity authorities', () => {
  const descriptor = JSON.parse(fs.readFileSync(descriptorPath, 'utf8'));
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

  assert.equal(descriptor.documentType, 'YANCE_ARTIFACT_DESCRIPTOR');
  assert.equal(descriptor.artifactType, 'MUTABLE_GIT_IMPLEMENTATION_REPOSITORY');
  assert.equal(descriptor.sourceIdentity.authority, 'GIT_HEAD_AT_RUNTIME');
  assert.equal(descriptor.sourceIdentity.trackedDerivedIdentity, false);
  assert.equal(descriptor.sourceIdentity.sealedExport, false);
  assert.equal(descriptor.identityProtocol.trackedDerivedIdentityForbidden, true);
  assert.equal(descriptor.identityProtocol.derivedIdentityGeneratedAtExport, true);
  assert.equal(descriptor.governance.windowsUiUat, false);
  assert.equal(descriptor.governance.readyForPromotion, false);
  assert.equal(descriptor.governance.formalRelease, false);
  assert.equal(descriptor.governance.candidatePackageGenerated, false);

  const historicalCheckpoint = JSON.parse(fs.readFileSync(checkpointPath, 'utf8'));
  assert.equal(historicalCheckpoint.documentType, 'YANCE_SOURCE_CHECKPOINT');
  assert.notEqual(descriptor.sourceIdentity.authority, 'YANCE_SOURCE_CHECKPOINT.json');
});
