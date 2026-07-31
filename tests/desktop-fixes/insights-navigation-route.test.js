'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
const insightsSource = fs.readFileSync(path.join(ROOT, 'frontend/js/r32-insights-runtime.js'), 'utf8');
const aiWorkbenchSource = fs.readFileSync(path.join(ROOT, 'frontend/js/r32-ai-workbench-runtime.js'), 'utf8');
const uiRuntimeSource = fs.readFileSync(path.join(ROOT, 'frontend/js/r32-ui-runtime.js'), 'utf8');

class FakeClassList {
  constructor() { this.values = new Set(); }
  add(...values) { values.forEach(value => this.values.add(value)); }
  remove(...values) { values.forEach(value => this.values.delete(value)); }
  contains(value) { return this.values.has(value); }
  toggle(value, force) {
    if (force === true) { this.values.add(value); return true; }
    if (force === false) { this.values.delete(value); return false; }
    if (this.values.has(value)) { this.values.delete(value); return false; }
    this.values.add(value); return true;
  }
}

class FakeElement {
  constructor(id = '') {
    this.id = id;
    this.classList = new FakeClassList();
    this.dataset = {};
    this.style = {};
    this.value = '';
    this.textContent = '';
    this.innerHTML = '';
    this.disabled = false;
    this.hidden = false;
    this.open = false;
    this.scrollTop = 0;
    this.scrollWidth = 1000;
    this.clientWidth = 1000;
  }
  addEventListener() {}
  removeEventListener() {}
  querySelector() { return new FakeElement(); }
  querySelectorAll() { return []; }
  closest() { return new FakeElement(); }
  showModal() { this.open = true; }
  close() { this.open = false; }
  click() { return typeof this.onclick === 'function' ? this.onclick({ currentTarget: this, target: this }) : undefined; }
  dispatchEvent() { return true; }
  setAttribute(name, value) { this[name] = value; }
  getAttribute(name) { return this[name] ?? null; }
}

function createHarness() {
  const elements = new Map();
  const get = id => {
    if (!elements.has(id)) elements.set(id, new FakeElement(id));
    return elements.get(id);
  };
  const storage = new Map([
    ['yance27:r32:relationship-insights', JSON.stringify({ view: false })],
    ['yance27:r32:ai-workbench', JSON.stringify({ view: false })]
  ]);
  let externalView = '';
  const document = {
    documentElement: new FakeElement('html'),
    body: new FakeElement('body'),
    getElementById: get,
    querySelectorAll: () => [],
    querySelector: () => null,
    createElement: id => new FakeElement(id)
  };
  const localStorage = {
    getItem: key => storage.has(key) ? storage.get(key) : null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: key => storage.delete(key)
  };
  const window = {
    document,
    localStorage,
    navigator: { onLine: true },
    YanceSecurity: {
      escapeHtmlText: value => String(value ?? ''),
      escapeHtmlAttribute: value => String(value ?? ''),
      escapeUrlAttribute: value => String(value ?? ''),
      sanitizeCssNumber: value => Number(value) || 0,
      setUrlAttribute() {}
    },
    __Y27: {
      getState: () => null,
      setExternalView: view => { externalView = view; return true; },
      runSelfTest: async () => ({}),
      loadCrossModuleContext: async () => null,
      apiJson: async () => ({})
    },
    addEventListener() {},
    removeEventListener() {},
    CSS: { supports: () => true }
  };
  const context = vm.createContext({
    window,
    document,
    localStorage,
    navigator: window.navigator,
    console,
    setTimeout: () => 1,
    clearTimeout() {},
    requestAnimationFrame() {},
    getComputedStyle: () => ({ getPropertyValue: () => '14px' }),
    innerWidth: 1280,
    innerHeight: 960,
    fetch: async () => ({ ok: true, json: async () => ({}) }),
    Event: class Event {},
    Blob: class Blob {},
    URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
    crypto: { randomUUID: () => 'uuid' }
  });
  context.globalThis = context;
  return { context, get, storage, getExternalView: () => externalView };
}

test('final navigation handler opens the relationship insights workspace even before core data is ready', () => {
  const harness = createHarness();
  vm.runInContext(insightsSource, harness.context, { filename: 'r32-insights-runtime.js' });
  vm.runInContext(aiWorkbenchSource, harness.context, { filename: 'r32-ai-workbench-runtime.js' });

  const app = harness.get('app');
  const staleRoutes = [
    'contact-page-open', 'profile-page-open', 'timeline-page-open', 'aiwork-page-open',
    'account-center-open', 'system-center-open', 'settings-recovery-open', 'theme-workspace-open'
  ];
  app.classList.add(...staleRoutes);
  harness.get('navConversation').classList.add('active');
  harness.get('navAccountsCenter').classList.add('active');

  const result = harness.get('navInsights').click();

  assert.equal(result, true);
  assert.equal(app.classList.contains('insights-page-open'), true);
  for (const route of staleRoutes) assert.equal(app.classList.contains(route), false, `${route} must be cleared`);
  assert.equal(harness.get('navInsights').classList.contains('active'), true);
  assert.equal(harness.get('navConversation').classList.contains('active'), false);
  assert.equal(harness.get('navAccountsCenter').classList.contains('active'), false);
  assert.equal(harness.getExternalView(), 'insights');
  assert.equal(JSON.parse(harness.storage.get('yance27:r32:workspace-state')).currentView, 'insights');
  assert.match(harness.get('insightContent').innerHTML, /关系洞察暂时无法加载/);
  assert.match(harness.get('insightContent').innerHTML, /统一数据源尚未就绪/);
});

test('relationship insights route is persisted as insights and cannot return before route activation', () => {
  assert.match(insightsSource, /function openInsightsPage\([^)]*\)\{if\(!activateInsightsRoute\(\)\)return false;/);
  assert.match(insightsSource, /setCoreView\('insights'\)/);
  assert.doesNotMatch(insightsSource, /setCoreView\('timeline'\)/);
  assert.match(insightsSource, /'account-center-open','system-center-open','settings-recovery-open','theme-workspace-open'/);
  assert.match(uiRuntimeSource, /setExternalView/);
});

test('AI workbench navigation cannot highlight a destination whose route opener failed', () => {
  assert.match(aiWorkbenchSource, /if\(typeof fn!=='function'\)return false/);
  assert.match(aiWorkbenchSource, /if\(opened===false\)return false;setActiveNav/);
});
