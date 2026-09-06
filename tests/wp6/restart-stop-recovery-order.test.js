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
  const requestStopStart = source.indexOf('async function requestApiV2Stop(options = {})');
  const requestStopEnd = source.indexOf('\nasync function stopBackend(options = {})', requestStopStart);
  assert.ok(requestStopStart >= 0 && requestStopEnd > requestStopStart, 'requestApiV2Stop range is required');
  const requestStop = source.slice(requestStopStart, requestStopEnd);
  const noBaseline = requestStop.indexOf('if (!projection?.trustedOwnerBound)');
  const ownershipAbsent = requestStop.indexOf('authoritativeBackend().ownershipPresent !== true', noBaseline);
  const alreadyExited = requestStop.indexOf('return { requested: false, confirmed: false, backendExited: true };', ownershipAbsent);
  const ownershipAbsentBlockEnd = requestStop.indexOf('\n    }', alreadyExited);
  const baselineRequired = requestStop.indexOf("return { requested: false, confirmed: false, reasonCode: 'WP6_RUNTIME_BASELINE_REQUIRED' };", alreadyExited);
  const runtimeStopRequest = requestStop.indexOf('runtimeProjectionCoordinator.requestStop', baselineRequired);
  assert.ok(noBaseline >= 0, 'no-baseline branch is required');
  assert.ok(ownershipAbsent > noBaseline, 'no-baseline branch must consult canonical backend ownership');
  assert.ok(alreadyExited > ownershipAbsent && alreadyExited < ownershipAbsentBlockEnd, 'ownership-absent branch must project backendExited:true');
  assert.ok(baselineRequired > ownershipAbsentBlockEnd, 'ownership-present no-baseline state must remain fail-closed');
  assert.ok(runtimeStopRequest > baselineRequired, 'trusted-baseline runtime stop command path must remain after the no-baseline guard');
  assert.equal(requestStop.slice(noBaseline, runtimeStopRequest).split('backendExited: true').length - 1, 1, 'no-baseline projection must emit backendExited:true only once');
  const restart = body.indexOf('desktopCredentialApplicationCoordinator.restartBackend(options)');
  const resolve = body.indexOf('runtimeProjectionCoordinator.resolveStopAfterProcessExit');
  const finalize = body.indexOf('finalizeTrustedBackendReady');
  assert.ok(restart >= 0, 'application lifecycle restart call is required');
  assert.ok(resolve > restart, 'old stop process custody may only be resolved after lifecycle restart confirms exit/recovery');
  assert.ok(finalize > resolve, 'new trusted API v2 baseline must bind only after old stop custody resolution');
  assert.ok(body.includes('forced: runtimeStop.confirmed !== true && runtimeStop.backendExited !== true'), 'already-exited backend must not be mislabeled as forced custody');
  assert.equal(body.includes("resolveStopAfterProcessExit({ stopped: true, exitConfirmed: true, alreadyStopped: true })"), false);
});

test('controlled restart waits for active backend-exit recovery barrier before no-baseline classification', () => {
  const source = read('electron/main.js');

  const declaration = source.indexOf('let backendExitHandlingPromise = null;');
  assert.ok(declaration >= 0, 'main must retain the active backend-exit handler promise');

  const listenerAssignment = source.indexOf('backendExitHandlingPromise = exitHandling;');
  const listenerCleanup = source.indexOf('if (backendExitHandlingPromise === exitHandling) backendExitHandlingPromise = null;');
  assert.ok(listenerAssignment > declaration, 'backend exit listener must publish the active recovery barrier');
  assert.ok(listenerCleanup > listenerAssignment, 'backend exit barrier must be cleared only by the same handler promise');

  const requestStart = source.indexOf('async function requestApiV2Stop(options = {})');
  const requestEnd = source.indexOf('\nasync function stopBackend(', requestStart);
  assert.ok(requestStart >= 0 && requestEnd > requestStart);

  const body = source.slice(requestStart, requestEnd);
  const capture = body.indexOf('const pendingExitHandling = backendExitHandlingPromise;');
  const wait = body.indexOf('if (pendingExitHandling) await pendingExitHandling;');
  const projection = body.indexOf('const projection = runtimeProjectionCoordinator?.snapshot?.();');
  const authority = body.indexOf('authoritativeBackend()');

  assert.ok(capture >= 0, 'controlled restart stop projection must capture the active exit barrier');
  assert.ok(wait > capture, 'controlled restart must await the already-running backend-exit recovery');
  assert.ok(projection > wait, 'Runtime API v2 baseline must be read only after owner-exit recovery settles');
  assert.ok(authority > projection, 'durable backend authority classification must occur after the recovered projection read');

  assert.match(body, /backendExited:\s*true/u,
    'already-exited projection must remain available after the recovery barrier');
  assert.match(body, /WP6_RUNTIME_BASELINE_REQUIRED/u,
    'durable ownership that remains after recovery must continue to fail closed');
});
