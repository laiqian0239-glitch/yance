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
    /const nativeExecOptions = \{[\s\S]*timeout:\s*3000,/u,
    'Windows owner identity must use the bounded native Win32 collector first'
  );

  assert.match(
    registrySource,
    /const managementExecOptions = \{[\s\S]*timeout:\s*2500,/u,
    'Windows owner identity may retain one bounded System.Management compatibility fallback'
  );

  assert.match(
    registrySource,
    /authority:\s*'native-win32'[\s\S]*authority:\s*'system-management'/u,
    'Windows owner identity must preserve provider-independent native-first authority ordering'
  );

  assert.match(
    registrySource,
    /const maxAttempts = 2;[\s\S]*const delayMs = 0;/u,
    'Windows owner identity must remain bounded to two collectors with no retry delay'
  );

  assert.doesNotMatch(
    registrySource,
    /configuredAttempts|Math\.min\(8|Get-CimInstance\s+Win32_Process/u,
    'retired multi-attempt WMI authority must not return to the pre-frame path'
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
