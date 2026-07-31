'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ISOLATED_BACKEND_AUTHORITY_KEYS, isolatedBackendEnvironment } = require('../../tools/wp4/isolated-backend-environment');

test('isolated WP4 backend environment strips external runtime authority paths before overrides', () => {
  const source = {
    PATH: 'C:/Windows/System32',
    WORKBUDDY_DATA_DIR: 'C:/real/workbuddy',
    YANCE_LEGACY_DATA_DIR: 'C:/real/Yance29',
    YANCE_PRIMARY_SQLITE_PATH: 'C:/real/yance.db',
    YANCE_SETTINGS_SQLITE_PATH: 'C:/real/settings.db',
    YANCE_RUNTIME_MUTEX_NAME: 'Local\\RealOwner',
    YANCE_DATA_DIR: 'C:/real/current'
  };
  const isolated = isolatedBackendEnvironment({ YANCE_DATA_DIR: 'C:/temp/case' }, source);
  assert.equal(isolated.PATH, source.PATH);
  assert.equal(isolated.YANCE_DATA_DIR, 'C:/temp/case');
  for (const key of ISOLATED_BACKEND_AUTHORITY_KEYS) assert.equal(Object.hasOwn(isolated, key), false, key);
});

test('explicit override may intentionally provide a stripped key after isolation', () => {
  const isolated = isolatedBackendEnvironment({ YANCE_LEGACY_DATA_DIR: 'C:/explicit/legacy' }, {
    YANCE_LEGACY_DATA_DIR: 'C:/inherited/legacy'
  });
  assert.equal(isolated.YANCE_LEGACY_DATA_DIR, 'C:/explicit/legacy');
});

test('all real WP4 isolated backend probes use the scrubbed environment helper', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const root = path.resolve(__dirname, '../..');
  for (const relative of [
    'tools/wp4/desktop-credential-application-lifecycle-matrix.js',
    'tools/wp4/production-credential-runtime.js',
    'tools/wp4/backend-owner-exit-probe.js'
  ]) {
    const source = fs.readFileSync(path.join(root, relative), 'utf8');
    assert.match(source, /isolatedBackendEnvironment\s*\(/, relative);
    assert.equal(/env:\s*\{\s*\.\.\.process\.env,\s*YANCE_DATA_DIR/.test(source), false, relative);
  }
});
