'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createDerivedSourceIdentity } = require('../../tools/runtime-delivery/source-uat-delivery');

test('FIX6L derived source descriptor declares candidate-production and unified diagnostic authorities', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-fix6l-identity-'));
  try {
    fs.writeFileSync(path.join(root, 'payload.txt'), 'fixture\n');
    createDerivedSourceIdentity(root, {
      derivedVersion: 'FIX6L_TEST',
      baseCommit: '1'.repeat(40),
      baseTree: '2'.repeat(40),
      generatedAtUtc: '2026-08-01T00:00:00.000Z'
    });
    const descriptor = JSON.parse(fs.readFileSync(path.join(root, 'YANCE_ARTIFACT_DESCRIPTOR.json'), 'utf8'));
    assert.equal(descriptor.repairAuthority.candidateProductionExecutionAuthority, true);
    assert.equal(descriptor.repairAuthority.candidateExecutionTraceAuthority, true);
    assert.equal(descriptor.repairAuthority.unifiedDiagnosticSummaryAuthority, true);
    assert.equal(descriptor.repairAuthority.onboardingCandidatePresentationAuthority, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
