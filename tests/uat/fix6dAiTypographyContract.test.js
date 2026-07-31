'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { runScenarios } = require('./helpers/fix6dComputedStyleProbe');

let cached;
function metrics() {
  if (!cached) {
    cached = runScenarios([
      { route: 'conversation', width: 1680, height: 900, reading: 'standard' },
      { route: 'conversation', width: 1680, height: 900, reading: 'large' },
      { route: 'ai-workbench', width: 1496, height: 900, reading: 'standard' }
    ], { productionDom: true });
  }
  return cached;
}

test('FIX6D large-reading mode scales every production AI-panel non-button role', () => {
  const [standard, large] = metrics();
  for (const role of ['ai-title','ai-section','ai-card-title','ai-body','ai-small','ai-label','ai-candidate-label']) {
    assert.ok(standard.typography[role] > 0, `${role} production node missing`);
    assert.ok(large.typography[role] >= standard.typography[role] * 1.18, `${role}: ${standard.typography[role]} -> ${large.typography[role]}`);
  }
});

test('FIX6D AI workbench actions remain one bounded group at 1496px', () => {
  const m = metrics()[2];
  assert.ok(m.actionMetrics, 'AI workbench action metrics missing');
  assert.ok(m.actionMetrics.right <= m.workspace.right - 8, `actions overflow ${m.actionMetrics.right}/${m.workspace.right}`);
  assert.ok(m.actionMetrics.rowCount <= 2, `too many action rows ${m.actionMetrics.rowCount}`);
  assert.notEqual(m.actionMetrics.lastRowCount, 1, 'one isolated action must not drop below the title');
});
