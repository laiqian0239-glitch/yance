'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {
  detectCapabilities,
  discoverCallSites
} = require('../../../../tools/architecture-closure-v2/discover-wp-b-operation-call-sites');
const {
  loadWpBBaseline,
  loadWpBOperationInventory,
  isValidWpBOperationInventory
} = require('../../../../shared/release/acv2ActiveWorkPackageAuthority');

const REPO_ROOT = path.resolve(__dirname, '../../../..');

test('operation discovery recognizes physical invocations, recovery and operational timers', () => {
  const capabilities = detectCapabilities(`
    client.restoreSession();
    client.sendMessage({ text: 'x' });
    fetch('https://example.invalid');
    setTimeout(() => retryQueue(), 50);
    fork('worker.js');
  `);
  assert.deepEqual(capabilities.sort(), [
    'CHILD_PROCESS_EXTERNAL_EXECUTION',
    'NETWORK_CLIENT_CALL',
    'OPERATIONAL_RETRY_OR_TIMER',
    'PLATFORM_OR_PROVIDER_CALL',
    'RECOVERY_ENTRYPOINT'
  ]);
});

test('method declarations are not mistaken for physical invocations', () => {
  const capabilities = detectCapabilities(`
    class Adapter {
      sendMessage() {}
      restoreSession() {}
      recoverState() {}
    }
  `);
  assert.deepEqual(capabilities, []);
});

test('operation inventory paths are exact and reject glob metacharacters', () => {
  const baseline = loadWpBBaseline();
  const inventory = loadWpBOperationInventory();
  assert.equal(isValidWpBOperationInventory(inventory, baseline), true);

  for (const wildcardPath of [
    'backend/services/*.js',
    'backend/services/adapter?.js',
    'backend/services/[ab].js'
  ]) {
    const candidate = JSON.parse(JSON.stringify(inventory));
    candidate.entries[0].path = wildcardPath;
    assert.equal(
      isValidWpBOperationInventory(candidate, baseline),
      false,
      wildcardPath
    );
  }
});

test('every discovered WP-B production call site has an exact inventory row', () => {
  const report = discoverCallSites(REPO_ROOT);
  assert.equal(
    report.unregisteredCount,
    0,
    `Unregistered WP-B call sites:\n${JSON.stringify(report.unregistered, null, 2)}`
  );
  assert.equal(
    report.missingInventoryPathCount,
    0,
    `Missing inventory paths:\n${JSON.stringify(report.missingInventoryPaths, null, 2)}`
  );
  assert.ok(Array.isArray(report.harnessDetected));
  assert.ok(Array.isArray(report.outsideScopeDetected));
  assert.equal(report.ok, true);
});
