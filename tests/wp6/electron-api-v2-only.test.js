'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { read } = require('./helpers');

test('Electron runtime controls use API v2 and expose no generic legacy executor', () => {
  const main = read('electron/main.js');
  const preload = read('electron/preload.js');
  const apiClient = read('electron/desktopHost/ApiV2RuntimeClient.js');
  assert.match(main, /new\s+ApiV2RuntimeClient\b/);
  assert.match(main, /new\s+RuntimeProjectionCoordinator\b/);
  assert.match(main, /routeDesktopLifecycleViaApiV2/);
  assert.doesNotMatch(main, /desktop:lifecycle/);
  assert.doesNotMatch(preload, /executeLegacy|executeControl|core-command|desktopCore/);
  assert.match(preload, /getRuntimeProjection/);
  assert.match(preload, /setOperatingMode/);
  assert.match(apiClient, /\/api\/app\/v2\/snapshot/);
  assert.match(apiClient, /\/api\/app\/v2\/commands/);
  assert.match(apiClient, /\/api\/app\/v2\/events/);
  assert.match(apiClient, /x-yance-contract-version/);
});
