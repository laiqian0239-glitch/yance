'use strict';

const fs = require('node:fs');

function replaceExact(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`${label}: source block not found`);
  if (source.indexOf(before, first + before.length) !== -1) throw new Error(`${label}: source block is ambiguous`);
  return `${source.slice(0, first)}${after}${source.slice(first + before.length)}`;
}

function replaceBetween(source, start, end, replacement, label) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  if (startIndex < 0 || endIndex < 0) throw new Error(`${label}: source boundary not found`);
  return `${source.slice(0, startIndex)}${replacement}${source.slice(endIndex)}`;
}

const attributesPath = '.gitattributes';
let attributes = fs.readFileSync(attributesPath, 'utf8');
attributes = replaceExact(
  attributes,
  '* text=auto eol=lf\nINSTALL_AND_START_YANCE_SOURCE_UAT_LARGEST_EXISTING_DATA.ps1 -text whitespace=cr-at-eol',
  '* text=auto eol=lf\nRUN_FIX6O_GATE0_WINDOWS_UAT.cmd text eol=crlf\nINSTALL_AND_START_YANCE_SOURCE_UAT_LARGEST_EXISTING_DATA.ps1 -text whitespace=cr-at-eol',
  'Windows CMD checkout materialization authority'
);
fs.writeFileSync(attributesPath, attributes, 'utf8');

const checkpointTestPath = 'tests/runtime-delivery/fix6d-v5-source-checkpoint-identity.test.js';
fs.writeFileSync(checkpointTestPath, `'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const checkpointPath = path.join(repoRoot, 'YANCE_SOURCE_CHECKPOINT.json');
const descriptorPath = path.join(repoRoot, 'YANCE_ARTIFACT_DESCRIPTOR.json');

test('mutable repository and exported Windows source ZIP keep distinct source identity authorities', () => {
  const descriptor = JSON.parse(fs.readFileSync(descriptorPath, 'utf8'));
  const derivedPath = path.join(repoRoot, 'YANCE_DERIVED_SOURCE_IDENTITY.json');
  if (fs.existsSync(derivedPath)) {
    const derived = JSON.parse(fs.readFileSync(derivedPath, 'utf8'));
    assert.equal(derived.documentType, 'YANCE_DERIVED_SOURCE_IDENTITY');
    assert.match(derived.derivedVersion, /^FIX6[A-Z0-9_]+$/u);
    assert.match(derived.baseCommit, /^[0-9a-f]{40}$/u);
    assert.match(derived.baseTree, /^[0-9a-f]{40}$/u);
    assert.match(derived.payloadManifestSha256, /^[0-9a-f]{64}$/u);
    assert.equal(derived.releaseGates.windowsUiUat, false);
    assert.equal(derived.releaseGates.readyForPromotion, false);
    assert.equal(derived.releaseGates.formalRelease, false);
    assert.equal(derived.releaseGates.candidatePackageGenerated, false);

    assert.equal(descriptor.artifactType, 'WINDOWS_SOURCE_UAT_HANDOFF');
    assert.match(descriptor.artifactClass, new RegExp(\`^BATCH\\\\d+_\${derived.derivedVersion}_WINDOWS_SOURCE_UAT$\`, 'u'));
    const releaseBatch = descriptor.artifactClass.split('_')[0].toLowerCase();
    assert.equal(
      descriptor.artifactId,
      \`yance-\${releaseBatch}-\${derived.derivedVersion.toLowerCase().replaceAll('_', '-')}-windows-source-uat\`
    );
    assert.equal(descriptor.sourceIdentity.authority, 'YANCE_DERIVED_SOURCE_IDENTITY.json');
    assert.equal(descriptor.sourceIdentity.derivedVersion, derived.derivedVersion);
    assert.equal(descriptor.sourceIdentity.baseCommit, derived.baseCommit);
    assert.equal(descriptor.sourceIdentity.baseTree, derived.baseTree);
    assert.equal(descriptor.governance.windowsUiUat, false);
    assert.equal(descriptor.governance.readyForPromotion, false);
    assert.equal(descriptor.governance.formalRelease, false);
    assert.equal(descriptor.governance.candidatePackageGenerated, false);
    return;
  }

  assert.equal(descriptor.documentType, 'YANCE_ARTIFACT_DESCRIPTOR');
  assert.equal(descriptor.artifactType, 'MUTABLE_GIT_IMPLEMENTATION_REPOSITORY');
  assert.equal(descriptor.sourceIdentity.authority, 'GIT_HEAD_AT_RUNTIME');
  assert.equal(descriptor.sourceIdentity.trackedDerivedIdentity, false);
  assert.equal(descriptor.sourceIdentity.sealedExport, false);
  assert.equal(descriptor.identityProtocol.trackedDerivedIdentityForbidden, true);
  assert.equal(descriptor.identityProtocol.derivedIdentityGeneratedAtExport, true);
  assert.equal(descriptor.governance.windowsUiUat, false);
  assert.equal(descriptor.governance.readyForPromotion, false);
  assert.equal(descriptor.governance.formalRelease, false);
  assert.equal(descriptor.governance.candidatePackageGenerated, false);

  const historicalCheckpoint = JSON.parse(fs.readFileSync(checkpointPath, 'utf8'));
  assert.equal(historicalCheckpoint.documentType, 'YANCE_SOURCE_CHECKPOINT');
  assert.notEqual(descriptor.sourceIdentity.authority, 'YANCE_SOURCE_CHECKPOINT.json');
});
`, 'utf8');

const deliveryPath = 'tools/runtime-delivery/source-uat-delivery.js';
let delivery = fs.readFileSync(deliveryPath, 'utf8');
const discoverStart = 'function discoverElectronArchive(repoRoot, options = {}) {';
const discoverEnd = 'function runNpmCi(repoRoot, env = {}, options = {}) {';
const replacement = `function readGitLfsPointer(filePath) {
  try {
    const resolvedPath = path.resolve(filePath);
    const stat = fs.statSync(resolvedPath);
    if (!stat.isFile() || stat.size > 1024) return null;
    const text = fs.readFileSync(resolvedPath, 'utf8').replace(/\\r\\n/gu, '\\n');
    const match = /^version https:\\/\\/git-lfs\\.github\\.com\\/spec\\/v1\\noid sha256:([0-9a-f]{64})\\nsize ([1-9][0-9]*)\\n?$/u.exec(text);
    if (!match) return null;
    return Object.freeze({
      path: resolvedPath,
      oidSha256: match[1],
      objectSize: Number(match[2])
    });
  } catch (_) {
    return null;
  }
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
  let lfsPointer = null;
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) continue;
    const pointer = readGitLfsPointer(candidate);
    if (pointer) {
      if (pointer.oidSha256 !== artifact.sha256) {
        throw deliveryError('SOURCE_UAT_ELECTRON_LFS_POINTER_HASH_MISMATCH', 'Electron Git LFS pointer is not bound to the reviewed archive SHA-256', {
          pointerPath: pointer.path,
          expectedSha256: artifact.sha256,
          actualSha256: pointer.oidSha256,
          objectSize: pointer.objectSize
        });
      }
      lfsPointer ||= pointer;
      continue;
    }
    const actualSha256 = sha256File(candidate);
    if (actualSha256 !== artifact.sha256) {
      throw deliveryError('SOURCE_UAT_ELECTRON_ARCHIVE_HASH_MISMATCH', '本地 Electron ZIP 未通过仓库信任 SHA-256 校验', {
        archivePath: candidate,
        expectedSha256: artifact.sha256,
        actualSha256
      });
    }
    return { artifact, archivePath: candidate, candidates, actualSha256, lfsPointer };
  }
  return { artifact, archivePath: '', candidates, lfsPointer };
}

`;
delivery = replaceBetween(delivery, discoverStart, discoverEnd, replacement, 'Electron archive authority');
delivery = replaceExact(
  delivery,
  '  prepareSourceUat,\n  resolveDataRoot,',
  '  prepareSourceUat,\n  readGitLfsPointer,\n  resolveDataRoot,',
  'export Git LFS pointer authority'
);
fs.writeFileSync(deliveryPath, delivery, 'utf8');

const deliveryTestPath = 'tests/runtime-delivery/source-uat-delivery.test.js';
let deliveryTest = fs.readFileSync(deliveryTestPath, 'utf8');
deliveryTest = replaceExact(
  deliveryTest,
  '  prepareSourceUat,\n  resolveDataRoot,',
  '  prepareSourceUat,\n  readGitLfsPointer,\n  resolveDataRoot,',
  'import Git LFS pointer authority'
);
const electronTestStart = "test('Electron local archive recovery is bound to the reviewed Windows SHA-256', () => {";
const electronTestEnd = "\ntest('Electron ZIP extraction rejects traversal and absolute entries', () => {";
const electronTest = `test('Electron source-control pointer and hydrated archive remain distinct trusted states', () => {
  const artifact = expectedElectronArtifact(repoRoot, 'win32', 'x64');
  assert.equal(artifact.fileName, 'electron-v39.8.5-win32-x64.zip');
  assert.match(artifact.sha256, /^[0-9a-f]{64}$/u);
  const expectedArchive = path.join(repoRoot, 'vendor', 'electron', artifact.fileName);
  const pointer = readGitLfsPointer(expectedArchive);
  const discovered = discoverElectronArchive(repoRoot, {
    platform: 'win32',
    arch: 'x64',
    electronZip: path.join(tempRoot(), 'missing.zip')
  });
  if (pointer) {
    assert.equal(discovered.archivePath, '');
    assert.equal(discovered.lfsPointer.path, expectedArchive);
    assert.equal(discovered.lfsPointer.oidSha256, artifact.sha256);
    assert.equal(discovered.lfsPointer.objectSize, 136644393);
  } else {
    assert.equal(discovered.archivePath, expectedArchive);
    assert.equal(discovered.actualSha256, artifact.sha256);
    assert.equal(discovered.artifact.sha256, artifact.sha256);
  }

  const fixtureRoot = tempRoot();
  fs.mkdirSync(path.join(fixtureRoot, 'release'), { recursive: true });
  fs.mkdirSync(path.join(fixtureRoot, 'vendor', 'electron'), { recursive: true });
  fs.copyFileSync(path.join(repoRoot, 'release', 'electron-distribution-trust.json'), path.join(fixtureRoot, 'release', 'electron-distribution-trust.json'));
  const fixtureArchive = path.join(fixtureRoot, 'vendor', 'electron', artifact.fileName);
  fs.writeFileSync(fixtureArchive, \`version https://git-lfs.github.com/spec/v1\\noid sha256:\${'0'.repeat(64)}\\nsize 136644393\\n\`, 'utf8');
  assert.throws(
    () => discoverElectronArchive(fixtureRoot, { platform: 'win32', arch: 'x64' }),
    error => error?.reasonCode === 'SOURCE_UAT_ELECTRON_LFS_POINTER_HASH_MISMATCH'
  );
  fs.writeFileSync(fixtureArchive, 'not-a-reviewed-electron-archive', 'utf8');
  assert.throws(
    () => discoverElectronArchive(fixtureRoot, { platform: 'win32', arch: 'x64' }),
    error => error?.reasonCode === 'SOURCE_UAT_ELECTRON_ARCHIVE_HASH_MISMATCH'
  );
});
`;
deliveryTest = replaceBetween(deliveryTest, electronTestStart, electronTestEnd, electronTest, 'Electron delivery contract test');
fs.writeFileSync(deliveryTestPath, deliveryTest, 'utf8');

for (const file of [attributesPath, checkpointTestPath, deliveryTestPath, deliveryPath]) {
  if (!fs.existsSync(file)) throw new Error(`candidate path missing: ${file}`);
}
