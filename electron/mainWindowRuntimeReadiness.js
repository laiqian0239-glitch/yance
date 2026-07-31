'use strict';

const { randomUUID } = require('crypto');

function readinessError(reasonCode, message, details = {}) {
  const error = new Error(message);
  error.reasonCode = reasonCode;
  error.details = details;
  return error;
}

/**
 * Per-activation renderer readiness challenge.
 *
 * Static did-finish-load/preload/DOMContentLoaded flags are insufficient after
 * a long tray suspension or backend restart. Every tray/second-instance/app
 * activation receives a fresh nonce and must prove that the renderer can reach
 * the authenticated local API and re-bootstrap its workspace before the main
 * window is shown.
 */
function createMainWindowRuntimeReadiness(options = {}) {
  const createId = options.createId || randomUUID;
  const sendProbe = options.sendProbe || ((window, payload) => window?.webContents?.send?.('desktop:activation-probe', payload));
  const timeoutMs = Math.max(250, Number(options.timeoutMs || 20000));
  const now = options.now || Date.now;
  const log = options.log || (() => {});
  const pending = new Map();

  function probe(window, request = {}) {
    if (!window || window.isDestroyed?.() || window.webContents?.isDestroyed?.()) {
      return Promise.reject(readinessError('DESKTOP_ACTIVATION_WINDOW_UNAVAILABLE', 'Main window is unavailable for runtime readiness validation'));
    }
    const id = String(createId());
    const createdAt = now();
    const challenge = {
      id,
      reason: String(request.reason || 'unknown'),
      sequence: Number(request.sequence || 0),
      requestedAt: Number(request.requestedAt || createdAt),
      sessionGeneration: String(request.sessionGeneration || ''),
      createdAt
    };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(readinessError('DESKTOP_ACTIVATION_RUNTIME_TIMEOUT', 'Renderer did not complete the activation runtime readiness challenge', {
          id,
          reason: challenge.reason,
          timeoutMs
        }));
      }, timeoutMs);
      pending.set(id, { id, window, sender: window.webContents, challenge, timer, resolve, reject });
      try {
        sendProbe(window, challenge);
      } catch (error) {
        clearTimeout(timer);
        pending.delete(id);
        reject(readinessError('DESKTOP_ACTIVATION_PROBE_SEND_FAILED', error.message || 'Failed to send renderer activation readiness challenge', { id }));
      }
    });
  }

  function complete(sender, payload = {}) {
    const id = String(payload.id || '');
    const entry = pending.get(id);
    if (!entry || sender !== entry.sender) return false;
    clearTimeout(entry.timer);
    pending.delete(id);
    const detail = {
      id,
      reason: entry.challenge.reason,
      backendReady: payload.backendReady === true,
      sessionReady: payload.sessionReady === true,
      rendererReady: payload.rendererReady === true,
      workspaceReady: payload.workspaceReady === true,
      completedAt: now(),
      rendererDetail: payload.detail && typeof payload.detail === 'object' ? payload.detail : {}
    };
    if (payload.ok !== true || !detail.backendReady || !detail.sessionReady || !detail.rendererReady || !detail.workspaceReady) {
      const error = readinessError(
        String(payload.reasonCode || 'DESKTOP_ACTIVATION_RUNTIME_NOT_READY'),
        String(payload.message || 'Renderer activation runtime readiness validation failed'),
        detail
      );
      log('warn', 'desktop-activation-runtime-not-ready', detail);
      entry.reject(error);
      return true;
    }
    entry.resolve(detail);
    return true;
  }

  function cancelWindow(window, reason = 'window-invalidated') {
    let cancelled = 0;
    for (const [id, entry] of pending) {
      if (entry.window !== window) continue;
      clearTimeout(entry.timer);
      pending.delete(id);
      entry.reject(readinessError('DESKTOP_ACTIVATION_WINDOW_INVALIDATED', 'Main window changed during activation runtime validation', { id, reason }));
      cancelled += 1;
    }
    return cancelled;
  }

  function snapshot() {
    return {
      pending: [...pending.values()].map(entry => ({ ...entry.challenge }))
    };
  }

  return { probe, complete, cancelWindow, snapshot };
}

module.exports = { createMainWindowRuntimeReadiness, readinessError };
