(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.YanceAccountAuthPollPolicy = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  const TERMINAL_STATES = new Set(['paused', 'logged-out', 'deleted', 'merged', 'tombstoned']);

  function classify(input = {}) {
    const accountId = String(input.accountId || '').trim();
    const awaitingQrAccountId = String(input.awaitingQrAccountId || '').trim();
    if (!accountId || awaitingQrAccountId !== accountId) {
      return { decision: 'stop', reasonCode: 'ACCOUNT_AUTH_REQUEST_INACTIVE' };
    }
    const account = input.account && typeof input.account === 'object' ? input.account : null;
    if (!account) return { decision: 'continue', reasonCode: 'ACCOUNT_RUNTIME_PENDING' };
    const state = String(account.state || '').trim().toLowerCase();
    const step = String(account.step || '').trim().toLowerCase();
    const platform = String(input.platform || account.platform || '').trim().toLowerCase();

    if (state === 'connected' || state === 'limited') {
      return { decision: 'connected', reasonCode: 'ACCOUNT_CONNECTED' };
    }
    if (platform === 'telegram' && (step === 'code' || step === 'password')) {
      return { decision: 'next-step', reasonCode: `TELEGRAM_${step.toUpperCase()}_REQUIRED` };
    }
    if (TERMINAL_STATES.has(state)) {
      return { decision: 'stop', reasonCode: `ACCOUNT_${state.toUpperCase().replace(/-/g, '_')}` };
    }
    // An adapter can briefly report `error`/`offline` before its reconnect
    // timer creates a fresh QR challenge. Those states are not terminal for an
    // active user-initiated QR request, so polling must continue until the
    // bounded deadline or an explicit terminal lifecycle state.
    return {
      decision: 'continue',
      reasonCode: state === 'error' || state === 'offline'
        ? 'ACCOUNT_TRANSIENT_ERROR_WAITING_FOR_QR_RETRY'
        : 'ACCOUNT_AUTH_CHALLENGE_PENDING'
    };
  }

  return Object.freeze({ classify, TERMINAL_STATES: Object.freeze([...TERMINAL_STATES]) });
});
