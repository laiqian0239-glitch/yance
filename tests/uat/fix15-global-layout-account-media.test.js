'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

function sourceBetween(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.notEqual(from, -1, `missing source anchor: ${start}`);
  assert.notEqual(to, -1, `missing source anchor: ${end}`);
  return source.slice(from, to);
}

test('all large workspaces use one route-root scroll authority instead of fixed hero rows', () => {
  const index = read('frontend/index.html');
  const css = read('frontend/r32-workspace-scroll-layout.css');
  assert.match(index, /r32-workspace-scroll-layout\.css/);
  for (const selector of ['profiles-workspace','timeline-workspace','insights-workspace','aiwork-workspace','account-center-workspace','system-center-workspace']) {
    assert.match(css, new RegExp(`\\.${selector}`));
  }
  assert.match(css, /overflow-y:auto/);
  assert.match(css, /\.app\.profile-page-open \.profiles-workspace[\s\S]*display:block/);
  assert.match(css, /\.app\.system-center-open \.system-center-workspace[\s\S]*display:block/);
  assert.match(css, /--ui-route-scroll-authority:workspace-root/);
  assert.match(css, /\.ui-route-scroll-root \.ui-route-scroll-surface\{[\s\S]*overflow:visible/);
  assert.doesNotMatch(css, /\.sc32-sidebar\{[^}]*overflow-y:auto/);
  assert.match(css, /\.aiw30-sidebar\{[\s\S]*minmax\(220px,1fr\)/);
  assert.match(css, /\.aiw30-activity\{[\s\S]*min-height:220px/);
  assert.match(css, /\.ac32-scroll/);
});

test('system center uses one outer scroll authority and restores each tab after rerenders', () => {
  const source = read('frontend/r32-system-center.js');
  const css = read('frontend/r32-workspace-scroll-layout.css');
  assert.match(source, /workspaceScrollTopByTab:\s*\{\}/);
  assert.match(source, /function captureSystemCenterScroll/);
  assert.match(source, /function restoreSystemCenterScroll/);
  assert.match(source, /state\.workspaceScrollTopByTab\[tab\]\s*=\s*top/);
  assert.doesNotMatch(source, /panelScrollTop:\s*\{\}/);
  assert.match(source, /renderPanel\(\{ capture: false, workspaceTop:/);
  assert.match(css, /\.app\.system-center-open \.sc32-content\{[\s\S]*overflow:visible/);
  assert.match(css, /\.app\.system-center-open \.sc32-sidebar\{[^}]*position:relative/);
  assert.match(css, /\.app\.system-center-open \.sc32-sidebar\{[^}]*overflow:visible/);
  assert.doesNotMatch(css, /\.app\.system-center-open \.sc32-sidebar\{[^}]*position:sticky/);
});

test('account diagnostics and history use outer workspace scroll without virtualized height jumps', () => {
  const source = read('frontend/r32-account-center.js');
  const css = read('frontend/r32-workspace-scroll-layout.css');
  assert.match(source, /scrollByView:\s*\{\}/);
  assert.match(source, /function captureAccountCenterScroll/);
  assert.match(source, /function restoreAccountCenterScroll/);
  assert.match(source, /dataset\.renderedAccountId/);
  assert.match(source, /dataset\.renderedTab/);
  assert.doesNotMatch(source, /document\.getElementById\('ac32Scroll'\)\.onscroll/);
  assert.match(css, /\.app\.account-center-open \.ac32-scroll\{[\s\S]*overflow:visible/);
  assert.match(css, /content-visibility:visible/);
  assert.match(css, /contain-intrinsic-size:none/);
  assert.match(source, /查看技术详情/);
});

test('account selector chooses a user-facing Facebook identity and keeps IDs diagnostic-only', () => {
  const source = read('frontend/js/r32-ui-runtime.js');
  const block = sourceBetween(source, 'function accountPlatformLabel', 'function conversationRouteContext');
  const context = {
    profileText(value, fallback = '') { return value == null || String(value).trim() === '' ? fallback : String(value).trim(); }
  };
  vm.createContext(context);
  vm.runInContext(`${block};this.accountRouteIdentity=accountRouteIdentity;this.accountRouteDiagnosticIdentity=accountRouteDiagnosticIdentity;`, context);
  const account = {
    platform: 'facebook',
    id: 'fa-a09fffba-21600000',
    adapterAccountId: 'fa-a09fffba-21600000',
    displayName: 'Facebook 账号',
    identityLabel: 'Yeonhee Kim'
  };
  assert.equal(context.accountRouteIdentity(account), 'Yeonhee Kim');
  assert.match(context.accountRouteDiagnosticIdentity(account), /fa-a09fffba/);
  assert.match(source, /return `\$\{platform\} • \$\{source\}`/);
  assert.match(source, /内部账号标识：/);
});

test('Facebook thumbs-up and sticker attachments retain compact-expression semantics', () => {
  const source = read('backend/services/facebookAdapter.js');
  const clean = sourceBetween(source, 'function clean', 'function localAvatarFallback');
  const helpers = sourceBetween(source, 'function facebookExpressionId', 'function conversationPeer');
  const context = {};
  vm.createContext(context);
  vm.runInContext(`${clean}${helpers};this.graphAttachments=graphAttachments;this.facebookExpressionId=facebookExpressionId;`, context);
  const rows = context.graphAttachments({ attachments: [{ type: 'image', payload: { url: 'https://lookaside.fbsbx.com/thumb.png', sticker_id: '369239263222822' } }] });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, 'sticker');
  assert.equal(rows[0].platformExpressionId, '369239263222822');
  assert.equal(rows[0].presentation, 'compact-expression');

  const ui = read('frontend/js/r32-ui-runtime.js');
  const css = read('frontend/r32-workspace-scroll-layout.css');
  assert.match(ui, /function enhanceCompactMessageMedia/);
  assert.match(ui, /legacyFacebookExpression/);
  assert.match(ui, /!compact&&\['image','gif','video'\]\.includes\(kind\)/);
  assert.match(css, /\.media-card\.media-compact-expression/);
  assert.match(css, /\.media-compact-expression \.media-analyze-btn\{display:none!important\}/);
});
