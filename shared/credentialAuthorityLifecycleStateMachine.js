'use strict';

const STATES = Object.freeze({
  UNINITIALIZED: 'UNINITIALIZED',
  LEGACY_AUTHORITY_DETECTED: 'LEGACY_AUTHORITY_DETECTED',
  BOOTSTRAP_PREPARING: 'BOOTSTRAP_PREPARING',
  BOOTSTRAP_COMMITTING: 'BOOTSTRAP_COMMITTING',
  MIGRATION_PREPARING: 'MIGRATION_PREPARING',
  MIGRATION_COMMITTING: 'MIGRATION_COMMITTING',
  ACTIVE: 'ACTIVE',
  OWNER_EXIT_RECOVERY: 'OWNER_EXIT_RECOVERY',
  UNAVAILABLE: 'UNAVAILABLE'
});
const ALLOWED_STATES = Object.freeze(new Set(Object.values(STATES)));
const TRANSITIONS = Object.freeze({
  UNINITIALIZED: new Set(['BOOTSTRAP_PREPARING', 'LEGACY_AUTHORITY_DETECTED', 'MIGRATION_PREPARING', 'ACTIVE', 'UNAVAILABLE']),
  LEGACY_AUTHORITY_DETECTED: new Set(['MIGRATION_PREPARING', 'UNAVAILABLE']),
  BOOTSTRAP_PREPARING: new Set(['BOOTSTRAP_COMMITTING', 'UNAVAILABLE']),
  BOOTSTRAP_COMMITTING: new Set(['ACTIVE', 'UNAVAILABLE']),
  MIGRATION_PREPARING: new Set(['MIGRATION_COMMITTING', 'UNAVAILABLE']),
  MIGRATION_COMMITTING: new Set(['ACTIVE', 'UNAVAILABLE']),
  ACTIVE: new Set(['OWNER_EXIT_RECOVERY', 'UNAVAILABLE']),
  OWNER_EXIT_RECOVERY: new Set(['ACTIVE', 'UNAVAILABLE']),
  UNAVAILABLE: new Set([])
});

class CredentialAuthorityLifecycleError extends Error {
  constructor(reasonCode, message, details = {}) {
    super(message || reasonCode);
    this.name = 'CredentialAuthorityLifecycleError';
    this.reasonCode = reasonCode;
    this.code = reasonCode;
    Object.assign(this, details);
  }
}

function assertLifecycleState(state) {
  if (!ALLOWED_STATES.has(state)) throw new CredentialAuthorityLifecycleError('WP4_CREDENTIAL_AUTHORITY_LIFECYCLE_STATE_INVALID', `Illegal credential authority lifecycle state: ${state}`);
  return state;
}
function canTransition(from, to) { return Boolean(TRANSITIONS[assertLifecycleState(from)]?.has(assertLifecycleState(to))); }
function transitionLifecycle(target, nextState, clock = () => new Date().toISOString(), reasonCode = '') {
  const from = assertLifecycleState(target.state);
  const to = assertLifecycleState(nextState);
  if (from !== to && !canTransition(from, to)) throw new CredentialAuthorityLifecycleError('WP4_CREDENTIAL_AUTHORITY_LIFECYCLE_TRANSITION_INVALID', `Illegal credential authority lifecycle transition ${from} -> ${to}`, { from, to });
  target.state = to;
  target.reasonCode = reasonCode || '';
  target.updatedAtUtc = clock();
  if (!Array.isArray(target.stateHistory)) target.stateHistory = [];
  if (!target.stateHistory.length || target.stateHistory[target.stateHistory.length - 1].state !== to) target.stateHistory.push({ state: to, atUtc: target.updatedAtUtc, reasonCode: reasonCode || '' });
  return target;
}
function sameOwnerSession(left, right) {
  if (!left || !right) return false;
  const fields = ['backendPid', 'startupNonce', 'backendSessionId', 'manifestSha256', 'vaultEpoch', 'hydrationGeneration', 'fd6PipeInstanceId'];
  return fields.every(field => String(left[field] ?? '') === String(right[field] ?? ''));
}
function validateOwnerSession(owner, reasonCode = 'WP4_CREDENTIAL_BACKEND_OWNER_SESSION_INVALID') {
  if (!owner || typeof owner !== 'object' || Array.isArray(owner)) throw new CredentialAuthorityLifecycleError(reasonCode, 'Backend owner session must be an object');
  if (!Number.isInteger(owner.backendPid) || owner.backendPid < 1) throw new CredentialAuthorityLifecycleError(reasonCode, 'backendPid must be positive');
  for (const field of ['startupNonce', 'backendSessionId', 'manifestSha256', 'vaultEpoch', 'fd6PipeInstanceId']) {
    if (typeof owner[field] !== 'string' || !owner[field]) throw new CredentialAuthorityLifecycleError(reasonCode, `${field} is required`);
  }
  if (!/^[0-9a-f]{64}$/.test(owner.manifestSha256)) throw new CredentialAuthorityLifecycleError(reasonCode, 'manifestSha256 is invalid');
  if (!Number.isInteger(owner.hydrationGeneration) || owner.hydrationGeneration < 1) throw new CredentialAuthorityLifecycleError(reasonCode, 'hydrationGeneration must be positive');
  return owner;
}

module.exports = { ALLOWED_STATES, STATES, TRANSITIONS, CredentialAuthorityLifecycleError, assertLifecycleState, canTransition, sameOwnerSession, transitionLifecycle, validateOwnerSession };
