'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  EVENTS,
  STATES,
  TERMINAL_STATES,
  TRANSITIONS,
  nextLifecycleState
} = require('../../../services/durableExecutionLifecycle');
const {
  createLifecycleAdapter
} = require('../../../services/xstateLifecycleAdapter');
const {
  findXStateImports
} = require('../../../../tools/architecture-closure-v2/verify-wp-b-open-source-adoption-core');

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const ADAPTER_PATH = 'backend/services/xstateLifecycleAdapter.js';
const LIFECYCLE_PATH = 'backend/services/durableExecutionLifecycle.js';

function lifecycleConfig() {
  const terminal = new Set(TERMINAL_STATES);
  return {
    id: 'yanceDurableExecutionLifecycle',
    initial: STATES.CREATED,
    states: Object.fromEntries(Object.values(STATES).map(state => [
      state,
      {
        terminal: terminal.has(state),
        on: Object.fromEntries(Object.entries(TRANSITIONS[state]))
      }
    ]))
  };
}

test('Adapter is the only production XState import and has no authority capabilities', () => {
  assert.deepEqual(findXStateImports(REPO_ROOT), [ADAPTER_PATH]);

  const adapterSource = fs.readFileSync(path.join(REPO_ROOT, ADAPTER_PATH), 'utf8');
  assert.doesNotMatch(adapterSource, /require\(\s*['"](?:node:)?(?:fs|net|http|https|tls|child_process|sqlite|better-sqlite3)['"]\s*\)/u);
  assert.doesNotMatch(adapterSource, /\b(?:fetch|setTimeout|setInterval|Date\.now|CURRENT_TIMESTAMP)\b/u);

  const lifecycleSource = fs.readFileSync(path.join(REPO_ROOT, LIFECYCLE_PATH), 'utf8');
  assert.match(lifecycleSource, /require\(\s*['"]\.\/xstateLifecycleAdapter['"]\s*\)/u);
  assert.match(lifecycleSource, /lifecycleAdapter\.transition\(/u);
});

test('Schema and store metadata load without eagerly loading the XState runtime', () => {
  const script = String.raw`
    const Module = require('node:module');
    const originalLoad = Module._load;
    Module._load = function guardedLoad(request, parent, isMain) {
      if (request === 'xstate') {
        const error = new Error('XState runtime load blocked by regression contract');
        error.code = 'WP_B_XSTATE_EAGER_LOAD_FORBIDDEN';
        throw error;
      }
      return originalLoad.call(this, request, parent, isMain);
    };

    const migration = require('./backend/migrations/architectureClosureV2WpB');
    const lifecycle = require('./backend/services/durableExecutionLifecycle');
    require('./backend/lib/r32SqliteStore');
    if (migration.TARGET_SCHEMA_VERSION !== 23) process.exit(31);
    if (lifecycle.STATES.CREATED !== 'CREATED') process.exit(32);

    try {
      lifecycle.nextLifecycleState(lifecycle.STATES.CREATED, lifecycle.EVENTS.SCHEDULE);
      process.exit(33);
    } catch (error) {
      if (error.code !== 'WP_B_XSTATE_EAGER_LOAD_FORBIDDEN') throw error;
    }
  `;
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: REPO_ROOT,
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test('Adapter owns no state names and preserves the complete Yance transition graph', () => {
  const config = lifecycleConfig();
  const adapter = createLifecycleAdapter(config);

  assert.equal(Object.isFrozen(adapter), true);
  assert.equal(adapter.initialState(), STATES.CREATED);

  for (const [state, transitions] of Object.entries(TRANSITIONS)) {
    for (const [eventType, targetState] of Object.entries(transitions)) {
      assert.equal(
        adapter.transition(state, eventType),
        targetState,
        `${state} + ${eventType}`
      );
      assert.equal(nextLifecycleState(state, eventType), targetState);
    }
  }
});

test('Adapter fails closed for every illegal state-event pair instead of silently self-transitioning', () => {
  const adapter = createLifecycleAdapter(lifecycleConfig());

  for (const state of Object.values(STATES)) {
    for (const eventType of Object.values(EVENTS)) {
      if (Object.hasOwn(TRANSITIONS[state], eventType)) continue;
      assert.throws(
        () => adapter.transition(state, eventType),
        error => error?.code === 'WP_B_XSTATE_TRANSITION_INVALID'
          && error.state === state
          && error.eventType === eventType,
        `${state} + ${eventType}`
      );
    }
  }

  assert.throws(
    () => adapter.transition('UNKNOWN_STATE', EVENTS.SCHEDULE),
    error => error?.code === 'WP_B_XSTATE_STATE_INVALID'
  );
  assert.throws(
    () => adapter.transition(STATES.CREATED, 'UNKNOWN_EVENT'),
    error => error?.code === 'WP_B_XSTATE_EVENT_INVALID'
  );
});

test('Adapter snapshots its configuration and cannot be changed through caller mutation', () => {
  const config = lifecycleConfig();
  const adapter = createLifecycleAdapter(config);

  config.initial = STATES.FAILED;
  config.states[STATES.CREATED].on[EVENTS.SCHEDULE] = STATES.FAILED;
  config.states[STATES.CREATED].on.NEW_EVENT = STATES.SUCCEEDED;

  assert.equal(adapter.initialState(), STATES.CREATED);
  assert.equal(adapter.transition(STATES.CREATED, EVENTS.SCHEDULE), STATES.SCHEDULED);
  assert.throws(
    () => adapter.transition(STATES.CREATED, 'NEW_EVENT'),
    error => error?.code === 'WP_B_XSTATE_EVENT_INVALID'
  );
});
