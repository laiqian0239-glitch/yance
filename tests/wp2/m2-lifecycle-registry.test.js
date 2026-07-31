'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { createRegistry } = require('../../electron/m2/lifecycleRegistry');

// 伪造 timer：支持 clearTimeout/clearInterval 风格的清理
function fakeTimer() {
  return { closed: false, unrefed: false, close() { this.closed = true; }, unref() { this.unrefed = true; } };
}
function fakeSocket() {
  return { destroyed: false, destroy() { this.destroyed = true; } };
}
function fakeTray() {
  return { destroyed: false, destroy() { this.destroyed = true; } };
}

test('registerTimer / clearTimer', () => {
  const r = createRegistry();
  const t = fakeTimer();
  r.registerTimer('heartbeat', t);
  assert.strictEqual(r.snapshot().timers.length, 1);
  r.clearTimer('heartbeat');
  assert.strictEqual(r.snapshot().timers.length, 0);
  assert.strictEqual(t.closed, true);
  assert.strictEqual(t.unrefed, true);
});

test('cleanupAll 清空全部 timer / socket / tray', () => {
  const r = createRegistry();
  r.registerTimer('a', fakeTimer());
  r.registerTimer('b', fakeTimer());
  r.registerEventSocket(fakeSocket());
  r.registerTray(fakeTray());
  const summary = r.cleanupAll();
  assert.strictEqual(summary.timersCleared, 2);
  assert.strictEqual(summary.eventSocketsDestroyed, 1);
  assert.strictEqual(summary.trayDestroyed, true);
  const snap = r.snapshot();
  assert.strictEqual(snap.timers.length, 0);
  assert.strictEqual(snap.eventSocketCount, 0);
  assert.strictEqual(snap.hasTray, false);
});

test('cleanupAll 幂等（二次调用安全）', () => {
  const r = createRegistry();
  r.registerTimer('x', fakeTimer());
  r.cleanupAll();
  const summary = r.cleanupAll();
  assert.strictEqual(summary.timersCleared, 0);
});

test('custom disposable 在 cleanupAll 执行', () => {
  const r = createRegistry();
  let ran = false;
  r.registerDisposable('hook', () => { ran = true; });
  r.cleanupAll();
  assert.strictEqual(ran, true);
});

test('destroyEventSocket 指定单例', () => {
  const r = createRegistry();
  const s1 = fakeSocket();
  const s2 = fakeSocket();
  r.registerEventSocket(s1);
  r.registerEventSocket(s2);
  r.destroyEventSocket(s1);
  assert.strictEqual(s1.destroyed, true);
  assert.strictEqual(s2.destroyed, false);
  assert.strictEqual(r.snapshot().eventSocketCount, 1);
});

test('unregisterEventSocket 仅移除注册，不重复关闭已处置 socket', () => {
  const r = createRegistry();
  let closeCalls = 0;
  const socket = { close() { closeCalls += 1; } };
  r.registerEventSocket(socket);
  assert.strictEqual(r.unregisterEventSocket(socket), true);
  assert.strictEqual(r.snapshot().eventSocketCount, 0);
  assert.strictEqual(closeCalls, 0);
  assert.deepStrictEqual(r.cleanupAll(), {
    timersCleared: 0,
    eventSocketsDestroyed: 0,
    trayDestroyed: false,
    disposablesRun: 0
  });
});
