'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createMainWindowActivationController } = require('../../electron/mainWindowActivationController');

function fakeWindow(id = 1) {
  return {
    id,
    destroyed: false,
    shown: 0,
    reloads: 0,
    isDestroyed() { return this.destroyed; },
    destroy() { this.destroyed = true; },
    webContents: {
      destroyed: false,
      isDestroyed() { return this.destroyed; },
      reload() {}
    }
  };
}

function harness(options = {}) {
  let backendReady = options.backendReady !== false;
  let window = options.window || fakeWindow();
  let controller;
  const activations = [];
  const runtimeValidations = [];
  controller = createMainWindowActivationController({
    getBackendReady: () => backendReady,
    waitForBackendReady: async () => { backendReady = true; },
    getWindow: () => window,
    createWindow: () => {
      window = fakeWindow(window ? window.id + 1 : 1);
      if (typeof options.onWindowCreated === 'function') {
        const createdWindow = window;
        queueMicrotask(() => options.onWindowCreated({ controller, window: createdWindow }));
      }
      return window;
    },
    showWindow: target => { target.shown += 1; },
    sendActivation: (_target, request) => activations.push(request),
    reloadWindow: target => {
      target.reloads += 1;
      if (typeof options.onWindowReloaded === 'function') {
        queueMicrotask(() => options.onWindowReloaded({ controller, window: target }));
      }
    },
    destroyWindow: target => { target.destroy(); window = null; },
    validateRuntimeReady: async (target, request) => { runtimeValidations.push({ target, request }); return options.validateRuntimeReady ? options.validateRuntimeReady(target, request) : { ok: true }; },
    rendererReadyTimeoutMs: options.timeoutMs || 50,
    log: () => {}
  });
  return { controller, getWindow: () => window, activations, runtimeValidations };
}

function markReady(h) {
  const w = h.getWindow();
  h.controller.reset(w, 'test');
  h.controller.markPreloadReady(w);
  h.controller.markDidFinishLoad(w);
  h.controller.markRendererReady(w);
}

test('activation waits for backend and all three renderer readiness phases', async () => {
  const h = harness({ backendReady: false });
  markReady(h);
  await h.controller.activate('tray-click', { view: 'system' });
  assert.equal(h.getWindow().shown, 1);
  assert.equal(h.activations.length, 1);
  assert.equal(h.activations[0].reason, 'tray-click');
});

test('rapid activation requests are coalesced without creating a second window', async () => {
  const h = harness();
  markReady(h);
  const a = h.controller.activate('tray-click', {});
  const b = h.controller.activate('second-instance', { postInstall: true });
  await Promise.all([a, b]);
  assert.equal(h.getWindow().id, 1);
  assert.ok(h.activations.length >= 1 && h.activations.length <= 2);
  assert.equal(h.activations.at(-1).reason, 'second-instance');
});

test('renderer timeout reloads once and then recreates the window', async () => {
  const h = harness({
    timeoutMs: 20,
    onWindowCreated: ({ controller, window }) => {
      controller.markPreloadReady(window);
      controller.markDidFinishLoad(window);
      controller.markRendererReady(window);
    }
  });
  const first = h.getWindow();
  const activation = h.controller.activate('tray-click');
  await activation;
  assert.equal(first.reloads, 1);
  assert.notEqual(h.getWindow(), first);
  assert.equal(h.getWindow().shown, 1);
});


test('every activation performs a fresh runtime/session readiness validation before activation dispatch', async () => {
  const h = harness();
  markReady(h);
  await h.controller.activate('tray-click');
  await h.controller.activate('second-instance');
  assert.equal(h.runtimeValidations.length, 2);
  assert.equal(h.runtimeValidations[0].request.reason, 'tray-click');
  assert.equal(h.runtimeValidations[1].request.reason, 'second-instance');
  assert.equal(h.getWindow().shown, 2);
});

test('runtime readiness failure reloads after immediate presentation without duplicate show', async () => {
  let attempts = 0;
  const h = harness({
    timeoutMs: 80,
    validateRuntimeReady: async () => {
      attempts += 1;
      if (attempts === 1) throw Object.assign(new Error('session stale'), { reasonCode: 'API_SESSION_UNAUTHORIZED' });
      return { ok: true };
    },
    onWindowReloaded: ({ controller, window }) => {
      controller.markPreloadReady(window);
      controller.markDidFinishLoad(window);
      controller.markRendererReady(window);
    }
  });
  markReady(h);
  await h.controller.activate('tray-click');
  assert.equal(attempts, 2);
  assert.equal(h.getWindow().reloads, 1);
  assert.equal(h.getWindow().shown, 1);
});

test('renderer-ready window is shown before slow runtime validation completes', async () => {
  let releaseValidation;
  const validationGate = new Promise(resolve => { releaseValidation = resolve; });
  const h = harness({ validateRuntimeReady: async () => validationGate });
  markReady(h);
  const activation = h.controller.activate('tray-click');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.getWindow().shown, 1);
  assert.equal(h.activations.length, 0);
  releaseValidation({ ok: true });
  await activation;
  assert.equal(h.activations.length, 1);
});
