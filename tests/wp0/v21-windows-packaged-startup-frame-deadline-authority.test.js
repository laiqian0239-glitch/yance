'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');

function source(relativePath) {
  return fs.readFileSync(path.join(ROOT, ...relativePath.split('/')), 'utf8');
}

test('packaged backend startup and Windows owner identity consume one authoritative lifecycle deadline', () => {
  const mainSource = source('electron/main.js');
  const hostSource = source('electron/desktopHost/BackendProcessHost.js');
  const registrySource = source('electron/desktopHost/BackendOwnerRegistry.js');
  const startupPipeSource = source('backend/bootstrap/desktopStartupPipe.js');

  assert.match(
    mainSource,
    /function backendStartupTimeoutMs\(\)[\s\S]*YANCE_BACKEND_STARTUP_TIMEOUT_MS\s*\|\|\s*60_000[\s\S]*Math\.min\(180_000,\s*Math\.max\(5_000,/u
  );

  assert.match(
    registrySource,
    /authority:\s*'native-win32'[\s\S]*authority:\s*'system-management'/u
  );

  assert.match(
    registrySource,
    /deadlineAtMs|deadlineAt|identityDeadline|remainingBudget|remainingMs/u,
    'Windows process identity must consume a lifecycle-derived bounded deadline'
  );

  assert.doesNotMatch(
    registrySource,
    /const nativeExecOptions\s*=\s*\{[\s\S]{0,180}timeout:\s*3000,/u,
    'native-win32 must not own an independent fixed 3000ms production deadline'
  );

  assert.doesNotMatch(
    registrySource,
    /const managementExecOptions\s*=\s*\{[\s\S]{0,180}timeout:\s*2500,/u,
    'System.Management must not own an independent fixed 2500ms production deadline'
  );

  const captureIndex = hostSource.indexOf('captureIdentityAsync(child.pid');
  const frameIndex = hostSource.indexOf('_writeStartupFrame(', captureIndex);

  assert.ok(captureIndex >= 0, 'owner identity capture must exist');
  assert.ok(frameIndex > captureIndex, 'owner identity fencing must remain before startup-frame dispatch');

  const captureSlice = hostSource.slice(captureIndex, Math.min(hostSource.length, captureIndex + 500));
  assert.match(
    captureSlice,
    /deadlineAtMs|deadlineAt|identityDeadline|remainingBudget|readyTimeoutMs/u,
    'BackendProcessHost must pass the authoritative startup deadline into identity capture'
  );

  assert.match(
    mainSource,
    /env\.YANCE_BACKEND_STARTUP_TIMEOUT_MS\s*=\s*String\(startupTimeoutMs\)/u
  );

  assert.match(
    startupPipeSource,
    /process\.env\.YANCE_BACKEND_STARTUP_TIMEOUT_MS/u
  );

  assert.doesNotMatch(
    startupPipeSource,
    /options\.timeoutMs\s*\|\|\s*10000/u
  );

  assert.doesNotMatch(
    registrySource,
    /configuredAttempts|Math\.min\(8|Get-CimInstance\s+Win32_Process/u
  );
});
