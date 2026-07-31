'use strict';

// AC-001 活动会话通知抑制 — 整生命周期集成验证
// 覆盖：打开 / 切换 / 关闭 / 失焦 / 窗口隐藏 / 应用退出，确保每个阶段都无陈旧 activeConversationId 抑制。
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

test('AC-001 lifecycle: open/switch/close/blur/hide/exit leaves no stale active-conversation suppression', async () => {
  const { service, calls, flush } = harness();
  const deliver = async conversationId => {
    const pending = service.handleBackendEvent({
      type: 'desktop:notify',
      payload: { conversationId, messageId: `m-${conversationId}-${Math.random()}`, body: 'hi' }
    });
    await flush();
    return pending;
  };

  // 1) open + focus c1
  service.setWindowState({ visible: true, focused: true, minimized: false, activeConversationId: 'c1' });
  assert.equal((await deliver('c1')).handled, false, 'c1 suppressed while focused active');
  assert.equal((await deliver('c2')).handled, true, 'c2 shown while c1 active');

  // 2) switch to c2 — c1 must NOT stay suppressed (no stale id)
  service.setWindowState({ activeConversationId: 'c2' });
  assert.equal((await deliver('c1')).handled, true, 'c1 shown after switching away (no stale suppression)');
  assert.equal((await deliver('c2')).handled, false, 'c2 suppressed after switch');

  // 3) close c2 (active cleared)
  service.setWindowState({ activeConversationId: '' });
  assert.equal((await deliver('c2')).handled, true, 'c2 shown after close');

  // 4) focus c1 then blur — must not suppress while blurred
  service.setWindowState({ visible: true, focused: true, minimized: false, activeConversationId: 'c1' });
  service.setWindowState({ focused: false });
  assert.equal((await deliver('c1')).handled, true, 'c1 shown when blurred (no stale suppress)');

  // 5) window hide (visible=false) — background still notifies
  service.setWindowState({ visible: true, focused: true });
  service.setWindowState({ visible: false });
  assert.equal((await deliver('c1')).handled, true, 'c1 shown when window hidden (background still notifies)');

  // 6) app exit (reset state)
  service.setWindowState({ visible: false, focused: false, minimized: false, activeConversationId: '' });
  assert.equal((await deliver('c1')).handled, true, 'c1 shown after app-exit state reset');

  assert.ok(calls.notifications.length >= 3, 'background deliveries produced notifications');
});
