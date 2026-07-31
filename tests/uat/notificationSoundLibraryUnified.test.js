'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const catalogAuthority = require('../../shared/notificationSoundCatalog');
const importedLibrary = require('../../shared/notificationSoundLibrary.json');
const audit = require('../../governance/notification-sound-library-import-20260724.json');

const ROOT = path.resolve(__dirname, '..', '..');
const SOUND_ROOT = path.join(ROOT, 'frontend', 'assets', 'sounds');

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

test('unified library imports only validated unique audio and keeps the original Yance library', () => {
  const catalog = catalogAuthority.soundCatalog();
  assert.equal(catalog.schemaVersion, 3);
  assert.equal(catalog.library.originalCount, 11);
  assert.equal(catalog.library.importedCount, 125);
  assert.equal(catalog.library.builtInCount, 136);
  assert.equal(catalog.library.duplicateEntriesRemoved, 143);
  assert.equal(catalog.library.invalidEntriesRejected, 3);
  assert.equal(catalog.library.deduplicated, true);
  assert.equal(importedLibrary.patterns.length, 125);
  assert.equal(audit.result, 'PASS');
  assert.equal(audit.executablesCopied, undefined);
  assert.equal(audit.security.executablesCopied, 0);
  assert.equal(audit.security.dllsCopied, 0);
  assert.equal(audit.security.scriptsCopied, 0);
});

test('every built-in pattern resolves to one distinct packaged PCM WAV asset', () => {
  const ids = new Set();
  const files = new Set();
  const hashes = new Set();
  for (const row of catalogAuthority.SOUND_OPTIONS) {
    assert.ok(row.id && !ids.has(row.id), `duplicate sound id: ${row.id}`);
    ids.add(row.id);
    const fileName = catalogAuthority.soundFileName(row.id);
    assert.ok(fileName && !files.has(fileName), `duplicate sound file mapping: ${fileName}`);
    files.add(fileName);
    const file = path.join(SOUND_ROOT, fileName);
    assert.ok(fs.existsSync(file), `missing sound asset: ${fileName}`);
    const data = fs.readFileSync(file);
    assert.equal(data.subarray(0, 4).toString('ascii'), 'RIFF', fileName);
    assert.equal(data.subarray(8, 12).toString('ascii'), 'WAVE', fileName);
    assert.ok(data.length > 1000, fileName);
    const hash = sha256(data);
    assert.ok(!hashes.has(hash), `duplicate audio content: ${fileName}`);
    hashes.add(hash);
  }
  assert.equal(ids.size, 136);
  assert.equal(files.size, 136);
  assert.equal(hashes.size, 136);
});

test('the imported library exposes grouped, event-aware metadata without archive paths', () => {
  const catalog = catalogAuthority.soundCatalog();
  const imported = catalog.patterns.filter(row => row.imported === true);
  assert.equal(imported.length, 125);
  assert.ok(imported.some(row => row.group === 'QQ · 消息'));
  assert.ok(imported.some(row => row.group === '微信 · 消息'));
  assert.ok(imported.some(row => row.recommendedEvents.includes('incoming')));
  assert.ok(imported.some(row => row.recommendedEvents.includes('outgoing')));
  for (const row of imported) {
    assert.ok(row.label && row.group && row.family && row.role);
    assert.equal(Object.prototype.hasOwnProperty.call(row, 'sourcePath'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(row, 'sourceContentSha256'), false);
  }
});

test('sound player and settings UI accept the expanded authority instead of hardcoded copies', () => {
  const main = fs.readFileSync(path.join(ROOT, 'electron', 'main.js'), 'utf8');
  const player = fs.readFileSync(path.join(ROOT, 'electron', 'sound-player.js'), 'utf8');
  const center = fs.readFileSync(path.join(ROOT, 'frontend', 'r32-system-center.js'), 'utf8');
  assert.match(main, /soundFileName\(normalized, 'message-in'\)/u);
  assert.doesNotMatch(main, /const SOUND_FILE_BY_KIND/u);
  assert.match(player, /\^\[a-z0-9\]\[a-z0-9-\]/u);
  assert.match(center, /renderSoundLibrarySummary/u);
  assert.match(center, /row\.recommendedEvents\.includes\(eventId\)/u);
  assert.match(center, /notificationSoundOptions\(selected, event\.id\)/u);
});
