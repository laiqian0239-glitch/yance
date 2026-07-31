'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tk = require('../../tools/wp10/devToolkit');

const NODE22 = { version: 'v22.16.0', moduleVersion: 127, platform: 'win32', arch: 'x64' };

test('M10-1 validateLayoutContract production valid when all present', () => {
  const existsSync = () => true;
  const r = tk.validateLayoutContract({ mode: 'production', cwd: 'C:/app', existsSync });
  assert.equal(r.valid, true);
  assert.equal(r.missing.length, 0);
});

test('M10-2 validateLayoutContract reports missing keys', () => {
  const existsSync = p => !String(p).includes('node.exe');
  const r = tk.validateLayoutContract({ mode: 'production', cwd: 'C:/app', existsSync });
  assert.equal(r.valid, false);
  assert.ok(r.missing.includes('nodeRuntime'));
});

test('M10-3 validateLayoutContract dev mode resolves', () => {
  const existsSync = () => true;
  const r = tk.validateLayoutContract({ mode: 'dev', cwd: '/repo', existsSync });
  assert.equal(r.mode, 'dev');
  assert.equal(r.valid, true);
});

test('M10-4 validateIpcManifestDenylist passes when rebuild-native present', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'm10-'));
  const manifestPath = path.join(dir, 'ipcManifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify({ denylist: [{ action: 'rebuild-native' }] }));
  const r = tk.validateIpcManifestDenylist({ manifestPath });
  assert.equal(r.valid, true);
  assert.equal(r.rebuildNativeDenied, true);
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

test('M10-5 validateIpcManifestDenylist fails when rebuild-native absent', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'm10-'));
  const manifestPath = path.join(dir, 'ipcManifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify({ denylist: [{ action: 'kill-process' }] }));
  const r = tk.validateIpcManifestDenylist({ manifestPath });
  assert.equal(r.valid, false);
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

test('M10-6 validateNativeGovernance reports ACCEPT for NAPI addons', () => {
  const r = tk.validateNativeGovernance({ nodeExePath: 'X:/node.exe', runNode: () => NODE22 });
  assert.equal(r.valid, true);
  assert.equal(r.recommendation, 'ACCEPT');
});

test('M10-7 validateContracts aggregates allValid', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'm10-'));
  const manifestPath = path.join(dir, 'ipcManifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify({ denylist: [{ action: 'rebuild-native' }] }));
  const r = tk.validateContracts({ existsSync: () => true, manifestPath, runNode: () => NODE22 });
  assert.equal(r.contracts.length, 3);
  assert.equal(r.allValid, true);
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

test('M10-8 diagnose healthy when gate passes and native ok', () => {
  const fakeRunAll = () => ({ gate: { passed: true, passedCount: 8, failedCount: 0, skippedCount: 2 } });
  const health = tk.diagnose({ runAll: fakeRunAll, runNode: () => NODE22 });
  assert.equal(health.healthy, true);
  assert.equal(health.nativeGovernance.recommendation, 'ACCEPT');
});

test('M10-9 diagnose not healthy when gate fails', () => {
  const fakeRunAll = () => ({ gate: { passed: false, passedCount: 7, failedCount: 1, skippedCount: 2, headlessFailed: ['M2'] } });
  const health = tk.diagnose({ runAll: fakeRunAll, runNode: () => NODE22 });
  assert.equal(health.healthy, false);
});

test('M10-10 formatContracts renders PASS/FAIL + OVERALL', () => {
  const r = tk.validateContracts({ existsSync: () => true, runNode: () => NODE22 });
  const md = tk.formatContracts(r);
  assert.match(md, /release-layout/);
  assert.match(md, /OVERALL: PASS/);
});
