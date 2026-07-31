'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const routeAuthority = require('../../frontend/js/r32-workspace-route-authority');
const floatingMenu = require('../../frontend/js/r32-floating-menu-position');
const layoutDiagnostics = require('../../frontend/js/r32-layout-diagnostics');

function classList(values = []) {
  const set = new Set(values);
  return {
    contains: value => set.has(value),
    add: (...items) => items.forEach(item => set.add(item)),
    remove: (...items) => items.forEach(item => set.delete(item))
  };
}

test('workspace route authority preserves system and settings routes and detects duplicate route classes', () => {
  assert.equal(routeAuthority.normalizeView('settings-recovery'), 'settings');
  assert.equal(routeAuthority.normalizeView('system-center'), 'system');
  const app = { classList: classList(['settings-recovery-open']) };
  assert.equal(routeAuthority.activeView(app), 'settings');
  assert.equal(routeAuthority.routeIntegrity(app, 'settings').pass, true);
  app.classList.add('system-center-open');
  const conflict = routeAuthority.routeIntegrity(app, 'settings');
  assert.equal(conflict.pass, false);
  assert.equal(conflict.duplicateClasses, true);
});

test('startup and desktop recovery restore persisted external workspace instead of falling back to conversation', () => {
  const runtime = read('frontend/js/r32-ui-runtime.js');
  const productNavigation = read('frontend/js/r32-product-area-navigation.js');
  assert.match(runtime, /YanceWorkspaceRouteAuthority\?\.normalizeView\?\.\(s\.currentView,'conversation'\)/);
  assert.match(runtime, /__YancePendingWorkspaceView=requestedView/);
  assert.match(runtime, /yance:workspace-route-restore-requested/);
  assert.match(runtime, /onActivationRecovery/);
  assert.match(runtime, /restoreWorkspaceView\?\.\(expected,'desktop-activation-ready'\)/);
  assert.match(productNavigation, /function restoreWorkspaceView/);
  assert.match(productNavigation, /workspaceRouteIntegrity/);
  assert.match(productNavigation, /startup-pending/);
});

test('floating menus flip above and stay inside narrow or short Windows viewports', () => {
  const bottomRight = floatingMenu.calculate({
    anchorX: 1180, anchorY: 690, menuWidth: 320, menuHeight: 520,
    viewportWidth: 1200, viewportHeight: 700, margin: 8
  });
  assert.equal(bottomRight.placement, 'above');
  assert.ok(bottomRight.left >= 8);
  assert.ok(bottomRight.left + 320 <= 1192);
  assert.ok(bottomRight.top >= 8);
  assert.ok(bottomRight.top + Math.min(520, bottomRight.maxHeight) <= 692);

  const tiny = floatingMenu.calculate({
    anchorX: -50, anchorY: -20, menuWidth: 900, menuHeight: 900,
    viewportWidth: 480, viewportHeight: 320, margin: 8
  });
  assert.equal(tiny.left, 8);
  assert.equal(tiny.top, 8);
  assert.equal(tiny.maxHeight, 304);
});

test('tray activation presents renderer immediately and reports visible recovery progress', () => {
  const controller = read('electron/mainWindowActivationController.js');
  const main = read('electron/main.js');
  const preload = read('electron/preload.js');
  const runtime = read('frontend/js/r32-ui-runtime.js');
  assert.ok(controller.indexOf("present(window, 'renderer-ready')") < controller.indexOf('await validateRuntimeReady(window, request)'));
  assert.match(controller, /visible-recovering/);
  assert.match(main, /desktop:activation-recovery/);
  assert.match(preload, /onActivationRecovery/);
  assert.match(runtime, /主窗口已显示，正在恢复本地会话/);
  assert.match(runtime, /backgroundRefreshScheduled=true/);
});

test('layout diagnostics fail when a title/subnav overlap or title clipping is observed', () => {
  assert.equal(layoutDiagnostics.rectangleOverlapArea({ left: 0, top: 0, right: 100, bottom: 50 }, { left: 20, top: 40, right: 80, bottom: 70 }), 600);
  const result = layoutDiagnostics.evaluateWorkspaceMetrics({
    display: 'block', width: 900, clientWidth: 900, scrollWidth: 900,
    verticalTextSamples: [], headerSubnavOverlapArea: 120, clippedTitleSamples: ['设置与恢复']
  }, 1200);
  assert.equal(result.pass, false);
  assert.equal(result.headerFlowPass, false);
  assert.ok(result.failures.some(row => row.includes('重叠')));
  assert.ok(result.failures.some(row => row.includes('裁切')));
});

test('system headers, product subnav and long Persona pages have non-overlapping responsive contracts', () => {
  const layout = read('frontend/r32-workspace-scroll-layout.css');
  const personaCss = read('frontend/r32-persona.css');
  const personaRuntime = read('frontend/js/r32-persona-runtime.js');
  assert.match(layout, />:is\(header,\.product-area-subnav\)/);
  assert.match(layout, /position:relative!important/);
  assert.match(layout, /\.product-area-subnav\{[\s\S]*transform:none!important/);
  assert.match(personaCss, /columns:3 280px/);
  assert.match(personaCss, /break-inside:avoid/);
  assert.match(personaRuntime, /待生成中文理解 · 当前展示权威原文/);
  assert.doesNotMatch(personaRuntime, /primary:containsChinese\(original\)\?original:\(original\?'中文理解待生成'/);
});

test('contact and message menus use the shared viewport collision authority', () => {
  const ui = read('frontend/js/r32-ui-runtime.js');
  const capabilities = read('frontend/js/r32-conversation-capabilities.js');
  const css = read('frontend/r32-conversation-capabilities.css');
  assert.match(ui, /YanceFloatingMenuPosition\?\.placeMenu/);
  assert.match(capabilities, /YanceFloatingMenuPosition\?\.placeMenu/);
  assert.match(css, /\.r32-contact-context-menu\{[\s\S]*max-height:calc\(100vh - 16px\)/);
});
