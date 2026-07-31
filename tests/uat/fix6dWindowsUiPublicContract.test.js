'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const source = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

const REQUIRED_THEME_TOKENS = [
  '--ui-brand-accent',
  '--ui-brand-accent-soft',
  '--ui-nav-active-surface',
  '--ui-nav-active-border',
  '--ui-nav-icon-color',
  '--ui-control-border',
  '--ui-focus-ring',
  '--ui-panel-surface-1',
  '--ui-panel-surface-2',
  '--ui-panel-surface-3',
  '--ui-text-primary',
  '--ui-text-secondary',
  '--ui-text-muted'
];

test('FIX6D exposes one semantic theme contract for brand, navigation and controls', () => {
  const semantic = source('frontend/r32-theme-semantic-contract.css');
  const authority = source('frontend/r32-theme-authority.css');
  for (const token of REQUIRED_THEME_TOKENS) {
    assert.match(`${semantic}\n${authority}`, new RegExp(`${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:`));
  }
  assert.match(authority, /\.nav \.brand-mark\{[^}]*color:var\(--ui-brand-accent\)/s);
  assert.match(authority, /\.nav-menu \.icon\.active[^}]*var\(--ui-nav-active-border\)/s);
  assert.match(authority, /\.nav-menu \.icon\.active[^}]*var\(--ui-nav-active-surface\)/s);
  assert.doesNotMatch(authority.match(/\/\* Navigation\. \*\/[\s\S]*?\/\* Contact list/)?.[0] || '', /var\(--cyan\)/);
});

test('FIX6D brand mark is theme-aware and no longer renders a fixed-color SVG image', () => {
  const html = source('frontend/index.html');
  assert.match(html, /<span class="brand-mark"[^>]*aria-hidden="true"/);
  assert.doesNotMatch(html, /<div class="brand"[^>]*>[\s\S]*?<img[^>]+yance-mark-flat\.svg/);
});

test('FIX6D workspace layout authority computes hidden columns without empty tracks', () => {
  const layout = require('../../frontend/js/r32-workspace-layout-authority');
  const hidden = layout.compute({ navMode: 'hidden', contactMode: 'hidden', aiVisible: false, route: 'conversation', density: 'comfortable' }, 1920);
  assert.equal(hidden.columns, 'minmax(0,1fr)');
  assert.equal(hidden.navWidth, '0px');
  assert.equal(hidden.contactWidth, '0px');
  assert.equal(hidden.aiWidth, '0px');
  assert.equal(hidden.mainColumn, '1');

  const routed = layout.compute({ navMode: 'compact', contactMode: 'normal', aiVisible: true, route: 'system', density: 'compact' }, 1920);
  assert.equal(routed.columns, 'var(--ui-nav-compact-w) minmax(0,1fr)');
  assert.equal(routed.contactWidth, '0px');
  assert.equal(routed.aiWidth, '0px');
  assert.equal(routed.mainColumn, '2');
});

test('FIX6D production shell consumes one computed grid contract', () => {
  const html = source('frontend/index.html');
  const css = source('frontend/r32-conversation-center-v2.css');
  assert.ok(html.indexOf('/js/r32-workspace-layout-authority.js') < html.indexOf('/js/r32-ui-runtime.js'));
  assert.match(css, /\.app\{[^}]*grid-template-columns:var\(--ui-shell-columns\)/s);
  assert.doesNotMatch(css, /\.app\.nav-hidden\{[^}]*grid-template-columns:/s);
  assert.doesNotMatch(css, /\.app\.nav-expanded\.contacts-hidden\.ai-hidden\{[^}]*grid-template-columns:/s);
  assert.match(css, /grid-column:var\(--ui-route-main-column\)/);
});

test('FIX6D shared density keeps navigation and AI content readable without heavy active chrome', () => {
  const css = source('frontend/r32-conversation-center-v2.css');
  const semantic = source('frontend/r32-theme-semantic-contract.css');
  for (const token of ['--ui-nav-hit-size', '--ui-control-height', '--ui-panel-gap', '--ui-body-font-size', '--ui-meta-font-size']) {
    assert.match(semantic, new RegExp(`${token}\\s*:`));
  }
  assert.match(css, /\.nav-menu \.icon[^}]*min-height:var\(--ui-nav-hit-size\)/s);
  assert.match(css, /\.ai[^}]*font-size:var\(--ui-body-font-size\)/s);
  const active = css.match(/\.nav-menu \.icon\.active[\s\S]*?\}/)?.[0] || '';
  assert.doesNotMatch(active, /0 0 2[0-9]px/);
});

test('FIX6D settings switches remain inside the same bounded semantic row', () => {
  const system = source('frontend/r32-system-center.css');
  const systemRuntime = source('frontend/r32-system-center.js');
  const settings = source('frontend/r32-settings-recovery.css');
  const settingsRuntime = source('frontend/r32-settings-recovery.js');
  const html = source('frontend/index.html');
  const reading = source('frontend/r32-global-reading.css');
  assert.match(system, /\.sc32-toggle-row\{[^}]*grid-template-columns:minmax\(0,1fr\) auto[^}]*max-width:none/s);
  assert.match(settings, /\.sr32-toggle\{[^}]*grid-template-columns:minmax\(0,1fr\) auto[^}]*width:100%/s);
  assert.match(system, /@media\(max-width:700px\)[\s\S]*\.sc32-toggle-row\{[^}]*grid-template-columns:minmax\(0,1fr\)/s);
  assert.match(systemRuntime, /class="sc32-switch[^"]*ui-binary-control/);
  assert.match(settingsRuntime, /class="ui-binary-control"[^>]*type="checkbox"/);
  assert.equal((html.match(/class="ui-binary-control"[^>]*type="checkbox"/g) || []).length, 4);
  assert.match(reading, /button:not\(\.ui-binary-control\)/);
  assert.match(reading, /input:not\(\.ui-binary-control\)/);
  assert.match(reading, /html\[data-reading="large"\] #app :where\([\s\S]*?button:not\(\.ui-binary-control\)[\s\S]*?\)\{/);
  assert.match(reading, /html\[data-reading="large"\] #app :where\([\s\S]*?input:not\(\.ui-binary-control\)[\s\S]*?\)\{/);
});

test('FIX6D notifications use one titlebar-safe global region', () => {
  const html = source('frontend/index.html');
  const runtime = source('frontend/js/r32-ui-runtime.js');
  const system = source('frontend/r32-system-center.js');
  const settings = source('frontend/r32-settings-recovery.js');
  assert.match(html, /id="globalNotificationRegion"/);
  assert.ok(html.indexOf('/js/r32-notification-layout-authority.js') < html.indexOf('/js/r32-ui-runtime.js'));
  assert.match(runtime, /YanceNotificationLayoutAuthority\.show/);
  assert.match(system, /YanceNotificationLayoutAuthority\.show/);
  assert.match(settings, /YanceNotificationLayoutAuthority\.show/);
  const notification = source('frontend/js/r32-notification-layout-authority.js');
  assert.match(notification, /warn:\s*'warning'/);
  assert.match(notification, /bad:\s*'error'/);
  assert.match(notification, /function clear\(/);
  assert.match(system, /YanceNotificationLayoutAuthority\.clear\(\{ source: 'system-center'/);
  assert.doesNotMatch(html, /\.toast\{[^}]*left:50%[^}]*top:/s);
});

test('FIX6D notification queue aggregates overflow synchronously instead of spinning on leaving nodes', () => {
  const notification = source('frontend/js/r32-notification-layout-authority.js');
  assert.match(notification, /const MAX_VISIBLE = 2/);
  assert.match(notification, /const SUMMARY_CLASS = 'global-notification-summary'/);
  assert.match(notification, /const oldest = notices\.shift\(\)/);
  assert.match(notification, /oldest\?\.remove\?\.\(\)/);
  assert.match(notification, /overflow \+= 1/);
  assert.doesNotMatch(notification, /while \(region\.children\.length > MAX_VISIBLE\) dismiss\(region\.firstElementChild\)/);
});

test('FIX6D diagnostics activate and restore routes through authorities', () => {
  const diagnostics = source('frontend/js/r32-layout-diagnostics.js');
  assert.match(diagnostics, /async function runRouteMatrix/);
  assert.match(diagnostics, /routeAuthority\.applyRoute/);
  assert.match(diagnostics, /route_ready_timeout/);
  assert.match(diagnostics, /route_activation_failed/);
  assert.doesNotMatch(diagnostics, /app\.className\s*=\s*originalClassName/);
});
