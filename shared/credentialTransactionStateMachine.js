'use strict';

const STATES = Object.freeze({
  NEW: 'NEW', PREPARING: 'PREPARING', PREPARED: 'PREPARED', COMMITTING: 'COMMITTING',
  COMMITTED: 'COMMITTED', ABORTING: 'ABORTING', ROLLED_BACK: 'ROLLED_BACK',
  FAILED: 'FAILED', INDETERMINATE: 'INDETERMINATE'
});
const ALLOWED_STATES = Object.freeze(new Set(Object.values(STATES)));
const TERMINAL_STATES = Object.freeze(new Set([STATES.COMMITTED, STATES.ROLLED_BACK, STATES.FAILED]));
const TRANSITIONS = Object.freeze({
  NEW: new Set(['PREPARING', 'FAILED']),
  PREPARING: new Set(['PREPARED', 'ABORTING', 'FAILED', 'INDETERMINATE']),
  PREPARED: new Set(['COMMITTING', 'ABORTING', 'FAILED', 'INDETERMINATE']),
  COMMITTING: new Set(['COMMITTED', 'ABORTING', 'FAILED', 'INDETERMINATE']),
  COMMITTED: new Set(['ABORTING']),
  ABORTING: new Set(['ROLLED_BACK', 'FAILED', 'INDETERMINATE']),
  ROLLED_BACK: new Set(),
  FAILED: new Set(),
  INDETERMINATE: new Set(['COMMITTED', 'ABORTING', 'ROLLED_BACK', 'FAILED'])
});

class CredentialTransactionStateError extends Error {
  constructor(reasonCode, message, details = {}) {
    super(message || reasonCode);
    this.name = 'CredentialTransactionStateError';
    this.reasonCode = reasonCode;
    this.code = reasonCode;
    Object.assign(this, details);
  }
}

function assertState(state) {
  if (!ALLOWED_STATES.has(state)) throw new CredentialTransactionStateError('WP4_CREDENTIAL_TRANSACTION_JOURNAL_INVALID', `Illegal credential transaction state: ${state}`);
  return state;
}
function canTransition(from, to) { return Boolean(TRANSITIONS[assertState(from)]?.has(assertState(to))); }
function transitionTransaction(tx, nextState, clock = () => new Date().toISOString(), reasonCode = '') {
  const from = assertState(tx.state);
  const to = assertState(nextState);
  if (from !== to && !canTransition(from, to)) throw new CredentialTransactionStateError('CREDENTIAL_CUSTODY_TRANSACTION_STATE_INVALID', `Illegal credential transaction transition ${from} -> ${to}`, { from, to, requestId: tx.requestId });
  const at = clock();
  tx.state = to;
  tx.reasonCode = reasonCode || tx.reasonCode || '';
  tx.updatedAtUtc = at;
  if (!Array.isArray(tx.stateHistory)) tx.stateHistory = [];
  if (!tx.stateHistory.length || tx.stateHistory[tx.stateHistory.length - 1].state !== to) tx.stateHistory.push({ state: to, atUtc: at, reasonCode: reasonCode || '' });
  return tx;
}

module.exports = { ALLOWED_STATES, STATES, TERMINAL_STATES, TRANSITIONS, CredentialTransactionStateError, assertState, canTransition, transitionTransaction };
