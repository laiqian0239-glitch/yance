'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  assertRuntimePayloadBranding,
  createApplicationPayload
} = require('../../tools/wp1/lib');
const { tempDir } = require('./helpers');

const ROOT = path.resolve(__dirname, '..', '..');

test('runtime payload includes the approved Yance product assets and passes packaged brand audit', () => {
  const payloadRoot = path.join(tempDir('yance-wp1-runtime-brand-'), 'application-payload');
  const result = createApplicationPayload(ROOT, payloadRoot);
  assert.equal(result.brandAudit.status, 'PASS');
  assert.equal(result.brandAudit.unexplainedCount, 0);
  assert.equal(result.brandAudit.visibleAllowanceCount, 0);
  for (const relative of [
    'frontend/assets/branding/yance/yance-mark-flat.svg',
    'frontend/assets/branding/yance/yance-mark-micro.svg',
    'frontend/assets/branding/yance/yance-lockup-horizontal.svg',
    'frontend/assets/branding/yance/Yance.ico',
    'frontend/assets/icon.ico',
    'frontend/assets/icon.png'
  ]) {
    assert.equal(fs.existsSync(path.join(payloadRoot, relative)), true, relative);
  }
});

test('runtime payload brand audit fails closed after an old public name is injected', () => {
  const payloadRoot = path.join(tempDir('yance-wp1-runtime-brand-negative-'), 'application-payload');
  createApplicationPayload(ROOT, payloadRoot);
  fs.appendFileSync(path.join(payloadRoot, 'frontend', 'index.html'), '\n<!-- Yance29 -->\n');
  assert.throws(
    () => assertRuntimePayloadBranding(payloadRoot),
    error => error.reasonCode === 'WP1_RUNTIME_PAYLOAD_BRAND_VIOLATION'
  );
});
