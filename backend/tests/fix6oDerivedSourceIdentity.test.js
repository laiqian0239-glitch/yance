'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDerivedSourceIdentity } = require('../../tools/runtime-delivery/source-uat-delivery');

test('FIX6O derived descriptor declares scoped safety and split Facebook driver authorities', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-fix6o-identity-'));
  try {
    fs.writeFileSync(path.join(root, 'payload.txt'), 'fix6o\n');
    createDerivedSourceIdentity(root, {
      derivedVersion: 'FIX6O_SCOPED_SAFETY_OMNICHANNEL_RUNTIME_TEST',
      releaseBatch: 'BATCH42',
      baseCommit: '1'.repeat(40),
      baseTree: '2'.repeat(40),
      generatedAtUtc: '2026-08-01T14:45:00.000Z'
    });
    const descriptor = JSON.parse(fs.readFileSync(path.join(root, 'YANCE_ARTIFACT_DESCRIPTOR.json'), 'utf8'));
    for (const authority of [
      'modelServiceTaskRoutingAuthority',
      'scopedSafetyAuthority',
      'safeModeExitReceiptAuthority',
      'accountPlatformCapabilityIsolationAuthority',
      'facebookDriverTypeAuthority',
      'facebookPersonalIdentityOAuthAuthority',
      'experimentalFacebookMessengerIsolationAuthority',
      'officialPagePersonalIdentitySeparationAuthority'
    ]) assert.equal(descriptor.repairAuthority[authority], true, authority);
    assert.match(descriptor.artifactClass, /^BATCH42_/u);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
