'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { verifyNativeBinaries } = require('../../tools/wp7/verify-native-binaries');

test('native binary gate rejects ELF .node files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-native-scan-'));
  const target = path.join(root, 'resources', 'app', 'node_modules', 'bad', 'bad.node');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01]));
  const result = verifyNativeBinaries({ payloadRoot: root, evidenceFile: path.join(root, 'native-evidence.json') });
  assert.equal(result.status, 'FAIL');
  assert.match(JSON.stringify(result), /WP7_NATIVE_ELF_FORBIDDEN/);
});

test('native binary gate rejects better-sqlite3 residue', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-native-scan-'));
  const target = path.join(root, 'resources', 'app', 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const pe = Buffer.alloc(128); pe[0] = 0x4d; pe[1] = 0x5a; pe.writeUInt32LE(0x40, 0x3c); pe.write('PE\0\0', 0x40, 'ascii'); pe.writeUInt16LE(0x8664, 0x44);
  fs.writeFileSync(target, pe);
  const result = verifyNativeBinaries({ payloadRoot: root, evidenceFile: path.join(root, 'native-evidence.json') });
  assert.equal(result.status, 'FAIL');
  assert.match(JSON.stringify(result), /WP7_BETTER_SQLITE3_RESIDUE_FORBIDDEN/);
});

test('native binary gate records foreign prebuild variants as inert while enforcing the Windows x64 target variant', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-native-scan-'));
  const foreign = path.join(root, 'resources', 'app', 'node_modules', 'fixture', 'prebuilds', 'linux-x64', 'fixture.node');
  const target = path.join(root, 'resources', 'app', 'node_modules', 'fixture', 'prebuilds', 'win32-x64', 'fixture.node');
  fs.mkdirSync(path.dirname(foreign), { recursive: true });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const elf = Buffer.alloc(64); elf[0] = 0x7f; elf[1] = 0x45; elf[2] = 0x4c; elf[3] = 0x46; elf[4] = 2; elf[5] = 1; elf.writeUInt16LE(62, 18);
  const pe = Buffer.alloc(128); pe[0] = 0x4d; pe[1] = 0x5a; pe.writeUInt32LE(0x40, 0x3c); pe.write('PE\0\0', 0x40, 'ascii'); pe.writeUInt16LE(0x8664, 0x44);
  fs.writeFileSync(foreign, elf);
  fs.writeFileSync(target, pe);
  const result = verifyNativeBinaries({ payloadRoot: root, evidenceFile: path.join(root, 'native-evidence.json'), targetPlatform: 'win32', targetArch: 'x64' });
  assert.equal(result.status, 'PASS');
  assert.equal(result.inertForeignVariantCount, 1);
  assert.equal(result.targetLoadableFileCount, 1);
  assert.equal(result.records.find((row) => row.relativePath.includes('/linux-x64/')).loadDisposition, 'INERT_FOREIGN_TARGET_VARIANT');
  assert.equal(result.records.find((row) => row.relativePath.includes('/win32-x64/')).peMachine, 'x64');
});

test('native binary gate rejects a non-x64 target-qualified Windows prebuild', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-native-scan-'));
  const target = path.join(root, 'resources', 'app', 'node_modules', 'fixture', 'prebuilds', 'win32-x64', 'fixture.node');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const pe = Buffer.alloc(128); pe[0] = 0x4d; pe[1] = 0x5a; pe.writeUInt32LE(0x40, 0x3c); pe.write('PE\0\0', 0x40, 'ascii'); pe.writeUInt16LE(0x14c, 0x44);
  fs.writeFileSync(target, pe);
  const result = verifyNativeBinaries({ payloadRoot: root, evidenceFile: path.join(root, 'native-evidence.json'), targetPlatform: 'win32', targetArch: 'x64' });
  assert.equal(result.status, 'FAIL');
  assert.match(JSON.stringify(result), /WP7_NATIVE_MACHINE_NOT_X64/);
});
