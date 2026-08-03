'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {
  detectCapabilities,
  discoverCallSites
} = require('../../../../tools/architecture-closure-v2/discover-wp-b-operation-call-sites');

const REPO_ROOT = path.resolve(__dirname, '../../../..');

test('operation discovery recognizes physical calls, recovery and operational timers', () => {
  const capabilities = detectCapabilities(`
    async function restoreSession() { return fetch('https://example.invalid'); }
    const timer = setTimeout(() => retryQueue(), 50);
    const child = fork('worker.js');
  `);
  assert.deepEqual(capabilities.sort(), [
    'CHILD_PROCESS_EXTERNAL_EXECUTION',
    'NETWORK_CLIENT_CALL',
    'OPERATIONAL_RETRY_OR_TIMER',
    'RECOVERY_ENTRYPOINT'
  ]);
});

test('every discovered WP-B call site has an exact inventory row', () => {
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
  assert.equal(report.ok, true);
});
