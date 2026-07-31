'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateBootFailureDiagnostics } = require('../../tools/wp7/lib');
const { expectReason } = require('./helpers');
const { isFinalExecution, load } = require('./final-phase-helpers');
const { normalizeBootFailureChildArguments } = require('../../electron/wp7InstalledRuntimeProbeMainAdapter');

test('wp7-boot-failure-diagnostics.test', () => {
  if (isFinalExecution()) {
    const document = load('evidence/wp7/boot-failure-diagnostics.json');
    assert.equal(validateBootFailureDiagnostics(document).status, 'PASS');
    assert.equal(document.diagnosticBuildId, document.buildId);
    return;
  }
  assert.equal(validateBootFailureDiagnostics({ buildId: 'b', failedPhase: 'manifest', reasonCode: 'BOOT_MANIFEST_SCHEMA_INVALID' }).status, 'PASS');
  expectReason(assert, () => validateBootFailureDiagnostics({ buildId: 'b' }), 'WP7_BOOT_DIAGNOSTIC_INCOMPLETE');
});

test('boot-failure child inherits only the already active Chromium launch switches required to reach diagnostic code', () => {
  assert.deepEqual(
    normalizeBootFailureChildArguments(['--disable-gpu', '--remote-debugging-port=9222', '--no-sandbox', '--no-sandbox', '', null]),
    ['--disable-gpu', '--no-sandbox']
  );
  assert.deepEqual(normalizeBootFailureChildArguments(['--inspect', '--user-data-dir=/tmp/evil']), []);
});
