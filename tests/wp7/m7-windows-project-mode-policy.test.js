'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const zlib = require('node:zlib');
const {
  PROJECT_FILES,
  PROJECT_ROOTS,
  expectedPayloadMode,
  normalizedProjectPayloadMode,
  projectFileModePolicyForPlatform,
  validateReviewedApplicationSourceClosure,
  CONTROLLED_METADATA_PATHS
} = require('../../tools/wp7/packaged-payload-closure');
const {
  GENERATED_NPM_BIN_SHIM_POLICY,
  normalizedDependencyDirectoryMode,
  validateBindingDocument,
  walkDependencyFilesystem
} = require('../../tools/wp7/production-dependency-binding');
const { copyProductionDependencyTree } = require('../../tools/wp7/lib');
const { compareElectronDistributionTree } = require('../../tools/wp7/packaged-product-trust');
const { createDeterministicTarGzip } = require('../../tools/wp7/deterministic-tar-gzip');
const { createDeterministicZip } = require('../../tools/wp7/deterministic-zip');
const { numericOption, optionValue } = require('../../tools/wp7/cli-options');
const { canonicalBuffer: nativeBinaryCanonicalBuffer, verifyNativeBinaries } = require('../../tools/wp7/verify-native-binaries');
const { resolveBuildInputs } = require('../../tools/wp7/create-pre-review-trusted-product');
const { runtimeExecutableName } = require('../../tools/wp7/node-runtime-identity');
const { applicationPayloadFilesystemIdentitySha256 } = require('../../tools/wp7/filesystem-identity');
const { createPreReviewSealedArtifact, readAndVerifyPreReviewSealedArtifact } = require('../../tools/wp7/pre-review-sealed-artifact');
const { verifyOuterCandidateZip } = require('../../tools/wp7/verify-convergence-pre-review-candidate');

const REPO = path.resolve(__dirname, '..', '..');
const temporaryRoots = new Set();

function tempRoot(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temporaryRoots.add(root);
  return root;
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function copyTreeAsWindowsWritable(source, destination, options = {}) {
  const stat = fs.lstatSync(source);
  if (stat.isSymbolicLink()) throw new Error(`fixture source symlink is forbidden: ${source}`);
  if (stat.isDirectory()) {
    fs.mkdirSync(destination, { recursive: true });
    for (const name of fs.readdirSync(source)) {
      if ((options.excludeNames || []).includes(name)) continue;
      copyTreeAsWindowsWritable(path.join(source, name), path.join(destination, name), options);
    }
    return;
  }
  if (!stat.isFile()) throw new Error(`unsupported fixture source type: ${source}`);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
  fs.chmodSync(destination, 0o666);
}

function copyReviewedProjectTree(sourceRoot, destinationRoot) {
  for (const rootName of PROJECT_ROOTS) {
    copyTreeAsWindowsWritable(
      path.join(sourceRoot, rootName),
      path.join(destinationRoot, rootName),
      { excludeNames: rootName === 'backend' ? ['tests'] : [] }
    );
  }
  for (const fileName of PROJECT_FILES) {
    copyTreeAsWindowsWritable(path.join(sourceRoot, fileName), path.join(destinationRoot, fileName));
  }
}

function createReviewedProjectGitFixture() {
  const repo = tempRoot('m7-windows-reviewed-repo-');
  copyReviewedProjectTree(REPO, repo);
  execFileSync('git', ['init'], { cwd: repo, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'm7-reviewed-tree@example.invalid'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'M7 Reviewed Tree Test'], { cwd: repo });
  execFileSync('git', ['config', 'core.autocrlf', 'false'], { cwd: repo });
  execFileSync('git', ['config', 'core.fileMode', 'false'], { cwd: repo });
  execFileSync('git', ['add', '--all'], { cwd: repo, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'reviewed tree fixture'], { cwd: repo, stdio: 'ignore' });
  return {
    repo,
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim()
  };
}

test.afterEach(() => {
  for (const root of temporaryRoots) fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  temporaryRoots.clear();
});

test('M7 Windows project payload policy binds Git logical modes without requiring impossible NTFS POSIX bits', () => {
  assert.equal(projectFileModePolicyForPlatform('win32'), 'WINDOWS_READONLY_ATTRIBUTE_NORMALIZED_WITH_GIT_LOGICAL_MODE_V1');
  assert.equal(expectedPayloadMode('100644', 'win32'), 0o666);
  assert.equal(expectedPayloadMode('100755', 'win32'), 0o666);
  assert.equal(normalizedProjectPayloadMode(0o666, 'win32'), 0o666);
  assert.equal(normalizedProjectPayloadMode(0o644, 'win32'), 0o666);
  assert.equal(normalizedProjectPayloadMode(0o444, 'win32'), 0o444);
});


test('M7 Windows production dependency directory policy accepts native NTFS mode observations', () => {
  assert.equal(normalizedDependencyDirectoryMode(0o40666, 'win32'), 'WINDOWS_DIRECTORY_OWNER_RWX');
  assert.equal(normalizedDependencyDirectoryMode(0o40444, 'win32'), 'WINDOWS_DIRECTORY_OWNER_RX');
  assert.equal(normalizedDependencyDirectoryMode(0o40755, 'win32'), 'WINDOWS_DIRECTORY_OWNER_RWX');
  assert.equal(normalizedDependencyDirectoryMode(0o40555, 'win32'), 'WINDOWS_DIRECTORY_OWNER_RX');
  assert.throws(
    () => normalizedDependencyDirectoryMode(0o40222, 'win32'),
    (error) => error?.reasonCode === 'WP7_PRODUCTION_DEPENDENCY_DIRECTORY_MODE_MISMATCH'
  );

  const fixtureRoot = tempRoot('m7-windows-dependency-directory-');
  const nodeModulesRoot = path.join(fixtureRoot, 'node_modules');
  fs.mkdirSync(path.join(nodeModulesRoot, 'fixture-package'), { recursive: true });
  fs.writeFileSync(path.join(nodeModulesRoot, 'fixture-package', 'index.js'), "'use strict';\n");

  fs.chmodSync(nodeModulesRoot, 0o666);
  let filesystem = walkDependencyFilesystem(nodeModulesRoot, 'win32');
  assert.equal(filesystem.directories.find((row) => row.path === 'node_modules')?.normalizedMode, 'WINDOWS_DIRECTORY_OWNER_RWX');

  fs.chmodSync(nodeModulesRoot, 0o444);
  filesystem = walkDependencyFilesystem(nodeModulesRoot, 'win32');
  assert.equal(filesystem.directories.find((row) => row.path === 'node_modules')?.normalizedMode, 'WINDOWS_DIRECTORY_OWNER_RX');

  // A real POSIX filesystem preserves 0222, while native Windows Node/NTFS
  // normalizes chmod(0222) back to the observable writable class (typically
  // 0666). Assert against the mode the host can actually expose instead of
  // requiring Windows to manufacture an impossible POSIX write-only directory.
  fs.chmodSync(nodeModulesRoot, 0o222);
  const observedMode = fs.statSync(nodeModulesRoot).mode & 0o777;
  if ((observedMode & 0o444) === 0) {
    assert.throws(
      () => walkDependencyFilesystem(nodeModulesRoot, 'win32'),
      (error) => error?.reasonCode === 'WP7_PRODUCTION_DEPENDENCY_DIRECTORY_MODE_MISMATCH'
    );
  } else {
    filesystem = walkDependencyFilesystem(nodeModulesRoot, 'win32');
    assert.equal(
      filesystem.directories.find((row) => row.path === 'node_modules')?.normalizedMode,
      normalizedDependencyDirectoryMode(observedMode, 'win32')
    );
  }
});

test('M7 final payload builder validates project modes against the target platform, not the build host', () => {
  const source = fs.readFileSync(path.join(REPO, 'tools', 'wp7', 'lib.js'), 'utf8');
  assert.match(source, /validateReviewedApplicationSourceClosure\(payloadRoot, repoRoot, identity\.sourceCommit, \{ platform: targetPlatform \}\)/);
});

test('M7 Windows source closure accepts the complete reviewed tree copied as NTFS-writable files without requiring the delivery root to be a Git repository', () => {
  const fixture = createReviewedProjectGitFixture();
  const payloadRoot = tempRoot('m7-windows-source-closure-');
  const appRoot = path.join(payloadRoot, 'resources', 'app');
  copyReviewedProjectTree(fixture.repo, appRoot);

  const closure = validateReviewedApplicationSourceClosure(payloadRoot, fixture.repo, fixture.commit, { platform: 'win32' });
  assert.equal(closure.projectFileCount, closure.gitPayloadModeRecordCount);
  assert.equal(closure.gitPayloadModePolicy, 'WINDOWS_READONLY_ATTRIBUTE_NORMALIZED_WITH_GIT_LOGICAL_MODE_V1');
  assert.ok(closure.projectFileCount > 250);
  assert.match(closure.gitPayloadModeTreeSha256, /^[0-9a-f]{64}$/);
  assert.ok(closure.gitPayloadModeRecords.every((row) => ['100644', '100755'].includes(row.gitMode)));
  assert.ok(closure.gitPayloadModeRecords.every((row) => row.actualMode === 0o666));
});

test('M7 Windows source closure rejects a read-only mutation while retaining Git mode identity', () => {
  const repo = tempRoot('m7-windows-mode-repo-');
  const payloadRoot = tempRoot('m7-windows-mode-payload-');
  const sourcePath = path.join(repo, 'backend', 'launcher.js');
  const payloadPath = path.join(payloadRoot, 'resources', 'app', 'backend', 'launcher.js');
  fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
  fs.writeFileSync(sourcePath, "'use strict';\nmodule.exports = true;\n");
  execFileSync('git', ['init'], { cwd: repo, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'm7-mode@example.invalid'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'M7 Mode Test'], { cwd: repo });
  execFileSync('git', ['add', '--all'], { cwd: repo });
  execFileSync('git', ['update-index', '--chmod=+x', 'backend/launcher.js'], { cwd: repo });
  execFileSync('git', ['commit', '-m', 'mode fixture'], { cwd: repo, stdio: 'ignore' });
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();

  fs.mkdirSync(path.dirname(payloadPath), { recursive: true });
  fs.copyFileSync(sourcePath, payloadPath);
  fs.chmodSync(payloadPath, 0o666);
  const accepted = validateReviewedApplicationSourceClosure(payloadRoot, repo, commit, { platform: 'win32' });
  assert.equal(accepted.gitPayloadModeRecords[0].gitMode, '100755');
  assert.equal(accepted.gitPayloadModeRecords[0].actualMode, 0o666);

  fs.chmodSync(payloadPath, 0o444);
  assert.throws(
    () => validateReviewedApplicationSourceClosure(payloadRoot, repo, commit, { platform: 'win32' }),
    (error) => error?.reasonCode === 'WP7_GIT_PAYLOAD_MODE_BINDING_INVALID'
      && error?.details?.modeMismatched?.[0]?.expectedMode === '0666'
      && error?.details?.modeMismatched?.[0]?.actualMode === '0444'
  );
});

test('M7 production dependency authority is refreshed for the current package metadata', () => {
  const bindingPath = path.join(REPO, 'release', 'production-dependency-binding.json');
  const binding = JSON.parse(fs.readFileSync(bindingPath, 'utf8'));
  assert.equal(binding.packageJsonSha256, sha256File(path.join(REPO, 'package.json')));
  assert.equal(binding.packageLockSha256, sha256File(path.join(REPO, 'package-lock.json')));
  assert.doesNotThrow(() => validateBindingDocument(binding));
  assert.equal(binding.platforms['win32-x64'].fileModePolicy, 'WINDOWS_READONLY_ATTRIBUTE_NORMALIZED_V1');
});


test('M7 reviewed dependency binding explicitly requires canonical exclusion of npm generated .bin shims', () => {
  const bindingPath = path.join(REPO, 'release', 'production-dependency-binding.json');
  const binding = JSON.parse(fs.readFileSync(bindingPath, 'utf8'));
  for (const key of binding.platformKeys) {
    assert.equal(binding.platforms[key].installPolicy.generatedBinShimPolicy, GENERATED_NPM_BIN_SHIM_POLICY);
  }
  const forged = structuredClone(binding);
  delete forged.platforms['win32-x64'].installPolicy.generatedBinShimPolicy;
  assert.throws(
    () => validateBindingDocument(forged),
    (error) => error?.reasonCode === 'WP7_PRODUCTION_DEPENDENCY_BINDING_INVALID'
  );
});

test('M7 production payload canonicalization removes only npm-generated top-level and nested node_modules .bin directories', () => {
  const root = tempRoot('m7-windows-bin-shim-source-');
  const source = path.join(root, 'source', 'node_modules');
  const destination = path.join(root, 'payload', 'node_modules');
  const write = (relative, content = relative) => {
    const filePath = path.join(source, ...relative.split('/'));
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf8');
  };
  write('alpha/index.js', "module.exports = 'alpha';\n");
  write('.bin/alpha', '#!/bin/sh\n');
  write('.bin/alpha.cmd', '@ECHO off\r\n');
  write('.bin/alpha.ps1', '& node alpha\r\n');
  write('alpha/node_modules/beta/index.js', "module.exports = 'beta';\n");
  write('alpha/node_modules/.bin/beta.cmd', '@ECHO off\r\n');
  write('alpha/.bin/owned-data.txt', 'must remain\n');

  const result = copyProductionDependencyTree(source, destination);
  assert.equal(result.policy, GENERATED_NPM_BIN_SHIM_POLICY);
  assert.deepEqual(result.excludedGeneratedBinDirectories, ['.bin', 'alpha/node_modules/.bin']);
  assert.equal(fs.existsSync(path.join(destination, '.bin')), false);
  assert.equal(fs.existsSync(path.join(destination, 'alpha', 'node_modules', '.bin')), false);
  assert.equal(fs.readFileSync(path.join(destination, 'alpha', 'index.js'), 'utf8'), "module.exports = 'alpha';\n");
  assert.equal(fs.readFileSync(path.join(destination, 'alpha', 'node_modules', 'beta', 'index.js'), 'utf8'), "module.exports = 'beta';\n");
  assert.equal(fs.readFileSync(path.join(destination, 'alpha', '.bin', 'owned-data.txt'), 'utf8'), 'must remain\n');
});


function fakePe(machine = 0x8664) {
  const buffer = Buffer.alloc(256, 0);
  buffer[0] = 0x4d;
  buffer[1] = 0x5a;
  buffer.writeUInt32LE(0x80, 0x3c);
  buffer.write('PE\0\0', 0x80, 'ascii');
  buffer.writeUInt16LE(machine, 0x84);
  return buffer;
}

function tarEntryNames(gzipPath) {
  const tar = zlib.gunzipSync(fs.readFileSync(gzipPath));
  const names = [];
  for (let offset = 0; offset + 512 <= tar.length; ) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const readText = (start, length) => header.subarray(start, start + length).toString('utf8').replace(/\0.*$/s, '');
    const name = readText(0, 100);
    const prefix = readText(345, 155);
    const sizeText = readText(124, 12).trim();
    const size = sizeText ? Number.parseInt(sizeText, 8) : 0;
    names.push(prefix ? `${prefix}/${name}` : name);
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return names;
}

test('M1-M10 Windows release closure resolves WP7 builder inputs without POSIX shell expansion', () => {
  const root = tempRoot('m7-builder-env-');
  const electronArchive = path.join(root, 'electron.zip');
  const electronDist = path.join(root, 'electron-dist');
  const productionNodeModules = path.join(root, 'node_modules');
  const trustedNode = path.join(root, 'node.exe');
  const trustedRcedit = path.join(root, 'rcedit.exe');
  const output = path.join(root, 'output');
  fs.writeFileSync(electronArchive, 'fixture');
  fs.mkdirSync(electronDist);
  fs.mkdirSync(productionNodeModules);
  fs.writeFileSync(trustedNode, 'fixture');
  fs.writeFileSync(trustedRcedit, 'fixture');
  const env = {
    WP7_ELECTRON_RELEASE_ARCHIVE: electronArchive,
    WP7_ELECTRON_DISTRIBUTION_ROOT: electronDist,
    WP7_PRODUCTION_NODE_MODULES: productionNodeModules,
    WP7_TRUSTED_NODE_EXECUTABLE: trustedNode,
    WP7_RCEDIT_PATH: trustedRcedit,
    WP7_PRE_REVIEW_PRODUCT_OUTPUT: output,
    WP7_PRE_REVIEW_BUILD_TIMESTAMP_UTC: '2026-07-11T00:00:00.000Z',
    WP7_PRE_REVIEW_BUILD_SESSION_ID: '0123456789abcdef',
    WP7_ALLOW_NON_WINDOWS_REVIEW_FIXTURE: '1'
  };
  const resolved = resolveBuildInputs({ argv: [], env });
  assert.equal(resolved.targetPlatform, 'win32');
  assert.equal(resolved.targetArch, 'x64');
  assert.equal(resolved.electronArchivePath, fs.realpathSync(electronArchive));
  assert.equal(resolved.productionNodeModulesSource, fs.realpathSync(productionNodeModules));
  assert.equal(resolved.rceditPath, fs.realpathSync(trustedRcedit));
  assert.throws(
    () => resolveBuildInputs({ argv: [], env: { ...env, WP7_RCEDIT_PATH: '' } }),
    (error) => error?.reasonCode === 'WP7_RCEDIT_EXECUTABLE_REQUIRED'
  );
  const builderSource = fs.readFileSync(path.join(REPO, 'tools', 'wp7', 'create-pre-review-trusted-product.js'), 'utf8');
  assert.match(builderSource, /buildFinalWindowsPayload\(\{[\s\S]*rceditPath/);
  assert.match(builderSource, /rceditSha256:\s*sha256File\(rceditPath\)/);
  assert.equal(resolved.outputRoot, path.resolve(output));
  const script = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8')).scripts['build:wp7:pre-review-product'];
  assert.equal(script, 'node tools/wp7/create-pre-review-trusted-product.js');
  assert.doesNotMatch(script, /\$WP7_|%WP7_/);
});


test('Windows branded product trust forwards the exact Electron base executable into the second distribution-tree verification', () => {
  const trustSource = fs.readFileSync(path.join(REPO, 'tools', 'wp7', 'packaged-product-trust.js'), 'utf8');
  const functionStart = trustSource.indexOf('function verifyTrustedProductExecutable(options = {})');
  const functionEnd = trustSource.indexOf('\nmodule.exports =', functionStart);
  assert.ok(functionStart >= 0 && functionEnd > functionStart);
  const functionSource = trustSource.slice(functionStart, functionEnd);
  assert.match(functionSource, /verifyElectronDistributionTree\(\{[\s\S]*baseExecutablePath:\s*path\.join\([\s\S]*options\.electronDist\s*\|\|\s*path\.join\(repoRoot,\s*'node_modules',\s*'electron',\s*'dist'\)[\s\S]*platform\s*===\s*'win32'\s*\?\s*'electron\.exe'\s*:\s*'electron'/);

  const builderSource = fs.readFileSync(path.join(REPO, 'tools', 'wp7', 'create-pre-review-trusted-product.js'), 'utf8');
  assert.match(builderSource, /verifyTrustedProductExecutable\(\{[\s\S]*electronArchivePath,\s*electronDist,[\s\S]*productExecutablePath/);

  const verifierSource = fs.readFileSync(path.join(REPO, 'tools', 'wp7', 'verify.js'), 'utf8');
  assert.match(verifierSource, /wp7-convergence-correction-matrix[\s\S]*timeout:\s*1800000/);
});

test('M1-M10 Windows release closure creates deterministic trusted product tar.gz without external tar', () => {
  const root = tempRoot('m7-deterministic-archive-');
  const staging = path.join(root, 'staging');
  const payload = path.join(staging, 'application-payload');
  fs.mkdirSync(path.join(payload, 'resources', 'app'), { recursive: true });
  fs.writeFileSync(path.join(payload, 'Yance.exe'), fakePe());
  fs.writeFileSync(path.join(payload, 'resources', 'app', 'index.js'), "'use strict';\n");
  const first = path.join(root, 'first.tar.gz');
  const second = path.join(root, 'second.tar.gz');
  const options = { sourceRoot: staging, entryRoot: 'application-payload', timestamp: '2026-07-11T00:00:00.000Z', targetPlatform: 'win32' };
  createDeterministicTarGzip({ ...options, outputPath: first });
  createDeterministicTarGzip({ ...options, outputPath: second });
  assert.deepEqual(fs.readFileSync(first), fs.readFileSync(second));
  assert.deepEqual(tarEntryNames(first), [
    'application-payload',
    'application-payload/Yance.exe',
    'application-payload/resources',
    'application-payload/resources/app',
    'application-payload/resources/app/index.js'
  ]);
});

test('M1-M10 Windows release closure binds native scan evidence as controlled metadata', () => {
  assert.equal(CONTROLLED_METADATA_PATHS.has('resources/evidence/native-binary-scan.json'), true);
  const root = tempRoot('m7-native-closure-');
  const exe = path.join(root, 'Yance.exe');
  const dll = path.join(root, 'ffmpeg.dll');
  const addon = path.join(root, 'resources', 'app', 'node_modules', 'fixture', 'fixture.node');
  fs.mkdirSync(path.dirname(addon), { recursive: true });
  for (const file of [exe, dll, addon]) fs.writeFileSync(file, fakePe(0x8664));
  const evidenceFile = path.join(root, 'resources', 'evidence', 'native-binary-scan.json');
  const first = verifyNativeBinaries({ payloadRoot: root, evidenceFile, targetPlatform: 'win32', targetArch: 'x64', generatedAtUtc: '2026-07-11T00:00:00.000Z' });
  assert.equal(first.status, 'PASS');
  assert.equal(first.fileCount, 3);
  assert.deepEqual(fs.readFileSync(evidenceFile), nativeBinaryCanonicalBuffer(first));
  fs.writeFileSync(dll, fakePe(0x14c));
  const second = verifyNativeBinaries({ payloadRoot: root, writeEvidence: false, targetPlatform: 'win32', targetArch: 'x64', generatedAtUtc: '2026-07-11T00:00:00.000Z' });
  assert.equal(second.status, 'FAIL');
  assert.match(JSON.stringify(second), /WP7_NATIVE_MACHINE_NOT_X64/);
});

test('M1-M10 Windows release closure preserves Electron logical unixMode while validating NTFS mode classes', () => {
  const root = tempRoot('m7-electron-mode-');
  const executable = path.join(root, 'Yance.exe');
  const resource = path.join(root, 'resources.pak');
  fs.writeFileSync(executable, 'electron');
  fs.writeFileSync(resource, 'resource');
  fs.chmodSync(executable, 0o666);
  fs.chmodSync(resource, 0o666);
  const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
  const official = [
    { path: 'electron.exe', sizeBytes: 8, sha256: hash('electron'), unixMode: 0o100755 },
    { path: 'resources.pak', sizeBytes: 8, sha256: hash('resource'), unixMode: 0o100644 }
  ];
  const accepted = compareElectronDistributionTree({ payloadRoot: root, archiveExecutableEntry: 'electron.exe', productExecutableName: 'Yance.exe', officialRecords: official, platform: 'win32' });
  assert.equal(accepted.modeBoundFileCount, 2);
  fs.chmodSync(resource, 0o444);
  assert.throws(
    () => compareElectronDistributionTree({ payloadRoot: root, archiveExecutableEntry: 'electron.exe', productExecutableName: 'Yance.exe', officialRecords: official, platform: 'win32' }),
    (error) => error?.reasonCode === 'WP7_ELECTRON_DISTRIBUTION_TREE_TRUST_NOT_ENFORCED'
      && error?.details?.modeMismatched?.[0]?.expectedMode === '0666'
      && error?.details?.modeMismatched?.[0]?.actualMode === '0444'
  );
});


test('M1-M10 Windows release closure uses the canonical M6 bundled Node path without a private bin subdirectory', () => {
  assert.equal(runtimeExecutableName('win32'), 'node.exe');
  assert.equal(runtimeExecutableName('linux'), 'node');
  const runtimeSource = fs.readFileSync(path.join(REPO, 'tools', 'wp7', 'node-runtime-identity.js'), 'utf8');
  const builderSource = fs.readFileSync(path.join(REPO, 'tools', 'wp7', 'lib.js'), 'utf8');
  assert.doesNotMatch(runtimeSource, /`bin\/\$\{runtimeExecutableName/);
  assert.ok(builderSource.includes("/^runtime\\/node22\\/(?:node|node\\.exe)$/"));
  const releaseLayout = require('../../electron/m2/releaseLayout');
  assert.deepEqual(releaseLayout.LAYOUTS.production.runtimeNodeDir, ['runtime', 'node22', 'node.exe']);
});


test('M1-M10 Windows release closure binds native scan identity through payload filesystem identity and pre-review seal', () => {
  const hash = (digit) => digit.repeat(64);
  const base = {
    applicationPayloadSha256: hash('1'),
    productionDependencyFileTreeSha256: hash('2'),
    productionDependencyModeTreeSha256: hash('3'),
    productionDependencyDirectoryModeTreeSha256: hash('4'),
    gitPayloadModeTreeSha256: hash('5'),
    electronDistributionTreeSha256: hash('6'),
    nodeRuntimeTreeSha256: hash('7'),
    nativeBinaryScanSha256: hash('8')
  };
  const first = applicationPayloadFilesystemIdentitySha256(base);
  const second = applicationPayloadFilesystemIdentitySha256({ ...base, nativeBinaryScanSha256: hash('9') });
  assert.notEqual(first, second);

  const root = tempRoot('m7-native-seal-');
  const file = path.join(root, 'WP7_PRE_REVIEW_SEALED_ARTIFACT.json');
  const sealData = {
    generatedAtUtc: '2026-07-11T00:00:00.000Z',
    buildSessionId: 'a'.repeat(32),
    buildId: 'release-closure-test',
    sourceCommit: 'b'.repeat(40),
    sourceTree: 'c'.repeat(40),
    electronReleaseArchiveSha256: hash('1'),
    productExecutableSha256: hash('2'),
    releaseManifestSha256: hash('3'),
    applicationPayloadSha256: hash('4'),
    applicationPayloadFilesystemIdentitySha256: first,
    payloadFilesSha256: hash('5'),
    productionDependencyBindingSha256: hash('6'),
    productionDependencyPackageGraphSha256: hash('7'),
    productionDependencyFileTreeSha256: hash('8'),
    productionDependencyModeTreeSha256: hash('9'),
    productionDependencyDirectoryModeTreeSha256: hash('a'),
    gitPayloadModeTreeSha256: hash('b'),
    electronDistributionTreeSha256: hash('c'),
    nodeRuntimeExecutableSha256: hash('d'),
    nodeRuntimeTreeSha256: hash('e'),
    nativeBinaryScanSha256: base.nativeBinaryScanSha256
  };
  const created = createPreReviewSealedArtifact(file, sealData);
  assert.equal(created.document.nativeBinaryScanSha256, base.nativeBinaryScanSha256);
  readAndVerifyPreReviewSealedArtifact(file, { nativeBinaryScanSha256: base.nativeBinaryScanSha256 });
  assert.throws(
    () => readAndVerifyPreReviewSealedArtifact(file, { nativeBinaryScanSha256: hash('f') }),
    (error) => error?.reasonCode === 'WP7_PRE_REVIEW_SEALED_ARTIFACT_IDENTITY_MISMATCH'
  );
});


test('M1-M10 Windows release closure resolves CLI arguments before environment fallbacks without shell dialect syntax', () => {
  assert.equal(optionValue('--input', { argv: ['node', 'tool', '--input', 'cli-value'], env: { WP7_INPUT: 'env-value' }, envName: 'WP7_INPUT' }), 'cli-value');
  assert.equal(optionValue('--input', { argv: ['node', 'tool'], env: { WP7_INPUT: 'env-value' }, envName: 'WP7_INPUT' }), 'env-value');
  assert.equal(optionValue('--input', { argv: ['node', 'tool'], env: {}, envName: 'WP7_INPUT', fallback: 'fallback' }), 'fallback');
  assert.equal(numericOption('--timeout-ms', { argv: ['node', 'tool', '--timeout-ms', '9000'], env: {}, fallback: 1 }), 9000);
  assert.throws(
    () => optionValue('--input', { argv: ['node', 'tool', '--input', '--other'], env: {} }),
    (error) => error?.reasonCode === 'WP7_CLI_ARGUMENT_VALUE_MISSING'
  );
  assert.throws(
    () => numericOption('--timeout-ms', { argv: ['node', 'tool'], env: { WP7_TIMEOUT: 'not-a-number' }, envName: 'WP7_TIMEOUT' }),
    (error) => error?.reasonCode === 'WP7_CLI_ARGUMENT_VALUE_INVALID'
  );

  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
  for (const scriptName of [
    'evidence:wp7:pre-review',
    'test:wp7:packaged-electron',
    'create:wp7:pre-review-candidate',
    'verify:wp7:pre-review-candidate'
  ]) {
    const script = String(pkg.scripts[scriptName] || '');
    assert.match(script, /^node tools\/wp7\/[A-Za-z0-9._-]+\.js$/);
    assert.doesNotMatch(script, /\$WP7_|%WP7_|\b(?:sh|bash|cmd|powershell)\b/i);
  }
});

test('M1-M10 Windows release closure creates byte-identical candidate ZIP archives without external zip', async () => {
  const yauzl = require('yauzl');
  const root = tempRoot('m7-deterministic-zip-');
  const packName = 'candidate-pack';
  const packRoot = path.join(root, packName);
  fs.mkdirSync(path.join(packRoot, 'nested'), { recursive: true });
  fs.writeFileSync(path.join(packRoot, 'alpha.txt'), 'alpha\n');
  fs.writeFileSync(path.join(packRoot, 'nested', 'beta.txt'), 'beta\n');
  const first = path.join(root, 'first.zip');
  const second = path.join(root, 'second.zip');
  const firstResult = createDeterministicZip({ sourceRoot: root, entryRoot: packName, outputPath: first });
  const secondResult = createDeterministicZip({ sourceRoot: root, entryRoot: packName, outputPath: second });
  assert.equal(firstResult.implementation, 'NODE_DETERMINISTIC_ZIP_STORE_V1');
  assert.equal(firstResult.entryCount, 2);
  assert.deepEqual(fs.readFileSync(first), fs.readFileSync(second));

  const entries = await new Promise((resolve, reject) => {
    yauzl.open(first, { lazyEntries: true }, (error, zip) => {
      if (error) return reject(error);
      const names = [];
      zip.readEntry();
      zip.on('entry', (entry) => { names.push(entry.fileName); zip.readEntry(); });
      zip.on('error', reject);
      zip.on('end', () => resolve(names));
    });
  });
  assert.deepEqual(entries, ['candidate-pack/alpha.txt', 'candidate-pack/nested/beta.txt']);

  const candidateSource = fs.readFileSync(path.join(REPO, 'tools', 'wp7', 'create-convergence-pre-review-candidate.js'), 'utf8');
  assert.match(candidateSource, /createDeterministicZip/);
  assert.doesNotMatch(candidateSource, /run\(['"]zip['"]/);
});


test('M1-M10 Windows release closure independently verifies outer candidate ZIP as an exact packRoot projection', async () => {
  const root = tempRoot('m7-candidate-outer-zip-');
  const packName = 'candidate-pack';
  const packRoot = path.join(root, packName);
  fs.mkdirSync(path.join(packRoot, 'delivery'), { recursive: true });
  fs.writeFileSync(path.join(packRoot, 'delivery', 'record.json'), '{"status":"PASS"}\n');
  fs.writeFileSync(path.join(packRoot, 'README.txt'), 'candidate\n');
  const zipPath = path.join(root, `${packName}.zip`);
  createDeterministicZip({ sourceRoot: root, entryRoot: packName, outputPath: zipPath });
  const accepted = await verifyOuterCandidateZip(packRoot, zipPath);
  assert.equal(accepted.fileCount, 2);
  assert.equal(accepted.missing, 0);
  assert.equal(accepted.extra, 0);
  fs.writeFileSync(path.join(packRoot, 'README.txt'), 'mutated\n');
  await assert.rejects(
    () => verifyOuterCandidateZip(packRoot, zipPath),
    (error) => error?.reasonCode === 'WP7_CANDIDATE_OUTER_ZIP_INVALID'
  );
});
