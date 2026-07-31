'use strict';

// M4 — Owner Recovery (backend-side).
//
// The M1 root cause: when the DesktopHost owner restarts, the dedicated FD6
// credential custody pipe (named from the OLD fd6PipeInstanceId) disappears on
// the parent side. The backend's CredentialCustodyClient detects the lost
// channel (end/error -> _failAll) and, for any in-flight COMMIT, raises an
// indeterminate result whose default handler was `process.kill(pid, 'SIGTERM')`
// — i.e. the surviving backend suicided instead of waiting for the relaunched
// owner to re-attach.
//
// This module replaces that suicide with a recoverable lifecycle:
//   ACTIVE --(owner lost)--> OWNER_EXIT_DETECTED --(re-attach)--> ACTIVE
//                                        |
//                                        +--(recovery window expires)--> EXPIRED -> onRecoveryExpired (SIGTERM fallback)
//
// It is a pure, zero-dependency state machine so it can be unit-tested without
// Electron, a real pipe, or an actual process exit.

const STATES = Object.freeze({
  ACTIVE: 'ACTIVE',
  OWNER_EXIT_DETECTED: 'OWNER_EXIT_DETECTED',
  RECOVERING: 'RECOVERING',
  EXPIRED: 'EXPIRED'
});

const DEFAULT_WINDOW_MS = 30000;

function ownerExitError(reasonCode, message, details = {}) {
  const error = new Error(message || reasonCode);
  error.reasonCode = reasonCode;
  error.code = reasonCode;
  Object.assign(error, details);
  return error;
}

class OwnerRecovery {
  constructor(options = {}) {
    this.clock = options.clock || (() => new Date().toISOString());
    this.recoveryWindowMs = Math.max(500, Number(options.recoveryWindowMs || DEFAULT_WINDOW_MS));
    // Safety net preserved from M1: if the relaunched owner never re-attaches
    // within the recovery window, escalate to SIGTERM exactly as before. This
    // is injectable so tests never actually kill the process.
    this.onRecoveryExpired = options.onRecoveryExpired || ((reasonCode) => {
      try { process.kill(process.pid, 'SIGTERM'); } catch (_) { process.exitCode = 1; }
    });
    this._timer = null;
    this.state = STATES.ACTIVE;
    this.lastReasonCode = '';
    this.ownerContext = null;
    this.metrics = {
      ownerExitCount: 0,
      recoveryCount: 0,
      expiryCount: 0,
      lastOwnerExitAtUtc: '',
      lastRecoveryAtUtc: ''
    };
  }

  _clearTimer() {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }

  isRecovering() {
    return this.state === STATES.OWNER_EXIT_DETECTED || this.state === STATES.RECOVERING;
  }

  // Called when the custody channel is lost (owner restart, pipe error/end).
  // Idempotent: a second call while already in recovery is ignored.
  markOwnerExited(reasonCode = 'CREDENTIAL_VAULT_UNAVAILABLE', _detail = {}) {
    if (this.state !== STATES.ACTIVE) return false;
    this.state = STATES.OWNER_EXIT_DETECTED;
    this.lastReasonCode = reasonCode;
    const metrics = this.metrics;
    metrics.ownerExitCount += 1;
    metrics.lastOwnerExitAtUtc = this.clock();
    this._clearTimer();
    this._timer = setTimeout(() => {
      this.state = STATES.EXPIRED;
      metrics.expiryCount += 1;
      this.onRecoveryExpired(reasonCode);
    }, this.recoveryWindowMs);
    this._timer.unref?.();
    return true;
  }

  // Called by the relaunched owner's re-attach handshake (over the loopback
  // control channel). Validates the new owner context and resumes ACTIVE.
  attachNewOwner(context = {}) {
    if (this.state === STATES.ACTIVE) {
      throw ownerExitError('OWNER_RECOVERY_NOT_PENDING', 'No owner exit is pending recovery');
    }
    if (this.state === STATES.EXPIRED) {
      throw ownerExitError('OWNER_RECOVERY_EXPIRED', 'Owner recovery window already expired');
    }
    const fd6PipeInstanceId = String(context.fd6PipeInstanceId || '');
    const startupNonce = String(context.startupNonce || '');
    if (!fd6PipeInstanceId || !startupNonce) {
      throw ownerExitError('WP4_OWNER_RECOVERY_CONTEXT_REJECTED', 'Owner recovery context is missing required fields');
    }
    this._clearTimer();
    this.ownerContext = Object.freeze({
      fd6PipeInstanceId,
      startupNonce,
      credentialGeneration: Number(context.credentialGeneration || 0)
    });
    this.state = STATES.ACTIVE;
    const metrics = this.metrics;
    metrics.recoveryCount += 1;
    metrics.lastRecoveryAtUtc = this.clock();
    return Object.freeze({ accepted: true, state: this.state, ownerContext: this.ownerContext });
  }

  snapshot() {
    return Object.freeze({
      state: this.state,
      lastReasonCode: this.lastReasonCode,
      isRecovering: this.isRecovering(),
      ownerContext: this.ownerContext,
      recoveryWindowMs: this.recoveryWindowMs,
      ...this.metrics
    });
  }

  close() {
    this._clearTimer();
  }
}

module.exports = { DEFAULT_WINDOW_MS, OwnerRecovery, STATES };
