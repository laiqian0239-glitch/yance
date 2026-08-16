#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function sha256Buffer(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex'); }
function slash(value) { return String(value || '').split(path.sep).join('/'); }
function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== 'object' || Buffer.isBuffer(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortValue(value[key])]));
}
function canonicalBuffer(value) { return Buffer.from(`${JSON.stringify(sortValue(value), null, 2)}\n`, 'utf8'); }
function walk(directory, out = []) {
  if (!fs.existsSync(directory)) return out;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => Buffer.from(a.name).compare(Buffer.from(b.name)))) {
    const full = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      out.push(full);
      continue;
    }
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile()) out.push(full);
  }
  return out;
}
function readPeMachine(buffer) {
  if (buffer.length < 0x40 || buffer[0] !== 0x4d || buffer[1] !== 0x5a) return null;
  const peOffset = buffer.readUInt32LE(0x3c);
  if (peOffset + 6 > buffer.length) return null;
  if (buffer.toString('ascii', peOffset, peOffset + 4) !== 'PE\0\0') return null;
  return buffer.readUInt16LE(peOffset + 4);
}
function peMachineName(machine) {
  if (machine === 0x8664) return 'x64';
  if (machine === 0x14c) return 'x86';
  if (machine === 0xaa64) return 'arm64';
  return machine ? `0x${machine.toString(16)}` : 'unknown';
}
function readElfMachine(buffer) {
  if (buffer.length < 20 || buffer[0] !== 0x7f || buffer[1] !== 0x45 || buffer[2] !== 0x4c || buffer[3] !== 0x46) return null;
  const littleEndian = buffer[5] === 1;
  const bigEndian = buffer[5] === 2;
  if (!littleEndian && !bigEndian) return null;
  return littleEndian ? buffer.readUInt16LE(18) : buffer.readUInt16BE(18);
}
function elfMachineName(machine) {
  if (machine === 62) return 'x64';
  if (machine === 3) return 'x86';
  if (machine === 183) return 'arm64';
  return machine ? `0x${machine.toString(16)}` : 'unknown';
}
function normalizePlatformToken(value) {
  if (!value) return null;
  if (value === 'linuxmusl') return 'linux';
  if (value === 'win32' || value === 'linux' || value === 'darwin') return value;
  return null;
}
function inferNativeTargetFromPath(relativePath) {
  const normalized = slash(relativePath).toLowerCase();
  const prebuild = normalized.match(/\/prebuilds\/(win32|linux|linuxmusl|darwin)-(x64\+arm64|x64|ia32|arm64)(?:\/|$)/);
  if (prebuild) return { platform: normalizePlatformToken(prebuild[1]), platformVariant: prebuild[1], architectures: prebuild[2].split('+').map((arch) => arch === 'ia32' ? 'x86' : arch), source: 'prebuilds-directory' };
  const packageTarget = normalized.match(/\/node_modules\/@[^/]+\/[^/]*(win32|linux|linuxmusl|darwin)-(x64|ia32|arm64)(?:\/|$)/);
  if (packageTarget) return { platform: normalizePlatformToken(packageTarget[1]), platformVariant: packageTarget[1], architectures: [packageTarget[2] === 'ia32' ? 'x86' : packageTarget[2]], source: 'platform-qualified-package' };
  const nodePtyConpty = normalized.match(/\/node_modules\/node-pty\/third_party\/conpty\/[^/]+\/win10-(x64|arm64)\/(openconsole\.exe|conpty\.dll)$/);
  if (nodePtyConpty) return { platform: 'win32', platformVariant: `win10-${nodePtyConpty[1]}`, architectures: [nodePtyConpty[1]], source: 'node-pty-conpty-directory' };
  const distlibLauncher = normalized.match(/\/pip\/_vendor\/distlib\/(t32|t64|t64-arm|w32|w64|w64-arm)\.exe$/);
  if (distlibLauncher) {
    const launcher = distlibLauncher[1];
    const architecture = launcher.endsWith('32') ? 'x86' : launcher.endsWith('-arm') ? 'arm64' : 'x64';
    return { platform: 'win32', platformVariant: 'win32', architectures: [architecture], source: 'distlib-launcher-resource' };
  }
  const setuptoolsLauncher = normalized.match(/^resources\/learning-runtime\/venv\/lib\/site-packages\/setuptools\/(cli|gui)(?:-(32|64|arm64))?\.exe$/);
  if (setuptoolsLauncher) {
    const variant = setuptoolsLauncher[2] || '32';
    const architecture = variant === '64' ? 'x64' : variant === 'arm64' ? 'arm64' : 'x86';
    return { platform: 'win32', platformVariant: 'win32', architectures: [architecture], source: 'setuptools-launcher-resource' };
  }
  return null;
}
function detectedFormat(buffer) {
  if (buffer.length >= 4 && buffer[0] === 0x7f && buffer[1] === 0x45 && buffer[2] === 0x4c && buffer[3] === 0x46) return 'ELF';
  if (buffer.length >= 2 && buffer[0] === 0x4d && buffer[1] === 0x5a) return 'PE';
  const magic = buffer.length >= 4 ? buffer.readUInt32BE(0) : 0;
  if ([0xfeedface, 0xfeedfacf, 0xcafebabe, 0xcefaedfe, 0xcffaedfe, 0xbebafeca].includes(magic)) return 'MACH_O';
  return 'UNKNOWN';
}
function isTargetQualified(nativeTarget, targetPlatform, targetArch) {
  return nativeTarget && nativeTarget.platform === targetPlatform && nativeTarget.architectures.includes(targetArch);
}
function classifyNativeFile(file, payloadRoot, options = {}) {
  const targetPlatform = options.targetPlatform || 'win32';
  const targetArch = options.targetArch || 'x64';
  const relativePath = slash(path.relative(payloadRoot, file));
  const ext = path.extname(file).toLowerCase();
  const record = { relativePath, extension: ext, status: 'PASS', findings: [] };
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink()) {
    record.status = 'FAIL';
    record.findings.push({ reasonCode: 'WP7_NATIVE_SYMLINK_FORBIDDEN', message: 'native binary candidate cannot be a symbolic link' });
    return record;
  }
  const buffer = fs.readFileSync(file);
  record.sizeBytes = buffer.length;
  record.sha256 = sha256Buffer(buffer);
  record.binaryFormat = detectedFormat(buffer);
  const nativeTarget = inferNativeTargetFromPath(relativePath);
  if (nativeTarget) record.pathTarget = nativeTarget;

  if (/better[-_]sqlite3/i.test(relativePath) || /better_sqlite3\.node$/i.test(relativePath)) {
    record.status = 'FAIL';
    record.findings.push({ reasonCode: 'WP7_BETTER_SQLITE3_RESIDUE_FORBIDDEN', message: 'better-sqlite3 residue is forbidden in the node:sqlite production build' });
    return record;
  }

  if (nativeTarget && !isTargetQualified(nativeTarget, targetPlatform, targetArch)) {
    record.loadDisposition = 'INERT_FOREIGN_TARGET_VARIANT';
    return record;
  }
  record.loadDisposition = nativeTarget ? 'TARGET_QUALIFIED_VARIANT' : 'UNQUALIFIED_TARGET_LOAD_PATH';

  if (targetPlatform === 'win32') {
    if (record.binaryFormat === 'ELF') {
      record.status = 'FAIL';
      record.findings.push({ reasonCode: 'WP7_NATIVE_ELF_FORBIDDEN', message: 'Windows target-loadable native binary is Linux ELF, not Windows PE' });
    } else if (record.binaryFormat !== 'PE') {
      record.status = 'FAIL';
      record.findings.push({ reasonCode: 'WP7_NATIVE_NOT_PE', message: 'Windows target-loadable native binary is not a Windows PE image' });
    } else {
      const machine = readPeMachine(buffer);
      record.peMachine = peMachineName(machine);
      if (targetArch !== 'x64' || machine !== 0x8664) {
        record.status = 'FAIL';
        record.findings.push({ reasonCode: 'WP7_NATIVE_MACHINE_NOT_X64', message: 'Windows target-loadable native binary must be Windows x64 PE' });
      }
    }
  } else if (targetPlatform === 'linux') {
    if (record.binaryFormat !== 'ELF') {
      record.status = 'FAIL';
      record.findings.push({ reasonCode: 'WP7_NATIVE_NOT_ELF', message: 'Linux target-loadable native binary is not an ELF image' });
    } else {
      const machine = readElfMachine(buffer);
      record.elfMachine = elfMachineName(machine);
      if (targetArch !== 'x64' || machine !== 62) {
        record.status = 'FAIL';
        record.findings.push({ reasonCode: 'WP7_NATIVE_MACHINE_NOT_X64', message: 'Linux target-loadable native binary must be Linux x64 ELF' });
      }
    }
  } else {
    record.status = 'FAIL';
    record.findings.push({ reasonCode: 'WP7_NATIVE_TARGET_PLATFORM_UNSUPPORTED', message: 'native binary scan target platform is unsupported' });
  }
  return record;
}
function scanNativeBinaries(options = {}) {
  const payloadRoot = fs.realpathSync(path.resolve(options.payloadRoot || 'application-payload'));
  const targetPlatform = options.targetPlatform || 'win32';
  const targetArch = options.targetArch || 'x64';
  const generatedAtUtc = String(options.generatedAtUtc || new Date(0).toISOString());
  const files = walk(payloadRoot).filter((file) => ['.node', '.dll', '.exe'].includes(path.extname(file).toLowerCase()));
  const records = files.map((file) => classifyNativeFile(file, payloadRoot, { targetPlatform, targetArch })).sort((a, b) => Buffer.from(a.relativePath).compare(Buffer.from(b.relativePath)));
  const failures = records.filter((row) => row.status !== 'PASS');
  return {
    schemaVersion: 2,
    documentType: 'YANCE_WP7_NATIVE_BINARY_SCAN',
    generatedAtUtc,
    payloadRootRelative: '.',
    targetPlatform,
    targetArch,
    status: failures.length ? 'FAIL' : 'PASS',
    fileCount: records.length,
    targetLoadableFileCount: records.filter((row) => row.loadDisposition !== 'INERT_FOREIGN_TARGET_VARIANT').length,
    inertForeignVariantCount: records.filter((row) => row.loadDisposition === 'INERT_FOREIGN_TARGET_VARIANT').length,
    failureCount: failures.length,
    records
  };
}
function verifyNativeBinaries(options = {}) {
  const payloadRoot = path.resolve(options.payloadRoot || process.argv[2] || 'application-payload');
  const evidenceFile = path.resolve(options.evidenceFile || path.join(payloadRoot, 'resources', 'evidence', 'native-binary-scan.json'));
  const evidence = scanNativeBinaries({
    payloadRoot,
    targetPlatform: options.targetPlatform || 'win32',
    targetArch: options.targetArch || 'x64',
    generatedAtUtc: options.generatedAtUtc || new Date(0).toISOString()
  });
  if (options.writeEvidence !== false) {
    fs.mkdirSync(path.dirname(evidenceFile), { recursive: true });
    fs.writeFileSync(evidenceFile, canonicalBuffer(evidence), { mode: 0o600 });
  }
  return evidence;
}
if (require.main === module) {
  const result = verifyNativeBinaries({ payloadRoot: process.argv[2], evidenceFile: process.argv[3], targetPlatform: 'win32', targetArch: 'x64', generatedAtUtc: new Date().toISOString() });
  if (result.status !== 'PASS') {
    process.stderr.write(JSON.stringify(result, null, 2));
    process.exitCode = 1;
  } else {
    process.stdout.write(`${JSON.stringify({ status: result.status, fileCount: result.fileCount, targetLoadableFileCount: result.targetLoadableFileCount, inertForeignVariantCount: result.inertForeignVariantCount, evidence: 'resources/evidence/native-binary-scan.json' })}\n`);
  }
}
module.exports = {
  canonicalBuffer,
  classifyNativeFile,
  inferNativeTargetFromPath,
  readElfMachine,
  readPeMachine,
  scanNativeBinaries,
  sha256Buffer,
  verifyNativeBinaries
};
