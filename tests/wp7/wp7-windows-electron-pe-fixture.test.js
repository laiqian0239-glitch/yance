'use strict';

// Regression coverage for the WP7 Windows Electron fixture and the native-binary
// gate. The fake Windows electron.exe MUST be a deterministic minimal x64 PE so
// the production native-binary scanner (which is intentionally NOT weakened)
// accepts it, and fakeElectronOfficialRecords() must bind to the exact same bytes.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const {
  windowsFakeElectronExecutableBytes,
  fakeElectronExecutableBytes,
  fakeElectronOfficialRecords,
  createFakeElectronDist
} = require('./helpers');
const {
  readPeMachine,
  classifyNativeFile,
  scanNativeBinaries
} = require('../../tools/wp7/verify-native-binaries');

function tmp(prefix) { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }
function sha256(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex'); }
// Derive the scanner's detected format via its own public classifier, so the
// test binds to production detection logic rather than reimplementing it.
function detectedFormatViaScanner(bytes, name) {
  const root = tmp('wp7-fmt-');
  const payload = path.join(root, 'p');
  fs.mkdirSync(payload, { recursive: true });
  const file = path.join(payload, name || 'probe.exe');
  fs.writeFileSync(file, bytes);
  return classifyNativeFile(file, payload, { targetPlatform: 'win32', targetArch: 'x64' }).binaryFormat;
}

// x86 PE (machine 0x14c) — must remain rejected for a win32/x64 target.
function x86PeBytes() {
  const peOffset = 0x40;
  const buffer = Buffer.alloc(peOffset + 24, 0);
  buffer[0] = 0x4d; buffer[1] = 0x5a;
  buffer.writeUInt32LE(peOffset, 0x3c);
  buffer.write('PE\0\0', peOffset, 'binary');
  buffer.writeUInt16LE(0x14c, peOffset + 4); // IMAGE_FILE_MACHINE_I386
  return buffer;
}
// Minimal ELF x64 — an ELF masquerading as .exe must remain rejected on Windows.
function elfBytes() {
  const buffer = Buffer.alloc(64, 0);
  buffer[0] = 0x7f; buffer[1] = 0x45; buffer[2] = 0x4c; buffer[3] = 0x46; // \x7fELF
  buffer[5] = 1; // little-endian
  buffer.writeUInt16LE(62, 18); // EM_X86_64
  return buffer;
}

test('1. generated Windows fixture is detected as PE', () => {
  const bytes = windowsFakeElectronExecutableBytes();
  assert.equal(detectedFormatViaScanner(bytes), 'PE');
  assert.equal(bytes[0], 0x4d);
  assert.equal(bytes[1], 0x5a);
});

test('2. readPeMachine() returns 0x8664 for the fixture', () => {
  const bytes = windowsFakeElectronExecutableBytes();
  assert.equal(readPeMachine(bytes), 0x8664);
});

test('3. native scan accepts the fixture executable for win32/x64', () => {
  const root = tmp('wp7-pe-accept-');
  const payload = path.join(root, 'payload');
  fs.mkdirSync(payload, { recursive: true });
  fs.writeFileSync(path.join(payload, 'Yance.exe'), windowsFakeElectronExecutableBytes());
  const record = classifyNativeFile(path.join(payload, 'Yance.exe'), payload, { targetPlatform: 'win32', targetArch: 'x64' });
  assert.equal(record.status, 'PASS', JSON.stringify(record.findings));
  assert.equal(record.binaryFormat, 'PE');
  assert.equal(record.peMachine, 'x64');
  const scan = scanNativeBinaries({ payloadRoot: payload, targetPlatform: 'win32', targetArch: 'x64' });
  assert.equal(scan.status, 'PASS');
  assert.equal(scan.failureCount, 0);
});

test('4. corrupt text .exe, x86 PE .exe, and ELF .exe remain rejected on win32/x64', () => {
  const root = tmp('wp7-pe-reject-');
  const payload = path.join(root, 'payload');
  fs.mkdirSync(payload, { recursive: true });
  fs.writeFileSync(path.join(payload, 'text.exe'), 'fixture-electron-runtime');
  fs.writeFileSync(path.join(payload, 'x86.exe'), x86PeBytes());
  fs.writeFileSync(path.join(payload, 'elf.exe'), elfBytes());

  const text = classifyNativeFile(path.join(payload, 'text.exe'), payload, { targetPlatform: 'win32', targetArch: 'x64' });
  assert.equal(text.status, 'FAIL');
  assert.ok(text.findings.some((f) => f.reasonCode === 'WP7_NATIVE_NOT_PE'));

  const x86 = classifyNativeFile(path.join(payload, 'x86.exe'), payload, { targetPlatform: 'win32', targetArch: 'x64' });
  assert.equal(x86.status, 'FAIL');
  assert.ok(x86.findings.some((f) => f.reasonCode === 'WP7_NATIVE_MACHINE_NOT_X64'));

  const elf = classifyNativeFile(path.join(payload, 'elf.exe'), payload, { targetPlatform: 'win32', targetArch: 'x64' });
  assert.equal(elf.status, 'FAIL');
  assert.ok(elf.findings.some((f) => f.reasonCode === 'WP7_NATIVE_ELF_FORBIDDEN'));

  const scan = scanNativeBinaries({ payloadRoot: payload, targetPlatform: 'win32', targetArch: 'x64' });
  assert.equal(scan.status, 'FAIL');
  assert.equal(scan.failureCount, 3);
});

test('5. fakeElectronOfficialRecords binds to the exact fixture bytes', () => {
  const bytes = fakeElectronExecutableBytes('win32');
  const records = fakeElectronOfficialRecords('win32');
  const exe = records.find((r) => r.path === 'electron.exe');
  assert.ok(exe, 'electron.exe official record must exist on win32');
  assert.equal(exe.sizeBytes, bytes.length);
  assert.equal(exe.sha256, sha256(bytes));
});

test('6. createFakeElectronDist writes bytes matching the official record on win32', () => {
  const root = tmp('wp7-dist-');
  const dist = createFakeElectronDist(root, 'win32');
  const onDisk = fs.readFileSync(path.join(dist, 'electron.exe'));
  const records = fakeElectronOfficialRecords('win32');
  const exe = records.find((r) => r.path === 'electron.exe');
  assert.equal(onDisk.length, exe.sizeBytes);
  assert.equal(sha256(onDisk), exe.sha256);
  assert.equal(detectedFormatViaScanner(onDisk), 'PE');
  assert.equal(readPeMachine(onDisk), 0x8664);
});

test('7. non-Windows fixture stays plain text (unchanged Linux behavior)', () => {
  const bytes = fakeElectronExecutableBytes('linux');
  assert.equal(bytes.toString('utf8'), 'fixture-electron-runtime');
  assert.notEqual(detectedFormatViaScanner(bytes), 'PE');
});
