'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  preserveTaskbarOnMinimize,
  hideWindowToTray,
  restoreWindowTaskbar
} = require('../../electron/windowLifecyclePolicy');

function fakeWindow() {
  return {
    destroyed: false,
    hidden: 0,
    skipTaskbar: [],
    isDestroyed() { return this.destroyed; },
    hide() { this.hidden += 1; },
    setSkipTaskbar(value) { this.skipTaskbar.push(value); }
  };
}

test('native minimize keeps the taskbar button and never hides the window', () => {
  const window = fakeWindow();
  const result = preserveTaskbarOnMinimize(window);
  assert.equal(result.action, 'native-minimize');
  assert.equal(window.hidden, 0);
  assert.deepEqual(window.skipTaskbar, [false]);
});

test('only close-to-tray hides the window and removes its taskbar button', () => {
  const window = fakeWindow();
  let prevented = 0;
  const result = hideWindowToTray(window, { preventDefault() { prevented += 1; } });
  assert.equal(result.action, 'hide-to-tray');
  assert.equal(prevented, 1);
  assert.equal(window.hidden, 1);
  assert.deepEqual(window.skipTaskbar, [true]);
});

test('restoring from tray always restores the taskbar button', () => {
  const window = fakeWindow();
  restoreWindowTaskbar(window);
  assert.deepEqual(window.skipTaskbar, [false]);
});
