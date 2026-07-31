'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { createReviewFixtureBrandingOptions, buildFinalWindowsPayload, PRE_REVIEW_ARTIFACT_CLASS, writeCanonicalJson } = require('../../tools/wp7/lib');
const { validatePackagedPayload, validatePackagedProbeResult } = require('../../tools/wp7/run-packaged-electron-probe-integration');
const { compareElectronDistributionTree, verifyTrustedProductExecutable, sha256File } = require('../../tools/wp7/packaged-product-trust');
const {
  CONTROLLED_METADATA_PATHS,
  expectedPayloadMode,
  normalizedProjectPayloadMode,
  projectFileModePolicyForPlatform,
  validateReviewedApplicationSourceClosure
} = require('../../tools/wp7/packaged-payload-closure');
const { readReviewedBinding, verifyProductionDependencyClosure, validateBindingDocument, walkDependencyFilesystem, treeHash, normalizedDependencyMode, normalizedDependencyDirectoryMode } = require('../../tools/wp7/production-dependency-binding');
const { applicationPayloadFilesystemIdentitySha256 } = require('../../tools/wp7/filesystem-identity');
const { FORMAL_PROBE_IDS, assertFormalProbeIdSet } = require('../../shared/wp7/formalProbeIds');
const { createTrustedProductProbeBlocker, readFormalProbeScope } = require('../../tools/wp7/trusted-product-probe-scope');
const wp1 = require('../../tools/wp1/lib');
const { createFakeElectronDist, createFakeTrustedNodeRuntime, fakeElectronOfficialRecords, productionDependencyFixture, cloneDirectoryFast, detachFile, remapPaths, createFakeRceditRunner } = require('./helpers');
const { readInstallerIdentityReceipt } = require('../../installer/installedIdentityReceipt');
const { measurementFor } = require('./installed-runtime-probe-fixtures');
const { createPreReviewSealedArtifact, readAndVerifyPreReviewSealedArtifact, SEALED_ARTIFACT_TYPE } = require('../../tools/wp7/pre-review-sealed-artifact');

const REPO = path.resolve(__dirname, '..', '..');
const ELECTRON_ARCHIVE_EXECUTABLE = process.platform === 'win32' ? 'electron.exe' : 'electron';
const PRODUCT_EXECUTABLE_NAME = process.platform === 'win32' ? 'Yance.exe' : 'Yance';
function git(command) { return require('node:child_process').execFileSync('git', command, { cwd: REPO, encoding: 'utf8' }).trim(); }

const transientRoots = new Set();
function transientTempRoot(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  transientRoots.add(root);
  return root;
}
test.afterEach(() => {
  for (const root of transientRoots) fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  transientRoots.clear();
});

let packagedArtifactBaseline = null;
function buildPackagedArtifactBaseline() {
  if (packagedArtifactBaseline) return packagedArtifactBaseline;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wp7-packaged-entry-baseline-'));
  const stagingRoot = path.join(root, 'staging');
  fs.mkdirSync(stagingRoot, { recursive: true });
  const sourceCommit = git(['rev-parse', 'HEAD']);
  const sourceTree = git(['rev-parse', 'HEAD^{tree}']);
  const built = buildFinalWindowsPayload({
    repoRoot: REPO,
    stagingRoot,
    identity: { sourceCommit, sourceTree },
    buildTimestampUtc: '2026-07-05T13:00:00.000Z',
    allowNonWindows: true,
    installProductionDependencies: false,
    productionNodeModulesSource: productionDependencyFixture(REPO),
    electronDist: createFakeElectronDist(root),
    trustedNodeExecutable: createFakeTrustedNodeRuntime(root),
    electronOfficialRecords: fakeElectronOfficialRecords(),
    ...createReviewFixtureBrandingOptions(createFakeRceditRunner()),
    artifactClass: PRE_REVIEW_ARTIFACT_CLASS,
    finalReleaseEvidence: false
  });
  packagedArtifactBaseline = { root, built };
  return packagedArtifactBaseline;
}
function buildPackagedArtifact() {
  const baseline = buildPackagedArtifactBaseline();
  const root = transientTempRoot('wp7-packaged-entry-');
  cloneDirectoryFast(baseline.root, root);
  return { root, built: remapPaths(baseline.built, baseline.root, root) };
}

test.after(() => {
  if (packagedArtifactBaseline?.root) fs.rmSync(packagedArtifactBaseline.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  packagedArtifactBaseline = null;
});

function validResultExpected() {
  const executable = fs.realpathSync(process.execPath);
  const main = fs.realpathSync(path.join(REPO, 'electron', 'main.js'));
  return {
    probeId: 'first-start',
    executionNonce: '123e4567-e89b-42d3-a456-426614174000',
    actualPlatform: process.platform,
    buildSessionId: 'a'.repeat(32),
    buildId: 'test-build',
    sourceCommit: 'c'.repeat(40),
    sourceTree: 'd'.repeat(40),
    preReviewSealedArtifactSha256: 'e'.repeat(64),
    preReviewSealedArtifactType: SEALED_ARTIFACT_TYPE,
    producerPid: 321,
    producerParentPid: process.pid,
    productExecutable: executable,
    productExecutableSha256: sha256File(executable),
    mainEntryPath: main,
    mainEntrySha256: sha256File(main),
    startedMs: Date.now() - 1000
  };
}
function validReport(expected = validResultExpected()) {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    documentType: 'WP7_INSTALLED_RUNTIME_PROBE_RESULT',
    probeId: expected.probeId,
    status: 'PASS',
    generatedAtUtc: now,
    startedAtUtc: now,
    completedAtUtc: now,
    executionNonce: expected.executionNonce,
    actualPlatform: expected.actualPlatform,
    fixtureMode: false,
    executionClass: 'PRE_REVIEW_PACKAGED_INTEGRATION',
    formalWindowsEvidenceEligible: false,
    producerPid: expected.producerPid,
    producerParentPid: expected.producerParentPid,
    producerExecutablePath: expected.productExecutable,
    producerExecutableSha256: expected.productExecutableSha256,
    producerMainEntryPath: expected.mainEntryPath,
    producerMainEntrySha256: expected.mainEntrySha256,
    buildSessionId: expected.buildSessionId,
    buildId: expected.buildId,
    frozenSourceCommit: expected.sourceCommit,
    frozenSourceTree: expected.sourceTree,
    preReviewSealedArtifactSha256: expected.preReviewSealedArtifactSha256,
    preReviewSealedArtifactType: expected.preReviewSealedArtifactType,
    measurements: measurementFor(expected.probeId)
  };
}

test('electron/main.js production probe path invokes the imported application entry and has no undefined executor', () => {
  const source = fs.readFileSync(path.join(REPO, 'electron', 'main.js'), 'utf8');
  assert.match(source, /const \{ runInstalledRuntimeProbeApplicationEntry \} = require\('\.\/wp7InstalledRuntimeProbeApplicationEntry'\);/);
  const functionBody = source.match(/async function runWp7InstalledRuntimeProbe\(\) \{([\s\S]*?)\n\}/)?.[1] || '';
  assert.match(functionBody, /return runInstalledRuntimeProbeApplicationEntry\(\{/);
  assert.match(functionBody, /producerExecutablePath:\s*process\.execPath/);
  assert.match(functionBody, /producerMainEntryPath:\s*__filename/);
  assert.doesNotMatch(functionBody, /executeInstalledRuntimeProbe\s*\(/);
});

test('assembled resources/app update manager loads without tools or test sources', () => {
  const { built } = buildPackagedArtifact();
  const appRoot = built.runtime.appRoot;
  const updateManagerPath = path.join(appRoot, 'electron', 'updateManager.js');
  const sharedIdentityPath = path.join(appRoot, 'shared', 'windows', 'pe-resource-identity.js');
  assert.equal(fs.existsSync(path.join(appRoot, 'tools')), false, 'build tooling must not be shipped in resources/app');
  assert.equal(fs.existsSync(updateManagerPath), true);
  assert.equal(fs.existsSync(sharedIdentityPath), true);
  const result = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(updateManagerPath)}); process.stdout.write('PACKAGED_UPDATE_MANAGER_LOAD_PASS')`], {
    cwd: appRoot,
    encoding: 'utf8',
    timeout: 30000,
    windowsHide: true,
    env: { ...process.env, YANCE_INTERNAL_UPDATE_TEST: '1' }
  });
  assert.equal(result.status, 0, JSON.stringify({ status: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr, error: result.error?.message }));
  assert.equal(result.signal, null);
  assert.match(result.stdout, /PACKAGED_UPDATE_MANAGER_LOAD_PASS/);
});

test('assembled product payload carries exact production main and independent installer identity receipt', () => {
  const { built } = buildPackagedArtifact();
  const packaged = validatePackagedPayload(built.payloadRoot, built.resourcesRoot, { repoRoot: REPO });
  assert.equal(packaged.mainSha256, sha256File(path.join(REPO, 'electron', 'main.js')));
  assert.equal(packaged.releaseIdentity.artifactClass, 'WP7_PRE_REVIEW_ONLY');
  assert.equal(packaged.releaseIdentity.finalReleaseEvidence, false);
  assert.equal(packaged.releaseIdentity.electronDistributionFileCount, built.electronDistribution.archiveFileCount);
  assert.equal(packaged.releaseIdentity.electronDistributionModeBoundFileCount, built.electronDistribution.modeBoundFileCount);
  const runtimeInstallerReader = path.join(built.runtime.appRoot, 'installer', 'installedIdentityReceipt.js');
  assert.equal(sha256File(runtimeInstallerReader), sha256File(path.join(REPO, 'installer', 'installedIdentityReceipt.js')));
  const receipt = readInstallerIdentityReceipt(built.resourcesRoot, built.buildId);
  assert.equal(receipt.document.consumer, 'installer');
  assert.equal(receipt.document.producerType, 'nsis-embedded-identity');
  assert.notEqual(receipt.documentSha256, built.releaseManifestSha256);
  assert.notEqual(receipt.filePath, built.manifestPath);
});

test('pre-review sealed artifact is a real verified file with exact class and product identity', () => {
  const root = transientTempRoot('wp7-pre-review-seal-');
  const file = path.join(root, 'WP7_PRE_REVIEW_SEALED_ARTIFACT.json');
  const hash = 'a'.repeat(64);
  const data = {
    generatedAtUtc: '2026-07-06T10:00:00.000Z',
    buildSessionId: 'b'.repeat(32),
    buildId: 'test-build',
    sourceCommit: 'c'.repeat(40),
    sourceTree: 'd'.repeat(40),
    electronReleaseArchiveSha256: hash,
    productExecutableSha256: hash,
    releaseManifestSha256: hash,
    applicationPayloadSha256: hash,
    applicationPayloadFilesystemIdentitySha256: hash,
    payloadFilesSha256: hash,
    productionDependencyBindingSha256: hash,
    productionDependencyPackageGraphSha256: hash,
    productionDependencyFileTreeSha256: hash,
    productionDependencyModeTreeSha256: hash,
    productionDependencyDirectoryModeTreeSha256: hash,
    gitPayloadModeTreeSha256: hash,
    electronDistributionTreeSha256: hash,
    nodeRuntimeExecutableSha256: hash,
    nodeRuntimeTreeSha256: hash,
    nativeBinaryScanSha256: hash
  };
  const created = createPreReviewSealedArtifact(file, data);
  const verified = readAndVerifyPreReviewSealedArtifact(file, data);
  assert.equal(verified.sha256, created.sha256);
  assert.equal(verified.document.artifactClass, 'WP7_PRE_REVIEW_ONLY');
  assert.equal(verified.document.finalInstaller, false);
  assert.equal(verified.document.finalReleaseEvidence, false);
  const tampered = JSON.parse(fs.readFileSync(file, 'utf8'));
  tampered.artifactClass = 'WP7_FINAL_RELEASE';
  fs.writeFileSync(file, `${JSON.stringify(tampered, null, 2)}
`);
  assert.throws(() => readAndVerifyPreReviewSealedArtifact(file, data), (error) => error?.reasonCode === 'WP7_PRE_REVIEW_SEALED_ARTIFACT_SCHEMA_INVALID');
});

test('packaged runner cannot accept a bare hash in place of the sealed artifact file', () => {
  assert.throws(
    () => readAndVerifyPreReviewSealedArtifact('e'.repeat(64)),
    (error) => error?.reasonCode === 'WP7_PRE_REVIEW_SEALED_ARTIFACT_MISSING'
  );
});

test('arbitrary shell executable that prints v31.7.7 is rejected before execution', () => {
  const root = transientTempRoot('wp7-fake-electron-');
  const archive = path.join(root, 'electron-v31.7.7-linux-x64.zip');
  const product = path.join(root, 'Yance');
  fs.writeFileSync(archive, 'not official Electron');
  fs.writeFileSync(product, '#!/bin/sh\nif [ "$1" = "--version" ]; then echo v31.7.7; fi\n');
  fs.chmodSync(product, 0o755);
  assert.throws(
    () => verifyTrustedProductExecutable({ repoRoot: REPO, electronArchivePath: archive, productExecutablePath: product, payloadRoot: root, platform: 'linux', arch: 'x64' }),
    (error) => error?.reasonCode === 'WP7_PACKAGED_ELECTRON_EXECUTABLE_TRUST_NOT_ENFORCED'
  );
});

test('packaged payload validator rejects a sealed payload that does not use electron/main.js', () => {
  const { built } = buildPackagedArtifact();
  const packagePath = path.join(built.payloadRoot, 'resources', 'app', 'package.json');
  detachFile(packagePath);
  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  pkg.main = 'fixture.js';
  fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
  assert.throws(
    () => validatePackagedPayload(built.payloadRoot, built.resourcesRoot, { repoRoot: REPO }),
    (error) => ['WP7_PACKAGED_APPLICATION_PAYLOAD_CLOSURE_NOT_ENFORCED', 'WP7_PACKAGED_APPLICATION_SOURCE_BINDING_INVALID', 'WP7_PACKAGED_APPLICATION_ARTIFACT_INVALID'].includes(error?.reasonCode)
  );
});

test('packaged Electron main tampering is rejected by complete payload closure', () => {
  const { built } = buildPackagedArtifact();
  const mainPath = path.join(built.payloadRoot, 'resources', 'app', 'electron', 'main.js');
  detachFile(mainPath);
  fs.appendFileSync(mainPath, '\n// tampered\n');
  assert.throws(
    () => validatePackagedPayload(built.payloadRoot, built.resourcesRoot, { repoRoot: REPO }),
    (error) => error?.reasonCode === 'WP7_PACKAGED_APPLICATION_PAYLOAD_CLOSURE_NOT_ENFORCED'
  );
});

test('non-main production module tampering is rejected by payload and reviewed-source closure', () => {
  const { built } = buildPackagedArtifact();
  const target = path.join(built.payloadRoot, 'resources', 'app', 'electron', 'wp7InstalledRuntimeProbe.js');
  detachFile(target);
  fs.appendFileSync(target, '\n// malicious replacement\n');
  assert.throws(
    () => validatePackagedPayload(built.payloadRoot, built.resourcesRoot, { repoRoot: REPO }),
    (error) => error?.reasonCode === 'WP7_PACKAGED_APPLICATION_PAYLOAD_CLOSURE_NOT_ENFORCED'
  );
  assert.throws(
    () => validateReviewedApplicationSourceClosure(built.payloadRoot, REPO, git(['rev-parse', 'HEAD'])),
    (error) => error?.reasonCode === 'WP7_PACKAGED_APPLICATION_SOURCE_BINDING_INVALID'
  );
});

test('payload closure rejects missing, extra and incorrectly recorded payload files', () => {
  {
    const { built } = buildPackagedArtifact();
    fs.rmSync(path.join(built.payloadRoot, 'resources', 'app', 'shared', 'release', 'releaseIdentity.js'));
    assert.throws(() => validatePackagedPayload(built.payloadRoot, built.resourcesRoot, { repoRoot: REPO }), (error) => error?.reasonCode === 'WP7_PACKAGED_APPLICATION_PAYLOAD_CLOSURE_NOT_ENFORCED');
  }
  {
    const { built } = buildPackagedArtifact();
    fs.writeFileSync(path.join(built.payloadRoot, 'resources', 'app', 'electron', 'unreviewed-extra.js'), 'module.exports = true;\n');
    assert.throws(() => validatePackagedPayload(built.payloadRoot, built.resourcesRoot, { repoRoot: REPO }), (error) => error?.reasonCode === 'WP7_PACKAGED_APPLICATION_PAYLOAD_CLOSURE_NOT_ENFORCED');
  }
  {
    const { built } = buildPackagedArtifact();
    const payloadFilesPath = path.join(built.resourcesRoot, 'payload-files.json');
    detachFile(payloadFilesPath);
    const document = JSON.parse(fs.readFileSync(payloadFilesPath, 'utf8'));
    document.files[0].sha256 = '0'.repeat(64);
    fs.writeFileSync(payloadFilesPath, `${JSON.stringify(document, null, 2)}\n`);
    assert.throws(() => validatePackagedPayload(built.payloadRoot, built.resourcesRoot, { repoRoot: REPO }), (error) => error?.reasonCode === 'WP7_PACKAGED_APPLICATION_PAYLOAD_CLOSURE_NOT_ENFORCED');
  }
});

test('release manifest payloadFilesSha256 and applicationPayloadSha256 are independently enforced', () => {
  for (const field of ['payloadFilesSha256', 'applicationPayloadSha256']) {
    const { built } = buildPackagedArtifact();
    const manifestPath = path.join(built.resourcesRoot, 'release-manifest.json');
    const detachedPath = path.join(built.resourcesRoot, 'release-manifest.sha256');
    detachFile(manifestPath);
    detachFile(detachedPath);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest[field] = '0'.repeat(64);
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    fs.writeFileSync(detachedPath, `${sha256File(manifestPath)}  release-manifest.json\n`);
    assert.throws(() => validatePackagedPayload(built.payloadRoot, built.resourcesRoot, { repoRoot: REPO }), (error) => error?.reasonCode === 'WP7_PACKAGED_APPLICATION_PAYLOAD_CLOSURE_NOT_ENFORCED');
  }
});

test('complete Electron distribution tree rejects modified, missing and extra non-application runtime files', () => {
  const officialRecords = fakeElectronOfficialRecords();
  {
    const { built } = buildPackagedArtifact();
    assert.equal(compareElectronDistributionTree({ payloadRoot: built.payloadRoot, archiveExecutableEntry: ELECTRON_ARCHIVE_EXECUTABLE, productExecutableName: PRODUCT_EXECUTABLE_NAME, officialRecords }).archiveFileCount, 2);
  }
  {
    const { built } = buildPackagedArtifact();
    const resourcePath = path.join(built.payloadRoot, 'resources.pak');
    detachFile(resourcePath);
    fs.writeFileSync(resourcePath, 'tampered-runtime-resource');
    assert.throws(() => compareElectronDistributionTree({ payloadRoot: built.payloadRoot, archiveExecutableEntry: ELECTRON_ARCHIVE_EXECUTABLE, productExecutableName: PRODUCT_EXECUTABLE_NAME, officialRecords }), (error) => error?.reasonCode === 'WP7_ELECTRON_DISTRIBUTION_TREE_TRUST_NOT_ENFORCED');
  }
  {
    const { built } = buildPackagedArtifact();
    fs.rmSync(path.join(built.payloadRoot, 'resources.pak'));
    assert.throws(() => compareElectronDistributionTree({ payloadRoot: built.payloadRoot, archiveExecutableEntry: ELECTRON_ARCHIVE_EXECUTABLE, productExecutableName: PRODUCT_EXECUTABLE_NAME, officialRecords }), (error) => error?.reasonCode === 'WP7_ELECTRON_DISTRIBUTION_TREE_TRUST_NOT_ENFORCED');
  }
  {
    const { built } = buildPackagedArtifact();
    fs.writeFileSync(path.join(built.payloadRoot, 'rogue-runtime.dll'), 'rogue');
    assert.throws(() => compareElectronDistributionTree({ payloadRoot: built.payloadRoot, archiveExecutableEntry: ELECTRON_ARCHIVE_EXECUTABLE, productExecutableName: PRODUCT_EXECUTABLE_NAME, officialRecords }), (error) => error?.reasonCode === 'WP7_ELECTRON_DISTRIBUTION_TREE_TRUST_NOT_ENFORCED');
  }
});

test('full packaged result validator rejects fake document, wrong identity, platform and producer PID', () => {
  const expected = validResultExpected();
  assert.equal(validatePackagedProbeResult(validReport(expected), expected), true);
  for (const mutate of [
    (r) => { r.documentType = 'FAKE_NOT_REAL_ELECTRON'; },
    (r) => { r.buildId = 'fake-build'; },
    (r) => { r.frozenSourceCommit = '0'.repeat(40); },
    (r) => { r.actualPlatform = 'fake-platform'; },
    (r) => { r.producerPid += 1; },
    (r) => { r.producerExecutableSha256 = '0'.repeat(64); },
    (r) => { r.probeId = 'restart'; },
    (r) => { r.executionNonce = crypto.randomUUID(); }
  ]) {
    const report = validReport(expected);
    mutate(report);
    assert.throws(() => validatePackagedProbeResult(report, expected), (error) => error?.reasonCode === 'WP7_PACKAGED_ELECTRON_RESULT_VALIDATION_INCOMPLETE');
  }
});

test('formal packaged command launches product executable and does not pin only first-start', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
  const script = pkg.scripts['test:wp7:packaged-electron'];
  assert.equal(script, 'node tools/wp7/run-packaged-electron-probe-integration.js');
  assert.doesNotMatch(script, /\$WP7_|%WP7_|--installer-sha256|--probe-id\s+first-start/);
  const runner = fs.readFileSync(path.join(REPO, 'tools', 'wp7', 'run-packaged-electron-probe-integration.js'), 'utf8');
  for (const token of ['--product-executable', '--electron-archive', '--pre-review-sealed-artifact', 'WP7_PACKAGED_PRODUCT_EXECUTABLE', 'WP7_ELECTRON_RELEASE_ARCHIVE', 'WP7_PRE_REVIEW_SEALED_ARTIFACT']) assert.match(runner, new RegExp(token));
  assert.match(runner, /const probeIds = requestedProbeId \? \[requestedProbeId\] : FORMAL_PROBE_IDS/);
  assert.match(runner, /for \(const probeId of probeIds\)/);
  assert.match(runner, /executable:\s*context\.trust\.productExecutable/);
  assert.doesNotMatch(runner, /spawnSync\(trust\.productExecutable,\s*\['--version'\]/);
});

test('formal pre-review product and evidence commands require actual reviewed inputs and cannot claim final release', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
  const buildScript = pkg.scripts['build:wp7:pre-review-product'];
  const evidenceScript = pkg.scripts['evidence:wp7:pre-review'];
  assert.equal(buildScript, 'node tools/wp7/create-pre-review-trusted-product.js');
  assert.doesNotMatch(buildScript, /\$WP7_|%WP7_/);
  assert.equal(evidenceScript, 'node tools/wp7/generate-pre-review-evidence.js');
  assert.doesNotMatch(evidenceScript, /\$WP7_|%WP7_/);

  const builder = fs.readFileSync(path.join(REPO, 'tools', 'wp7', 'create-pre-review-trusted-product.js'), 'utf8');
  assert.match(builder, /artifactClass:\s*PRE_REVIEW_ARTIFACT_CLASS/);
  assert.match(builder, /finalReleaseEvidence:\s*false/);
  assert.match(builder, /validateApplicationPayloadClosure/);
  assert.match(builder, /verifyTrustedProductExecutable/);
  assert.match(builder, /rceditPath/);
  assert.match(builder, /rceditSha256/);
  assert.match(builder, /closure\.identity\.artifactClass/);
  assert.doesNotMatch(builder, /closure\.releaseIdentity/);
  assert.match(builder, /WP7_PRE_REVIEW_TRUSTED_PRODUCT_BUILD/);
  for (const envName of ['WP7_ELECTRON_RELEASE_ARCHIVE', 'WP7_ELECTRON_DISTRIBUTION_ROOT', 'WP7_PRODUCTION_NODE_MODULES', 'WP7_TRUSTED_NODE_EXECUTABLE', 'WP7_RCEDIT_PATH', 'WP7_PRE_REVIEW_PRODUCT_OUTPUT', 'WP7_PRE_REVIEW_BUILD_SESSION_ID']) assert.match(builder, new RegExp(envName));
  assert.match(builder, /NODE_USTAR_STREAM_GZIP_V2/);
  assert.doesNotMatch(builder, /spawnSync\(['"]tar['"]/);
  assert.doesNotMatch(builder, /artifactClass:\s*['"]WP7_FINAL_RELEASE['"]/);
  assert.doesNotMatch(builder, /formalWindowsEvidenceEligible:\s*true/);

  const candidateBuilder = fs.readFileSync(path.join(REPO, 'tools', 'wp7', 'create-convergence-pre-review-candidate.js'), 'utf8');
  const candidateVerifier = fs.readFileSync(path.join(REPO, 'tools', 'wp7', 'verify-convergence-pre-review-candidate.js'), 'utf8');
  assert.equal(pkg.scripts['create:wp7:pre-review-candidate'], 'node tools/wp7/create-convergence-pre-review-candidate.js');
  assert.equal(pkg.scripts['verify:wp7:pre-review-candidate'], 'node tools/wp7/verify-convergence-pre-review-candidate.js');
  assert.doesNotMatch(pkg.scripts['create:wp7:pre-review-candidate'], /\$WP7_|%WP7_/);
  assert.doesNotMatch(pkg.scripts['verify:wp7:pre-review-candidate'], /\$WP7_|%WP7_/);
  assert.match(candidateBuilder, /createDeterministicZip/);
  assert.doesNotMatch(candidateBuilder, /run\(['"]zip['"]/);
  for (const token of ['WP7_PRE_REVIEW_ONLY', 'preAcceptanceIssued: false', 'finalPackagingAuthorized: false', "finalAcceptanceStatus: 'NOT_ACCEPTED'", 'WP7_PRE_REVIEW_EVIDENCE_INDEX.json', 'WP7_CPR_R9_INTERNAL_SHA256.txt']) assert.match(candidateBuilder, new RegExp(token));
  for (const token of ['verifyReviewBundle', 'verifyPatch', 'verifySourceZip', 'verifyInternalHashes', 'verifyArtifactManifest', 'readAndVerifyPreReviewSealedArtifact']) assert.match(candidateVerifier, new RegExp(token));

  const generator = fs.readFileSync(path.join(REPO, 'tools', 'wp7', 'generate-pre-review-evidence.js'), 'utf8');
  for (const token of ['--probe-output-dir', '--nine-probe-result', '--pre-review-sealed-artifact', '--trusted-product-archive', '--electron-archive', '--build-json', '--verification-root', '--output-dir', 'WP7_PROBE_OUTPUT_DIR', 'WP7_NINE_PROBE_RESULT', 'WP7_PRE_REVIEW_EVIDENCE_OUTPUT']) assert.match(generator, new RegExp(token));
  assert.match(generator, /validateNineProbeRawEvidence/);
  assert.match(generator, /readAndVerifyPreReviewSealedArtifact/);
  assert.match(generator, /WP7_PRE_REVIEW_EVIDENCE_INDEX\.json/);
  assert.match(generator, /WP7_PRE_REVIEW_INTERNAL_SHA256\.txt/);
  assert.doesNotMatch(generator, /installer fixture/i);
});

test('pre-review packaged probe result cannot be promoted to formal Windows evidence', () => {
  const { validateProbeEvidenceClassification } = require('../../tools/wp7/windows-final-harness');
  assert.throws(
    () => validateProbeEvidenceClassification({ executionClass: 'PRE_REVIEW_PACKAGED_INTEGRATION', formalWindowsEvidenceEligible: false, actualPlatform: process.platform }, 'first-start'),
    (error) => error?.reasonCode === 'WP7_FINAL_WINDOWS_EVIDENCE_PROVENANCE_BYPASS'
  );
  assert.equal(validateProbeEvidenceClassification({ executionClass: 'FINAL_WINDOWS', formalWindowsEvidenceEligible: true, actualPlatform: 'win32' }, 'first-start'), true);
});


function resealInternalPayloadMetadata(built) {
  const payloadFilesPath = path.join(built.resourcesRoot, 'payload-files.json');
  const manifestPath = path.join(built.resourcesRoot, 'release-manifest.json');
  const detachedPath = path.join(built.resourcesRoot, 'release-manifest.sha256');
  detachFile(payloadFilesPath);
  detachFile(manifestPath);
  detachFile(detachedPath);
  const payloadDocument = JSON.parse(fs.readFileSync(payloadFilesPath, 'utf8'));
  const records = wp1.generatePayloadRecords(built.payloadRoot, { excludedPaths: CONTROLLED_METADATA_PATHS });
  payloadDocument.files = records;
  writeCanonicalJson(payloadFilesPath, payloadDocument);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.payloadFilesSha256 = sha256File(payloadFilesPath);
  manifest.applicationPayloadSha256 = wp1.applicationPayloadSha256(records);
  writeCanonicalJson(manifestPath, manifest);
  fs.writeFileSync(detachedPath, `${sha256File(manifestPath)}  release-manifest.json\n`);
}


function resealDependencyDirectoryModeIdentity(built, targetDirectoryPath) {
  const manifestPath = built.manifestPath || path.join(built.resourcesRoot, 'release-manifest.json');
  const detachedPath = built.detachedPath || path.join(built.resourcesRoot, 'release-manifest.sha256');
  detachFile(manifestPath);
  detachFile(detachedPath);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const sourceCommit = git(['rev-parse', 'HEAD']);
  const platform = readReviewedBinding(REPO, sourceCommit).binding.platforms[`${process.platform}-x64`];
  const directories = platform.directories.map((row) => {
    const fullPath = path.join(built.runtime.appRoot, ...row.path.split('/'));
    const rawMode = fs.statSync(fullPath).mode & 0o777;
    return { ...row, normalizedMode: process.platform === 'linux' ? rawMode.toString(8).padStart(4, '0') : ((rawMode & 0o200) !== 0 ? 'WINDOWS_DIRECTORY_OWNER_RWX' : 'WINDOWS_DIRECTORY_OWNER_RX') };
  });
  if (!directories.some((row) => row.path === targetDirectoryPath)) throw new Error('target directory is not present in the reviewed dependency binding');
  manifest.productionDependencyFileTreeSha256 = treeHash(platform.files, ['path', 'sizeBytes', 'sha256', 'mode']);
  manifest.productionDependencyModeTreeSha256 = treeHash(platform.files, ['path', 'mode']);
  manifest.productionDependencyModeRecordCount = platform.files.length;
  manifest.productionDependencyDirectoryModeTreeSha256 = treeHash(directories, ['path', 'type', 'normalizedMode']);
  manifest.productionDependencyDirectoryCount = directories.length;
  manifest.productionDependencyDirectoryModeRecordCount = directories.length;
  manifest.applicationPayloadFilesystemIdentitySha256 = applicationPayloadFilesystemIdentitySha256(manifest);
  writeCanonicalJson(manifestPath, manifest);
  fs.writeFileSync(detachedPath, `${sha256File(manifestPath)}  release-manifest.json\n`, 'utf8');
}

function resealDependencyModeIdentity(built) {
  const manifestPath = path.join(built.resourcesRoot, 'release-manifest.json');
  const detachedPath = path.join(built.resourcesRoot, 'release-manifest.sha256');
  detachFile(manifestPath);
  detachFile(detachedPath);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const { files, directories } = walkDependencyFilesystem(path.join(built.runtime.appRoot, 'node_modules'), process.platform);
  manifest.productionDependencyFileTreeSha256 = treeHash(files, ['path', 'sizeBytes', 'sha256', 'mode']);
  manifest.productionDependencyModeTreeSha256 = treeHash(files, ['path', 'mode']);
  manifest.productionDependencyModeRecordCount = files.length;
  manifest.productionDependencyDirectoryModeTreeSha256 = treeHash(directories, ['path', 'type', 'normalizedMode']);
  manifest.productionDependencyDirectoryCount = directories.length;
  manifest.productionDependencyDirectoryModeRecordCount = directories.length;
  manifest.applicationPayloadFilesystemIdentitySha256 = applicationPayloadFilesystemIdentitySha256(manifest);
  writeCanonicalJson(manifestPath, manifest);
  fs.writeFileSync(detachedPath, `${sha256File(manifestPath)}  release-manifest.json\n`);
}

test('production dependency external binding rejects replacement, injection, deletion and joint internal re-signing', () => {
  const sourceCommit = git(['rev-parse', 'HEAD']);
  const binding = readReviewedBinding(REPO, sourceCommit).binding.platforms[`${process.platform}-x64`];
  const targetRelative = binding.files.find((row) => /\.(?:js|cjs|mjs)$/.test(row.path))?.path || binding.files.find((row) => !row.path.endsWith('/package.json'))?.path || binding.files[0].path;
  {
    const { built } = buildPackagedArtifact();
    const targetPath = path.join(built.payloadRoot, 'resources', 'app', ...targetRelative.split('/'));
    detachFile(targetPath);
    fs.appendFileSync(targetPath, '\n');
    assert.throws(() => verifyProductionDependencyClosure({ repoRoot: REPO, appRoot: built.runtime.appRoot, sourceCommit, platform: process.platform, arch: 'x64' }), (error) => error?.reasonCode === 'WP7_PRODUCTION_DEPENDENCY_FILE_TREE_MISMATCH');
  }
  {
    const { built } = buildPackagedArtifact();
    fs.writeFileSync(path.join(built.runtime.appRoot, 'node_modules', 'injected-dependency-code.js'), 'module.exports = true;\n');
    assert.throws(() => verifyProductionDependencyClosure({ repoRoot: REPO, appRoot: built.runtime.appRoot, sourceCommit, platform: process.platform, arch: 'x64' }), (error) => error?.reasonCode === 'WP7_PRODUCTION_DEPENDENCY_FILE_TREE_MISMATCH');
  }
  {
    const { built } = buildPackagedArtifact();
    fs.rmSync(path.join(built.payloadRoot, 'resources', 'app', ...targetRelative.split('/')));
    assert.throws(() => verifyProductionDependencyClosure({ repoRoot: REPO, appRoot: built.runtime.appRoot, sourceCommit, platform: process.platform, arch: 'x64' }), (error) => error?.reasonCode === 'WP7_PRODUCTION_DEPENDENCY_FILE_TREE_MISMATCH');
  }
  {
    const { built } = buildPackagedArtifact();
    const targetPath = path.join(built.payloadRoot, 'resources', 'app', ...targetRelative.split('/'));
    detachFile(targetPath);
    fs.appendFileSync(targetPath, '\n// jointly resigned dependency replacement\n');
    resealInternalPayloadMetadata(built);
    assert.throws(() => validatePackagedPayload(built.payloadRoot, built.resourcesRoot, { repoRoot: REPO }), (error) => error?.reasonCode === 'WP7_PRODUCTION_DEPENDENCY_FILE_TREE_MISMATCH');
  }
});


test('production dependency file modes are exact, mode-hashed and resist joint internal re-signing', { skip: process.platform !== 'linux' }, () => {
  const sourceCommit = git(['rev-parse', 'HEAD']);
  const binding = readReviewedBinding(REPO, sourceCommit).binding.platforms['linux-x64'];
  const executable = binding.files.find((row) => row.mode === '0755' || row.mode === '0754');
  const regular = binding.files.find((row) => row.mode === '0644');
  assert.ok(executable, 'expected executable production dependency file');
  assert.ok(regular, 'expected regular production dependency file');
  for (const [record, mode] of [[executable, 0o600], [executable, 0o644], [regular, 0o755], [regular, 0o666]]) {
    const { built } = buildPackagedArtifact();
    const targetPath = path.join(built.runtime.appRoot, ...record.path.split('/'));
    detachFile(targetPath);
    fs.chmodSync(targetPath, mode);
    assert.throws(
      () => verifyProductionDependencyClosure({ repoRoot: REPO, appRoot: built.runtime.appRoot, sourceCommit, platform: 'linux', arch: 'x64' }),
      (error) => error?.reasonCode === 'WP7_PRODUCTION_DEPENDENCY_FILE_MODE_MISMATCH'
    );
  }
  {
    const { built } = buildPackagedArtifact();
    const targetPath = path.join(built.runtime.appRoot, ...executable.path.split('/'));
    detachFile(targetPath);
    fs.chmodSync(targetPath, 0o644);
    resealDependencyModeIdentity(built);
    assert.throws(
      () => validatePackagedPayload(built.payloadRoot, built.resourcesRoot, { repoRoot: REPO }),
      (error) => error?.reasonCode === 'WP7_PRODUCTION_DEPENDENCY_FILE_MODE_MISMATCH'
    );
  }
});



test('production dependency directory modes bind root, scope, package and nested directories and resist joint internal re-signing', { skip: process.platform !== 'linux' }, () => {
  const sourceCommit = git(['rev-parse', 'HEAD']);
  const binding = readReviewedBinding(REPO, sourceCommit).binding.platforms['linux-x64'];
  const rootRecord = binding.directories.find((row) => row.path === 'node_modules');
  const scopeRecord = binding.directories.find((row) => /^node_modules\/@[^/]+$/.test(row.path));
  const packageRecord = binding.directories.find((row) => /^node_modules\/[^/@][^/]*$/.test(row.path));
  const nestedRecord = binding.directories.find((row) => row.path.split('/').length >= 4);
  assert.ok(rootRecord, 'node_modules root directory must be bound');
  assert.ok(packageRecord, 'package directory must be bound');
  assert.ok(binding.directoryCount === binding.directories.length && binding.modeBoundDirectoryCount === binding.directories.length);
  const mutations = [
    [rootRecord, 0o777],
    [packageRecord, 0o777],
    ...(scopeRecord ? [[scopeRecord, 0o775]] : []),
    ...(nestedRecord ? [[nestedRecord, 0o777]] : [])
  ];
  for (const [record, mode] of mutations) {
    const { built } = buildPackagedArtifact();
    const targetPath = path.join(built.runtime.appRoot, ...record.path.split('/'));
    fs.chmodSync(targetPath, mode);
    assert.throws(
      () => verifyProductionDependencyClosure({ repoRoot: REPO, appRoot: built.runtime.appRoot, sourceCommit, platform: 'linux', arch: 'x64' }),
      (error) => error?.reasonCode === 'WP7_PRODUCTION_DEPENDENCY_DIRECTORY_MODE_MISMATCH'
    );
  }
  {
    const { built } = buildPackagedArtifact();
    const targetPath = path.join(built.runtime.appRoot, ...packageRecord.path.split('/'));
    fs.chmodSync(targetPath, 0o777);
    resealDependencyDirectoryModeIdentity(built, packageRecord.path);
    assert.throws(
      () => validatePackagedPayload(built.payloadRoot, built.resourcesRoot, { repoRoot: REPO }),
      (error) => error?.reasonCode === 'WP7_PRODUCTION_DEPENDENCY_DIRECTORY_MODE_MISMATCH'
    );
  }
});

test('dependency directory mode identity deletion, forgery and external binding mutation are rejected', () => {
  {
    const { built } = buildPackagedArtifact();
    const manifestPath = path.join(built.resourcesRoot, 'release-manifest.json');
    const detachedPath = path.join(built.resourcesRoot, 'release-manifest.sha256');
    detachFile(manifestPath); detachFile(detachedPath);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    delete manifest.productionDependencyDirectoryModeTreeSha256;
    writeCanonicalJson(manifestPath, manifest);
    fs.writeFileSync(detachedPath, `${sha256File(manifestPath)}  release-manifest.json\n`);
    assert.throws(() => validatePackagedPayload(built.payloadRoot, built.resourcesRoot, { repoRoot: REPO }), (error) => error?.reasonCode === 'BOOT_MANIFEST_SCHEMA_INVALID');
  }
  {
    const { built } = buildPackagedArtifact();
    const manifestPath = path.join(built.resourcesRoot, 'release-manifest.json');
    const detachedPath = path.join(built.resourcesRoot, 'release-manifest.sha256');
    detachFile(manifestPath); detachFile(detachedPath);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.productionDependencyDirectoryModeTreeSha256 = '0'.repeat(64);
    manifest.applicationPayloadFilesystemIdentitySha256 = applicationPayloadFilesystemIdentitySha256(manifest);
    writeCanonicalJson(manifestPath, manifest);
    fs.writeFileSync(detachedPath, `${sha256File(manifestPath)}  release-manifest.json\n`);
    assert.throws(() => validatePackagedPayload(built.payloadRoot, built.resourcesRoot, { repoRoot: REPO }), (error) => ['WP7_PACKAGED_APPLICATION_RELEASE_IDENTITY_INCOMPLETE', 'WP7_APPLICATION_PAYLOAD_FILESYSTEM_IDENTITY_INVALID'].includes(error?.reasonCode));
  }
  {
    const sourceCommit = git(['rev-parse', 'HEAD']);
    const document = structuredClone(readReviewedBinding(REPO, sourceCommit).binding);
    delete document.platforms[`${process.platform}-x64`].directories[0];
    assert.throws(() => validateBindingDocument(document), (error) => error?.reasonCode === 'WP7_PRODUCTION_DEPENDENCY_BINDING_INVALID');
  }
  {
    const sourceCommit = git(['rev-parse', 'HEAD']);
    const document = structuredClone(readReviewedBinding(REPO, sourceCommit).binding);
    const directory = document.platforms[`${process.platform}-x64`].directories[0];
    directory.normalizedMode = process.platform === 'linux' ? '0777' : 'WINDOWS_DIRECTORY_OWNER_RX';
    assert.throws(() => validateBindingDocument(document), (error) => error?.reasonCode === 'WP7_PRODUCTION_DEPENDENCY_BINDING_INVALID');
  }
});

test('dependency mode identity deletion, forgery and malformed external mode records are rejected', () => {
  {
    const { built } = buildPackagedArtifact();
    const manifestPath = path.join(built.resourcesRoot, 'release-manifest.json');
    const detachedPath = path.join(built.resourcesRoot, 'release-manifest.sha256');
    detachFile(manifestPath); detachFile(detachedPath);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    delete manifest.productionDependencyModeTreeSha256;
    writeCanonicalJson(manifestPath, manifest);
    fs.writeFileSync(detachedPath, `${sha256File(manifestPath)}  release-manifest.json\n`);
    assert.throws(() => validatePackagedPayload(built.payloadRoot, built.resourcesRoot, { repoRoot: REPO }), (error) => error?.reasonCode === 'BOOT_MANIFEST_SCHEMA_INVALID');
  }
  {
    const { built } = buildPackagedArtifact();
    const manifestPath = path.join(built.resourcesRoot, 'release-manifest.json');
    const detachedPath = path.join(built.resourcesRoot, 'release-manifest.sha256');
    detachFile(manifestPath); detachFile(detachedPath);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.productionDependencyModeTreeSha256 = '0'.repeat(64);
    manifest.applicationPayloadFilesystemIdentitySha256 = applicationPayloadFilesystemIdentitySha256(manifest);
    writeCanonicalJson(manifestPath, manifest);
    fs.writeFileSync(detachedPath, `${sha256File(manifestPath)}  release-manifest.json\n`);
    assert.throws(() => validatePackagedPayload(built.payloadRoot, built.resourcesRoot, { repoRoot: REPO }), (error) => ['WP7_PACKAGED_APPLICATION_RELEASE_IDENTITY_INCOMPLETE', 'WP7_APPLICATION_PAYLOAD_FILESYSTEM_IDENTITY_INVALID'].includes(error?.reasonCode));
  }
  {
    const sourceCommit = git(['rev-parse', 'HEAD']);
    const document = structuredClone(readReviewedBinding(REPO, sourceCommit).binding);
    delete document.platforms[`${process.platform}-x64`].files[0].mode;
    assert.throws(() => validateBindingDocument(document), (error) => error?.reasonCode === 'WP7_PRODUCTION_DEPENDENCY_BINDING_INVALID');
  }
});

test('Windows dependency mode policy is explicit and machine-readable', () => {
  assert.equal(normalizedDependencyMode(0o100644, 'win32'), '0666');
  assert.equal(normalizedDependencyMode(0o100755, 'win32'), '0666');
  assert.equal(normalizedDependencyMode(0o100444, 'win32'), '0444');
  assert.throws(() => normalizedDependencyMode(0o100000, 'win32'), (error) => error?.reasonCode === 'WP7_PRODUCTION_DEPENDENCY_FILE_MODE_MISMATCH');
  assert.equal(normalizedDependencyDirectoryMode(0o40666, 'win32'), 'WINDOWS_DIRECTORY_OWNER_RWX');
  assert.equal(normalizedDependencyDirectoryMode(0o40444, 'win32'), 'WINDOWS_DIRECTORY_OWNER_RX');
  assert.equal(normalizedDependencyDirectoryMode(0o40755, 'win32'), 'WINDOWS_DIRECTORY_OWNER_RWX');
  assert.equal(normalizedDependencyDirectoryMode(0o40555, 'win32'), 'WINDOWS_DIRECTORY_OWNER_RX');
  assert.throws(() => normalizedDependencyDirectoryMode(0o40222, 'win32'), (error) => error?.reasonCode === 'WP7_PRODUCTION_DEPENDENCY_DIRECTORY_MODE_MISMATCH');
});

test('formal trusted-product probe IDs have one executable and governance authority', () => {
  const scope = readFormalProbeScope(REPO);
  assert.deepEqual(scope.document.formalProbeIds, [...FORMAL_PROBE_IDS]);
  assert.equal(scope.document.requiredProbeCount, 9);
  const blocker = createTrustedProductProbeBlocker({ repoRoot: REPO, sourceCommit: 'a'.repeat(40), sourceTree: 'b'.repeat(40), generatedAtUtc: '2026-07-06T00:00:00.000Z' });
  assert.deepEqual(blocker.formalProbeIds, [...FORMAL_PROBE_IDS]);
  assert.equal(blocker.required, 9);
  assert.throws(() => assertFormalProbeIdSet([...FORMAL_PROBE_IDS].reverse()), (error) => error?.reasonCode === 'WP7_TRUSTED_PRODUCT_PROBE_ID_SET_INCONSISTENT');
});

test('package-lock graph, integrity, version and source mutations are rejected by the external dependency authority', () => {
  const sourceCommit = git(['rev-parse', 'HEAD']);
  for (const mutate of [
    (lock) => { delete lock.packages[''].dependencies.express; },
    (lock) => { lock.packages['node_modules/express'].integrity = 'sha512-' + Buffer.from('forged').toString('base64'); },
    (lock) => { lock.packages['node_modules/express'].version = '0.0.0-forged'; },
    (lock) => { lock.packages['node_modules/express'].resolved = 'https://forged.invalid/express.tgz'; }
  ]) {
    const { built } = buildPackagedArtifact();
    const lockPath = path.join(built.runtime.appRoot, 'package-lock.json');
    detachFile(lockPath);
    const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    mutate(lock);
    fs.writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
    assert.throws(() => verifyProductionDependencyClosure({ repoRoot: REPO, appRoot: built.runtime.appRoot, sourceCommit, platform: process.platform, arch: 'x64' }), (error) => ['WP7_PRODUCTION_DEPENDENCY_GRAPH_MISMATCH','WP7_PRODUCTION_DEPENDENCY_VERSION_MISMATCH'].includes(error?.reasonCode));
  }
});

test('replaced or re-signed dependency binding is rejected against the reviewed Git blob', () => {
  const { built } = buildPackagedArtifact();
  const cloneRoot = transientTempRoot('wp7-binding-replacement-');
  require('node:child_process').execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'core.eol=lf', 'clone', '--config', 'core.autocrlf=false', '--config', 'core.eol=lf', '--no-hardlinks', REPO, cloneRoot], { stdio: 'ignore' });
  const bindingPath = path.join(cloneRoot, 'release', 'production-dependency-binding.json');
  const document = JSON.parse(fs.readFileSync(bindingPath, 'utf8'));
  document.sourceAuthority = 'FORGED_REISSUED_BY_PACKAGER';
  fs.writeFileSync(bindingPath, `${JSON.stringify(document, null, 2)}\n`);
  assert.throws(() => verifyProductionDependencyClosure({ repoRoot: cloneRoot, appRoot: built.runtime.appRoot, sourceCommit: git(['rev-parse', 'HEAD']), platform: process.platform, arch: 'x64' }), (error) => error?.reasonCode === 'WP7_PRODUCTION_DEPENDENCY_EXTERNAL_BINDING_INVALID');
});

test('Git 100755 and 100644 modes are compared exactly and bound into release identity', { skip: process.platform === 'win32' ? 'POSIX chmod mutation is not applicable to Windows mode normalization' : false }, () => {
  {
    const { built } = buildPackagedArtifact();
    const executableSource = path.join(built.runtime.appRoot, 'backend', 'desktopHostedEntry.js');
    detachFile(executableSource);
    fs.chmodSync(executableSource, 0o600);
    assert.throws(() => validateReviewedApplicationSourceClosure(built.payloadRoot, REPO, git(['rev-parse', 'HEAD'])), (error) => error?.reasonCode === 'WP7_GIT_PAYLOAD_MODE_BINDING_INVALID');
  }
  {
    const { built } = buildPackagedArtifact();
    const regularSource = path.join(built.runtime.appRoot, 'backend', 'config.js');
    detachFile(regularSource);
    fs.chmodSync(regularSource, 0o755);
    assert.throws(() => validateReviewedApplicationSourceClosure(built.payloadRoot, REPO, git(['rev-parse', 'HEAD'])), (error) => error?.reasonCode === 'WP7_GIT_PAYLOAD_MODE_BINDING_INVALID');
  }
  {
    const { built } = buildPackagedArtifact();
    detachFile(built.manifestPath);
    detachFile(built.detachedPath);
    const manifest = JSON.parse(fs.readFileSync(built.manifestPath, 'utf8'));
    manifest.gitPayloadModeTreeSha256 = '0'.repeat(64);
    writeCanonicalJson(built.manifestPath, manifest);
    fs.writeFileSync(built.detachedPath, `${sha256File(built.manifestPath)}  release-manifest.json\n`);
    assert.throws(() => validatePackagedPayload(built.payloadRoot, built.resourcesRoot, { repoRoot: REPO }), (error) => error?.reasonCode === 'WP7_PACKAGED_APPLICATION_RELEASE_IDENTITY_INCOMPLETE');
  }
  {
    const { built } = buildPackagedArtifact();
    detachFile(built.manifestPath);
    detachFile(built.detachedPath);
    const manifest = JSON.parse(fs.readFileSync(built.manifestPath, 'utf8'));
    delete manifest.gitPayloadModeTreeSha256;
    writeCanonicalJson(built.manifestPath, manifest);
    fs.writeFileSync(built.detachedPath, `${sha256File(built.manifestPath)}  release-manifest.json\n`);
    assert.throws(() => validatePackagedPayload(built.payloadRoot, built.resourcesRoot, { repoRoot: REPO }), (error) => error?.reasonCode === 'BOOT_MANIFEST_SCHEMA_INVALID');
  }
});

test('Windows project payload mode policy normalizes NTFS writable files while preserving reviewed Git logical modes', () => {
  assert.equal(projectFileModePolicyForPlatform('win32'), 'WINDOWS_READONLY_ATTRIBUTE_NORMALIZED_WITH_GIT_LOGICAL_MODE_V1');
  assert.equal(expectedPayloadMode('100644', 'win32'), 0o666);
  assert.equal(expectedPayloadMode('100755', 'win32'), 0o666);
  assert.equal(normalizedProjectPayloadMode(0o666, 'win32'), 0o666);
  assert.equal(normalizedProjectPayloadMode(0o644, 'win32'), 0o666);
  assert.equal(normalizedProjectPayloadMode(0o444, 'win32'), 0o444);

  const repo = transientTempRoot('wp7-windows-project-mode-repo-');
  const payloadRoot = transientTempRoot('wp7-windows-project-mode-payload-');
  const sourceBackend = path.join(repo, 'backend');
  const payloadBackend = path.join(payloadRoot, 'resources', 'app', 'backend');
  fs.mkdirSync(sourceBackend, { recursive: true });
  fs.mkdirSync(payloadBackend, { recursive: true });
  fs.writeFileSync(path.join(sourceBackend, 'config.js'), "'use strict';\nmodule.exports = 1;\n");
  fs.writeFileSync(path.join(sourceBackend, 'launcher.js'), "'use strict';\nmodule.exports = 2;\n");
  require('node:child_process').execFileSync('git', ['init'], { cwd: repo, stdio: 'ignore' });
  require('node:child_process').execFileSync('git', ['config', 'user.email', 'wp7-mode-test@example.invalid'], { cwd: repo });
  require('node:child_process').execFileSync('git', ['config', 'user.name', 'WP7 Mode Test'], { cwd: repo });
  require('node:child_process').execFileSync('git', ['add', '--all'], { cwd: repo });
  require('node:child_process').execFileSync('git', ['update-index', '--chmod=+x', 'backend/launcher.js'], { cwd: repo });
  require('node:child_process').execFileSync('git', ['commit', '-m', 'mode fixture'], { cwd: repo, stdio: 'ignore' });
  const sourceCommit = require('node:child_process').execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();

  for (const name of ['config.js', 'launcher.js']) {
    const destination = path.join(payloadBackend, name);
    fs.copyFileSync(path.join(sourceBackend, name), destination);
    fs.chmodSync(destination, 0o666);
  }

  const closure = validateReviewedApplicationSourceClosure(payloadRoot, repo, sourceCommit, { platform: 'win32' });
  const regularRecord = closure.gitPayloadModeRecords.find((row) => row.payloadPath === 'resources/app/backend/config.js');
  const executableRecord = closure.gitPayloadModeRecords.find((row) => row.payloadPath === 'resources/app/backend/launcher.js');
  assert.equal(closure.gitPayloadModePolicy, 'WINDOWS_READONLY_ATTRIBUTE_NORMALIZED_WITH_GIT_LOGICAL_MODE_V1');
  assert.equal(regularRecord.gitMode, '100644');
  assert.equal(regularRecord.actualMode, 0o666);
  assert.equal(executableRecord.gitMode, '100755');
  assert.equal(executableRecord.actualMode, 0o666);

  fs.chmodSync(path.join(payloadBackend, 'config.js'), 0o444);
  assert.throws(
    () => validateReviewedApplicationSourceClosure(payloadRoot, repo, sourceCommit, { platform: 'win32' }),
    (error) => error?.reasonCode === 'WP7_GIT_PAYLOAD_MODE_BINDING_INVALID'
      && error?.details?.modeMismatched?.some((row) => row.path === 'resources/app/backend/config.js'
        && row.expectedMode === '0666'
        && row.actualMode === '0444')
  );
});

test('Electron unixMode is compared per file and included in the bound distribution tree hash', { skip: process.platform === 'win32' ? 'POSIX Electron unixMode mutation is not applicable on Windows' : false }, () => {
  const official = fakeElectronOfficialRecords();
  const { built } = buildPackagedArtifact();
  const baseline = compareElectronDistributionTree({ payloadRoot: built.payloadRoot, archiveExecutableEntry: ELECTRON_ARCHIVE_EXECUTABLE, productExecutableName: PRODUCT_EXECUTABLE_NAME, officialRecords: official });
  detachFile(path.join(built.payloadRoot, PRODUCT_EXECUTABLE_NAME));
  detachFile(path.join(built.payloadRoot, 'resources.pak'));
  assert.equal(baseline.modeBoundFileCount, 2);
  {
    fs.chmodSync(path.join(built.payloadRoot, PRODUCT_EXECUTABLE_NAME), 0o644);
    assert.throws(() => compareElectronDistributionTree({ payloadRoot: built.payloadRoot, archiveExecutableEntry: ELECTRON_ARCHIVE_EXECUTABLE, productExecutableName: PRODUCT_EXECUTABLE_NAME, officialRecords: official }), (error) => error?.reasonCode === 'WP7_ELECTRON_DISTRIBUTION_TREE_TRUST_NOT_ENFORCED');
    fs.chmodSync(path.join(built.payloadRoot, PRODUCT_EXECUTABLE_NAME), 0o755);
  }
  {
    fs.chmodSync(path.join(built.payloadRoot, 'resources.pak'), 0o755);
    assert.throws(() => compareElectronDistributionTree({ payloadRoot: built.payloadRoot, archiveExecutableEntry: ELECTRON_ARCHIVE_EXECUTABLE, productExecutableName: PRODUCT_EXECUTABLE_NAME, officialRecords: official }), (error) => error?.reasonCode === 'WP7_ELECTRON_DISTRIBUTION_TREE_TRUST_NOT_ENFORCED');
    fs.chmodSync(path.join(built.payloadRoot, 'resources.pak'), 0o644);
  }
  {
    const deletedMode = official.map((row) => ({ ...row }));
    delete deletedMode[0].unixMode;
    assert.throws(() => compareElectronDistributionTree({ payloadRoot: built.payloadRoot, archiveExecutableEntry: ELECTRON_ARCHIVE_EXECUTABLE, productExecutableName: PRODUCT_EXECUTABLE_NAME, officialRecords: deletedMode, expectedDistributionTreeSha256: baseline.distributionTreeSha256 }), (error) => error?.reasonCode === 'WP7_ELECTRON_DISTRIBUTION_TREE_IDENTITY_MISMATCH');
  }
  {
    const forgedMode = official.map((row) => ({ ...row }));
    forgedMode[0].unixMode = 0o100644;
    fs.chmodSync(path.join(built.payloadRoot, PRODUCT_EXECUTABLE_NAME), 0o644);
    assert.throws(() => compareElectronDistributionTree({ payloadRoot: built.payloadRoot, archiveExecutableEntry: ELECTRON_ARCHIVE_EXECUTABLE, productExecutableName: PRODUCT_EXECUTABLE_NAME, officialRecords: forgedMode, expectedDistributionTreeSha256: baseline.distributionTreeSha256 }), (error) => error?.reasonCode === 'WP7_ELECTRON_DISTRIBUTION_TREE_IDENTITY_MISMATCH');
  }
});
