'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const authorityPath = '../../frontend/js/r32-model-runtime-snapshot-authority';

// The legacy physical route editor (routeDraftDirty / shouldPreserveRoutes / routes projection)
// has been permanently retired: physical routing is owned by LiteLLM and the Product surface no
// longer edits routes. The snapshot authority now projects only model services, Model Brain and
// task readiness, and its commit must write exactly those projected fields without touching
// unrelated state.

test('commit projects current model runtime fields and leaves unrelated state untouched', () => {
  const authority = require(authorityPath);
  const untouchedRoutes = [{ id: 'deep_reply', main: 'draft-model' }];
  const targetState = {
    routes: untouchedRoutes,
    taskReadiness: { pass: false, tasks: [], missing: ['old'] },
    services: [],
    modelSummary: {},
    replyBrain: {},
    openRouter: {},
    aiAutomation: {}
  };
  const nextReadiness = { pass: true, tasks: [{ task: 'deep_reply', operational: true }], missing: [] };
  const snapshot = Object.freeze({
    services: [{ id: 'cloud-2' }],
    modelSummary: { count: 1 },
    modelBrain: { name: 'Model Brain', runtimeAvailable: true },
    replyBrain: { pass: true },
    taskReadiness: nextReadiness,
    openRouter: { connected: true },
    aiAutomation: { enabled: true }
  });

  authority.commitModelRuntimeSnapshot(targetState, snapshot);

  // Routes are no longer managed by the runtime snapshot and must not be replaced.
  assert.strictEqual(targetState.routes, untouchedRoutes);
  assert.strictEqual(targetState.taskReadiness, nextReadiness);
  assert.deepEqual(targetState.services, [{ id: 'cloud-2' }]);
  assert.deepEqual(targetState.modelSummary, { count: 1 });
  assert.equal(targetState.modelBrain.runtimeAvailable, true);
});

test('project derives services, merged summary, model brain and readiness through adapters', () => {
  const authority = require(authorityPath);
  const adapters = {
    projectServices(models) {
      return (Array.isArray(models) ? models : []).map(model => ({ id: model.id, projected: true }));
    },
    summarizeServices(services) {
      return { count: services.length };
    },
    mergeAuthoritativeSummary(derived, authoritative) {
      return { ...derived, ...(authoritative || {}) };
    }
  };
  const incomingReadiness = { pass: false, tasks: [{ task: 'quick_reply', operational: true }], missing: [] };
  const snapshot = authority.projectModelRuntimeSnapshot({
    modelState: {
      models: [{ id: 'cloud-1' }],
      taskReadiness: incomingReadiness,
      summary: { routingEligible: 1 },
      modelBrain: { runtimeAvailable: true, health: 'available' }
    },
    previousState: {},
    defaults: {
      taskReadiness: { pass: false, tasks: [], missing: [] },
      replyBrain: { pass: false },
      openRouter: {},
      aiAutomation: { enabled: false }
    },
    adapters
  });

  assert.deepEqual(snapshot.services, [{ id: 'cloud-1', projected: true }]);
  assert.deepEqual(snapshot.modelSummary, { count: 1, routingEligible: 1 });
  assert.strictEqual(snapshot.taskReadiness, incomingReadiness);
  assert.equal(snapshot.modelBrain.runtimeAvailable, true);
  assert.equal(Object.isFrozen(snapshot), true);
});
