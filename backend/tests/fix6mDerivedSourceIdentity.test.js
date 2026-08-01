'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createDerivedSourceIdentity } = require('../../tools/runtime-delivery/source-uat-delivery');

test('FIX6M derived source identity declares Batch41 architecture authorities and remains source-UAT only', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-fix6m-identity-'));
  try {
    fs.writeFileSync(path.join(root, 'payload.txt'), 'fixture\n');
    const identity = createDerivedSourceIdentity(root, {
      derivedVersion: 'FIX6M_ARCHITECTURE_REFERENCE_CLOSURE_TEST',
      releaseBatch: 'BATCH41',
      baseCommit: '1'.repeat(40),
      baseTree: '2'.repeat(40),
      generatedAtUtc: '2026-08-01T00:00:00.000Z'
    });
    const descriptor = JSON.parse(fs.readFileSync(path.join(root, 'YANCE_ARTIFACT_DESCRIPTOR.json'), 'utf8'));
    assert.match(descriptor.artifactClass, /^BATCH41_FIX6M_/u);
    for (const authority of [
      'persistentEvidenceAuthority',
      'durableExecutionAuthority',
      'canonicalCommunicationAuthority',
      'typedThreePlatformAdapterAuthority',
      'contactRelationshipEvidenceAuthority',
      'aiReplyLearningReceiptAuthority',
      'architectureShadowCutoverAuthority',
      'unifiedArchitectureDiagnosticAuthority'
    ]) assert.equal(descriptor.repairAuthority[authority], true, authority);
    assert.deepEqual(identity.releaseGates, {
      windowsUiUat: false,
      readyForPromotion: false,
      formalRelease: false,
      candidatePackageGenerated: false
    });
    assert.equal(descriptor.identityProtocol.sourceUatOnly, true);
    assert.equal(descriptor.identityProtocol.installerBuilt, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
