'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const authority = fs.readFileSync(path.join(ROOT, 'frontend/r32-theme-authority.css'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'frontend/index.html'), 'utf8');

const requiredSelectors = [
  '.system-status',
  '.contact26-stat', '.contact26-directory', '.contact26-detail', '.identity26-card', '.detail26-section',
  '.profile27-syncbar article', '.profile27-stat', '.profile27-directory', '.profile27-detail', '.profile27-card', '.profile27-section',
  '.timeline27-syncbar article', '.timeline27-metric', '.timeline27-directory', '.timeline27-detail', '.timeline27-card', '.timeline27-section',
  '.ac32-directory', '.ac32-workbench', '.ac32-account', '.ac32-diagnostic-row',
  '.sc32-sidebar', '.sc32-content', '.sc32-stat', '.sc32-diagnostic-list',
  '.sr32-side', '.sr32-content', '.ui-empty-state'
];

test('global theme authority covers every visible routed workspace layer', () => {
  for (const selector of requiredSelectors) {
    assert.ok(authority.includes(selector), `missing selected-theme authority for ${selector}`);
  }
  assert.match(authority, /var\(--theme-card-bg\)/);
  assert.match(authority, /var\(--theme-control-bg\)/);
  assert.match(authority, /var\(--theme-active-bg\)/);
});

test('status and routed themes load before feature execution and authority remains last', () => {
  const statusIndex = html.indexOf('/js/r32-system-status-runtime.js');
  const uiIndex = html.indexOf('/js/r32-ui-runtime.js');
  assert.ok(statusIndex >= 0 && statusIndex < uiIndex);
  const links = [...html.matchAll(/<link\s+href="([^"]+\.css)"\s+rel="stylesheet"\/>/g)].map(match => match[1]);
  assert.equal(links.at(-1), '/r32-theme-authority.css');
});
