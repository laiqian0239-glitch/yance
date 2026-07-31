'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { SoundNotificationService, normalizeSettings, inDnd } = require('../../electron/SoundNotificationService');

function harness(settings = {}) {
  const calls = { notifications: [], sounds: [], tray: [] };
  const timers = [];
  let now = new Date('2026-07-07T12:00:00');
  const service = new SoundNotificationService({
    settings: { mergeWindowMs: 0, ...settings },
    now: () => new Date(now),
    setTimeout: fn => { timers.push(fn); return fn; },
    clearTimeout: fn => { const index = timers.indexOf(fn); if (index >= 0) timers.splice(index, 1); },
    presentNotification: async payload => { calls.notifications.push(payload); return { shown: true }; },
    playSound: async payload => { calls.sounds.push(payload); return { played: true, pattern: payload.pattern }; },
    presentTrayUnread: count => calls.tray.push(count)
  });
  return {
    service,
    calls,
    setNow: value => { now = new Date(value); },
    flushTimers: async () => { while (timers.length) await timers.shift()(); }
  };
}

test('normalizes extended sound notification settings and bounded timing', () => {
  const value = normalizeSettings({ soundVolume: 7, dedupeWindowMs: 1, mergeWindowMs: 90000, priorityConversations: ['a', 'a', ''] });
  assert.equal(value.soundVolume, 1);
  assert.equal(value.dedupeWindowMs, 250);
  assert.equal(value.mergeWindowMs, 5000);
  assert.deepEqual(value.priorityConversations, ['a']);
});

test('normalizes selectable sound patterns and falls back from unknown ids', () => {
  const value = normalizeSettings({
    incomingSoundPattern: 'message-crystal',
    outgoingSoundPattern: 'not-a-sound',
    failureSoundPattern: 'warning-low',
    presenceOnlineSoundPattern: 'task-complete',
    presenceOfflineSoundPattern: 'message-soft'
  });
  assert.equal(value.incomingSoundPattern, 'message-crystal');
  assert.equal(value.outgoingSoundPattern, 'message-sent');
  assert.equal(value.failureSoundPattern, 'warning-low');
  assert.equal(value.presenceOnlineSoundPattern, 'task-complete');
  assert.equal(value.presenceOfflineSoundPattern, 'message-soft');
});

test('DND supports overnight ranges', () => {
  assert.equal(inDnd({ enabled: true, start: '22:30', end: '07:30' }, new Date('2026-07-07T23:00:00')), true);
  assert.equal(inDnd({ enabled: true, start: '22:30', end: '07:30' }, new Date('2026-07-07T12:00:00')), false);
});

test('incoming event is presented only by the unified service and duplicate message is rejected', async () => {
  const h = harness();
  h.service.setWindowState({ visible: false, focused: false });
  const payload = { conversationId: 'c1', messageId: 'm1', title: 'Ada', body: 'Hello' };
  const first = h.service.handleBackendEvent({ type: 'desktop:notify', payload });
  await h.flushTimers();
  assert.equal((await first).handled, true);
  const duplicate = await h.service.handleBackendEvent({ type: 'desktop:notify', payload });
  assert.equal(duplicate.reason, 'duplicate');
  assert.equal(h.calls.notifications.length, 1);
  assert.deepEqual(h.calls.sounds.map(row => row.pattern), ['message-in']);
});

test('continuous incoming messages from one conversation merge into one notification and one sound', async () => {
  const h = harness({ mergeWindowMs: 900 });
  h.service.setWindowState({ visible: false, focused: false });
  const a = h.service.handleBackendEvent({ type: 'desktop:notify', payload: { conversationId: 'c1', messageId: 'm1', title: 'Ada', body: 'One' } });
  const b = h.service.handleBackendEvent({ type: 'desktop:notify', payload: { conversationId: 'c1', messageId: 'm2', title: 'Ada', body: 'Two' } });
  await h.flushTimers();
  const result = await a;
  assert.equal((await b).count, 2);
  assert.equal(result.count, 2);
  assert.equal(h.calls.notifications.length, 1);
  assert.match(h.calls.notifications[0].body, /^2 条新消息/);
  assert.equal(h.calls.sounds.length, 1);
});

test('focused active conversation suppresses both system notification and sound', async () => {
  const h = harness();
  h.service.setWindowState({ visible: true, focused: true, minimized: false, activeConversationId: 'c1' });
  const result = await h.service.handleBackendEvent({ type: 'desktop:notify', payload: { conversationId: 'c1', messageId: 'm1', body: 'One' } });
  assert.equal(result.handled, false);
  assert.equal(result.reason, 'active-conversation');
  assert.equal(h.calls.notifications.length, 0);
  assert.equal(h.calls.sounds.length, 0);
});

test('focused different conversation keeps one sound while suppressing OS notification', async () => {
  const h = harness();
  h.service.setWindowState({ visible: true, focused: true, minimized: false, activeConversationId: 'c2' });
  const pending = h.service.handleBackendEvent({ type: 'desktop:notify', payload: { conversationId: 'c1', messageId: 'm2', body: 'One' } });
  await h.flushTimers();
  const result = await pending;
  assert.equal(result.notification.shown, false);
  assert.equal(h.calls.notifications.length, 0);
  assert.equal(h.calls.sounds.length, 1);
});

test('blurred window no longer suppresses the previously active conversation', async () => {
  const h = harness();
  h.service.setWindowState({ visible: true, focused: false, minimized: false, activeConversationId: 'c1' });
  const pending = h.service.handleBackendEvent({ type: 'desktop:notify', payload: { conversationId: 'c1', messageId: 'm3', body: 'One' } });
  await h.flushTimers();
  const result = await pending;
  assert.equal(result.handled, true);
  assert.equal(h.calls.notifications.length, 1);
  assert.equal(h.calls.sounds.length, 1);
});

test('explicit conversation mute wins over priority while priority bypasses DND', async () => {
  const h = harness({
    dnd: { enabled: true, start: '00:00', end: '23:59' },
    priorityConversations: ['priority', 'muted-priority'],
    mutedConversations: ['muted-priority']
  });
  h.service.setWindowState({ visible: false, focused: false });
  const allowed = h.service.handleBackendEvent({ type: 'desktop:notify', payload: { conversationId: 'priority', messageId: 'm1' } });
  await h.flushTimers();
  assert.equal((await allowed).handled, true);
  const muted = await h.service.handleBackendEvent({ type: 'desktop:notify', payload: { conversationId: 'muted-priority', messageId: 'm2' } });
  assert.equal(muted.reason, 'muted-conversation');
});

test('event categories use the saved selectable sound patterns', async () => {
  const h = harness({
    incomingSoundPattern: 'message-crystal',
    outgoingSoundPattern: 'message-soft',
    failureSoundPattern: 'warning-low',
    presenceOnlineSoundPattern: 'task-complete',
    presenceOfflineSoundPattern: 'message-pulse'
  });
  h.service.setWindowState({ visible: false, focused: false });
  const incoming = h.service.handleBackendEvent({ type: 'desktop:notify', payload: { conversationId: 'custom-c1', messageId: 'custom-m1' } });
  await h.flushTimers();
  await incoming;
  await h.service.handleBackendEvent({ type: 'send-queue:sent', payload: { queue: { id: 'custom-q1', sessionKey: 'custom-c1' } } });
  await h.service.handleBackendEvent({ type: 'send-queue:failed', payload: { queue: { id: 'custom-q2', sessionKey: 'custom-c1' } } });
  await h.service.handleBackendEvent({ type: 'conversation:presence', payload: { conversationId: 'custom-c2', state: 'offline' } });
  h.setNow('2026-07-07T12:00:06');
  await h.service.handleBackendEvent({ type: 'conversation:presence', payload: { conversationId: 'custom-c2', state: 'online' } });
  assert.deepEqual(h.calls.sounds.map(row => row.pattern), ['message-crystal', 'message-soft', 'warning-low', 'task-complete']);
});

test('send success and permanent failure map to distinct sounds without adapter-event duplicates', async () => {
  const h = harness();
  h.service.setWindowState({ visible: false, focused: false });
  await h.service.handleBackendEvent({ type: 'send-queue:sent', payload: { queue: { id: 'q1', sessionKey: 'c1' } } });
  await h.service.handleBackendEvent({ type: 'send-queue:failed', payload: { queue: { id: 'q2', sessionKey: 'c1' }, error: { message: 'offline' } } });
  const ignored = await h.service.handleBackendEvent({ type: 'message:outbound-sent', payload: { messageId: 'p1' } });
  assert.equal(ignored.handled, false);
  assert.deepEqual(h.calls.sounds.map(row => row.pattern), ['message-sent', 'send-failed']);
  assert.equal(h.calls.notifications.length, 1);
  assert.equal(h.calls.notifications[0].title, '消息发送失败');
});

test('presence ignores typing and first observation, then alerts once per online/offline transition', async () => {
  const h = harness();
  h.service.setWindowState({ visible: false, focused: false });
  assert.equal((await h.service.handleBackendEvent({ type: 'conversation:presence', payload: { conversationId: 'c1', state: 'composing' } })).handled, false);
  assert.equal((await h.service.handleBackendEvent({ type: 'conversation:presence', payload: { conversationId: 'c1', state: 'offline' } })).reason, 'initial-presence-observation');
  assert.equal((await h.service.handleBackendEvent({ type: 'conversation:presence', payload: { conversationId: 'c1', state: 'online', title: 'Ada' } })).kind, 'contact-online');
  assert.equal((await h.service.handleBackendEvent({ type: 'conversation:presence', payload: { conversationId: 'c1', state: 'online', title: 'Ada' } })).reason, 'unchanged-presence');
  h.setNow('2026-07-07T12:00:06');
  assert.equal((await h.service.handleBackendEvent({ type: 'conversation:presence', payload: { conversationId: 'c1', state: 'offline', title: 'Ada' } })).kind, 'contact-offline');
  assert.deepEqual(h.calls.sounds.map(row => row.pattern), ['contact-online', 'contact-offline']);
});

test('tray unread state is delegated to the existing tray presenter', () => {
  const h = harness();
  assert.equal(h.service.updateUnreadCount(7.9), 7);
  assert.deepEqual(h.calls.tray, [7]);
});

test('preview bypasses DND and global mute but remains volume bounded', async () => {
  const h = harness({ paused: true, soundEnabled: false });
  const result = await h.service.preview('send-failed', 4);
  assert.equal(result.played, true);
  assert.equal(h.calls.sounds[0].pattern, 'send-failed');
  assert.equal(h.calls.sounds[0].volume, 1);
  assert.equal(h.calls.sounds[0].force, true);
});


test('notification privacy is applied inside the unified presenter path', async () => {
  const h = harness({ privacy: 'hidden' });
  h.service.setWindowState({ visible: false, focused: false });
  const pending = h.service.handleBackendEvent({ type: 'desktop:notify', payload: { conversationId: 'c1', messageId: 'm-private', title: 'Ada', body: 'Secret', avatarUrl: 'https://example.invalid/a.png' } });
  await h.flushTimers();
  await pending;
  assert.equal(h.calls.notifications.length, 1);
  assert.equal(h.calls.notifications[0].title, '言策 新消息');
  assert.equal(h.calls.notifications[0].body, '收到一条新消息');
  assert.equal(h.calls.notifications[0].hideAvatar, true);
  assert.equal(h.calls.notifications[0].avatarUrl, '');
});

test('partial DND updates preserve the existing time window', () => {
  const h = harness({ dnd: { enabled: false, start: '21:15', end: '06:45' } });
  const next = h.service.setSettings({ dnd: { enabled: true } });
  assert.deepEqual(next.dnd, { enabled: true, start: '21:15', end: '06:45' });
});

test('OD-003 suppression precedence is frozen and priority bypasses DND only', () => {
  const { SUPPRESSION_PRECEDENCE } = require('../../electron/SoundNotificationService');
  assert.deepEqual(SUPPRESSION_PRECEDENCE, [
    'disabled', 'paused', 'active-conversation', 'muted-conversation',
    'muted-account', 'muted-platform', 'dnd', 'allowed'
  ]);
  const h = harness({
    dnd: { enabled: true, start: '00:00', end: '23:59' },
    priorityConversations: ['priority'],
    mutedConversations: ['conversation-muted'],
    mutedAccounts: ['account-muted'],
    mutedPlatforms: ['telegram']
  });
  h.service.setWindowState({ visible: false, focused: false, minimized: false });
  assert.equal(h.service.suppressionDecision({ conversationId: 'priority' }).reason, 'allowed');
  assert.equal(h.service.suppressionDecision({ conversationId: 'priority' }).priorityBypassedDnd, true);
  assert.equal(h.service.suppressionDecision({ conversationId: 'conversation-muted', accountId: 'account-muted', platform: 'telegram' }).reason, 'muted-conversation');
  assert.equal(h.service.suppressionDecision({ conversationId: 'priority', accountId: 'account-muted' }).reason, 'muted-account');
  assert.equal(h.service.suppressionDecision({ conversationId: 'priority', platform: 'telegram' }).reason, 'muted-platform');
});

test('OD-003 active conversation and global controls outrank priority contacts', () => {
  const h = harness({ priorityConversations: ['priority'] });
  h.service.setWindowState({ visible: true, focused: true, minimized: false, activeConversationId: 'priority' });
  assert.equal(h.service.suppressionDecision({ conversationId: 'priority' }).reason, 'active-conversation');
  h.service.setSettings({ paused: true });
  assert.equal(h.service.suppressionDecision({ conversationId: 'priority' }).reason, 'paused');
  h.service.setSettings({ enabled: false, paused: false });
  assert.equal(h.service.suppressionDecision({ conversationId: 'priority' }).reason, 'disabled');
});
