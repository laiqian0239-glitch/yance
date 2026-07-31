'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { runScenarios } = require('./helpers/fix6dComputedStyleProbe');

let cached;
function metrics() {
  if (!cached) {
    cached = runScenarios([
      { route: 'system', width: 1680, height: 900, reading: 'standard' },
      { route: 'system', width: 1680, height: 900, reading: 'large' }
    ]);
  }
  return cached;
}

test('FIX6D system cards preserve intrinsic heights instead of row stretching', () => {
  const m = metrics()[0];
  assert.equal(m.systemGrid.alignItems, 'start');
  assert.equal(m.systemGrid.gridAutoRows, 'max-content');
  assert.ok(m.systemSections[0].height > m.systemSections[1].height + 20, `${m.systemSections[0].height}/${m.systemSections[1].height}`);
});

test('FIX6D binary switch geometry is invariant across reading modes', () => {
  const [standard, large] = metrics();
  for (const m of [standard, large]) {
    assert.ok(Math.abs(m.switch.width - 42) <= 0.5, `${m.switch.width}`);
    assert.ok(Math.abs(m.switch.height - 23) <= 0.5, `${m.switch.height}`);
  }
});
