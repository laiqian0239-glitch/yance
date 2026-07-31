'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { read } = require('./helpers');

test('controlled restart resolves old stop custody only after lifecycle coordinator confirms old owner recovery and before new baseline binding', () => {
  const source = read('electron/main.js');
  const start = source.indexOf('async function restartBackend(options = {})');
  const end = source.indexOf('\nfunction createWindow()', start);
  assert.ok(start >= 0 && end > start);
  const body = source.slice(start, end);
  const restart = body.indexOf('desktopCredentialApplicationCoordinator.restartBackend(options)');
  const resolve = body.indexOf('runtimeProjectionCoordinator.resolveStopAfterProcessExit');
  const finalize = body.indexOf('finalizeTrustedBackendReady');
  assert.ok(restart >= 0, 'application lifecycle restart call is required');
  assert.ok(resolve > restart, 'old stop process custody may only be resolved after lifecycle restart confirms exit/recovery');
  assert.ok(finalize > resolve, 'new trusted API v2 baseline must bind only after old stop custody resolution');
  assert.equal(body.includes("resolveStopAfterProcessExit({ stopped: true, exitConfirmed: true, alreadyStopped: true })"), false);
});
