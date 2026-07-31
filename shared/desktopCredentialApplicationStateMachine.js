'use strict';

const STATES = Object.freeze({
  UNINITIALIZED: 'UNINITIALIZED',
  IDLE: 'IDLE',
  LEASE_ACQUIRED: 'LEASE_ACQUIRED',
  OWNER_STOPPING: 'OWNER_STOPPING',
  OWNER_EXIT_CONFIRMED: 'OWNER_EXIT_CONFIRMED',
  OWNER_RECOVERING: 'OWNER_RECOVERING',
  MUTATION_COMMITTING: 'MUTATION_COMMITTING',
  NEW_OWNER_STARTING: 'NEW_OWNER_STARTING',
  NEW_OWNER_HYDRATING: 'NEW_OWNER_HYDRATING',
  NEW_OWNER_READY: 'NEW_OWNER_READY',
  REJECTED_OWNER_TERMINATION_PENDING: 'REJECTED_OWNER_TERMINATION_PENDING',
  REJECTED_OWNER_STILL_LIVE: 'REJECTED_OWNER_STILL_LIVE',
  FATAL_OWNER_CONTAINMENT: 'FATAL_OWNER_CONTAINMENT',
  STOPPED: 'STOPPED',
  FAILED_SAFE: 'FAILED_SAFE',
  UNAVAILABLE: 'UNAVAILABLE'
});

// This graph intentionally has one ordered replacement path:
// lease -> stop/exit/recovery -> mutation (optional) -> start/hydrate/ready.
// The only shortcuts are (a) validating an already-ready owner and (b) an
// owner-free exclusive operation returning to IDLE after recovery validation.
const ALLOWED = Object.freeze({
  [STATES.UNINITIALIZED]: new Set([STATES.IDLE, STATES.FAILED_SAFE, STATES.UNAVAILABLE]),
  [STATES.IDLE]: new Set([STATES.LEASE_ACQUIRED, STATES.FAILED_SAFE, STATES.UNAVAILABLE]),
  [STATES.LEASE_ACQUIRED]: new Set([
    STATES.OWNER_STOPPING,
    STATES.OWNER_EXIT_CONFIRMED,
    STATES.NEW_OWNER_HYDRATING,
    STATES.NEW_OWNER_READY,
    STATES.FAILED_SAFE,
    STATES.FATAL_OWNER_CONTAINMENT,
    STATES.UNAVAILABLE
  ]),
  [STATES.OWNER_STOPPING]: new Set([STATES.OWNER_EXIT_CONFIRMED, STATES.FAILED_SAFE, STATES.UNAVAILABLE]),
  [STATES.OWNER_EXIT_CONFIRMED]: new Set([STATES.OWNER_RECOVERING, STATES.FAILED_SAFE, STATES.UNAVAILABLE]),
  [STATES.OWNER_RECOVERING]: new Set([
    STATES.MUTATION_COMMITTING,
    STATES.NEW_OWNER_STARTING,
    STATES.STOPPED,
    STATES.IDLE,
    STATES.FAILED_SAFE,
    STATES.UNAVAILABLE
  ]),
  [STATES.MUTATION_COMMITTING]: new Set([STATES.NEW_OWNER_STARTING, STATES.FAILED_SAFE, STATES.UNAVAILABLE]),
  [STATES.NEW_OWNER_STARTING]: new Set([STATES.NEW_OWNER_HYDRATING, STATES.FATAL_OWNER_CONTAINMENT, STATES.FAILED_SAFE, STATES.UNAVAILABLE]),
  [STATES.NEW_OWNER_HYDRATING]: new Set([STATES.NEW_OWNER_READY, STATES.REJECTED_OWNER_TERMINATION_PENDING, STATES.FATAL_OWNER_CONTAINMENT, STATES.FAILED_SAFE, STATES.UNAVAILABLE]),
  [STATES.NEW_OWNER_READY]: new Set([STATES.IDLE, STATES.FAILED_SAFE, STATES.UNAVAILABLE]),
  [STATES.REJECTED_OWNER_TERMINATION_PENDING]: new Set([STATES.OWNER_EXIT_CONFIRMED, STATES.REJECTED_OWNER_STILL_LIVE, STATES.FATAL_OWNER_CONTAINMENT, STATES.FAILED_SAFE, STATES.UNAVAILABLE]),
  [STATES.REJECTED_OWNER_STILL_LIVE]: new Set([STATES.OWNER_EXIT_CONFIRMED, STATES.FATAL_OWNER_CONTAINMENT, STATES.UNAVAILABLE]),
  [STATES.FATAL_OWNER_CONTAINMENT]: new Set([STATES.OWNER_EXIT_CONFIRMED, STATES.FATAL_OWNER_CONTAINMENT, STATES.UNAVAILABLE]),
  [STATES.STOPPED]: new Set([STATES.IDLE, STATES.FAILED_SAFE, STATES.UNAVAILABLE]),
  [STATES.FAILED_SAFE]: new Set([STATES.IDLE, STATES.OWNER_STOPPING, STATES.OWNER_EXIT_CONFIRMED, STATES.UNAVAILABLE]),
  [STATES.UNAVAILABLE]: new Set([STATES.UNAVAILABLE])
});

function transitionDesktopCredentialApplication(lifecycle, nextState, clock = () => new Date().toISOString(), reasonCode = '', detail = {}) {
  if (!lifecycle || typeof lifecycle !== 'object') throw new TypeError('Desktop credential application lifecycle is required');
  if (!Object.values(STATES).includes(nextState)) {
    const error = new Error(`Unknown desktop credential application state: ${nextState}`);
    error.reasonCode = 'WP4_DESKTOP_CREDENTIAL_APPLICATION_STATE_INVALID';
    throw error;
  }
  const current = lifecycle.state || STATES.UNINITIALIZED;
  if (current !== nextState && !ALLOWED[current]?.has(nextState)) {
    const error = new Error(`Illegal desktop credential application transition: ${current} -> ${nextState}`);
    error.reasonCode = 'WP4_DESKTOP_CREDENTIAL_APPLICATION_TRANSITION_INVALID';
    error.currentState = current;
    error.nextState = nextState;
    throw error;
  }
  const atUtc = clock();
  lifecycle.state = nextState;
  lifecycle.reasonCode = String(reasonCode || '');
  lifecycle.updatedAtUtc = atUtc;
  lifecycle.stateHistory = Array.isArray(lifecycle.stateHistory) ? lifecycle.stateHistory : [];
  lifecycle.stateHistory.push({ state: nextState, atUtc, reasonCode: lifecycle.reasonCode, ...detail });
  if (lifecycle.stateHistory.length > 250) lifecycle.stateHistory.shift();
  return lifecycle;
}

module.exports = { ALLOWED, STATES, transitionDesktopCredentialApplication };
