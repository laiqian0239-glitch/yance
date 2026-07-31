'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');

test('main process separates native minimize from close-to-tray', () => {
  const main = read('electron/main.js');
  const minimizeStart = main.indexOf("createdWindow.on('minimize'");
  const minimizeEnd = main.indexOf('const syncSoundWindowState', minimizeStart);
  const minimizeBlock = main.slice(minimizeStart, minimizeEnd);
  assert.match(minimizeBlock, /preserveTaskbarOnMinimize\(createdWindow\)/);
  assert.doesNotMatch(minimizeBlock, /preventDefault|\.hide\(|setSkipTaskbar\(true\)/);
  const closeStart = main.indexOf("createdWindow.on('close'");
  const closeEnd = main.indexOf('const activationController', closeStart);
  assert.match(main.slice(closeStart, closeEnd), /hideWindowToTray\(createdWindow, event\)/);
});

test('every main-window activation shows a renderer-ready window immediately, then validates backend session before activation dispatch', () => {
  const main = read('electron/main.js');
  const controller = read('electron/mainWindowActivationController.js');
  const preload = read('electron/preload.js');
  const renderer = read('frontend/js/r32-ui-runtime.js');
  assert.match(main, /validateRuntimeReady:\s*validateMainWindowRuntimeReady/);
  assert.match(main, /await apiRequest\('\/api\/ready'\)/);
  assert.match(main, /currentApiSessionFingerprint/);
  assert.match(controller, /await validateRuntimeReady\(window, request\)/);
  assert.ok(controller.indexOf("present(window, 'renderer-ready')") < controller.indexOf('await validateRuntimeReady(window, request)'));
  assert.ok(controller.indexOf('const window = await ensureReadyWindow(request)') < controller.indexOf('sendActivation(window, request)'));
  assert.match(preload, /onActivationProbe/);
  assert.match(preload, /desktop:activation-probe-complete/);
  assert.match(renderer, /await apiJson\('\/api\/ready'/);
  assert.match(renderer, /await bootstrapR32\(true\)/);
  assert.match(renderer, /workspaceReady:true/);
});

test('legacy minimize-to-tray setting is migrated off and removed from visible settings UI', () => {
  const schema = require('../../electron/desktopSettingsSchema');
  assert.equal(schema.DEFAULTS.minimizeToTray, false);
  assert.equal(schema.normalizeDesktopSettings({ minimizeToTray: true }).minimizeToTray, false);
  for (const relative of ['frontend/index.html', 'frontend/r32-basic-settings.js', 'frontend/r32-settings-recovery.js', 'frontend/r32-system-center.js']) {
    assert.doesNotMatch(read(relative), /最小化到托盘/);
  }
});
