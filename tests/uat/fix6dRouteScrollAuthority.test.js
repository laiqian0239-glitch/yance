'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { runScenarios } = require('./helpers/fix6dComputedStyleProbe');

const ROUTES = ['contacts', 'accounts', 'profiles', 'timeline', 'insights', 'ai-workbench', 'system', 'settings', 'theme'];
const baseScenarios = ROUTES.map(route => ({ route, width: 1680, height: 900, navMode: 'compact', aiVisible: false, scrollAudit: true }));
const compactScenarios = [];
for (const [width, height] of [[1496, 800], [1100, 720], [760, 700]]) {
  for (const route of ['accounts', 'system', 'settings', 'theme']) {
    compactScenarios.push({ route, width, height, navMode: 'compact', aiVisible: false, scrollAudit: true });
  }
}
let cached;
function metrics() {
  if (!cached) cached = runScenarios([...baseScenarios, ...compactScenarios], { timeoutMs: 120000 });
  return cached;
}

test('FIX6D routed pages expose exactly one vertical scroll owner at the workspace root', () => {
  const base = metrics().slice(0, ROUTES.length);
  for (const [index, route] of ROUTES.entries()) {
    const m = base[index];
    assert.equal(m.scrollAudit.ownerCount, 1, `${route}: ${JSON.stringify(m.scrollAudit.owners)}`);
    assert.equal(m.scrollAudit.capableCount, 1, `${route}: dormant nested scroll ${JSON.stringify(m.scrollAudit.capable)}`);
    const owner = m.scrollAudit.owners[0];
    assert.equal(owner.id, {
      contacts: 'contactsWorkspace', accounts: 'accountCenterWorkspace', profiles: 'profilesWorkspace', timeline: 'timelineWorkspace',
      insights: 'insightsWorkspace', 'ai-workbench': 'aiworkWorkspace', system: 'systemCenterWorkspace',
      settings: 'settingsRecoveryWorkspace', theme: 'themeWorkspace'
    }[route], `${route}: wrong owner ${JSON.stringify(owner)}`);
    assert.match(m.scrollAudit.workspaceOverflowY, /auto|scroll/u, `${route}: ${m.scrollAudit.workspaceOverflowY}`);
  }
});

test('FIX6D route scroll reaches the last control without sticky or fixed occlusion', () => {
  const base = metrics().slice(0, ROUTES.length);
  for (const [index, route] of ROUTES.entries()) {
    const m = base[index];
    assert.ok(m.scrollAudit.scrollTopMiddle > 0, `${route}: middle=${m.scrollAudit.scrollTopMiddle}`);
    assert.ok(m.scrollAudit.scrollTopEnd >= m.scrollAudit.scrollTopMiddle, `${route}: end=${m.scrollAudit.scrollTopEnd}`);
    assert.ok(m.scrollAudit.lastRect, `${route}: missing last marker`);
    assert.ok(m.scrollAudit.lastRect.bottom <= m.workspace.bottom + 2, `${route}: last bottom=${m.scrollAudit.lastRect.bottom}, workspace=${m.workspace.bottom}`);
    assert.ok(m.scrollAudit.lastRect.y >= m.workspace.y - 2, `${route}: final content is occluded (${m.scrollAudit.lastRect.y} < ${m.workspace.y})`);
    assert.deepEqual(m.scrollAudit.stickyOrFixed, [], `${route}: ${JSON.stringify(m.scrollAudit.stickyOrFixed)}`);
  }
});

test('FIX6D theme and appearance page has a functioning route scrollbar', () => {
  const m = metrics()[ROUTES.indexOf('theme')];
  assert.ok(m.scrollAudit.workspaceScrollHeight > m.scrollAudit.workspaceClientHeight + 100,
    `${m.scrollAudit.workspaceScrollHeight} <= ${m.scrollAudit.workspaceClientHeight}`);
  assert.ok(m.scrollAudit.scrollTopEnd > 0, `theme scrollTopEnd=${m.scrollAudit.scrollTopEnd}`);
});

test('FIX6D route scroll authority survives compact Windows-sized viewports', () => {
  const compact = metrics().slice(ROUTES.length);
  for (const [index, scenario] of compactScenarios.entries()) {
    const { route, width, height } = scenario;
    const m = compact[index];
    assert.equal(m.scrollAudit.ownerCount, 1, `${route}@${width}x${height}: ${JSON.stringify(m.scrollAudit.owners)}`);
    assert.equal(m.scrollAudit.capableCount, 1, `${route}@${width}x${height}: dormant nested scroll ${JSON.stringify(m.scrollAudit.capable)}`);
    assert.ok(m.scrollAudit.scrollTopEnd > 0, `${route}@${width}x${height}: no route scroll`);
    assert.ok(m.scrollAudit.lastRect?.y >= m.workspace.y - 2,
      `${route}@${width}x${height}: final content is occluded`);
  }
});
