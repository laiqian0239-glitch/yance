'use strict';

// AC-034 Sound Notification 单一链路 — 验证一个 presenter / 一个 sound player，
// 兼容 desktop:notify 不触发第二次展示或播放。
const test = require('node:test');
const assert = require('node:assert/strict');
const { SoundNotificationService } = require('../../electron/SoundNotificationService');

function harness(settings = {}) {
  const calls = { notifications: [], sounds: [] };
  const timers = [];
  const service = new SoundNotificationService({
    settings: { mergeWindowMs: 0, ...settings },
    now: () => new Date('2026-07-07T12:00:00'),
    setTimeout: fn => { timers.push(fn); return fn; },
    clearTimeout: fn => { const i = timers.indexOf(fn); if (i >= 0) timers.splice(i, 1); },
    presentNotification: async p => { calls.notifications.push(p); return { shown: true }; },
    playSound: async p => { calls.sounds.push(p); return { played: true }; },
    presentTrayUnread: () => {}
  });
  return { service, calls, flush: async () => { while (timers.length) await timers.shift()(); } };
}

test('AC-034 single chain: one desktop:notify yields exactly one presentation and one sound (no double)', async () => {
  const { service, calls, flush } = harness();
  service.setWindowState({ visible: false, focused: false });
  const pending = service.handleBackendEvent({ type: 'desktop:notify', payload: { conversationId: 'c1', messageId: 'm1', body: 'one' } });
  await flush();
  const r = await pending;
  assert.equal(r.handled, true);
  assert.equal(calls.notifications.length, 1, 'single presenter called once');
  assert.equal(calls.sounds.length, 1, 'single sound player called once');
});

test('AC-034 single chain: unified service is the sole notification path (no second presenter)', async () => {
  const { service, calls, flush } = harness();
  service.setWindowState({ visible: false, focused: false });
  const a = service.handleBackendEvent({ type: 'desktop:notify', payload: { conversationId: 'c1', messageId: 'a', body: 'a' } });
  const b = service.handleBackendEvent({ type: 'desktop:notify', payload: { conversationId: 'c2', messageId: 'b', body: 'b' } });
  await flush();
  await a; await b;
  assert.equal(calls.notifications.length, 2, 'each message presented once via sole path');
  assert.equal(calls.sounds.length, 2, 'each message played once via sole path');
});

test('AC-034 single chain: suppressed foreground message is neither presented nor played', async () => {
  const { service, calls, flush } = harness();
  service.setWindowState({ visible: true, focused: true, minimized: false, activeConversationId: 'c1' });
  const pending2 = service.handleBackendEvent({ type: 'desktop:notify', payload: { conversationId: 'c1', messageId: 'm1', body: 'one' } });
  await flush();
  const r = await pending2;
  assert.equal(r.handled, false);
  assert.equal(calls.notifications.length, 0, 'foreground active message not presented');
  assert.equal(calls.sounds.length, 0, 'foreground active message not played');
});
