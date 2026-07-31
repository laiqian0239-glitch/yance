'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { loadReleaseIdentity } = require('../../shared/release/releaseIdentity');
const {
  SOURCE_UAT_ARTIFACT_CLASS,
  assertSupportedNode,
  discoverElectronArchive,
  discoverExistingDataRoots,
  expectedElectronArtifact,
  inspectDataRoot,
  normalizePort,
  payloadIdentity,
  prepareSourceUat,
  resolveDataRoot,
  runNpmCi,
  runNpmCiWithRetry,
  sha256File,
  secureZipEntryPath,
  verifyDependencyIntegrity
} = require('../../tools/runtime-delivery/source-uat-delivery');

const repoRoot = path.resolve(__dirname, '..', '..');

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'yance-source-uat-test-'));
}

test('prepareSourceUat generates a verified source-only release identity without release claims', () => {
  const outputRoot = tempRoot();
  const result = prepareSourceUat(repoRoot, {
    outputRoot,
    allowDirty: true,
    buildTimestampUtc: '2026-07-20T10:00:00.000Z'
  });
  const verified = loadReleaseIdentity({
    manifestPath: result.manifestPath,
    detachedHashPath: result.detachedHashPath,
    expectedBuildId: result.manifest.buildId,
    consumer: 'test'
  });
  assert.equal(verified.artifactClass, SOURCE_UAT_ARTIFACT_CLASS);
  assert.equal(verified.finalReleaseEvidence, false);
  assert.equal(verified.formalPublicReleaseAuthorized, false);
  assert.equal(result.manifest.sourceUat.fullPipelineExecuted, false);
  assert.equal(result.manifest.sourceUat.wp7Executed, false);
  assert.equal(result.manifest.sourceUat.strictExecuted, false);
  assert.equal(result.manifest.sourceUat.builderExecuted, false);
  assert.equal(result.manifest.applicationPayloadSha256, payloadIdentity(result.records));
  assert.equal(result.manifest.payloadFilesSha256, sha256File(result.payloadFilesPath));
});

test('public platform auth is hash-bound and contains no secret field names', () => {
  const outputRoot = tempRoot();
  const result = prepareSourceUat(repoRoot, { outputRoot, allowDirty: true, buildTimestampUtc: '2026-07-20T10:00:00.000Z' });
  assert.equal(result.platformAuth.configured, true);
  assert.equal(sha256File(result.platformAuth.configPath), result.platformAuth.sha256);
  const text = fs.readFileSync(result.platformAuth.configPath, 'utf8');
  assert.doesNotMatch(text, /(appSecret|pageToken|verifyToken|encryptionKey|masterKey|privateKey)/iu);
  assert.equal(result.report.platformAuth.secretFieldsRead, false);
  assert.equal(result.report.platformAuth.secretFieldsWritten, false);
  assert.equal(result.report.platformAuth.secretFieldsPrinted, false);
});

test('data root is isolated by default and existing data requires explicit choice', () => {
  const env = { LOCALAPPDATA: 'C:\\Users\\Taylor\\AppData\\Local', APPDATA: 'C:\\Users\\Taylor\\AppData\\Roaming' };
  assert.match(resolveDataRoot({}, env), /Yance-Source-UAT$/u);
  assert.match(resolveDataRoot({ useExistingData: true }, env), /Yance$/u);
  assert.notEqual(resolveDataRoot({}, env), resolveDataRoot({ useExistingData: true }, env));
});

test('largest-existing mode chooses the largest non-empty SQLite root without copying data', () => {
  const root = tempRoot();
  const local = path.join(root, 'Local');
  const roaming = path.join(root, 'Roaming');
  const defaultRoot = path.join(local, 'Yance-Source-UAT');
  const installedRoot = path.join(roaming, 'Yance');
  const customRoot = path.join(local, 'Yance-Source-UAT-user-config-123');
  for (const [dataRoot, bytes] of [[defaultRoot, 100], [installedRoot, 250], [customRoot, 180]]) {
    fs.mkdirSync(path.join(dataRoot, 'store'), { recursive: true });
    fs.writeFileSync(path.join(dataRoot, 'store', 'yance-r32.db'), Buffer.alloc(bytes));
  }
  const env = { LOCALAPPDATA: local, APPDATA: roaming };
  const rows = discoverExistingDataRoots(env);
  assert.equal(rows[0].databaseSizeBytes, 250);
  assert.equal(resolveDataRoot({ useLargestExistingData: true }, env), path.resolve(installedRoot));
  assert.equal(inspectDataRoot(customRoot).databaseSizeBytes, 180);
});

test('runtime version and port guards reject unsupported values', () => {
  assert.throws(() => assertSupportedNode('20.18.0'), error => error.reasonCode === 'SOURCE_UAT_NODE_VERSION_UNSUPPORTED');
  assert.doesNotThrow(() => assertSupportedNode('22.5.0'));
  assert.equal(normalizePort('27632'), 27632);
  assert.throws(() => normalizePort('80'), error => error.reasonCode === 'SOURCE_UAT_PORT_INVALID');
});




test('npm ci uses the Windows command shell for npm.cmd and hides the console window', () => {
  let invocation = null;
  const result = runNpmCi(repoRoot, { ELECTRON_SKIP_BINARY_DOWNLOAD: '1' }, {
    platform: 'win32',
    spawn(command, args, options) {
      invocation = { command, args, options };
      return { status: 0, error: null, signal: null };
    }
  });
  assert.deepEqual(result, { status: 0, error: null, signal: null });
  assert.equal(invocation.command, 'npm.cmd');
  assert.deepEqual(invocation.args, ['ci', '--no-audit', '--no-fund']);
  assert.equal(invocation.options.shell, true);
  assert.equal(invocation.options.windowsHide, true);
  assert.equal(invocation.options.env.ELECTRON_SKIP_BINARY_DOWNLOAD, '1');
});



test('dependency integrity rejects missing or incomplete direct packages before source UAT launch', () => {
  const root = tempRoot();
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ dependencies: { express: '^4.21.2' } }), 'utf8');
  const missing = verifyDependencyIntegrity(root, { packageNames: ['express'], throwOnFailure: false, platform: 'linux' });
  assert.equal(missing.ok, false);
  assert.equal(missing.missing[0].packageName, 'express');

  const packageRoot = path.join(root, 'node_modules', 'express');
  fs.mkdirSync(packageRoot, { recursive: true });
  fs.writeFileSync(path.join(packageRoot, 'package.json'), JSON.stringify({ name: 'express', version: '4.21.2' }), 'utf8');
  const complete = verifyDependencyIntegrity(root, { packageNames: ['express'], platform: 'linux' });
  assert.equal(complete.ok, true);
  assert.equal(complete.installedCount, 1);
});

test('npm ci retry records every failed attempt and succeeds without hiding install evidence', () => {
  const root = tempRoot();
  let calls = 0;
  const result = runNpmCiWithRetry(root, {}, {
    platform: 'linux',
    maxAttempts: 3,
    logRoot: path.join(root, 'logs'),
    spawn() {
      calls += 1;
      return { status: calls < 3 ? 1 : 0, error: null, signal: null };
    }
  });
  assert.equal(result.ok, true);
  assert.equal(result.attempts.length, 3);
  assert.equal(result.final.status, 0);
  assert.equal(fs.existsSync(result.attempts[0].stdoutPath), true);
  assert.equal(fs.existsSync(result.attempts[0].stderrPath), true);
});

test('Electron local archive recovery is bound to the reviewed Windows SHA-256', () => {
  const artifact = expectedElectronArtifact(repoRoot, 'win32', 'x64');
  assert.equal(artifact.fileName, 'electron-v39.8.5-win32-x64.zip');
  assert.match(artifact.sha256, /^[0-9a-f]{64}$/u);
  const discovered = discoverElectronArchive(repoRoot, { platform: 'win32', arch: 'x64', electronZip: path.join(tempRoot(), 'missing.zip') });
  assert.equal(discovered.archivePath, '');
  assert.equal(discovered.artifact.sha256, artifact.sha256);
});

test('Electron ZIP extraction rejects traversal and absolute entries', () => {
  const root = tempRoot();
  assert.throws(() => secureZipEntryPath(root, '../electron.exe'), error => error.reasonCode === 'SOURCE_UAT_ELECTRON_ARCHIVE_ENTRY_INVALID');
  assert.throws(() => secureZipEntryPath(root, 'C:/electron.exe'), error => error.reasonCode === 'SOURCE_UAT_ELECTRON_ARCHIVE_ENTRY_INVALID');
  assert.doesNotThrow(() => secureZipEntryPath(root, 'locales/zh-CN.pak'));
});

test('obsolete root launchers remain quarantined and npm scripts use the source UAT authority', () => {
  for (const file of ['START_YANCE_SOURCE_UAT.cmd', 'INSTALL_AND_START_YANCE_SOURCE_UAT.cmd', 'START_YANCE_SOURCE_UAT_EXISTING_DATA.cmd', 'START_YANCE_SOURCE_UAT_LARGEST_EXISTING_DATA.cmd', 'INSTALL_AND_START_YANCE_SOURCE_UAT_LARGEST_EXISTING_DATA.cmd', 'INSTALL_AND_START_YANCE_SOURCE_UAT_LARGEST_EXISTING_DATA.ps1']) {
    assert.equal(fs.existsSync(path.join(repoRoot, file)), false, `${file} must not remain in the product source root`);
  }
  const scripts = require('../../package.json').scripts;
  assert.match(scripts['start:source-uat'], /start-source-uat\.js/u);
  assert.match(scripts['install:start:source-uat'], /start-source-uat\.js --install/u);
  assert.doesNotMatch(scripts['install:start:source-uat'], /(pipeline|wp7|strict|builder|npm run build|npm run package)/iu);
});

test('source UAT authority retries npm installation and rejects incomplete dependency trees', () => {
  const delivery = fs.readFileSync(path.join(repoRoot, 'tools/runtime-delivery/source-uat-delivery.js'), 'utf8');
  const launcher = fs.readFileSync(path.join(repoRoot, 'tools/runtime-delivery/start-source-uat.js'), 'utf8');
  assert.match(delivery, /runNpmCiWithRetry/u);
  assert.match(delivery, /maxAttempts \|\| 3/u);
  assert.match(delivery, /SOURCE_UAT_DEPENDENCY_INTEGRITY_FAILED/u);
  assert.match(delivery, /ELECTRON_EXECUTABLE_MISSING/u);
  assert.match(launcher, /verifyDependencyIntegrity/u);
  assert.match(launcher, /dependencyIntegrity/u);
});


test('Windows source UAT defaults to software rendering without changing installed production policy', () => {
  const launcher = fs.readFileSync(path.join(repoRoot, 'tools/runtime-delivery/start-source-uat.js'), 'utf8');
  const main = fs.readFileSync(path.join(repoRoot, 'electron/main.js'), 'utf8');
  assert.match(launcher, /const softwareRendering = process\.env\.YANCE_DISABLE_GPU !== '0'/u);
  assert.match(launcher, /YANCE_DISABLE_GPU:\s*softwareRendering \? '1' : '0'/u);
  assert.match(main, /SOURCE_UAT_SOFTWARE_RENDERING/u);
  assert.match(main, /process\.env\.YANCE_SOURCE_UAT === '1'/u);
  assert.match(main, /app\.disableHardwareAcceleration\(\)/u);
  assert.match(main, /appendSwitch\('disable-gpu'\)/u);
  assert.match(main, /YANCE_ENABLE_HARDWARE_ACCELERATION/u);
});


test('source UAT accepts a collector-selected data root through the process environment', () => {
  const launcher = fs.readFileSync(path.join(repoRoot, 'tools/runtime-delivery/start-source-uat.js'), 'utf8');
  assert.match(launcher, /YANCE_UAT_SELECTED_DATA_ROOT/u);
  assert.match(launcher, /if \(!options\.dataRoot && selectedDataRoot\) options\.dataRoot = selectedDataRoot/u);
});
