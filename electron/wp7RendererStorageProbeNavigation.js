'use strict';

const TRANSIENT_NAVIGATION_CODES = new Set([
  'ERR_FAILED',
  'ERR_CONNECTION_REFUSED',
  'ERR_CONNECTION_RESET',
  'ERR_CONNECTION_CLOSED',
  '-2',
  '-102',
  '-104',
  '-100'
]);

function navigationErrorCode(error) {
  const direct = String(error?.code ?? '').trim();
  if (direct) return direct;
  const match = String(error?.message || '').match(/\b(ERR_[A-Z_]+)\b/);
  return match ? match[1] : '';
}

function isTransientRendererNavigationError(error) {
  const code = navigationErrorCode(error);
  return TRANSIENT_NAVIGATION_CODES.has(code);
}

function destroyView(view) {
  try {
    if (view && !view.isDestroyed()) view.destroy();
  } catch (_) {}
}

function usableView(view) {
  if (!view) return false;
  try {
    if (view.isDestroyed()) return false;
    if (!view.webContents || view.webContents.isDestroyed?.()) return false;
    return true;
  } catch (_) {
    return false;
  }
}

function createNavigationFailure(failures) {
  const error = new Error('safe-mode renderer storage navigation did not reach the trusted local frontend');
  error.reasonCode = 'WP7_SAFE_MODE_RENDERER_STORAGE_NAVIGATION_FAILED';
  error.details = { failures };
  return error;
}

async function runRendererStorageProbeNavigation(options = {}) {
  const {
    createView,
    waitForReady,
    verifyView,
    url,
    script,
    attempts = 5,
    delayMs = 100,
    retainView = false,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  } = options;
  if (typeof createView !== 'function' || typeof waitForReady !== 'function' || !url || !script) {
    const error = new Error('renderer storage probe navigation options are incomplete');
    error.reasonCode = 'WP7_SAFE_MODE_RENDERER_STORAGE_NAVIGATION_CONFIGURATION_INVALID';
    throw error;
  }
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 10 || !Number.isFinite(delayMs) || delayMs < 0) {
    const error = new Error('renderer storage probe navigation retry policy is invalid');
    error.reasonCode = 'WP7_SAFE_MODE_RENDERER_STORAGE_NAVIGATION_CONFIGURATION_INVALID';
    throw error;
  }

  const failures = [];
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let view = null;
    let phase = 'readiness';
    let succeeded = false;
    try {
      await waitForReady({ attempt });
      view = createView({ attempt });
      phase = 'navigation';
      await view.loadURL(url);
      phase = 'document-verification';
      if (typeof verifyView === 'function' && await verifyView(view, { attempt }) !== true) {
        const error = new Error('safe-mode renderer storage document marker is invalid');
        error.code = 'WP7_RENDERER_STORAGE_PROBE_DOCUMENT_INVALID';
        throw error;
      }
      phase = 'renderer-storage';
      const value = await view.webContents.executeJavaScript(script, true);
      succeeded = true;
      return retainView ? { value, view } : value;
    } catch (error) {
      const code = navigationErrorCode(error);
      failures.push({ attempt, phase, code, message: String(error?.message || error) });
      const retryable = phase === 'navigation' && isTransientRendererNavigationError(error) && attempt < attempts;
      if (!retryable) throw createNavigationFailure(failures);
    } finally {
      if (!succeeded || !retainView) destroyView(view);
    }
    await sleep(delayMs * attempt);
  }
  throw createNavigationFailure(failures);
}

function createRendererStorageProbeSession(options = {}) {
  let retainedView = null;
  const navigationOptions = { ...options, retainView: true };

  async function execute(script) {
    if (!script) {
      const error = new Error('renderer storage probe script is required');
      error.reasonCode = 'WP7_SAFE_MODE_RENDERER_STORAGE_NAVIGATION_CONFIGURATION_INVALID';
      throw error;
    }
    if (usableView(retainedView)) {
      try {
        return await retainedView.webContents.executeJavaScript(script, true);
      } catch (_) {
        destroyView(retainedView);
        retainedView = null;
      }
    }
    const acquired = await runRendererStorageProbeNavigation({ ...navigationOptions, script });
    retainedView = acquired.view;
    return acquired.value;
  }

  function dispose() {
    destroyView(retainedView);
    retainedView = null;
  }

  function snapshot() {
    return Object.freeze({ retained: usableView(retainedView) });
  }

  return Object.freeze({ execute, dispose, snapshot });
}

module.exports = {
  TRANSIENT_NAVIGATION_CODES,
  isTransientRendererNavigationError,
  runRendererStorageProbeNavigation,
  createRendererStorageProbeSession
};
