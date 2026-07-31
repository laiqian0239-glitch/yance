'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const serviceText = fs.readFileSync(path.join(ROOT, 'backend/services/portableBackupService.js'), 'utf8');
const mainText = fs.readFileSync(path.join(ROOT, 'electron/main.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'electron/m2/ipcManifest.json'), 'utf8'));

test('new portable backups use the unnumbered .yancebackup extension', () => {
  assert.match(serviceText, /const PORTABLE_EXTENSION = '\.yancebackup'/);
  assert.match(serviceText, /Yance-\$\{stamp\}-\$\{label\}-\$\{profile\}\$\{PORTABLE_EXTENSION\}/);
  assert.match(mainText, /-import-\$\{Date\.now\(\)\}\.yancebackup/);
  assert.match(mainText, /保存言策可迁移备份/);
  assert.match(mainText, /extensions: \['yancebackup'\]/);
});

test('legacy numbered backup extensions are accepted only for import compatibility', () => {
  assert.match(serviceText, /LEGACY_PORTABLE_EXTENSIONS = Object\.freeze\(\['\.yance28backup', '\.yance32backup'\]\)/);
  assert.match(mainText, /导入言策可迁移备份/);
  assert.match(mainText, /extensions: \['yancebackup', 'yance28backup', 'yance32backup'\]/);
  assert.doesNotMatch(mainText, /-import-\$\{Date\.now\(\)\}\.yance(?:28|32)backup/);

  const saveChannel = manifest.handlers?.find?.(entry => entry.channel === 'desktop:save-portable-backup');
  assert.ok(saveChannel, 'desktop:save-portable-backup manifest entry is required');
  assert.match(saveChannel.inputSchema.properties.packageName.pattern, /yancebackup/);
  assert.match(saveChannel.inputSchema.properties.packageName.pattern, /yance28backup/);
  assert.match(saveChannel.inputSchema.properties.packageName.pattern, /yance32backup/);
});

test('migration-facing labels and errors do not expose numbered historical product brands', () => {
  for (const relative of [
    'backend/migrations/legacySqliteMigrator.js',
    'backend/services/migrationService.js',
    'electron/desktopHost/LegacyRuntimeCutoverGate.js',
    'backend/runtime/RuntimeAuthorityMigrationCoordinator.js'
  ]) {
    const text = fs.readFileSync(path.join(ROOT, relative), 'utf8');
    assert.doesNotMatch(text, /言策26|Yance27 (?:backend owner|source changed|legacy migration|runtime source|runtime mode)/i, `${relative} exposes a numbered historical brand in migration-facing text`);
  }
});
