'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { runScenarios } = require('./helpers/fix6dComputedStyleProbe');

const scenarios = [
  { route: 'contacts', width: 1680, height: 900, navMode: 'compact', aiVisible: false },
  { route: 'contacts', width: 760, height: 700, navMode: 'compact', aiVisible: false, reading: 'large' },
  { route: 'accounts', width: 1680, height: 900, navMode: 'compact', aiVisible: false },
  { route: 'conversation', width: 1680, height: 900, navMode: 'expanded', aiVisible: true },
  { route: 'conversation', width: 1680, height: 900, navMode: 'expanded', aiVisible: false },
  { route: 'conversation', width: 1680, height: 900, reading: 'standard' },
  { route: 'conversation', width: 1680, height: 900, reading: 'large' },
  { route: 'profiles', width: 1680, height: 900, navMode: 'compact', aiVisible: false },
  { route: 'timeline', width: 1680, height: 900, navMode: 'compact', aiVisible: false },
  { route: 'insights', width: 1680, height: 900, navMode: 'compact', aiVisible: false }
];
let cached;
function metrics() {
  if (!cached) cached = runScenarios(scenarios);
  return cached;
}

test('FIX6D routed workspace fills the available app height', () => {
  const m = metrics()[2];
  assert.ok(m.workspace.bottom >= m.app.bottom - 10, `workspace bottom=${m.workspace.bottom}, app bottom=${m.app.bottom}`);
  assert.ok(m.master && m.detail, 'master/detail metrics must exist');
  assert.ok(Math.abs(m.master.height - m.detail.height) <= 1, `${m.master.height} vs ${m.detail.height}`);
  assert.ok(m.master.bottom >= m.workspace.bottom - 12, `master bottom=${m.master.bottom}, workspace bottom=${m.workspace.bottom}`);
  const rows = m.workspaceStyle.gridTemplateRows.split(/\s+/).map(value => parseFloat(value));
  assert.equal(rows.length, 4, m.workspaceStyle.gridTemplateRows);
  assert.ok(rows.at(-1) > 500, `body row=${rows.at(-1)}`);
});

test('FIX6D conversation height is invariant when AI panel closes', () => {
  const open = metrics()[3];
  const closed = metrics()[4];
  assert.ok(Math.abs(open.workspace.height - closed.workspace.height) <= 1, `${open.workspace.height} vs ${closed.workspace.height}`);
  assert.ok(open.workspace.bottom >= open.viewport.height - 10);
  assert.ok(closed.workspace.bottom >= closed.viewport.height - 10);
});

test('FIX6D large reading mode scales AI non-button text roles', () => {
  const standard = metrics()[5];
  const large = metrics()[6];
  for (const role of ['ai-title','ai-section','ai-card-title','ai-body','ai-small','ai-label','ai-candidate-label']) {
    assert.ok(large.typography[role] > standard.typography[role] + 1, `${role}: ${standard.typography[role]} -> ${large.typography[role]}`);
  }
});

test('FIX6D account and relationship empty states fill equal-height detail panes', () => {
  const routeMetrics = [metrics()[0], metrics()[2], metrics()[7], metrics()[8], metrics()[9]];
  for (const [index, route] of ['contacts','accounts','profiles','timeline','insights'].entries()) {
    const m = routeMetrics[index];
    assert.ok(m.master && m.detail, `${route}: panes missing`);
    assert.ok(Math.abs(m.master.height - m.detail.height) <= 2, `${route}: ${m.master.height} vs ${m.detail.height}`);
    assert.ok(m.master.bottom >= m.workspace.bottom - 14, `${route}: master bottom ${m.master.bottom}`);
    assert.ok(m.detailEmpty, `${route}: detail empty missing`);
    assert.ok(m.detailEmpty.height >= m.detail.height * 0.70, `${route}: empty ${m.detailEmpty.height}, detail ${m.detail.height}`);
    if (m.decoration) assert.equal(m.decoration.display, 'none', `${route}: empty decoration visible`);
  }
});


test('FIX6D contact empty detail is centered and filter labels stay horizontal at large reading', () => {
  const desktop = metrics()[0];
  const narrow = metrics()[1];
  for (const [label, m] of [['desktop', desktop], ['narrow-large', narrow]]) {
    assert.ok(m.detail && m.detailEmpty && m.detailEmptyInner, `${label}: missing contact empty state`);
    const detailCenterX = m.detail.x + m.detail.width / 2;
    const innerCenterX = m.detailEmptyInner.x + m.detailEmptyInner.width / 2;
    assert.ok(Math.abs(detailCenterX - innerCenterX) <= 3, `${label}: x center ${innerCenterX} vs ${detailCenterX}`);
    assert.ok(m.filterMetrics, `${label}: filter rail missing`);
    for (const button of m.filterMetrics.buttons) {
      assert.equal(button.whiteSpace, 'nowrap', `${label}:${button.text} whiteSpace=${button.whiteSpace}`);
      assert.equal(button.writingMode, 'horizontal-tb', `${label}:${button.text} writingMode=${button.writingMode}`);
      assert.ok(button.clientWidth + 1 >= button.scrollWidth, `${label}:${button.text} clips horizontally`);
      assert.ok(button.clientHeight + 1 >= button.scrollHeight, `${label}:${button.text} wraps vertically`);
    }
  }
});
