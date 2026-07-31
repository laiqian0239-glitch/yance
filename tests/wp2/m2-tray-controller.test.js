'use strict';

const test = require('node:test');
const assert = require('node:assert');
const tray = require('../../electron/m2/trayController');

test('computeTrayState: RUNNING 全可用', () => {
  const m = tray.computeTrayState('RUNNING');
  assert.strictEqual(m.show.enabled, true);
  assert.strictEqual(m.restart.enabled, true);
  assert.strictEqual(m.relaunch.enabled, true);
  assert.strictEqual(m.quit.enabled, true);
});

test('QUITTING / RELAUNCHING 禁用 quit/restart/relaunch', () => {
  for (const s of ['QUITTING', 'RELAUNCHING_APP', 'FATAL_SHUTDOWN_BLOCKED']) {
    const m = tray.computeTrayState(s);
    assert.strictEqual(m.quit.enabled, false, `${s}.quit`);
    assert.strictEqual(m.restart.enabled, false, `${s}.restart`);
    assert.strictEqual(m.relaunch.enabled, false, `${s}.relaunch`);
    assert.strictEqual(m.show.enabled, true, `${s}.show`);
  }
});

test('BACKEND_RESTARTING 禁用 restart/relaunch，保留 quit', () => {
  const m = tray.computeTrayState('BACKEND_RESTARTING');
  assert.strictEqual(m.restart.enabled, false);
  assert.strictEqual(m.relaunch.enabled, false);
  assert.strictEqual(m.quit.enabled, true);
});

test('FAILED_STARTUP 禁用 restart，保留 quit/relaunch', () => {
  const m = tray.computeTrayState('FAILED_STARTUP');
  assert.strictEqual(m.restart.enabled, false);
  assert.strictEqual(m.quit.enabled, true);
  assert.strictEqual(m.relaunch.enabled, true);
});

test('applyTrayState 写入 tray.menuItems.enabled', () => {
  const fakeTray = {
    menuItems: [
      { id: 'show', enabled: true },
      { id: 'restart', enabled: true },
      { id: 'relaunch', enabled: true },
      { id: 'quit', enabled: true }
    ]
  };
  const model = tray.applyTrayState(fakeTray, 'QUITTING');
  assert.strictEqual(fakeTray.menuItems.find((i) => i.id === 'quit').enabled, false);
  assert.strictEqual(fakeTray.menuItems.find((i) => i.id === 'show').enabled, true);
  assert.strictEqual(model.quit.enabled, false);
});

test('createTrayModel 返回四动作默认模型', () => {
  const m = tray.createTrayModel();
  for (const k of ['show', 'restart', 'relaunch', 'quit']) {
    assert.ok(m[k], `missing ${k}`);
    assert.strictEqual(m[k].enabled, true);
  }
});
