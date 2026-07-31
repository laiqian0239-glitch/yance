'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const catalogAuthority = require('../../shared/notificationSoundCatalog');
const notificationPolicy = require('../../backend/services/notificationPolicy');
const soundServiceModule = require('../../electron/SoundNotificationService');

const repoRoot = path.resolve(__dirname, '..', '..');

function source(file) {
  return fs.readFileSync(path.join(repoRoot, file), 'utf8');
}

test('one notification sound catalog owns all selectable patterns and event mappings', () => {
  const catalog = catalogAuthority.soundCatalog();
  assert.equal(catalog.authority, 'NotificationSoundAuthority');
  assert.equal(catalog.patterns.length, 136);
  assert.equal(new Set(catalog.patterns.map(row => row.id)).size, catalog.patterns.length);
  assert.equal(catalog.events.length, 5);
  assert.deepEqual(catalog.events.map(row => row.settingKey), [
    'incomingSoundPattern',
    'outgoingSoundPattern',
    'failureSoundPattern',
    'presenceOnlineSoundPattern',
    'presenceOfflineSoundPattern'
  ]);
  for (const event of catalog.events) {
    assert.ok(catalog.patterns.some(row => row.id === event.defaultPattern), `${event.id} default must exist`);
    assert.ok(event.label && event.description && event.enabledKey);
  }
});

test('backend policy and Electron playback normalize against the same authority', () => {
  assert.deepEqual(notificationPolicy.SOUND_PATTERNS, catalogAuthority.SOUND_PATTERNS);
  assert.deepEqual(soundServiceModule.SOUND_PATTERNS, catalogAuthority.SOUND_PATTERNS);
  assert.equal(notificationPolicy.normalizeSoundPattern('message-crystal'), 'message-crystal');
  assert.equal(soundServiceModule.normalizeSoundPattern('message-crystal'), 'message-crystal');
  assert.equal(notificationPolicy.normalizeSoundPattern('not-real', 'send-failed'), 'send-failed');
  assert.equal(soundServiceModule.normalizeSoundPattern('not-real', 'send-failed'), 'send-failed');
  assert.equal(soundServiceModule.DEFAULT_SETTINGS.incomingSoundPattern, catalogAuthority.DEFAULT_EVENT_PATTERNS.incomingSoundPattern);
});

test('notification API and overview expose the catalog instead of a frontend hardcoded copy', () => {
  const route = source('backend/routes/system.js');
  const service = source('backend/services/systemCenterService.js');
  const recovery = source('frontend/r32-settings-recovery.js');
  assert.match(route, /soundCatalog: notificationPolicy\.soundCatalog\(\)/u);
  assert.match(service, /soundCatalog: notificationPolicy\.soundCatalog\(\)/u);
  assert.doesNotMatch(recovery, /const SOUND_OPTIONS=/u);
  assert.match(recovery, /state\.soundCatalog=notification\.soundCatalog/u);
  assert.match(recovery, /state\.soundCatalog\?\.patterns/u);
});

test('system center is the complete formal sound selection surface', () => {
  const ui = source('frontend/r32-system-center.js');
  const css = source('frontend/r32-system-center.css');
  assert.match(ui, /notificationSoundCatalog\(\)\.events\.map/u);
  assert.match(ui, /data-sc-sound-key/u);
  assert.match(ui, /data-sc-action="preview-sound"/u);
  assert.match(ui, /incomingSoundEnabled/u);
  assert.match(ui, /outgoingSoundEnabled/u);
  assert.match(ui, /failureSoundEnabled/u);
  assert.match(ui, /presenceSoundEnabled/u);
  assert.match(ui, /window\.yanceDesktop\?\.playSound[\s\S]*pattern, force: true/u);
  assert.match(css, /\.sc32-sound-picker/u);
});

test('saved event patterns remain distinct in the real sound notification service', () => {
  const calls = [];
  const service = new soundServiceModule.SoundNotificationService({
    settings: {
      incomingSoundPattern: 'message-crystal',
      outgoingSoundPattern: 'message-soft',
      failureSoundPattern: 'warning-low',
      presenceOnlineSoundPattern: 'task-complete',
      presenceOfflineSoundPattern: 'message-pulse'
    },
    playSound: async payload => { calls.push(payload); return { played: true, ...payload }; }
  });
  assert.equal(service.selectedSoundPattern('message-in'), 'message-crystal');
  assert.equal(service.selectedSoundPattern('message-sent'), 'message-soft');
  assert.equal(service.selectedSoundPattern('send-failed'), 'warning-low');
  assert.equal(service.selectedSoundPattern('contact-online'), 'task-complete');
  assert.equal(service.selectedSoundPattern('contact-offline'), 'message-pulse');
  service.dispose();
  assert.deepEqual(calls, []);
});
