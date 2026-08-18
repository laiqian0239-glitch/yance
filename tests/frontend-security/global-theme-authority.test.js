'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const html = fs.readFileSync(path.join(ROOT, 'frontend/index.html'), 'utf8');
const theme = fs.readFileSync(path.join(ROOT, 'frontend/r32-theme-motion.css'), 'utf8');
const authority = fs.readFileSync(path.join(ROOT, 'frontend/r32-theme-authority.css'), 'utf8');
const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'frontend/theme-catalog.json'), 'utf8'));

const linkOrder = [...html.matchAll(/<link\s+href="([^"]+\.css)"\s+rel="stylesheet"\/>/g)].map(match => match[1]);

test('global theme authority is the final stylesheet in the application shell', () => {
  assert.equal(linkOrder.at(-1), '/r32-theme-authority.css');
  assert.ok(linkOrder.indexOf('/r32-theme-authority.css') > linkOrder.indexOf('/r32-conversation-center-v2.css'));
  assert.ok(linkOrder.indexOf('/r32-theme-authority.css') > linkOrder.indexOf('/r32-media-playback.css'));
});

test('all catalog themes define complete shared surface tokens', () => {
  assert.ok(catalog.themes.length >= 29);
  for (const { id } of catalog.themes) {
    const block = theme.match(new RegExp(`html\\[data-theme="${id}"\\]\\{([^}]+)\\}`));
    assert.ok(block, `missing theme block ${id}`);
    for (const token of ['--bg:', '--bg2:', '--nav:', '--panel:', '--panel2:', '--card:', '--card2:', '--text:', '--muted:', '--theme-accent:']) {
      assert.match(block[1], new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${id} missing ${token}`);
    }
  }
});

test('theme authority covers desktop chrome, conversation center and routed workspaces', () => {
  for (const selector of [
    '.desktop-titlebar', '.nav', '.contact-card.active', '.chat-head', '.messages', '.msg.me', '.composer',
    '.ai', '.brain-card', '.neural-core', '.flow-primary', '.flow-secondary', '.chat-empty-guidance button', '.reply-mode-control select', '.relationship-workbench', '.aiw30-sidebar', '.aiw30-route-map',
    '.account-center-workspace', '.system-center-workspace', '.settings-recovery-workspace', '.sr32-sound-picker', '.sc32-trend .line',
    '.contacts-workspace', '.profiles-workspace', '.timeline-workspace', '.insights-workspace', '.aiwork-workspace',
    '*::-webkit-scrollbar-thumb'
  ]) {
    assert.ok(authority.includes(selector), `global theme authority missing ${selector}`);
  }
  assert.match(authority, /--chat-stage:color-mix/);
  assert.match(authority, /--bubble-out:color-mix/);
  assert.match(authority, /var\(--theme-active-bg\)/);
  assert.match(authority, /var\(--theme-border-strong\)/);
  assert.match(authority, /scrollbar-color:color-mix/);
  assert.match(authority, /\.aiw30-core-orb/);
  assert.match(authority, /\.workbench-brand \.orb/);
  assert.match(authority, /#sc32TrendFill stop:first-child/);
  assert.match(authority, /#routeGrad stop:first-child/);
});

test('global theme authority does not replace semantic health colors', () => {
  assert.doesNotMatch(authority, /\.online\s*\{[^}]*background:/s);
  assert.doesNotMatch(authority, /\.error\s*\{[^}]*background:/s);
  assert.doesNotMatch(authority, /\.danger\s*\{[^}]*background:/s);
});


test('account-center transient status delegates to the global semantic notification authority', () => {
  const accountCenter = fs.readFileSync(path.join(ROOT, 'frontend/r32-account-center.js'), 'utf8');
  assert.match(accountCenter, /YanceNotificationLayoutAuthority\.show/);
  assert.doesNotMatch(accountCenter, /style\.cssText|border:1px solid rgba\(67,234,214/);
});

test('shipping Element Product consumes semantic theme roles instead of a private Product palette', () => {
  const productCss = fs.readFileSync(
    path.join(ROOT, 'integration/element-module/src/product-experience/ProductExperienceShell.css'),
    'utf8'
  );
  assert.doesNotMatch(productCss, /--yance-(?:surface|muted|accent)\s*:/u, 'Product must not define a competing private theme palette');
  assert.match(productCss, /var\(--(?:surface|text|accent)-/u, 'Product must consume repository semantic theme roles');
});
