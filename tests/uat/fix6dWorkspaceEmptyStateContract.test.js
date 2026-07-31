'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..', '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

test('FIX6D routes use one semantic master/detail shell', () => {
  const html = read('frontend/index.html');
  const account = read('frontend/r32-account-center.js');
  for (const cls of ['contact26-lower','profile27-main','timeline27-main','insight29-main']) {
    assert.match(html, new RegExp(`class="${cls} ui-master-detail-shell"`));
  }
  for (const cls of ['contact26-directory','profile27-directory','timeline27-directory','insight29-directory']) {
    assert.match(html, new RegExp(`class="${cls} ui-master-pane"`));
  }
  for (const cls of ['contact26-detail','profile27-detail','timeline27-detail','insight29-detail']) {
    assert.match(html, new RegExp(`class="${cls} ui-detail-pane"`));
  }
  assert.match(account, /class="ac32-main ui-master-detail-shell"/);
  assert.match(account, /class="ac32-directory ui-master-pane"/);
  assert.match(account, /class="ac32-workbench ui-detail-pane(?: [^"]*)?"/);
});

test('FIX6D dynamic empty states use the shared fill role', () => {
  const account = read('frontend/r32-account-center.js');
  const runtime = read('frontend/js/r32-ui-runtime.js');
  const insights = read('frontend/js/r32-insights-runtime.js');
  assert.ok((account.match(/ac32-empty ui-empty-state-fill/g) || []).length >= 2);
  assert.doesNotMatch(account, /class="ac32-empty"(?:\s|>)/);
  for (const copy of ['请选择一个联系人','当前没有活跃客户档案','没有可显示的活跃客户','当前没有活跃关系对象','暂无可显示的关系轨迹']) {
    const escaped = copy.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(runtime, new RegExp(`ui-empty-state ui-empty-state-fill[^'\"]*?[\\s\\S]{0,160}${escaped}`), copy);
  }
  assert.match(insights, /ui-empty-state ui-empty-state-fill/);
});

test('FIX6D empty detail decoration tracks collapse when they have no semantic content', () => {
  const html = read('frontend/index.html');
  const css = read('frontend/r32-workspace-empty-state.css');
  assert.equal((html.match(/ui-empty-decoration-track/g) || []).length, 4);
  assert.match(css, /\.ui-detail-pane>\.ui-empty-decoration-track:empty\{display:none!important\}/);
  assert.match(css, /\.ui-empty-state-fill\{[\s\S]*grid-column:1\/-1/);
  assert.match(css, /:has\(> \.ui-empty-state-fill\)\{[\s\S]*grid-template-columns:minmax\(0,1fr\)!important/);
});


test('FIX6D contact/profile/timeline/insight filters keep each label on one horizontal line', () => {
  const html = read('frontend/index.html');
  const css = read('frontend/r32-workspace-empty-state.css');
  for (const id of ['identityFilters','profileFilters','timelineQuickFilters','insightFilters']) {
    assert.match(html, new RegExp(`class="[^"]*ui-filter-rail[^"]*" id="${id}"`));
  }
  assert.match(css, /\.ui-filter-rail button\{[\s\S]*white-space:nowrap!important/);
  assert.match(css, /\.ui-filter-rail\{[\s\S]*overflow-x:auto/);
});
