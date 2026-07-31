'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { AppUpdater } = require('electron-updater/out/AppUpdater');
const metadata = require('../../electron/updateMetadata');

const ROOT = path.resolve(__dirname, '../..');

test('electron-updater 6.8.9 public contract exposes downloadUpdate but not invented metadata methods', () => {
  assert.strictEqual(typeof AppUpdater.prototype.downloadUpdate, 'function');
  for (const invented of ['getLatestYml', 'getBlockMapData', 'downloadedFile']) {
    assert.strictEqual(typeof AppUpdater.prototype[invented], 'undefined', `${invented} must not be treated as public API`);
  }
});

test('installed electron-updater type contract carries downloadedFile on update-downloaded event', () => {
  const dts = fs.readFileSync(require.resolve('electron-updater/out/types.d.ts'), 'utf8');
  assert.match(dts, /interface\s+UpdateDownloadedEvent\s+extends\s+UpdateInfo\s*\{[\s\S]*downloadedFile:\s*string/);
  const appUpdaterDts = fs.readFileSync(require.resolve('electron-updater/out/AppUpdater.d.ts'), 'utf8');
  assert.match(appUpdaterDts, /downloadUpdate\([^)]*\):\s*Promise<Array<string>>/);
});

test('production update manager contains no calls to non-public updater APIs', () => {
  const source = fs.readFileSync(path.join(ROOT, 'electron/updateManager.js'), 'utf8');
  assert.doesNotMatch(source, /\.getLatestYml\s*\(/);
  assert.doesNotMatch(source, /\.getBlockMapData\s*\(/);
  assert.doesNotMatch(source, /\.downloadedFile\s*\(/);
  assert.match(source, /info\?\.downloadedFile/);
  assert.match(source, /await\s+this\.updater\.downloadUpdate\(\)/);
});

test('UpdateInfo files metadata normalization selects the real NSIS installer asset', () => {
  const info = metadata.normalizeUpdateInfo({
    version: '29.2.7',
    releaseDate: '2026-07-14T00:00:00.000Z',
    publicVersion: '1.0.0',
    releaseName: '言策 1.0.0',
    files: [
      { url: 'notes.txt', size: 10, sha512: 'notes' },
      { url: 'https://github.com/example/Yance-Setup-1.0.0-x64.exe', size: 100, sha512: 'installer' }
    ]
  });
  assert.strictEqual(info.version, '29.2.7');
  assert.strictEqual(info.publicVersion, '1.0.0');
  assert.strictEqual(info.file.fileName, 'Yance-Setup-1.0.0-x64.exe');
  assert.strictEqual(info.file.size, 100);
  assert.strictEqual(info.file.sha512, 'installer');
});

test('available/downloaded metadata comparison rejects silent feed drift', () => {
  const available = metadata.normalizeUpdateInfo({ version: '29.2.7', files: [{ url: 'setup.exe', size: 100, sha512: 'a' }] });
  const downloaded = metadata.normalizeUpdateInfo({ version: '29.2.7', files: [{ url: 'setup.exe', size: 100, sha512: 'b' }] });
  const result = metadata.compareUpdateMetadata(available, downloaded);
  assert.strictEqual(result.ok, false);
  assert.ok(result.reasons.includes('sha512 mismatch'));
});
