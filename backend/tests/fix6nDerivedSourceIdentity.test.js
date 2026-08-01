'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDerivedSourceIdentity } = require('../../tools/runtime-delivery/source-uat-delivery');

test('FIX6N derived descriptor preserves all prior authorities and declares the model routing authority', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-fix6n-identity-'));
  try {
    fs.writeFileSync(path.join(root, 'payload.txt'), 'fix6n\n');
    createDerivedSourceIdentity(root, {
      derivedVersion: 'FIX6N_MODEL_SERVICE_TASK_ROUTING_AUTHORITY_TEST',
      releaseBatch: 'BATCH41',
      baseCommit: '1'.repeat(40),
      baseTree: '2'.repeat(40),
      generatedAtUtc: '2026-08-01T12:00:00.000Z'
    });
    const descriptor = JSON.parse(fs.readFileSync(path.join(root, 'YANCE_ARTIFACT_DESCRIPTOR.json'), 'utf8'));
    for (const authority of [
      'persistentEvidenceAuthority',
      'durableExecutionAuthority',
      'canonicalCommunicationAuthority',
      'architectureShadowCutoverAuthority',
      'modelServiceTaskRoutingAuthority',
      'independentProviderFallbackAuthority',
      'sharedModelTimeoutBudgetAuthority',
      'providerCooldownPersistenceAuthority',
      'candidateTranslationRouteAuthority'
    ]) assert.equal(descriptor.repairAuthority[authority], true, authority);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
