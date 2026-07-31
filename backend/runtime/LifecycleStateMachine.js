'use strict';

const { AppRuntimeError } = require('./errors');
const { recordConstruction } = require('./RuntimeConstructionDiagnostics');

const STATES = Object.freeze([
  'created',
  'manifest_verified',
  'ownership_acquired',
  'database_ready',
  'runtime_state_ready',
  'credential_channel_ready',
  'credential_hydrated',
  'local_account_state_restored',
  'api_contract_verified',
  'critical_workers_ready',
  'local_ready',
  'stopping',
  'stopped',
  'failed'
]);

const ALLOWED = new Map([
  ['created', new Set(['manifest_verified', 'failed'])],
  ['manifest_verified', new Set(['ownership_acquired', 'failed'])],
  ['ownership_acquired', new Set(['database_ready', 'failed'])],
  ['database_ready', new Set(['runtime_state_ready', 'failed'])],
  ['runtime_state_ready', new Set(['credential_channel_ready', 'api_contract_verified', 'failed'])],
  ['credential_channel_ready', new Set(['credential_hydrated', 'failed'])],
  ['credential_hydrated', new Set(['local_account_state_restored', 'failed'])],
  ['local_account_state_restored', new Set(['api_contract_verified', 'failed'])],
  ['api_contract_verified', new Set(['critical_workers_ready', 'failed'])],
  ['critical_workers_ready', new Set(['local_ready', 'stopping', 'failed'])],
  ['local_ready', new Set(['stopping', 'failed'])],
  ['stopping', new Set(['stopped', 'failed'])],
  ['stopped', new Set()],
  ['failed', new Set(['stopping', 'stopped'])]
]);

class LifecycleStateMachine {
  constructor(options = {}) {
    recordConstruction('LifecycleStateMachine');
    this.store = options.store;
    this.ownership = options.ownership;
    this.buildId = String(options.buildId || '');
    this.state = 'created';
    if (!this.store || !this.ownership || !this.buildId) throw new TypeError('store, ownership and buildId are required');
  }

  transition(toState, reasonCode = '') {
    if (!STATES.includes(toState)) throw new AppRuntimeError('LIFECYCLE_STATE_INVALID', `Unknown lifecycle state: ${toState}`, { status: 500 });
    if (!ALLOWED.get(this.state)?.has(toState)) {
      throw new AppRuntimeError('LIFECYCLE_TRANSITION_INVALID', `Invalid lifecycle transition ${this.state} -> ${toState}`, {
        status: 409, details: { fromState: this.state, toState }
      });
    }
    const fromState = this.state;
    const guard = this.ownership.guard();
    const result = this.store.recordTransition({
      ...guard,
      bootAttemptId: this.ownership.bootAttemptId,
      buildId: this.buildId,
      fromState,
      toState,
      reasonCode
    });
    this.state = toState;
    return result;
  }

  fail(reasonCode, failedPhase = this.state) {
    if (this.state === 'failed') return null;
    const original = this.state;
    const guard = this.ownership.guard();
    const result = this.store.recordTransition({
      ...guard,
      bootAttemptId: this.ownership.bootAttemptId,
      buildId: this.buildId,
      fromState: failedPhase || original,
      toState: 'failed',
      reasonCode: reasonCode || 'APP_RUNTIME_FAILED'
    });
    this.state = 'failed';
    return result;
  }

  snapshot() { return Object.freeze({ state: this.state }); }
}

module.exports = { LifecycleStateMachine, STATES };
