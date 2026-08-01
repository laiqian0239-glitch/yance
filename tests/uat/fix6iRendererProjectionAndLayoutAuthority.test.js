'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const source = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

function fakeWorkspace(nodes = []) {
  return {
    querySelector() { return null; },
    querySelectorAll() { return nodes; }
  };
}

function fakeNode(text, metrics = {}, style = {}) {
  return {
    textContent: text,
    scrollWidth: metrics.scrollWidth ?? 100,
    clientWidth: metrics.clientWidth ?? 100,
    scrollHeight: metrics.scrollHeight ?? 24,
    clientHeight: metrics.clientHeight ?? 24,
    getBoundingClientRect() {
      return {
        left: 0,
        top: 0,
        right: metrics.width ?? metrics.clientWidth ?? 100,
        bottom: metrics.height ?? metrics.clientHeight ?? 24,
        width: metrics.width ?? metrics.clientWidth ?? 100,
        height: metrics.height ?? metrics.clientHeight ?? 24
      };
    },
    getAttribute(name) { return name === 'aria-hidden' ? (style.ariaHidden || '') : ''; },
    style
  };
}

const fakeWindow = {
  devicePixelRatio: 1,
  getComputedStyle(node) {
    return {
      display: 'block',
      visibility: 'visible',
      opacity: '1',
      overflow: 'visible',
      overflowX: 'visible',
      overflowY: 'visible',
      textOverflow: 'clip',
      whiteSpace: 'normal',
      fontSize: '16px',
      webkitLineClamp: 'none',
      ...node.style
    };
  }
};

test('model registry projection authority summarizes projected services without relying on an undeclared global', () => {
  const projection = require('../../frontend/js/r32-model-registry-projection');
  const summary = projection.summarizeServices([
    { status: 'online', verified: true, routingEligible: true, qualification: 'verified', raw: { callCount: 2 } },
    { status: 'offline', verified: false, routingEligible: false, qualification: 'experimental', raw: { callCount: 0 } },
    { status: 'offline', verified: false, routingEligible: false, qualification: 'blocked', raw: { callCount: 1 } }
  ]);

  assert.deepEqual(summary, {
    count: 3,
    online: 1,
    verified: 1,
    routingEligible: 1,
    experimental: 1,
    failed: 1,
    testing: 0,
    untested: 0,
    used: 2,
    totalCalls: 3
  });

  assert.deepEqual(
    projection.mergeAuthoritativeSummary(summary, { invalidPersistedRoutes: 2, count: 99 }),
    { ...summary, invalidPersistedRoutes: 2, count: 99 }
  );
});

test('AI workbench loads model projection authority before boot and commits model snapshots atomically', () => {
  const html = source('frontend/index.html');
  const workbench = source('frontend/js/r32-ai-workbench-runtime.js');
  const projectionIndex = html.indexOf('/js/r32-model-registry-projection.js');
  const snapshotIndex = html.indexOf('/js/r32-model-runtime-snapshot-authority.js');
  const workbenchIndex = html.indexOf('/js/r32-ai-workbench-runtime.js');

  assert.ok(projectionIndex >= 0, 'projection authority script must be loaded');
  assert.ok(snapshotIndex > projectionIndex, 'snapshot authority must load after registry projection');
  assert.ok(workbenchIndex > snapshotIndex, 'snapshot authority must load before AI workbench');
  assert.match(workbench, /YanceModelRegistryProjection/u);
  assert.match(workbench, /YanceModelRuntimeSnapshotAuthority/u);
  assert.match(workbench, /function projectModelRuntimeSnapshot/u);
  assert.match(workbench, /function commitModelRuntimeSnapshot/u);

  const hydrateStart = workbench.indexOf('function hydrateFromBootstrap');
  const hydrateEnd = workbench.indexOf('\nlet state', hydrateStart);
  const hydrateBody = workbench.slice(hydrateStart, hydrateEnd);
  assert.match(hydrateBody, /projectModelRuntimeSnapshot/u);
  assert.match(hydrateBody, /commitModelRuntimeSnapshot/u);
  assert.doesNotMatch(hydrateBody, /state\.services=registryServices/u);
});

test('header clipping diagnostics only report actual clipping contracts, not harmless metric rounding or visible wrapping', () => {
  const diagnostics = require('../../frontend/js/r32-layout-diagnostics');
  const harmless = fakeNode('AI回复大脑', {
    scrollWidth: 202,
    clientWidth: 200,
    scrollHeight: 41,
    clientHeight: 38,
    width: 200,
    height: 38
  }, {
    overflow: 'visible',
    overflowX: 'visible',
    overflowY: 'visible',
    whiteSpace: 'normal'
  });
  const harmlessMetrics = diagnostics.collectHeaderFlowMetrics(fakeWorkspace([harmless]), fakeWindow);
  assert.deepEqual(harmlessMetrics.clippedTitleSamples, []);

  const clipped = fakeNode('统一账号中心', {
    scrollWidth: 260,
    clientWidth: 180,
    scrollHeight: 24,
    clientHeight: 24,
    width: 180,
    height: 24
  }, {
    overflow: 'hidden',
    overflowX: 'hidden',
    whiteSpace: 'nowrap',
    textOverflow: 'ellipsis'
  });
  const clippedMetrics = diagnostics.collectHeaderFlowMetrics(fakeWorkspace([clipped]), fakeWindow);
  assert.deepEqual(clippedMetrics.clippedTitleSamples, ['统一账号中心']);
});

test('vertical text diagnostics ignore punctuation-only separators but retain real text failures', () => {
  const diagnostics = require('../../frontend/js/r32-layout-diagnostics');
  const punctuation = fakeNode('--', { width: 10, height: 34 }, { fontSize: '14px' });
  const realText = fakeNode('系统中心', { width: 12, height: 60 }, { fontSize: '14px' });

  assert.deepEqual(diagnostics.collectVerticalTextSamples(fakeWorkspace([punctuation]), fakeWindow), []);
  assert.deepEqual(diagnostics.collectVerticalTextSamples(fakeWorkspace([realText]), fakeWindow), ['系统中心']);
});
