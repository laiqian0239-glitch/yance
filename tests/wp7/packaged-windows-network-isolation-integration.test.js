'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '..', '..', 'tools', 'wp7', 'run-packaged-electron-probe-integration.js'), 'utf8');

test('packaged runner selects the first-party durable Windows isolation provider for offline-start', () => {
  assert.match(source, /process\.platform === 'win32'/);
  assert.match(source, /WindowsNetworkIsolationProvider/);
  assert.match(source, /WindowsIsolationWatchdogController/);
  assert.match(source, /context\.windowsNetworkIsolation\.withIsolation/);
  assert.doesNotMatch(source, /adapters\.filter\(\(row\) => row\.status === 'Up'\)/);
});

test('packaged runner binds actual elevated custody, request, state and script hashes before product spawn', () => {
  assert.match(source, /createControlAttestation\(handle/);
  assert.match(source, /WP7_WINDOWS_NETWORK_ISOLATION_REQUEST_SHA256/);
  assert.match(source, /WP7_WINDOWS_NETWORK_ISOLATION_STATE_SHA256/);
  assert.match(source, /WP7_WINDOWS_NETWORK_ISOLATION_WATCHDOG_SHA256/);
  assert.match(source, /WP7_WINDOWS_NETWORK_ISOLATION_LAUNCHER_SHA256/);
  assert.match(source, /WP7_WINDOWS_NETWORK_ISOLATION_ELEVATED_PID/);
  assert.ok(source.indexOf('createControlAttestation(handle') < source.indexOf('return spawnAndAssert()'));
});

test('product execution validation occurs inside isolation wrapper so restore failure preserves product failure', () => {
  assert.match(source, /const spawnAndAssert = async \(\) =>/);
  assert.match(source, /WP7_PACKAGED_ELECTRON_PROBE_EXECUTION_FAILED/);
  assert.match(source, /withIsolation\(async \(handle\) =>/);
  assert.match(source, /return spawnAndAssert\(\)/);
});

test('Linux LD_PRELOAD isolation remains platform-scoped', () => {
  assert.match(source, /process\.platform === 'linux' \? compileLinuxNetworkIsolation/);
  assert.match(source, /env\.LD_PRELOAD/);
});
