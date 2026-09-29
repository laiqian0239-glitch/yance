'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..', '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const exists = rel => fs.existsSync(path.join(ROOT, rel));

test('active Facebook production readiness no longer imports retired Page relay owners', () => {
  const command = String(pkg.scripts['test:platform-production-readiness'] || '');
  assert.doesNotMatch(command, /facebookBusinessSuiteReconciliationRegression|facebookProductionReadinessRegression/u);
  assert.match(command, /facebookPageRestartObservationRegression/u);
  assert.match(command, /facebookChatwootWebhookAuthBoundary/u);
  assert.match(command, /v21-facebook-page-no-shadow-history-owner/u);
});

test('retired Worker messaging contract tests are absent', () => {
  for (const rel of [
    'services/facebook-worker/tests/desktop-worker-contract.test.js',
    'services/facebook-worker/tests/facebook-adapter-contract.test.js',
    'services/facebook-worker/tests/lease-ack-recovery.test.js',
    'services/facebook-worker/tests/media-r2-retention.test.js',
    'services/facebook-worker/tests/send-idempotency.test.js',
    'services/facebook-worker/tests/webhook-security.test.js'
  ]) assert.equal(exists(rel), false, rel);
});

test('root Facebook contract script no longer runs retired Page relay tests', () => {
  const command = String(pkg.scripts['test:facebook-contracts'] || '');
  assert.doesNotMatch(command, /facebookProductionReadinessRegression|desktop-worker-contract|facebook-adapter-contract/u);
  assert.match(command, /facebookChatwootSecretFileRuntime/u);
  assert.match(command, /facebookChatwootWebhookAuthBoundary/u);
});

test('retired backend Page relay readiness suites are absent', () => {
  for (const rel of [
    'backend/tests/facebookBusinessSuiteReconciliationRegression.test.js',
    'backend/tests/facebookProductionReadinessRegression.test.js'
  ]) assert.equal(exists(rel), false, rel);
});
