'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '../../../..');

function runScenario(body) {
  return spawnSync(process.execPath, ['-e', body], {
    cwd: REPO_ROOT,
    encoding: 'utf8'
  });
}

function assertScenario(body, label) {
  const result = runScenario(body);
  assert.equal(result.status, 0, `${label}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
}

const CONFIG_SOURCE = String.raw`
  const config = {
    id: 'faultLifecycle',
    initial: 'CREATED',
    states: {
      CREATED: { terminal: false, on: { SCHEDULE: 'SCHEDULED' } },
      SCHEDULED: { terminal: true, on: {} }
    }
  };
`;

test('missing XState runtime is normalized only when the first transition is requested', () => {
  assertScenario(String.raw`
    const Module = require('node:module');
    const originalLoad = Module._load;
    Module._load = function faultedLoad(request, parent, isMain) {
      if (request === 'xstate') {
        const error = new Error('fault injected: package unavailable');
        error.code = 'MODULE_NOT_FOUND';
        throw error;
      }
      return originalLoad.call(this, request, parent, isMain);
    };
    const lifecycle = require('./backend/services/durableExecutionLifecycle');
    const migration = require('./backend/migrations/architectureClosureV2WpB');
    if (migration.TARGET_SCHEMA_VERSION !== 23) process.exit(31);
    if (lifecycle.STATES.CREATED !== 'CREATED') process.exit(32);
    try {
      lifecycle.nextLifecycleState(lifecycle.STATES.CREATED, lifecycle.EVENTS.SCHEDULE);
      process.exit(33);
    } catch (error) {
      if (error.code !== 'WP_B_XSTATE_RUNTIME_UNAVAILABLE') process.exit(34);
      if (error.phase !== 'LOAD_RUNTIME') process.exit(35);
      if (error.causeCode !== 'MODULE_NOT_FOUND') process.exit(36);
    }
  `, 'runtime unavailable');
});

test('missing runtime exports fail with a stable boundary error', () => {
  assertScenario(String.raw`
    const Module = require('node:module');
    const originalLoad = Module._load;
    Module._load = function faultedLoad(request, parent, isMain) {
      if (request === 'xstate') return { createMachine() {}, getInitialSnapshot() {} };
      return originalLoad.call(this, request, parent, isMain);
    };
    const { createLifecycleAdapter } = require('./backend/services/xstateLifecycleAdapter');
    ${CONFIG_SOURCE}
    try {
      createLifecycleAdapter(config);
      process.exit(41);
    } catch (error) {
      if (error.code !== 'WP_B_XSTATE_RUNTIME_INVALID') process.exit(42);
      if (error.exportName !== 'getNextSnapshot') process.exit(43);
    }
  `, 'runtime export missing');
});

test('machine construction failure is normalized and cannot fall back to the Yance target', () => {
  assertScenario(String.raw`
    const Module = require('node:module');
    const originalLoad = Module._load;
    Module._load = function faultedLoad(request, parent, isMain) {
      if (request === 'xstate') return {
        createMachine() {
          const error = new Error('fault injected: machine construction');
          error.code = 'FAKE_CREATE_MACHINE_FAILURE';
          throw error;
        },
        getInitialSnapshot() {},
        getNextSnapshot() {}
      };
      return originalLoad.call(this, request, parent, isMain);
    };
    const { createLifecycleAdapter } = require('./backend/services/xstateLifecycleAdapter');
    ${CONFIG_SOURCE}
    try {
      createLifecycleAdapter(config);
      process.exit(51);
    } catch (error) {
      if (error.code !== 'WP_B_XSTATE_RUNTIME_FAILURE') process.exit(52);
      if (error.phase !== 'CREATE_MACHINE') process.exit(53);
      if (error.causeCode !== 'FAKE_CREATE_MACHINE_FAILURE') process.exit(54);
    }
  `, 'machine construction failure');
});

test('initial snapshot failure is normalized with its exact runtime phase', () => {
  assertScenario(String.raw`
    const Module = require('node:module');
    const originalLoad = Module._load;
    Module._load = function faultedLoad(request, parent, isMain) {
      if (request === 'xstate') return {
        createMachine() { return {}; },
        getInitialSnapshot() {
          const error = new Error('fault injected: initial snapshot');
          error.code = 'FAKE_INITIAL_SNAPSHOT_FAILURE';
          throw error;
        },
        getNextSnapshot() {}
      };
      return originalLoad.call(this, request, parent, isMain);
    };
    const { createLifecycleAdapter } = require('./backend/services/xstateLifecycleAdapter');
    ${CONFIG_SOURCE}
    try {
      createLifecycleAdapter(config);
      process.exit(61);
    } catch (error) {
      if (error.code !== 'WP_B_XSTATE_RUNTIME_FAILURE') process.exit(62);
      if (error.phase !== 'INITIAL_SNAPSHOT') process.exit(63);
      if (error.causeCode !== 'FAKE_INITIAL_SNAPSHOT_FAILURE') process.exit(64);
    }
  `, 'initial snapshot failure');
});

test('transition runtime failure is normalized and never returns the configured target', () => {
  assertScenario(String.raw`
    const Module = require('node:module');
    const originalLoad = Module._load;
    Module._load = function faultedLoad(request, parent, isMain) {
      if (request === 'xstate') return {
        createMachine() {
          return { resolveState(value) { return value; } };
        },
        getInitialSnapshot() { return { value: 'CREATED' }; },
        getNextSnapshot() {
          const error = new Error('fault injected: transition');
          error.code = 'FAKE_TRANSITION_FAILURE';
          throw error;
        }
      };
      return originalLoad.call(this, request, parent, isMain);
    };
    const { createLifecycleAdapter } = require('./backend/services/xstateLifecycleAdapter');
    ${CONFIG_SOURCE}
    const adapter = createLifecycleAdapter(config);
    try {
      adapter.transition('CREATED', 'SCHEDULE');
      process.exit(71);
    } catch (error) {
      if (error.code !== 'WP_B_XSTATE_RUNTIME_FAILURE') process.exit(72);
      if (error.phase !== 'TRANSITION') process.exit(73);
      if (error.causeCode !== 'FAKE_TRANSITION_FAILURE') process.exit(74);
    }
  `, 'transition failure');
});

test('runtime transition divergence fails parity instead of accepting either authority', () => {
  assertScenario(String.raw`
    const Module = require('node:module');
    const originalLoad = Module._load;
    Module._load = function faultedLoad(request, parent, isMain) {
      if (request === 'xstate') return {
        createMachine() {
          return { resolveState(value) { return value; } };
        },
        getInitialSnapshot() { return { value: 'CREATED' }; },
        getNextSnapshot() { return { value: 'CREATED' }; }
      };
      return originalLoad.call(this, request, parent, isMain);
    };
    const { createLifecycleAdapter } = require('./backend/services/xstateLifecycleAdapter');
    ${CONFIG_SOURCE}
    const adapter = createLifecycleAdapter(config);
    try {
      adapter.transition('CREATED', 'SCHEDULE');
      process.exit(81);
    } catch (error) {
      if (error.code !== 'WP_B_XSTATE_TRANSITION_PARITY_VIOLATION') process.exit(82);
      if (error.expectedTarget !== 'SCHEDULED') process.exit(83);
      if (error.actualTarget !== 'CREATED') process.exit(84);
    }
  `, 'transition parity divergence');
});

test('configuration faults are rejected before any XState runtime load', () => {
  assertScenario(String.raw`
    const Module = require('node:module');
    const originalLoad = Module._load;
    Module._load = function faultedLoad(request, parent, isMain) {
      if (request === 'xstate') process.exit(91);
      return originalLoad.call(this, request, parent, isMain);
    };
    const { createLifecycleAdapter } = require('./backend/services/xstateLifecycleAdapter');
    try {
      createLifecycleAdapter({
        id: 'invalid',
        initial: 'FINAL',
        states: {
          FINAL: { terminal: true, on: { REOPEN: 'FINAL' } }
        }
      });
      process.exit(92);
    } catch (error) {
      if (error.code !== 'WP_B_XSTATE_TERMINAL_TRANSITION_INVALID') process.exit(93);
    }
  `, 'configuration fault isolation');
});
