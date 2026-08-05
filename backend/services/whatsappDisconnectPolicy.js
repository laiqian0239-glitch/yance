'use strict';

const AUTH_EPOCH_ACTION = Object.freeze({
  PRESERVE: 'PRESERVE',
  INCREMENT: 'INCREMENT',
  REVOKE: 'REVOKE'
});

const DEFAULT_DISCONNECT_REASONS = Object.freeze({
  loggedOut: 401,
  forbidden: 403,
  connectionLost: 408,
  timedOut: 408,
  multideviceMismatch: 411,
  connectionClosed: 428,
  connectionReplaced: 440,
  badSession: 500,
  unavailableService: 503,
  restartRequired: 515
});

function integer(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function statusFromError(error) {
  return integer(
    error?.output?.statusCode
      ?? error?.statusCode
      ?? error?.data?.statusCode
      ?? error?.cause?.output?.statusCode
      ?? error?.cause?.statusCode,
    0
  );
}

function result(input) {
  return Object.freeze({
    statusCode: integer(input.statusCode, 0),
    disposition: String(input.disposition),
    reasonCode: String(input.reasonCode),
    adapterState: String(input.adapterState),
    publicState: String(input.publicState),
    autoReconnect: input.autoReconnect === true,
    authEpochAction: String(input.authEpochAction),
    canAttemptSend: false,
    canReceive: false,
    manualReviewRequired: input.manualReviewRequired === true,
    ownershipLost: input.ownershipLost === true,
    restartRequired: input.restartRequired === true,
    retryClass: String(input.retryClass || 'NONE')
  });
}

function classifyDisconnect({
  statusCode,
  error,
  stopping = false,
  startupTimedOut = false,
  restartRequiredRebuilds = 0,
  disconnectReasons = DEFAULT_DISCONNECT_REASONS
} = {}) {
  const reasons = { ...DEFAULT_DISCONNECT_REASONS, ...(disconnectReasons || {}) };
  const code = integer(statusCode, statusFromError(error));

  if (stopping) {
    return result({
      statusCode: code,
      disposition: 'STOPPED_BY_OWNER',
      reasonCode: 'WHATSAPP_STOPPED_BY_OWNER',
      adapterState: 'stopped',
      publicState: 'logged-out',
      autoReconnect: false,
      authEpochAction: AUTH_EPOCH_ACTION.PRESERVE,
      manualReviewRequired: false
    });
  }

  if (startupTimedOut) {
    return result({
      statusCode: code,
      disposition: 'STARTUP_TIMEOUT',
      reasonCode: 'WHATSAPP_STARTUP_TIMEOUT',
      adapterState: 'startup-timeout',
      publicState: 'error',
      autoReconnect: false,
      authEpochAction: AUTH_EPOCH_ACTION.PRESERVE,
      manualReviewRequired: true
    });
  }

  if (code === integer(reasons.loggedOut)) {
    return result({
      statusCode: code,
      disposition: 'LOGGED_OUT',
      reasonCode: 'WHATSAPP_LOGGED_OUT',
      adapterState: 'logged-out',
      publicState: 'logged-out',
      autoReconnect: false,
      authEpochAction: AUTH_EPOCH_ACTION.REVOKE,
      manualReviewRequired: true
    });
  }

  if (code === integer(reasons.connectionReplaced)) {
    return result({
      statusCode: code,
      disposition: 'CONNECTION_REPLACED',
      reasonCode: 'WHATSAPP_CONNECTION_REPLACED',
      adapterState: 'replaced',
      publicState: 'manual-review',
      autoReconnect: false,
      authEpochAction: AUTH_EPOCH_ACTION.PRESERVE,
      manualReviewRequired: true,
      ownershipLost: true
    });
  }

  if (code === integer(reasons.restartRequired)) {
    if (integer(restartRequiredRebuilds) >= 1) {
      return result({
        statusCode: code,
        disposition: 'RESTART_REQUIRED_EXHAUSTED',
        reasonCode: 'WHATSAPP_RESTART_REQUIRED_EXHAUSTED',
        adapterState: 'manual-review',
        publicState: 'manual-review',
        autoReconnect: false,
        authEpochAction: AUTH_EPOCH_ACTION.PRESERVE,
        manualReviewRequired: true,
        restartRequired: true
      });
    }
    return result({
      statusCode: code,
      disposition: 'RESTART_REQUIRED_ONCE',
      reasonCode: 'WHATSAPP_RESTART_REQUIRED',
      adapterState: 'restarting',
      publicState: 'recovering',
      autoReconnect: true,
      authEpochAction: AUTH_EPOCH_ACTION.PRESERVE,
      manualReviewRequired: false,
      restartRequired: true,
      retryClass: 'IMMEDIATE_ONCE'
    });
  }

  if (code === integer(reasons.badSession)) {
    return result({
      statusCode: code,
      disposition: 'BAD_SESSION',
      reasonCode: 'WHATSAPP_BAD_SESSION',
      adapterState: 'quarantined',
      publicState: 'manual-review',
      autoReconnect: false,
      authEpochAction: AUTH_EPOCH_ACTION.REVOKE,
      manualReviewRequired: true
    });
  }

  if (code === integer(reasons.multideviceMismatch)) {
    return result({
      statusCode: code,
      disposition: 'MULTIDEVICE_MISMATCH',
      reasonCode: 'WHATSAPP_MULTIDEVICE_MISMATCH',
      adapterState: 'quarantined',
      publicState: 'manual-review',
      autoReconnect: false,
      authEpochAction: AUTH_EPOCH_ACTION.INCREMENT,
      manualReviewRequired: true
    });
  }

  if (code === integer(reasons.forbidden)) {
    return result({
      statusCode: code,
      disposition: 'FORBIDDEN',
      reasonCode: 'WHATSAPP_FORBIDDEN',
      adapterState: 'blocked',
      publicState: 'manual-review',
      autoReconnect: false,
      authEpochAction: AUTH_EPOCH_ACTION.PRESERVE,
      manualReviewRequired: true
    });
  }

  if (code === integer(reasons.connectionLost) || code === integer(reasons.timedOut)) {
    return result({
      statusCode: code,
      disposition: 'TRANSIENT_CONNECTION_LOSS',
      reasonCode: 'WHATSAPP_TRANSIENT_CONNECTION_LOSS',
      adapterState: 'reconnecting',
      publicState: 'recovering',
      autoReconnect: true,
      authEpochAction: AUTH_EPOCH_ACTION.PRESERVE,
      manualReviewRequired: false,
      retryClass: 'EXPONENTIAL'
    });
  }

  if (code === integer(reasons.connectionClosed)) {
    return result({
      statusCode: code,
      disposition: 'CONNECTION_CLOSED',
      reasonCode: 'WHATSAPP_CONNECTION_CLOSED',
      adapterState: 'reconnecting',
      publicState: 'recovering',
      autoReconnect: true,
      authEpochAction: AUTH_EPOCH_ACTION.PRESERVE,
      manualReviewRequired: false,
      retryClass: 'EXPONENTIAL'
    });
  }

  if (code === integer(reasons.unavailableService)) {
    return result({
      statusCode: code,
      disposition: 'SERVICE_UNAVAILABLE',
      reasonCode: 'WHATSAPP_SERVICE_UNAVAILABLE',
      adapterState: 'reconnecting',
      publicState: 'recovering',
      autoReconnect: true,
      authEpochAction: AUTH_EPOCH_ACTION.PRESERVE,
      manualReviewRequired: false,
      retryClass: 'EXPONENTIAL'
    });
  }

  return result({
    statusCode: code,
    disposition: 'UNKNOWN_FAIL_CLOSED',
    reasonCode: 'WHATSAPP_DISCONNECT_UNKNOWN',
    adapterState: 'unknown-disconnect',
    publicState: 'manual-review',
    autoReconnect: false,
    authEpochAction: AUTH_EPOCH_ACTION.PRESERVE,
    manualReviewRequired: true
  });
}

function shouldExecuteReconnect({
  policy,
  expectedGeneration,
  currentGeneration,
  expectedEpoch,
  currentEpoch,
  stopped = false,
  accountPresent = true
} = {}) {
  return Boolean(
    policy?.autoReconnect === true
      && stopped !== true
      && accountPresent === true
      && integer(expectedGeneration, -1) === integer(currentGeneration, -2)
      && integer(expectedEpoch, -1) === integer(currentEpoch, -2)
  );
}

module.exports = {
  AUTH_EPOCH_ACTION,
  DEFAULT_DISCONNECT_REASONS,
  classifyDisconnect,
  shouldExecuteReconnect,
  statusFromError
};
