'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const BINDING_RELATIVE_PATH = 'release/production-dependency-binding.json';
const SHA256_RE = /^[0-9a-f]{64}$/;
const POSIX_MODE_RE = /^0[0-7]{3}$/;
const FILE_MODE_POLICIES = Object.freeze({
  linux: 'POSIX_0777_EXACT_NO_GROUP_OR_WORLD_WRITE_V1',
  win32: 'WINDOWS_READONLY_ATTRIBUTE_NORMALIZED_V1'
});
const DIRECTORY_MODE_POLICIES = Object.freeze({
  linux: 'POSIX_DIRECTORY_0777_EXACT_OWNER_RX_NO_GROUP_OR_WORLD_WRITE_V1',
  win32: 'WINDOWS_DIRECTORY_ACCESS_CLASS_NORMALIZED_OWNER_RX_V1'
});
const WINDOWS_DIRECTORY_MODES = Object.freeze(['WINDOWS_DIRECTORY_OWNER_RX', 'WINDOWS_DIRECTORY_OWNER_RWX']);
const GENERATED_NPM_BIN_SHIM_POLICY = 'NPM_DOT_BIN_DIRECTORIES_EXCLUDED_FROM_PACKAGED_PAYLOAD_V1';

function fail(reasonCode, message, details = {}) {
  const error = new Error(message);
  error.reasonCode = reasonCode;
  error.details = details;
  throw error;
}
function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== 'object' || Buffer.isBuffer(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortValue(value[key])]));
}
function canonicalBuffer(value) { return Buffer.from(`${JSON.stringify(sortValue(value), null, 2)}\n`, 'utf8'); }
function sha256Buffer(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function sha256File(filePath) { return sha256Buffer(fs.readFileSync(filePath)); }
function readJson(filePath) { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
function normalize(relativePath) {
  const raw = String(relativePath || '').replace(/\\/g, '/').normalize('NFC');
  if (!raw || raw.startsWith('/') || /^[A-Za-z]:/.test(raw) || raw.includes('\0')) fail('WP7_PRODUCTION_DEPENDENCY_BINDING_INVALID', 'dependency path is not relative and canonical', { relativePath });
  const parts = raw.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) fail('WP7_PRODUCTION_DEPENDENCY_BINDING_INVALID', 'dependency path contains unsafe segments', { relativePath });
  return raw;
}
function modePolicyForPlatform(platform) {
  const policy = FILE_MODE_POLICIES[platform];
  if (!policy) fail('WP7_PRODUCTION_DEPENDENCY_PLATFORM_UNSUPPORTED', 'production dependency file mode policy is unsupported', { platform });
  return policy;
}
function directoryModePolicyForPlatform(platform) {
  const policy = DIRECTORY_MODE_POLICIES[platform];
  if (!policy) fail('WP7_PRODUCTION_DEPENDENCY_PLATFORM_UNSUPPORTED', 'production dependency directory mode policy is unsupported', { platform });
  return policy;
}
function normalizedDependencyMode(statMode, platform) {
  const rawMode = Number(statMode) & 0o777;
  if (platform === 'linux') {
    if ((rawMode & 0o400) === 0 || (rawMode & 0o022) !== 0) {
      fail('WP7_PRODUCTION_DEPENDENCY_FILE_MODE_MISMATCH', 'Linux production dependency file mode is unsafe or non-canonical', { rawMode: rawMode.toString(8).padStart(4, '0') });
    }
    return rawMode.toString(8).padStart(4, '0');
  }
  if (platform === 'win32') {
    if ((rawMode & 0o444) === 0) fail('WP7_PRODUCTION_DEPENDENCY_FILE_MODE_MISMATCH', 'Windows production dependency file is not readable', { rawMode: rawMode.toString(8).padStart(4, '0') });
    return (rawMode & 0o222) !== 0 ? '0666' : '0444';
  }
  fail('WP7_PRODUCTION_DEPENDENCY_PLATFORM_UNSUPPORTED', 'production dependency file mode normalization is unsupported', { platform });
}
function normalizedDependencyDirectoryMode(statMode, platform) {
  const rawMode = Number(statMode) & 0o777;
  if (platform === 'linux') {
    if ((rawMode & 0o500) !== 0o500) {
      fail('WP7_PRODUCTION_DEPENDENCY_DIRECTORY_MODE_MISMATCH', 'Linux production dependency directory lacks owner read/traverse authority', { rawMode: rawMode.toString(8).padStart(4, '0') });
    }
    if ((rawMode & 0o022) !== 0) {
      fail('WP7_PRODUCTION_DEPENDENCY_DIRECTORY_MODE_MISMATCH', 'Linux production dependency directory is group/world writable', { rawMode: rawMode.toString(8).padStart(4, '0') });
    }
    return rawMode.toString(8).padStart(4, '0');
  }
  if (platform === 'win32') {
    // Native Windows Node maps NTFS directories to DOS read-only classes and does
    // not expose a POSIX execute/traverse bit. Successful lstat/readdir traversal
    // in walkDependencyFilesystem is the authority for directory accessibility;
    // mode identity therefore binds the observable writable/read-only class.
    if ((rawMode & 0o444) === 0) {
      fail('WP7_PRODUCTION_DEPENDENCY_DIRECTORY_MODE_MISMATCH', 'Windows production dependency directory is not readable', { rawMode: rawMode.toString(8).padStart(4, '0') });
    }
    return (rawMode & 0o222) !== 0 ? 'WINDOWS_DIRECTORY_OWNER_RWX' : 'WINDOWS_DIRECTORY_OWNER_RX';
  }
  fail('WP7_PRODUCTION_DEPENDENCY_PLATFORM_UNSUPPORTED', 'production dependency directory mode normalization is unsupported', { platform });
}
function platformKey(platform = process.platform, arch = process.arch) {
  if (!['linux', 'win32'].includes(platform) || arch !== 'x64') fail('WP7_PRODUCTION_DEPENDENCY_PLATFORM_UNSUPPORTED', 'production dependency binding supports linux-x64 and win32-x64 only', { platform, arch });
  return `${platform}-${arch}`;
}
function git(repoRoot, args, encoding = 'utf8') {
  try { return execFileSync('git', args, { cwd: repoRoot, encoding, maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (error) { fail('WP7_PRODUCTION_DEPENDENCY_EXTERNAL_BINDING_INVALID', 'cannot read reviewed dependency binding from Git', { args, stderr: String(error.stderr || '') }); }
}
function canonicalMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, String(value[key])]));
}
function packageRecord(lockPath, lockEntry, actualPackage) {
  return {
    path: normalize(lockPath),
    name: String(actualPackage.name || ''),
    version: String(lockEntry.version || ''),
    integrity: String(lockEntry.integrity || ''),
    resolved: String(lockEntry.resolved || ''),
    dev: lockEntry.dev === true,
    optional: lockEntry.optional === true,
    hasInstallScript: lockEntry.hasInstallScript === true,
    dependencies: canonicalMap(lockEntry.dependencies),
    optionalDependencies: canonicalMap(lockEntry.optionalDependencies),
    peerDependencies: canonicalMap(lockEntry.peerDependencies),
    peerDependenciesMeta: sortValue(lockEntry.peerDependenciesMeta || {}),
    engines: sortValue(lockEntry.engines || {}),
    os: Array.isArray(lockEntry.os) ? [...lockEntry.os] : [],
    cpu: Array.isArray(lockEntry.cpu) ? [...lockEntry.cpu] : []
  };
}
function walkDependencyFilesystem(nodeModulesRoot, targetPlatform) {
  modePolicyForPlatform(targetPlatform);
  directoryModePolicyForPlatform(targetPlatform);
  const requestedRoot = path.resolve(nodeModulesRoot);
  const rootStat = fs.lstatSync(requestedRoot);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) fail('WP7_PRODUCTION_DEPENDENCY_DIRECTORY_TREE_MISMATCH', 'production node_modules root is not a real directory', { path: requestedRoot });
  const root = fs.realpathSync(requestedRoot);
  const files = [];
  const directories = [];
  const exact = new Map();
  const folded = new Map();
  function register(payloadPath, type) {
    if (exact.has(payloadPath)) fail('WP7_PRODUCTION_DEPENDENCY_FILE_TREE_MISMATCH', 'production node_modules contains a duplicate path', { path: payloadPath, expectedType: exact.get(payloadPath), actualType: type });
    const lower = payloadPath.toLowerCase();
    if (folded.has(lower) && folded.get(lower) !== payloadPath) fail('WP7_PRODUCTION_DEPENDENCY_FILE_TREE_MISMATCH', 'production node_modules contains a Windows case-fold collision', { path: payloadPath, collidesWith: folded.get(lower) });
    exact.set(payloadPath, type);
    folded.set(lower, payloadPath);
  }
  function directoryRecord(fullPath, payloadPath) {
    const stat = fs.statSync(fullPath);
    if (!stat.isDirectory()) fail('WP7_PRODUCTION_DEPENDENCY_DIRECTORY_TREE_MISMATCH', 'production dependency directory record is not a directory', { path: payloadPath });
    return { path: payloadPath, type: 'directory', normalizedMode: normalizedDependencyDirectoryMode(stat.mode, targetPlatform) };
  }
  register('node_modules', 'directory');
  directories.push(directoryRecord(root, 'node_modules'));
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => Buffer.from(a.name).compare(Buffer.from(b.name)))) {
      const fullPath = path.join(directory, entry.name);
      const relativeWithin = normalize(path.relative(root, fullPath).split(path.sep).join('/'));
      if (relativeWithin === '.package-lock.json') continue;
      const payloadPath = `node_modules/${relativeWithin}`;
      if (entry.isSymbolicLink()) fail('WP7_PRODUCTION_DEPENDENCY_FILE_TREE_MISMATCH', 'production node_modules contains a symbolic link', { path: payloadPath });
      if (entry.isDirectory()) {
        register(payloadPath, 'directory');
        directories.push(directoryRecord(fullPath, payloadPath));
        visit(fullPath);
      } else if (entry.isFile()) {
        register(payloadPath, 'file');
        const stat = fs.statSync(fullPath);
        files.push({ path: payloadPath, sizeBytes: stat.size, sha256: sha256File(fullPath), mode: normalizedDependencyMode(stat.mode, targetPlatform) });
      } else fail('WP7_PRODUCTION_DEPENDENCY_FILE_TREE_MISMATCH', 'production node_modules contains an unsupported filesystem object', { path: payloadPath });
    }
  }
  visit(root);
  const sortRows = (rows) => rows.sort((a, b) => Buffer.from(a.path).compare(Buffer.from(b.path)));
  return { files: sortRows(files), directories: sortRows(directories) };
}
function walkDependencyFiles(nodeModulesRoot, targetPlatform) { return walkDependencyFilesystem(nodeModulesRoot, targetPlatform).files; }
function walkDependencyDirectories(nodeModulesRoot, targetPlatform) { return walkDependencyFilesystem(nodeModulesRoot, targetPlatform).directories; }
function installedPackageRecords(lock, appRoot) {
  const records = [];
  for (const [lockPath, lockEntry] of Object.entries(lock.packages || {}).sort((a, b) => Buffer.from(a[0]).compare(Buffer.from(b[0])))) {
    if (!lockPath.startsWith('node_modules/')) continue;
    const packageRoot = path.join(appRoot, ...lockPath.split('/'));
    const packageJsonPath = path.join(packageRoot, 'package.json');
    if (!fs.existsSync(packageJsonPath)) continue;
    const actualPackage = readJson(packageJsonPath);
    if (!lockEntry.version || actualPackage.version !== lockEntry.version) fail('WP7_PRODUCTION_DEPENDENCY_VERSION_MISMATCH', 'installed dependency version does not match package-lock.json', { lockPath, lockedVersion: lockEntry.version, actualVersion: actualPackage.version });
    if (!lockEntry.integrity || !lockEntry.resolved) fail('WP7_PRODUCTION_DEPENDENCY_GRAPH_MISMATCH', 'installed production dependency has no locked integrity or source', { lockPath });
    records.push(packageRecord(lockPath, lockEntry, actualPackage));
  }
  return records;
}
function treeHash(records, fields) {
  const text = records.map((row) => fields.map((field) => `${row[field] ?? ''}`).join('\0') + '\n').join('');
  return sha256Buffer(Buffer.from(text, 'utf8'));
}
function graphHash(records) { return sha256Buffer(canonicalBuffer(records)); }
function createPlatformBinding({ repoRoot, appRoot, platform, arch, npmVersion }) {
  const key = platformKey(platform, arch);
  const lockPath = path.join(repoRoot, 'package-lock.json');
  const packagePath = path.join(repoRoot, 'package.json');
  const lock = readJson(lockPath);
  const pkg = readJson(packagePath);
  const nodeModulesRoot = path.join(appRoot, 'node_modules');
  if (!fs.existsSync(nodeModulesRoot) || !fs.statSync(nodeModulesRoot).isDirectory()) fail('WP7_PRODUCTION_DEPENDENCY_BINDING_INVALID', 'production node_modules root is missing', { nodeModulesRoot });
  const packages = installedPackageRecords(lock, appRoot);
  const filesystem = walkDependencyFilesystem(nodeModulesRoot, platform);
  const { files, directories } = filesystem;
  if (!packages.length || !files.length || !directories.length) fail('WP7_PRODUCTION_DEPENDENCY_BINDING_INVALID', 'production dependency binding cannot be empty', { key });
  return {
    platform: key,
    npmVersion: String(npmVersion || ''),
    installPolicy: {
      command: 'npm ci',
      omit: 'dev',
      ignoreScripts: true,
      noBinLinks: true,
      generatedBinShimPolicy: GENERATED_NPM_BIN_SHIM_POLICY,
      audit: false,
      fund: false,
      targetOs: platform,
      targetCpu: arch
    },
    rootDependencies: canonicalMap(pkg.dependencies),
    packageCount: packages.length,
    fileCount: files.length,
    directoryCount: directories.length,
    modeBoundFileCount: files.length,
    modeBoundDirectoryCount: directories.length,
    fileModePolicy: modePolicyForPlatform(platform),
    directoryModePolicy: directoryModePolicyForPlatform(platform),
    packageGraphSha256: graphHash(packages),
    dependencyFileTreeSha256: treeHash(files, ['path', 'sizeBytes', 'sha256', 'mode']),
    dependencyModeTreeSha256: treeHash(files, ['path', 'mode']),
    dependencyDirectoryModeTreeSha256: treeHash(directories, ['path', 'type', 'normalizedMode']),
    packages,
    files,
    directories
  };
}
function createBindingDocument({ repoRoot = REPO_ROOT, platforms, npmVersion }) {
  const root = path.resolve(repoRoot);
  const lockPath = path.join(root, 'package-lock.json');
  const packagePath = path.join(root, 'package.json');
  const lock = readJson(lockPath);
  const pkg = readJson(packagePath);
  const rows = Object.fromEntries(Object.entries(platforms).sort(([a], [b]) => a.localeCompare(b)));
  return {
    schemaVersion: 3,
    documentType: 'YANCE_PRODUCTION_DEPENDENCY_EXTERNAL_BINDING',
    authorityClass: 'REVIEWED_GIT_EXTERNAL_TO_PACKAGED_PAYLOAD',
    sourceAuthority: 'PACKAGE_LOCK_GRAPH_PLUS_NPM_TARBALL_CONTENT_FILE_MODE_AND_DIRECTORY_MODE_VERIFIED_BY_SRI',
    generatedBy: 'tools/wp7/generate-production-dependency-binding.js',
    packageManager: String(pkg.packageManager || `npm@${npmVersion || ''}`),
    lockfileVersion: lock.lockfileVersion,
    packageLockSha256: sha256File(lockPath),
    packageJsonSha256: sha256File(packagePath),
    rootDependencies: canonicalMap(pkg.dependencies),
    platformKeys: Object.keys(rows),
    platforms: rows
  };
}
function validatePlatformBinding(row, key) {
  if (!row || row.platform !== key || !Array.isArray(row.packages) || !Array.isArray(row.files) || !Array.isArray(row.directories)) fail('WP7_PRODUCTION_DEPENDENCY_BINDING_INVALID', 'platform dependency binding is invalid', { key });
  if (!Number.isInteger(row.packageCount) || row.packageCount !== row.packages.length || !Number.isInteger(row.fileCount) || row.fileCount !== row.files.length || !Number.isInteger(row.directoryCount) || row.directoryCount !== row.directories.length || row.modeBoundFileCount !== row.files.length || row.modeBoundDirectoryCount !== row.directories.length) fail('WP7_PRODUCTION_DEPENDENCY_BINDING_INVALID', 'platform dependency binding counts are invalid', { key });
  const targetPlatform = key.split('-')[0];
  const installPolicy = row.installPolicy;
  if (!installPolicy || installPolicy.command !== 'npm ci' || installPolicy.omit !== 'dev' || installPolicy.ignoreScripts !== true || installPolicy.noBinLinks !== true || installPolicy.generatedBinShimPolicy !== GENERATED_NPM_BIN_SHIM_POLICY || installPolicy.audit !== false || installPolicy.fund !== false || installPolicy.targetOs !== targetPlatform || installPolicy.targetCpu !== 'x64') fail('WP7_PRODUCTION_DEPENDENCY_BINDING_INVALID', 'platform dependency install and generated-bin canonicalization policy is invalid', { key, installPolicy });
  if (row.fileModePolicy !== modePolicyForPlatform(targetPlatform)) fail('WP7_PRODUCTION_DEPENDENCY_BINDING_INVALID', 'platform dependency file mode policy is invalid', { key, fileModePolicy: row.fileModePolicy });
  if (row.directoryModePolicy !== directoryModePolicyForPlatform(targetPlatform)) fail('WP7_PRODUCTION_DEPENDENCY_BINDING_INVALID', 'platform dependency directory mode policy is invalid', { key, directoryModePolicy: row.directoryModePolicy });
  if (!SHA256_RE.test(row.packageGraphSha256) || graphHash(row.packages) !== row.packageGraphSha256) fail('WP7_PRODUCTION_DEPENDENCY_BINDING_INVALID', 'platform dependency graph hash is invalid', { key });
  if (!SHA256_RE.test(row.dependencyFileTreeSha256) || treeHash(row.files, ['path', 'sizeBytes', 'sha256', 'mode']) !== row.dependencyFileTreeSha256) fail('WP7_PRODUCTION_DEPENDENCY_BINDING_INVALID', 'platform dependency file tree hash is invalid', { key });
  if (!SHA256_RE.test(row.dependencyModeTreeSha256) || treeHash(row.files, ['path', 'mode']) !== row.dependencyModeTreeSha256) fail('WP7_PRODUCTION_DEPENDENCY_BINDING_INVALID', 'platform dependency file mode tree hash is invalid', { key });
  if (!SHA256_RE.test(row.dependencyDirectoryModeTreeSha256) || treeHash(row.directories, ['path', 'type', 'normalizedMode']) !== row.dependencyDirectoryModeTreeSha256) fail('WP7_PRODUCTION_DEPENDENCY_BINDING_INVALID', 'platform dependency directory mode tree hash is invalid', { key });
  const packagePaths = new Set();
  for (const pkg of row.packages) {
    if (!pkg.path?.startsWith('node_modules/') || packagePaths.has(pkg.path) || !pkg.name || !pkg.version || !pkg.integrity || !pkg.resolved) fail('WP7_PRODUCTION_DEPENDENCY_BINDING_INVALID', 'dependency package record is invalid', { key, package: pkg });
    packagePaths.add(pkg.path);
  }
  const filesystemPaths = new Map();
  for (const file of row.files) {
    if (!file.path?.startsWith('node_modules/') || filesystemPaths.has(file.path) || !Number.isInteger(file.sizeBytes) || file.sizeBytes < 0 || !SHA256_RE.test(file.sha256) || !POSIX_MODE_RE.test(String(file.mode || ''))) fail('WP7_PRODUCTION_DEPENDENCY_BINDING_INVALID', 'dependency file record is invalid', { key, file });
    const parsedMode = Number.parseInt(file.mode, 8);
    if (targetPlatform === 'linux' && ((parsedMode & 0o400) === 0 || (parsedMode & 0o022) !== 0)) fail('WP7_PRODUCTION_DEPENDENCY_BINDING_INVALID', 'Linux dependency binding contains an unsafe file mode', { key, file });
    if (targetPlatform === 'win32' && !['0444', '0666'].includes(file.mode)) fail('WP7_PRODUCTION_DEPENDENCY_BINDING_INVALID', 'Windows dependency binding file mode is outside the normalized policy', { key, file });
    filesystemPaths.set(file.path, 'file');
  }
  for (const directory of row.directories) {
    if (!directory.path?.startsWith('node_modules') || filesystemPaths.has(directory.path) || directory.type !== 'directory' || typeof directory.normalizedMode !== 'string') fail('WP7_PRODUCTION_DEPENDENCY_BINDING_INVALID', 'dependency directory record is invalid', { key, directory });
    if (targetPlatform === 'linux') {
      if (!POSIX_MODE_RE.test(directory.normalizedMode)) fail('WP7_PRODUCTION_DEPENDENCY_BINDING_INVALID', 'Linux dependency directory mode is invalid', { key, directory });
      const parsedMode = Number.parseInt(directory.normalizedMode, 8);
      if ((parsedMode & 0o500) !== 0o500 || (parsedMode & 0o022) !== 0) fail('WP7_PRODUCTION_DEPENDENCY_BINDING_INVALID', 'Linux dependency binding contains an unsafe directory mode', { key, directory });
    } else if (!WINDOWS_DIRECTORY_MODES.includes(directory.normalizedMode)) fail('WP7_PRODUCTION_DEPENDENCY_BINDING_INVALID', 'Windows dependency directory mode is outside the normalized policy', { key, directory });
    filesystemPaths.set(directory.path, 'directory');
  }
  if (!filesystemPaths.has('node_modules') || filesystemPaths.get('node_modules') !== 'directory') fail('WP7_PRODUCTION_DEPENDENCY_BINDING_INVALID', 'dependency binding does not bind the node_modules root directory', { key });
  return row;
}
function validateBindingDocument(binding) {
  if (!binding || binding.schemaVersion !== 3 || binding.documentType !== 'YANCE_PRODUCTION_DEPENDENCY_EXTERNAL_BINDING' || binding.authorityClass !== 'REVIEWED_GIT_EXTERNAL_TO_PACKAGED_PAYLOAD') fail('WP7_PRODUCTION_DEPENDENCY_BINDING_INVALID', 'production dependency external binding schema is invalid');
  if (binding.lockfileVersion !== 3 || !SHA256_RE.test(binding.packageLockSha256) || !SHA256_RE.test(binding.packageJsonSha256)) fail('WP7_PRODUCTION_DEPENDENCY_BINDING_INVALID', 'production dependency external binding lock identity is invalid');
  if (!Array.isArray(binding.platformKeys) || !binding.platforms || typeof binding.platforms !== 'object') fail('WP7_PRODUCTION_DEPENDENCY_BINDING_INVALID', 'production dependency external binding platforms are invalid');
  const keys = Object.keys(binding.platforms).sort();
  if (JSON.stringify(keys) !== JSON.stringify([...binding.platformKeys].sort())) fail('WP7_PRODUCTION_DEPENDENCY_BINDING_INVALID', 'production dependency platform key list is inconsistent', { keys, platformKeys: binding.platformKeys });
  for (const key of keys) validatePlatformBinding(binding.platforms[key], key);
  return binding;
}
function readReviewedBinding(repoRoot, sourceCommit) {
  const root = path.resolve(repoRoot || REPO_ROOT);
  const commit = String(sourceCommit || 'HEAD');
  const reviewedBytes = git(root, ['show', `${commit}:${BINDING_RELATIVE_PATH}`], 'buffer');
  let reviewed;
  try { reviewed = JSON.parse(reviewedBytes.toString('utf8')); }
  catch (error) { fail('WP7_PRODUCTION_DEPENDENCY_EXTERNAL_BINDING_INVALID', 'reviewed production dependency binding JSON is invalid', { message: error.message }); }
  validateBindingDocument(reviewed);
  const workingPath = path.join(root, ...BINDING_RELATIVE_PATH.split('/'));
  if (!fs.existsSync(workingPath) || !fs.statSync(workingPath).isFile()) fail('WP7_PRODUCTION_DEPENDENCY_EXTERNAL_BINDING_INVALID', 'working production dependency binding file is missing', { workingPath });
  const workingBytes = fs.readFileSync(workingPath);
  if (!workingBytes.equals(reviewedBytes)) fail('WP7_PRODUCTION_DEPENDENCY_EXTERNAL_BINDING_INVALID', 'working dependency binding differs from the reviewed Git blob', { sourceCommit: commit, workingPath });
  return { binding: reviewed, bindingPath: workingPath, bindingSha256: sha256Buffer(reviewedBytes), reviewedBytes };
}
function compareRecords(expected, actual, keyFields) {
  const expectedMap = new Map(expected.map((row) => [row.path, row]));
  const actualMap = new Map(actual.map((row) => [row.path, row]));
  const missing = expected.filter((row) => !actualMap.has(row.path)).map((row) => row.path);
  const extra = actual.filter((row) => !expectedMap.has(row.path)).map((row) => row.path);
  const mismatched = expected.filter((row) => actualMap.has(row.path) && keyFields.some((field) => JSON.stringify(actualMap.get(row.path)[field]) !== JSON.stringify(row[field]))).map((row) => ({ path: row.path, expected: Object.fromEntries(keyFields.map((field) => [field, row[field]])), actual: Object.fromEntries(keyFields.map((field) => [field, actualMap.get(row.path)[field]])) }));
  return { missing, extra, mismatched };
}
function verifyProductionDependencyClosure(options = {}) {
  const repoRoot = path.resolve(options.repoRoot || REPO_ROOT);
  const appRoot = fs.realpathSync(path.resolve(options.appRoot || ''));
  const sourceCommit = String(options.sourceCommit || '');
  const targetPlatform = options.platform || process.platform;
  const key = platformKey(targetPlatform, options.arch || process.arch);
  const external = readReviewedBinding(repoRoot, sourceCommit);
  const platformBinding = external.binding.platforms[key];
  if (!platformBinding) fail('WP7_PRODUCTION_DEPENDENCY_PLATFORM_UNSUPPORTED', 'reviewed dependency binding has no target platform', { key });
  const packagedLockPath = path.join(appRoot, 'package-lock.json');
  const packagedPackagePath = path.join(appRoot, 'package.json');
  const nodeModulesRoot = path.join(appRoot, 'node_modules');
  for (const filePath of [packagedLockPath, packagedPackagePath]) if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) fail('WP7_PRODUCTION_DEPENDENCY_GRAPH_MISMATCH', 'packaged dependency authority input is missing', { filePath });
  if (!fs.existsSync(nodeModulesRoot) || !fs.statSync(nodeModulesRoot).isDirectory()) fail('WP7_PRODUCTION_DEPENDENCY_DIRECTORY_TREE_MISMATCH', 'packaged production node_modules is missing or not a directory', { nodeModulesRoot });
  const packageLockSha256 = sha256File(packagedLockPath);
  const packageJsonSha256 = sha256File(packagedPackagePath);
  if (packageLockSha256 !== external.binding.packageLockSha256 || packageJsonSha256 !== external.binding.packageJsonSha256) fail('WP7_PRODUCTION_DEPENDENCY_GRAPH_MISMATCH', 'packaged package metadata differs from the reviewed external binding', { packageLockSha256, expectedPackageLockSha256: external.binding.packageLockSha256, packageJsonSha256, expectedPackageJsonSha256: external.binding.packageJsonSha256 });
  const lock = readJson(packagedLockPath);
  const pkg = readJson(packagedPackagePath);
  if (lock.lockfileVersion !== external.binding.lockfileVersion || JSON.stringify(canonicalMap(pkg.dependencies)) !== JSON.stringify(external.binding.rootDependencies) || JSON.stringify(canonicalMap(lock.packages?.['']?.dependencies)) !== JSON.stringify(external.binding.rootDependencies)) fail('WP7_PRODUCTION_DEPENDENCY_GRAPH_MISMATCH', 'root production dependency graph differs from the reviewed external binding');
  const actualPackages = installedPackageRecords(lock, appRoot);
  const packageDiff = compareRecords(platformBinding.packages, actualPackages, ['name','version','integrity','resolved','dev','optional','hasInstallScript','dependencies','optionalDependencies','peerDependencies','peerDependenciesMeta','engines','os','cpu']);
  if (packageDiff.missing.length || packageDiff.extra.length || packageDiff.mismatched.length) fail('WP7_PRODUCTION_DEPENDENCY_GRAPH_MISMATCH', 'packaged dependency graph, version, integrity or source differs from the reviewed external binding', packageDiff);
  const actualFilesystem = walkDependencyFilesystem(nodeModulesRoot, targetPlatform);
  const actualFiles = actualFilesystem.files;
  const actualDirectories = actualFilesystem.directories;
  const fileDiff = compareRecords(platformBinding.files, actualFiles, ['sizeBytes','sha256']);
  if (fileDiff.missing.length || fileDiff.extra.length || fileDiff.mismatched.length) fail('WP7_PRODUCTION_DEPENDENCY_FILE_TREE_MISMATCH', 'packaged production dependency files differ from the reviewed external binding', fileDiff);
  const fileModeDiff = compareRecords(platformBinding.files, actualFiles, ['mode']);
  if (fileModeDiff.missing.length || fileModeDiff.extra.length || fileModeDiff.mismatched.length) fail('WP7_PRODUCTION_DEPENDENCY_FILE_MODE_MISMATCH', 'packaged production dependency file modes differ from the reviewed external binding', fileModeDiff);
  const directoryDiff = compareRecords(platformBinding.directories, actualDirectories, ['type']);
  if (directoryDiff.missing.length || directoryDiff.extra.length || directoryDiff.mismatched.length) fail('WP7_PRODUCTION_DEPENDENCY_DIRECTORY_TREE_MISMATCH', 'packaged production dependency directories differ from the reviewed external binding', directoryDiff);
  const directoryModeDiff = compareRecords(platformBinding.directories, actualDirectories, ['normalizedMode']);
  if (directoryModeDiff.missing.length || directoryModeDiff.extra.length || directoryModeDiff.mismatched.length) fail('WP7_PRODUCTION_DEPENDENCY_DIRECTORY_MODE_MISMATCH', 'packaged production dependency directory modes differ from the reviewed external binding', directoryModeDiff);
  const packageGraphSha256 = graphHash(actualPackages);
  const dependencyFileTreeSha256 = treeHash(actualFiles, ['path', 'sizeBytes', 'sha256', 'mode']);
  const dependencyModeTreeSha256 = treeHash(actualFiles, ['path', 'mode']);
  const dependencyDirectoryModeTreeSha256 = treeHash(actualDirectories, ['path', 'type', 'normalizedMode']);
  if (packageGraphSha256 !== platformBinding.packageGraphSha256 || dependencyFileTreeSha256 !== platformBinding.dependencyFileTreeSha256 || dependencyModeTreeSha256 !== platformBinding.dependencyModeTreeSha256 || dependencyDirectoryModeTreeSha256 !== platformBinding.dependencyDirectoryModeTreeSha256) fail('WP7_PRODUCTION_DEPENDENCY_BINDING_INVALID', 'recomputed dependency identities differ from the reviewed external binding', { packageGraphSha256, dependencyFileTreeSha256, dependencyModeTreeSha256, dependencyDirectoryModeTreeSha256 });
  return Object.freeze({
    platform: key,
    externalBindingPath: external.bindingPath,
    externalBindingSha256: external.bindingSha256,
    packageLockSha256,
    packageJsonSha256,
    packageGraphSha256,
    dependencyFileTreeSha256,
    dependencyModeTreeSha256,
    dependencyDirectoryModeTreeSha256,
    fileModePolicy: platformBinding.fileModePolicy,
    directoryModePolicy: platformBinding.directoryModePolicy,
    packageCount: actualPackages.length,
    fileCount: actualFiles.length,
    directoryCount: actualDirectories.length,
    modeBoundFileCount: actualFiles.length,
    modeBoundDirectoryCount: actualDirectories.length,
    sourceAuthority: external.binding.sourceAuthority
  });
}

module.exports = {
  BINDING_RELATIVE_PATH,
  canonicalBuffer,
  createBindingDocument,
  createPlatformBinding,
  DIRECTORY_MODE_POLICIES,
  GENERATED_NPM_BIN_SHIM_POLICY,
  directoryModePolicyForPlatform,
  FILE_MODE_POLICIES,
  graphHash,
  modePolicyForPlatform,
  normalizedDependencyDirectoryMode,
  normalizedDependencyMode,
  platformKey,
  readReviewedBinding,
  treeHash,
  validateBindingDocument,
  verifyProductionDependencyClosure,
  walkDependencyDirectories,
  walkDependencyFiles,
  walkDependencyFilesystem
};
