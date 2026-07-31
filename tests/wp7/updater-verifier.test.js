'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { mkdtempSync, writeFileSync, rmSync } = fs;
const crypto = require('node:crypto');
const {
  sha512File,
  peMachineFromFile,
  isExpectedExe,
  parseVersion,
  compareVersion,
  validateUpdatePackage,
  validateReleaseMetadata,
  REJECTION_REASONS
} = require('../../electron/updateVerifier');

function tmp() { return mkdtempSync(path.join(os.tmpdir(), 'upd-ver-'), { recursive: true }); }
function write(buf, name) { const d = tmp(); const p = path.join(d, name); writeFileSync(p, buf); return p; }

// minimal x64 PE (MZ + PE header, machine=0x8664)
function makeExe(machine = 0x8664) {
  const buf = Buffer.alloc(128);
  buf.write('MZ', 0, 'ascii');
  buf.writeUInt32LE(0x40, 0x3c); // e_lfanew -> 0x40
  buf.writeUInt32LE(0x00004550, 0x40); // PE\0\0
  buf.writeUInt16LE(machine, 0x44); // Machine
  return buf;
}

test('sha512File matches node crypto', () => {
  const p = write(Buffer.from('hello'), 'f.bin');
  const h = crypto.createHash('sha512').update(Buffer.from('hello')).digest('base64');
  assert.strictEqual(sha512File(p), h);
});

test('peMachineFromFile reads machine and rejects non-exe', () => {
  assert.strictEqual(peMachineFromFile(write(makeExe(0x8664), 'a.exe')), 0x8664);
  assert.strictEqual(peMachineFromFile(write(makeExe(0x014c), 'b.exe')), 0x014c);
  assert.strictEqual(peMachineFromFile(write(Buffer.from('notpe'), 'c.txt')), null);
  assert.strictEqual(isExpectedExe(write(Buffer.from('x'), 'x.exe')), true);
  assert.strictEqual(isExpectedExe(write(Buffer.from('x'), 'x.zip')), false);
});

test('version compare semantics', () => {
  assert.strictEqual(compareVersion('29.2.6', '29.2.5'), 1);
  assert.strictEqual(compareVersion('29.2.5', '29.2.6'), -1);
  assert.strictEqual(compareVersion('29.2.5', '29.2.5'), 0);
  assert.deepStrictEqual(parseVersion('29.2.6.0'), [29, 2, 6, 0]);
});

test('rejects non-installer file', () => {
  const f = write(Buffer.from('zip'), 'x.zip');
  const r = validateUpdatePackage({ filePath: f, expectedVersion: '29.2.6', currentVersion: '29.2.5' });
  assert.strictEqual(r.ok, false);
  assert.ok(r.reasons.includes(REJECTION_REASONS.NOT_INSTALLER));
});

test('rejects hash mismatch (tampered)', () => {
  const f = write(makeExe(), 'u.exe');
  const r = validateUpdatePackage({
    filePath: f,
    expectedSha512: 'deadbeef', // wrong
    expectedVersion: '29.2.6',
    currentVersion: '29.2.5',
    expectedArch: 'x64'
  });
  assert.strictEqual(r.ok, false);
  assert.ok(r.reasons.includes(REJECTION_REASONS.HASH_MISMATCH));
});

test('rejects downgrade', () => {
  const f = write(makeExe(), 'u.exe');
  const r = validateUpdatePackage({ filePath: f, expectedVersion: '29.2.4', currentVersion: '29.2.5' });
  assert.ok(r.reasons.includes(REJECTION_REASONS.DOWNGRADE));
});

test('rejects arch mismatch (manifest vs expected, or extracted exe x86)', () => {
  // (a) NSIS installer stub is always PE32 i386; this must NOT trip ARCH_MISMATCH.
  const stub = write(makeExe(0x014c), 'setup.exe'); // ia32 stub
  const rStub = validateUpdatePackage({ filePath: stub, expectedArch: 'x64', expectedVersion: '29.2.6', currentVersion: '29.2.5' });
  assert.ok(!rStub.reasons.includes(REJECTION_REASONS.ARCH_MISMATCH), 'NSIS stub PE must not trigger ARCH_MISMATCH');
  // (b) manifest arch mismatch is rejected.
  const f = write(makeExe(0x8664), 'u.exe');
  const rManifest = validateUpdatePackage({ filePath: f, expectedArch: 'x64', expectedManifestArch: 'ia32', expectedVersion: '29.2.6', currentVersion: '29.2.5' });
  assert.ok(rManifest.reasons.includes(REJECTION_REASONS.ARCH_MISMATCH));
  // (c) extracted packaged exe being x86 is rejected.
  const x86Exe = write(makeExe(0x014c), 'Yance.exe');
  const rExe = validateUpdatePackage({ filePath: f, expectedArch: 'x64', extractedExePath: x86Exe, expectedVersion: '29.2.6', currentVersion: '29.2.5' });
  assert.ok(rExe.reasons.includes(REJECTION_REASONS.ARCH_MISMATCH));
});

test('accepts valid package (development mode, unsigned ok)', () => {
  const f = write(makeExe(), 'u.exe');
  const sha = sha512File(f);
  const r = validateUpdatePackage({
    filePath: f,
    expectedSha512: sha,
    expectedVersion: '29.2.6',
    currentVersion: '29.2.5',
    expectedArch: 'x64',
    mode: 'development'
  });
  assert.strictEqual(r.ok, true, JSON.stringify(r));
});

test('production mode rejects unsigned exe', () => {
  const f = write(makeExe(), 'u.exe');
  const sha = sha512File(f);
  const r = validateUpdatePackage({
    filePath: f,
    expectedSha512: sha,
    expectedVersion: '29.2.6',
    currentVersion: '29.2.5',
    expectedArch: 'x64',
    mode: 'production',
    extractVersionInfo: () => ({ productName: '言策', publisher: '言策科技', signed: false })
  });
  assert.ok(r.reasons.includes(REJECTION_REASONS.SIGNATURE_INVALID));
});

test('production mode accepts valid signed identity', () => {
  const f = write(makeExe(), 'u.exe');
  const sha = sha512File(f);
  const r = validateUpdatePackage({
    filePath: f,
    expectedSha512: sha,
    expectedVersion: '29.2.6',
    currentVersion: '29.2.5',
    expectedArch: 'x64',
    mode: 'production',
    extractVersionInfo: () => ({ productName: '言策', publisher: '言策科技', signed: true })
  });
  assert.strictEqual(r.ok, true, JSON.stringify(r));
});

test('rejects product/publisher mismatch', () => {
  const f = write(makeExe(), 'u.exe');
  const sha = sha512File(f);
  const r = validateUpdatePackage({
    filePath: f, expectedSha512: sha, expectedVersion: '29.2.6', currentVersion: '29.2.5',
    expectedProductName: '言策', expectedPublisher: '言策科技', mode: 'production',
    extractVersionInfo: () => ({ productName: 'OtherApp', publisher: 'Evil', signed: true })
  });
  assert.ok(r.reasons.includes(REJECTION_REASONS.PRODUCT_MISMATCH));
  assert.ok(r.reasons.includes(REJECTION_REASONS.PUBLISHER_MISMATCH));
});

test('rejects blockmap / metadata inconsistency', () => {
  const f = write(makeExe(), 'u.exe');
  const sha = sha512File(f);
  const r = validateUpdatePackage({
    filePath: f, expectedSha512: sha, expectedVersion: '29.2.6', currentVersion: '29.2.5',
    expectedArch: 'x64', mode: 'development', blockmapConsistent: false, metadataConsistent: false
  });
  assert.ok(r.reasons.includes(REJECTION_REASONS.BLOCKMAP_MISMATCH));
  assert.ok(r.reasons.includes(REJECTION_REASONS.METADATA_MISMATCH));
});

test('validateReleaseMetadata binds resolved UpdateInfo to downloaded file', () => {
  const f = write(makeExe(), 'Yance-Setup-1.0.1-x64.exe');
  const metadata = {
    version: '29.2.6',
    file: { fileName: 'Yance-Setup-1.0.1-x64.exe', size: fs.statSync(f).size, sha512: sha512File(f) }
  };
  const ok = validateReleaseMetadata({ metadata, downloadedFilePath: f, metadataComparison: { ok: true, reasons: [] } });
  assert.strictEqual(ok.ok, true, JSON.stringify(ok));

  const bad = validateReleaseMetadata({
    metadata: { ...metadata, file: { ...metadata.file, size: metadata.file.size + 1 } },
    downloadedFilePath: f,
    metadataComparison: { ok: false, reasons: ['sha512 mismatch'] }
  });
  assert.strictEqual(bad.ok, false);
  assert.deepStrictEqual(bad.reasons, [REJECTION_REASONS.METADATA_MISMATCH]);
  assert.ok(bad.details.mismatches.includes('downloaded size mismatch'));
});

test('missing sha512 metadata is rejected rather than self-compared', () => {
  const f = write(makeExe(), 'Yance-Setup-1.0.1-x64.exe');
  const result = validateUpdatePackage({
    filePath: f, expectedSha512: '', expectedVersion: '29.2.6', currentVersion: '29.2.5', mode: 'development'
  });
  assert.ok(result.reasons.includes(REJECTION_REASONS.METADATA_MISMATCH));
});
