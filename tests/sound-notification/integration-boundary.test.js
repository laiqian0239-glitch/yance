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

test('official built-in sound patterns use the seven-slot Yance Classic Electron asset family', () => {
  const files = [
    'yance-classic-message-in.wav',
    'yance-classic-message-sent.wav',
    'yance-classic-send-failed.wav',
    'yance-classic-contact-online.wav',
    'yance-classic-contact-offline.wav',
    'yance-classic-task-complete.wav',
    'yance-classic-warning-low.wav'
  ];
  for (const file of files) {
    const value = fs.readFileSync(path.join(ROOT, 'electron/assets/sounds', file));
    assert.equal(value.subarray(0, 4).toString('ascii'), 'RIFF', file);
    assert.equal(value.subarray(8, 12).toString('ascii'), 'WAVE', file);
    assert.ok(value.length > 1000, file);
  }

  const soundAuthority = require('../../shared/notificationSoundCatalog');
  const catalog = soundAuthority.soundCatalog();
  assert.equal(catalog.patterns.length, 7);
  assert.equal(catalog.events.length, 5);
  assert.equal(catalog.library.builtInCount, 7);
  assert.equal(catalog.library.originalCount, 7);
  assert.equal(catalog.library.importedCount, 0);
  assert.ok(catalog.patterns.every(row => row.group === 'Yance Classic' && row.family === 'Yance Classic' && row.pack === 'Yance Classic'));
  assert.deepEqual(catalog.events.map(row => row.settingKey), ['incomingSoundPattern','outgoingSoundPattern','failureSoundPattern','presenceOnlineSoundPattern','presenceOfflineSoundPattern']);
});

test('notification policy remains the business settings authority and custom UUID sound fallback stays supported', () => {
  const policy = read('backend/services/notificationPolicy.js');
  const soundAuthority = require('../../shared/notificationSoundCatalog');
  const customId = 'custom-12345678-1234-4123-8123-123456789abc';
  assert.match(policy, /incomingSoundPattern/);
  assert.match(policy, /presenceOfflineSoundPattern/);
  assert.equal(soundAuthority.normalizeSoundPattern(customId), customId);
  assert.equal(soundAuthority.soundFileName(customId), '');
  assert.equal(soundAuthority.normalizeSoundPattern('qq-message', 'message-in'), 'message-in');
  const customCatalog = soundAuthority.soundCatalog([{ id: customId, originalFileName: 'mine.wav' }]);
  assert.equal(customCatalog.patterns.some(row => row.id === customId && row.custom === true), true);
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
