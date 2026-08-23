'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');

const OLD = '39.8.5';
const NEW = '43.4.1';
const ELECTRON_INTEGRITY = 'sha512-5b+EuiwkgG5iRcsEL34rimgRpkYp15SsfZOa0pC5kXs0Tb82TH4n95rpQzTZa7yRCbA7tm0WoEbuBL6NaAhAcA==';
const WIN_SHA256 = 'c2ef9a5f65472c34d14bd3e67b7d14e66b0c01f124aba45263d6a4232160e13a';
const LINUX_SHA256 = '79d4efd69f0ccf1fc11891ea5075329c7b3faddad79a08d9fb395bbd63169acf';
const RETIRED_ZIP = 'vendor/electron/electron-v39.8.5-win32-x64.zip';
const NEW_ELECTRON_SEED = 'vendor/npm/electron-43.4.1.tgz';

const specs = [
  ['@electron-internal/extract-zip', '1.0.3', 'node_modules/@electron-internal/extract-zip', 'vendor/npm/_at_electron-internal__extract-zip-1.0.3.tgz'],
  ['@electron/get', '5.0.0', 'node_modules/@electron/get', 'vendor/npm/_at_electron__get-5.0.0.tgz'],
  ['@types/node', '24.10.13', 'node_modules/@types/node', 'vendor/npm/_at_types__node-24.10.13.tgz'],
  ['electron', '43.4.1', 'node_modules/electron', 'vendor/npm/electron-43.4.1.tgz'],
  ['env-paths', '3.0.0', 'node_modules/env-paths', 'vendor/npm/env-paths-3.0.0.tgz'],
  ['undici', '7.25.0', 'node_modules/undici', 'vendor/npm/undici-7.25.0.tgz'],
  ['undici-types', '7.16.0', 'node_modules/undici-types', 'vendor/npm/undici-types-7.16.0.tgz']
].map(([packageName, version, lockPath, archivePath]) => ({ packageName, version, lockPath, archivePath }));
const targetPaths = new Set(specs.map(spec => spec.lockPath));

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function writeJson(file, value) { fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8'); }
function identity(entry) {
  if (!entry) return null;
  return { version: entry.version ?? null, resolved: entry.resolved ?? null, integrity: entry.integrity ?? null };
}
function same(left, right) { return JSON.stringify(left) === JSON.stringify(right); }
function parentPackagePath(packagePath) {
  const parts = packagePath.split('/');
  let index = -1;
  for (let i = 0; i < parts.length; i += 1) if (parts[i] === 'node_modules') index = i;
  return index <= 0 ? '' : parts.slice(0, index).join('/');
}
function resolveDependency(packages, fromPath, dependencyName) {
  let base = parentPackagePath(fromPath);
  for (;;) {
    const candidate = `${base ? `${base}/` : ''}node_modules/${dependencyName}`;
    if (packages[candidate]) return candidate;
    if (!base) return null;
    base = parentPackagePath(base);
  }
}
function dependencyClosure(lock, startPath) {
  const packages = lock.packages || {};
  const seen = new Set();
  const queue = [startPath];
  while (queue.length) {
    const current = queue.shift();
    if (!current || seen.has(current) || !packages[current]) continue;
    seen.add(current);
    const entry = packages[current];
    for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
      const dependencies = entry[field];
      if (!dependencies || typeof dependencies !== 'object') continue;
      for (const name of Object.keys(dependencies)) {
        const resolved = resolveDependency(packages, current, name);
        if (resolved && !seen.has(resolved)) queue.push(resolved);
      }
    }
  }
  return seen;
}
function sha(buffer, algorithm, encoding) { return crypto.createHash(algorithm).update(buffer).digest(encoding); }
function count(text, token) { return text.split(token).length - 1; }
function replaceActiveVersion(file, preservedTokens = []) {
  let text = fs.readFileSync(file, 'utf8');
  const placeholders = preservedTokens.map((token, index) => {
    assert.equal(count(text, token), 1, `${file}: expected one preserved token: ${token}`);
    const placeholder = `__YANCE_ELECTRON_PRESERVE_${index}__`;
    text = text.replace(token, placeholder);
    return [placeholder, token];
  });
  assert.ok(text.includes(OLD), `${file}: expected active ${OLD} identity`);
  text = text.replaceAll(OLD, NEW);
  for (const [placeholder, token] of placeholders) text = text.replace(placeholder, token);
  fs.writeFileSync(file, text, 'utf8');
}

const beforeLock = readJson('/tmp/package-lock.before.json');
const lock = readJson('package-lock.json');
const beforeClosure = dependencyClosure(beforeLock, 'node_modules/electron');
const afterClosure = dependencyClosure(lock, 'node_modules/electron');
const allPackagePaths = new Set([...Object.keys(beforeLock.packages || {}), ...Object.keys(lock.packages || {})]);
const changedPaths = [...allPackagePaths].filter(repositoryPath => !same(beforeLock.packages?.[repositoryPath], lock.packages?.[repositoryPath]));
const permittedChangedPaths = new Set(['', ...beforeClosure, ...afterClosure]);
const outsideElectronClosure = changedPaths.filter(repositoryPath => !permittedChangedPaths.has(repositoryPath));
assert.deepEqual(outsideElectronClosure, [], `npm changed package-lock entries outside Electron closure: ${outsideElectronClosure.join(', ')}`);

for (const spec of specs) {
  const entry = lock.packages?.[spec.lockPath];
  assert.ok(entry, `missing reviewed lock path ${spec.lockPath}`);
  assert.equal(entry.version, spec.version, `${spec.lockPath} reviewed version`);
  assert.match(String(entry.resolved || ''), /^https:\/\/registry\.npmjs\.org\//u, `${spec.lockPath} official npm resolved`);
  assert.ok(String(entry.integrity || '').startsWith('sha512-'), `${spec.lockPath} integrity`);
}
assert.equal(lock.packages['node_modules/electron'].integrity, ELECTRON_INTEGRITY, 'Electron exact reviewed npm integrity');
assert.equal(lock.packages['']?.devDependencies?.electron, NEW, 'root lock Electron identity');
assert.equal(readJson('package.json').devDependencies?.electron, NEW, 'package manifest Electron identity');

const changedNewIdentities = changedPaths.filter(repositoryPath => {
  if (!repositoryPath || !lock.packages?.[repositoryPath]) return false;
  return !same(identity(beforeLock.packages?.[repositoryPath]), identity(lock.packages?.[repositoryPath]));
});
const unsupportedNewIdentities = changedNewIdentities.filter(repositoryPath => !targetPaths.has(repositoryPath));
assert.deepEqual(unsupportedNewIdentities, [], `reviewed seven-package npm graph expanded: ${unsupportedNewIdentities.join(', ')}`);

const seedRows = specs.map(spec => {
  const entry = lock.packages[spec.lockPath];
  const buffer = fs.readFileSync(spec.archivePath);
  const archiveSha256 = sha(buffer, 'sha256', 'hex');
  const integrity = `sha512-${sha(buffer, 'sha512', 'base64')}`;
  assert.equal(integrity, entry.integrity, `${spec.packageName}: npm pack bytes must match lock integrity`);
  return {
    packageName: spec.packageName,
    version: spec.version,
    lockPath: spec.lockPath,
    resolved: entry.resolved,
    integrity: entry.integrity,
    archivePath: spec.archivePath,
    archiveSha256,
    license: entry.license || 'UNKNOWN',
    source: 'npm-official-tarball',
    archiveBytes: buffer.length
  };
});

const staleOldClosurePaths = new Set([...beforeClosure].filter(repositoryPath => {
  const before = beforeLock.packages?.[repositoryPath];
  const after = lock.packages?.[repositoryPath];
  return !after || !same(identity(before), identity(after));
}));
function reconcileRows(rows, manifestMode) {
  const filtered = rows.filter(row => !staleOldClosurePaths.has(row.lockPath) && !targetPaths.has(row.lockPath));
  for (const seed of seedRows) {
    if (!manifestMode) {
      filtered.push({
        packageName: seed.packageName,
        version: seed.version,
        lockPath: seed.lockPath,
        resolved: seed.resolved,
        integrity: seed.integrity,
        archivePath: seed.archivePath,
        archiveSha256: seed.archiveSha256,
        license: seed.license,
        source: seed.source
      });
      continue;
    }
    const allMatchingLockPaths = Object.entries(lock.packages || {})
      .filter(([repositoryPath, entry]) => repositoryPath.endsWith(`node_modules/${seed.packageName}`) && entry?.version === seed.version)
      .map(([repositoryPath]) => repositoryPath)
      .sort();
    filtered.push({
      packageName: seed.packageName,
      version: seed.version,
      lockPath: seed.lockPath,
      resolved: seed.resolved,
      integrity: seed.integrity,
      archivePath: seed.archivePath,
      archiveSha256: seed.archiveSha256,
      license: seed.license,
      source: seed.source,
      allMatchingLockPaths,
      inputSource: `npm-official:${seed.packageName}@${seed.version}`,
      archiveBytes: seed.archiveBytes,
      optionalOnly: Boolean(lock.packages[seed.lockPath]?.optional),
      os: Array.isArray(lock.packages[seed.lockPath]?.os) ? lock.packages[seed.lockPath].os : [],
      cpu: Array.isArray(lock.packages[seed.lockPath]?.cpu) ? lock.packages[seed.lockPath].cpu : [],
      mirrorObservation: 'OFFICIAL_NPM_TARBALL_VERIFIED'
    });
  }
  filtered.sort((left, right) => left.packageName === right.packageName
    ? left.lockPath.localeCompare(right.lockPath)
    : left.packageName.localeCompare(right.packageName));
  return filtered;
}

const policy = readJson('governance/dependency-install-policy.json');
policy.trustedCacheSeeds = reconcileRows(policy.trustedCacheSeeds || [], false);
writeJson('governance/dependency-install-policy.json', policy);

const manifest = readJson('governance/dependency-install-batch-manifest.json');
manifest.entries = reconcileRows(manifest.entries || [], true);
manifest.totalSeedCount = manifest.entries.length;
if (Number.isSafeInteger(manifest.existingSeedCount)) manifest.batchSeedCount = manifest.totalSeedCount - manifest.existingSeedCount;
writeJson('governance/dependency-install-batch-manifest.json', manifest);

const release = readJson('/tmp/electron-release.json');
assert.equal(release.tag_name, 'v43.4.1', 'official Electron release tag');
const winAsset = (release.assets || []).find(asset => asset.name === 'electron-v43.4.1-win32-x64.zip');
assert.ok(winAsset && Number.isSafeInteger(winAsset.id) && winAsset.id > 0, 'official win32-x64 asset id');
assert.ok(Number.isSafeInteger(winAsset.size) && winAsset.size > 0, 'official win32-x64 byte size');
if (winAsset.digest) assert.equal(winAsset.digest, `sha256:${WIN_SHA256}`, 'official GitHub asset digest');
const trust = readJson('release/electron-distribution-trust.json');
trust.electronVersion = NEW;
trust.npmPackageIntegrity = ELECTRON_INTEGRITY;
trust.archives['linux-x64'] = {
  ...trust.archives['linux-x64'],
  fileName: 'electron-v43.4.1-linux-x64.zip',
  sha256: LINUX_SHA256,
  executableEntry: 'electron'
};
trust.archives['win32-x64'] = {
  fileName: 'electron-v43.4.1-win32-x64.zip',
  sha256: WIN_SHA256,
  sizeBytes: winAsset.size,
  sourceRepository: 'electron/electron',
  releaseTag: 'v43.4.1',
  assetId: winAsset.id,
  downloadUrl: winAsset.browser_download_url,
  executableEntry: 'electron.exe'
};
writeJson('release/electron-distribution-trust.json', trust);

const risk = readJson('governance/layered-ci/risk-policy.json');
assert.ok(risk.l2ExactPaths.includes(RETIRED_ZIP), 'retired Electron ZIP must remain exact L2 evidence');
if (!risk.l2ExactPaths.includes(NEW_ELECTRON_SEED)) risk.l2ExactPaths.push(NEW_ELECTRON_SEED);
risk.l2ExactPaths.sort();
writeJson('governance/layered-ci/risk-policy.json', risk);

for (const file of [
  '.github/workflows/v21-product-experience-shell-p0-final-validation.yml',
  '.github/workflows/windows-production-release.yml',
  'tools/release-closure/RUN_WINDOWS_ASSISTED_PIPELINE.ps1',
  'tools/release-closure/WINDOWS_PREVIEW_UAT_RUNNER.template.ps1',
  'tools/windows/VERIFY_RUNTIME_IDENTITY.ps1',
  'tools/wp7/generate-trusted-product-probe-blocker.js',
  'tests/runtime-delivery/source-uat-delivery.test.js'
]) replaceActiveVersion(file);

replaceActiveVersion('.github/workflows/stage-6459-wp0-gates.yml', [
  'test ! -e "${TRUSTED_POLICY_ROOT}/vendor/electron/electron-v39.8.5-win32-x64.zip"'
]);
replaceActiveVersion('tests/runtime-delivery/electron-archive-tracking-authority.test.js', [
  "const ELECTRON_ARCHIVE = 'vendor/electron/electron-v39.8.5-win32-x64.zip';"
]);

const riskTestPath = 'tests/layered-ci/governance-policy.test.js';
let riskTest = fs.readFileSync(riskTestPath, 'utf8');
const riskNeedle = "    'vendor/electron/electron-v39.8.5-win32-x64.zip'\n";
assert.equal(count(riskTest, riskNeedle), 2, 'risk test must contain exactly two retired ZIP terminal entries');
riskTest = riskTest.replaceAll(
  riskNeedle,
  "    'vendor/electron/electron-v39.8.5-win32-x64.zip',\n    'vendor/npm/electron-43.4.1.tgz'\n"
);
fs.writeFileSync(riskTestPath, riskTest, 'utf8');

for (const file of [
  'package.json',
  'package-lock.json',
  'release/electron-distribution-trust.json',
  'governance/dependency-install-policy.json',
  'governance/dependency-install-batch-manifest.json',
  '.github/workflows/v21-product-experience-shell-p0-final-validation.yml',
  '.github/workflows/windows-production-release.yml',
  'tools/release-closure/WINDOWS_PREVIEW_UAT_RUNNER.template.ps1',
  'tools/release-closure/RUN_WINDOWS_ASSISTED_PIPELINE.ps1',
  'tools/windows/VERIFY_RUNTIME_IDENTITY.ps1',
  'tools/wp7/generate-trusted-product-probe-blocker.js',
  'tests/runtime-delivery/source-uat-delivery.test.js'
]) assert.equal(fs.readFileSync(file, 'utf8').includes(OLD), false, `${file}: stale active Electron identity`);

console.log(JSON.stringify({
  changedLockPaths: changedPaths,
  beforeElectronClosure: [...beforeClosure].sort(),
  afterElectronClosure: [...afterClosure].sort(),
  seeds: seedRows.map(seed => ({ packageName: seed.packageName, version: seed.version, archiveSha256: seed.archiveSha256, archiveBytes: seed.archiveBytes })),
  winAsset: { id: winAsset.id, size: winAsset.size, digest: winAsset.digest || null }
}, null, 2));
