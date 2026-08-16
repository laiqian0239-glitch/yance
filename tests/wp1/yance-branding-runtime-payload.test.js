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

test('runtime payload includes canonical Yance product assets without the retired legacy frontend', () => {
  const payloadRoot = path.join(tempDir('yance-wp1-runtime-brand-'), 'application-payload');
  const result = createApplicationPayload(ROOT, payloadRoot);
  assert.equal(result.brandAudit.status, 'PASS');
  assert.equal(result.brandAudit.unexplainedCount, 0);
  assert.equal(result.brandAudit.visibleAllowanceCount, 0);
  assert.equal(fs.existsSync(path.join(payloadRoot, 'frontend')), false);
  for (const relative of [
    'assets/branding/yance/yance-mark-flat.svg',
    'assets/branding/yance/product/yance-mark-micro.svg',
    'assets/branding/yance/yance-lockup-horizontal.svg',
    'assets/branding/yance/Yance.ico',
    'assets/branding/yance/yance-app-icon-64.png',
    'assets/branding/yance/yance-app-icon-512.png'
  ]) {
    assert.equal(fs.existsSync(path.join(payloadRoot, relative)), true, relative);
  }
});

test('runtime payload brand audit fails closed after an old public name is injected into canonical payload code', () => {
  const payloadRoot = path.join(tempDir('yance-wp1-runtime-brand-negative-'), 'application-payload');
  createApplicationPayload(ROOT, payloadRoot);
  fs.appendFileSync(path.join(payloadRoot, 'backend', 'server.js'), '\n// Yance29\n');
  assert.throws(
    () => assertRuntimePayloadBranding(payloadRoot),
    error => error.reasonCode === 'WP1_RUNTIME_PAYLOAD_BRAND_VIOLATION'
  );
});
