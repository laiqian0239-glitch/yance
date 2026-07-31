'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-custom-sound-'));
process.env.YANCE_DATA_DIR = dataRoot;

const ROOT = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const soundAuthority = require('../../shared/notificationSoundCatalog');
const customSounds = require('../../backend/services/customNotificationSoundService');
const notificationPolicy = require('../../backend/services/notificationPolicy');
const { SoundNotificationService } = require('../../electron/SoundNotificationService');

function sampleWav() {
  const buffer = Buffer.alloc(64);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(56, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(8000, 24);
  buffer.writeUInt32LE(16000, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(20, 40);
  return buffer;
}

test.after(() => {
  try { fs.rmSync(dataRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); } catch (_) {}
});

test('custom sound ids remain valid notification patterns and extend the catalog', () => {
  const id = 'custom-12345678-1234-4123-8123-123456789abc';
  assert.equal(soundAuthority.isCustomSoundPattern(id), true);
  assert.equal(soundAuthority.normalizeSoundPattern(id, 'message-in'), id);
  const catalog = soundAuthority.soundCatalog([{ id, label: '我的铃声', sizeBytes: 123 }]);
  assert.equal(catalog.schemaVersion, 3);
  assert.equal(catalog.patterns.length, 137);
  assert.equal(catalog.patterns.at(-1).custom, true);
  assert.deepEqual(catalog.upload.acceptedExtensions, ['wav', 'mp3', 'm4a', 'aac']);
});

test('uploaded WAV is content-validated, stored under the permanent data root and selectable', async () => {
  const created = await customSounds.createFromBuffer({
    buffer: sampleWav(),
    label: '我的测试音',
    originalFileName: 'my-alert.wav',
    mimeType: 'audio/wav'
  });
  assert.equal(created.duplicate, false);
  assert.match(created.item.id, /^custom-/);
  assert.equal(customSounds.exists(created.item.id), true);
  assert.ok(customSounds.resolvePath(created.item.id).startsWith(path.join(dataRoot, 'notification-sounds')));
  assert.equal(notificationPolicy.soundCatalog().patterns.length, 137);

  const settings = await notificationPolicy.update({ incomingSoundPattern: created.item.id });
  assert.equal(settings.incomingSoundPattern, created.item.id);

  const calls = [];
  const service = new SoundNotificationService({
    settings: { incomingSoundPattern: created.item.id },
    playSound: async payload => { calls.push(payload); return { played: true, pattern: payload.pattern }; }
  });
  const preview = await service.preview(created.item.id, 0.5);
  assert.equal(preview.played, true);
  assert.equal(calls[0].pattern, created.item.id);

  await notificationPolicy.clearCustomSoundReferences(created.item.id);
  await customSounds.remove(created.item.id);
  assert.equal(notificationPolicy.read().incomingSoundPattern, 'message-in');
  assert.equal(customSounds.exists(created.item.id), false);
});

test('fake audio and extension-content mismatch are rejected', async () => {
  await assert.rejects(
    customSounds.createFromBuffer({ buffer: Buffer.alloc(80, 7), originalFileName: 'fake.mp3', mimeType: 'audio/mpeg' }),
    error => error.code === 'CUSTOM_SOUND_FORMAT_UNRECOGNIZED'
  );
  await assert.rejects(
    customSounds.createFromBuffer({ buffer: sampleWav(), originalFileName: 'wrong.mp3', mimeType: 'audio/mpeg' }),
    error => error.code === 'CUSTOM_SOUND_EXTENSION_MISMATCH'
  );
});

test('upload, delete, playback and backup boundaries are wired across the product', () => {
  const route = read('backend/routes/system.js');
  const frontend = read('frontend/r32-system-center.js');
  const main = read('electron/main.js');
  const player = read('electron/sound-player.js');
  const backup = read('backend/services/backupService.js');
  const portable = read('backend/services/portableBackupService.js');

  assert.match(route, /router\.post\('\/notifications\/sounds', express\.raw/);
  assert.match(route, /router\.delete\('\/notifications\/sounds\/:id'/);
  assert.match(frontend, /uploadCustomNotificationSound/);
  assert.match(frontend, /deleteCustomNotificationSound/);
  assert.match(frontend, /accept="\.wav,\.mp3,\.m4a,\.aac/);
  assert.match(main, /pathToFileURL\(soundFile\)\.href/);
  assert.match(main, /DATA_ROOT, 'notification-sounds'/);
  assert.match(player, /custom-notification-sound-source-rejected/);
  assert.match(backup, /notificationSounds: PATHS\.notificationSounds/);
  assert.match(portable, /notificationSounds/);
});
