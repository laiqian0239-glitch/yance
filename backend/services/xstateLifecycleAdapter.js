'use strict';

const { deepFreeze } = require('../lib/deepFreeze');

let cachedXStateRuntime = null;

function adapterError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, ...details });
}

function loadXStateRuntime() {
  if (cachedXStateRuntime) return cachedXStateRuntime;

  const runtime = require('xstate');
  for (const exportName of ['createMachine', 'getInitialSnapshot', 'getNextSnapshot']) {
    if (typeof runtime?.[exportName] !== 'function') {
      throw adapterError(
        'WP_B_XSTATE_RUNTIME_INVALID',
        `XState runtime export is missing: ${exportName}`,
        { exportName }
      );
    }
  }

  cachedXStateRuntime = Object.freeze({
    createMachine: runtime.createMachine,
    getInitialSnapshot: runtime.getInitialSnapshot,
    getNextSnapshot: runtime.getNextSnapshot
  });
  return cachedXStateRuntime;
}

function assertRecord(value, code, message) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw adapterError(code, message);
  }
}

function normalizeConfig(config) {
  assertRecord(config, 'WP_B_XSTATE_CONFIG_INVALID', 'Lifecycle Adapter config must be an object');
  assertRecord(config.states, 'WP_B_XSTATE_CONFIG_INVALID', 'Lifecycle Adapter states must be an object');

  const initial = String(config.initial || '');
  const stateNames = Object.keys(config.states);
  if (!initial || !stateNames.includes(initial)) {
    throw adapterError(
      'WP_B_XSTATE_INITIAL_STATE_INVALID',
      'Lifecycle Adapter initial state must name a configured state',
      { initial }
    );
  }

  const states = {};
  const eventNames = new Set();
  for (const stateName of stateNames) {
    if (!stateName) {
      throw adapterError('WP_B_XSTATE_STATE_INVALID', 'Lifecycle Adapter state name cannot be empty');
    }
    const stateConfig = config.states[stateName];
    assertRecord(
      stateConfig,
      'WP_B_XSTATE_CONFIG_INVALID',
      `Lifecycle Adapter state config must be an object: ${stateName}`
    );

    const transitions = stateConfig.on === undefined ? {} : stateConfig.on;
    assertRecord(
      transitions,
      'WP_B_XSTATE_CONFIG_INVALID',
      `Lifecycle Adapter transitions must be an object: ${stateName}`
    );

    const on = {};
    for (const [eventType, targetStateValue] of Object.entries(transitions)) {
      const targetState = String(targetStateValue || '');
      if (!eventType) {
        throw adapterError('WP_B_XSTATE_EVENT_INVALID', 'Lifecycle Adapter event type cannot be empty');
      }
      if (!targetState) {
        throw adapterError(
          'WP_B_XSTATE_TARGET_STATE_INVALID',
          'Lifecycle Adapter transition target cannot be empty',
          { state: stateName, eventType }
        );
      }
      eventNames.add(eventType);
      on[eventType] = targetState;
    }

    states[stateName] = {
      terminal: stateConfig.terminal === true,
      on
    };
  }

  for (const [stateName, stateConfig] of Object.entries(states)) {
    if (stateConfig.terminal && Object.keys(stateConfig.on).length !== 0) {
      throw adapterError(
        'WP_B_XSTATE_TERMINAL_TRANSITION_INVALID',
        'Terminal lifecycle states cannot define outgoing transitions',
        { state: stateName }
      );
    }
    for (const [eventType, targetState] of Object.entries(stateConfig.on)) {
      if (!Object.hasOwn(states, targetState)) {
        throw adapterError(
          'WP_B_XSTATE_TARGET_STATE_INVALID',
          'Lifecycle Adapter transition target is not configured',
          { state: stateName, eventType, targetState }
        );
      }
    }
  }

  return deepFreeze({
    id: String(config.id || 'yanceLifecycle'),
    initial,
    states,
    eventNames: [...eventNames].sort()
  });
}

function toMachineConfig(config) {
  return {
    id: config.id,
    initial: config.initial,
    context: {},
    states: Object.fromEntries(
      Object.entries(config.states).map(([stateName, stateConfig]) => [
        stateName,
        stateConfig.terminal
          ? { type: 'final' }
          : {
              on: Object.fromEntries(
                Object.entries(stateConfig.on).map(([eventType, targetState]) => [
                  eventType,
                  { target: targetState }
                ])
              )
            }
      ])
    )
  };
}

function createLifecycleAdapter(inputConfig) {
  const config = normalizeConfig(inputConfig);
  const stateNames = new Set(Object.keys(config.states));
  const eventNames = new Set(config.eventNames);
  const {
    createMachine,
    getInitialSnapshot,
    getNextSnapshot
  } = loadXStateRuntime();
  const machine = createMachine(toMachineConfig(config));
  const initialSnapshot = getInitialSnapshot(machine);
  const initialStateValue = String(initialSnapshot.value);

  if (initialStateValue !== config.initial) {
    throw adapterError(
      'WP_B_XSTATE_INITIAL_STATE_PARITY_VIOLATION',
      'XState initial state differs from the Yance lifecycle config',
      { expectedState: config.initial, actualState: initialStateValue }
    );
  }

  return Object.freeze({
    initialState() {
      return initialStateValue;
    },

    transition(stateValue, eventTypeValue) {
      const state = String(stateValue || '');
      const eventType = String(eventTypeValue || '');

      if (!stateNames.has(state)) {
        throw adapterError(
          'WP_B_XSTATE_STATE_INVALID',
          'Unknown XState Adapter lifecycle state',
          { state }
        );
      }
      if (!eventNames.has(eventType)) {
        throw adapterError(
          'WP_B_XSTATE_EVENT_INVALID',
          'Unknown XState Adapter lifecycle event',
          { eventType }
        );
      }

      const expectedTarget = config.states[state].on[eventType];
      if (!expectedTarget) {
        throw adapterError(
          'WP_B_XSTATE_TRANSITION_INVALID',
          'Illegal XState Adapter lifecycle transition',
          { state, eventType }
        );
      }

      const currentSnapshot = machine.resolveState({ value: state, context: {} });
      const nextSnapshot = getNextSnapshot(machine, currentSnapshot, { type: eventType });
      const actualTarget = String(nextSnapshot.value);
      if (actualTarget !== expectedTarget) {
        throw adapterError(
          'WP_B_XSTATE_TRANSITION_PARITY_VIOLATION',
          'XState transition differs from the frozen Yance lifecycle config',
          { state, eventType, expectedTarget, actualTarget }
        );
      }
      return actualTarget;
    }
  });
}

module.exports = {
  createLifecycleAdapter
};
