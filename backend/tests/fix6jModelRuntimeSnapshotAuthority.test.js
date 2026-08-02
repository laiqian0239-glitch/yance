'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const authorityPath = '../../frontend/js/r32-model-runtime-snapshot-authority';

function adapters() {
  return {
    projectServices(models) {
      return (Array.isArray(models) ? models : []).map(model => ({ id: model.id, projected: true }));
    },
    projectRoutes(routes, taskReadiness) {
      return Object.entries(routes || {}).map(([id, route]) => ({ id, primary: route.primary || '', taskReadiness }));
    },
    summarizeServices(services) {
      return { count: services.length };
    },
    mergeAuthoritativeSummary(derived, authoritative) {
      return { ...derived, ...(authoritative || {}) };
    }
  };
}

function defaults() {
  return {
    taskReadiness: { pass: false, tasks: [], missing: [] },
    replyBrain: { pass: false },
    modelPools: { inventory: [] },
    openRouter: {},
    aiAutomation: { enabled: false }
  };
}

test('routing drafts remain authoritative while fresh readiness and model state are projected', () => {
  const authority = require(authorityPath);
  const draftRoutes = [{ id: 'quick_reply', main: 'manual-draft' }];
  const incomingReadiness = { pass: false, tasks: [{ task: 'quick_reply', operational: true }], missing: [] };
  const previousState = {
    tab: 'routing',
    routeDraftDirty: true,
    routes: draftRoutes,
    taskReadiness: { pass: false, tasks: [], missing: ['old'] },
    replyBrain: { pass: false },
    modelPools: {},
    openRouter: {},
    aiAutomation: { enabled: false }
  };

  const preserveRoutes = authority.shouldPreserveRoutes(previousState);
  const snapshot = authority.projectModelRuntimeSnapshot({
    modelState: {
      models: [{ id: 'cloud-1' }],
      routes: { quick_reply: { primary: 'server-route' } },
      taskReadiness: incomingReadiness,
      summary: { routingEligible: 1 }
    },
    previousState,
    defaults: defaults(),
    adapters: adapters(),
    preserveRoutes
  });

  assert.equal(preserveRoutes, true);
  assert.strictEqual(snapshot.routes, draftRoutes);
  assert.strictEqual(snapshot.taskReadiness, incomingReadiness);
  assert.deepEqual(snapshot.services, [{ id: 'cloud-1', projected: true }]);
  assert.deepEqual(snapshot.modelSummary, { count: 1, routingEligible: 1 });
  assert.equal(Object.isFrozen(snapshot), true);
});

test('committing a preserved draft updates readiness without replacing unsaved routes', () => {
  const authority = require(authorityPath);
  const draftRoutes = [{ id: 'deep_reply', main: 'draft-model' }];
  const targetState = {
    routes: draftRoutes,
    taskReadiness: { pass: false, tasks: [], missing: ['old'] },
    services: [],
    modelSummary: {},
    replyBrain: {},
    modelPools: {},
    openRouter: {},
    aiAutomation: {}
  };
  const nextReadiness = { pass: true, tasks: [{ task: 'deep_reply', operational: true }], missing: [] };
  const snapshot = Object.freeze({
    services: [{ id: 'cloud-2' }],
    modelSummary: { count: 1 },
    replyBrain: { pass: true },
    modelPools: { champions: ['cloud-2'] },
    taskReadiness: nextReadiness,
    routes: [{ id: 'deep_reply', main: 'server-model' }],
    openRouter: { connected: true },
    aiAutomation: { enabled: true }
  });

  authority.commitModelRuntimeSnapshot(targetState, snapshot, { preserveRoutes: true });

  assert.strictEqual(targetState.routes, draftRoutes);
  assert.strictEqual(targetState.taskReadiness, nextReadiness);
  assert.deepEqual(targetState.services, [{ id: 'cloud-2' }]);
  assert.deepEqual(targetState.modelSummary, { count: 1 });
});

test('normal refresh projects and commits assigned registry routes with current readiness', () => {
  const authority = require(authorityPath);
  const targetState = {
    tab: 'models',
    routeDraftDirty: false,
    routes: [{ id: 'quick_reply', main: 'old' }],
    taskReadiness: { pass: false, tasks: [], missing: [] },
    services: [],
    modelSummary: {},
    replyBrain: {},
    modelPools: {},
    openRouter: {},
    aiAutomation: {}
  };
  const incomingReadiness = { pass: true, tasks: [{ task: 'quick_reply', operational: true }], missing: [] };
  const snapshot = authority.projectModelRuntimeSnapshot({
    modelState: {
      models: [],
      routes: { quick_reply: { primary: 'resolved-model' } },
      taskReadiness: incomingReadiness
    },
    previousState: targetState,
    defaults: defaults(),
    adapters: adapters(),
    preserveRoutes: authority.shouldPreserveRoutes(targetState)
  });

  authority.commitModelRuntimeSnapshot(targetState, snapshot);

  assert.deepEqual(targetState.routes, [{ id: 'quick_reply', primary: 'resolved-model', taskReadiness: incomingReadiness }]);
  assert.strictEqual(targetState.taskReadiness, incomingReadiness);
});
