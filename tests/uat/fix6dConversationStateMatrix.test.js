'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const layout = require('../../frontend/js/r32-workspace-layout-authority');
const floating = require('../../frontend/js/r32-floating-menu-position');

function probeMany(scenarios) {
  const run = spawnSync('python', [path.join(ROOT, 'tools/uat/fix6d_computed_style_probe.py'), JSON.stringify(scenarios)], {
    cwd: ROOT, encoding: 'utf8', timeout: 90000
  });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  return JSON.parse(run.stdout.trim());
}

test('FIX6D preserves an explicitly expanded navigation on desktop-width Windows layouts', () => {
  const state = layout.compute({ navMode: 'expanded', contactMode: 'normal', aiVisible: true, route: 'conversation' }, 1496);
  assert.equal(state.viewportBand, 'desktop');
  assert.equal(state.navMode, 'expanded');
  assert.equal(state.columns, 'var(--ui-nav-expanded-w) var(--ui-contact-normal-w) minmax(0,1fr) var(--ui-ai-panel-w)');
});

test('FIX6D conversation state matrix never leaves empty tracks or changes workspace height', () => {
  const scenarios = [];
  for (const width of [1920, 1496, 1100]) {
    for (const navMode of ['expanded', 'compact', 'hidden']) {
      for (const aiVisible of [true, false]) scenarios.push({ route: 'conversation', width, height: 900, navMode, aiVisible });
    }
  }
  const metrics = probeMany(scenarios);
  let index = 0;
  for (const width of [1920, 1496, 1100]) {
    for (const navMode of ['expanded', 'compact', 'hidden']) {
      const states = [metrics[index++], metrics[index++]];
      for (const m of states) {
        assert.ok(m.workspace.bottom >= m.app.bottom - 10, `${width}/${navMode}: workspace bottom ${m.workspace.bottom} app ${m.app.bottom}`);
        assert.ok(m.workspace.width >= 360, `${width}/${navMode}: chat too narrow ${m.workspace.width}`);
        assert.equal(m.appStyle.gridTemplateColumns.includes(' 0px'), false, `${width}/${navMode}: zero track ${m.appStyle.gridTemplateColumns}`);
        assert.equal(m.headerOverlap, false, `${width}/${navMode}: conversation header overlaps`);
      }
      assert.ok(Math.abs(states[0].workspace.height - states[1].workspace.height) <= 1, `${width}/${navMode}: AI toggle changed height`);
      if (width === 1100) assert.equal(states[0].aiInGrid, false, 'narrow AI must be an overlay, not a squeezed grid track');
    }
  }
});

test('FIX6D floating menus clamp to the visual viewport on every edge', () => {
  const lowerRight = floating.calculate({ anchorX: 1490, anchorY: 890, menuWidth: 320, menuHeight: 420, viewportWidth: 1496, viewportHeight: 900, margin: 8 });
  assert.ok(lowerRight.left >= 8 && lowerRight.left + 320 <= 1488);
  assert.ok(lowerRight.top >= 8 && lowerRight.top + 420 <= 892);
  assert.equal(lowerRight.placement, 'above');
  const upperLeft = floating.calculate({ anchorX: -20, anchorY: -5, menuWidth: 320, menuHeight: 420, viewportWidth: 1496, viewportHeight: 900, margin: 8 });
  assert.equal(upperLeft.left, 8);
  assert.equal(upperLeft.top, 8);
});
