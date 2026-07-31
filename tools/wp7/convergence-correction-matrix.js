#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync, spawn } = require('node:child_process');
const {
  REPO_ROOT,
  PHASE_MODEL_PATH,
  Wp7Error,
  gitIdentity,
  readJson,
  assertPreacceptedImplementation,
  createDetachedFrozenSource,
  assertSourceStillFrozen,
  validateNsisSourcePaths,
  validateEvidenceReferences,
  validateEvidenceCommon,
  verifyRequiredTestImplementations,
  writeCanonicalJson,
  buildFinalWindowsPayload,
  PRE_REVIEW_ARTIFACT_CLASS,
  createReviewFixtureBrandingOptions
} = require('./lib');
const { assertNoCallerClaims, validateHarnessResult, readFinalExecutionContext } = require('./final-context');
const { generateFinalEvidenceSet } = require('./final-evidence');
const { runWindowsFinalHarness, WINDOWS_VALIDATION_TOKEN, validateProbeEvidenceClassification } = require('./windows-final-harness');
const { verifyReviewBundle, REQUIRED_TAG } = require('./verify-review-bundle');
const { bindProbeIdentity, executeInstalledRuntimeProbe, readInstalledRuntimeProbeRequest, validateMeasurements } = require('../../electron/wp7InstalledRuntimeProbe');
const { FORMAL_PROBE_IDS, assertFormalProbeIdSet } = require('../../shared/wp7/formalProbeIds');
const { measurementFor } = require('../../tests/wp7/installed-runtime-probe-fixtures');
const { assertIndependentObservations, createIdentityObservation, validateObservation } = require('../../shared/release/identityObservation');
const { assertPreReviewProductClassification, validatePackagedPayload, validatePackagedProbeResult } = require('./run-packaged-electron-probe-integration');
const {
  SEALED_ARTIFACT_TYPE,
  createPreReviewSealedArtifact,
  readAndVerifyPreReviewSealedArtifact
} = require('./pre-review-sealed-artifact');
const { normalizeRelativePath, resolveEvidenceFile } = require('./pre-review-evidence-package');
const { compareElectronDistributionTree, verifyTrustedProductExecutable, sha256File } = require('./packaged-product-trust');
const { CONTROLLED_METADATA_PATHS, validateReviewedApplicationSourceClosure } = require('./packaged-payload-closure');
const { readReviewedBinding, verifyProductionDependencyClosure, validateBindingDocument, walkDependencyFilesystem, treeHash } = require('./production-dependency-binding');
const { applicationPayloadFilesystemIdentitySha256 } = require('./filesystem-identity');
const { inspectTrustedNodeRuntime, validateManifestRuntimeIdentity, verifyNodeExecutable } = require('./node-runtime-identity');
const { compileLinuxNetworkIsolation, verifyNetworkIsolationIdentity, readPreMainProof } = require('./linux-network-isolation');
const { SqliteSettingsBridge } = require('../../electron/sqliteSettingsBridge');
const { disposeEventSocket } = require('../../electron/eventSocketLifecycle');
const { createTrustedProductProbeBlocker, readFormalProbeScope } = require('./trusted-product-probe-scope');
const wp1 = require('../wp1/lib');
const { createFakeElectronDist, createFakeTrustedNodeRuntime, fakeElectronOfficialRecords, productionDependencyFixture, cloneDirectoryFast, detachFile, remapPaths, createFakeRceditRunner } = require('../../tests/wp7/helpers');
const PROBE_MAIN_ENTRY = path.join(REPO_ROOT, 'electron', 'main.js');
const PROBE_EXECUTABLE_SHA256 = sha256File(process.execPath);
const PROBE_MAIN_ENTRY_SHA256 = sha256File(PROBE_MAIN_ENTRY);
const ELECTRON_ARCHIVE_EXECUTABLE = process.platform === 'win32' ? 'electron.exe' : 'electron';
const RELEASE_SOURCE = require('../../release/release-source.json');
const PRODUCT_EXECUTABLE_NAME = process.platform === 'win32' ? RELEASE_SOURCE.executableName : path.parse(RELEASE_SOURCE.executableName).name;

const tempRoots = new Set();
function temp(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempRoots.add(root);
  return root;
}
function cleanupTempRoots() {
  for (const root of [...tempRoots].reverse()) {
    try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }); } catch {}
    tempRoots.delete(root);
  }
}
function expectReason(reasonCode, fn) {
  try { fn(); }
  catch (error) {
    if (error && error.reasonCode === reasonCode) return { status: 'KILLED', observedReasonCode: error.reasonCode };
    throw error;
  }
  throw new Error(`mutation survived; expected ${reasonCode}`);
}

let packagedArtifactBaseline = null;
function buildPackagedArtifactBaseline() {
  if (packagedArtifactBaseline) return packagedArtifactBaseline;
  const root = temp('wp7-payload-closure-baseline-');
  const stagingRoot = path.join(root, 'staging');
  fs.mkdirSync(stagingRoot, { recursive: true });
  const identity = gitIdentity(REPO_ROOT);
  const built = buildFinalWindowsPayload({
    repoRoot: REPO_ROOT,
    stagingRoot,
    identity,
    buildTimestampUtc: '2026-07-06T00:00:00.000Z',
    allowNonWindows: true,
    installProductionDependencies: false,
    productionNodeModulesSource: productionDependencyFixture(REPO_ROOT),
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
function buildPackagedArtifactForMutation() {
  const baseline = buildPackagedArtifactBaseline();
  const root = temp('wp7-payload-closure-mutation-');
  cloneDirectoryFast(baseline.root, root);
  return { root, built: remapPaths(baseline.built, baseline.root, root) };
}
function rewriteManifestField(built, field, value) {
  detachFile(built.manifestPath);
  detachFile(built.detachedPath);
  const manifest = readJson(built.manifestPath);
  manifest[field] = value;
  writeCanonicalJson(built.manifestPath, manifest);
  fs.writeFileSync(built.detachedPath, `${sha256File(built.manifestPath)}  release-manifest.json\n`, 'utf8');
}
function fixtureDistributionRecords() {
  return fakeElectronOfficialRecords();
}

function fixturePreReviewSealData(overrides = {}) {
  const hash = 'a'.repeat(64);
  return {
    generatedAtUtc: '2026-07-06T10:00:00.000Z',
    buildSessionId: 'b'.repeat(32),
    ['build' + 'Id']: ['matrix', 'build'].join('-'),
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
    nativeBinaryScanSha256: hash,
    ...overrides
  };
}

function resealInternalPayloadMetadata(built, changedPayloadPaths) {
  detachFile(built.payloadFilesPath);
  detachFile(built.manifestPath);
  detachFile(built.detachedPath);
  const payloadDocument = readJson(built.payloadFilesPath);
  const changed = new Set(changedPayloadPaths);
  const seen = new Set();
  const records = payloadDocument.files.map((record) => {
    if (!changed.has(record.path)) return record;
    const filePath = path.join(built.payloadRoot, ...record.path.split('/'));
    const stat = fs.statSync(filePath);
    seen.add(record.path);
    return { ...record, sizeBytes: stat.size, sha256: sha256File(filePath) };
  });
  const missing = [...changed].filter((relativePath) => !seen.has(relativePath));
  if (missing.length) throw new Error(`changed payload records are missing: ${missing.join(', ')}`);
  payloadDocument.files = records;
  writeCanonicalJson(built.payloadFilesPath, payloadDocument);
  const manifest = readJson(built.manifestPath);
  manifest.payloadFilesSha256 = sha256File(built.payloadFilesPath);
  manifest.applicationPayloadSha256 = wp1.applicationPayloadSha256(records);
  writeCanonicalJson(built.manifestPath, manifest);
  fs.writeFileSync(built.detachedPath, `${sha256File(built.manifestPath)}  release-manifest.json\n`, 'utf8');
}
function mutatePackagedLock(built, mutate) {
  const lockPath = path.join(built.runtime.appRoot, 'package-lock.json');
  detachFile(lockPath);
  const lock = readJson(lockPath);
  mutate(lock);
  fs.writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
}
function dependencyTargetRelative(sourceCommit) {
  const platform = readReviewedBinding(REPO_ROOT, sourceCommit).binding.platforms[`${process.platform}-x64`];
  return platform.files.find((row) => /\.(?:js|cjs|mjs)$/.test(row.path))?.path || platform.files.find((row) => !row.path.endsWith('/package.json'))?.path || platform.files[0].path;
}


function dependencyModeTargets(sourceCommit) {
  const platform = readReviewedBinding(REPO_ROOT, sourceCommit).binding.platforms[`${process.platform}-x64`];
  const executable = platform.files.find((row) => row.mode === '0755' || row.mode === '0754');
  const regular = platform.files.find((row) => row.mode === '0644');
  if (!executable || !regular) throw new Error('dependency mode mutation targets are unavailable');
  return { executable, regular };
}

function dependencyDirectoryModeTargets(sourceCommit) {
  const platform = readReviewedBinding(REPO_ROOT, sourceCommit).binding.platforms[`${process.platform}-x64`];
  const root = platform.directories.find((row) => row.path === 'node_modules');
  const scope = platform.directories.find((row) => /^node_modules\/@[^/]+$/.test(row.path));
  const packageDirectory = platform.directories.find((row) => /^node_modules\/[^/@][^/]*$/.test(row.path));
  const nested = platform.directories.find((row) => row.path.split('/').length >= 4);
  if (!root || !packageDirectory) throw new Error('dependency directory mode mutation targets are unavailable');
  return { root, scope: scope || packageDirectory, packageDirectory, nested: nested || packageDirectory };
}

function resealDependencyDirectoryModeIdentity(built, targetDirectoryPath) {
  const manifestPath = built.manifestPath || path.join(built.resourcesRoot, 'release-manifest.json');
  const detachedPath = built.detachedPath || path.join(built.resourcesRoot, 'release-manifest.sha256');
  detachFile(manifestPath);
  detachFile(detachedPath);
  const manifest = readJson ? readJson(manifestPath) : JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const sourceCommit = gitIdentity ? gitIdentity(REPO_ROOT).sourceCommit : git(['rev-parse', 'HEAD']);
  const platform = readReviewedBinding(REPO_ROOT, sourceCommit).binding.platforms[`${process.platform}-x64`];
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
  detachFile(built.manifestPath);
  detachFile(built.detachedPath);
  const manifest = readJson(built.manifestPath);
  const { files, directories } = walkDependencyFilesystem(path.join(built.runtime.appRoot, 'node_modules'), process.platform);
  manifest.productionDependencyFileTreeSha256 = treeHash(files, ['path', 'sizeBytes', 'sha256', 'mode']);
  manifest.productionDependencyModeTreeSha256 = treeHash(files, ['path', 'mode']);
  manifest.productionDependencyModeRecordCount = files.length;
  manifest.productionDependencyDirectoryModeTreeSha256 = treeHash(directories, ['path', 'type', 'normalizedMode']);
  manifest.productionDependencyDirectoryCount = directories.length;
  manifest.productionDependencyDirectoryModeRecordCount = directories.length;
  manifest.applicationPayloadFilesystemIdentitySha256 = applicationPayloadFilesystemIdentitySha256(manifest);
  writeCanonicalJson(built.manifestPath, manifest);
  fs.writeFileSync(built.detachedPath, `${sha256File(built.manifestPath)}  release-manifest.json\n`, 'utf8');
}

function identityObservations(options = {}) {
  const identity = {
    buildId: ['build','cpr','r5'].join('-'),
    productVersion: [29,2,4].join('.'),
    stageVersion: [6,4,5,9].join('.'),
    sourceCommit: 'c'.repeat(40),
    sourceTree: 'd'.repeat(40),
    manifestSha256: 'e'.repeat(64)
  };
  const profiles = {
    electron: ['electron-main', 'electron-runtime-observation', '/observations/electron.json', 'electron/main.js', 101],
    backend: ['backend-ready-endpoint', 'http-endpoint', 'http://127.0.0.1/api/ready', 'backend/server.js', 202],
    installer: ['nsis-embedded-identity', 'installer-embedded-document', '/resources/installer-release-identity.json', 'installer/YanceFinalInstaller.nsi', 0],
    diagnostics: ['backend-diagnostics-endpoint', 'http-endpoint', 'http://127.0.0.1/api/r32/system/release-identity', 'backend/services/systemCenterService.js', 303]
  };
  return Object.fromEntries(Object.entries(profiles).map(([consumer, row]) => {
    const observedDocument = options.sharedDocument || { consumer, identity, nonce: consumer };
    return [consumer, createIdentityObservation({
      consumer,
      identity,
      producerType: row[0],
      sourceKind: row[1],
      observationSource: options.sharedSource || row[2],
      producerProcess: row[3],
      producerPid: row[4],
      observedAtUtc: '2026-07-05T14:00:00.000Z',
      observedDocument,
      rawDocumentConsumer: consumer
    })];
  }));
}

const checks = [
  {
    id: 'CR-M01',
    class: 'MUTATION',
    target: 'NSIS staging source path',
    expectedReasonCode: 'WP7_FINAL_INSTALLER_STAGING_PATH_MISMATCH',
    run() {
      const root = temp('wp7-nsis-path-');
      const staging = path.join(root, 'staging');
      fs.mkdirSync(path.join(staging, 'application-payload'), { recursive: true });
      fs.writeFileSync(path.join(staging, 'application-payload', RELEASE_SOURCE.executableName), 'x');
      const script = path.join(root, 'bad.nsi');
      fs.writeFileSync(script, 'File "${STAGING_ROOT}\\resources\\release-manifest.json"\n');
      return expectReason(this.expectedReasonCode, () => validateNsisSourcePaths({ stagingRoot: staging, scriptPath: script }));
    }
  },
  {
    id: 'CR-M02',
    class: 'MUTATION',
    target: 'exact preaccepted implementation identity',
    expectedReasonCode: 'WP7_PREACCEPTED_IMPLEMENTATION_IDENTITY_NOT_ENFORCED',
    run() {
      const current = gitIdentity(REPO_ROOT);
      const binding = { decision: 'WP7_PREACCEPTED_FOR_FINAL_PACKAGING', implementationCommit: current.sourceCommit, implementationSourceTree: current.sourceTree, recordSha256: 'a'.repeat(64), recordPath: 'fixture' };
      const descendant = { ...current, sourceCommit: 'f'.repeat(40), sourceTree: 'e'.repeat(40), repositoryClean: true };
      return expectReason(this.expectedReasonCode, () => assertPreacceptedImplementation(REPO_ROOT, { binding, identity: descendant }));
    }
  },
  {
    id: 'CR-R01',
    class: 'RACE',
    target: 'active source mutation after frozen snapshot',
    expectedReasonCode: 'WP7_SOURCE_CHANGED_DURING_BUILD',
    run() {
      const root = temp('wp7-source-race-correction-');
      const repo = path.join(root, 'repo');
      execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'core.eol=lf', 'clone', '--config', 'core.autocrlf=false', '--config', 'core.eol=lf', '--no-hardlinks', REPO_ROOT, repo], { stdio: 'ignore' });
      const identity = gitIdentity(repo);
      const parent = path.join(root, 'snapshot');
      fs.mkdirSync(parent, { recursive: true });
      const frozen = createDetachedFrozenSource(repo, identity.sourceCommit, identity.sourceTree, parent);
      try {
        fs.appendFileSync(path.join(repo, 'release', 'release-source.json'), '\n');
        return expectReason(this.expectedReasonCode, () => assertSourceStillFrozen(repo, identity, frozen.frozenRoot));
      } finally { frozen.release(); }
    }
  },
  {
    id: 'CR-M03',
    class: 'MUTATION',
    target: 'FINAL phase required test implementation presence',
    expectedReasonCode: 'WP7_FINAL_PHASE_REQUIRED_TEST_IMPLEMENTATIONS_MISSING',
    run() {
      const model = readJson(PHASE_MODEL_PATH);
      const missingId = model.testAssignments.FINAL_WINDOWS[0];
      return expectReason(this.expectedReasonCode, () => verifyRequiredTestImplementations({ model, exists: (_file, id) => id !== missingId }));
    }
  },
  {
    id: 'CR-M04',
    class: 'MUTATION',
    target: 'string-only final evidence reference',
    expectedReasonCode: 'WP7_FINAL_EVIDENCE_REFERENCE_VIOLATION',
    run() { return expectReason(this.expectedReasonCode, () => validateEvidenceReferences(['evidence/wp7/clean-install.json'], { final: true })); }
  },
  {
    id: 'CR-M05',
    class: 'MUTATION',
    target: 'object final evidence reference without SHA256',
    expectedReasonCode: 'WP7_FINAL_EVIDENCE_REFERENCE_VIOLATION',
    run() { return expectReason(this.expectedReasonCode, () => validateEvidenceReferences([{ path: 'evidence/wp7/clean-install.json' }], { final: true })); }
  },
  {
    id: 'CR-M06',
    class: 'MUTATION',
    target: 'final evidence complete source and upstream binding fields',
    expectedReasonCode: 'WP7_ACCEPTANCE_EVIDENCE_SCHEMA_INVALID',
    run() {
      const incomplete = { schemaVersion: 3, documentType: 'X', stage: '6.4.5.9', phase: 'core-runtime-p1', workPackage: 'WP7', status: 'PASS', generatedAtUtc: new Date().toISOString() };
      return expectReason(this.expectedReasonCode, () => validateEvidenceCommon(incomplete, { final: true }));
    }
  },
  {
    id: 'CR-M07',
    class: 'MUTATION',
    target: 'review bundle immutable WP0 tag ref',
    expectedReasonCode: 'WP7_BUNDLE_MISSING_REQUIRED_WP0_IMMUTABLE_TAG',
    run() {
      const root = temp('wp7-bundle-tag-');
      const repo = path.join(root, 'repo');
      const bundle = path.join(root, 'missing-tag.bundle');
      fs.mkdirSync(repo, { recursive: true });
      execFileSync('git', ['init', '-q'], { cwd: repo });
      execFileSync('git', ['config', 'user.name', 'WP7 Matrix'], { cwd: repo });
      execFileSync('git', ['config', 'user.email', 'wp7-matrix@yance.invalid'], { cwd: repo });
      fs.writeFileSync(path.join(repo, 'README.md'), 'synthetic formal branch without the required immutable WP0 tag\n');
      execFileSync('git', ['add', 'README.md'], { cwd: repo });
      execFileSync('git', ['commit', '-q', '-m', 'synthetic branch'], { cwd: repo });
      execFileSync('git', ['branch', '-M', 'stage/6.4.5.9-architecture-closure'], { cwd: repo });
      execFileSync('git', ['bundle', 'create', bundle, 'refs/heads/stage/6.4.5.9-architecture-closure'], { cwd: repo });
      return expectReason(this.expectedReasonCode, () => verifyReviewBundle(bundle));
    }
  },
  {
    id: 'CR-M08',
    class: 'MUTATION',
    target: 'Linux formal Windows harness bypass',
    expectedReasonCode: 'WP7_WINDOWS_FINAL_BUILD_REQUIRED',
    run() {
      if (process.platform === 'win32') return { status: 'NOT_APPLICABLE', observedReasonCode: 'WINDOWS_HOST_NOT_APPLICABLE', applicable: false };
      return expectReason(this.expectedReasonCode, () => runWindowsFinalHarness({}, { authorizationToken: WINDOWS_VALIDATION_TOKEN }));
    }
  },
  {
    id: 'CR-M09',
    class: 'MUTATION',
    target: 'caller-supplied final observations',
    expectedReasonCode: 'WP7_FINAL_WINDOWS_EVIDENCE_PROVENANCE_BYPASS',
    run() { return expectReason(this.expectedReasonCode, () => assertNoCallerClaims({ observations: {}, testResults: {} })); }
  },
  {
    id: 'CR-M10',
    class: 'MUTATION',
    target: 'caller-supplied PASS final evidence generation',
    expectedReasonCode: 'WP7_FINAL_WINDOWS_EVIDENCE_PROVENANCE_BYPASS',
    run() {
      const root = temp('wp7-caller-evidence-');
      return expectReason(this.expectedReasonCode, () => generateFinalEvidenceSet({ outputRoot: root, observations: {}, testResults: {} }));
    }
  },
  {
    id: 'CR-M11',
    class: 'MUTATION',
    target: 'child platform/fixture conflict',
    expectedReasonCode: 'WP7_FINAL_WINDOWS_EVIDENCE_PROVENANCE_BYPASS',
    run() {
      const fake = { documentType: 'WP7_FINAL_WINDOWS_RAW_EVIDENCE_RESULT', status: 'RAW_EVIDENCE_READY', actualPlatform: 'linux', platform: 'win32', fixtureMode: false };
      return expectReason(this.expectedReasonCode, () => validateHarnessResult(fake));
    }
  },
  {
    id: 'CR-M12',
    class: 'MUTATION',
    target: 'FINAL_PACKAGING without final execution context',
    expectedReasonCode: 'WP7_FINAL_REPEAT_TESTS_NOT_BOUND_TO_FINAL_ARTIFACTS',
    run() {
      const r = spawnSync(process.execPath, ['tools/wp7/run-required-tests.js', '--mode', 'FINAL_PACKAGING'], { cwd: REPO_ROOT, encoding: 'utf8' });
      if (r.status === 0) throw new Error('FINAL_PACKAGING runner unexpectedly accepted missing context');
      const result = JSON.parse(r.stdout);
      if (result.reasonCode !== this.expectedReasonCode) throw new Error(`unexpected reason ${result.reasonCode}`);
      return { status: 'KILLED', observedReasonCode: result.reasonCode };
    }
  },
  {
    id: 'CR-M13',
    class: 'MUTATION',
    target: 'FINAL execution context without installer/evidence root',
    expectedReasonCode: 'WP7_FINAL_REPEAT_TESTS_NOT_BOUND_TO_FINAL_ARTIFACTS',
    run() {
      const root = temp('wp7-context-missing-');
      const contextPath = path.join(root, 'context.json');
      writeCanonicalJson(contextPath, { schemaVersion: 2, documentType: 'WP7_FINAL_EXECUTION_CONTEXT', executionPhase: 'FINAL_PACKAGING' });
      return expectReason(this.expectedReasonCode, () => readFinalExecutionContext(contextPath, { mode: 'FINAL_PACKAGING' }));
    }
  },
  {
    id: 'CR-M14',
    class: 'MUTATION',
    target: 'fixture mode formal Windows evidence',
    expectedReasonCode: process.platform === 'win32' ? 'WP7_FINAL_WINDOWS_EVIDENCE_PROVENANCE_BYPASS' : 'WP7_WINDOWS_FINAL_BUILD_REQUIRED',
    run() {
      return expectReason(this.expectedReasonCode, () => runWindowsFinalHarness({}, { authorizationToken: WINDOWS_VALIDATION_TOKEN, fixtureMode: true }));
    }
  },
  {
    id: 'CR-M15',
    class: 'MUTATION',
    target: 'installed runtime probe unknown ID',
    expectedReasonCode: 'WP7_INSTALLED_RUNTIME_PROBE_ID_UNKNOWN',
    run() {
      const root = temp('wp7-probe-unknown-'); fs.mkdirSync(path.join(root, 'probe-results'));
      const env = { WP7_PROBE_ID: 'unknown', WP7_PROBE_ROOT: root, WP7_PROBE_OUTPUT_PATH: path.join(root, 'probe-results', 'unknown.json'), WP7_PROBE_BUILD_SESSION_ID: 'a'.repeat(32), WP7_PROBE_INSTALLER_SHA256: 'b'.repeat(64), WP7_PROBE_EXPECTED_BUILD_ID: 'build', WP7_PROBE_EXPECTED_SOURCE_COMMIT: 'c'.repeat(40), WP7_PROBE_EXPECTED_SOURCE_TREE: 'd'.repeat(40), WP7_PROBE_EXECUTION_NONCE: '123e4567-e89b-42d3-a456-426614174000', WP7_PROBE_EXPECTED_PRODUCT_EXECUTABLE_SHA256: PROBE_EXECUTABLE_SHA256, WP7_PROBE_EXPECTED_MAIN_ENTRY_SHA256: PROBE_MAIN_ENTRY_SHA256 };
      return expectReason(this.expectedReasonCode, () => readInstalledRuntimeProbeRequest(env, { isPackaged: true, platform: 'win32' }));
    }
  },
  {
    id: 'CR-M16', class: 'MUTATION', target: 'installed runtime probe path traversal', expectedReasonCode: 'WP7_PROBE_OUTPUT_PATH_INVALID',
    run() {
      const root = temp('wp7-probe-path-'); fs.mkdirSync(path.join(root, 'probe-results'));
      const env = { WP7_PROBE_ID: 'first-start', WP7_PROBE_ROOT: root, WP7_PROBE_OUTPUT_PATH: path.join(root, '..', 'first-start.json'), WP7_PROBE_BUILD_SESSION_ID: 'a'.repeat(32), WP7_PROBE_INSTALLER_SHA256: 'b'.repeat(64), WP7_PROBE_EXPECTED_BUILD_ID: 'build', WP7_PROBE_EXPECTED_SOURCE_COMMIT: 'c'.repeat(40), WP7_PROBE_EXPECTED_SOURCE_TREE: 'd'.repeat(40), WP7_PROBE_EXECUTION_NONCE: '123e4567-e89b-42d3-a456-426614174000', WP7_PROBE_EXPECTED_PRODUCT_EXECUTABLE_SHA256: PROBE_EXECUTABLE_SHA256, WP7_PROBE_EXPECTED_MAIN_ENTRY_SHA256: PROBE_MAIN_ENTRY_SHA256 };
      return expectReason(this.expectedReasonCode, () => readInstalledRuntimeProbeRequest(env, { isPackaged: true, platform: 'win32' }));
    }
  },
  {
    id: 'CR-M17', class: 'MUTATION', target: 'stale installed runtime probe result reuse', expectedReasonCode: 'WP7_PROBE_STALE_RESULT_PRESENT',
    run() {
      const root = temp('wp7-probe-stale-'); fs.mkdirSync(path.join(root, 'probe-results')); const output = path.join(root, 'probe-results', 'first-start.json'); fs.writeFileSync(output, '{}');
      const env = { WP7_PROBE_ID: 'first-start', WP7_PROBE_ROOT: root, WP7_PROBE_OUTPUT_PATH: output, WP7_PROBE_BUILD_SESSION_ID: 'a'.repeat(32), WP7_PROBE_INSTALLER_SHA256: 'b'.repeat(64), WP7_PROBE_EXPECTED_BUILD_ID: 'build', WP7_PROBE_EXPECTED_SOURCE_COMMIT: 'c'.repeat(40), WP7_PROBE_EXPECTED_SOURCE_TREE: 'd'.repeat(40), WP7_PROBE_EXECUTION_NONCE: '123e4567-e89b-42d3-a456-426614174000', WP7_PROBE_EXPECTED_PRODUCT_EXECUTABLE_SHA256: PROBE_EXECUTABLE_SHA256, WP7_PROBE_EXPECTED_MAIN_ENTRY_SHA256: PROBE_MAIN_ENTRY_SHA256 };
      return expectReason(this.expectedReasonCode, () => readInstalledRuntimeProbeRequest(env, { isPackaged: true, platform: 'win32' }));
    }
  },
  {
    id: 'CR-M18', class: 'MUTATION', target: 'installed runtime probe release identity mismatch', expectedReasonCode: 'WP7_INSTALLED_RUNTIME_PROBE_IDENTITY_MISMATCH',
    run() {
      const root = temp('wp7-probe-identity-'); fs.mkdirSync(path.join(root, 'probe-results'));
      const env = { WP7_PROBE_ID: 'first-start', WP7_PROBE_ROOT: root, WP7_PROBE_OUTPUT_PATH: path.join(root, 'probe-results', 'first-start.json'), WP7_PROBE_BUILD_SESSION_ID: 'a'.repeat(32), WP7_PROBE_INSTALLER_SHA256: 'b'.repeat(64), WP7_PROBE_EXPECTED_BUILD_ID: 'build', WP7_PROBE_EXPECTED_SOURCE_COMMIT: 'c'.repeat(40), WP7_PROBE_EXPECTED_SOURCE_TREE: 'd'.repeat(40), WP7_PROBE_EXECUTION_NONCE: '123e4567-e89b-42d3-a456-426614174000', WP7_PROBE_EXPECTED_PRODUCT_EXECUTABLE_SHA256: PROBE_EXECUTABLE_SHA256, WP7_PROBE_EXPECTED_MAIN_ENTRY_SHA256: PROBE_MAIN_ENTRY_SHA256 };
      const request = readInstalledRuntimeProbeRequest(env, { isPackaged: true, platform: 'win32' });
      return expectReason(this.expectedReasonCode, () => bindProbeIdentity(request, { ['build' + 'Id']: 'other', sourceCommit: 'c'.repeat(40), sourceTree: 'd'.repeat(40) }));
    }
  },
  {
    id: 'CR-M19', class: 'MUTATION', target: 'installed runtime probe producer missing', expectedReasonCode: 'WP7_INSTALLED_RUNTIME_PROBE_IMPLEMENTATION_MISSING',
    async run() {
      const root = temp('wp7-probe-missing-'); fs.mkdirSync(path.join(root, 'probe-results'));
      const env = { WP7_PROBE_ID: 'first-start', WP7_PROBE_ROOT: root, WP7_PROBE_OUTPUT_PATH: path.join(root, 'probe-results', 'first-start.json'), WP7_PROBE_BUILD_SESSION_ID: 'a'.repeat(32), WP7_PROBE_INSTALLER_SHA256: 'b'.repeat(64), WP7_PROBE_EXPECTED_BUILD_ID: 'build', WP7_PROBE_EXPECTED_SOURCE_COMMIT: 'c'.repeat(40), WP7_PROBE_EXPECTED_SOURCE_TREE: 'd'.repeat(40), WP7_PROBE_EXECUTION_NONCE: '123e4567-e89b-42d3-a456-426614174000', WP7_PROBE_EXPECTED_PRODUCT_EXECUTABLE_SHA256: PROBE_EXECUTABLE_SHA256, WP7_PROBE_EXPECTED_MAIN_ENTRY_SHA256: PROBE_MAIN_ENTRY_SHA256 };
      const request = readInstalledRuntimeProbeRequest(env, { isPackaged: true, platform: 'win32' });
      try { await executeInstalledRuntimeProbe(request, { releaseIdentity: { ['build' + 'Id']: 'build', sourceCommit: 'c'.repeat(40), sourceTree: 'd'.repeat(40) }, platform: 'win32', producerExecutablePath: process.execPath, producerMainEntryPath: PROBE_MAIN_ENTRY, operations: {} }); }
      catch (error) { if (error.reasonCode === this.expectedReasonCode) return { status: 'KILLED', observedReasonCode: error.reasonCode }; throw error; }
      throw new Error('mutation survived');
    }
  },
  {
    id: 'CR-M20', class: 'MUTATION', target: 'installed runtime probe measurement override', expectedReasonCode: 'WP7_INSTALLED_RUNTIME_PROBE_MEASUREMENT_INVALID',
    async run() {
      const root = temp('wp7-probe-override-'); fs.mkdirSync(path.join(root, 'probe-results'));
      const env = { WP7_PROBE_ID: 'first-start', WP7_PROBE_ROOT: root, WP7_PROBE_OUTPUT_PATH: path.join(root, 'probe-results', 'first-start.json'), WP7_PROBE_BUILD_SESSION_ID: 'a'.repeat(32), WP7_PROBE_INSTALLER_SHA256: 'b'.repeat(64), WP7_PROBE_EXPECTED_BUILD_ID: 'build', WP7_PROBE_EXPECTED_SOURCE_COMMIT: 'c'.repeat(40), WP7_PROBE_EXPECTED_SOURCE_TREE: 'd'.repeat(40), WP7_PROBE_EXECUTION_NONCE: '123e4567-e89b-42d3-a456-426614174000', WP7_PROBE_EXPECTED_PRODUCT_EXECUTABLE_SHA256: PROBE_EXECUTABLE_SHA256, WP7_PROBE_EXPECTED_MAIN_ENTRY_SHA256: PROBE_MAIN_ENTRY_SHA256 };
      const request = readInstalledRuntimeProbeRequest(env, { isPackaged: true, platform: 'win32' });
      try { await executeInstalledRuntimeProbe(request, { releaseIdentity: { ['build' + 'Id']: 'build', sourceCommit: 'c'.repeat(40), sourceTree: 'd'.repeat(40) }, platform: 'win32', producerExecutablePath: process.execPath, producerMainEntryPath: PROBE_MAIN_ENTRY, operations: { 'first-start': async () => ({ status: 'PASS' }) } }); }
      catch (error) { if (error.reasonCode === this.expectedReasonCode) return { status: 'KILLED', observedReasonCode: error.reasonCode }; throw error; }
      throw new Error('mutation survived');
    }
  },
  {
    id: 'CR-M21', class: 'MUTATION', target: 'formal installed probe producer inventory', expectedReasonCode: 'WP7_INSTALLED_RUNTIME_PROBE_IMPLEMENTATION_MISSING',
    run() {
      const source = fs.readFileSync(path.join(REPO_ROOT, 'electron', 'main.js'), 'utf8');
      const moduleSource = fs.readFileSync(path.join(REPO_ROOT, 'electron', 'wp7InstalledRuntimeProbeOperations.js'), 'utf8');
      const missing = FORMAL_PROBE_IDS.filter((id) => !moduleSource.includes(`'${id}'`) && !moduleSource.includes(`async ${id}(`));
      if (!source.includes('runWp7InstalledRuntimeProbe') || missing.length) throw Object.assign(new Error('formal producer missing'), { reasonCode: this.expectedReasonCode, details: { missing } });
      return { status: 'KILLED', observedReasonCode: 'PRODUCER_PRESENT_ALL_9' };
    }
  },
  {
    id: 'CR-M22', class: 'MUTATION', target: 'harness sealed identity injection order', expectedReasonCode: 'WP7_FINAL_WINDOWS_EVIDENCE_PROVENANCE_BYPASS',
    run() {
      const source = fs.readFileSync(path.join(REPO_ROOT, 'tools', 'wp7', 'windows-final-harness.js'), 'utf8');
      const required = ['WP7_PROBE_ROOT','WP7_PROBE_BUILD_SESSION_ID','WP7_PROBE_INSTALLER_SHA256','WP7_PROBE_EXPECTED_BUILD_ID','WP7_PROBE_EXPECTED_SOURCE_COMMIT','WP7_PROBE_EXPECTED_SOURCE_TREE','WP7_PROBE_EXECUTION_NONCE','WP7_PROBE_EXPECTED_PRODUCT_EXECUTABLE_SHA256','WP7_PROBE_EXPECTED_MAIN_ENTRY_SHA256'];
      const missing = required.filter((name) => !source.includes(name));
      if (missing.length) throw Object.assign(new Error('sealed identity environment binding missing'), { reasonCode: this.expectedReasonCode, details: { missing } });
      return { status: 'KILLED', observedReasonCode: 'SEALED_IDENTITY_ENV_BOUND' };
    }
  },
  {
    id: 'CR-M23', class: 'MUTATION', target: 'offline state asserted only after process start', expectedReasonCode: 'WP7_INSTALLED_RUNTIME_PROBE_ORACLE_FAILED',
    run() { const m = measurementFor('offline-start'); m.networkUnavailableBeforeApplicationStart = false; return expectReason(this.expectedReasonCode, () => validateMeasurements('offline-start', m)); }
  },
  {
    id: 'CR-M24', class: 'MUTATION', target: 'hardcoded early-ready rejection without illegal transition', expectedReasonCode: 'WP7_INSTALLED_RUNTIME_PROBE_ORACLE_FAILED',
    run() { const m = measurementFor('credential-gate-negative'); m.illegalTransitionAttempted = false; return expectReason(this.expectedReasonCode, () => validateMeasurements('credential-gate-negative', m)); }
  },
  {
    id: 'CR-M25', class: 'MUTATION', target: 'hardcoded single owner maximum', expectedReasonCode: 'WP7_INSTALLED_RUNTIME_PROBE_ORACLE_FAILED',
    run() { const m = measurementFor('crash-recovery'); m.maximumConcurrentAppRuntimeOwners = 2; return expectReason(this.expectedReasonCode, () => validateMeasurements('crash-recovery', m)); }
  },
  {
    id: 'CR-M26', class: 'MUTATION', target: 'copied release identity consumer provenance', expectedReasonCode: 'WP7_RELEASE_IDENTITY_CONSUMER_PROVENANCE_INCOMPLETE',
    run() { const m = measurementFor('first-start'); m.releaseIdentityConsumers.installer.consumer = 'electron'; return expectReason(this.expectedReasonCode, () => validateMeasurements('first-start', m)); }
  },
  {
    id: 'CR-M27', class: 'MUTATION', target: 'single-source safe-mode negative', expectedReasonCode: 'WP7_SAFE_MODE_NEGATIVE_SOURCE_MATRIX_INCOMPLETE',
    run() { const m = measurementFor('safe-mode-negative'); m.sourceResults = m.sourceResults.slice(0, 1); return expectReason(this.expectedReasonCode, () => validateMeasurements('safe-mode-negative', m)); }
  },
  {
    id: 'CR-M28', class: 'MUTATION', target: 'private event-gap recovery call', expectedReasonCode: 'WP7_INSTALLED_RUNTIME_PROBE_ORACLE_FAILED',
    run() { const m = measurementFor('event-gap-recovery'); m.privateRecoveryMethodCalledDirectly = true; return expectReason(this.expectedReasonCode, () => validateMeasurements('event-gap-recovery', m)); }
  },
  {
    id: 'CR-M29', class: 'MUTATION', target: 'parent process self-confirms boot failure', expectedReasonCode: 'WP7_BOOT_FAILURE_PROBE_NOT_REAL_STARTUP_FAILURE',
    run() { const m = measurementFor('boot-failure'); m.diagnosticProducerPid = m.parentProbePid; return expectReason(this.expectedReasonCode, () => validateMeasurements('boot-failure', m)); }
  },
  {
    id: 'CR-M30', class: 'MUTATION', target: 'empty or array measurement accepted', expectedReasonCode: 'WP7_INSTALLED_RUNTIME_PROBE_MEASUREMENT_MISSING',
    run() { return expectReason(this.expectedReasonCode, () => validateMeasurements('first-start', [])); }
  },
  {
    id: 'CR-M31', class: 'MUTATION', target: 'installed application entry integration suite missing', expectedReasonCode: 'WP7_INSTALLED_APPLICATION_PROBE_INTEGRATION_TEST_MISSING',
    run() {
      const testPath = path.join(REPO_ROOT, 'tests', 'wp7', 'installed-application-probe-entry-integration.test.js');
      const harnessContractPath = path.join(REPO_ROOT, 'tests', 'wp7', 'windows-harness-horizontal-closure.test.js');
      const pkg = readJson(path.join(REPO_ROOT, 'package.json'));
      const script = String(pkg.scripts?.['test:wp7:installed-probes'] || '');
      if (!fs.existsSync(testPath) || !script.includes('installed-application-probe-entry-integration.test.js')) throw Object.assign(new Error('installed application integration suite is not wired into the formal command'), { reasonCode: this.expectedReasonCode });
      if (!fs.existsSync(harnessContractPath) || !script.includes('windows-harness-horizontal-closure.test.js')) throw Object.assign(new Error('Windows harness contract suite is not wired into the formal command'), { reasonCode: this.expectedReasonCode });
      const source = fs.readFileSync(testPath, 'utf8');
      const harnessContractSource = fs.readFileSync(harnessContractPath, 'utf8');
      const required = ['buildFinalWindowsPayload', 'validatePackagedPayload', 'production dependency external binding rejects', 'Git 100755 and 100644 modes', 'Electron unixMode is compared'];
      const missing = required.filter((token) => !source.includes(token));
      if (!harnessContractSource.includes('preview runner runtime verifier invocation and parameter contract remain aligned')) missing.push('preview runner/verifier parameter contract');
      if (missing.length) throw Object.assign(new Error('installed application and Windows harness integration suites are incomplete'), { reasonCode: this.expectedReasonCode, details: { missing } });
      return { status: 'KILLED', observedReasonCode: 'PRODUCTION_ENTRY_AND_PACKAGED_ARTIFACT_TESTS_REGISTERED' };
    }
  },
  {
    id: 'CR-M32', class: 'MUTATION', target: 'undefined installed probe executor in Electron main', expectedReasonCode: 'WP7_INSTALLED_RUNTIME_PROBE_PRODUCTION_ENTRY_BROKEN',
    run() {
      const source = fs.readFileSync(path.join(REPO_ROOT, 'electron', 'main.js'), 'utf8');
      const body = source.match(/async function runWp7InstalledRuntimeProbe\(\) \{([\s\S]*?)\n\}/)?.[1] || '';
      if (/executeInstalledRuntimeProbe\s*\(/.test(body)) throw Object.assign(new Error('undefined executor remains in production main'), { reasonCode: this.expectedReasonCode });
      return { status: 'KILLED', observedReasonCode: 'UNDEFINED_EXECUTOR_ABSENT' };
    }
  },
  {
    id: 'CR-M33', class: 'MUTATION', target: 'imported application entry never invoked', expectedReasonCode: 'WP7_INSTALLED_RUNTIME_PROBE_PRODUCTION_ENTRY_BROKEN',
    run() {
      const source = fs.readFileSync(path.join(REPO_ROOT, 'electron', 'main.js'), 'utf8');
      const body = source.match(/async function runWp7InstalledRuntimeProbe\(\) \{([\s\S]*?)\n\}/)?.[1] || '';
      if (!body.includes('return runInstalledRuntimeProbeApplicationEntry({')) throw Object.assign(new Error('formal application entry is not invoked'), { reasonCode: this.expectedReasonCode });
      return { status: 'KILLED', observedReasonCode: 'IMPORTED_ENTRY_INVOKED' };
    }
  },
  {
    id: 'CR-M34', class: 'MUTATION', target: 'arbitrary executable substitutes for trusted Electron product', expectedReasonCode: 'WP7_PACKAGED_ELECTRON_EXECUTABLE_TRUST_NOT_ENFORCED',
    run() {
      const root = temp('wp7-fake-electron-trust-');
      const archive = path.join(root, 'electron-v31.7.7-linux-x64.zip');
      const product = path.join(root, path.parse(RELEASE_SOURCE.executableName).name);
      fs.writeFileSync(archive, 'not-an-official-archive');
      fs.writeFileSync(product, '#!/bin/sh\necho v31.7.7\n'); fs.chmodSync(product, 0o755);
      return expectReason(this.expectedReasonCode, () => verifyTrustedProductExecutable({ repoRoot: REPO_ROOT, electronArchivePath: archive, productExecutablePath: product, payloadRoot: root, platform: 'linux', arch: 'x64' }));
    }
  },
  {
    id: 'CR-M35', class: 'MUTATION', target: 'tampered Electron main outside sealed payload manifest', expectedReasonCode: 'WP7_PACKAGED_APPLICATION_PAYLOAD_CLOSURE_NOT_ENFORCED',
    run() {
      const root = temp('wp7-packaged-main-tamper-');
      const resourcesRoot = path.join(root, 'resources'); const appRoot = path.join(resourcesRoot, 'app');
      fs.mkdirSync(path.join(appRoot, 'electron'), { recursive: true });
      fs.writeFileSync(path.join(appRoot, 'package.json'), JSON.stringify({ main: 'electron/main.js' }));
      fs.writeFileSync(path.join(appRoot, 'electron', 'main.js'), 'tampered');
      writeCanonicalJson(path.join(resourcesRoot, 'payload-files.json'), { files: [{ path: 'resources/app/electron/main.js', sha256: '0'.repeat(64), sizeBytes: 1 }] });
      return expectReason(this.expectedReasonCode, () => validatePackagedPayload(root, resourcesRoot, { repoRoot: REPO_ROOT }));
    }
  },
  {
    id: 'CR-M36', class: 'MUTATION', target: 'multiple identity consumers reuse one source path', expectedReasonCode: 'WP7_RELEASE_IDENTITY_CONSUMER_PROVENANCE_INCOMPLETE',
    run() { return expectReason(this.expectedReasonCode, () => assertIndependentObservations(identityObservations({ sharedSource: '/same/source.json' }))); }
  },
  {
    id: 'CR-M37', class: 'MUTATION', target: 'multiple identity consumers reuse one raw document hash', expectedReasonCode: 'WP7_RELEASE_IDENTITY_CONSUMER_PROVENANCE_INCOMPLETE',
    run() { return expectReason(this.expectedReasonCode, () => assertIndependentObservations(identityObservations({ sharedDocument: { identity: 'same-document' } }))); }
  },
  {
    id: 'CR-M38', class: 'MUTATION', target: 'identity producer type does not match consumer', expectedReasonCode: 'WP7_RELEASE_IDENTITY_CONSUMER_PROVENANCE_INCOMPLETE',
    run() {
      const rows = identityObservations(); const bad = { ...rows.installer, producerType: 'electron-main' };
      return expectReason(this.expectedReasonCode, () => validateObservation(bad, 'installer'));
    }
  },
  {
    id: 'CR-M39', class: 'MUTATION', target: 'identity independence self-declared', expectedReasonCode: 'WP7_RUNTIME_PROBE_ACCEPTANCE_ORACLE_SELF_CONFIRMATION',
    run() {
      const rows = identityObservations(); const bad = { ...rows.electron, independentlyObserved: true };
      return expectReason(this.expectedReasonCode, () => validateObservation(bad, 'electron'));
    }
  },
  {
    id: 'CR-M40', class: 'MUTATION', target: 'same identity observation relabelled as another consumer', expectedReasonCode: 'WP7_RELEASE_IDENTITY_CONSUMER_PROVENANCE_INCOMPLETE',
    run() {
      const rows = identityObservations(); const bad = { ...rows.electron, consumer: 'installer', rawDocumentConsumer: 'installer' };
      return expectReason(this.expectedReasonCode, () => validateObservation(bad, 'installer'));
    }
  },
  {
    id: 'CR-M41', class: 'MUTATION', target: 'pre-review packaged result promoted to Final Windows evidence', expectedReasonCode: 'WP7_FINAL_WINDOWS_EVIDENCE_PROVENANCE_BYPASS',
    run() { return expectReason(this.expectedReasonCode, () => validateProbeEvidenceClassification({ executionClass: 'PRE_REVIEW_PACKAGED_INTEGRATION', formalWindowsEvidenceEligible: false, actualPlatform: process.platform }, 'first-start')); }
  },
  {
    id: 'CR-M42', class: 'MUTATION', target: 'packaged integration runner absent from formal scripts', expectedReasonCode: 'WP7_INSTALLED_APPLICATION_PROBE_INTEGRATION_TEST_MISSING',
    run() {
      const pkg = readJson(path.join(REPO_ROOT, 'package.json'));
      const script = String(pkg.scripts?.['test:wp7:packaged-electron'] || '');
      if (script !== 'node tools/wp7/run-packaged-electron-probe-integration.js' || /\$WP7_|%WP7_/.test(script)) throw Object.assign(new Error('formal packaged Electron integration command is absent or shell-dialect dependent'), { reasonCode: this.expectedReasonCode });
      return { status: 'KILLED', observedReasonCode: 'FORMAL_PACKAGED_ELECTRON_COMMAND_PRESENT' };
    }
  },

  {
    id: 'CR-M43', class: 'MUTATION', target: 'fake packaged result document type', expectedReasonCode: 'WP7_PACKAGED_ELECTRON_RESULT_VALIDATION_INCOMPLETE',
    run() {
      const now = new Date().toISOString();
      const expected = { probeId: 'first-start', executionNonce: '123e4567-e89b-42d3-a456-426614174000', actualPlatform: process.platform, buildSessionId: 'a'.repeat(32), ['build' + 'Id']: 'build', sourceCommit: 'c'.repeat(40), sourceTree: 'd'.repeat(40), preReviewSealedArtifactSha256: 'e'.repeat(64), preReviewSealedArtifactType: SEALED_ARTIFACT_TYPE, producerPid: 123, producerParentPid: process.pid, productExecutable: process.execPath, productExecutableSha256: PROBE_EXECUTABLE_SHA256, mainEntryPath: PROBE_MAIN_ENTRY, mainEntrySha256: PROBE_MAIN_ENTRY_SHA256, startedMs: Date.now() - 1000 };
      const report = { schemaVersion: 1, documentType: 'FAKE_NOT_REAL_ELECTRON', probeId: 'first-start', status: 'PASS', executionNonce: expected.executionNonce, actualPlatform: process.platform, fixtureMode: false, executionClass: 'PRE_REVIEW_PACKAGED_INTEGRATION', formalWindowsEvidenceEligible: false, buildSessionId: expected.buildSessionId, buildId: expected.buildId, frozenSourceCommit: expected.sourceCommit, frozenSourceTree: expected.sourceTree, preReviewSealedArtifactSha256: expected.preReviewSealedArtifactSha256, preReviewSealedArtifactType: expected.preReviewSealedArtifactType, producerPid: 123, producerParentPid: process.pid, producerExecutablePath: process.execPath, producerExecutableSha256: PROBE_EXECUTABLE_SHA256, producerMainEntryPath: PROBE_MAIN_ENTRY, producerMainEntrySha256: PROBE_MAIN_ENTRY_SHA256, startedAtUtc: now, completedAtUtc: now, generatedAtUtc: now, measurements: measurementFor('first-start') };
      return expectReason(this.expectedReasonCode, () => validatePackagedProbeResult(report, expected));
    }
  },
  {
    id: 'CR-M44', class: 'MUTATION', target: 'packaged probe producer PID mismatch', expectedReasonCode: 'WP7_PACKAGED_ELECTRON_RESULT_VALIDATION_INCOMPLETE',
    run() {
      const now = new Date().toISOString(); const expected = { probeId: 'first-start', executionNonce: '123e4567-e89b-42d3-a456-426614174000', actualPlatform: process.platform, buildSessionId: 'a'.repeat(32), ['build' + 'Id']: 'build', sourceCommit: 'c'.repeat(40), sourceTree: 'd'.repeat(40), preReviewSealedArtifactSha256: 'e'.repeat(64), preReviewSealedArtifactType: SEALED_ARTIFACT_TYPE, producerPid: 123, producerParentPid: process.pid, productExecutable: process.execPath, productExecutableSha256: PROBE_EXECUTABLE_SHA256, mainEntryPath: PROBE_MAIN_ENTRY, mainEntrySha256: PROBE_MAIN_ENTRY_SHA256, startedMs: Date.now() - 1000 };
      const report = { schemaVersion: 1, documentType: 'WP7_INSTALLED_RUNTIME_PROBE_RESULT', probeId: 'first-start', status: 'PASS', executionNonce: expected.executionNonce, actualPlatform: process.platform, fixtureMode: false, executionClass: 'PRE_REVIEW_PACKAGED_INTEGRATION', formalWindowsEvidenceEligible: false, buildSessionId: expected.buildSessionId, buildId: expected.buildId, frozenSourceCommit: expected.sourceCommit, frozenSourceTree: expected.sourceTree, preReviewSealedArtifactSha256: expected.preReviewSealedArtifactSha256, preReviewSealedArtifactType: expected.preReviewSealedArtifactType, producerPid: 999, producerParentPid: process.pid, producerExecutablePath: process.execPath, producerExecutableSha256: PROBE_EXECUTABLE_SHA256, producerMainEntryPath: PROBE_MAIN_ENTRY, producerMainEntrySha256: PROBE_MAIN_ENTRY_SHA256, startedAtUtc: now, completedAtUtc: now, generatedAtUtc: now, measurements: measurementFor('first-start') };
      return expectReason(this.expectedReasonCode, () => validatePackagedProbeResult(report, expected));
    }
  },
  {
    id: 'CR-M45', class: 'MUTATION', target: 'packaged integration only runs first-start', expectedReasonCode: 'WP7_PACKAGED_PROBE_INTEGRATION_SCOPE_INCOMPLETE',
    run() {
      const source = fs.readFileSync(path.join(REPO_ROOT, 'tools', 'wp7', 'run-packaged-electron-probe-integration.js'), 'utf8');
      if (!source.includes('const probeIds = requestedProbeId ? [requestedProbeId] : FORMAL_PROBE_IDS') || !source.includes('for (const probeId of probeIds)')) throw Object.assign(new Error('runner does not execute all formal probes'), { reasonCode: this.expectedReasonCode });
      return { status: 'KILLED', observedReasonCode: 'ALL_NINE_PROBES_LOOP_PRESENT' };
    }
  },
  {
    id: 'CR-M46', class: 'MUTATION', target: 'development Electron appRoot launch path', expectedReasonCode: 'WP7_PACKAGED_APPLICATION_EXECUTION_PATH_INCORRECT',
    run() {
      const source = fs.readFileSync(path.join(REPO_ROOT, 'tools', 'wp7', 'run-packaged-electron-probe-integration.js'), 'utf8');
      if (/args:\s*\[\s*(?:context\.)?payload\.appRoot/.test(source) || source.includes('electronExecutable appRoot')) throw Object.assign(new Error('development Electron appRoot launch remains'), { reasonCode: this.expectedReasonCode });
      if (!source.includes('executable: context.trust.productExecutable')) throw Object.assign(new Error('real product executable is not launched'), { reasonCode: this.expectedReasonCode });
      return { status: 'KILLED', observedReasonCode: 'PRODUCT_EXECUTABLE_LAUNCH_ENFORCED' };
    }
  },
  {
    id: 'CR-M47', class: 'MUTATION', target: 'non-main installed probe module tampering', expectedReasonCode: 'WP7_PACKAGED_APPLICATION_PAYLOAD_CLOSURE_NOT_ENFORCED',
    run() { const { built } = buildPackagedArtifactForMutation(); const target = path.join(built.payloadRoot, 'resources/app/electron/wp7InstalledRuntimeProbe.js'); detachFile(target); fs.appendFileSync(target, '\n// mutation\n'); return expectReason(this.expectedReasonCode, () => validatePackagedPayload(built.payloadRoot, built.resourcesRoot, { repoRoot: REPO_ROOT })); }
  },
  {
    id: 'CR-M48', class: 'MUTATION', target: 'probe operations module tampering', expectedReasonCode: 'WP7_PACKAGED_APPLICATION_PAYLOAD_CLOSURE_NOT_ENFORCED',
    run() { const { built } = buildPackagedArtifactForMutation(); const target = path.join(built.payloadRoot, 'resources/app/electron/wp7InstalledRuntimeProbeOperations.js'); detachFile(target); fs.appendFileSync(target, '\n// mutation\n'); return expectReason(this.expectedReasonCode, () => validatePackagedPayload(built.payloadRoot, built.resourcesRoot, { repoRoot: REPO_ROOT })); }
  },
  {
    id: 'CR-M49', class: 'MUTATION', target: 'shared production module tampering', expectedReasonCode: 'WP7_PACKAGED_APPLICATION_PAYLOAD_CLOSURE_NOT_ENFORCED',
    run() { const { built } = buildPackagedArtifactForMutation(); const target = path.join(built.payloadRoot, 'resources/app/shared/release/releaseIdentity.js'); detachFile(target); fs.appendFileSync(target, '\n// mutation\n'); return expectReason(this.expectedReasonCode, () => validatePackagedPayload(built.payloadRoot, built.resourcesRoot, { repoRoot: REPO_ROOT })); }
  },
  {
    id: 'CR-M50', class: 'MUTATION', target: 'payload manifest omits a packaged file', expectedReasonCode: 'WP7_PACKAGED_APPLICATION_PAYLOAD_CLOSURE_NOT_ENFORCED',
    run() { const { built } = buildPackagedArtifactForMutation(); detachFile(built.payloadFilesPath); const document = readJson(built.payloadFilesPath); document.files.pop(); writeCanonicalJson(built.payloadFilesPath, document); return expectReason(this.expectedReasonCode, () => validatePackagedPayload(built.payloadRoot, built.resourcesRoot, { repoRoot: REPO_ROOT })); }
  },
  {
    id: 'CR-M51', class: 'MUTATION', target: 'payload manifest contains a wrong file SHA256', expectedReasonCode: 'WP7_PACKAGED_APPLICATION_PAYLOAD_CLOSURE_NOT_ENFORCED',
    run() { const { built } = buildPackagedArtifactForMutation(); detachFile(built.payloadFilesPath); const document = readJson(built.payloadFilesPath); document.files[0].sha256 = '0'.repeat(64); writeCanonicalJson(built.payloadFilesPath, document); return expectReason(this.expectedReasonCode, () => validatePackagedPayload(built.payloadRoot, built.resourcesRoot, { repoRoot: REPO_ROOT })); }
  },
  {
    id: 'CR-M52', class: 'MUTATION', target: 'packaged payload contains an unregistered file', expectedReasonCode: 'WP7_PACKAGED_APPLICATION_PAYLOAD_CLOSURE_NOT_ENFORCED',
    run() { const { built } = buildPackagedArtifactForMutation(); fs.writeFileSync(path.join(built.payloadRoot, 'resources/app/electron/unregistered.js'), 'module.exports = true;\n'); return expectReason(this.expectedReasonCode, () => validatePackagedPayload(built.payloadRoot, built.resourcesRoot, { repoRoot: REPO_ROOT })); }
  },
  {
    id: 'CR-M53', class: 'MUTATION', target: 'release manifest payloadFilesSha256 mismatch', expectedReasonCode: 'WP7_PACKAGED_APPLICATION_PAYLOAD_CLOSURE_NOT_ENFORCED',
    run() { const { built } = buildPackagedArtifactForMutation(); rewriteManifestField(built, 'payloadFilesSha256', '0'.repeat(64)); return expectReason(this.expectedReasonCode, () => validatePackagedPayload(built.payloadRoot, built.resourcesRoot, { repoRoot: REPO_ROOT })); }
  },
  {
    id: 'CR-M54', class: 'MUTATION', target: 'release manifest applicationPayloadSha256 mismatch', expectedReasonCode: 'WP7_PACKAGED_APPLICATION_PAYLOAD_CLOSURE_NOT_ENFORCED',
    run() { const { built } = buildPackagedArtifactForMutation(); rewriteManifestField(built, 'applicationPayloadSha256', '0'.repeat(64)); return expectReason(this.expectedReasonCode, () => validatePackagedPayload(built.payloadRoot, built.resourcesRoot, { repoRoot: REPO_ROOT })); }
  },
  {
    id: 'CR-M55', class: 'MUTATION', target: 'Electron non-executable runtime resource modified', expectedReasonCode: 'WP7_ELECTRON_DISTRIBUTION_TREE_TRUST_NOT_ENFORCED',
    run() { const { built } = buildPackagedArtifactForMutation(); const target = path.join(built.payloadRoot, 'resources.pak'); detachFile(target); fs.writeFileSync(target, 'modified'); return expectReason(this.expectedReasonCode, () => compareElectronDistributionTree({ payloadRoot: built.payloadRoot, archiveExecutableEntry: ELECTRON_ARCHIVE_EXECUTABLE, productExecutableName: PRODUCT_EXECUTABLE_NAME, officialRecords: fixtureDistributionRecords() })); }
  },
  {
    id: 'CR-M56', class: 'MUTATION', target: 'Electron runtime resource removed', expectedReasonCode: 'WP7_ELECTRON_DISTRIBUTION_TREE_TRUST_NOT_ENFORCED',
    run() { const { built } = buildPackagedArtifactForMutation(); fs.rmSync(path.join(built.payloadRoot, 'resources.pak')); return expectReason(this.expectedReasonCode, () => compareElectronDistributionTree({ payloadRoot: built.payloadRoot, archiveExecutableEntry: ELECTRON_ARCHIVE_EXECUTABLE, productExecutableName: PRODUCT_EXECUTABLE_NAME, officialRecords: fixtureDistributionRecords() })); }
  },
  {
    id: 'CR-M57', class: 'MUTATION', target: 'Electron distribution tree contains an extra runtime file', expectedReasonCode: 'WP7_ELECTRON_DISTRIBUTION_TREE_TRUST_NOT_ENFORCED',
    run() { const { built } = buildPackagedArtifactForMutation(); fs.writeFileSync(path.join(built.payloadRoot, 'rogue-runtime.dll'), 'rogue'); return expectReason(this.expectedReasonCode, () => compareElectronDistributionTree({ payloadRoot: built.payloadRoot, archiveExecutableEntry: ELECTRON_ARCHIVE_EXECUTABLE, productExecutableName: PRODUCT_EXECUTABLE_NAME, officialRecords: fixtureDistributionRecords() })); }
  },
  {
    id: 'CR-M58', class: 'MUTATION', target: 'production dependency file replacement', expectedReasonCode: 'WP7_PRODUCTION_DEPENDENCY_FILE_TREE_MISMATCH',
    run() { const sourceCommit = gitIdentity(REPO_ROOT).sourceCommit; const { built } = buildPackagedArtifactForMutation(); const target = dependencyTargetRelative(sourceCommit); const targetPath = path.join(built.runtime.appRoot, ...target.split('/')); detachFile(targetPath); fs.appendFileSync(targetPath, '\n// replaced\n'); return expectReason(this.expectedReasonCode, () => verifyProductionDependencyClosure({ repoRoot: REPO_ROOT, appRoot: built.runtime.appRoot, sourceCommit, platform: process.platform, arch: 'x64' })); }
  },
  {
    id: 'CR-M59', class: 'MUTATION', target: 'extra production dependency file injection', expectedReasonCode: 'WP7_PRODUCTION_DEPENDENCY_FILE_TREE_MISMATCH',
    run() { const sourceCommit = gitIdentity(REPO_ROOT).sourceCommit; const { built } = buildPackagedArtifactForMutation(); fs.writeFileSync(path.join(built.runtime.appRoot, 'node_modules', 'injected-dependency-code.js'), 'module.exports = true;\n'); return expectReason(this.expectedReasonCode, () => verifyProductionDependencyClosure({ repoRoot: REPO_ROOT, appRoot: built.runtime.appRoot, sourceCommit, platform: process.platform, arch: 'x64' })); }
  },
  {
    id: 'CR-M60', class: 'MUTATION', target: 'production dependency file deletion', expectedReasonCode: 'WP7_PRODUCTION_DEPENDENCY_FILE_TREE_MISMATCH',
    run() { const sourceCommit = gitIdentity(REPO_ROOT).sourceCommit; const { built } = buildPackagedArtifactForMutation(); const target = dependencyTargetRelative(sourceCommit); fs.rmSync(path.join(built.runtime.appRoot, ...target.split('/'))); return expectReason(this.expectedReasonCode, () => verifyProductionDependencyClosure({ repoRoot: REPO_ROOT, appRoot: built.runtime.appRoot, sourceCommit, platform: process.platform, arch: 'x64' })); }
  },
  {
    id: 'CR-M61', class: 'MUTATION', target: 'package-lock production dependency graph mismatch', expectedReasonCode: 'WP7_PRODUCTION_DEPENDENCY_GRAPH_MISMATCH',
    run() { const sourceCommit = gitIdentity(REPO_ROOT).sourceCommit; const { built } = buildPackagedArtifactForMutation(); mutatePackagedLock(built, (lock) => { delete lock.packages[''].dependencies.express; }); return expectReason(this.expectedReasonCode, () => verifyProductionDependencyClosure({ repoRoot: REPO_ROOT, appRoot: built.runtime.appRoot, sourceCommit, platform: process.platform, arch: 'x64' })); }
  },
  {
    id: 'CR-M62', class: 'MUTATION', target: 'npm package integrity mismatch', expectedReasonCode: 'WP7_PRODUCTION_DEPENDENCY_GRAPH_MISMATCH',
    run() { const sourceCommit = gitIdentity(REPO_ROOT).sourceCommit; const { built } = buildPackagedArtifactForMutation(); mutatePackagedLock(built, (lock) => { lock.packages['node_modules/express'].integrity = `sha512-${Buffer.from('forged').toString('base64')}`; }); return expectReason(this.expectedReasonCode, () => verifyProductionDependencyClosure({ repoRoot: REPO_ROOT, appRoot: built.runtime.appRoot, sourceCommit, platform: process.platform, arch: 'x64' })); }
  },
  {
    id: 'CR-M63', class: 'MUTATION', target: 'production dependency version mismatch', expectedReasonCode: 'WP7_PRODUCTION_DEPENDENCY_GRAPH_MISMATCH',
    run() { const sourceCommit = gitIdentity(REPO_ROOT).sourceCommit; const { built } = buildPackagedArtifactForMutation(); mutatePackagedLock(built, (lock) => { lock.packages['node_modules/express'].version = '0.0.0-forged'; }); return expectReason(this.expectedReasonCode, () => verifyProductionDependencyClosure({ repoRoot: REPO_ROOT, appRoot: built.runtime.appRoot, sourceCommit, platform: process.platform, arch: 'x64' })); }
  },
  {
    id: 'CR-M64', class: 'MUTATION', target: 'production dependency source mismatch', expectedReasonCode: 'WP7_PRODUCTION_DEPENDENCY_GRAPH_MISMATCH',
    run() { const sourceCommit = gitIdentity(REPO_ROOT).sourceCommit; const { built } = buildPackagedArtifactForMutation(); mutatePackagedLock(built, (lock) => { lock.packages['node_modules/express'].resolved = 'https://forged.invalid/express.tgz'; }); return expectReason(this.expectedReasonCode, () => verifyProductionDependencyClosure({ repoRoot: REPO_ROOT, appRoot: built.runtime.appRoot, sourceCommit, platform: process.platform, arch: 'x64' })); }
  },
  {
    id: 'CR-M65', class: 'MUTATION', target: 'dependency code and internal manifests jointly re-signed', expectedReasonCode: 'WP7_PRODUCTION_DEPENDENCY_FILE_TREE_MISMATCH',
    run() { const sourceCommit = gitIdentity(REPO_ROOT).sourceCommit; const { built } = buildPackagedArtifactForMutation(); const target = dependencyTargetRelative(sourceCommit); const targetPath = path.join(built.runtime.appRoot, ...target.split('/')); detachFile(targetPath); fs.appendFileSync(targetPath, '\n// jointly resigned\n'); resealInternalPayloadMetadata(built, [`resources/app/${target}`]); return expectReason(this.expectedReasonCode, () => validatePackagedPayload(built.payloadRoot, built.resourcesRoot, { repoRoot: REPO_ROOT })); }
  },
  {
    id: 'CR-M66', class: 'MUTATION', target: 'Electron executable unixMode 0755 changed to 0644', expectedReasonCode: 'WP7_ELECTRON_DISTRIBUTION_TREE_TRUST_NOT_ENFORCED',
    run() { if (process.platform !== 'linux') return { status: 'NOT_APPLICABLE', observedReasonCode: 'LINUX_EXACT_MODE_POLICY_NOT_APPLICABLE', applicable: false }; const { built } = buildPackagedArtifactForMutation(); const target = path.join(built.payloadRoot, PRODUCT_EXECUTABLE_NAME); detachFile(target); fs.chmodSync(target, 0o644); return expectReason(this.expectedReasonCode, () => compareElectronDistributionTree({ payloadRoot: built.payloadRoot, archiveExecutableEntry: ELECTRON_ARCHIVE_EXECUTABLE, productExecutableName: PRODUCT_EXECUTABLE_NAME, officialRecords: fixtureDistributionRecords() })); }
  },
  {
    id: 'CR-M67', class: 'MUTATION', target: 'Electron regular resource unixMode 0644 changed to 0755', expectedReasonCode: 'WP7_ELECTRON_DISTRIBUTION_TREE_TRUST_NOT_ENFORCED',
    run() { if (process.platform !== 'linux') return { status: 'NOT_APPLICABLE', observedReasonCode: 'LINUX_EXACT_MODE_POLICY_NOT_APPLICABLE', applicable: false }; const { built } = buildPackagedArtifactForMutation(); const target = path.join(built.payloadRoot, 'resources.pak'); detachFile(target); fs.chmodSync(target, 0o755); return expectReason(this.expectedReasonCode, () => compareElectronDistributionTree({ payloadRoot: built.payloadRoot, archiveExecutableEntry: ELECTRON_ARCHIVE_EXECUTABLE, productExecutableName: PRODUCT_EXECUTABLE_NAME, officialRecords: fixtureDistributionRecords() })); }
  },
  {
    id: 'CR-M68', class: 'MUTATION', target: 'Git 100755 payload file changed to 0600', expectedReasonCode: 'WP7_GIT_PAYLOAD_MODE_BINDING_INVALID',
    run() { if (process.platform !== 'linux') return { status: 'NOT_APPLICABLE', observedReasonCode: 'LINUX_EXACT_MODE_POLICY_NOT_APPLICABLE', applicable: false }; const sourceCommit = gitIdentity(REPO_ROOT).sourceCommit; const { built } = buildPackagedArtifactForMutation(); const target = path.join(built.runtime.appRoot, 'backend', 'desktopHostedEntry.js'); detachFile(target); fs.chmodSync(target, 0o600); return expectReason(this.expectedReasonCode, () => validateReviewedApplicationSourceClosure(built.payloadRoot, REPO_ROOT, sourceCommit)); }
  },
  {
    id: 'CR-M69', class: 'MUTATION', target: 'Git 100644 payload file changed to 0755', expectedReasonCode: 'WP7_GIT_PAYLOAD_MODE_BINDING_INVALID',
    run() { if (process.platform !== 'linux') return { status: 'NOT_APPLICABLE', observedReasonCode: 'LINUX_EXACT_MODE_POLICY_NOT_APPLICABLE', applicable: false }; const sourceCommit = gitIdentity(REPO_ROOT).sourceCommit; const { built } = buildPackagedArtifactForMutation(); const target = path.join(built.runtime.appRoot, 'backend', 'config.js'); detachFile(target); fs.chmodSync(target, 0o755); return expectReason(this.expectedReasonCode, () => validateReviewedApplicationSourceClosure(built.payloadRoot, REPO_ROOT, sourceCommit)); }
  },
  {
    id: 'CR-M70', class: 'MUTATION', target: 'Git mode tree identity field deleted', expectedReasonCode: 'BOOT_MANIFEST_SCHEMA_INVALID',
    run() { const { built } = buildPackagedArtifactForMutation(); detachFile(built.manifestPath); detachFile(built.detachedPath); const manifest = readJson(built.manifestPath); delete manifest.gitPayloadModeTreeSha256; writeCanonicalJson(built.manifestPath, manifest); fs.writeFileSync(built.detachedPath, `${sha256File(built.manifestPath)}  release-manifest.json\n`, 'utf8'); return expectReason(this.expectedReasonCode, () => validatePackagedPayload(built.payloadRoot, built.resourcesRoot, { repoRoot: REPO_ROOT })); }
  },
  {
    id: 'CR-M71', class: 'MUTATION', target: 'Git mode tree identity field forged', expectedReasonCode: 'WP7_PACKAGED_APPLICATION_RELEASE_IDENTITY_INCOMPLETE',
    run() { const { built } = buildPackagedArtifactForMutation(); rewriteManifestField(built, 'gitPayloadModeTreeSha256', '0'.repeat(64)); return expectReason(this.expectedReasonCode, () => validatePackagedPayload(built.payloadRoot, built.resourcesRoot, { repoRoot: REPO_ROOT })); }
  },
  {
    id: 'CR-M72', class: 'MUTATION', target: 'external dependency binding replaced or re-issued', expectedReasonCode: 'WP7_PRODUCTION_DEPENDENCY_EXTERNAL_BINDING_INVALID',
    run() { const sourceCommit = gitIdentity(REPO_ROOT).sourceCommit; const { root, built } = buildPackagedArtifactForMutation(); const clone = path.join(root, 'binding-clone'); execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'core.eol=lf', 'clone', '--config', 'core.autocrlf=false', '--config', 'core.eol=lf', '--no-hardlinks', REPO_ROOT, clone], { stdio: 'ignore' }); const bindingPath = path.join(clone, 'release', 'production-dependency-binding.json'); const document = readJson(bindingPath); document.sourceAuthority = 'FORGED_REISSUED_BY_PACKAGER'; fs.writeFileSync(bindingPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8'); return expectReason(this.expectedReasonCode, () => verifyProductionDependencyClosure({ repoRoot: clone, appRoot: built.runtime.appRoot, sourceCommit, platform: process.platform, arch: 'x64' })); }
  },

  {
    id: 'CR-M73', class: 'MUTATION', target: 'executable production dependency mode 0755/0754 changed to 0600', expectedReasonCode: 'WP7_PRODUCTION_DEPENDENCY_FILE_MODE_MISMATCH',
    run() { if (process.platform !== 'linux') return { status: 'NOT_APPLICABLE', observedReasonCode: 'LINUX_EXACT_MODE_POLICY_NOT_APPLICABLE', applicable: false }; const sourceCommit = gitIdentity(REPO_ROOT).sourceCommit; const { built } = buildPackagedArtifactForMutation(); const { executable } = dependencyModeTargets(sourceCommit); const target = path.join(built.runtime.appRoot, ...executable.path.split('/')); detachFile(target); fs.chmodSync(target, 0o600); return expectReason(this.expectedReasonCode, () => verifyProductionDependencyClosure({ repoRoot: REPO_ROOT, appRoot: built.runtime.appRoot, sourceCommit, platform: 'linux', arch: 'x64' })); }
  },
  {
    id: 'CR-M74', class: 'MUTATION', target: 'executable production dependency mode 0755/0754 changed to 0644', expectedReasonCode: 'WP7_PRODUCTION_DEPENDENCY_FILE_MODE_MISMATCH',
    run() { if (process.platform !== 'linux') return { status: 'NOT_APPLICABLE', observedReasonCode: 'LINUX_EXACT_MODE_POLICY_NOT_APPLICABLE', applicable: false }; const sourceCommit = gitIdentity(REPO_ROOT).sourceCommit; const { built } = buildPackagedArtifactForMutation(); const { executable } = dependencyModeTargets(sourceCommit); const target = path.join(built.runtime.appRoot, ...executable.path.split('/')); detachFile(target); fs.chmodSync(target, 0o644); return expectReason(this.expectedReasonCode, () => verifyProductionDependencyClosure({ repoRoot: REPO_ROOT, appRoot: built.runtime.appRoot, sourceCommit, platform: 'linux', arch: 'x64' })); }
  },
  {
    id: 'CR-M75', class: 'MUTATION', target: 'regular production dependency mode 0644 changed to 0755', expectedReasonCode: 'WP7_PRODUCTION_DEPENDENCY_FILE_MODE_MISMATCH',
    run() { if (process.platform !== 'linux') return { status: 'NOT_APPLICABLE', observedReasonCode: 'LINUX_EXACT_MODE_POLICY_NOT_APPLICABLE', applicable: false }; const sourceCommit = gitIdentity(REPO_ROOT).sourceCommit; const { built } = buildPackagedArtifactForMutation(); const { regular } = dependencyModeTargets(sourceCommit); const target = path.join(built.runtime.appRoot, ...regular.path.split('/')); detachFile(target); fs.chmodSync(target, 0o755); return expectReason(this.expectedReasonCode, () => verifyProductionDependencyClosure({ repoRoot: REPO_ROOT, appRoot: built.runtime.appRoot, sourceCommit, platform: 'linux', arch: 'x64' })); }
  },
  {
    id: 'CR-M76', class: 'MUTATION', target: 'regular production dependency mode 0644 changed to group/world writable 0666', expectedReasonCode: 'WP7_PRODUCTION_DEPENDENCY_FILE_MODE_MISMATCH',
    run() { if (process.platform !== 'linux') return { status: 'NOT_APPLICABLE', observedReasonCode: 'LINUX_EXACT_MODE_POLICY_NOT_APPLICABLE', applicable: false }; const sourceCommit = gitIdentity(REPO_ROOT).sourceCommit; const { built } = buildPackagedArtifactForMutation(); const { regular } = dependencyModeTargets(sourceCommit); const target = path.join(built.runtime.appRoot, ...regular.path.split('/')); detachFile(target); fs.chmodSync(target, 0o666); return expectReason(this.expectedReasonCode, () => verifyProductionDependencyClosure({ repoRoot: REPO_ROOT, appRoot: built.runtime.appRoot, sourceCommit, platform: 'linux', arch: 'x64' })); }
  },
  {
    id: 'CR-M77', class: 'MUTATION', target: 'executable production dependency mode changed to read-only 0444', expectedReasonCode: 'WP7_PRODUCTION_DEPENDENCY_FILE_MODE_MISMATCH',
    run() { if (process.platform !== 'linux') return { status: 'NOT_APPLICABLE', observedReasonCode: 'LINUX_EXACT_MODE_POLICY_NOT_APPLICABLE', applicable: false }; const sourceCommit = gitIdentity(REPO_ROOT).sourceCommit; const { built } = buildPackagedArtifactForMutation(); const { executable } = dependencyModeTargets(sourceCommit); const target = path.join(built.runtime.appRoot, ...executable.path.split('/')); detachFile(target); fs.chmodSync(target, 0o444); return expectReason(this.expectedReasonCode, () => verifyProductionDependencyClosure({ repoRoot: REPO_ROOT, appRoot: built.runtime.appRoot, sourceCommit, platform: 'linux', arch: 'x64' })); }
  },
  {
    id: 'CR-M78', class: 'MUTATION', target: 'regular production dependency mode changed from 0644 to 0744', expectedReasonCode: 'WP7_PRODUCTION_DEPENDENCY_FILE_MODE_MISMATCH',
    run() { if (process.platform !== 'linux') return { status: 'NOT_APPLICABLE', observedReasonCode: 'LINUX_EXACT_MODE_POLICY_NOT_APPLICABLE', applicable: false }; const sourceCommit = gitIdentity(REPO_ROOT).sourceCommit; const { built } = buildPackagedArtifactForMutation(); const { regular } = dependencyModeTargets(sourceCommit); const target = path.join(built.runtime.appRoot, ...regular.path.split('/')); detachFile(target); fs.chmodSync(target, 0o744); return expectReason(this.expectedReasonCode, () => verifyProductionDependencyClosure({ repoRoot: REPO_ROOT, appRoot: built.runtime.appRoot, sourceCommit, platform: 'linux', arch: 'x64' })); }
  },
  {
    id: 'CR-M79', class: 'MUTATION', target: 'dependency mode and internal release identities jointly re-signed', expectedReasonCode: 'WP7_PRODUCTION_DEPENDENCY_FILE_MODE_MISMATCH',
    run() { if (process.platform !== 'linux') return { status: 'NOT_APPLICABLE', observedReasonCode: 'LINUX_EXACT_MODE_POLICY_NOT_APPLICABLE', applicable: false }; const sourceCommit = gitIdentity(REPO_ROOT).sourceCommit; const { built } = buildPackagedArtifactForMutation(); const { executable } = dependencyModeTargets(sourceCommit); const target = path.join(built.runtime.appRoot, ...executable.path.split('/')); detachFile(target); fs.chmodSync(target, 0o644); resealDependencyModeIdentity(built); return expectReason(this.expectedReasonCode, () => validatePackagedPayload(built.payloadRoot, built.resourcesRoot, { repoRoot: REPO_ROOT })); }
  },
  {
    id: 'CR-M80', class: 'MUTATION', target: 'dependency mode tree identity field deleted', expectedReasonCode: 'BOOT_MANIFEST_SCHEMA_INVALID',
    run() { const { built } = buildPackagedArtifactForMutation(); detachFile(built.manifestPath); detachFile(built.detachedPath); const manifest = readJson(built.manifestPath); delete manifest.productionDependencyModeTreeSha256; writeCanonicalJson(built.manifestPath, manifest); fs.writeFileSync(built.detachedPath, `${sha256File(built.manifestPath)}  release-manifest.json\n`, 'utf8'); return expectReason(this.expectedReasonCode, () => validatePackagedPayload(built.payloadRoot, built.resourcesRoot, { repoRoot: REPO_ROOT })); }
  },
  {
    id: 'CR-M81', class: 'MUTATION', target: 'dependency mode tree identity field forged', expectedReasonCode: 'WP7_PACKAGED_APPLICATION_RELEASE_IDENTITY_INCOMPLETE',
    run() { const { built } = buildPackagedArtifactForMutation(); rewriteManifestField(built, 'productionDependencyModeTreeSha256', '0'.repeat(64)); return expectReason(this.expectedReasonCode, () => validatePackagedPayload(built.payloadRoot, built.resourcesRoot, { repoRoot: REPO_ROOT })); }
  },
  {
    id: 'CR-M82', class: 'MUTATION', target: 'external dependency binding mode record deleted', expectedReasonCode: 'WP7_PRODUCTION_DEPENDENCY_BINDING_INVALID',
    run() { const sourceCommit = gitIdentity(REPO_ROOT).sourceCommit; const document = structuredClone(readReviewedBinding(REPO_ROOT, sourceCommit).binding); delete document.platforms[`${process.platform}-x64`].files[0].mode; return expectReason(this.expectedReasonCode, () => validateBindingDocument(document)); }
  },
  {
    id: 'CR-M83', class: 'MUTATION', target: 'external dependency binding mode record forged', expectedReasonCode: 'WP7_PRODUCTION_DEPENDENCY_BINDING_INVALID',
    run() { const sourceCommit = gitIdentity(REPO_ROOT).sourceCommit; const document = structuredClone(readReviewedBinding(REPO_ROOT, sourceCommit).binding); document.platforms[`${process.platform}-x64`].files[0].mode = document.platforms[`${process.platform}-x64`].files[0].mode === '0644' ? '0755' : '0644'; return expectReason(this.expectedReasonCode, () => validateBindingDocument(document)); }
  },
  {
    id: 'CR-M84', class: 'MUTATION', target: 'governance trusted-product probe ID set reordered', expectedReasonCode: 'WP7_TRUSTED_PRODUCT_PROBE_ID_SET_INCONSISTENT',
    run() { const root = temp('wp7-probe-scope-mutation-'); const clone = path.join(root, 'repo'); execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'core.eol=lf', 'clone', '--config', 'core.autocrlf=false', '--config', 'core.eol=lf', '--no-hardlinks', REPO_ROOT, clone], { stdio: 'ignore' }); const scopePath = path.join(clone, 'governance', 'wp7', 'formal-trusted-product-probe-scope.json'); const document = readJson(scopePath); document.formalProbeIds.reverse(); fs.writeFileSync(scopePath, `${JSON.stringify(document, null, 2)}\n`, 'utf8'); return expectReason(this.expectedReasonCode, () => readFormalProbeScope(clone)); }
  },
  {
    id: 'CR-M85', class: 'MUTATION', target: 'blocker record alternate probe ID set rejected by canonical authority', expectedReasonCode: 'WP7_TRUSTED_PRODUCT_PROBE_ID_SET_INCONSISTENT',
    run() { const blocker = createTrustedProductProbeBlocker({ repoRoot: REPO_ROOT, sourceCommit: 'a'.repeat(40), sourceTree: 'b'.repeat(40), generatedAtUtc: '2026-07-06T00:00:00.000Z' }); const forged = [...blocker.formalProbeIds]; forged[0] = 'startup'; return expectReason(this.expectedReasonCode, () => assertFormalProbeIdSet(forged)); }
  },


  {
    id: 'CR-M86', class: 'MUTATION', target: 'node_modules root directory mode 0755 changed to 0777', expectedReasonCode: 'WP7_PRODUCTION_DEPENDENCY_DIRECTORY_MODE_MISMATCH',
    run() { if (process.platform !== 'linux') return { status: 'NOT_APPLICABLE', observedReasonCode: 'LINUX_DIRECTORY_EXACT_MODE_POLICY_NOT_APPLICABLE', applicable: false }; const sourceCommit = gitIdentity(REPO_ROOT).sourceCommit; const { built } = buildPackagedArtifactForMutation(); const { root } = dependencyDirectoryModeTargets(sourceCommit); fs.chmodSync(path.join(built.runtime.appRoot, ...root.path.split('/')), 0o777); return expectReason(this.expectedReasonCode, () => verifyProductionDependencyClosure({ repoRoot: REPO_ROOT, appRoot: built.runtime.appRoot, sourceCommit, platform: 'linux', arch: 'x64' })); }
  },
  {
    id: 'CR-M87', class: 'MUTATION', target: 'package directory mode 0755 changed to 0777', expectedReasonCode: 'WP7_PRODUCTION_DEPENDENCY_DIRECTORY_MODE_MISMATCH',
    run() { if (process.platform !== 'linux') return { status: 'NOT_APPLICABLE', observedReasonCode: 'LINUX_DIRECTORY_EXACT_MODE_POLICY_NOT_APPLICABLE', applicable: false }; const sourceCommit = gitIdentity(REPO_ROOT).sourceCommit; const { built } = buildPackagedArtifactForMutation(); const { packageDirectory } = dependencyDirectoryModeTargets(sourceCommit); fs.chmodSync(path.join(built.runtime.appRoot, ...packageDirectory.path.split('/')), 0o777); return expectReason(this.expectedReasonCode, () => verifyProductionDependencyClosure({ repoRoot: REPO_ROOT, appRoot: built.runtime.appRoot, sourceCommit, platform: 'linux', arch: 'x64' })); }
  },
  {
    id: 'CR-M88', class: 'MUTATION', target: 'scope directory mode 0755 changed to 0775', expectedReasonCode: 'WP7_PRODUCTION_DEPENDENCY_DIRECTORY_MODE_MISMATCH',
    run() { if (process.platform !== 'linux') return { status: 'NOT_APPLICABLE', observedReasonCode: 'LINUX_DIRECTORY_EXACT_MODE_POLICY_NOT_APPLICABLE', applicable: false }; const sourceCommit = gitIdentity(REPO_ROOT).sourceCommit; const { built } = buildPackagedArtifactForMutation(); const { scope } = dependencyDirectoryModeTargets(sourceCommit); fs.chmodSync(path.join(built.runtime.appRoot, ...scope.path.split('/')), 0o775); return expectReason(this.expectedReasonCode, () => verifyProductionDependencyClosure({ repoRoot: REPO_ROOT, appRoot: built.runtime.appRoot, sourceCommit, platform: 'linux', arch: 'x64' })); }
  },
  {
    id: 'CR-M89', class: 'MUTATION', target: 'directory mode and internal release identities jointly re-signed', expectedReasonCode: 'WP7_PRODUCTION_DEPENDENCY_DIRECTORY_MODE_MISMATCH',
    run() { if (process.platform !== 'linux') return { status: 'NOT_APPLICABLE', observedReasonCode: 'LINUX_DIRECTORY_EXACT_MODE_POLICY_NOT_APPLICABLE', applicable: false }; const sourceCommit = gitIdentity(REPO_ROOT).sourceCommit; const { built } = buildPackagedArtifactForMutation(); const { packageDirectory } = dependencyDirectoryModeTargets(sourceCommit); fs.chmodSync(path.join(built.runtime.appRoot, ...packageDirectory.path.split('/')), 0o777); resealDependencyDirectoryModeIdentity(built, packageDirectory.path); return expectReason(this.expectedReasonCode, () => validatePackagedPayload(built.payloadRoot, built.resourcesRoot, { repoRoot: REPO_ROOT })); }
  },
  {
    id: 'CR-M90', class: 'MUTATION', target: 'dependency directory mode tree identity field deleted', expectedReasonCode: 'BOOT_MANIFEST_SCHEMA_INVALID',
    run() { const { built } = buildPackagedArtifactForMutation(); detachFile(built.manifestPath); detachFile(built.detachedPath); const manifest = readJson(built.manifestPath); delete manifest.productionDependencyDirectoryModeTreeSha256; writeCanonicalJson(built.manifestPath, manifest); fs.writeFileSync(built.detachedPath, `${sha256File(built.manifestPath)}  release-manifest.json\n`, 'utf8'); return expectReason(this.expectedReasonCode, () => validatePackagedPayload(built.payloadRoot, built.resourcesRoot, { repoRoot: REPO_ROOT })); }
  },
  {
    id: 'CR-M91', class: 'MUTATION', target: 'dependency directory mode tree identity field forged', expectedReasonCode: 'WP7_PACKAGED_APPLICATION_RELEASE_IDENTITY_INCOMPLETE',
    run() { const { built } = buildPackagedArtifactForMutation(); rewriteManifestField(built, 'productionDependencyDirectoryModeTreeSha256', '0'.repeat(64)); return expectReason(this.expectedReasonCode, () => validatePackagedPayload(built.payloadRoot, built.resourcesRoot, { repoRoot: REPO_ROOT })); }
  },
  {
    id: 'CR-M92', class: 'MUTATION', target: 'external dependency binding directory record deleted', expectedReasonCode: 'WP7_PRODUCTION_DEPENDENCY_BINDING_INVALID',
    run() { const sourceCommit = gitIdentity(REPO_ROOT).sourceCommit; const document = structuredClone(readReviewedBinding(REPO_ROOT, sourceCommit).binding); document.platforms[`${process.platform}-x64`].directories.pop(); return expectReason(this.expectedReasonCode, () => validateBindingDocument(document)); }
  },
  {
    id: 'CR-M93', class: 'MUTATION', target: 'external dependency binding directory mode record forged', expectedReasonCode: 'WP7_PRODUCTION_DEPENDENCY_BINDING_INVALID',
    run() { const sourceCommit = gitIdentity(REPO_ROOT).sourceCommit; const document = structuredClone(readReviewedBinding(REPO_ROOT, sourceCommit).binding); const directory = document.platforms[`${process.platform}-x64`].directories[0]; directory.normalizedMode = process.platform === 'linux' ? '0777' : 'WINDOWS_DIRECTORY_OWNER_RX'; return expectReason(this.expectedReasonCode, () => validateBindingDocument(document)); }
  },


  {
    id: 'CR-M94', class: 'MUTATION', target: 'Electron production modules load node:sqlite outside the restricted worker', expectedReasonCode: 'WP7_SQLITE_BRIDGE_BYPASS_DETECTED',
    run() {
      const root = path.join(REPO_ROOT, 'electron');
      const offenders = [];
      const visit = directory => { for (const entry of fs.readdirSync(directory, { withFileTypes: true })) { const full = path.join(directory, entry.name); if (entry.isDirectory()) visit(full); else if (entry.isFile() && /\.js$/.test(entry.name) && fs.readFileSync(full, 'utf8').includes("require('node:sqlite')") && path.basename(full) !== 'sqliteSettingsWorker.js') offenders.push(path.relative(root, full)); } };
      visit(root);
      if (offenders.length) throw Object.assign(new Error('node:sqlite bypass remains'), { reasonCode: this.expectedReasonCode, details: { offenders } });
      return { status: 'KILLED', observedReasonCode: 'NODE_SQLITE_RESTRICTED_TO_WORKER' };
    }
  },
  {
    id: 'CR-M95', class: 'MUTATION', target: 'SQLite bridge executes worker through Electron or unreviewed runtime', expectedReasonCode: 'WP7_SQLITE_BRIDGE_RUNTIME_BYPASS_DETECTED',
    run() {
      const source = fs.readFileSync(path.join(REPO_ROOT, 'electron', 'sqliteSettingsBridge.js'), 'utf8');
      const required = ["resolveTrustedNodeRuntime", "spawnSync(this.runtime.executablePath", "delete this.environment.ELECTRON_RUN_AS_NODE", "input: request"];
      const missing = required.filter(token => !source.includes(token));
      if (missing.length || source.includes('spawnSync(process.execPath')) throw Object.assign(new Error('SQLite bridge trusted runtime binding missing'), { reasonCode: this.expectedReasonCode, details: { missing } });
      return { status: 'KILLED', observedReasonCode: 'SQLITE_BRIDGE_TRUSTED_NODE_BOUND' };
    }
  },
  {
    id: 'CR-M96', class: 'MUTATION', target: 'SQLite worker accepts an unreviewed operation', expectedReasonCode: 'WP7_SQLITE_BRIDGE_OPERATION_FORBIDDEN',
    run() {
      const result = spawnSync(process.execPath, [path.join(REPO_ROOT, 'electron', 'sqliteSettingsWorker.js')], { input: JSON.stringify({ operation: 'query', dbPath: path.join(temp('wp7-sqlite-op-'), 'settings.db') }), encoding: 'utf8' });
      const response = JSON.parse(String(result.stdout || '{}'));
      if (result.status !== 0 && response.reasonCode === this.expectedReasonCode) return { status: 'KILLED', observedReasonCode: response.reasonCode };
      throw new Error('mutation survived');
    }
  },
  {
    id: 'CR-M97', class: 'MUTATION', target: 'SQLite worker accepts an unreviewed namespace/key', expectedReasonCode: 'WP7_SQLITE_BRIDGE_SCOPE_FORBIDDEN',
    run() {
      const result = spawnSync(process.execPath, [path.join(REPO_ROOT, 'electron', 'sqliteSettingsWorker.js')], { input: JSON.stringify({ operation: 'read', dbPath: path.join(temp('wp7-sqlite-scope-'), 'settings.db'), namespace: 'credentials', key: 'secret' }), encoding: 'utf8' });
      const response = JSON.parse(String(result.stdout || '{}'));
      if (result.status !== 0 && response.reasonCode === this.expectedReasonCode) return { status: 'KILLED', observedReasonCode: response.reasonCode };
      throw new Error('mutation survived');
    }
  },
  {
    id: 'CR-M98', class: 'MUTATION', target: 'SQLite worker accepts a relative or non-database path', expectedReasonCode: 'WP7_SQLITE_BRIDGE_DB_PATH_INVALID',
    run() {
      const result = spawnSync(process.execPath, [path.join(REPO_ROOT, 'electron', 'sqliteSettingsWorker.js')], { input: JSON.stringify({ operation: 'read', dbPath: 'relative.sqlite.txt' }), encoding: 'utf8' });
      const response = JSON.parse(String(result.stdout || '{}'));
      if (result.status !== 0 && response.reasonCode === this.expectedReasonCode) return { status: 'KILLED', observedReasonCode: response.reasonCode };
      throw new Error('mutation survived');
    }
  },
  {
    id: 'CR-M99', class: 'MUTATION', target: 'trusted Node runtime executable is missing', expectedReasonCode: 'WP7_NODE_RUNTIME_EXECUTABLE_MISSING',
    run() { return expectReason(this.expectedReasonCode, () => verifyNodeExecutable(path.join(temp('wp7-node-missing-'), 'node'))); }
  },
  {
    id: 'CR-M100', class: 'MUTATION', target: 'trusted Node runtime reports a version other than 22.16.0', expectedReasonCode: 'WP7_NODE_RUNTIME_VERSION_MISMATCH',
    run() {
      const root = temp('wp7-node-version-'); const executable = path.join(root, 'node'); fs.writeFileSync(executable, '#!/bin/sh\necho v20.0.0\n'); fs.chmodSync(executable, 0o755);
      return expectReason(this.expectedReasonCode, () => verifyNodeExecutable(executable));
    }
  },
  {
    id: 'CR-M101', class: 'MUTATION', target: 'backend launch falls back to Electron process.execPath', expectedReasonCode: 'WP7_BACKEND_TRUSTED_NODE_RUNTIME_BYPASS',
    run() {
      const source = fs.readFileSync(path.join(REPO_ROOT, 'electron', 'main.js'), 'utf8');
      const section = source.slice(source.indexOf('function resolveBackendLaunchPaths'), source.indexOf('function backendStartupTimeoutMs'));
      const launchSection = source.slice(source.indexOf('function startBackendProcessForCoordinator'), source.indexOf('async function stopBackendProcessForCoordinator'));
      if (!section.includes('resolveTrustedNodeRuntime') || !section.includes('nodeRuntimeExecutablePath') || !launchSection.includes('execPath: launch.nodeRuntimeExecutablePath') || launchSection.includes('execPath: process.execPath')) throw Object.assign(new Error('backend trusted Node launch binding missing'), { reasonCode: this.expectedReasonCode });
      return { status: 'KILLED', observedReasonCode: 'BACKEND_TRUSTED_NODE_RUNTIME_BOUND' };
    }
  },
  {
    id: 'CR-M102', class: 'MUTATION', target: 'packaged trusted Node runtime executable removed', expectedReasonCode: 'WP7_NODE_RUNTIME_EXECUTABLE_MISSING',
    run() {
      const { built } = buildPackagedArtifactForMutation(); const manifest = readJson(built.manifestPath); const runtimeRoot = path.join(built.resourcesRoot, 'runtime', 'node22'); const executable = path.join(built.resourcesRoot, ...manifest.nodeRuntimeExecutablePath.split('/')); detachFile(executable); fs.rmSync(executable, { force: true });
      return expectReason(this.expectedReasonCode, () => inspectTrustedNodeRuntime({ runtimeRoot, executableRelativePath: manifest.nodeRuntimeExecutablePath.replace(/^runtime\/node22\//, '') }));
    }
  },
  {
    id: 'CR-M103', class: 'MUTATION', target: 'packaged trusted Node executable content hash forged', expectedReasonCode: 'WP7_NODE_RUNTIME_IDENTITY_MISMATCH',
    run() {
      const { built } = buildPackagedArtifactForMutation(); const identity = readJson(built.manifestPath); const runtimeRoot = path.join(built.resourcesRoot, 'runtime', 'node22'); const executable = path.join(built.resourcesRoot, ...identity.nodeRuntimeExecutablePath.split('/')); detachFile(executable); fs.appendFileSync(executable, '\n# runtime mutation\n'); const runtime = inspectTrustedNodeRuntime({ runtimeRoot, executableRelativePath: identity.nodeRuntimeExecutablePath.replace(/^runtime\/node22\//, '') });
      return expectReason(this.expectedReasonCode, () => validateManifestRuntimeIdentity(identity, runtime));
    }
  },
  {
    id: 'CR-M104', class: 'MUTATION', target: 'packaged trusted Node runtime tree hash forged', expectedReasonCode: 'WP7_NODE_RUNTIME_IDENTITY_MISMATCH',
    run() {
      const { built } = buildPackagedArtifactForMutation(); const identity = readJson(built.manifestPath); identity.nodeRuntimeTreeSha256 = '0'.repeat(64); const runtime = inspectTrustedNodeRuntime({ runtimeRoot: path.join(built.resourcesRoot, 'runtime', 'node22'), executableRelativePath: identity.nodeRuntimeExecutablePath.replace(/^runtime\/node22\//, '') });
      return expectReason(this.expectedReasonCode, () => validateManifestRuntimeIdentity(identity, runtime));
    }
  },
  {
    id: 'CR-M105', class: 'MUTATION', target: 'release manifest trusted Node runtime version forged', expectedReasonCode: 'WP7_NODE_RUNTIME_IDENTITY_MISMATCH',
    run() { const { built } = buildPackagedArtifactForMutation(); rewriteManifestField(built, 'nodeRuntimeVersion', '20.0.0'); return expectReason(this.expectedReasonCode, () => validatePackagedPayload(built.payloadRoot, built.resourcesRoot, { repoRoot: REPO_ROOT })); }
  },
  {
    id: 'CR-M106', class: 'MUTATION', target: 'packaged probe runner omits trusted Node runtime identity binding', expectedReasonCode: 'WP7_PACKAGED_APPLICATION_RELEASE_IDENTITY_INCOMPLETE',
    run() {
      const source = fs.readFileSync(path.join(REPO_ROOT, 'tools', 'wp7', 'run-packaged-electron-probe-integration.js'), 'utf8');
      const required = ['nodeRuntimeVersion','nodeRuntimeExecutablePath','nodeRuntimeExecutableSha256','nodeRuntimeTreeSha256','nodeRuntimeFileCount','nodeRuntimeModeBoundFileCount'];
      const missing = required.filter(token => !source.includes(token));
      if (missing.length || !source.includes('closure.nodeRuntime')) throw Object.assign(new Error('packaged runner Node runtime binding missing'), { reasonCode: this.expectedReasonCode, details: { missing } });
      return { status: 'KILLED', observedReasonCode: 'PACKAGED_RUNNER_NODE_RUNTIME_BOUND' };
    }
  },
  {
    id: 'CR-M107', class: 'MUTATION', target: 'application filesystem identity omits trusted Node runtime tree', expectedReasonCode: 'WP7_APPLICATION_PAYLOAD_FILESYSTEM_IDENTITY_INVALID',
    run() {
      const base = { applicationPayloadSha256: '1'.repeat(64), productionDependencyFileTreeSha256: '2'.repeat(64), productionDependencyModeTreeSha256: '3'.repeat(64), productionDependencyDirectoryModeTreeSha256: '4'.repeat(64), gitPayloadModeTreeSha256: '5'.repeat(64), electronDistributionTreeSha256: '6'.repeat(64), nodeRuntimeTreeSha256: '7'.repeat(64), nativeBinaryScanSha256: '9'.repeat(64) };
      const first = applicationPayloadFilesystemIdentitySha256(base); const second = applicationPayloadFilesystemIdentitySha256({ ...base, nodeRuntimeTreeSha256: '8'.repeat(64) });
      if (first === second) throw Object.assign(new Error('Node runtime tree does not affect filesystem identity'), { reasonCode: this.expectedReasonCode });
      return { status: 'KILLED', observedReasonCode: 'NODE_RUNTIME_TREE_INCLUDED_IN_FILESYSTEM_IDENTITY' };
    }
  },
  {
    id: 'CR-M108', class: 'MUTATION', target: 'offline-start pre-main proof is absent', expectedReasonCode: 'WP7_NETWORK_ISOLATION_PRE_MAIN_PROOF_MISSING',
    run() { return expectReason(this.expectedReasonCode, () => readPreMainProof(path.join(temp('wp7-proof-missing-'), 'missing.json'))); }
  },
  {
    id: 'CR-M109', class: 'MUTATION', target: 'offline-start network isolation library hash is forged', expectedReasonCode: 'WP7_NETWORK_ISOLATION_IDENTITY_MISMATCH',
    run() {
      if (process.platform !== 'linux') return { status: 'NOT_APPLICABLE', observedReasonCode: 'LINUX_NETWORK_ISOLATION_NOT_APPLICABLE', applicable: false };
      const root = temp('wp7-net-identity-'); const isolation = compileLinuxNetworkIsolation({ sourcePath: path.join(REPO_ROOT, 'tools', 'wp7', 'network-isolation-preload.c'), outputPath: path.join(root, 'isolation.so') });
      return expectReason(this.expectedReasonCode, () => verifyNetworkIsolationIdentity({ sourcePath: isolation.sourcePath, libraryPath: isolation.libraryPath, expectedSourceSha256: isolation.sourceSha256, expectedLibrarySha256: '0'.repeat(64) }));
    }
  },
  {
    id: 'CR-M110', class: 'MUTATION', target: 'offline-start isolation fails to deny non-loopback or preserve loopback', expectedReasonCode: 'WP7_NETWORK_ISOLATION_BEHAVIOR_INVALID',
    run() {
      if (process.platform !== 'linux') return { status: 'NOT_APPLICABLE', observedReasonCode: 'LINUX_NETWORK_ISOLATION_NOT_APPLICABLE', applicable: false };
      const root = temp('wp7-net-behavior-'); const isolation = compileLinuxNetworkIsolation({ sourcePath: path.join(REPO_ROOT, 'tools', 'wp7', 'network-isolation-preload.c'), outputPath: path.join(root, 'isolation.so') }); const proofDir = path.join(root, 'proof'); fs.mkdirSync(proofDir); const nonce = '123e4567-e89b-42d3-a456-426614174000';
      const script = "const net=require('net');const out={};const server=net.createServer(s=>s.end());server.listen(0,'127.0.0.1',()=>{const c=net.connect(server.address().port,'127.0.0.1');c.on('connect',()=>{out.loopback=true;c.end();server.close();const e=net.connect(9,'198.51.100.1');e.on('error',x=>{out.external=x.code;console.log(JSON.stringify(out));});});c.on('error',x=>{out.loopback=false;out.loopbackError=x.code;console.log(JSON.stringify(out));});});";
      const result = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 10_000, env: { ...process.env, LD_PRELOAD: isolation.libraryPath, WP7_NETWORK_ISOLATION_PROOF_DIR: proofDir, WP7_NETWORK_ISOLATION_NONCE: nonce } });
      let output = {}; try { output = JSON.parse(String(result.stdout || '').trim()); } catch {}
      if (result.status !== 0 || output.loopback !== true || output.external !== 'ENETUNREACH') throw Object.assign(new Error('network isolation behavior invalid'), { reasonCode: this.expectedReasonCode, details: { status: result.status, output, stderr: result.stderr } });
      readPreMainProof(path.join(proofDir, `${result.pid}.json`), { pid: result.pid, parentPid: process.pid, nonce });
      return { status: 'KILLED', observedReasonCode: 'NON_LOOPBACK_DENIED_LOOPBACK_ALLOWED' };
    }
  },
  {
    id: 'CR-M111', class: 'MUTATION', target: 'offline-start runner does not inject isolation before product spawn', expectedReasonCode: 'WP7_OFFLINE_STARTUP_PRECONDITION_NOT_MET',
    run() {
      const source = fs.readFileSync(path.join(REPO_ROOT, 'tools', 'wp7', 'run-packaged-electron-probe-integration.js'), 'utf8');
      const injection = source.indexOf('env.LD_PRELOAD ='); const precondition = source.indexOf("env.WP7_PROBE_NETWORK_DISABLED_BEFORE_SPAWN = '1'"); const spawnCall = source.indexOf('await spawnProduct({');
      if (injection < 0 || precondition < 0 || spawnCall < 0 || injection > spawnCall || precondition > spawnCall) throw Object.assign(new Error('network isolation is not injected before product spawn'), { reasonCode: this.expectedReasonCode });
      return { status: 'KILLED', observedReasonCode: 'NETWORK_ISOLATION_INJECTED_BEFORE_SPAWN' };
    }
  },
  {
    id: 'CR-M112', class: 'MUTATION', target: 'crash recovery skips OWNER_EXIT_CONFIRMED before OWNER_RECOVERING', expectedReasonCode: 'WP7_BACKEND_CRASH_RECOVERY_STATE_SEQUENCE_INVALID',
    run() { const measurement = measurementFor('crash-recovery'); measurement.recoveryStateSequence = measurement.recoveryStateSequence.filter(state => state !== 'OWNER_EXIT_CONFIRMED'); return expectReason(this.expectedReasonCode, () => validateMeasurements('crash-recovery', measurement)); }
  },
  {
    id: 'CR-M113', class: 'MUTATION', target: 'crash recovery reads flat owner trust instead of nested BackendProcessHost authority', expectedReasonCode: 'WP7_BACKEND_AUTHORITY_PROJECTION_INVALID',
    run() {
      const main = fs.readFileSync(path.join(REPO_ROOT, 'electron', 'main.js'), 'utf8');
      const host = fs.readFileSync(path.join(REPO_ROOT, 'electron', 'wp7InstalledRuntimeProbeProductionHost.js'), 'utf8');
      const mainStart = main.indexOf('waitForReplacementOwner: (oldPid) => waitForTrustedReplacementOwner({');
      const mainEnd = main.indexOf('}),', mainStart);
      const mainSection = main.slice(mainStart, mainEnd + 3);
      const hostStart = host.indexOf('async function waitForTrustedReplacementOwner');
      const hostEnd = host.indexOf('\n}', hostStart);
      const hostSection = host.slice(hostStart, hostEnd + 2);
      if (!mainSection.includes('ownerSnapshot: () => trustedBackendProjection()') || mainSection.includes('authoritativeBackend().ownerTrusted') || !hostSection.includes('owner.ownerTrusted === true')) throw Object.assign(new Error('nested backend authority projection is not used'), { reasonCode: this.expectedReasonCode });
      return { status: 'KILLED', observedReasonCode: 'NESTED_BACKEND_AUTHORITY_PROJECTION_USED' };
    }
  },
  {
    id: 'CR-M114', class: 'MUTATION', target: 'runtime installer identity reader is omitted from the packaged application projection', expectedReasonCode: 'WP7_PACKAGED_APPLICATION_SOURCE_BINDING_INVALID',
    run() {
      const { built } = buildPackagedArtifactForMutation();
      const target = path.join(built.runtime.appRoot, 'installer', 'installedIdentityReceipt.js');
      detachFile(target);
      fs.rmSync(target, { force: true });
      const sourceCommit = gitIdentity(REPO_ROOT).sourceCommit;
      return expectReason(this.expectedReasonCode, () => validateReviewedApplicationSourceClosure(built.payloadRoot, REPO_ROOT, sourceCommit));
    }
  },
  {
    id: 'CR-M115', class: 'MUTATION', target: 'backend authority recurses through aggregate DesktopHost snapshot before Node 22 spawn', expectedReasonCode: 'WP7_BACKEND_AUTHORITY_RECURSIVE_SNAPSHOT',
    run() {
      const source = fs.readFileSync(path.join(REPO_ROOT, 'electron', 'backendShutdownCoordinator.js'), 'utf8');
      const start = source.indexOf('function backendAuthority');
      const end = source.indexOf('\n}', start);
      const section = source.slice(start, end + 2);
      if (!section.includes('desktopHost?.backendProcessHost') || !section.includes('processHost?.snapshot?.()') || section.indexOf('processHost?.snapshot?.()') > section.indexOf('desktopHost?.snapshot?.()')) {
        throw Object.assign(new Error('backend authority is not bound directly to BackendProcessHost before aggregate fallback'), { reasonCode: this.expectedReasonCode });
      }
      return { status: 'KILLED', observedReasonCode: 'BACKEND_PROCESS_HOST_DIRECT_AUTHORITY_BOUND' };
    }
  },

  {
    id: 'CR-M116', class: 'MUTATION', target: 'controlled restart disposes a CONNECTING event socket without retaining an error consumer', expectedReasonCode: 'WP7_EVENT_SOCKET_CONNECTING_DISPOSAL_UNSAFE',
    run() {
      const source = fs.readFileSync(path.join(REPO_ROOT, 'electron', 'main.js'), 'utf8');
      if (!source.includes("disposeEventSocket(socket, WebSocket)")) {
        throw Object.assign(new Error('main restart path is not bound to state-aware event socket disposal'), { reasonCode: this.expectedReasonCode });
      }
      const listeners = new Map();
      const socket = {
        readyState: 0,
        terminated: false,
        removeAllListeners() { listeners.clear(); },
        on(name, listener) { listeners.set(name, listener); return this; },
        terminate() {
          const listener = listeners.get('error');
          if (!listener) throw new Error('CONNECTING abort has no error consumer');
          this.terminated = true;
          listener(new Error('WebSocket was closed before the connection was established'));
          this.readyState = 3;
        }
      };
      const result = disposeEventSocket(socket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
      if (!socket.terminated || result.action !== 'terminate-connecting' || socket.readyState !== 3) {
        throw Object.assign(new Error('CONNECTING socket disposal did not terminate safely'), { reasonCode: this.expectedReasonCode });
      }
      return { status: 'KILLED', observedReasonCode: 'CONNECTING_EVENT_SOCKET_ERROR_CONTAINED' };
    }
  },

  {
    id: 'CR-M117', class: 'MUTATION', target: 'safe-mode renderer storage treats a transient trusted-local navigation failure as fatal or retries without fresh readiness and view custody', expectedReasonCode: 'WP7_SAFE_MODE_RENDERER_STORAGE_NAVIGATION_RETRY_INVALID',
    run() {
      const main = fs.readFileSync(path.join(REPO_ROOT, 'electron', 'main.js'), 'utf8');
      const productionHost = fs.readFileSync(path.join(REPO_ROOT, 'electron', 'wp7InstalledRuntimeProbeProductionHost.js'), 'utf8');
      const helper = fs.readFileSync(path.join(REPO_ROOT, 'electron', 'wp7RendererStorageProbeNavigation.js'), 'utf8');
      const regression = path.join(REPO_ROOT, 'tests', 'wp7', 'wp7-renderer-storage-navigation-recovery.test.js');
      const requiredMain = [
        'createElectronRendererStorageSession({',
        'waitForReady: () => wp7ProbeBackendReadyDocument()',
        'const authority = trustedBackendProjection()',
        'authority.running !== true',
        'authority.ownerTrusted !== true'
      ];
      const requiredProductionHost = [
        'createRendererStorageProbeSession({',
        'attempts: Number(options.attempts || 5)',
        'verifyView: async (view)'
      ];
      const requiredHelper = [
        "phase === 'navigation'",
        'isTransientRendererNavigationError(error)',
        'view = createView({ attempt })',
        'if (view && !view.isDestroyed()) view.destroy()',
        "WP7_SAFE_MODE_RENDERER_STORAGE_NAVIGATION_FAILED"
      ];
      const missing = [
        ...requiredMain.filter((token) => !main.includes(token)),
        ...requiredProductionHost.filter((token) => !productionHost.includes(token)),
        ...requiredHelper.filter((token) => !helper.includes(token))
      ];
      if (missing.length) throw Object.assign(new Error(`renderer storage retry boundary is incomplete: ${missing.join(', ')}`), { reasonCode: this.expectedReasonCode });
      const result = spawnSync(process.execPath, ['--test', regression], { cwd: REPO_ROOT, encoding: 'utf8', timeout: 30_000 });
      if (result.status !== 0 || !/fail 0/.test(result.stdout)) {
        throw Object.assign(new Error(result.stdout || result.stderr || 'renderer storage retry regression failed'), { reasonCode: this.expectedReasonCode });
      }
      return { status: 'KILLED', observedReasonCode: 'TRANSIENT_RENDERER_NAVIGATION_RETRIED_WITH_FRESH_TRUSTED_VIEW' };
    }
  },
  {
    id: 'CR-M118', class: 'MUTATION', target: 'safe-mode matrix destroys the verified renderer between source scenarios and requires repeated Chromium navigation after backend restart cycles', expectedReasonCode: 'WP7_SAFE_MODE_RENDERER_STORAGE_SESSION_CUSTODY_INVALID',
    run() {
      const main = fs.readFileSync(path.join(REPO_ROOT, 'electron', 'main.js'), 'utf8');
      const helper = fs.readFileSync(path.join(REPO_ROOT, 'electron', 'wp7RendererStorageProbeNavigation.js'), 'utf8');
      const regression = fs.readFileSync(path.join(REPO_ROOT, 'tests', 'wp7', 'wp7-renderer-storage-navigation-recovery.test.js'), 'utf8');
      const required = [
        'let wp7ProbeRendererStorageSession = null',
        'if (wp7ProbeRendererStorageSession) return wp7ProbeRendererStorageSession',
        'rendererStorageSession: ensureWp7RendererStorageSession()',
        'wp7ProbeRendererStorageSession?.dispose?.()',
        'let retainedView = null',
        'if (usableView(retainedView))',
        'retainedView = acquired.view',
        'later matrix scenarios must not require another local navigation'
      ];
      const joined = `${main}
${helper}
${regression}`;
      const missing = required.filter((token) => !joined.includes(token));
      if (missing.length) throw Object.assign(new Error(`retained renderer storage session custody is incomplete: ${missing.join(', ')}`), { reasonCode: this.expectedReasonCode });
      return { status: 'KILLED', observedReasonCode: 'VERIFIED_RENDERER_RETAINED_ACROSS_SAFE_MODE_MATRIX_RESTARTS' };
    }
  },
  {
    id: 'CR-M119', class: 'MUTATION', target: 'safe-mode renderer storage loads the production SPA or any script/connection-bearing document instead of the exact inert same-origin probe document', expectedReasonCode: 'WP7_SAFE_MODE_RENDERER_STORAGE_INERT_DOCUMENT_INVALID',
    run() {
      const main = fs.readFileSync(path.join(REPO_ROOT, 'electron', 'main.js'), 'utf8');
      const server = fs.readFileSync(path.join(REPO_ROOT, 'backend', 'server.js'), 'utf8');
      const documentModule = fs.readFileSync(path.join(REPO_ROOT, 'shared', 'wp7', 'rendererStorageProbeDocument.js'), 'utf8');
      const productionHost = fs.readFileSync(path.join(REPO_ROOT, 'electron', 'wp7InstalledRuntimeProbeProductionHost.js'), 'utf8');
      const regression = path.join(REPO_ROOT, 'tests', 'wp7', 'wp7-renderer-storage-navigation-recovery.test.js');
      const required = [
        "WP7_RENDERER_STORAGE_PROBE_PATH = '/__wp7/renderer-storage'",
        "String(env.WP7_PROBE_ID || '').trim() === 'safe-mode-negative'",
        "default-src 'none'",
        "connect-src 'none'",
        'WP7_RENDERER_STORAGE_PROBE_URL',
        'WP7_RENDERER_STORAGE_PROBE_MARKER',
        'verifyView: async (view)',
        'app.get(WP7_RENDERER_STORAGE_PROBE_PATH',
        'rendererStorageProbeResponse(process.env)'
      ];
      const joined = `${main}\n${server}\n${documentModule}\n${productionHost}`;
      const missing = required.filter((token) => !joined.includes(token));
      if (/<script\b/i.test(documentModule) || /\b(?:src|href)\s*=/.test(documentModule)) missing.push('inert-document-no-script-or-external-resource');
      if (server.indexOf('app.get(WP7_RENDERER_STORAGE_PROBE_PATH') > server.indexOf('app.use(express.static(frontendRoot')) missing.push('probe-route-before-spa-fallback');
      if (missing.length) throw Object.assign(new Error(`inert renderer storage probe document boundary is incomplete: ${missing.join(', ')}`), { reasonCode: this.expectedReasonCode });
      const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', regression], { cwd: REPO_ROOT, encoding: 'utf8', timeout: 30_000 });
      if (result.status !== 0 || !/fail 0/.test(result.stdout)) throw Object.assign(new Error(result.stdout || result.stderr || 'inert renderer storage document regression failed'), { reasonCode: this.expectedReasonCode });
      return { status: 'KILLED', observedReasonCode: 'INERT_SAME_ORIGIN_RENDERER_STORAGE_DOCUMENT_ENFORCED' };
    }
  },
  {
    id: 'CR-M120', class: 'MUTATION', target: 'packaged probe timeout kills only the Electron parent and can hang forever while backend or Chromium descendants retain captured pipes', expectedReasonCode: 'WP7_PACKAGED_PROBE_PROCESS_TREE_CUSTODY_INVALID',
    run() {
      const runner = fs.readFileSync(path.join(REPO_ROOT, 'tools', 'wp7', 'run-packaged-electron-probe-integration.js'), 'utf8');
      const custody = fs.readFileSync(path.join(REPO_ROOT, 'tools', 'wp7', 'process-tree-custody.js'), 'utf8');
      const regression = path.join(REPO_ROOT, 'tests', 'wp7', 'wp7-packaged-runner-process-custody.test.js');
      const required = [
        'detached: treeOptions.detached',
        'terminateProcessTree(child',
        'closeCapturedProcessStreams(child)',
        'WP7_PACKAGED_ELECTRON_PROBE_EXECUTION_TIMEOUT',
        'kill(-child.pid, signal)',
        "run('taskkill.exe', ['/PID', String(child.pid), '/T', '/F']"
      ];
      const joined = `${runner}\n${custody}`;
      const missing = required.filter((token) => !joined.includes(token));
      if (missing.length) throw Object.assign(new Error(`packaged runner process-tree custody is incomplete: ${missing.join(', ')}`), { reasonCode: this.expectedReasonCode });
      const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', regression], { cwd: REPO_ROOT, encoding: 'utf8', timeout: 30_000 });
      if (result.status !== 0 || !/fail 0/.test(result.stdout)) throw Object.assign(new Error(result.stdout || result.stderr || 'packaged runner process-tree regression failed'), { reasonCode: this.expectedReasonCode });
      return { status: 'KILLED', observedReasonCode: 'PACKAGED_PROBE_PROCESS_TREE_TERMINATED_AND_TIMEOUT_SETTLED' };
    }
  },
  {
    id: 'CR-M121', class: 'MUTATION', target: 'boot-failure diagnostic child drops the parent product Chromium switches or accepts arbitrary caller switches, causing pre-diagnostic sandbox exit or launch-boundary bypass', expectedReasonCode: 'WP7_BOOT_FAILURE_CHILD_LAUNCH_BOUNDARY_INVALID',
    run() {
      const main = fs.readFileSync(path.join(REPO_ROOT, 'electron', 'main.js'), 'utf8');
      const adapter = fs.readFileSync(path.join(REPO_ROOT, 'electron', 'wp7InstalledRuntimeProbeMainAdapter.js'), 'utf8');
      const regression = path.join(REPO_ROOT, 'tests', 'wp7', 'wp7-boot-failure-diagnostics.test.js');
      const required = [
        "BOOT_FAILURE_CHILD_ALLOWED_SWITCHES = new Set(['--no-sandbox', '--disable-gpu'])",
        'normalizeBootFailureChildArguments(deps.bootFailureChildArguments?.() || [])',
        'spawn(process.execPath, childArguments',
        "bootFailureChildArguments: () => ['no-sandbox', 'disable-gpu']",
        'app.commandLine.hasSwitch(name)'
      ];
      const joined = `${main}
${adapter}`;
      const missing = required.filter((token) => !joined.includes(token));
      if (missing.length) throw Object.assign(new Error(`boot-failure child launch boundary is incomplete: ${missing.join(', ')}`), { reasonCode: this.expectedReasonCode });
      const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', regression], { cwd: REPO_ROOT, encoding: 'utf8', timeout: 30_000 });
      if (result.status !== 0 || !/fail 0/.test(result.stdout)) throw Object.assign(new Error(result.stdout || result.stderr || 'boot-failure child launch regression failed'), { reasonCode: this.expectedReasonCode });
      return { status: 'KILLED', observedReasonCode: 'BOOT_FAILURE_CHILD_INHERITS_ONLY_ACTIVE_ALLOWLISTED_PRODUCT_SWITCHES' };
    }
  },
  {
    id: 'CR-M122', class: 'MUTATION', target: 'pre-review runner accepts a bare SHA256 string without a sealed artifact file', expectedReasonCode: 'WP7_PRE_REVIEW_SEALED_ARTIFACT_MISSING',
    run() {
      return expectReason(this.expectedReasonCode, () => readAndVerifyPreReviewSealedArtifact('e'.repeat(64)));
    }
  },
  {
    id: 'CR-M123', class: 'MUTATION', target: 'pre-review sealed artifact is relabelled as a final release artifact', expectedReasonCode: 'WP7_PRE_REVIEW_SEALED_ARTIFACT_SCHEMA_INVALID',
    run() {
      const root = temp('wp7-pre-review-seal-class-');
      const filePath = path.join(root, 'WP7_PRE_REVIEW_SEALED_ARTIFACT.json');
      const data = fixturePreReviewSealData();
      createPreReviewSealedArtifact(filePath, data);
      const document = readJson(filePath);
      document.artifactClass = 'WP7_FINAL_RELEASE';
      writeCanonicalJson(filePath, document);
      return expectReason(this.expectedReasonCode, () => readAndVerifyPreReviewSealedArtifact(filePath, data));
    }
  },
  {
    id: 'CR-M124', class: 'MUTATION', target: 'pre-review sealed artifact content does not bind the recomputed product identity', expectedReasonCode: 'WP7_PRE_REVIEW_SEALED_ARTIFACT_IDENTITY_MISMATCH',
    run() {
      const root = temp('wp7-pre-review-seal-identity-');
      const filePath = path.join(root, 'WP7_PRE_REVIEW_SEALED_ARTIFACT.json');
      const data = fixturePreReviewSealData();
      createPreReviewSealedArtifact(filePath, data);
      return expectReason(this.expectedReasonCode, () => readAndVerifyPreReviewSealedArtifact(filePath, { ...data, ['build' + 'Id']: ['different', 'build'].join('-') }));
    }
  },
  {
    id: 'CR-M125', class: 'MUTATION', target: 'pre-review packaged integration consumes a product classified as WP7 final release evidence', expectedReasonCode: 'WP7_PRE_REVIEW_ARTIFACT_CLASSIFICATION_INVALID',
    run() {
      return expectReason(this.expectedReasonCode, () => assertPreReviewProductClassification({ artifactClass: 'WP7_FINAL_RELEASE', finalReleaseEvidence: true }));
    }
  },
  {
    id: 'CR-M126', class: 'MUTATION', target: 'Pre-Review evidence index references a temporary absolute probe path', expectedReasonCode: 'WP7_PRE_REVIEW_EVIDENCE_PATH_INVALID',
    run() {
      return expectReason(this.expectedReasonCode, () => normalizeRelativePath('/tmp/runtime-oai/wp7-nine-fresh-final/runs/first-start/stdout.log', 'stdoutPath'));
    }
  },
  {
    id: 'CR-M127', class: 'MUTATION', target: 'Pre-Review evidence index references a missing raw probe artifact', expectedReasonCode: 'WP7_TRUSTED_PRODUCT_RAW_PROBE_EVIDENCE_MISSING',
    run() {
      const root = temp('wp7-pre-review-raw-missing-');
      return expectReason(this.expectedReasonCode, () => resolveEvidenceFile(root, 'runs/first-start/stdout.log', 'stdoutPath'));
    }
  }


];

function matrixSummary(results, documentType = 'WP7_CONVERGENCE_CORRECTION_MATRIX_RESULT') {
  const killed = results.filter((row) => row.status === 'KILLED').length;
  const notApplicable = results.filter((row) => row.status === 'NOT_APPLICABLE').length;
  const failed = results.filter((row) => !['KILLED', 'NOT_APPLICABLE'].includes(row.status));
  return {
    schemaVersion: 2,
    documentType,
    total: results.length,
    applicable: results.length - notApplicable,
    killed,
    notApplicable,
    survived: results.filter((row) => row.status === 'SURVIVED').length,
    invalid: results.filter((row) => row.status === 'INVALID').length,
    timeout: results.filter((row) => row.status === 'TIMEOUT').length,
    signal: results.filter((row) => row.status === 'SIGNAL').length,
    harnessError: results.filter((row) => row.status === 'HARNESS_ERROR').length,
    status: failed.length ? 'FAIL' : 'PASS',
    results
  };
}


async function runSelectedChecks(selectedChecks) {
  const results = [];
  for (const check of selectedChecks) {
    if (process.env.WP7_MATRIX_PROGRESS === '1') process.stderr.write(`START ${check.id} ${check.target}\n`);
    try {
      results.push({ id: check.id, class: check.class, target: check.target, expectedReasonCode: check.expectedReasonCode, ...(await check.run()) });
    } catch (error) {
      results.push({ id: check.id, class: check.class, target: check.target, status: 'HARNESS_ERROR', expectedReasonCode: check.expectedReasonCode, message: error.message });
    }
    if (process.env.WP7_MATRIX_PROGRESS === '1') process.stderr.write(`END ${check.id} ${results[results.length - 1].status}\n`);
  }
  return results;
}

function parseBound(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > checks.length) throw new Error(`${name} must be an integer between 1 and ${checks.length}`);
  return value;
}

function runShard(from, to, root) {
  return new Promise((resolve) => {
    const stdoutPath = path.join(root, `shard-${from}-${to}.json`);
    const stderrPath = path.join(root, `shard-${from}-${to}.log`);
    const stdoutFd = fs.openSync(stdoutPath, 'w');
    const stderrFd = fs.openSync(stderrPath, 'w');
    const child = spawn(process.execPath, [__filename], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        WP7_MATRIX_WORKER: '1',
        WP7_MATRIX_FROM: String(from),
        WP7_MATRIX_TO: String(to)
      },
      stdio: ['ignore', stdoutFd, stderrFd]
    });
    let settled = false;
    function finish(result) {
      if (settled) return;
      settled = true;
      fs.closeSync(stdoutFd);
      fs.closeSync(stderrFd);
      resolve(result);
    }
    child.on('error', (error) => finish({ from, to, status: null, signal: null, stdoutPath, stderrPath, spawnError: error.message }));
    child.on('close', (status, signal) => finish({ from, to, status, signal, stdoutPath, stderrPath, spawnError: null }));
  });
}

async function runShardedMatrix() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wp7-correction-matrix-shards-'));
  const ranges = [];
  // Keep inexpensive checks grouped while isolating the dependency-directory mode
  // mutations that materialize the complete reviewed dependency tree. This keeps
  // the canonical entry deterministic without retaining several large clones in
  // one worker process.
  for (let from = 1; from <= Math.min(56, checks.length); from += 8) ranges.push([from, Math.min(from + 7, 56, checks.length)]);
  for (let from = 57; from <= Math.min(72, checks.length); from += 8) ranges.push([from, Math.min(from + 7, 72, checks.length)]);
  for (let from = 73; from <= Math.min(84, checks.length); from += 4) ranges.push([from, Math.min(from + 3, 84, checks.length)]);
  for (let from = 85; from <= Math.min(94, checks.length); from += 1) ranges.push([from, from]);
  for (let from = 95; from <= checks.length; from += 4) ranges.push([from, Math.min(from + 3, checks.length)]);
  const shardRuns = [];
  for (const [from, to] of ranges) {
    if (process.env.WP7_MATRIX_PROGRESS === '1') process.stderr.write(`SHARD START ${from}-${to}\n`);
    const shard = await runShard(from, to, root);
    shardRuns.push(shard);
    if (process.env.WP7_MATRIX_PROGRESS === '1') process.stderr.write(`SHARD END ${from}-${to} status=${shard.status} signal=${shard.signal || 'none'}\n`);
  }
  const results = [];
  const shardFailures = [];
  for (const shard of shardRuns) {
    const stderr = fs.existsSync(shard.stderrPath) ? fs.readFileSync(shard.stderrPath, 'utf8') : '';
    if (process.env.WP7_MATRIX_PROGRESS === '1' && stderr) process.stderr.write(stderr);
    const stdout = fs.existsSync(shard.stdoutPath) ? fs.readFileSync(shard.stdoutPath, 'utf8') : '';
    if (shard.spawnError || shard.status !== 0) {
      shardFailures.push({ from: shard.from, to: shard.to, status: shard.status, signal: shard.signal, spawnError: shard.spawnError, stderr: stderr.slice(-4000), stdout: stdout.slice(-4000) });
      continue;
    }
    try {
      const parsed = JSON.parse(stdout);
      if (!Array.isArray(parsed.results) || parsed.total !== shard.to - shard.from + 1) throw new Error('shard result count mismatch');
      results.push(...parsed.results);
    } catch (error) {
      shardFailures.push({ from: shard.from, to: shard.to, status: shard.status, signal: shard.signal, parseError: error.message, stderr: stderr.slice(-4000), stdout: stdout.slice(-4000) });
    }
  }
  const order = new Map(checks.map((check, index) => [check.id, index]));
  results.sort((a, b) => order.get(a.id) - order.get(b.id));
  const ids = results.map((row) => row.id);
  const uniqueIds = new Set(ids);
  if (shardFailures.length || results.length !== checks.length || uniqueIds.size !== checks.length) {
    const summary = matrixSummary(results);
    summary.status = 'FAIL';
    summary.harnessError += shardFailures.length + (results.length !== checks.length || uniqueIds.size !== checks.length ? 1 : 0);
    summary.shardFailures = shardFailures;
    summary.expectedTotal = checks.length;
    fs.rmSync(root, { recursive: true, force: true });
    return summary;
  }
  const summary = matrixSummary(results);
  fs.rmSync(root, { recursive: true, force: true });
  return summary;
}

async function main() {
  if (process.env.WP7_MATRIX_WORKER !== '1' && !process.env.WP7_MATRIX_FROM && !process.env.WP7_MATRIX_TO) {
    const summary = await runShardedMatrix();
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    process.exitCode = summary.status === 'PASS' ? 0 : 1;
    return;
  }
  const from = parseBound('WP7_MATRIX_FROM', 1);
  const to = parseBound('WP7_MATRIX_TO', checks.length);
  if (from > to) throw new Error('WP7_MATRIX_FROM must not exceed WP7_MATRIX_TO');
  const selected = checks.slice(from - 1, to);
  let results;
  try {
    results = await runSelectedChecks(selected);
  } finally {
    cleanupTempRoots();
  }
  const summary = matrixSummary(results, process.env.WP7_MATRIX_WORKER === '1' ? 'WP7_CONVERGENCE_CORRECTION_MATRIX_SHARD_RESULT' : 'WP7_CONVERGENCE_CORRECTION_MATRIX_RESULT');
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  process.exitCode = summary.status === 'PASS' ? 0 : 1;
}
main().catch((error) => { process.stdout.write(`${JSON.stringify({ status: 'FAIL', reasonCode: error.reasonCode || 'WP7_CONVERGENCE_CORRECTION_MATRIX_FAILED', message: error.message }, null, 2)}\n`); process.exitCode = 1; });
