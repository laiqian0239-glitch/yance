'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');

test('Electron keeps one Tray and one authoritative sound-notification event path', () => {
  const main = read('electron/main.js');
  assert.equal((main.match(/new Tray\s*\(/g) || []).length, 1);
  assert.match(main, /new SoundNotificationService\s*\(/);
  assert.match(main, /sound-notification:event/);
  assert.doesNotMatch(main, /event\.type === 'desktop:notify'\) showNotification/);
  const presenterStart = main.indexOf('async function showNotification');
  const presenterEnd = main.indexOf('function createSoundWindow', presenterStart);
  const presenter = main.slice(presenterStart, presenterEnd);
  assert.doesNotMatch(presenter, /requestDesktopSound/);
  assert.match(presenter, /silent:\s*true/);
});

test('existing tray is reused for unread state while native minimize stays on the taskbar', () => {
  const main = read('electron/main.js');
  assert.match(main, /function presentTrayUnread/);
  assert.match(main, /tray\.setImage/);
  assert.match(main, /createdWindow\.on\('minimize'/);
  assert.match(main, /preserveTaskbarOnMinimize\(createdWindow\)/);
  assert.match(main, /hideWindowToTray\(createdWindow, event\)/);
  assert.match(main, /function showMainWindow/);
  assert.match(main, /restoreWindowTaskbar\(window\)/);
});

test('forced previews bypass renderer throttling and native fallback keeps the selected pattern', () => {
  const player = read('electron/sound-player.js');
  const main = read('electron/main.js');
  assert.match(player, /payload\.force !== true && now - lastPlayedAt < 650/);
  assert.match(main, /requestWindowsNativeSound\(\{ \.\.\.payload, pattern: serviceResult\.pattern \|\| kind \}\)/);
});

test('all selectable sound patterns are backed by valid WAV resources', () => {
  const files = [
    'yance-message.wav',
    'yance-message-soft.wav',
    'yance-message-crystal.wav',
    'yance-message-chime.wav',
    'yance-message-pulse.wav',
    'yance-message-sent.wav',
    'yance-send-failed.wav',
    'yance-contact-online.wav',
    'yance-contact-offline.wav',
    'yance-task-complete.wav',
    'yance-warning-low.wav'
  ];
  for (const file of files) {
    const value = fs.readFileSync(path.join(ROOT, 'frontend/assets/sounds', file));
    assert.equal(value.subarray(0, 4).toString('ascii'), 'RIFF', file);
    assert.equal(value.subarray(8, 12).toString('ascii'), 'WAVE', file);
    assert.ok(value.length > 1000, file);
  }
});

test('settings and contact controls route through existing UI surfaces', () => {
  const schema = require('../../electron/desktopSettingsSchema');
  assert.equal(schema.DEFAULTS.minimizeToTray, false);
  assert.equal(schema.normalizeDesktopSettings({ minimizeToTray: true }).minimizeToTray, false);
  assert.ok(schema.DESKTOP_SETTING_KEYS.includes('minimizeToTray'));
  const recovery = read('frontend/r32-settings-recovery.js');
  for (const value of ['open-system-notifications','__Y27SystemCenter','state.soundCatalog','save-media']) assert.match(recovery, new RegExp(value));
  assert.doesNotMatch(recovery, /data-action=\"save-notify\"/);
  const soundAuthority = require('../../shared/notificationSoundCatalog');
  assert.equal(soundAuthority.soundCatalog().patterns.length, 136);
  assert.equal(soundAuthority.soundCatalog().events.length, 5);
  const systemCenter = read('frontend/r32-system-center.js');
  assert.match(systemCenter, /notificationSoundCatalog\(\)\.events\.map/);
  for (const value of ['incomingSoundEnabled','outgoingSoundEnabled','failureSoundEnabled','presenceSoundEnabled','preview-sound']) assert.match(systemCenter, new RegExp(value));
  assert.deepEqual(soundAuthority.soundCatalog().events.map(row => row.settingKey), ['incomingSoundPattern','outgoingSoundPattern','failureSoundPattern','presenceOnlineSoundPattern','presenceOfflineSoundPattern']);
  const conversation = read('frontend/js/r32-conversation-capabilities.js');
  for (const label of ['静音此联系人','设为重点联系人','试听新消息声音']) assert.match(conversation, new RegExp(label));
});

test('backend publishes raw unified input before compatibility desktop notification', () => {
  const policy = read('backend/services/notificationPolicy.js');
  const raw = policy.indexOf("eventBus.publish('sound-notification:event'");
  const legacy = policy.indexOf("eventBus.publish('desktop:notify'", raw);
  assert.ok(raw >= 0);
  assert.ok(legacy > raw);
  assert.match(policy, /priorityConversations/);
});

test('active conversation suppression is driven by the existing renderer IPC and window focus state', () => {
  const main = read('electron/main.js');
  const preload = read('electron/preload.js');
  const conversation = read('frontend/js/r32-conversation-capabilities.js');
  const service = read('electron/SoundNotificationService.js');
  assert.match(preload, /setActiveConversation:\s*conversationId\s*=>\s*ipcRenderer\.invoke\('desktop:set-active-conversation'/);
  assert.match(main, /(?:ipcMain\.handle|ipcGuardHandle)\('desktop:set-active-conversation'/);
  assert.match(conversation, /yance:r32-active-conversation-changed/);
  assert.match(service, /activeConversationVisible/);
  assert.match(service, /reason = 'active-conversation'/);
  assert.match(service, /SUPPRESSION_PRECEDENCE/);
});
