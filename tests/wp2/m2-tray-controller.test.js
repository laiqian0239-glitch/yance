'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const tray = require('../../electron/m2/trayController');

const ROOT = path.resolve(__dirname, '..', '..');
const read = relativePath => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');

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
  assert.deepStrictEqual(Object.keys(m), ['show', 'restart', 'relaunch', 'quit']);
  assert.deepStrictEqual(
    Object.values(m).map(item => item.label),
    ['显示主窗口', '重启后端', '重新启动应用', '退出']
  );
  for (const k of ['show', 'restart', 'relaunch', 'quit']) {
    assert.ok(m[k], `missing ${k}`);
    assert.strictEqual(m[k].enabled, true);
  }
});

test('production tray menu is built from the M2 tray authority, not the legacy template', () => {
  const main = read('electron/main.js');
  assert.match(main, /m2TrayController\.createTrayModel\(\)/u);
  assert.match(main, /m2TrayController\.applyTrayState\(null,\s*currentTrayAuthorityStateName\(\)\)/u);
  assert.match(main, /function relaunchApplicationFromTray\(\)/u);
  assert.match(main, /\.\.\.item\('show'\)[\s\S]*activateMainWindow\('tray-menu-show'\)/u);
  assert.match(main, /\.\.\.item\('restart'\)[\s\S]*restartBackend\(\{\s*reason:\s*'desktop-tray-restart'\s*\}\)/u);
  assert.match(main, /\.\.\.item\('relaunch'\)[\s\S]*relaunchApplicationFromTray\(\)/u);
  assert.match(main, /\.\.\.item\('quit'\)[\s\S]*app\.quit\(\)/u);
  assert.doesNotMatch(main, /id:\s*'status'|type:\s*'separator'/u);
  assert.doesNotMatch(main, /id:\s*'launch-at-login'|开机自启设置|账号状态|打开系统中心|打开数据目录|打开日志目录|AI模型/u);
  assert.doesNotMatch(main, /id:\s*'quit-yance-28'|重启本地服务|检查更新|关闭窗口时|安全模式|Safe Mode/u);
});
