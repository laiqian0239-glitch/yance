'use strict';

function timeoutError(reasonCode, message, details = {}) {
  const error = new Error(message);
  error.reasonCode = reasonCode;
  error.details = details;
  return error;
}

function createMainWindowActivationController(options = {}) {
  const getBackendReady = options.getBackendReady || (() => false);
  const waitForBackendReady = options.waitForBackendReady || (async () => {});
  const getWindow = options.getWindow || (() => null);
  const createWindow = options.createWindow || (() => null);
  const showWindow = options.showWindow || (() => {});
  const sendActivation = options.sendActivation || (() => {});
  const reloadWindow = options.reloadWindow || (window => window?.webContents?.reload?.());
  const destroyWindow = options.destroyWindow || (window => window?.destroy?.());
  const validateRuntimeReady = options.validateRuntimeReady || (async () => ({ ok: true }));
  const notifyRecovery = options.notifyRecovery || (() => {});
  const log = options.log || (() => {});
  const rendererReadyTimeoutMs = Math.max(25, Number(options.rendererReadyTimeoutMs || 8000));

  let readiness = freshReadiness(null, 'initial');
  let pending = null;
  let activePromise = null;
  let requestSequence = 0;
  const waiters = new Set();

  function freshReadiness(window, reason) {
    return {
      window,
      reason,
      didFinishLoad: false,
      preloadReady: false,
      rendererReady: false,
      activationProbeResponderReady: false,
      changedAt: Date.now()
    };
  }

  function currentWindowMatches(target) {
    const window = getWindow();
    return Boolean(window && target && window === target && !window.isDestroyed?.());
  }

  function isReady(window = getWindow()) {
    return currentWindowMatches(window)
      && readiness.window === window
      && readiness.didFinishLoad
      && readiness.preloadReady
      && readiness.rendererReady
      && readiness.activationProbeResponderReady
      && !window.webContents?.isDestroyed?.();
  }

  function canProbeHiddenLoadedExistingWindow(window) {
    return currentWindowMatches(window)
      && typeof window?.isVisible === 'function'
      && window.isVisible() === false
      && typeof window.webContents?.isLoading === 'function'
      && window.webContents.isLoading() === false
      && !window.webContents?.isDestroyed?.();
  }

  function notifyWaiters() {
    for (const waiter of [...waiters]) waiter();
  }

  function reset(window, reason = 'reset') {
    readiness = freshReadiness(window || null, reason);
    notifyWaiters();
    return snapshot();
  }

  function mark(window, phase, metadata = {}) {
    if (!currentWindowMatches(window)) return false;
    if (readiness.window !== window) readiness = freshReadiness(window, `window-bound:${phase}`);
    if (!['didFinishLoad', 'preloadReady', 'rendererReady', 'activationProbeResponderReady'].includes(phase)) return false;
    readiness[phase] = true;
    readiness.changedAt = Date.now();
    readiness[`${phase}Metadata`] = metadata || {};
    notifyWaiters();
    return true;
  }

  function waitForRendererReady(window, timeoutMs = rendererReadyTimeoutMs) {
    if (isReady(window)) return Promise.resolve(snapshot());
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        waiters.delete(check);
        if (error) reject(error);
        else resolve(snapshot());
      };
      const check = () => {
        if (!currentWindowMatches(window)) {
          finish(timeoutError('DESKTOP_ACTIVATION_WINDOW_REPLACED', 'Main window changed while waiting for renderer readiness'));
          return;
        }
        if (isReady(window)) finish();
      };
      const timer = setTimeout(() => finish(timeoutError(
        'DESKTOP_RENDERER_READY_TIMEOUT',
        'Renderer did not complete the desktop activation handshake in time',
        snapshot()
      )), timeoutMs);
      waiters.add(check);
      check();
    });
  }

  async function ensureReadyWindow(request) {
    const reason = String(request?.reason || 'unknown');
    let presentedWindow = null;
    const reportRecovery = (window, state, detail = {}) => {
      try { notifyRecovery(window, request, state, detail); } catch (error) {
        log('warn', 'desktop-activation-recovery-notification-failed', { reason, state, error: error.message });
      }
    };
    const present = (window, phase) => {
      if (!window || presentedWindow === window) return false;
      showWindow(window, request);
      presentedWindow = window;
      reportRecovery(window, 'visible-recovering', { phase });
      return true;
    };
    const runAttempt = async (window, phase, presentPhase, options = {}) => {
      let stage = 'renderer';
      try {
        const liveHiddenWindow = options.allowHiddenLoadedWindowProbe === true && canProbeHiddenLoadedExistingWindow(window);
        if (!liveHiddenWindow) await waitForRendererReady(window);
        present(window, presentPhase);
        stage = 'backend';
        await waitForBackendReady({ reason });
        if (!getBackendReady()) throw timeoutError('DESKTOP_BACKEND_NOT_READY', 'Backend is not ready for main-window activation', { reason });
        stage = 'runtime';
        reportRecovery(window, 'validating-runtime', { phase });
        const result = await validateRuntimeReady(window, request);
        reportRecovery(window, 'ready', { phase, result });
        return { ok: true, window };
      } catch (error) {
        return { ok: false, error, stage };
      }
    };

    let window = getWindow();
    const reusedExistingWindow = Boolean(window && !window.isDestroyed?.() && !window.webContents?.isDestroyed?.());
    if (!reusedExistingWindow) {
      window = createWindow({ reason });
      reset(window, 'created-for-activation');
    } else if (readiness.window !== window) {
      reset(window, 'existing-window-bound');
    }

    const firstAttempt = await runAttempt(window, 'initial', 'renderer-ready', {
      allowHiddenLoadedWindowProbe: reusedExistingWindow
    });
    if (firstAttempt.ok) return window;
    if (firstAttempt.stage === 'backend') {
      reportRecovery(window, 'failed', { reasonCode: firstAttempt.error.reasonCode || '', message: firstAttempt.error.message });
      throw firstAttempt.error;
    }
    const firstError = firstAttempt.error;
    reportRecovery(window, 'recovering-reload', { reasonCode: firstError.reasonCode || '', message: firstError.message });
    log('warn', 'desktop-activation-readiness-failed', { reason, stage: 'reload', reasonCode: firstError.reasonCode || '', error: firstError.message, readiness: snapshot() });

    reset(window, 'activation-reload');
    reloadWindow(window);
    const secondAttempt = await runAttempt(window, 'reload', 'renderer-reloaded');
    if (secondAttempt.ok) return window;
    if (secondAttempt.stage === 'backend') {
      reportRecovery(window, 'failed', { reasonCode: secondAttempt.error.reasonCode || '', message: secondAttempt.error.message });
      throw secondAttempt.error;
    }
    const secondError = secondAttempt.error;
    reportRecovery(window, 'recovering-recreate', { reasonCode: secondError.reasonCode || '', message: secondError.message });
    log('error', 'desktop-activation-readiness-reload-failed', { reason, stage: 'recreate', reasonCode: secondError.reasonCode || '', error: secondError.message, readiness: snapshot() });

    try { destroyWindow(window); } catch (_) {}
    window = createWindow({ reason: `${reason}:recreate` });
    reset(window, 'activation-recreate');
    const finalAttempt = await runAttempt(window, 'recreate', 'renderer-recreated');
    if (finalAttempt.ok) return window;
    reportRecovery(window, 'failed', { reasonCode: finalAttempt.error.reasonCode || '', message: finalAttempt.error.message });
    throw finalAttempt.error;
  }

  function mergeRequest(reason, payload) {
    requestSequence += 1;
    pending = {
      sequence: requestSequence,
      reason: String(reason || 'unknown'),
      payload: payload && typeof payload === 'object' ? { ...payload } : {},
      requestedAt: Date.now()
    };
    return pending;
  }

  async function drain() {
    while (pending) {
      const request = pending;
      pending = null;
      const window = await ensureReadyWindow(request);
      sendActivation(window, request);
      log('info', 'desktop-main-window-activated', {
        reason: request.reason,
        sequence: request.sequence,
        latencyMs: Math.max(0, Date.now() - request.requestedAt)
      });
    }
    return snapshot();
  }

  function activate(reason, payload = {}) {
    mergeRequest(reason, payload);
    if (!activePromise) {
      activePromise = drain().finally(() => { activePromise = null; });
    }
    return activePromise;
  }

  function snapshot() {
    return {
      ...readiness,
      ready: isReady(readiness.window),
      pending: pending ? { ...pending } : null,
      active: Boolean(activePromise)
    };
  }

  return {
    activate,
    reset,
    markDidFinishLoad: (window, metadata) => mark(window, 'didFinishLoad', metadata),
    markPreloadReady: (window, metadata) => mark(window, 'preloadReady', metadata),
    markRendererReady: (window, metadata) => mark(window, 'rendererReady', metadata),
    markActivationProbeResponderReady: (window, metadata) => mark(window, 'activationProbeResponderReady', metadata),
    isReady,
    snapshot
  };
}

module.exports = { createMainWindowActivationController };
