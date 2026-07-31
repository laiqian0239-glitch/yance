'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SERVER_JS = path.resolve(__dirname, '../../backend/server.js');

function source() {
  return fs.readFileSync(SERVER_JS, 'utf8');
}

test('backend ready is announced only after HTTP server stability guard', () => {
  const text = source();
  const stableIndex = text.indexOf("await assertServerStableBeforeReady('before-backend-ready'");
  const readyIndex = text.indexOf('const readySignal = announceReady();');
  assert.notEqual(stableIndex, -1, 'server.js must perform a pre-ready listening stability guard');
  assert.notEqual(readyIndex, -1, 'server.js must explicitly announce backend ready');
  assert.ok(stableIndex < readyIndex, 'pre-ready stability guard must run before announceReady()');
});

test('startup failure closes server through fail-closed exit helper', () => {
  const text = source();
  assert.match(text, /function forceExitAfterStartupFailure\(/);
  for (const code of ['STORE_MANAGER_STARTUP_FAILED', 'GLOBAL_FRAMEWORK_STARTUP_FAILED', 'WP2_PRODUCTION_PATH_PROBE_FAILED']) {
    assert.match(text, new RegExp(`forceExitAfterStartupFailure\\([^\\n]+${code}`), `${code} must use fail-closed server exit helper`);
  }
});

test('unexpected post-ready HTTP close is fatal', () => {
  const text = source();
  assert.match(text, /server\.on\('close'/);
  assert.match(text, /BACKEND_HTTP_SERVER_CLOSED_AFTER_READY/);
  assert.match(text, /backendReadiness\.ready === true/);
});
