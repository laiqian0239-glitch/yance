'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const routeAuthority = require('../../frontend/js/r32-workspace-route-authority');

function createClassList(initial = []) {
  const values = new Set(initial);
  return {
    contains: value => values.has(value),
    add: (...items) => items.forEach(item => values.add(item)),
    remove: (...items) => items.forEach(item => values.delete(item)),
    values: () => [...values].sort()
  };
}

function createApp(initial = []) {
  return {
    classList: createClassList(initial),
    dataset: {},
    ownerDocument: { defaultView: null }
  };
}

test('production workspace transition is atomic and leaves exactly one route', () => {
  const app = createApp([
    'profile-page-open',
    'system-center-open',
    'theme-workspace-open',
    'immersive',
    'contacts-hidden',
    'ai-overlay-mode',
    'ai-overlay-open'
  ]);

  const result = routeAuthority.applyRoute(app, 'settings', {
    source: 'f25-repair-batch12-test'
  });

  assert.equal(result.pass, true);
  assert.deepEqual(result.active, ['settings']);
  assert.equal(app.dataset.activeWorkspaceView, 'settings');
  assert.equal(app.dataset.workspaceRouteIntegrity, 'pass');
  assert.equal(app.dataset.workspaceRouteSource, 'f25-repair-batch12-test');
  assert.deepEqual(
    app.classList.values().filter(value => routeAuthority.ROUTE_CLASSES.includes(value)),
    ['settings-recovery-open']
  );
  for (const transient of routeAuthority.TRANSIENT_LAYOUT_CLASSES) {
    assert.equal(app.classList.contains(transient), false, `stale layout class: ${transient}`);
  }
});

test('route repair honors desired workspace after a legacy module adds a conflicting class', () => {
  const app = createApp(['system-center-open']);
  app.dataset.desiredWorkspaceView = 'system';
  app.classList.add('insights-page-open');

  const before = routeAuthority.routeIntegrity(app, 'system');
  assert.equal(before.pass, false);
  assert.equal(before.duplicateClasses, true);

  const after = routeAuthority.repairRoute(app, '', {
    source: 'f25-repair-batch12-test'
  });
  assert.equal(after.pass, true);
  assert.deepEqual(after.active, ['system']);
  assert.deepEqual(
    app.classList.values().filter(value => routeAuthority.ROUTE_CLASSES.includes(value)),
    ['system-center-open']
  );
});
