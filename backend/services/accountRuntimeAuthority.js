'use strict';

const CONNECTED_STATES = new Set(['online', 'connected', 'ready', 'limited']);

function clean(value) { return String(value == null ? '' : value).trim(); }
function boolOrUndefined(value) {
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  return undefined;
}
function connectedState(state) { return CONNECTED_STATES.has(clean(state).toLowerCase()); }

/**
 * Single authority for account send/receive projection.
 * Connectivity only proves that an adapter may be attempted. It never proves
 * that a payload was accepted by the real platform.
 */
function normalizeAccountRuntime(previous = {}, incoming = {}) {
  const state = clean(incoming.state || incoming.status || previous.state || previous.status);
  const connected = connectedState(state);
  const explicitAttempt = boolOrUndefined(incoming.canAttemptSend);
  const explicitVerified = boolOrUndefined(incoming.sendVerified);
  const legacyCanSend = boolOrUndefined(incoming.canSend);
  const explicitReceive = boolOrUndefined(incoming.canReceive);

  let canAttemptSend = explicitAttempt;
  if (canAttemptSend === undefined) {
    if (!connected) canAttemptSend = false;
    else if (legacyCanSend === false) canAttemptSend = false;
    else canAttemptSend = previous.canAttemptSend === true;
  }

  let sendVerified = explicitVerified;
  if (sendVerified === undefined) {
    if (!connected || canAttemptSend !== true) sendVerified = false;
    else if (incoming.deliveryTruth?.sendVerified === true) sendVerified = true;
    else if (incoming.deliveryTruth?.sendVerified === false) sendVerified = false;
    else sendVerified = previous.sendVerified === true;
  }

  // canSend is retained only as a compatibility alias for verified ACK truth.
  // No caller may derive it from connected/online state.
  const canSend = sendVerified === true;
  const canReceive = explicitReceive === undefined ? connected : explicitReceive;
  const sendReadiness = clean(incoming.sendReadiness)
    || (canAttemptSend !== true ? 'blocked' : sendVerified ? 'verified' : 'probe-required');

  return {
    state,
    connected,
    canAttemptSend: canAttemptSend === true,
    sendVerified,
    canSend,
    canReceive,
    sendReadiness
  };
}

function assertSendAttempt(account = {}, code = 'ACCOUNT_CANNOT_ATTEMPT_SEND') {
  const normalized = normalizeAccountRuntime(account, account);
  if (normalized.canAttemptSend !== true) {
    const error = new Error('The selected account does not satisfy send-attempt prerequisites');
    error.code = code;
    error.status = 409;
    error.accountId = clean(account.id || account.accountId);
    error.state = normalized.state;
    throw error;
  }
  return normalized;
}

module.exports = { CONNECTED_STATES, connectedState, normalizeAccountRuntime, assertSendAttempt };
