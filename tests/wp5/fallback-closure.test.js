'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const safeModeService = require('../../backend/services/safeModeService');
const { normalize, BOOLEAN_KEYS } = require('../../shared/desktopSettings');

test('safeModeService is read-only and reflects only the bound runtime authority', () => {
  safeModeService.bindAuthority(() => ({ operatingMode: 'safeMode', updatedAtUtc: '2026-07-05T00:00:00.000Z' }));
  assert.equal(safeModeService.isActive(), true);
  assert.equal(safeModeService.read().authority, 'runtime_state.operating_mode');
  assert.throws(() => safeModeService.enter({}), error => error.code === 'SAFE_MODE_COMPATIBILITY_WRITE_FORBIDDEN');
  assert.throws(() => safeModeService.clear({}), error => error.code === 'SAFE_MODE_COMPATIBILITY_WRITE_FORBIDDEN');
});

test('desktop settings discard legacy safeMode and cannot persist it', () => {
  assert.equal(BOOLEAN_KEYS.includes('safeMode'), false);
  const value = normalize({ safeMode: true, autoLaunch: true });
  assert.equal(Object.prototype.hasOwnProperty.call(value, 'safeMode'), false);
  assert.equal(value.autoLaunch, true);
});

test('production startup and discovery contain no executable safe-mode environment fallback or broad legacy scan', () => {
  const server = fs.readFileSync(path.resolve(__dirname, '../../backend/server.js'), 'utf8');
  const backendDiscovery = fs.readFileSync(path.resolve(__dirname, '../../backend/services/legacyRootDiscovery.js'), 'utf8');
  const electronDiscovery = fs.readFileSync(path.resolve(__dirname, '../../electron/legacyDataRoots.js'), 'utf8');
  assert.equal(server.includes('process.env.YANCE_SAFE_MODE'), false);
  assert.equal(server.includes('safeModeService.enter'), false);
  assert.equal(backendDiscovery.includes('process.env.YANCE_LEGACY_DATA_DIRS'), false);
  assert.equal(electronDiscovery.includes('process.env.YANCE_LEGACY_DATA_DIRS'), false);
  assert.equal(backendDiscovery.includes('KNOWN_ROOT_NAME'), false);
  assert.equal(electronDiscovery.includes('KNOWN_ROOT_NAME'), false);
});
