'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');

function source(relativePath) {
  return fs.readFileSync(path.join(ROOT, ...relativePath.split('/')), 'utf8');
}

test('packaged backend startup-frame wait consumes the authoritative Electron lifecycle budget', () => {
  const mainSource = source('electron/main.js');
  const hostSource = source('electron/desktopHost/BackendProcessHost.js');
  const registrySource = source('electron/desktopHost/BackendOwnerRegistry.js');
  const startupPipeSource = source('backend/bootstrap/desktopStartupPipe.js');

  assert.match(
    mainSource,
    /function backendStartupTimeoutMs\(\)[\s\S]*YANCE_BACKEND_STARTUP_TIMEOUT_MS\s*\|\|\s*60_000[\s\S]*Math\.min\(180_000,\s*Math\.max\(5_000,/u,
    'Electron must retain the existing 60s bounded backend lifecycle timeout authority'
  );

  assert.match(
    registrySource,
    /timeout:\s*5000[\s\S]*configuredAttempts[\s\S]*Math\.min\(8,/u,
    'Windows owner identity acquisition remains a bounded asynchronous pre-frame operation that can legitimately exceed 10s'
  );

  assert.match(
    hostSource,
    /await\s+this\.ownerRegistry\.captureIdentityAsync\(child\.pid\)[\s\S]*await\s+this\._writeStartupFrame\(controlPipe,/u,
    'BackendProcessHost must preserve owner identity fencing before startup-frame dispatch'
  );

  assert.match(
    mainSource,
    /env\.YANCE_BACKEND_STARTUP_TIMEOUT_MS\s*=\s*String\(startupTimeoutMs\)/u,
    'Electron must propagate the exact authoritative backend lifecycle budget into the spawned backend environment'
  );

  assert.match(
    startupPipeSource,
    /process\.env\.YANCE_BACKEND_STARTUP_TIMEOUT_MS/u,
    'the child startup-frame reader must consume the propagated authoritative backend lifecycle budget'
  );

  assert.doesNotMatch(
    startupPipeSource,
    /options\.timeoutMs\s*\|\|\s*10000/u,
    'the child must not keep an independent 10s production startup-frame deadline'
  );
});
