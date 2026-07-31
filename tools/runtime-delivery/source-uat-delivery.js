'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const { expectedBuildId, validateReleaseManifest } = require('../../shared/release/releaseManifestSchema');
const { loadReleaseIdentity } = require('../../shared/release/releaseIdentity');
const { deriveDatabaseSchemaVersion } = require('../wp1/lib');

const CHECKPOINT_FILE = 'YANCE_SOURCE_CHECKPOINT.json';
const GENERATED_ROOT_RELATIVE = path.join('.tmp', 'source-uat-resources');
const SOURCE_UAT_ARTIFACT_CLASS = 'SOURCE_UAT_ONLY';
const DEFAULT_PORT = 27632;

function deliveryError(reasonCode, message, details = {}) {
  return Object.assign(new Error(message), { reasonCode, code: reasonCode, details });
}

function sha256Buffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function sha256File(filePath) {
  return sha256Buffer(fs.readFileSync(filePath));
}

function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function normalizeRelative(value) {
  return String(value || '').split(path.sep).join('/').replace(/^\.\//, '');
}

function compareUtf8(left, right) {
  return Buffer.from(left).compare(Buffer.from(right));
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function git(repoRoot, args) {
  return clean(execFileSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
}

function checkpointIdentity(repoRoot) {
  const checkpointPath = path.join(repoRoot, CHECKPOINT_FILE);
  if (!fs.existsSync(checkpointPath)) return null;
  const document = readJson(checkpointPath);
  const commit = clean(document.commit || document.sourceCommit);
  const tree = clean(document.tree || document.sourceTree);
  if (!/^[0-9a-f]{40}$/.test(commit) || !/^[0-9a-f]{40}$/.test(tree)) {
    throw deliveryError('SOURCE_UAT_CHECKPOINT_INVALID', `${CHECKPOINT_FILE} 缺少有效 Commit/Tree`, { checkpointPath });
  }
  return {
    branch: clean(document.branch),
    commit,
    tree,
    tag: clean(document.tag),
    source: CHECKPOINT_FILE,
    workingTreeClean: null
  };
}

function resolveSourceIdentity(repoRoot, options = {}) {
  const gitDir = path.join(repoRoot, '.git');
  if (fs.existsSync(gitDir)) {
    let commit;
    let tree;
    let branch;
    let status;
    try {
      commit = git(repoRoot, ['rev-parse', 'HEAD']);
      tree = git(repoRoot, ['rev-parse', 'HEAD^{tree}']);
      branch = git(repoRoot, ['branch', '--show-current']);
      status = git(repoRoot, ['status', '--porcelain']);
    } catch (error) {
      throw deliveryError('SOURCE_UAT_GIT_IDENTITY_FAILED', '无法读取源码 Git 身份', { message: error.message });
    }
    const workingTreeClean = status === '';
    if (!workingTreeClean && options.allowDirty !== true) {
      throw deliveryError('SOURCE_UAT_WORKTREE_DIRTY', '源码工作树存在未提交修改，拒绝生成可启动 UAT 身份', { status: status.split(/\r?\n/u).slice(0, 40) });
    }
    return { branch, commit, tree, tag: '', source: 'git', workingTreeClean };
  }
  const checkpoint = checkpointIdentity(repoRoot);
  if (checkpoint) return checkpoint;
  const commit = clean(options.commit || process.env.YANCE_SOURCE_COMMIT);
  const tree = clean(options.tree || process.env.YANCE_SOURCE_TREE);
  if (/^[0-9a-f]{40}$/.test(commit) && /^[0-9a-f]{40}$/.test(tree)) {
    return { branch: clean(options.branch), commit, tree, tag: clean(options.tag), source: 'environment', workingTreeClean: null };
  }
  throw deliveryError('SOURCE_UAT_IDENTITY_MISSING', '源码包没有 .git，也没有 YANCE_SOURCE_CHECKPOINT.json，无法建立可信 UAT 身份');
}

const WALK_EXCLUDED_ROOTS = new Set(['.git', 'node_modules', '.tmp', 'coverage', 'dist', 'build', 'release-output', '.wp1-output']);

function listSourceFiles(repoRoot) {
  if (fs.existsSync(path.join(repoRoot, '.git'))) {
    const result = execFileSync('git', ['-C', repoRoot, 'ls-files', '-z'], { encoding: 'buffer' });
    return result.toString('utf8').split('\0').map(clean).filter(Boolean).sort(compareUtf8);
  }
  const rows = [];
  function visit(current, relativeRoot = '') {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => compareUtf8(a.name, b.name))) {
      if (!relativeRoot && WALK_EXCLUDED_ROOTS.has(entry.name)) continue;
      const relative = normalizeRelative(path.join(relativeRoot, entry.name));
      const fullPath = path.join(current, entry.name);
      if (entry.isSymbolicLink()) throw deliveryError('SOURCE_UAT_SYMLINK_REJECTED', '源码 UAT 不接受符号链接', { path: relative });
      if (entry.isDirectory()) visit(fullPath, relative);
      else if (entry.isFile()) rows.push(relative);
    }
  }
  visit(repoRoot);
  return rows.sort(compareUtf8);
}

function sourcePayloadRecords(repoRoot) {
  const records = [];
  for (const relative of listSourceFiles(repoRoot)) {
    const fullPath = path.join(repoRoot, ...relative.split('/'));
    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) continue;
    const stat = fs.statSync(fullPath);
    records.push({ path: normalizeRelative(relative), sizeBytes: stat.size, sha256: sha256File(fullPath) });
  }
  return records.sort((a, b) => compareUtf8(a.path, b.path));
}

function payloadIdentity(records) {
  const text = records.map(row => `${row.path}\0${row.sizeBytes}\0${row.sha256}\n`).join('');
  return sha256Buffer(Buffer.from(text, 'utf8'));
}

function copySealedPlatformAuth(repoRoot, outputRoot) {
  const candidates = [
    path.join(repoRoot, 'release', 'facebook-production-resources'),
    path.join(repoRoot, 'release')
  ];
  for (const sourceRoot of candidates) {
    const configPath = path.join(sourceRoot, 'platform-auth.json');
    const hashPath = path.join(sourceRoot, 'platform-auth.sha256');
    if (!fs.existsSync(configPath) || !fs.existsSync(hashPath)) continue;
    const detached = clean(fs.readFileSync(hashPath, 'utf8'));
    const match = /^([0-9a-f]{64})\s+\*?platform-auth\.json$/iu.exec(detached);
    const actual = sha256File(configPath);
    if (!match || match[1].toLowerCase() !== actual) {
      throw deliveryError('SOURCE_UAT_PLATFORM_AUTH_HASH_MISMATCH', '公开平台配置 SHA-256 校验失败', { configPath, hashPath, actual });
    }
    const rawText = fs.readFileSync(configPath, 'utf8');
    if (/(appSecret|pageToken|verifyToken|encryptionKey|masterKey|privateKey)/iu.test(rawText)) {
      throw deliveryError('SOURCE_UAT_PLATFORM_AUTH_SECRET_FIELD_FORBIDDEN', '公开平台配置出现 Secret 字段，拒绝复制', { configPath });
    }
    const destinationConfig = path.join(outputRoot, 'platform-auth.json');
    const destinationHash = path.join(outputRoot, 'platform-auth.sha256');
    fs.copyFileSync(configPath, destinationConfig);
    fs.writeFileSync(destinationHash, `${actual}  platform-auth.json\n`, 'utf8');
    return { configured: true, sha256: actual, configPath: destinationConfig, hashPath: destinationHash };
  }
  return { configured: false, sha256: null, configPath: '', hashPath: '' };
}

function buildSourceUatManifest(repoRoot, outputRoot, options = {}) {
  const source = readJson(path.join(repoRoot, 'release', 'release-source.json'));
  const identity = resolveSourceIdentity(repoRoot, options);
  const records = sourcePayloadRecords(repoRoot);
  const payloadDocument = {
    schemaVersion: 1,
    documentType: 'YANCE_SOURCE_UAT_PAYLOAD_FILES',
    artifactClass: SOURCE_UAT_ARTIFACT_CLASS,
    sourceCommit: identity.commit,
    sourceTree: identity.tree,
    files: records
  };
  const payloadRaw = Buffer.from(canonicalJson(payloadDocument), 'utf8');
  const payloadFilesPath = path.join(outputRoot, 'source-payload-files.json');
  fs.writeFileSync(payloadFilesPath, payloadRaw);
  const platformAuth = copySealedPlatformAuth(repoRoot, outputRoot);
  const buildTimestampUtc = (options.buildTimestampUtc ? new Date(options.buildTimestampUtc) : new Date()).toISOString();
  const schema = deriveDatabaseSchemaVersion(repoRoot).databaseSchemaVersion;
  const manifest = {
    schemaVersion: 1,
    buildId: '',
    productName: source.productName,
    publicProductName: source.publicProductName,
    publicProductNameEnglish: source.publicProductNameEnglish,
    productVersion: source.productVersion,
    publicVersion: source.publicVersion,
    internalProductId: source.internalProductId,
    executableName: source.executableName,
    installDirectoryName: source.installDirectoryName,
    userDataDirectoryName: source.userDataDirectoryName,
    brandingEpoch: source.brandingEpoch,
    installerBaseName: source.installerBaseName,
    internalName: source.internalName,
    originalFilename: source.originalFilename,
    appUserModelId: source.appUserModelId,
    legacyCompatibility: source.legacyCompatibility,
    releaseChannel: source.releaseChannel,
    onlineUpdatesEnabled: false,
    updateMode: source.updateMode,
    formalPublicReleaseAuthorized: false,
    stageVersion: source.stageVersion,
    phase: source.phase,
    distributionMode: source.distributionMode,
    gitCommit: identity.commit,
    sourceCommit: identity.commit,
    sourceTree: identity.tree,
    buildTimestampUtc,
    applicationPayloadSha256: payloadIdentity(records),
    payloadFilesSha256: sha256Buffer(payloadRaw),
    apiContractVersion: source.apiContractVersion,
    credentialProtocolVersion: source.credentialProtocolVersion,
    runtimeLockProtocolVersion: source.runtimeLockProtocolVersion,
    databaseSchemaVersion: schema,
    artifactClass: SOURCE_UAT_ARTIFACT_CLASS,
    finalReleaseEvidence: false,
    platformAuthConfigured: platformAuth.configured,
    platformAuthConfigSha256: platformAuth.sha256,
    platformAuthReleaseManaged: true,
    sourceUat: {
      schemaVersion: 1,
      branch: identity.branch,
      tag: identity.tag,
      identitySource: identity.source,
      workingTreeClean: identity.workingTreeClean,
      generatedResourcesOnly: true,
      installerBuilt: false,
      fullPipelineExecuted: false,
      wp7Executed: false,
      strictExecuted: false,
      builderExecuted: false
    }
  };
  manifest.buildId = expectedBuildId(manifest);
  validateReleaseManifest(manifest);
  const raw = Buffer.from(canonicalJson(manifest), 'utf8');
  const manifestPath = path.join(outputRoot, 'release-manifest.json');
  const detachedHashPath = path.join(outputRoot, 'release-manifest.sha256');
  fs.writeFileSync(manifestPath, raw);
  const manifestSha256 = sha256Buffer(raw);
  fs.writeFileSync(detachedHashPath, `${manifestSha256}  release-manifest.json\n`, 'utf8');
  const verified = loadReleaseIdentity({ manifestPath, detachedHashPath, expectedBuildId: manifest.buildId, consumer: 'source-uat-preparation' });
  return { identity, records, payloadFilesPath, platformAuth, manifest, manifestPath, detachedHashPath, manifestSha256, verified };
}

function prepareSourceUat(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const outputRoot = path.resolve(options.outputRoot || path.join(root, GENERATED_ROOT_RELATIVE));
  fs.rmSync(outputRoot, { recursive: true, force: true });
  fs.mkdirSync(outputRoot, { recursive: true });
  const built = buildSourceUatManifest(root, outputRoot, options);
  const report = {
    schemaVersion: 1,
    documentType: 'YANCE_SOURCE_UAT_PREPARATION',
    generatedAtUtc: new Date().toISOString(),
    status: 'PASS',
    sourceIdentity: built.identity,
    outputRoot,
    artifactClass: SOURCE_UAT_ARTIFACT_CLASS,
    buildId: built.manifest.buildId,
    manifestSha256: built.manifestSha256,
    sourceFileCount: built.records.length,
    platformAuth: {
      configured: built.platformAuth.configured,
      configSha256: built.platformAuth.sha256,
      secretFieldsRead: false,
      secretFieldsWritten: false,
      secretFieldsPrinted: false
    },
    executionBoundary: {
      electronStarted: false,
      installerBuilt: false,
      fullPipelineExecuted: false,
      wp7Executed: false,
      strictExecuted: false,
      builderExecuted: false
    }
  };
  const reportPath = path.join(outputRoot, 'source-uat-preparation.json');
  fs.writeFileSync(reportPath, canonicalJson(report), 'utf8');
  return { ...built, outputRoot, report, reportPath };
}

function parseNodeVersion(version = process.versions.node) {
  const parts = String(version || '').replace(/^v/u, '').split('.').map(value => Number(value));
  return { major: parts[0] || 0, minor: parts[1] || 0, patch: parts[2] || 0 };
}

function assertSupportedNode(version = process.versions.node) {
  const parsed = parseNodeVersion(version);
  if (parsed.major < 22 || (parsed.major === 22 && parsed.minor < 5)) {
    throw deliveryError('SOURCE_UAT_NODE_VERSION_UNSUPPORTED', `需要 Node.js 22.5.0 或更高版本，当前为 ${version}`, { required: '>=22.5.0', actual: version });
  }
  return parsed;
}

function inspectDataRoot(dataRoot) {
  const resolved = path.resolve(dataRoot);
  const databasePath = path.join(resolved, 'store', 'yance-r32.db');
  const walPath = `${databasePath}-wal`;
  const statSize = filePath => {
    try { return fs.statSync(filePath).isFile() ? fs.statSync(filePath).size : 0; } catch (_) { return 0; }
  };
  return {
    dataRoot: resolved,
    databasePath,
    databaseExists: statSize(databasePath) > 0,
    databaseSizeBytes: statSize(databasePath),
    walSizeBytes: statSize(walPath)
  };
}

function discoverExistingDataRoots(env = process.env) {
  const localAppData = clean(env.LOCALAPPDATA);
  const appData = clean(env.APPDATA);
  const candidates = [];
  if (localAppData) candidates.push(path.join(localAppData, 'Yance-Source-UAT'));
  if (appData) candidates.push(path.join(appData, 'Yance'));
  if (localAppData) {
    try {
      for (const entry of fs.readdirSync(localAppData, { withFileTypes: true })) {
        if (entry.isDirectory() && /^Yance-Source-UAT-user-config-/u.test(entry.name)) candidates.push(path.join(localAppData, entry.name));
      }
    } catch (_) {}
  }
  return [...new Set(candidates.map(value => path.resolve(value)))].map(inspectDataRoot).sort((left, right) =>
    right.databaseSizeBytes - left.databaseSizeBytes || right.walSizeBytes - left.walSizeBytes || left.dataRoot.localeCompare(right.dataRoot)
  );
}

function resolveDataRoot(options = {}, env = process.env) {
  if (clean(options.dataRoot)) return path.resolve(options.dataRoot);
  if (options.useLargestExistingData === true) {
    const selected = discoverExistingDataRoots(env).find(row => row.databaseExists);
    if (!selected) throw deliveryError('SOURCE_UAT_EXISTING_DATA_NOT_FOUND', '没有找到包含 SQLite 数据库的现有言策数据目录');
    return selected.dataRoot;
  }
  if (options.useExistingData === true) {
    const appData = clean(env.APPDATA);
    if (!appData) throw deliveryError('SOURCE_UAT_APPDATA_MISSING', '无法定位现有言策数据目录：APPDATA 未设置');
    return path.join(appData, 'Yance');
  }
  const parent = clean(env.LOCALAPPDATA || env.APPDATA || os.tmpdir());
  return path.join(parent, 'Yance-Source-UAT');
}

function normalizePort(value) {
  const port = Number(value == null || value === '' ? DEFAULT_PORT : value);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw deliveryError('SOURCE_UAT_PORT_INVALID', `源码 UAT 端口无效：${value}`, { min: 1024, max: 65535 });
  }
  return port;
}

function portAvailable(port, host = '127.0.0.1') {
  return new Promise(resolve => {
    const server = net.createServer();
    server.unref();
    server.once('error', () => resolve(false));
    server.listen({ port, host, exclusive: true }, () => server.close(() => resolve(true)));
  });
}

function npmCommand(platform = process.platform) {
  return platform === 'win32' ? 'npm.cmd' : 'npm';
}

function directDependencyNames(repoRoot) {
  const packageJsonPath = path.join(repoRoot, 'package.json');
  const manifest = readJson(packageJsonPath);
  return [...new Set([
    ...Object.keys(manifest.dependencies || {}),
    ...Object.keys(manifest.devDependencies || {})
  ])].sort(compareUtf8);
}

function dependencyPackagePath(repoRoot, packageName) {
  const parts = String(packageName || '').split('/').filter(Boolean);
  return path.join(repoRoot, 'node_modules', ...parts, 'package.json');
}

function verifyDependencyIntegrity(repoRoot, options = {}) {
  const platform = options.platform || process.platform;
  const names = Array.isArray(options.packageNames) && options.packageNames.length
    ? [...new Set(options.packageNames.map(clean).filter(Boolean))].sort(compareUtf8)
    : directDependencyNames(repoRoot);
  const missing = [];
  const invalid = [];
  const installed = [];
  for (const packageName of names) {
    const packagePath = dependencyPackagePath(repoRoot, packageName);
    if (!fs.existsSync(packagePath)) {
      missing.push({ packageName, packagePath });
      continue;
    }
    try {
      const manifest = readJson(packagePath);
      if (!clean(manifest.name) || !clean(manifest.version)) {
        invalid.push({ packageName, packagePath, reason: 'PACKAGE_METADATA_INCOMPLETE' });
        continue;
      }
      installed.push({ packageName, version: clean(manifest.version), packagePath });
    } catch (error) {
      invalid.push({ packageName, packagePath, reason: 'PACKAGE_METADATA_INVALID', message: error.message });
    }
  }
  let electronExecutablePath = '';
  if (names.includes('electron')) {
    electronExecutablePath = platform === 'win32'
      ? path.join(repoRoot, 'node_modules', 'electron', 'dist', 'electron.exe')
      : path.join(repoRoot, 'node_modules', 'electron', 'dist', 'electron');
    if (!fs.existsSync(electronExecutablePath)) {
      invalid.push({ packageName: 'electron', packagePath: electronExecutablePath, reason: 'ELECTRON_EXECUTABLE_MISSING' });
    }
  }
  const result = {
    ok: missing.length === 0 && invalid.length === 0,
    checkedAtUtc: new Date().toISOString(),
    directDependencyCount: names.length,
    installedCount: installed.length,
    missing,
    invalid,
    installed,
    electronExecutablePath
  };
  if (!result.ok && options.throwOnFailure !== false) {
    throw deliveryError('SOURCE_UAT_DEPENDENCY_INTEGRITY_FAILED', '源码依赖不完整或损坏，拒绝启动真实 UAT', {
      directDependencyCount: result.directDependencyCount,
      installedCount: result.installedCount,
      missing: missing.slice(0, 40),
      invalid: invalid.slice(0, 40)
    });
  }
  return result;
}

function expectedElectronArtifact(repoRoot, platform = process.platform, arch = process.arch) {
  const trustPath = path.join(repoRoot, 'release', 'electron-distribution-trust.json');
  const trust = readJson(trustPath);
  const key = `${platform}-${arch}`;
  const artifact = trust.archives?.[key];
  if (!artifact || !/^[0-9a-f]{64}$/u.test(clean(artifact.sha256))) {
    throw deliveryError('SOURCE_UAT_ELECTRON_TRUST_MISSING', `缺少 ${key} Electron 发行信任记录`, { trustPath, key });
  }
  return {
    version: clean(trust.electronVersion),
    platform,
    arch,
    key,
    fileName: clean(artifact.fileName),
    sha256: clean(artifact.sha256).toLowerCase(),
    executableEntry: clean(artifact.executableEntry),
    trustPath
  };
}

function discoverElectronArchive(repoRoot, options = {}) {
  const artifact = expectedElectronArtifact(repoRoot, options.platform || process.platform, options.arch || process.arch);
  const candidates = [
    clean(options.electronZip),
    clean(process.env.YANCE_ELECTRON_ZIP),
    path.join(repoRoot, artifact.fileName),
    path.join(repoRoot, 'dependencies', artifact.fileName),
    path.join(repoRoot, 'vendor', 'electron', artifact.fileName)
  ].filter(Boolean).map(value => path.resolve(value));
  const archivePath = candidates.find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile()) || '';
  if (!archivePath) return { artifact, archivePath: '', candidates };
  const actualSha256 = sha256File(archivePath);
  if (actualSha256 !== artifact.sha256) {
    throw deliveryError('SOURCE_UAT_ELECTRON_ARCHIVE_HASH_MISMATCH', '本地 Electron ZIP 未通过仓库信任 SHA-256 校验', {
      archivePath,
      expectedSha256: artifact.sha256,
      actualSha256
    });
  }
  return { artifact, archivePath, candidates, actualSha256 };
}

function runNpmCi(repoRoot, env = {}, options = {}) {
  const platform = options.platform || process.platform;
  const spawn = options.spawn || spawnSync;
  const stdoutPath = clean(options.stdoutPath);
  const stderrPath = clean(options.stderrPath);
  let stdoutFd = null;
  let stderrFd = null;
  try {
    if (stdoutPath) {
      fs.mkdirSync(path.dirname(stdoutPath), { recursive: true });
      stdoutFd = fs.openSync(stdoutPath, 'a');
    }
    if (stderrPath) {
      fs.mkdirSync(path.dirname(stderrPath), { recursive: true });
      stderrFd = fs.openSync(stderrPath, 'a');
    }
    const stdio = stdoutFd != null || stderrFd != null
      ? ['ignore', stdoutFd == null ? 'inherit' : stdoutFd, stderrFd == null ? 'inherit' : stderrFd]
      : 'inherit';
    const result = spawn(npmCommand(platform), ['ci', '--no-audit', '--no-fund'], {
      cwd: repoRoot,
      stdio,
      shell: platform === 'win32',
      windowsHide: true,
      env: {
        ...process.env,
        npm_config_audit: 'false',
        npm_config_fund: 'false',
        ELECTRON_GET_NO_PROGRESS: '1',
        ...env
      }
    });
    const response = { status: result.status, error: result.error || null, signal: result.signal || null };
    if (stdoutPath) response.stdoutPath = stdoutPath;
    if (stderrPath) response.stderrPath = stderrPath;
    return response;
  } finally {
    if (stdoutFd != null) fs.closeSync(stdoutFd);
    if (stderrFd != null) fs.closeSync(stderrFd);
  }
}

function runNpmCiWithRetry(repoRoot, env = {}, options = {}) {
  const maxAttempts = Math.max(1, Math.min(5, Number(options.maxAttempts || 3)));
  const attempts = [];
  const logRoot = path.resolve(options.logRoot || path.join(repoRoot, '.tmp', 'source-uat-install'));
  fs.mkdirSync(logRoot, { recursive: true });
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const stdoutPath = path.join(logRoot, `npm-ci-attempt-${attempt}.stdout.log`);
    const stderrPath = path.join(logRoot, `npm-ci-attempt-${attempt}.stderr.log`);
    for (const filePath of [stdoutPath, stderrPath]) fs.rmSync(filePath, { force: true });
    const result = runNpmCi(repoRoot, env, { ...options, stdoutPath, stderrPath });
    const record = {
      attempt,
      status: result.status,
      signal: result.signal,
      error: result.error?.message || '',
      stdoutPath,
      stderrPath,
      completedAtUtc: new Date().toISOString()
    };
    attempts.push(record);
    if (!result.error && result.status === 0) return { ok: true, attempts, final: record, logRoot };
  }
  return { ok: false, attempts, final: attempts[attempts.length - 1], logRoot };
}

function secureZipEntryPath(destinationRoot, entryName) {
  const normalized = String(entryName || '').replace(/\\/gu, '/');
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:\//u.test(normalized) || normalized.split('/').includes('..')) {
    throw deliveryError('SOURCE_UAT_ELECTRON_ARCHIVE_ENTRY_INVALID', 'Electron ZIP 包含不安全路径', { entryName });
  }
  const destination = path.resolve(destinationRoot, ...normalized.split('/'));
  const root = `${path.resolve(destinationRoot)}${path.sep}`;
  if (destination !== path.resolve(destinationRoot) && !destination.startsWith(root)) {
    throw deliveryError('SOURCE_UAT_ELECTRON_ARCHIVE_ENTRY_INVALID', 'Electron ZIP 路径越界', { entryName });
  }
  return destination;
}

function extractElectronArchive(repoRoot, archive) {
  const helperPath = path.join(repoRoot, 'tools', 'runtime-delivery', 'extract-electron-archive.js');
  const result = spawnSync(process.execPath, [helperPath, archive.archivePath], {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: false,
    env: { ...process.env, YANCE_EXPECTED_ELECTRON_SHA256: archive.artifact.sha256 }
  });
  if (result.error || result.status !== 0) {
    throw deliveryError('SOURCE_UAT_ELECTRON_ARCHIVE_EXTRACT_FAILED', '本地 Electron ZIP 解压失败', {
      archivePath: archive.archivePath,
      status: result.status,
      signal: result.signal || null,
      message: result.error?.message || ''
    });
  }
  const packageRoot = path.join(repoRoot, 'node_modules', 'electron');
  const executablePath = path.join(packageRoot, 'dist', archive.artifact.executableEntry);
  const versionPath = path.join(packageRoot, 'dist', 'version');
  const pathFile = path.join(packageRoot, 'path.txt');
  if (!fs.existsSync(executablePath)) {
    throw deliveryError('SOURCE_UAT_ELECTRON_ARCHIVE_EXECUTABLE_MISSING', 'Electron ZIP 解压后缺少可执行文件', { executablePath });
  }
  if (!fs.existsSync(versionPath)) fs.writeFileSync(versionPath, `${archive.artifact.version}\n`, 'utf8');
  fs.writeFileSync(pathFile, archive.artifact.executableEntry, 'utf8');
  return { executablePath, versionPath, pathFile };
}

function installDependencies(repoRoot, options = {}) {
  const platform = options.platform || process.platform;
  const arch = options.arch || process.arch;
  const maxAttempts = options.maxAttempts || 3;
  const logRoot = options.logRoot || path.join(repoRoot, '.tmp', 'source-uat-install');
  const localArchive = discoverElectronArchive(repoRoot, { ...options, platform, arch });
  if (localArchive.archivePath) {
    const install = runNpmCiWithRetry(repoRoot, { ELECTRON_SKIP_BINARY_DOWNLOAD: '1' }, { ...options, platform, maxAttempts, logRoot });
    if (!install.ok) {
      throw deliveryError('SOURCE_UAT_NPM_CI_FAILED', 'npm ci 多次重试后仍未成功（本地 Electron 模式）', {
        attempts: install.attempts,
        logRoot: install.logRoot
      });
    }
    const extracted = extractElectronArchive(repoRoot, localArchive);
    const integrity = verifyDependencyIntegrity(repoRoot, { platform });
    return { mode: 'verified-local-electron-archive', archive: localArchive, extracted, install, integrity };
  }
  const mirror = clean(options.electronMirror || process.env.YANCE_ELECTRON_MIRROR || process.env.ELECTRON_MIRROR);
  const install = runNpmCiWithRetry(repoRoot, mirror ? { ELECTRON_MIRROR: mirror } : {}, { ...options, platform, maxAttempts, logRoot });
  if (!install.ok) {
    throw deliveryError('SOURCE_UAT_NPM_CI_FAILED', 'npm ci 多次重试后仍未成功。若 GitHub 无法访问，请提供经过校验的 Electron ZIP 或配置可信镜像。', {
      attempts: install.attempts,
      logRoot: install.logRoot,
      expectedElectronArchive: localArchive.artifact.fileName,
      expectedElectronSha256: localArchive.artifact.sha256,
      supportedRecovery: [
        `把 ${localArchive.artifact.fileName} 放到源码根目录后重新运行`,
        '设置 YANCE_ELECTRON_ZIP 指向本地 ZIP',
        '设置 YANCE_ELECTRON_MIRROR 指向可信 Electron 镜像根地址'
      ]
    });
  }
  const integrity = verifyDependencyIntegrity(repoRoot, { platform });
  return { mode: mirror ? 'electron-mirror' : 'electron-default-download', mirror: mirror || '', install, integrity };
}

function electronExecutable(repoRoot, platform = process.platform) {
  const executable = platform === 'win32'
    ? path.join(repoRoot, 'node_modules', 'electron', 'dist', 'electron.exe')
    : path.join(repoRoot, 'node_modules', 'electron', 'dist', 'electron');
  if (!fs.existsSync(executable)) {
    throw deliveryError('SOURCE_UAT_ELECTRON_MISSING', 'Electron 依赖尚未安装，请运行 INSTALL_AND_START_YANCE_SOURCE_UAT.cmd', { executable });
  }
  return executable;
}

module.exports = {
  CHECKPOINT_FILE,
  DEFAULT_PORT,
  GENERATED_ROOT_RELATIVE,
  SOURCE_UAT_ARTIFACT_CLASS,
  assertSupportedNode,
  buildSourceUatManifest,
  canonicalJson,
  copySealedPlatformAuth,
  deliveryError,
  electronExecutable,
  discoverElectronArchive,
  discoverExistingDataRoots,
  expectedElectronArtifact,
  extractElectronArchive,
  inspectDataRoot,
  installDependencies,
  directDependencyNames,
  dependencyPackagePath,
  normalizePort,
  payloadIdentity,
  portAvailable,
  prepareSourceUat,
  resolveDataRoot,
  resolveSourceIdentity,
  runNpmCi,
  runNpmCiWithRetry,
  sha256Buffer,
  sha256File,
  sourcePayloadRecords,
  secureZipEntryPath,
  verifyDependencyIntegrity
};
