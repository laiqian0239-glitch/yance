'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

function lifecycle() {
  return require('../../../services/durableExecutionLifecycle');
}

test('WP-B lifecycle includes claimed and uncertain remote outcome as nonterminal states', () => {
  const { STATES, isTerminalState } = lifecycle();
  assert.equal(STATES.CLAIMED, 'CLAIMED');
  assert.equal(STATES.UNCERTAIN_REMOTE_OUTCOME, 'UNCERTAIN_REMOTE_OUTCOME');
  assert.equal(isTerminalState(STATES.UNCERTAIN_REMOTE_OUTCOME), false);
});

test('remote result loss enters reconciliation instead of ordinary failure', () => {
  const { STATES, EVENTS, nextLifecycleState } = lifecycle();
  assert.equal(
    nextLifecycleState(STATES.WAITING_REMOTE, EVENTS.REMOTE_RESULT_LOST),
    STATES.UNCERTAIN_REMOTE_OUTCOME
  );
});

test('blind retry from uncertain outcome fails closed', () => {
  const { STATES, EVENTS, nextLifecycleState } = lifecycle();
  assert.throws(
    () => nextLifecycleState(STATES.UNCERTAIN_REMOTE_OUTCOME, EVENTS.RETRY),
    error => error?.code === 'WP_B_RECONCILIATION_REQUIRED'
  );
});

test('illegal transitions return a stable Yance error code', () => {
  const { STATES, EVENTS, nextLifecycleState } = lifecycle();
  assert.throws(
    () => nextLifecycleState(STATES.CREATED, EVENTS.REMOTE_SUCCESS),
    error => error?.code === 'WP_B_LIFECYCLE_TRANSITION_INVALID'
  );
});
