'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const authority = require('../../frontend/js/r32-workspace-route-authority');

function fakeClassList() {
  const values = new Set();
  return {
    add: (...items) => items.forEach(item => values.add(item)),
    remove: (...items) => items.forEach(item => values.delete(item)),
    contains: item => values.has(item)
  };
}

function fixture() {
  const roots = new Map();
  for (const [view, route] of Object.entries(authority.ROUTES)) {
    if (!route.workspaceId) continue;
    roots.set(route.workspaceId, {
      id: route.workspaceId,
      scrollTop: 0,
      scrollHeight: 1200,
      clientHeight: 400
    });
  }
  const window = {
    requestAnimationFrame(callback) { callback(); }
  };
  const document = {
    defaultView: window,
    getElementById(id) { return roots.get(id) || null; }
  };
  const app = {
    classList: fakeClassList(),
    dataset: { activeWorkspaceView: 'accounts', desiredWorkspaceView: 'accounts' },
    ownerDocument: document
  };
  return { app, roots };
}

test('every non-conversation route declares one authoritative workspace scroll root', () => {
  const expected = {
    contacts: 'contactsWorkspace',
    profiles: 'profilesWorkspace',
    timeline: 'timelineWorkspace',
    insights: 'insightsWorkspace',
    'ai-workbench': 'aiworkWorkspace',
    accounts: 'accountCenterWorkspace',
    system: 'systemCenterWorkspace',
    settings: 'settingsRecoveryWorkspace',
    theme: 'themeWorkspace'
  };
  assert.deepEqual(
    Object.fromEntries(Object.entries(authority.ROUTES).filter(([view]) => view !== 'conversation').map(([view, route]) => [view, route.workspaceId])),
    expected
  );
});

test('captureScroll reads only the route workspace root and clamps invalid positions', () => {
  const { app, roots } = fixture();
  roots.get('accountCenterWorkspace').scrollTop = 275;
  assert.equal(authority.captureScroll(app, 'accounts'), 275);

  roots.get('accountCenterWorkspace').scrollTop = Number.NaN;
  assert.equal(authority.captureScroll(app, 'accounts'), 0);
  assert.equal(authority.captureScroll(app, 'conversation'), 0);
});

test('restoreScroll applies a clamped position to the authoritative workspace root', () => {
  const { app, roots } = fixture();
  const accountRoot = roots.get('accountCenterWorkspace');
  assert.equal(authority.restoreScroll(app, 'accounts', 9999, { defer: false }), true);
  assert.equal(accountRoot.scrollTop, 800);

  assert.equal(authority.restoreScroll(app, 'accounts', -25, { defer: false }), true);
  assert.equal(accountRoot.scrollTop, 0);
  assert.equal(authority.restoreScroll(app, 'conversation', 10, { defer: false }), false);
});

const fs = require('node:fs');
const path = require('node:path');

function source(relative) {
  return fs.readFileSync(path.join(__dirname, '..', '..', relative), 'utf8');
}

test('route runtimes persist scroll state through the route workspace authority, never inner panes', () => {
  const account = source('frontend/r32-account-center.js');
  const system = source('frontend/r32-system-center.js');
  const ai = source('frontend/js/r32-ai-workbench-runtime.js');
  const insights = source('frontend/js/r32-insights-runtime.js');

  assert.match(account, /captureScroll\?\.\(app,\s*'accounts'\)/);
  assert.match(account, /restoreScroll\?\.\(app,\s*'accounts'/);
  assert.doesNotMatch(account, /getElementById\('ac32Scroll'\)[\s\S]{0,200}scrollTop/);

  assert.match(system, /captureScroll\?\.\(app,\s*'system'\)/);
  assert.match(system, /restoreScroll\?\.\(app,\s*'system'/);
  assert.doesNotMatch(system, /getElementById\('sc32Content'\)[\s\S]{0,200}scrollTop/);

  assert.match(ai, /captureScroll\?\.\(app,\s*'ai-workbench'\)/);
  assert.match(ai, /restoreScroll\?\.\(app,\s*'ai-workbench'/);
  assert.doesNotMatch(ai, /q\('aiwScroll'\)[\s\S]{0,80}scrollTop/);

  assert.match(insights, /captureScroll\?\.\(app,\s*'insights'\)/);
  assert.match(insights, /restoreScroll\?\.\(app,\s*'insights'/);
  assert.doesNotMatch(insights, /q\('insightDetailScroll'\)[\s\S]{0,80}scrollTop/);
});
