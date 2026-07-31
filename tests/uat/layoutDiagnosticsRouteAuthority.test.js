'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const diagnostics = require('../../frontend/js/r32-layout-diagnostics');

function fakeClassList() {
  const values = new Set();
  return {
    add: (...items) => items.forEach(item => values.add(item)),
    remove: (...items) => items.forEach(item => values.delete(item)),
    contains: item => values.has(item),
    values: () => [...values]
  };
}

function fixture() {
  const workspaces = new Map();
  for (const route of diagnostics.ROUTE_LAYOUTS) {
    workspaces.set(route.workspaceId, {
      id: route.workspaceId,
      clientWidth: 1000,
      scrollWidth: 1000,
      style: { display: 'none' },
      getBoundingClientRect: () => ({ left: 0, top: 0, right: 1000, bottom: 700, width: 1000, height: 700 }),
      querySelector: () => null,
      querySelectorAll: () => []
    });
  }
  const app = {
    classList: fakeClassList(),
    dataset: { activeWorkspaceView: 'conversation', desiredWorkspaceView: 'conversation' },
    style: { setProperty() {} },
    ownerDocument: null
  };
  const document = {
    activeElement: { focusCalls: 0, focus() { this.focusCalls += 1; } },
    getElementById(id) { return id === 'app' ? app : workspaces.get(id) || null; }
  };
  const window = {
    innerWidth: 1680,
    scrollX: 13,
    scrollY: 29,
    requestAnimationFrame(callback) { setImmediate(callback); },
    getComputedStyle(node) { return node.style; },
    scrollToCalls: [],
    scrollTo(x, y) { this.scrollToCalls.push([x, y]); }
  };
  app.ownerDocument = { defaultView: window };
  return { app, document, window, workspaces };
}

test('runRouteMatrix activates every workspace through route authority and restores route/layout/focus/scroll', async () => {
  const { app, document, window, workspaces } = fixture();
  const appliedRoutes = [];
  let restoredLayout = null;
  const routeAuthority = {
    activeView: () => app.dataset.activeWorkspaceView,
    routeIntegrity: (_app, view) => ({ pass: app.dataset.activeWorkspaceView === view, actual: app.dataset.activeWorkspaceView, expected: view }),
    applyRoute(_app, view) {
      appliedRoutes.push(view);
      app.dataset.activeWorkspaceView = view;
      app.dataset.desiredWorkspaceView = view;
      for (const route of diagnostics.ROUTE_LAYOUTS) workspaces.get(route.workspaceId).style.display = route.view === view ? 'grid' : 'none';
      return { pass: true, actual: view, expected: view };
    }
  };
  const layoutAuthority = {
    capture: () => ({ navMode: 'expanded', contactMode: 'normal', aiVisible: true, route: 'conversation', density: 'comfortable' }),
    restore: (_app, snapshot) => { restoredLayout = snapshot; }
  };

  const results = await diagnostics.runRouteMatrix({ app, document, window, routeAuthority, layoutAuthority });

  assert.equal(results.length, 9);
  assert.ok(results.every(result => result.pass && result.status === 'pass'));
  assert.deepEqual(appliedRoutes.slice(0, 9), diagnostics.ROUTE_LAYOUTS.map(route => route.view));
  assert.equal(appliedRoutes.at(-1), 'conversation');
  assert.equal(restoredLayout.route, 'conversation');
  assert.equal(document.activeElement.focusCalls, 1);
  assert.deepEqual(window.scrollToCalls.at(-1), [13, 29]);
});

test('runRouteMatrix distinguishes activation failure and ready timeout without mutating className directly', async () => {
  const first = fixture();
  const activation = await diagnostics.runRouteMatrix({
    ...first,
    routes: [diagnostics.ROUTE_LAYOUTS[0]],
    routeAuthority: {
      activeView: () => 'conversation',
      applyRoute: () => ({ pass: false, actual: 'conversation', expected: 'contacts' }),
      routeIntegrity: () => ({ pass: false, actual: 'conversation', expected: 'contacts' })
    },
    layoutAuthority: { capture: () => ({}), restore() {} }
  });
  assert.equal(activation[0].status, 'route_activation_failed');
  assert.equal(activation[0].pass, false);

  const second = fixture();
  const timeout = await diagnostics.runRouteMatrix({
    ...second,
    routes: [diagnostics.ROUTE_LAYOUTS[0]],
    routeAuthority: {
      activeView: () => 'conversation',
      applyRoute(_app, view) { second.app.dataset.activeWorkspaceView = view; return { pass: true, actual: view, expected: view }; },
      routeIntegrity: () => ({ pass: true, actual: 'contacts', expected: 'contacts' })
    },
    layoutAuthority: { capture: () => ({}), restore() {} },
    waitForReady: async () => false
  });
  assert.equal(timeout[0].status, 'route_ready_timeout');
  assert.equal(timeout[0].pass, false);
});
