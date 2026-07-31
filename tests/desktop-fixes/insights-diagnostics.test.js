'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const diagnostics = require('../../frontend/js/r32-insights-diagnostics');

function base(overrides = {}) {
  return {
    contactIds: [], identityState: {}, profileState: {}, trajectoryState: {},
    fontSystemReady: true, responsiveReady: true, hasContentComponent: false,
    hasEmptyState: true, failureStatesReady: true, undoSafetyReady: true,
    stateRestoreReady: true, intersectionObserverReady: true,
    contentVisibilityReady: true, feedbackReady: true, ...overrides
  };
}

test('no-account diagnostics produces 8 pass, 0 fail, 1 skipped', () => {
  const rows = diagnostics.evaluate(base());
  assert.deepEqual(diagnostics.summarize(rows), { pass: 8, fail: 0, warning: 0, skipped: 1, total: 9 });
  assert.equal(rows.find(row => row.name === '统一组件体系').reasonCode, 'EMPTY_STATE_COMPONENT_READY');
  assert.equal(rows.find(row => row.name === '完整回归验收').status, 'skipped');
});

test('performance diagnostics do not depend on contact sections', () => {
  const row = diagnostics.evaluate(base({ hasContentComponent: false })).find(item => item.name === '性能优化');
  assert.equal(row.status, 'pass');
});

test('contact regression runs only after contacts exist and fails on an incomplete chain', () => {
  const rows = diagnostics.evaluate(base({ contactIds: ['c1'], hasContentComponent: true }));
  const regression = rows.find(row => row.name === '完整回归验收');
  assert.equal(regression.status, 'fail');
  assert.equal(diagnostics.summarize(rows).fail, 1);
});

test('reruns are stateless and do not accumulate previous counts', () => {
  const first = diagnostics.summarize(diagnostics.evaluate(base()));
  const second = diagnostics.summarize(diagnostics.evaluate(base()));
  assert.deepEqual(first, second);
});
