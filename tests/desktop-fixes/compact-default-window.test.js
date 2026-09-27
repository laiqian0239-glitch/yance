'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const schema = require('../../electron/desktopSettingsSchema');
const policyPath = path.join(ROOT, 'electron/windowBoundsPolicy.js');
const policy = fs.existsSync(policyPath) ? require(policyPath) : {};
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');

test('desktop settings default to the compact supported normal window', () => {
  assert.equal(schema.DEFAULTS.windowWidth, 1060);
  assert.equal(schema.DEFAULTS.windowHeight, 720);
  assert.equal(schema.normalizeDesktopSettings({ windowWidth: 700, windowHeight: 500 }).windowWidth, 980);
  assert.equal(schema.normalizeDesktopSettings({ windowWidth: 700, windowHeight: 500 }).windowHeight, 680);
});

test('window bounds policy clamps first-run geometry and restores persisted normal bounds', () => {
  assert.equal(typeof policy.resolveInitialWindowBounds, 'function');
  const firstRun = policy.resolveInitialWindowBounds({ windowX: null, windowY: null, windowWidth: 1060, windowHeight: 720 }, { x: 0, y: 0, width: 1920, height: 1040 });
  assert.deepEqual(firstRun, { x: 430, y: 160, width: 1060, height: 720, maximized: false });
  const compactWorkArea = policy.resolveInitialWindowBounds({ windowX: null, windowY: null, windowWidth: 1060, windowHeight: 720 }, { x: 0, y: 0, width: 1366, height: 728 });
  assert.deepEqual(compactWorkArea, { x: 192, y: 24, width: 983, height: 680, maximized: false });
  const restored = policy.resolveInitialWindowBounds({ windowX: 2500, windowY: -500, windowWidth: 1000, windowHeight: 690, windowMaximized: true }, { x: 0, y: 0, width: 1920, height: 1040 });
  assert.deepEqual(restored, { x: 920, y: 0, width: 1000, height: 690, maximized: true });
});

test('normal-bound capture ignores minimized or maximized geometry', () => {
  assert.equal(typeof policy.captureNormalWindowBounds, 'function');
  assert.equal(policy.captureNormalWindowBounds({ isMinimized: () => true, isMaximized: () => false, getBounds: () => ({ x: 1, y: 2, width: 3, height: 4 }) }), null);
  assert.equal(policy.captureNormalWindowBounds({ isMinimized: () => false, isMaximized: () => true, getBounds: () => ({ x: 1, y: 2, width: 3, height: 4 }) }), null);
  assert.deepEqual(policy.captureNormalWindowBounds({ isMinimized: () => false, isMaximized: () => false, getBounds: () => ({ x: 12, y: 24, width: 1000, height: 700 }) }), {
    windowX: 12,
    windowY: 24,
    windowWidth: 1000,
    windowHeight: 700,
    windowMaximized: false,
  });
});

test('main process consumes compact bounds policy and persists only normal geometry', () => {
  const main = read('electron/main.js');
  assert.match(main, /resolveInitialWindowBounds/);
  assert.match(main, /captureNormalWindowBounds/);
  assert.match(main, /minWidth:\s*980/u);
  assert.match(main, /minHeight:\s*680/u);
  assert.match(main, /backgroundColor:\s*'#06111D'/u);
  assert.match(main, /createdWindow\.on\('resize'/u);
  assert.match(main, /createdWindow\.on\('move'/u);
  assert.match(main, /settingsStore\.update\(normalBounds\)/u);
});

test('desktop settings preserve null first-run position so work-area centering remains authoritative', () => {
  const normalized = schema.normalizeDesktopSettings(schema.DEFAULTS);
  assert.equal(normalized.windowX, null);
  assert.equal(normalized.windowY, null);
});
