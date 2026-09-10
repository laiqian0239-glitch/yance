'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const ROOT = path.resolve(__dirname, '../..');

test('OpenRouter presentation distinguishes missing quota from a real zero balance', () => {
  const authority = require('../../frontend/js/r32-openrouter-presentation-authority');

  assert.equal(authority.formatMoney(null), '未返回');
  assert.equal(authority.formatMoney(undefined), '未返回');
  assert.equal(authority.formatMoney(''), '未返回');
  assert.equal(authority.formatMoney(0), '$0.0000');
  assert.equal(authority.formatMoney('0'), '$0.0000');
  assert.equal(authority.formatMoney(12.5), '$12.50');
});

test('derived source identity descriptor preserves prior repair authorities and declares FIX6K OpenRouter authorities', () => {
  const { createDerivedSourceIdentity } = require('../../tools/runtime-delivery/source-uat-delivery');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-fix6k-identity-'));
  try {
    fs.writeFileSync(path.join(root, 'payload.txt'), 'fixture\n');
    createDerivedSourceIdentity(root, {
      derivedVersion: 'FIX6K_TEST',
      baseCommit: '1'.repeat(40),
      baseTree: '2'.repeat(40),
      generatedAtUtc: '2026-08-01T00:00:00.000Z'
    });
    const descriptor = JSON.parse(fs.readFileSync(path.join(root, 'YANCE_ARTIFACT_DESCRIPTOR.json'), 'utf8'));
    assert.equal(descriptor.repairAuthority.sqliteFreeModelWorkerAuthority, true);
    assert.equal(descriptor.repairAuthority.versionedModelExecutionEnvelopeAuthority, true);
    assert.equal(descriptor.repairAuthority.openRouterOnboardingStateAuthority, true);
    assert.equal(descriptor.repairAuthority.routeDraftProjectionAuthority, true);
    assert.equal(descriptor.repairAuthority.openRouterPresentationAuthority, true);
    assert.equal(descriptor.repairAuthority.onboardingAutomationNonMutationAuthority, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});
