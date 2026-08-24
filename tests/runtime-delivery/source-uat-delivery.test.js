'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { loadReleaseIdentity } = require('../../shared/release/releaseIdentity');
const {
  SOURCE_UAT_ARTIFACT_CLASS,
  classifyNpmInstallFailure,
  assertSupportedNode,
  discoverElectronArchive,
  discoverExistingDataRoots,
  expectedElectronArtifact,
  inspectDataRoot,
  installDependencies,
  normalizePort,
  payloadIdentity,
  prepareSourceUat,
  resolveDataRoot,
  runNpmCi,
  runNpmCiWithRetry,
  sha256File,
  secureZipEntryPath,
  sourcePayloadRecords,
  verifyDependencyIntegrity
} = require('../../tools/runtime-delivery/source-uat-delivery');

const repoRoot = path.resolve(__dirname, '..', '..');

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'yance-source-uat-test-'));
}


test('private dependency caches are excluded from source identity payloads', () => {
  const root = tempRoot();
  fs.mkdirSync(path.join(root, '.yance-cache', 'npm'), { recursive: true });
  fs.writeFileSync(path.join(root, '.yance-cache', 'npm', 'cache-entry'), 'runtime-cache');
  fs.writeFileSync(path.join(root, 'source.js'), 'module.exports = true;');
  const records = sourcePayloadRecords(root);
  assert.deepEqual(records.map(row => row.path), ['source.js']);
});

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




test('npm ci invokes npm-cli.js through node.exe on Windows without a command shell', () => {
  let invocation = null;
  const fixtureRoot = tempRoot();
  const npmCliPath = path.join(fixtureRoot, 'node_modules', 'npm', 'bin', 'npm-cli.js');
  fs.mkdirSync(path.dirname(npmCliPath), { recursive: true });
  fs.writeFileSync(npmCliPath, '');
  const result = runNpmCi(repoRoot, { ELECTRON_SKIP_BINARY_DOWNLOAD: '1' }, {
    platform: 'win32',
    npmCliPath,
    nodeExecutable: process.execPath,
    spawn(command, args, options) {
      invocation = { command, args, options };
      return { status: 0, error: null, signal: null };
    }
  });
  assert.deepEqual(result, { status: 0, error: null, signal: null });
  assert.equal(invocation.command, process.execPath);
  assert.deepEqual(invocation.args, [npmCliPath, 'ci', '--no-audit', '--no-fund']);
  assert.equal(invocation.options.shell, false);
  assert.equal(invocation.options.windowsHide, true);
  assert.equal(invocation.options.env.ELECTRON_SKIP_BINARY_DOWNLOAD, '1');
});


test('npm ci consumes the authority private cache with prefer-offline and does not override registry', () => {
  let invocation = null;
  const cacheRoot = path.join(tempRoot(), 'npm-cache');
  runNpmCi(repoRoot, {}, {
    platform: 'linux',
    cacheRoot,
    preferOffline: true,
    spawn(command, args, options) {
      invocation = { command, args, options };
      return { status: 0, error: null, signal: null };
    }
  });
  assert.equal(invocation.options.env.npm_config_cache, path.resolve(cacheRoot));
  assert.equal(invocation.options.env.npm_config_prefer_offline, 'true');
  assert.equal(Object.hasOwn(invocation.options.env, 'npm_config_registry'), false);
  assert.doesNotMatch(invocation.args.join(' '), /registry/iu);
});

test('installDependencies seeds the trusted cache before npm ci and returns a clean install receipt', () => {
  const root = tempRoot();
  fs.mkdirSync(path.join(root, 'governance'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ dependencies: {} }));
  fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: {} }));
  fs.writeFileSync(path.join(root, 'governance/dependency-install-policy.json'), JSON.stringify({ schemaVersion: 1, trustedCacheSeeds: [] }));
  const order = [];
  const result = installDependencies(root, {
    platform: 'linux',
    arch: 'x64',
    maxAttempts: 1,
    cacheRoot: path.join(root, '.cache/npm'),
    dependencyAuthority: {
      seedTrustedDependencyCache() {
        order.push('seed');
        return { ok: true, cacheRoot: path.join(root, '.cache/npm'), seedCount: 1, seeds: [{ packageName: 'yauzl', version: '2.10.0', archiveSha256: 'a'.repeat(64) }] };
      }
    },
    discoverElectronArchive() {
      return { artifact: { fileName: 'electron.zip', sha256: 'b'.repeat(64) }, archivePath: '', candidates: [] };
    },
    runNpmCiWithRetry(repoRootArg, env, options) {
      order.push('npm-ci');
      assert.equal(options.cacheRoot, path.join(root, '.cache/npm'));
      assert.equal(options.preferOffline, true);
      return { ok: true, attempts: [{ attempt: 1, status: 0 }], final: { status: 0 }, logRoot: path.join(root, 'logs') };
    },
    verifyDependencyIntegrity() {
      order.push('integrity');
      return { ok: true, directDependencyCount: 0, installedCount: 0, missing: [], invalid: [], checkedAtUtc: '2026-08-02T00:00:00.000Z' };
    }
  });
  assert.deepEqual(order, ['seed', 'npm-ci', 'integrity']);
  assert.equal(result.cleanInstallReceipt.status, 'SOURCE_INSTALL_VERIFIED');
  assert.equal(result.cleanInstallReceipt.windowsUat, false);
  assert.equal(result.cleanInstallReceipt.electronLaunch.status, 'NOT_EXECUTED');
  assert.equal(result.cleanInstallReceipt.dependencySeed.seedCount, 1);
});

test('installDependencies fails closed when trusted dependency cache seeding fails', () => {
  const root = tempRoot();
  assert.throws(() => installDependencies(root, {
    platform: 'linux',
    dependencyAuthority: {
      seedTrustedDependencyCache() {
        throw Object.assign(new Error('seed failed'), { reasonCode: 'SOURCE_UAT_DEPENDENCY_SEED_SHA256_MISMATCH' });
      }
    }
  }), error => error.reasonCode === 'SOURCE_UAT_DEPENDENCY_SEED_SHA256_MISMATCH');
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


test('npm install failures classify registry package 404 as deterministic missing dependency', () => {
  const classification = classifyNpmInstallFailure(`npm error code E404\nnpm error 404 Not Found - GET https://mirror.example/yargs-parser/-/yargs-parser-18.1.3.tgz\nnpm error 404 'yargs-parser@https://mirror.example/yargs-parser/-/yargs-parser-18.1.3.tgz' is not in this registry.`);
  assert.deepEqual(classification, {
    category: 'DEPENDENCY_REGISTRY_PACKAGE_MISSING',
    deterministic: true,
    retryRecommended: false,
    packageName: 'yargs-parser',
    version: '18.1.3',
    httpStatus: 404
  });
});

test('npm install failures classify network timeout as transient without hiding it', () => {
  const classification = classifyNpmInstallFailure('npm error code ETIMEDOUT\nnpm error network request timed out');
  assert.equal(classification.category, 'DEPENDENCY_NETWORK_TRANSIENT');
  assert.equal(classification.deterministic, false);
  assert.equal(classification.retryRecommended, true);
});


test('npm ci retry stops after a deterministic registry package 404', () => {
  const root = tempRoot();
  let calls = 0;
  const result = runNpmCiWithRetry(root, {}, {
    platform: 'linux',
    maxAttempts: 3,
    logRoot: path.join(root, 'logs'),
    spawn(command, args, options) {
      calls += 1;
      fs.writeSync(options.stdio[2], "npm error code E404\nnpm error 404 'yargs-parser@https://mirror.example/yargs-parser/-/yargs-parser-18.1.3.tgz' is not in this registry.\n");
      return { status: 1, error: null, signal: null };
    }
  });
  assert.equal(result.ok, false);
  assert.equal(calls, 1);
  assert.equal(result.attempts.length, 1);
  assert.equal(result.final.failure.category, 'DEPENDENCY_REGISTRY_PACKAGE_MISSING');
  assert.equal(result.final.failure.retryRecommended, false);
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

test('Electron local archive recovery is trust-bound without checked-in Release ZIP custody', () => {
  const artifact = expectedElectronArtifact(repoRoot, 'win32', 'x64');
  assert.equal(artifact.fileName, 'electron-v43.4.1-win32-x64.zip');
  assert.equal(artifact.sha256, 'c2ef9a5f65472c34d14bd3e67b7d14e66b0c01f124aba45263d6a4232160e13a');
  const retiredSourceCandidate = path.join(repoRoot, 'vendor', 'electron', artifact.fileName);
  const discovered = discoverElectronArchive(repoRoot, { platform: 'win32', arch: 'x64', electronZip: path.join(tempRoot(), 'missing.zip') });
  assert.equal(discovered.archivePath, '');
  assert.ok(discovered.candidates.includes(retiredSourceCandidate));
  assert.equal(discovered.artifact.sha256, artifact.sha256);
});

test('Electron ZIP extraction rejects traversal and absolute entries', () => {
  const root = tempRoot();
  assert.throws(() => secureZipEntryPath(root, '../electron.exe'), error => error.reasonCode === 'SOURCE_UAT_ELECTRON_ARCHIVE_ENTRY_INVALID');
  assert.throws(() => secureZipEntryPath(root, 'C:/electron.exe'), error => error.reasonCode === 'SOURCE_UAT_ELECTRON_ARCHIVE_ENTRY_INVALID');
  assert.doesNotThrow(() => secureZipEntryPath(root, 'locales/zh-CN.pak'));
});

test('FIX6O Windows launcher remains byte-for-byte historical evidence without becoming active Electron authority', () => {
  const cmdPath = path.join(repoRoot, 'RUN_FIX6O_GATE0_WINDOWS_UAT.cmd');
  const ps1Path = path.join(repoRoot, 'RUN_FIX6O_GATE0_WINDOWS_UAT.ps1');
  assert.equal(fs.existsSync(cmdPath), true);
  assert.equal(fs.existsSync(ps1Path), true);

  const cmdBlob = spawnSync('git', ['rev-parse', 'HEAD:RUN_FIX6O_GATE0_WINDOWS_UAT.cmd'], { cwd: repoRoot, encoding: 'utf8' });
  const ps1Blob = spawnSync('git', ['rev-parse', 'HEAD:RUN_FIX6O_GATE0_WINDOWS_UAT.ps1'], { cwd: repoRoot, encoding: 'utf8' });
  assert.equal(cmdBlob.status, 0);
  assert.equal(ps1Blob.status, 0);
  assert.equal(cmdBlob.stdout.trim(), '9ff34efd68e0d187fb8136513d9759436e6693c8');
  assert.equal(ps1Blob.stdout.trim(), '6be5138e41c6ec2b10e041c0288011f522e2ab47');

  const cmd = fs.readFileSync(cmdPath, 'utf8');
  const ps1 = fs.readFileSync(ps1Path, 'utf8');
  assert.match(cmd, /RUN_FIX6O_GATE0_WINDOWS_UAT\.ps1/u);
  assert.match(cmd, /pause[\s\S]*exit \/b %YANCE_EXIT%/u, 'launcher must remain visible after failure or normal exit');
  assert.match(ps1, /tools[\\/]runtime-delivery[\\/]start-source-uat\.js/u);
  assert.match(ps1, /gate0-windows-launcher/u);
  assert.match(ps1, /Start-Process/u);
  assert.match(ps1, /RedirectStandardOutput/u);
  assert.match(ps1, /RedirectStandardError/u);
  assert.match(ps1, /--install/u);
  assert.doesNotMatch(`${cmd}\n${ps1}`, /--no-sandbox|ELECTRON_DISABLE_SANDBOX/iu);
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
