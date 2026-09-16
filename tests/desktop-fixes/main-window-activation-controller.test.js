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
    visible: true,
    isDestroyed() { return this.destroyed; },
    isVisible() { return this.visible; },
    destroy() { this.destroyed = true; },
    webContents: {
      destroyed: false,
      loading: false,
      isDestroyed() { return this.destroyed; },
      isLoading() { return this.loading; },
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
  const backendWaits = [];
  controller = createMainWindowActivationController({
    getBackendReady: () => backendReady,
    waitForBackendReady: async waitOptions => {
      backendWaits.push({ ...waitOptions });
      if (typeof options.waitForBackendReady === 'function') {
        await options.waitForBackendReady(waitOptions);
      }
      backendReady = true;
    },
    getWindow: () => window,
    createWindow: () => {
      window = fakeWindow(window ? window.id + 1 : 1);
      if (typeof options.onWindowCreated === 'function') {
        const createdWindow = window;
        queueMicrotask(() => options.onWindowCreated({ controller, window: createdWindow }));
      }
      return window;
    },
    showWindow: target => { target.shown += 1; target.visible = true; },
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
    backendReadyTimeoutMs: options.backendReadyTimeoutMs,
    log: () => {}
  });
  return { controller, getWindow: () => window, activations, runtimeValidations, backendWaits };
}

function markReady(h) {
  const w = h.getWindow();
  h.controller.reset(w, 'test');
  h.controller.markPreloadReady(w);
  h.controller.markDidFinishLoad(w);
  h.controller.markRendererReady(w);
  h.controller.markActivationProbeResponderReady(w, { source: 'test-element-module-load' });
}

test('activation waits for backend and all renderer readiness phases', async () => {
  const h = harness({ backendReady: false });
  markReady(h);
  await h.controller.activate('tray-click', { view: 'system' });
  assert.equal(h.getWindow().shown, 1);
  assert.equal(h.activations.length, 1);
  assert.equal(h.activations[0].reason, 'tray-click');
});

test('renderer-ready Product window is visible while the existing backend lifecycle authority is still starting', async () => {
  let releaseBackend;
  const backendGate = new Promise(resolve => { releaseBackend = resolve; });
  const h = harness({ backendReady: false, waitForBackendReady: async () => backendGate });
  markReady(h);
  const activation = h.controller.activate('initial-launch');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.getWindow().shown, 1, 'renderer-ready Product recovery surface must not wait for backend startup');
  assert.equal(h.backendWaits.length, 1, 'backend readiness must still be delegated to the existing lifecycle authority');
  assert.equal(h.runtimeValidations.length, 0, 'runtime validation remains gated on backend readiness');
  assert.equal(h.activations.length, 0, 'activation dispatch remains gated on backend and runtime readiness');
  releaseBackend();
  await activation;
  assert.equal(h.runtimeValidations.length, 1);
  assert.equal(h.activations.length, 1);
});

test('backend startup failure stays terminal and does not misclassify the visible recovery surface as a renderer failure', async () => {
  const failure = Object.assign(new Error('backend owner failed'), { reasonCode: 'BACKEND_OWNER_FAILED' });
  const h = harness({ backendReady: false, waitForBackendReady: async () => { throw failure; } });
  markReady(h);
  await assert.rejects(h.controller.activate('initial-launch'), error => error === failure);
  assert.equal(h.getWindow().shown, 1);
  assert.equal(h.getWindow().reloads, 0, 'backend failure must not trigger renderer reload recovery');
  assert.equal(h.getWindow().destroyed, false, 'backend failure must not recreate or destroy the renderer-ready Product window');
  assert.equal(h.runtimeValidations.length, 0);
  assert.equal(h.activations.length, 0);
});

test('activation does not impose a second fixed deadline ahead of the backend lifecycle authority', async () => {
  const h = harness({
    backendReady: false,
    waitForBackendReady: async waitOptions => {
      assert.equal(
        Object.prototype.hasOwnProperty.call(waitOptions, 'timeoutMs'),
        false,
        'activation must not start a second fixed backend deadline while the backend lifecycle authority is still inside its own startup budget'
      );
    }
  });
  markReady(h);
  await h.controller.activate('post-install', { postInstall: true });
  assert.equal(h.backendWaits.length, 1);
  assert.equal(h.runtimeValidations.length, 1);
  assert.equal(h.activations.length, 1);
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

test('hidden loaded existing window does not wait on a stale renderer-readiness mirror before fresh runtime validation', async () => {
  const window = fakeWindow();
  window.visible = false;
  window.webContents.loading = false;
  const h = harness({ window, timeoutMs: 100 });
  h.controller.reset(window, 'stale-did-start-loading');

  const activation = h.controller.activate('second-instance');
  activation.catch(() => {});
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(window.shown, 1, 'hidden loaded BrowserWindow must acknowledge restore without waiting for stale mirror timeout');
  assert.equal(window.reloads, 0, 'fresh runtime validation must run before any reload recovery');
  assert.equal(h.runtimeValidations.length, 1, 'existing runtime readiness authority must validate the live renderer');
  await activation;
  assert.equal(h.activations.length, 1);
});
test('renderer timeout reloads once and then recreates the window', async () => {
  const h = harness({
    timeoutMs: 20,
    onWindowCreated: ({ controller, window }) => {
      controller.markPreloadReady(window);
      controller.markDidFinishLoad(window);
      controller.markRendererReady(window);
      controller.markActivationProbeResponderReady(window, { source: 'test-element-module-load' });
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
      controller.markActivationProbeResponderReady(window, { source: 'test-element-module-load' });
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

test('activation cannot enter runtime validation or dispatch before activation-probe responder registration', async () => {
  const h = harness({ timeoutMs: 80 });
  const window = h.getWindow();
  h.controller.reset(window, 'probe-responder-race');
  h.controller.markPreloadReady(window);
  h.controller.markDidFinishLoad(window);
  h.controller.markRendererReady(window);

  const activation = h.controller.activate('tray-click');
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(h.runtimeValidations.length, 0, 'three-phase renderer readiness must not start runtime validation before the production responder is registered');
  assert.equal(h.activations.length, 0, 'activation dispatch must remain blocked before responder registration');
  assert.equal(typeof h.controller.markActivationProbeResponderReady, 'function');

  h.controller.markActivationProbeResponderReady(window, { source: 'element-module-load' });
  await activation;
  assert.equal(h.runtimeValidations.length, 1);
  assert.equal(h.activations.length, 1);
});
