'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..', '..');
const AUTHORIZATION_PATH = 'governance/layered-ci/v21-electron-supported-runtime-p0-authorization.json';
const CURRENT_EOL_ELECTRON = '39.8.5';
const REVIEWED_SUPPORTED_ELECTRON = '43.4.1';

const ACTIVE_IDENTITY_ROOTS = Object.freeze([
  'package.json',
  'package-lock.json',
  'release/electron-distribution-trust.json',
  'governance/dependency-install-policy.json',
  'governance/dependency-install-batch-manifest.json',
  '.github/workflows/stage-6459-wp0-gates.yml',
  '.github/workflows/v21-product-experience-shell-p0-final-validation.yml',
  '.github/workflows/windows-production-release.yml',
  'tools/release-closure/WINDOWS_PREVIEW_UAT_RUNNER.template.ps1',
  'tools/release-closure/RUN_WINDOWS_ASSISTED_PIPELINE.ps1',
  'tools/windows/VERIFY_RUNTIME_IDENTITY.ps1',
  'tools/wp7/generate-trusted-product-probe-blocker.js'
]);

const ACTIVE_CONTRACT_ROOTS = Object.freeze([
  'tests/runtime-delivery/electron-archive-tracking-authority.test.js',
  'tests/runtime-delivery/source-uat-delivery.test.js',
  'tests/wp7/pre-review-evidence-package.test.js',
  'tests/layered-ci/governance-policy.test.js',
  'tests/layered-ci/wp0-routing.test.js',
  'tests/wp7/windows-harness-horizontal-closure.test.js'
]);

function repositoryPath(repoPath) {
  return path.join(ROOT, ...repoPath.split('/'));
}

function readText(repoPath) {
  return fs.readFileSync(repositoryPath(repoPath), 'utf8');
}

function readJson(repoPath) {
  return JSON.parse(readText(repoPath));
}

function electronSeed(document) {
  const rows = [
    ...(Array.isArray(document.trustedCacheSeeds) ? document.trustedCacheSeeds : []),
    ...(Array.isArray(document.entries) ? document.entries : [])
  ];
  return rows.find((row) => row && row.packageName === 'electron') || null;
}

test('merged authorization keeps the first implementation head diagnostic-only and candidate-bound', () => {
  const authorization = readJson(AUTHORIZATION_PATH);
  assert.equal(authorization.workPackage, 'V21-ELECTRON-SUPPORTED-RUNTIME-P0');
  assert.equal(authorization.status, 'AUTHORIZED_AFTER_TRUSTED_MAIN_MERGE');
  assert.equal(authorization.implementation.branch, 'fix/v21-electron-supported-runtime-p0');
  assert.equal(authorization.implementation.productionScopeAuthorized, false);
  assert.equal(authorization.implementation.newDependencyAllowed, false);
  assert.equal(authorization.implementation.workflowModificationAllowed, false);
  assert.deepEqual(authorization.implementation.failureFirstCommit.allowedChangedPaths, [
    'tests/wp0/v21-electron-supported-runtime-p0.test.js'
  ]);
  assert.equal(authorization.implementation.failureFirstCommit.freshCausalRedRequired, true);
  assert.equal(authorization.implementation.failureFirstCommit.fastClosureV2.requiredClosureTrailer, 'Yance-Closure-Matrix-Unknown-Blockers: 0');
  const selected = authorization.ossFit.reviewedCandidates.find((candidate) => candidate.name === `Electron ${REVIEWED_SUPPORTED_ELECTRON}`);
  assert.ok(selected, `authorization must bind the reviewed Electron ${REVIEWED_SUPPORTED_ELECTRON} migration candidate`);
  assert.equal(selected.adoptionMode, 'official-sdk-cli-native-prebuild-runtime');
});

test('root package, lock and Electron distribution trust converge on the reviewed supported runtime', () => {
  const pkg = readJson('package.json');
  const lock = readJson('package-lock.json');
  const trust = readJson('release/electron-distribution-trust.json');
  const lockedElectron = lock.packages?.['node_modules/electron'];

  assert.deepEqual({
    packageManifest: pkg.devDependencies?.electron || null,
    packageLockRoot: lock.packages?.['']?.devDependencies?.electron || null,
    packageLockElectron: lockedElectron?.version || null,
    distributionTrust: trust.electronVersion || null
  }, {
    packageManifest: REVIEWED_SUPPORTED_ELECTRON,
    packageLockRoot: REVIEWED_SUPPORTED_ELECTRON,
    packageLockElectron: REVIEWED_SUPPORTED_ELECTRON,
    distributionTrust: REVIEWED_SUPPORTED_ELECTRON
  });

  assert.match(String(lockedElectron?.resolved || ''), new RegExp(`/electron-${REVIEWED_SUPPORTED_ELECTRON.replaceAll('.', '\\.') }\\.tgz$`, 'u'));
  assert.ok(String(lockedElectron?.integrity || '').startsWith('sha512-'), 'Electron lock entry must retain exact npm integrity');
  assert.ok(String(trust.npmPackageIntegrity || '').startsWith('sha512-'), 'distribution trust must bind Electron npm integrity');
  assert.equal(trust.npmPackageIntegrity, lockedElectron.integrity);
});

test('trusted dependency seed authority converges on the reviewed supported Electron tarball', () => {
  const policy = readJson('governance/dependency-install-policy.json');
  const manifest = readJson('governance/dependency-install-batch-manifest.json');
  const policySeed = electronSeed(policy);
  const manifestSeed = electronSeed(manifest);

  assert.ok(policySeed, 'dependency-install policy must contain the Electron trusted cache seed');
  assert.ok(manifestSeed, 'dependency-install batch manifest must contain the Electron trusted cache seed');

  for (const [label, seed] of [['policy', policySeed], ['batch-manifest', manifestSeed]]) {
    assert.equal(seed.version, REVIEWED_SUPPORTED_ELECTRON, `${label} Electron seed version`);
    assert.equal(seed.lockPath, 'node_modules/electron', `${label} Electron seed lock path`);
    assert.equal(seed.resolved, `https://registry.npmjs.org/electron/-/electron-${REVIEWED_SUPPORTED_ELECTRON}.tgz`, `${label} Electron seed official npm source`);
    assert.equal(seed.archivePath, `vendor/npm/electron-${REVIEWED_SUPPORTED_ELECTRON}.tgz`, `${label} Electron seed archive path`);
    assert.ok(String(seed.integrity || '').startsWith('sha512-'), `${label} Electron seed npm integrity`);
    assert.match(String(seed.archiveSha256 || ''), /^[0-9a-f]{64}$/u, `${label} Electron seed archive SHA-256`);
  }

  assert.deepEqual({
    version: policySeed.version,
    resolved: policySeed.resolved,
    integrity: policySeed.integrity,
    archivePath: policySeed.archivePath,
    archiveSha256: policySeed.archiveSha256
  }, {
    version: manifestSeed.version,
    resolved: manifestSeed.resolved,
    integrity: manifestSeed.integrity,
    archivePath: manifestSeed.archivePath,
    archiveSha256: manifestSeed.archiveSha256
  });
});

test('active Electron identity source graph contains no EOL 39.8.5 authority', () => {
  const missing = [...ACTIVE_IDENTITY_ROOTS, ...ACTIVE_CONTRACT_ROOTS]
    .filter((repoPath) => !fs.existsSync(repositoryPath(repoPath)));
  assert.deepEqual(missing, [], `declared active Electron source graph paths must exist: ${missing.join(', ')}`);

  const staleIdentityRoots = ACTIVE_IDENTITY_ROOTS.filter((repoPath) => readText(repoPath).includes(CURRENT_EOL_ELECTRON));
  const staleContractRoots = ACTIVE_CONTRACT_ROOTS.filter((repoPath) => readText(repoPath).includes(CURRENT_EOL_ELECTRON));

  assert.deepEqual({
    staleIdentityRoots,
    staleContractRoots
  }, {
    staleIdentityRoots: [],
    staleContractRoots: []
  }, [
    `Electron ${CURRENT_EOL_ELECTRON} is EOL and cannot remain an active release identity`,
    `reviewed migration candidate: ${REVIEWED_SUPPORTED_ELECTRON}`,
    `identity roots: ${staleIdentityRoots.join(', ') || '(none)'}`,
    `contract roots: ${staleContractRoots.join(', ') || '(none)'}`
  ].join('\n'));
});
