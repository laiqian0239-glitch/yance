'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const diagnostics = require('../../frontend/js/r32-layout-diagnostics');
const { runScenarios } = require('./helpers/fix6dComputedStyleProbe');

let cached;
function metrics() {
  if (!cached) {
    cached = runScenarios(['midnight-cyan','graphite-luxe','rose-atelier'].map(theme => ({
      route: 'conversation', width: 1680, height: 900, navMode: 'compact', aiVisible: true, theme
    })));
  }
  return cached;
}

test('FIX6D compact navigation uses one hit-area and radius contract', () => {
  const m = metrics()[0];
  assert.ok(Math.abs(m.nav.brand.height - m.nav.business.height) <= 1, `${m.nav.brand.height}/${m.nav.business.height}`);
  assert.ok(Math.abs(m.nav.business.height - m.nav.bottom.height) <= 1, `${m.nav.business.height}/${m.nav.bottom.height}`);
  assert.equal(m.nav.brand.borderRadius, m.nav.business.borderRadius);
  assert.equal(m.nav.business.borderRadius, m.nav.bottom.borderRadius);
  assert.ok(m.nav.activeBorderWidth <= 1.1);
});

test('FIX6D brand and active navigation colors follow the current theme', () => {
  const themes = metrics();
  assert.equal(new Set(themes.map(m => m.nav.brandColor)).size, 3);
  assert.equal(new Set(themes.map(m => m.nav.activeBorderColor)).size, 3);
  for (const m of themes) assert.equal(m.nav.brandColor, m.nav.activeIndicatorColor);
});

test('FIX6D diagnostics reject zero-height routed workspaces even when width is present', () => {
  const result = diagnostics.evaluateWorkspaceMetrics({ display:'grid', width:1200, clientWidth:1200, scrollWidth:1200, height:0, clientHeight:0, verticalTextSamples:[], clippedTitleSamples:[] }, 1680, 900);
  assert.equal(result.pass, false);
  assert.ok(result.failures.some(item => item.includes('高度')));
});
