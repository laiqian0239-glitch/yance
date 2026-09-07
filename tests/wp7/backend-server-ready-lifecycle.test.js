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

test('post-ready enhancements wait for both successful DesktopHost bootstrap responses to finish', () => {
  const text = source();
  const barrierIndex = text.indexOf('const OWNER_ESTABLISHMENT_BOOTSTRAP_RESPONSES = 2;');
  const helperIndex = text.indexOf('function startPostBootstrapEnhancementsOnce()');
  const protocolIndex = text.indexOf('const STARTUP_PROTOCOL_VERSION = 1;', helperIndex);
  const handlerIndex = text.indexOf("app.get('/api/desktop/runtime-projection-snapshot'");
  const readyGateIndex = text.indexOf('const countsForOwnerEstablishment = backendReadiness.ready === true;', handlerIndex);
  const finishIndex = text.indexOf("res.once('finish'", handlerIndex);
  const successIndex = text.indexOf('res.statusCode !== 200', finishIndex);
  const incrementIndex = text.indexOf('bootstrapProjectionResponsesFinished += 1;', finishIndex);
  const releaseIndex = text.indexOf('startPostBootstrapEnhancementsOnce();', incrementIndex);
  const readyIndex = text.indexOf('const readySignal = announceReady();');

  for (const [label, index] of Object.entries({
    barrierIndex,
    helperIndex,
    protocolIndex,
    handlerIndex,
    readyGateIndex,
    finishIndex,
    successIndex,
    incrementIndex,
    releaseIndex,
    readyIndex
  })) {
    assert.notEqual(index, -1, `${label} must exist`);
  }

  assert.ok(helperIndex < protocolIndex, 'enhancement owner must be a process-local startup helper');
  assert.ok(
    handlerIndex < readyGateIndex &&
      readyGateIndex < finishIndex &&
      finishIndex < successIndex &&
      successIndex < incrementIndex &&
      incrementIndex < releaseIndex,
    'bootstrap handler must count only successful post-ready response finish events before releasing enhancements'
  );

  const helperSource = text.slice(helperIndex, protocolIndex);
  assert.match(helperSource, /bootstrapProjectionResponsesFinished < OWNER_ESTABLISHMENT_BOOTSTRAP_RESPONSES/u);
  assert.ok(helperSource.includes("['ai-reply-outbox', aiReplyOutboxService]"));
  assert.ok(helperSource.includes("['ai-automation', aiAutomation]"));
  assert.match(helperSource, /ollama\.discover\(\)/u);

  const postReadyTail = text.slice(readyIndex);
  assert.doesNotMatch(
    postReadyTail,
    /accountManager\.publishSummary\(\);/u,
    'no synchronous account projection may run after backend:ready'
  );
  assert.doesNotMatch(
    postReadyTail,
    /if \(!safeModeActive\) setImmediate/u,
    'AI startup must not remain directly scheduled in the post-ready tail'
  );
  assert.doesNotMatch(
    postReadyTail,
    /if \(!safeModeActive\) setTimeout/u,
    'model scan must not remain directly scheduled in the post-ready tail'
  );
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
