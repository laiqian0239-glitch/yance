'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const gov = require('../../electron/m2/nativeBinaryGovernance');

// Canned runtime probes (Node 22 -> moduleVersion 127, Node 24 -> 137).
const NODE22 = { version: 'v22.16.0', moduleVersion: 127, platform: 'win32', arch: 'x64' };
const NODE24 = { version: 'v24.0.0', moduleVersion: 137, platform: 'win32', arch: 'x64' };

function napiAddon(over = {}) {
  return { relativePath: 'node_modules/bufferutil/prebuilds/win32-x64/bufferutil.node', abiIndependent: true, platform: 'win32', arch: 'x64', ...over };
}
function versionBoundAddon(requiredModuleVersion, over = {}) {
  return { relativePath: 'node_modules/oldaddon/build/Release/old.node', abiIndependent: false, requiredModuleVersion, platform: 'win32', arch: 'x64', ...over };
}

test('M8-1 probeRuntimeNode ok parses moduleVersion', () => {
  const r = gov.probeRuntimeNode({ nodeExePath: 'C:/runtime/node.exe', runNode: () => NODE22 });
  assert.equal(r.ok, true);
  assert.equal(r.moduleVersion, 127);
  assert.equal(r.platform, 'win32');
  assert.equal(r.nodeVersion, '22.16.0');
});

test('M8-2 probeRuntimeNode missing path is not ok', () => {
  const r = gov.probeRuntimeNode({ nodeExePath: '' });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'NODE_RUNTIME_PATH_MISSING');
});

test('M8-3 probeRuntimeNode propagates probe failure', () => {
  const boom = new Error('spawn ENOENT');
  boom.reasonCode = 'NODE_PROBE_FAILED';
  const r = gov.probeRuntimeNode({ nodeExePath: 'X:/missing.exe', runNode: () => { throw boom; } });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'NODE_PROBE_FAILED');
});

test('M8-4 classifyAddon NAPI is ABI-independent', () => {
  const r = gov.classifyAddon(napiAddon(), { moduleVersion: 137 }, null);
  assert.equal(r.status, 'NAPI_COMPATIBLE');
});

test('M8-5 classifyAddon version-bound matching moduleVersion is COMPATIBLE', () => {
  const r = gov.classifyAddon(versionBoundAddon(127), { moduleVersion: 127 }, null);
  assert.equal(r.status, 'COMPATIBLE');
});

test('M8-6 classifyAddon version-bound mismatched moduleVersion is INCOMPATIBLE_ABI', () => {
  const r = gov.classifyAddon(versionBoundAddon(127), { moduleVersion: 137 }, null);
  assert.equal(r.status, 'INCOMPATIBLE_ABI');
  assert.match(r.detail, /127.*137/);
});

test('M8-7 classifyAddon missing file is MISSING', () => {
  const fsProbe = { exists: () => false, sha256: () => 'x' };
  const r = gov.classifyAddon(napiAddon(), { moduleVersion: 137 }, fsProbe);
  assert.equal(r.status, 'MISSING');
});

test('M8-8 classifyAddon hash mismatch is HASH_MISMATCH', () => {
  const fsProbe = { exists: () => true, sha256: () => 'actualhash' };
  const r = gov.classifyAddon(napiAddon({ expectedSha256: 'expectedhash' }), { moduleVersion: 137 }, fsProbe);
  assert.equal(r.status, 'HASH_MISMATCH');
  assert.equal(r.detail.actual, 'actualhash');
});

test('M8-9 evaluateNativeCompatibility all NAPI -> ACCEPT', () => {
  const r = gov.evaluateNativeCompatibility({ runtimeNode: { ok: true, ...NODE22 }, addons: [napiAddon(), napiAddon({ relativePath: 'node_modules/utf-8-validate/prebuilds/win32-x64/node.napi.node' })] });
  assert.equal(r.compatible, true);
  assert.equal(r.recommendation, 'ACCEPT');
  assert.equal(r.addons.length, 2);
});

test('M8-10 evaluateNativeCompatibility one INCOMPATIBLE_ABI -> REBUILD_REQUIRED', () => {
  const r = gov.evaluateNativeCompatibility({ runtimeNode: { ok: true, ...NODE24 }, addons: [napiAddon(), versionBoundAddon(127)] });
  assert.equal(r.compatible, false);
  assert.equal(r.recommendation, 'REBUILD_REQUIRED');
});

test('M8-11 evaluateNativeCompatibility one MISSING -> ROLLBACK_REQUIRED', () => {
  const fsProbe = { exists: rel => rel.includes('utf-8') ? false : true, sha256: () => 'x' };
  const r = gov.evaluateNativeCompatibility({ runtimeNode: { ok: true, ...NODE22 }, addons: [napiAddon(), napiAddon({ relativePath: 'node_modules/utf-8-validate/prebuilds/win32-x64/node.napi.node' })], fsProbe });
  assert.equal(r.recommendation, 'ROLLBACK_REQUIRED');
});

test('M8-12 evaluateNativeCompatibility runtime node unavailable -> ROLLBACK_REQUIRED', () => {
  const r = gov.evaluateNativeCompatibility({ runtimeNode: { ok: false, error: 'X' }, addons: [] });
  assert.equal(r.compatible, false);
  assert.equal(r.recommendation, 'ROLLBACK_REQUIRED');
});

test('M8-13 planRuntimeSwap returns slot/backup/4 steps', () => {
  const r = gov.planRuntimeSwap({ installDir: 'C:/Program Files/Yance' });
  assert.equal(r.runtimeSlot, 'node22');
  assert.ok(r.slotDir.replace(/\\/g, '/').endsWith('resources/runtime/node22'));
  assert.ok(r.backupDir.replace(/\\/g, '/').endsWith('resources/runtime/node22.bak'));
  assert.equal(r.steps.length, 4);
  assert.deepEqual(r.steps.map(s => s.op), ['VERIFY_EXISTS', 'BACKUP', 'PLACE_NEW', 'VERIFY_NEW']);
});

test('M8-14 verifyRollbackAvailable reflects backup presence', () => {
  const yesFs = { existsSync: p => String(p).endsWith('node22.bak'), statSync: () => ({ isDirectory: () => true }) };
  const noFs = { existsSync: () => false, statSync: () => ({ isDirectory: () => false }) };
  assert.equal(gov.verifyRollbackAvailable({ installDir: 'X', fs: yesFs }).available, true);
  assert.equal(gov.verifyRollbackAvailable({ installDir: 'X', fs: noFs }).available, false);
});

test('M8-15 decideRollback resolves final authority', () => {
  assert.equal(gov.decideRollback({ runtimeNodeOk: true, addonsCompatible: true, hasBackup: true }), 'KEEP_NEW');
  assert.equal(gov.decideRollback({ runtimeNodeOk: false, addonsCompatible: false, hasBackup: true }), 'ROLLBACK');
  assert.equal(gov.decideRollback({ runtimeNodeOk: false, addonsCompatible: false, hasBackup: false }), 'BLOCK');
});

test('M8-16 governRuntimeNodeNativeBinaries end-to-end (canned probe + fsProbe)', () => {
  const fsProbe = { exists: () => true, sha256: rel => 'sha-' + rel.length };
  const r = gov.governRuntimeNodeNativeBinaries('C:/runtime/node.exe', [napiAddon()], { runNode: () => NODE22, fsProbe });
  assert.equal(r.recommendation, 'ACCEPT');
  assert.equal(r.runtimeNode.moduleVersion, 127);
  assert.equal(r.addons[0].status, 'NAPI_COMPATIBLE');
});
