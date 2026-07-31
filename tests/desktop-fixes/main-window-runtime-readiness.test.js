'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createMainWindowRuntimeReadiness } = require('../../electron/mainWindowRuntimeReadiness');

function fakeWindow() {
  const webContents = { destroyed: false, isDestroyed() { return this.destroyed; } };
  return { webContents, destroyed: false, isDestroyed() { return this.destroyed; } };
}

test('fresh activation challenge requires backend, session, renderer and workspace readiness', async () => {
  const window = fakeWindow();
  let challenge;
  const readiness = createMainWindowRuntimeReadiness({
    createId: () => 'probe-1',
    sendProbe: (_window, payload) => { challenge = payload; },
    timeoutMs: 100
  });
  const pending = readiness.probe(window, { reason: 'tray-click', sequence: 7 });
  assert.equal(challenge.id, 'probe-1');
  assert.equal(challenge.reason, 'tray-click');
  assert.equal(readiness.complete(window.webContents, {
    id: challenge.id,
    ok: true,
    backendReady: true,
    sessionReady: true,
    rendererReady: true,
    workspaceReady: true
  }), true);
  const result = await pending;
  assert.equal(result.workspaceReady, true);
  assert.deepEqual(readiness.snapshot().pending, []);
});

test('wrong sender cannot satisfy an activation challenge', async () => {
  const window = fakeWindow();
  let challenge;
  const readiness = createMainWindowRuntimeReadiness({
    createId: () => 'probe-2',
    sendProbe: (_window, payload) => { challenge = payload; },
    timeoutMs: 30
  });
  const pending = readiness.probe(window, { reason: 'tray-menu-show' });
  assert.equal(readiness.complete({}, { id: challenge.id, ok: true, backendReady: true, sessionReady: true, rendererReady: true, workspaceReady: true }), false);
  await assert.rejects(pending, error => error.reasonCode === 'DESKTOP_ACTIVATION_RUNTIME_TIMEOUT');
});

test('negative renderer result rejects activation instead of showing a half-ready window', async () => {
  const window = fakeWindow();
  let challenge;
  const readiness = createMainWindowRuntimeReadiness({
    createId: () => 'probe-3',
    sendProbe: (_window, payload) => { challenge = payload; },
    timeoutMs: 100
  });
  const pending = readiness.probe(window, { reason: 'second-instance' });
  readiness.complete(window.webContents, {
    id: challenge.id,
    ok: false,
    backendReady: true,
    sessionReady: false,
    rendererReady: true,
    workspaceReady: false,
    reasonCode: 'API_SESSION_UNAUTHORIZED'
  });
  await assert.rejects(pending, error => error.reasonCode === 'API_SESSION_UNAUTHORIZED');
});
