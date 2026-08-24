'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..', '..');
const AUTHORIZATION_PATH = 'governance/layered-ci/v21-electron-supported-runtime-p0-authorization.json';
const CURRENT_EOL_ELECTRON = '39.8.5';
const REVIEWED_SUPPORTED_ELECTRON = '43.4.1';
const RETIRED_SOURCE_ARCHIVE = 'vendor/electron/electron-v39.8.5-win32-x64.zip';
const REVIEWED_NPM_SEED_ARCHIVE = 'vendor/npm/electron-43.4.1.tgz';

const STRICT_ACTIVE_IDENTITY_ROOTS = Object.freeze([
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

function withoutExactLine(text, exactLine) {
  const lines = text.split(/\r?\n/u);
  const matches = lines.filter((line) => line.trim() === exactLine);
  assert.equal(matches.length, 1, `expected exactly one preserved line: ${exactLine}`);
  return lines.filter((line) => line.trim() !== exactLine).join('\n');
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
  assert.equal(authorization.implementation.diagnosticWindow.additionalTestsOnlyDiagnosticsAllowed, true);
  assert.equal(authorization.implementation.diagnosticWindow.eachDiagnosticMustCarryPriorRedEvidence, true);
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
    assert.equal(seed.archivePath, REVIEWED_NPM_SEED_ARCHIVE, `${label} Electron seed archive path`);
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

test('strict active Electron identity roots contain no EOL runtime authority', () => {
  const missing = STRICT_ACTIVE_IDENTITY_ROOTS.filter((repoPath) => !fs.existsSync(repositoryPath(repoPath)));
  assert.deepEqual(missing, [], `declared strict active Electron roots must exist: ${missing.join(', ')}`);
  const stale = STRICT_ACTIVE_IDENTITY_ROOTS.filter((repoPath) => readText(repoPath).includes(CURRENT_EOL_ELECTRON));
  assert.deepEqual(stale, [], [
    `Electron ${CURRENT_EOL_ELECTRON} cannot remain in strict active identity roots`,
    `reviewed migration candidate: ${REVIEWED_SUPPORTED_ELECTRON}`,
    `stale roots: ${stale.join(', ') || '(none)'}`
  ].join('\n'));
});

test('Stage retains only the retired archive absence proof while active Electron trust moves to the supported runtime', () => {
  const repoPath = '.github/workflows/stage-6459-wp0-gates.yml';
  const text = readText(repoPath);
  const preserved = `test ! -e "\${TRUSTED_POLICY_ROOT}/${RETIRED_SOURCE_ARCHIVE}"`;
  const activeText = withoutExactLine(text, preserved);
  assert.doesNotMatch(activeText, new RegExp(CURRENT_EOL_ELECTRON.replaceAll('.', '\\.'), 'u'));
  assert.match(activeText, new RegExp(REVIEWED_SUPPORTED_ELECTRON.replaceAll('.', '\\.'), 'u'));
});

test('archive tracking contract preserves retired source-custody evidence while active trust assertions migrate', () => {
  const repoPath = 'tests/runtime-delivery/electron-archive-tracking-authority.test.js';
  const text = readText(repoPath);
  const preserved = `const ELECTRON_ARCHIVE = '${RETIRED_SOURCE_ARCHIVE}';`;
  const activeText = withoutExactLine(text, preserved);
  assert.doesNotMatch(activeText, new RegExp(CURRENT_EOL_ELECTRON.replaceAll('.', '\\.'), 'u'));
  assert.match(activeText, new RegExp(REVIEWED_SUPPORTED_ELECTRON.replaceAll('.', '\\.'), 'u'));
});

test('historical and synthetic Electron 39.8.5 evidence remains explicit negative proof rather than production authority', () => {
  assert.match(readText('tests/wp7/pre-review-evidence-package.test.js'), /electronVersion: '39\.8\.5'/u);
  assert.match(readText('tests/layered-ci/wp0-routing.test.js'), /vendor\/electron\/electron-v39\.8\.5-win32-x64\.zip/u);
  const riskTest = readText('tests/layered-ci/governance-policy.test.js');
  assert.match(riskTest, /vendor\/electron\/electron-v39\.8\.5-win32-x64\.zip/u);
});

test('new Electron npm seed is exact L2 while existing vendor Product routing already covers it', () => {
  const risk = readJson('governance/layered-ci/risk-policy.json');
  const routing = readJson('governance/layered-ci/wp0-routing-policy.json');
  const riskTest = readText('tests/layered-ci/governance-policy.test.js');

  assert.ok(risk.l2ExactPaths.includes(RETIRED_SOURCE_ARCHIVE), 'retired Electron release ZIP path remains exact L2 custody evidence');
  assert.ok(risk.l2ExactPaths.includes(REVIEWED_NPM_SEED_ARCHIVE), 'new Electron npm trusted-cache seed must be exact L2');
  assert.match(riskTest, /vendor\/npm\/electron-43\.4\.1\.tgz/u, 'Layered risk contract must bind the new exact npm seed path');
  assert.ok(routing.productPrefixes.includes('vendor/'), 'WP0 Product routing already covers vendor npm seed paths without routing-policy expansion');
});
