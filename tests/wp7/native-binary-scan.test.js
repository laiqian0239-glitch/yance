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

test('native binary gate records exact node-pty ConPTY win10-arm64 resources as inert for Windows x64', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-native-scan-'));
  const directory = path.join(root, 'resources', 'app', 'node_modules', 'node-pty', 'third_party', 'conpty', '1.23.251008001', 'win10-arm64');
  fs.mkdirSync(directory, { recursive: true });
  const arm64Pe = Buffer.alloc(128); arm64Pe[0] = 0x4d; arm64Pe[1] = 0x5a; arm64Pe.writeUInt32LE(0x40, 0x3c); arm64Pe.write('PE\0\0', 0x40, 'ascii'); arm64Pe.writeUInt16LE(0xaa64, 0x44);
  fs.writeFileSync(path.join(directory, 'OpenConsole.exe'), arm64Pe);
  fs.writeFileSync(path.join(directory, 'conpty.dll'), arm64Pe);
  const result = verifyNativeBinaries({ payloadRoot: root, evidenceFile: path.join(root, 'native-evidence.json'), targetPlatform: 'win32', targetArch: 'x64' });
  assert.equal(result.status, 'PASS');
  assert.equal(result.inertForeignVariantCount, 2);
  assert.equal(result.targetLoadableFileCount, 0);
  assert.deepEqual(result.records.map((row) => row.loadDisposition), ['INERT_FOREIGN_TARGET_VARIANT', 'INERT_FOREIGN_TARGET_VARIANT']);
});

test('native binary gate keeps exact node-pty ConPTY win10-x64 resources target-qualified and fail closed', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-native-scan-'));
  const directory = path.join(root, 'resources', 'app', 'node_modules', 'node-pty', 'third_party', 'conpty', '1.23.251008001', 'win10-x64');
  fs.mkdirSync(directory, { recursive: true });
  const x64Pe = Buffer.alloc(128); x64Pe[0] = 0x4d; x64Pe[1] = 0x5a; x64Pe.writeUInt32LE(0x40, 0x3c); x64Pe.write('PE\0\0', 0x40, 'ascii'); x64Pe.writeUInt16LE(0x8664, 0x44);
  fs.writeFileSync(path.join(directory, 'OpenConsole.exe'), x64Pe);
  fs.writeFileSync(path.join(directory, 'conpty.dll'), x64Pe);
  const green = verifyNativeBinaries({ payloadRoot: root, evidenceFile: path.join(root, 'native-evidence.json'), targetPlatform: 'win32', targetArch: 'x64' });
  assert.equal(green.status, 'PASS');
  assert.deepEqual(green.records.map((row) => row.loadDisposition), ['TARGET_QUALIFIED_VARIANT', 'TARGET_QUALIFIED_VARIANT']);

  const x86Pe = Buffer.from(x64Pe); x86Pe.writeUInt16LE(0x14c, 0x44);
  fs.writeFileSync(path.join(directory, 'conpty.dll'), x86Pe);
  const red = verifyNativeBinaries({ payloadRoot: root, evidenceFile: path.join(root, 'native-evidence-red.json'), targetPlatform: 'win32', targetArch: 'x64' });
  assert.equal(red.status, 'FAIL');
  assert.match(JSON.stringify(red), /WP7_NATIVE_MACHINE_NOT_X64/);
});

test('native binary gate records exact pip vendored distlib foreign launchers as inert for Windows x64', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-native-scan-'));
  const directory = path.join(root, 'resources', 'parlant-runtime', 'python', 'Lib', 'site-packages', 'pip', '_vendor', 'distlib');
  fs.mkdirSync(directory, { recursive: true });
  const writePe = (name, machine) => {
    const pe = Buffer.alloc(128); pe[0] = 0x4d; pe[1] = 0x5a; pe.writeUInt32LE(0x40, 0x3c); pe.write('PE\0\0', 0x40, 'ascii'); pe.writeUInt16LE(machine, 0x44);
    fs.writeFileSync(path.join(directory, name), pe);
  };
  writePe('t32.exe', 0x14c);
  writePe('t64-arm.exe', 0xaa64);
  writePe('w32.exe', 0x14c);
  writePe('w64-arm.exe', 0xaa64);
  const result = verifyNativeBinaries({ payloadRoot: root, evidenceFile: path.join(root, 'native-evidence.json'), targetPlatform: 'win32', targetArch: 'x64' });
  assert.equal(result.status, 'PASS');
  assert.equal(result.inertForeignVariantCount, 4);
  assert.equal(result.targetLoadableFileCount, 0);
  assert.deepEqual(result.records.map((row) => row.loadDisposition), Array(4).fill('INERT_FOREIGN_TARGET_VARIANT'));
});

test('native binary gate keeps exact pip vendored distlib x64 launchers target-qualified and fail closed', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-native-scan-'));
  const directory = path.join(root, 'resources', 'parlant-runtime', 'python', 'Lib', 'site-packages', 'pip', '_vendor', 'distlib');
  fs.mkdirSync(directory, { recursive: true });
  const x64Pe = Buffer.alloc(128); x64Pe[0] = 0x4d; x64Pe[1] = 0x5a; x64Pe.writeUInt32LE(0x40, 0x3c); x64Pe.write('PE\0\0', 0x40, 'ascii'); x64Pe.writeUInt16LE(0x8664, 0x44);
  fs.writeFileSync(path.join(directory, 't64.exe'), x64Pe);
  fs.writeFileSync(path.join(directory, 'w64.exe'), x64Pe);
  const green = verifyNativeBinaries({ payloadRoot: root, evidenceFile: path.join(root, 'native-evidence.json'), targetPlatform: 'win32', targetArch: 'x64' });
  assert.equal(green.status, 'PASS');
  assert.deepEqual(green.records.map((row) => row.loadDisposition), ['TARGET_QUALIFIED_VARIANT', 'TARGET_QUALIFIED_VARIANT']);

  const arm64Pe = Buffer.from(x64Pe); arm64Pe.writeUInt16LE(0xaa64, 0x44);
  fs.writeFileSync(path.join(directory, 'w64.exe'), arm64Pe);
  const red = verifyNativeBinaries({ payloadRoot: root, evidenceFile: path.join(root, 'native-evidence-red.json'), targetPlatform: 'win32', targetArch: 'x64' });
  assert.equal(red.status, 'FAIL');
  assert.match(JSON.stringify(red), /WP7_NATIVE_MACHINE_NOT_X64/);
});

test('native binary gate does not classify deceptive node-pty or distlib near-matches as foreign variants', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-native-scan-'));
  const nodePtyNearMatch = path.join(root, 'resources', 'app', 'node_modules', 'node-pty-copy', 'third_party', 'conpty', '1.23.251008001', 'win10-arm64', 'OpenConsole.exe');
  const distlibNearMatch = path.join(root, 'resources', 'parlant-runtime', 'python', 'Lib', 'site-packages', 'pip', '_vendor', 'distlib', 'custom-arm.exe');
  fs.mkdirSync(path.dirname(nodePtyNearMatch), { recursive: true });
  fs.mkdirSync(path.dirname(distlibNearMatch), { recursive: true });
  const arm64Pe = Buffer.alloc(128); arm64Pe[0] = 0x4d; arm64Pe[1] = 0x5a; arm64Pe.writeUInt32LE(0x40, 0x3c); arm64Pe.write('PE\0\0', 0x40, 'ascii'); arm64Pe.writeUInt16LE(0xaa64, 0x44);
  fs.writeFileSync(nodePtyNearMatch, arm64Pe);
  fs.writeFileSync(distlibNearMatch, arm64Pe);
  const result = verifyNativeBinaries({ payloadRoot: root, evidenceFile: path.join(root, 'native-evidence.json'), targetPlatform: 'win32', targetArch: 'x64' });
  assert.equal(result.status, 'FAIL');
  assert.equal(result.failureCount, 2);
  assert.equal(result.inertForeignVariantCount, 0);
  assert.match(JSON.stringify(result), /WP7_NATIVE_MACHINE_NOT_X64/);
});

test('native binary gate classifies exact Setuptools launcher architectures under the sealed Learning runtime', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-native-scan-'));
  const directory = path.join(root, 'resources', 'learning-runtime', 'venv', 'Lib', 'site-packages', 'setuptools');
  fs.mkdirSync(directory, { recursive: true });
  const writePe = (name, machine) => {
    const pe = Buffer.alloc(128); pe[0] = 0x4d; pe[1] = 0x5a; pe.writeUInt32LE(0x40, 0x3c); pe.write('PE\0\0', 0x40, 'ascii'); pe.writeUInt16LE(machine, 0x44);
    fs.writeFileSync(path.join(directory, name), pe);
  };
  writePe('cli.exe', 0x14c);
  writePe('cli-32.exe', 0x14c);
  writePe('cli-64.exe', 0x8664);
  writePe('cli-arm64.exe', 0xaa64);
  writePe('gui.exe', 0x14c);
  writePe('gui-32.exe', 0x14c);
  writePe('gui-64.exe', 0x8664);
  writePe('gui-arm64.exe', 0xaa64);

  const result = verifyNativeBinaries({ payloadRoot: root, evidenceFile: path.join(root, 'native-evidence.json'), targetPlatform: 'win32', targetArch: 'x64' });
  assert.equal(result.status, 'PASS');
  assert.equal(result.inertForeignVariantCount, 6);
  assert.equal(result.targetLoadableFileCount, 2);
  assert.deepEqual(
    result.records.filter((row) => /(?:cli-64|gui-64)\.exe$/u.test(row.relativePath)).map((row) => [row.loadDisposition, row.peMachine]),
    [['TARGET_QUALIFIED_VARIANT', 'x64'], ['TARGET_QUALIFIED_VARIANT', 'x64']]
  );
  assert.deepEqual(
    result.records.filter((row) => !/(?:cli-64|gui-64)\.exe$/u.test(row.relativePath)).map((row) => row.loadDisposition),
    Array(6).fill('INERT_FOREIGN_TARGET_VARIANT')
  );
});
