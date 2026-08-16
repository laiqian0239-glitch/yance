'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');
const { REPO_ROOT, RISK_IDS, UPSTREAM_ACCEPTED_BINDINGS, sha256File, writeCanonicalJson } = require('../../tools/wp7/lib');
function temp(prefix) { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }
function expectReason(assert, fn, reasonCode) {
  assert.throws(fn, (error) => error && error.reasonCode === reasonCode, `expected ${reasonCode}`);
}
function identityTuple(seed = 'a') {
  const hash = seed.repeat(64).slice(0, 64);
  return {
    frozenSourceCommit: '1'.repeat(40), frozenSourceTree: '2'.repeat(40), buildSessionId: 'session-1',
    buildId: 'YANCE-test', productVersion: '29.2.5', stageVersion: '6.4.5.9', manifestSha256: hash,
    installerSha256: hash, releaseManifestSha256: hash, applicationPayloadSha256: hash, payloadFilesSha256: hash
  };
}
function finalEvidenceDocument(overrides = {}) {
  const hash = 'a'.repeat(64);
  return {
    schemaVersion: 3,
    documentType: 'WP7_TEST_FINAL_EVIDENCE',
    stage: '6.4.5.9',
    phase: 'core-runtime-p1',
    workPackage: 'WP7',
    evidenceKind: 'TEST',
    evidenceClass: 'FINAL_MACHINE_READABLE',
    status: 'PASS',
    generatedAtUtc: '2026-07-05T00:00:00.000Z',
    frozenSourceCommit: '1'.repeat(40),
    frozenSourceTree: '2'.repeat(40),
    buildSessionId: 'session-1',
    buildId: 'YANCE-test',
    productVersion: '29.2.5',
    stageVersion: '6.4.5.9',
    distributionMode: 'LOCAL_PRIVATE_UNSIGNED',
    apiContractVersion: 2,
    credentialProtocolVersion: 3,
    runtimeLockProtocolVersion: 1,
    databaseSchemaVersion: 1,
    releaseManifestSha256: hash,
    applicationPayloadSha256: hash,
    applicationPayloadFilesystemIdentitySha256: hash,
    payloadFilesSha256: hash,
    productionDependencyBindingSha256: hash,
    productionDependencyPackageGraphSha256: hash,
    productionDependencyFileTreeSha256: hash,
    productionDependencyModeTreeSha256: hash,
    productionDependencyDirectoryModeTreeSha256: hash,
    productionDependencyFileModePolicy: 'POSIX_0777_EXACT_NO_GROUP_OR_WORLD_WRITE_V1',
    productionDependencyDirectoryModePolicy: 'POSIX_DIRECTORY_0777_EXACT_OWNER_RX_NO_GROUP_OR_WORLD_WRITE_V1',
    productionDependencyPackageCount: 1,
    productionDependencyFileCount: 1,
    productionDependencyModeRecordCount: 1,
    productionDependencyDirectoryCount: 1,
    productionDependencyDirectoryModeRecordCount: 1,
    gitPayloadModeTreeSha256: hash,
    gitPayloadModeRecordCount: 1,
    electronDistributionTreeSha256: hash,
    electronDistributionFileCount: 1,
    electronDistributionModeBoundFileCount: 1,
    nodeRuntimeVersion: '22.23.1',
    nodeRuntimeExecutablePath: 'runtime/node22/node',
    nodeRuntimeExecutableSha256: hash,
    nodeRuntimeTreeSha256: hash,
    nativeBinaryScanSha256: hash,
    nativeBinaryFileCount: 1,
    nativeBinaryFailureCount: 0,
    nativeBinaryTargetPlatform: 'linux',
    nativeBinaryTargetArch: 'x64',
    nodeRuntimeFileCount: 1,
    nodeRuntimeModeBoundFileCount: 1,
    installerFileName: 'Yance-Setup-29.2.5-x64.exe',
    installerSizeBytes: 123,
    installerSha256: hash,
    upstreamBindings: JSON.parse(JSON.stringify(UPSTREAM_ACCEPTED_BINDINGS)),
    inheritedRiskAcceptances: RISK_IDS.map((id) => ({ id, scopeExpansionAllowed: false })),
    assertions: [],
    reasonCodes: [],
    finalInstallationMode: 'CLEAN_INSTALL',
    legacyTestDataMigrationRequired: false,
    legacyTestVersionRollbackRequired: false,
    completeProjectSourceTreeSha256: hash,
    ...overrides
  };
}
function cloneCurrentRepository() {
  const root = temp('wp7-repo-clone-');
  const repo = path.join(root, 'repo');
  const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
  const sourceBranch = execFileSync('git', ['branch', '--show-current'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
  const args = ['-c', 'core.autocrlf=false', '-c', 'core.eol=lf', 'clone', '--no-hardlinks', '--config', 'core.autocrlf=false', '--config', 'core.eol=lf'];
  if (sourceBranch) args.push('--branch', sourceBranch);
  args.push(REPO_ROOT, repo);
  execFileSync('git', args, { stdio: 'ignore' });
  if (!sourceBranch) execFileSync('git', ['checkout', '--detach', sourceCommit], { cwd: repo, stdio: 'ignore' });
  const clonedCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
  if (clonedCommit !== sourceCommit) throw new Error(`WP7 test clone drifted from source HEAD: expected ${sourceCommit}, got ${clonedCommit}`);
  execFileSync('git', ['config', 'user.email', 'wp7-test@example.invalid'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'WP7 Test'], { cwd: repo });
  return { root, repo, sourceBranch, sourceCommit };
}
function createPreacceptanceRecord(repo, root) {
  const implementationCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
  const implementationSourceTree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: repo, encoding: 'utf8' }).trim();
  const recordPath = path.join(root, 'WP7_PREACCEPTANCE_BINDING.json');
  writeCanonicalJson(recordPath, {
    schemaVersion: 1,
    documentType: 'WP7_PREACCEPTANCE_BINDING',
    decision: 'WP7_PREACCEPTED_FOR_FINAL_PACKAGING',
    independentReview: true,
    productionImplementationAccepted: true,
    implementationCommit,
    implementationSourceTree
  });
  return { recordPath, recordSha256: sha256File(recordPath), implementationCommit, implementationSourceTree };
}
// Deterministic minimal Windows x64 PE image for the fake Electron executable.
// The native-binary gate (tools/wp7/verify-native-binaries.js) requires every
// Windows target-loadable .exe to be a real x64 PE:
//   - 'MZ' DOS magic at offset 0
//   - UInt32LE PE header offset at 0x3c
//   - 'PE\0\0' signature at that offset
//   - COFF machine == 0x8664 (IMAGE_FILE_MACHINE_AMD64) at PE offset + 4
// These bytes are fixed (no timestamps / no randomness) so the file hash is
// reproducible and fakeElectronOfficialRecords() can bind to the same bytes.
const FAKE_ELECTRON_PE_MARKER = Buffer.from('WP7-FAKE-ELECTRON-X64-PE-FIXTURE-V1', 'ascii');
function windowsFakeElectronExecutableBytes() {
  const peOffset = 0x40;
  // 0x40 DOS stub + 4 PE sig + 20 COFF header + fixed marker payload.
  const buffer = Buffer.alloc(peOffset + 4 + 20 + FAKE_ELECTRON_PE_MARKER.length, 0);
  buffer[0] = 0x4d; // 'M'
  buffer[1] = 0x5a; // 'Z'
  buffer.writeUInt32LE(peOffset, 0x3c); // e_lfanew -> PE header offset
  buffer[peOffset] = 0x50; // 'P'
  buffer[peOffset + 1] = 0x45; // 'E'
  buffer[peOffset + 2] = 0x00;
  buffer[peOffset + 3] = 0x00;
  buffer.writeUInt16LE(0x8664, peOffset + 4); // Machine = IMAGE_FILE_MACHINE_AMD64
  buffer.writeUInt16LE(0, peOffset + 6); // NumberOfSections
  buffer.writeUInt32LE(0, peOffset + 8); // TimeDateStamp (deterministic 0)
  buffer.writeUInt32LE(0, peOffset + 12); // PointerToSymbolTable
  buffer.writeUInt32LE(0, peOffset + 16); // NumberOfSymbols
  buffer.writeUInt16LE(0, peOffset + 20); // SizeOfOptionalHeader
  buffer.writeUInt16LE(0x0002, peOffset + 22); // Characteristics = IMAGE_FILE_EXECUTABLE_IMAGE
  FAKE_ELECTRON_PE_MARKER.copy(buffer, peOffset + 24);
  return buffer;
}
function fakeElectronExecutableBytes(platform = process.platform) {
  return platform === 'win32' ? windowsFakeElectronExecutableBytes() : Buffer.from('fixture-electron-runtime');
}
function createFakeElectronDist(root, platform = process.platform) {
  const dist = path.join(root, 'electron-dist');
  fs.mkdirSync(dist, { recursive: true });
  const executable = path.join(dist, platform === 'win32' ? 'electron.exe' : 'electron');
  const resources = path.join(dist, 'resources.pak');
  fs.writeFileSync(executable, fakeElectronExecutableBytes(platform));
  fs.writeFileSync(resources, 'fixture-resource');
  if (process.platform !== 'win32') {
    fs.chmodSync(executable, 0o755);
    fs.chmodSync(resources, 0o644);
  }
  return dist;
}
function createFakeTrustedNodeRuntime(root) {
  const executable = path.join(root, process.platform === 'win32' ? 'fake-node-22.23.1.exe' : 'fake-node-22.23.1');
  if (process.platform === 'win32') {
    if (process.version !== 'v22.23.1') throw new Error(`WP7 Windows trusted Node fixture requires test host v22.23.1, got ${process.version}`);
    fs.copyFileSync(process.execPath, executable);
  } else {
    fs.writeFileSync(executable, '#!/bin/sh\nif [ "$1" = "--version" ]; then echo v22.23.1; exit 0; fi\necho fixture runtime only >&2\nexit 64\n');
    fs.chmodSync(executable, 0o755);
  }
  return executable;
}

function fakeElectronOfficialRecords(platform = process.platform) {
  const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
  const executableBytes = fakeElectronExecutableBytes(platform);
  return [
    { path: platform === 'win32' ? 'electron.exe' : 'electron', sizeBytes: executableBytes.length, sha256: hash(executableBytes), unixMode: platform === 'win32' ? 0 : 0o100755 },
    { path: 'resources.pak', sizeBytes: Buffer.byteLength('fixture-resource'), sha256: hash('fixture-resource'), unixMode: platform === 'win32' ? 0 : 0o100644 }
  ];
}
function productionDependencyFixture(repoRoot, platform = process.platform, arch = 'x64') {
  const lockBytes = fs.readFileSync(path.join(repoRoot, 'package-lock.json'));
  const packageBytes = fs.readFileSync(path.join(repoRoot, 'package.json'));
  const bindingBytes = fs.readFileSync(path.join(repoRoot, 'release', 'production-dependency-binding.json'));
  const key = crypto.createHash('sha256').update(lockBytes).update('\0').update(packageBytes).update('\0').update(bindingBytes).update(`\0${platform}\0${arch}\0npm-10.9.2`).digest('hex').slice(0, 20);
  const cacheRoot = path.join(os.tmpdir(), `yance-wp7-production-dependencies-${key}`);
  const nodeModules = path.join(cacheRoot, 'node_modules');
  const marker = path.join(cacheRoot, '.complete');
  if (!fs.existsSync(marker)) {
    fs.rmSync(cacheRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    fs.mkdirSync(cacheRoot, { recursive: true });
    fs.copyFileSync(path.join(repoRoot, 'package.json'), path.join(cacheRoot, 'package.json'));
    fs.copyFileSync(path.join(repoRoot, 'package-lock.json'), path.join(cacheRoot, 'package-lock.json'));
    const npmExecutable = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const result = spawnSync(npmExecutable, ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--no-bin-links', `--os=${platform}`, `--cpu=${arch}`], {
      cwd: cacheRoot,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      shell: process.platform === 'win32',
      windowsHide: true
    });
    if (result.status !== 0) {
      throw new Error([
        `production dependency fixture install failed with status ${result.status}`,
        result.error?.stack || result.error?.message || '',
        result.stdout || '',
        result.stderr || ''
      ].filter(Boolean).join('\n'));
    }
    fs.rmSync(path.join(nodeModules, '.package-lock.json'), { force: true });
    fs.writeFileSync(marker, 'complete\n');
  }
  return nodeModules;
}

function cloneDirectoryFast(sourceRoot, destinationRoot) {
  fs.mkdirSync(destinationRoot, { recursive: true });
  if (process.platform !== 'win32') {
    const hardlink = spawnSync('cp', ['-al', `${path.resolve(sourceRoot)}/.`, path.resolve(destinationRoot)], { encoding: 'utf8' });
    if (hardlink.status === 0) return destinationRoot;
    const reflink = spawnSync('cp', ['-a', '--reflink=auto', `${path.resolve(sourceRoot)}/.`, path.resolve(destinationRoot)], { encoding: 'utf8' });
    if (reflink.status === 0) return destinationRoot;
  }
  fs.cpSync(sourceRoot, destinationRoot, { recursive: true, preserveTimestamps: true });
  return destinationRoot;
}
function detachFile(filePath) {
  const absolute = path.resolve(filePath);
  const stat = fs.statSync(absolute);
  const temporary = `${absolute}.detach-${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
  fs.copyFileSync(absolute, temporary);
  if (process.platform !== 'win32') fs.chmodSync(temporary, stat.mode & 0o777);
  fs.renameSync(temporary, absolute);
  return absolute;
}
function remapPaths(value, sourceRoot, destinationRoot) {
  if (Array.isArray(value)) return value.map((entry) => remapPaths(entry, sourceRoot, destinationRoot));
  if (value && typeof value === 'object' && !Buffer.isBuffer(value)) return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, remapPaths(child, sourceRoot, destinationRoot)]));
  if (typeof value === 'string' && (value === sourceRoot || value.startsWith(`${sourceRoot}${path.sep}`))) return `${destinationRoot}${value.slice(sourceRoot.length)}`;
  return value;
}

function createFakeRceditRunner() {
  return ({ exePath, iconPath, versionFields }) => {
    if (!exePath || !fs.existsSync(exePath)) throw new Error('fake rcedit runner requires an existing product executable');
    if (!iconPath || !fs.existsSync(iconPath)) throw new Error('fake rcedit runner requires the approved icon fixture');
    if (!versionFields || versionFields.InternalName !== 'Yance' || versionFields.OriginalFilename !== 'Yance.exe') {
      throw new Error('fake rcedit runner received incomplete branding fields');
    }
    // Unit tests bind the fake Electron executable by exact bytes. The no-op is
    // intentional: it exercises the Windows branding control flow without
    // depending on an external rcedit binary, while formal builds cannot inject
    // this runner because assembleWindowsApplication only accepts it when
    // allowNonWindows=true.
    return { status: 'PASS', fixture: true };
  };
}

// Locate the .NET Framework C# compiler used to build a native fake makensis.exe.
function locateCsc() {
  const candidates = [
    path.join(process.env.WINDIR || 'C:/Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'),
    path.join(process.env.WINDIR || 'C:/Windows', 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe')
  ];
  for (const candidate of candidates) if (fs.existsSync(candidate)) return candidate;
  return null;
}
// On Windows the real NSIS compiler is a native PE executable (makensis.exe),
// which Node spawns directly. A .cmd/.bat fixture cannot be spawned without
// shell:true on Node >=18.20/20.12/22 (CVE-2024-27980 mitigation) and returns
// EINVAL, so the fake compiler must also be a native .exe. We do NOT change the
// product runNsisCompiler spawn behavior; we make the fixture match production.
function createFakeNsisCompiler(root) {
  if (process.platform !== 'win32') {
    const script = path.join(root, 'fake-makensis');
    fs.writeFileSync(script, '#!/usr/bin/env node\nrequire("./fake-makensis.js");\n');
    fs.chmodSync(script, 0o755);
    fs.writeFileSync(path.join(root, 'fake-makensis.js'), [
      "'use strict';",
      "const fs=require('node:fs');",
      "const arg=process.argv.find((v)=>v.startsWith('/DOUTPUT_FILE='));",
      "if(!arg) process.exit(2);",
      "const output=arg.slice('/DOUTPUT_FILE='.length);",
      "fs.mkdirSync(require('node:path').dirname(output),{recursive:true});",
      "fs.writeFileSync(output,Buffer.from('MZ\\nWP7-NSIS-COMPILE-FIXTURE\\n'));"
    ].join('\n'));
    return script;
  }
  const exePath = path.join(root, 'fake-makensis.exe');
  const csc = locateCsc();
  if (!csc) throw new Error('WP7 test requires the .NET Framework C# compiler (csc.exe) to build the native fake NSIS compiler on Windows');
  const csPath = path.join(root, 'fake-makensis.cs');
  const installerPeBase64 = windowsFakeElectronExecutableBytes().toString('base64');
  fs.writeFileSync(csPath, [
    'using System;',
    'using System.IO;',
    'class FakeMakensis {',
    '  static int Main(string[] args) {',
    '    string output = null;',
    '    foreach (string arg in args) { if (arg.StartsWith("/DOUTPUT_FILE=")) { output = arg.Substring("/DOUTPUT_FILE=".Length); } }',
    '    if (output == null) return 2;',
    '    string full = Path.GetFullPath(output);',
    '    Directory.CreateDirectory(Path.GetDirectoryName(full));',
    `    byte[] installer = Convert.FromBase64String("${installerPeBase64}");`,
    '    File.WriteAllBytes(full, installer);',
    '    return 0;',
    '  }',
    '}'
  ].join('\n'));
  const compile = spawnSync(csc, ['/nologo', '/optimize+', '/platform:x64', `/out:${exePath}`, csPath], { encoding: 'utf8', windowsHide: true });
  if (compile.status !== 0 || !fs.existsSync(exePath)) {
    throw new Error(`fake NSIS compiler build failed (status ${compile.status}): ${compile.stdout || ''}\n${compile.stderr || ''}\n${compile.error ? compile.error.message : ''}`);
  }
  return exePath;
}
module.exports = { temp, expectReason, identityTuple, finalEvidenceDocument, cloneCurrentRepository, createPreacceptanceRecord, createFakeElectronDist, createFakeTrustedNodeRuntime, fakeElectronOfficialRecords, productionDependencyFixture, cloneDirectoryFast, detachFile, remapPaths, createFakeNsisCompiler, createFakeRceditRunner, windowsFakeElectronExecutableBytes, fakeElectronExecutableBytes };
