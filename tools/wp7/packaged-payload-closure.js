'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');
const wp1 = require('../wp1/lib');
const { loadReleaseIdentity } = require('../../shared/release/releaseIdentity');
const { verifyProductionDependencyClosure } = require('./production-dependency-binding');
const { applicationPayloadFilesystemIdentitySha256 } = require('./filesystem-identity');
const { inspectTrustedNodeRuntime, validateManifestRuntimeIdentity } = require('./node-runtime-identity');
const { canonicalBuffer: nativeBinaryCanonicalBuffer, verifyNativeBinaries } = require('./verify-native-binaries');
const { validateProductionRuntimeSourceDependencies } = require('./runtime-source-dependency-closure');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const PROJECT_ROOTS = Object.freeze(['backend', 'frontend', 'shared', 'electron', 'diagnostics', 'release']);
const PROJECT_FILES = Object.freeze(['package.json', 'package-lock.json', 'installer/installedIdentityReceipt.js']);
const CONTROLLED_METADATA_PATHS = new Set([
  'resources/payload-files.json',
  'resources/release-manifest.json',
  'resources/release-manifest.sha256',
  'resources/installer-release-identity.json',
  'resources/installer-release-identity.sha256',
  'resources/evidence/native-binary-scan.json'
]);
const PROJECT_FILE_MODE_POLICIES = Object.freeze({
  darwin: 'POSIX_GIT_BLOB_MODE_EXACT_V1',
  linux: 'POSIX_GIT_BLOB_MODE_EXACT_V1',
  win32: 'WINDOWS_READONLY_ATTRIBUTE_NORMALIZED_WITH_GIT_LOGICAL_MODE_V1'
});

function fail(reasonCode, message, details = {}) {
  const error = new Error(message);
  error.reasonCode = reasonCode;
  error.details = details;
  throw error;
}
function sha256Buffer(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function sha256File(filePath) { return sha256Buffer(fs.readFileSync(filePath)); }
function normalize(relativePath) {
  const raw = String(relativePath || '').replace(/\\/g, '/').normalize('NFC');
  if (!raw || raw.startsWith('/') || /^[A-Za-z]:/.test(raw) || raw.includes('\0')) fail('WP7_PACKAGED_APPLICATION_PAYLOAD_CLOSURE_NOT_ENFORCED', 'payload path is not relative and canonical', { relativePath });
  const parts = raw.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) fail('WP7_PACKAGED_APPLICATION_PAYLOAD_CLOSURE_NOT_ENFORCED', 'payload path contains unsafe segments', { relativePath });
  return raw;
}
function walkFiles(rootDir) {
  const root = fs.realpathSync(path.resolve(rootDir));
  const output = [];
  const exact = new Set();
  const folded = new Map();
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => Buffer.from(a.name).compare(Buffer.from(b.name)))) {
      const fullPath = path.join(directory, entry.name);
      const relative = normalize(path.relative(root, fullPath).split(path.sep).join('/'));
      if (entry.isSymbolicLink()) fail('WP7_PACKAGED_APPLICATION_PAYLOAD_CLOSURE_NOT_ENFORCED', 'symbolic links are forbidden in packaged payload', { relative });
      if (entry.isDirectory()) visit(fullPath);
      else if (entry.isFile()) {
        if (exact.has(relative)) fail('WP7_PACKAGED_APPLICATION_PAYLOAD_CLOSURE_NOT_ENFORCED', 'duplicate packaged payload path', { relative });
        const lower = relative.toLowerCase();
        if (folded.has(lower) && folded.get(lower) !== relative) fail('WP7_PACKAGED_APPLICATION_PAYLOAD_CLOSURE_NOT_ENFORCED', 'Windows case-fold payload collision', { relative, collidesWith: folded.get(lower) });
        exact.add(relative); folded.set(lower, relative);
        const stat = fs.statSync(fullPath);
        output.push({ path: relative, sizeBytes: stat.size, sha256: sha256File(fullPath), mode: stat.mode & 0o777, fullPath });
      } else fail('WP7_PACKAGED_APPLICATION_PAYLOAD_CLOSURE_NOT_ENFORCED', 'unsupported filesystem object in packaged payload', { relative });
    }
  }
  visit(root);
  return output.sort((a, b) => Buffer.from(a.path).compare(Buffer.from(b.path)));
}
function projectFileModePolicyForPlatform(platform = process.platform) {
  const policy = PROJECT_FILE_MODE_POLICIES[platform];
  if (!policy) fail('WP7_GIT_PAYLOAD_MODE_BINDING_INVALID', 'reviewed project file mode policy is unsupported', { platform });
  return policy;
}
function normalizedProjectPayloadMode(statMode, platform = process.platform) {
  projectFileModePolicyForPlatform(platform);
  const rawMode = Number(statMode) & 0o777;
  if (platform === 'win32') {
    if ((rawMode & 0o444) === 0) fail('WP7_GIT_PAYLOAD_MODE_BINDING_INVALID', 'Windows packaged project file is not readable', { rawMode: rawMode.toString(8).padStart(4, '0') });
    return (rawMode & 0o222) !== 0 ? 0o666 : 0o444;
  }
  return rawMode;
}
function expectedPayloadMode(gitMode, platform = process.platform) {
  projectFileModePolicyForPlatform(platform);
  if (gitMode !== '100644' && gitMode !== '100755') {
    fail('WP7_GIT_PAYLOAD_MODE_BINDING_INVALID', 'reviewed Git blob mode is unsupported', { gitMode });
  }
  if (platform === 'win32') return 0o666;
  if (gitMode === '100644') return 0o644;
  if (gitMode === '100755') return 0o755;
  fail('WP7_GIT_PAYLOAD_MODE_BINDING_INVALID', 'reviewed Git blob mode is unsupported', { gitMode });
}
function gitPayloadModeTreeSha256(records) {
  return sha256Buffer(Buffer.from(records.map((row) => `${row.payloadPath}\0${row.gitMode}\0${row.actualMode.toString(8).padStart(4, '0')}\0${row.sizeBytes}\0${row.sha256}\n`).join(''), 'utf8'));
}
function recordsEqual(expected, actual) {
  if (expected.length !== actual.length) return false;
  return expected.every((row, index) => row.path === actual[index].path && row.sizeBytes === actual[index].sizeBytes && row.sha256 === actual[index].sha256);
}
function parsePayloadFiles(payloadFilesPath) {
  let document;
  try { document = JSON.parse(fs.readFileSync(payloadFilesPath, 'utf8')); }
  catch (error) { fail('WP7_PACKAGED_APPLICATION_PAYLOAD_CLOSURE_NOT_ENFORCED', 'payload-files.json is invalid JSON', { payloadFilesPath, message: error.message }); }
  if (!document || document.schemaVersion !== 1 || !Array.isArray(document.files)) fail('WP7_PACKAGED_APPLICATION_PAYLOAD_CLOSURE_NOT_ENFORCED', 'payload-files.json schema is invalid', { payloadFilesPath });
  let records;
  try { records = wp1.canonicalizePayloadRecords(document.files); }
  catch (error) { fail('WP7_PACKAGED_APPLICATION_PAYLOAD_CLOSURE_NOT_ENFORCED', 'payload-files.json records are invalid', { reasonCode: error.reasonCode, message: error.message }); }
  return { document, records };
}
function git(args, repoRoot = REPO_ROOT, encoding = 'utf8') {
  try { return execFileSync('git', args, { cwd: repoRoot, encoding, maxBuffer: 128 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (error) { fail('WP7_PACKAGED_APPLICATION_SOURCE_BINDING_INVALID', 'cannot resolve reviewed Git source', { args, stderr: String(error.stderr || '') }); }
}
function readGitBlobsBatch(repoRoot, objectIds) {
  const ids = [...new Set(objectIds)];
  if (!ids.length) return new Map();
  const result = spawnSync('git', ['cat-file', '--batch'], {
    cwd: repoRoot,
    input: Buffer.from(`${ids.join('\n')}\n`, 'utf8'),
    encoding: null,
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe']
  });
  if (result.status !== 0) fail('WP7_PACKAGED_APPLICATION_SOURCE_BINDING_INVALID', 'cannot batch-read reviewed Git blobs', { stderr: String(result.stderr || '') });
  const output = result.stdout;
  const blobs = new Map();
  let offset = 0;
  for (const requested of ids) {
    const newline = output.indexOf(0x0a, offset);
    if (newline < 0) fail('WP7_PACKAGED_APPLICATION_SOURCE_BINDING_INVALID', 'Git batch blob header is truncated', { requested });
    const header = output.subarray(offset, newline).toString('utf8');
    const match = header.match(/^([0-9a-f]{40}) blob (\d+)$/);
    if (!match || match[1] !== requested) fail('WP7_PACKAGED_APPLICATION_SOURCE_BINDING_INVALID', 'Git batch blob header is invalid', { requested, header });
    const size = Number(match[2]);
    const start = newline + 1;
    const end = start + size;
    if (!Number.isSafeInteger(size) || end >= output.length || output[end] !== 0x0a) fail('WP7_PACKAGED_APPLICATION_SOURCE_BINDING_INVALID', 'Git batch blob body is truncated', { requested, size });
    blobs.set(requested, output.subarray(start, end));
    offset = end + 1;
  }
  return blobs;
}
function reviewedProjectEntries(repoRoot, sourceCommit) {
  const raw = git(['ls-tree', '-r', '-z', '--full-tree', sourceCommit, '--', ...PROJECT_ROOTS, ...PROJECT_FILES], repoRoot, 'buffer');
  const metadata = [];
  for (const part of raw.toString('utf8').split('\0').filter(Boolean)) {
    const match = part.match(/^(\d+)\s+blob\s+([0-9a-f]{40})\t(.+)$/s);
    if (!match) continue;
    const sourcePath = normalize(match[3]);
    if (sourcePath.startsWith('backend/tests/')) continue;
    const top = sourcePath.split('/')[0];
    if (!PROJECT_ROOTS.includes(top) && !PROJECT_FILES.includes(sourcePath)) continue;
    metadata.push({ sourcePath, payloadPath: `resources/app/${sourcePath}`, mode: match[1], blob: match[2] });
  }
  const blobs = readGitBlobsBatch(repoRoot, metadata.map((row) => row.blob));
  return metadata.map((row) => {
    const bytes = blobs.get(row.blob);
    return { ...row, sizeBytes: bytes.length, sha256: sha256Buffer(bytes) };
  }).sort((a, b) => Buffer.from(a.payloadPath).compare(Buffer.from(b.payloadPath)));
}
function validateReviewedApplicationSourceClosure(payloadRoot, repoRoot, sourceCommit, options = {}) {
  const runtimeDependencyClosure = validateProductionRuntimeSourceDependencies({ repoRoot });
  const root = fs.realpathSync(path.resolve(payloadRoot));
  const platform = options.platform || process.platform;
  const modePolicy = projectFileModePolicyForPlatform(platform);
  const appRoot = path.join(root, 'resources', 'app');
  const expected = reviewedProjectEntries(repoRoot, sourceCommit);
  const expectedMap = new Map(expected.map((row) => [row.payloadPath, row]));
  const actualProject = [];
  for (const rootName of PROJECT_ROOTS) {
    const projectRoot = path.join(appRoot, rootName);
    if (!fs.existsSync(projectRoot) || !fs.statSync(projectRoot).isDirectory()) continue;
    for (const row of walkFiles(projectRoot)) actualProject.push({ ...row, payloadPath: `resources/app/${rootName}/${row.path}` });
  }
  for (const fileName of PROJECT_FILES) {
    const fullPath = path.join(appRoot, fileName);
    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) continue;
    const stat = fs.statSync(fullPath);
    actualProject.push({ path: fileName, payloadPath: `resources/app/${fileName}`, sizeBytes: stat.size, sha256: sha256File(fullPath), mode: stat.mode & 0o777, fullPath });
  }
  actualProject.sort((a, b) => Buffer.from(a.payloadPath).compare(Buffer.from(b.payloadPath)));
  const actualMap = new Map(actualProject.map((row) => [row.payloadPath, row]));
  const missing = expected.filter((row) => !actualMap.has(row.payloadPath)).map((row) => row.payloadPath);
  const extra = actualProject.filter((row) => !expectedMap.has(row.payloadPath)).map((row) => row.payloadPath);
  const mismatched = expected.filter((row) => {
    const actual = actualMap.get(row.payloadPath);
    return actual && (actual.sizeBytes !== row.sizeBytes || actual.sha256 !== row.sha256);
  }).map((row) => ({ path: row.payloadPath, expectedSha256: row.sha256, actualSha256: actualMap.get(row.payloadPath)?.sha256 }));
  const modeMismatched = expected.filter((row) => {
    const actual = actualMap.get(row.payloadPath);
    return actual && normalizedProjectPayloadMode(actual.mode, platform) !== expectedPayloadMode(row.mode, platform);
  }).map((row) => ({
    path: row.payloadPath,
    platform,
    modePolicy,
    gitMode: row.mode,
    expectedMode: expectedPayloadMode(row.mode, platform).toString(8).padStart(4, '0'),
    actualMode: normalizedProjectPayloadMode(actualMap.get(row.payloadPath)?.mode, platform).toString(8).padStart(4, '0'),
    nativeMode: actualMap.get(row.payloadPath)?.mode.toString(8).padStart(4, '0')
  }));
  if (missing.length || extra.length || mismatched.length || modeMismatched.length) {
    fail(modeMismatched.length ? 'WP7_GIT_PAYLOAD_MODE_BINDING_INVALID' : 'WP7_PACKAGED_APPLICATION_SOURCE_BINDING_INVALID', 'resources/app project code and file modes are not an exact projection of the reviewed Git commit', { sourceCommit, missing, extra, mismatched, modeMismatched });
  }
  const modeRecords = expected.map((row) => ({
    payloadPath: row.payloadPath,
    gitMode: row.mode,
    actualMode: normalizedProjectPayloadMode(actualMap.get(row.payloadPath).mode, platform),
    sizeBytes: row.sizeBytes,
    sha256: row.sha256
  }));
  return Object.freeze({
    sourceCommit,
    projectFileCount: expected.length,
    projectFiles: expected,
    gitPayloadModePolicy: modePolicy,
    gitPayloadModeRecordCount: modeRecords.length,
    gitPayloadModeTreeSha256: gitPayloadModeTreeSha256(modeRecords),
    gitPayloadModeRecords: modeRecords,
    runtimeDependencyClosure
  });
}
function validateApplicationPayloadClosure(payloadRoot, resourcesRoot, options = {}) {
  const root = fs.realpathSync(path.resolve(payloadRoot));
  const resources = fs.realpathSync(path.resolve(resourcesRoot || path.join(root, 'resources')));
  if (resources !== path.join(root, 'resources')) fail('WP7_PACKAGED_APPLICATION_PAYLOAD_CLOSURE_NOT_ENFORCED', 'resources root is not inside the packaged payload root', { root, resources });
  const payloadFilesPath = path.join(resources, 'payload-files.json');
  const releaseManifestPath = path.join(resources, 'release-manifest.json');
  const detachedHashPath = path.join(resources, 'release-manifest.sha256');
  for (const filePath of [payloadFilesPath, releaseManifestPath, detachedHashPath]) if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) fail('WP7_PACKAGED_APPLICATION_PAYLOAD_CLOSURE_NOT_ENFORCED', 'packaged payload metadata is missing', { filePath });
  const identity = loadReleaseIdentity({ manifestPath: releaseManifestPath, detachedHashPath, consumer: 'packaged-payload-closure' });
  const nativeBinaryEvidencePath = path.join(resources, 'evidence', 'native-binary-scan.json');
  if (!fs.existsSync(nativeBinaryEvidencePath) || !fs.statSync(nativeBinaryEvidencePath).isFile()) {
    fail('WP7_NATIVE_BINARY_SCAN_EVIDENCE_MISSING', 'native binary scan evidence is missing from packaged resources', { nativeBinaryEvidencePath });
  }
  const nativeBinaryEvidenceSha256 = sha256File(nativeBinaryEvidencePath);
  if (nativeBinaryEvidenceSha256 !== identity.nativeBinaryScanSha256) {
    fail('WP7_NATIVE_BINARY_SCAN_IDENTITY_MISMATCH', 'native binary scan evidence SHA256 does not match the verified release manifest', { expected: identity.nativeBinaryScanSha256, actual: nativeBinaryEvidenceSha256 });
  }
  const recomputedNativeBinaryScan = verifyNativeBinaries({
    payloadRoot: root,
    writeEvidence: false,
    targetPlatform: options.platform || process.platform,
    targetArch: options.arch || process.arch,
    generatedAtUtc: identity.buildTimestampUtc
  });
  const recomputedNativeBinarySha256 = sha256Buffer(nativeBinaryCanonicalBuffer(recomputedNativeBinaryScan));
  if (recomputedNativeBinaryScan.status !== 'PASS' || recomputedNativeBinarySha256 !== identity.nativeBinaryScanSha256 || recomputedNativeBinaryScan.fileCount !== identity.nativeBinaryFileCount || recomputedNativeBinaryScan.failureCount !== identity.nativeBinaryFailureCount) {
    fail('WP7_NATIVE_BINARY_SCAN_IDENTITY_MISMATCH', 'recomputed native binary scan does not match the verified release manifest', {
      expectedSha256: identity.nativeBinaryScanSha256,
      actualSha256: recomputedNativeBinarySha256,
      expectedFileCount: identity.nativeBinaryFileCount,
      actualFileCount: recomputedNativeBinaryScan.fileCount,
      expectedFailureCount: identity.nativeBinaryFailureCount,
      actualFailureCount: recomputedNativeBinaryScan.failureCount,
      status: recomputedNativeBinaryScan.status
    });
  }
  const payloadFilesSha256 = sha256File(payloadFilesPath);
  if (payloadFilesSha256 !== identity.payloadFilesSha256) fail('WP7_PACKAGED_APPLICATION_PAYLOAD_CLOSURE_NOT_ENFORCED', 'payload-files.json SHA256 does not match the verified release manifest', { expected: identity.payloadFilesSha256, actual: payloadFilesSha256 });
  const parsed = parsePayloadFiles(payloadFilesPath);
  const actualRecords = wp1.generatePayloadRecords(root, { excludedPaths: CONTROLLED_METADATA_PATHS });
  if (!recordsEqual(parsed.records, actualRecords)) {
    const expectedMap = new Map(parsed.records.map((row) => [row.path, row]));
    const actualMap = new Map(actualRecords.map((row) => [row.path, row]));
    const missing = parsed.records.filter((row) => !actualMap.has(row.path)).map((row) => row.path);
    const extra = actualRecords.filter((row) => !expectedMap.has(row.path)).map((row) => row.path);
    const mismatched = parsed.records.filter((row) => actualMap.has(row.path) && (actualMap.get(row.path).sha256 !== row.sha256 || actualMap.get(row.path).sizeBytes !== row.sizeBytes)).map((row) => ({ path: row.path, expected: row, actual: actualMap.get(row.path) }));
    fail('WP7_PACKAGED_APPLICATION_PAYLOAD_CLOSURE_NOT_ENFORCED', 'actual packaged payload records do not exactly match payload-files.json', { missing, extra, mismatched });
  }
  const applicationPayloadSha256 = wp1.applicationPayloadSha256(actualRecords);
  if (applicationPayloadSha256 !== identity.applicationPayloadSha256) fail('WP7_PACKAGED_APPLICATION_PAYLOAD_CLOSURE_NOT_ENFORCED', 'recomputed application payload SHA256 does not match the verified release manifest', { expected: identity.applicationPayloadSha256, actual: applicationPayloadSha256 });
  const repoRoot = path.resolve(options.repoRoot || REPO_ROOT);
  const source = validateReviewedApplicationSourceClosure(root, repoRoot, identity.sourceCommit, { platform: options.platform || process.platform });
  const dependencies = verifyProductionDependencyClosure({
    repoRoot,
    appRoot: path.join(root, 'resources', 'app'),
    sourceCommit: identity.sourceCommit,
    platform: options.platform || process.platform,
    arch: options.arch || process.arch
  });
  const nodeRuntime = inspectTrustedNodeRuntime({
    runtimeRoot: path.join(resources, 'runtime', 'node22'),
    executableRelativePath: String(identity.nodeRuntimeExecutablePath || '').replace(/^runtime\/node22\//, ''),
    platform: options.platform || process.platform
  });
  validateManifestRuntimeIdentity(identity, nodeRuntime);
  const applicationPayloadFilesystemIdentity = applicationPayloadFilesystemIdentitySha256({
    applicationPayloadSha256,
    productionDependencyFileTreeSha256: dependencies.dependencyFileTreeSha256,
    productionDependencyModeTreeSha256: dependencies.dependencyModeTreeSha256,
    productionDependencyDirectoryModeTreeSha256: dependencies.dependencyDirectoryModeTreeSha256,
    gitPayloadModeTreeSha256: source.gitPayloadModeTreeSha256,
    electronDistributionTreeSha256: identity.electronDistributionTreeSha256,
    nodeRuntimeTreeSha256: nodeRuntime.runtimeTreeSha256,
    nativeBinaryScanSha256: recomputedNativeBinarySha256
  });
  if (applicationPayloadFilesystemIdentity !== identity.applicationPayloadFilesystemIdentitySha256) fail('WP7_APPLICATION_PAYLOAD_FILESYSTEM_IDENTITY_INVALID', 'recomputed payload content and filesystem mode identity does not match the release manifest', { expected: identity.applicationPayloadFilesystemIdentitySha256, actual: applicationPayloadFilesystemIdentity });
  const allFiles = walkFiles(root);
  const metadata = allFiles.filter((row) => CONTROLLED_METADATA_PATHS.has(row.path));
  return Object.freeze({ root, resources, payloadFilesPath, payloadFilesSha256, releaseManifestPath, identity, records: actualRecords, applicationPayloadSha256, applicationPayloadFilesystemIdentitySha256: applicationPayloadFilesystemIdentity, metadata, source, dependencies, nodeRuntime, nativeBinaryScan: recomputedNativeBinaryScan, nativeBinaryScanSha256: recomputedNativeBinarySha256 });
}

module.exports = {
  CONTROLLED_METADATA_PATHS,
  PROJECT_FILES,
  PROJECT_FILE_MODE_POLICIES,
  PROJECT_ROOTS,
  parsePayloadFiles,
  recordsEqual,
  reviewedProjectEntries,
  expectedPayloadMode,
  gitPayloadModeTreeSha256,
  normalizedProjectPayloadMode,
  projectFileModePolicyForPlatform,
  validateApplicationPayloadClosure,
  validateReviewedApplicationSourceClosure,
  walkFiles
};
