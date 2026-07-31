'use strict';

const test = require('node:test');
const assert = require('node:assert');
const is = require('../../installer/installSteps');
const rl = require('../../electron/m2/releaseLayout');

const norm = (p) => String(p).split('\\').join('/');

test('computeStalePaths returns the M6-derived stale set under installDir', () => {
  const stale = is.computeStalePaths('C:/Users/me/AppData/Local/Yance').map(norm);
  assert.deepStrictEqual(stale, [
    'C:/Users/me/AppData/Local/Yance/resources/app',
    'C:/Users/me/AppData/Local/Yance/resources/app.asar',
    'C:/Users/me/AppData/Local/Yance/resources/app.asar.unpacked',
    'C:/Users/me/AppData/Local/Yance/resources/runtime'
  ]);
});

test('computeStalePaths stays in sync with the M6 production layout', () => {
  // The stale set must cover the production app/runtime dirs the contract declares.
  const stale = is.computeStalePaths('X').map(norm);
  const prodResolved = rl.resolveLayoutPaths('production', { resourcesPath: 'X/resources' });
  assert.ok(stale.includes(norm(prodResolved.appRoot)), 'app dir is in stale set');
  assert.ok(stale.includes('X/resources/runtime'), 'runtime dir is in stale set');
});

test('verifyInstalledTree delegates to M6 production validation', () => {
  const existsSync = (p) => !/[\\/]backend[\\/]desktopHostedEntry\.js$/.test(p);
  const res = is.verifyInstalledTree('C:/Yance', { existsSync });
  assert.strictEqual(res.valid, false);
  assert.deepStrictEqual(res.missingKeys, ['backendEntry']);
});

test('verifyInstalledTree valid when all required present', () => {
  const res = is.verifyInstalledTree('C:/Yance', { existsSync: () => true });
  assert.strictEqual(res.valid, true);
  assert.strictEqual(res.missingKeys.length, 0);
});

test('parseTasklist detects current Yance.exe', () => {
  const out = [
    'Image Name                     PID Session Name        Session#    Mem Usage',
    '========================= ======== ================ =========== ============',
    'Yance.exe                   1234 Console                    1     45,678 K',
    'node.exe                      5678 Console                    1     12,345 K'
  ].join('\n');
  assert.strictEqual(is.parseTasklist(out), true);
});

test('parseTasklist detects legacy migration-only executable during upgrade', () => {
  assert.strictEqual(is.parseTasklist('Yance29.exe                   1234 Console                    1     45,678 K'), true);
});

test('parseTasklist returns false when not running', () => {
  assert.strictEqual(is.parseTasklist('INFO: No tasks are running with the specified criteria.'), false);
  assert.strictEqual(is.parseTasklist(''), false);
});

test('isInstallBlockedByRunning policy', () => {
  assert.strictEqual(is.isInstallBlockedByRunning({ running: false }), false);
  assert.strictEqual(is.isInstallBlockedByRunning({ running: true, allowAutoStop: false }), true);
  assert.strictEqual(is.isInstallBlockedByRunning({ running: true, allowAutoStop: true }), false);
});

test('decideUpgradePath: INSTALL / STOP_THEN_INSTALL / BLOCK', () => {
  assert.deepStrictEqual(is.decideUpgradePath({ running: false }), { action: 'INSTALL', blocked: false });
  assert.deepStrictEqual(is.decideUpgradePath({ running: true, allowAutoStop: true }), { action: 'STOP_THEN_INSTALL', blocked: false });
  assert.deepStrictEqual(is.decideUpgradePath({ running: true, allowAutoStop: false }), { action: 'BLOCK', blocked: true });
});
