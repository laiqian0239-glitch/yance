#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  FINAL_REUSE_REASON,
  PROVENANCE_INDEX_REQUIRED_REASON,
  REPO_ROOT,
  Wp1Error,
  assertEmptyBeforeFinalBuild,
  assertNoWp1ProvenanceAfterGeneration,
  buildPipelineTest,
  canonicalizePayloadRecords,
  canonicalizeRelativePayloadPath,
  createApplicationPayload,
  deriveDatabaseSchemaVersion,
  gitIdentity,
  scanSingleHumanMaintainedReleaseSource,
  sha256File,
  writeCanonicalJson
} = require('./lib');
const { getElectronReleaseIdentity } = require('../../electron/releaseIdentity');
const { getBackendReleaseIdentity } = require('../../backend/releaseIdentity');
const { getInstallerReleaseIdentity } = require('../../installer/releaseIdentity');
const { getDiagnosticsReleaseIdentity } = require('../../diagnostics/releaseIdentity');
const { assertSameInstalledReleaseIdentity } = require('../../shared/release/installedManifestLocator');

const R5_REQUIRED_TEST_FILES = [
  'release-identity-determinism.test.js',
  'payload-scope-inclusion-exclusion.test.js',
  'payload-files-canonicalization.test.js',
  'payload-path-unicode-normalization-collision-rejected.test.js',
  'payload-path-case-collision-rejected.test.js',
  'payload-path-parent-traversal-rejected.test.js',
  'payload-path-absolute-rejected.test.js',
  'manifest-detached-hash.test.js',
  'consumer-build-id-consistency.test.js',
  'build-id-mismatch-fail-closed.test.js',
  'pipeline-test-artifact-marker.test.js'
];
const SUPPLEMENTAL_TEST_FILES = [
  'single-human-maintained-release-source.test.js',
  'single-release-source-scan-negative.test.js',
  'manifest-schema-validation.test.js',
  'staging-selective-copy-negative.test.js'
];
const ALL_TEST_FILES = [...R5_REQUIRED_TEST_FILES, ...SUPPLEMENTAL_TEST_FILES];

function arg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}
function negativeCase(name, fn, expectedReasonCode) {
  try { fn(); return { name, status: 'FAIL', expectedReasonCode, actualReasonCode: null }; }
  catch (error) { return { name, status: error.reasonCode === expectedReasonCode ? 'PASS' : 'FAIL', expectedReasonCode, actualReasonCode: error.reasonCode || null }; }
}
function copyOne(source, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

function main() {
  const repoRoot = path.resolve(arg('--repo-root', REPO_ROOT));
  const outputDir = path.resolve(arg('--output-dir', path.join(os.tmpdir(), 'yance-wp1-evidence')));
  const generatedAtUtc = arg('--generated-at-utc', new Date().toISOString());
  const requestedCommit = arg('--source-commit');
  const identity = gitIdentity(repoRoot);
  if (!identity.repositoryClean) throw new Wp1Error('WP1_EVIDENCE_REPOSITORY_DIRTY', 'formal WP1 evidence requires a clean repository');
  if (requestedCommit && requestedCommit !== identity.sourceCommit) {
    throw new Wp1Error('WP1_EVIDENCE_SOURCE_COMMIT_MISMATCH', 'requested source commit does not match actual Git HEAD', { requestedCommit, actualCommit: identity.sourceCommit });
  }

  const testFiles = ALL_TEST_FILES.map(name => path.join(repoRoot, 'tests', 'wp1', name));
  const testRun = spawnSync(process.execPath, ['--test', ...testFiles], { cwd: repoRoot, encoding: 'utf8' });
  if (testRun.status !== 0) {
    throw new Wp1Error('WP1_REQUIRED_TESTS_FAILED', 'WP1 tests failed', { exitCode: testRun.status, stderr: testRun.stderr.slice(-8000), stdout: testRun.stdout.slice(-8000) });
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-wp1-formal-'));
  const pipeline = buildPipelineTest({ repoRoot, outputRoot: path.join(tempRoot, 'pipeline'), gitIdentity: identity, sourceCommit: identity.sourceCommit, buildTimestampUtc: generatedAtUtc, requireClean: true });
  const resourcesPath = path.join(pipeline.outputRoot, 'resources');
  const electronIdentity = getElectronReleaseIdentity({ resourcesPath, reload: true });
  const backendIdentity = getBackendReleaseIdentity({ startupConfig: { resourcesPath }, reload: true });
  const installerIdentity = getInstallerReleaseIdentity({ stagingRoot: pipeline.outputRoot });
  const diagnosticsIdentity = getDiagnosticsReleaseIdentity({ releaseIdentity: backendIdentity });
  const consumerIdentities = [electronIdentity, backendIdentity, installerIdentity, diagnosticsIdentity];
  assertSameInstalledReleaseIdentity(consumerIdentities);

  const singleSource = scanSingleHumanMaintainedReleaseSource(repoRoot);
  if (singleSource.status !== 'PASS') throw new Wp1Error(singleSource.reasonCode, 'single human-maintained release source check failed', { violations: singleSource.violations });
  const schemaAuthority = deriveDatabaseSchemaVersion(repoRoot);

  const forbiddenPayload = pipeline.records.filter(record => /(^|\/)(tests|evidence|verification|tools|installer|installers|packaging|build-scripts|release-scripts|docs|blueprint)(\/|$)/i.test(record.path));
  if (forbiddenPayload.length) throw new Wp1Error('WP1_RUNTIME_PAYLOAD_SCOPE_VIOLATION', 'real pipeline output contains forbidden files', { files: forbiddenPayload.map(item => item.path) });

  const pathCases = [
    negativeCase('absolute-posix', () => canonicalizeRelativePayloadPath('/root/file'), 'WP1_PAYLOAD_ABSOLUTE_PATH_REJECTED'),
    negativeCase('absolute-drive', () => canonicalizeRelativePayloadPath('C:\\root\\file'), 'WP1_PAYLOAD_ABSOLUTE_PATH_REJECTED'),
    negativeCase('parent-traversal', () => canonicalizeRelativePayloadPath('a/../b'), 'WP1_PAYLOAD_PARENT_TRAVERSAL_REJECTED'),
    negativeCase('windows-case-collision', () => canonicalizePayloadRecords([{ path: 'A.js', sizeBytes: 1, sha256: 'a'.repeat(64) }, { path: 'a.js', sizeBytes: 1, sha256: 'b'.repeat(64) }]), 'WP1_PAYLOAD_WINDOWS_CASE_COLLISION'),
    negativeCase('unicode-nfc-collision', () => canonicalizePayloadRecords([{ path: 'café.js', sizeBytes: 1, sha256: 'a'.repeat(64) }, { path: 'cafe\u0301.js', sizeBytes: 1, sha256: 'b'.repeat(64) }]), 'WP1_PAYLOAD_UNICODE_NORMALIZATION_COLLISION')
  ];
  if (pathCases.some(item => item.status !== 'PASS')) throw new Wp1Error('WP1_PAYLOAD_PATH_VALIDATION_FAILED', 'payload path negative validation did not pass');

  const emptyStaging = path.join(tempRoot, 'empty-staging');
  fs.mkdirSync(emptyStaging);
  assertEmptyBeforeFinalBuild(emptyStaging);
  const selectiveSources = [
    'resources/release-manifest.json',
    'resources/release-manifest.sha256',
    'release-evidence.json',
    'resources/payload-files.json',
    '.wp1-pipeline-test-artifact.json',
    'Yance-PIPELINE-TEST-ONLY.bin',
    'pipeline-summary.json',
    'build-session-receipt.json',
    'wp1-provenance-index.json'
  ];
  const selectiveCases = [];
  for (const relative of selectiveSources) {
    const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-wp1-selective-evidence-'));
    copyOne(path.join(pipeline.outputRoot, relative), path.join(staging, path.basename(relative)));
    const result = negativeCase(relative, () => assertNoWp1ProvenanceAfterGeneration(staging, [pipeline.provenanceIndexPath]), FINAL_REUSE_REASON);
    selectiveCases.push(result);
  }
  if (selectiveCases.some(item => item.status !== 'PASS')) throw new Wp1Error('WP1_PIPELINE_TEST_BOUNDARY_FAILED', 'selective-copy staging tests failed');

  const missingIndexCase = negativeCase(
    'missing-provenance-index',
    () => assertNoWp1ProvenanceAfterGeneration(path.join(pipeline.outputRoot, 'application-payload')),
    PROVENANCE_INDEX_REQUIRED_REASON
  );
  if (missingIndexCase.status !== 'PASS') throw new Wp1Error('WP1_PROVENANCE_INDEX_REQUIREMENT_FAILED', 'missing provenance index did not fail closed');

  const freshFinalStaging = path.join(tempRoot, 'fresh-final-staging');
  fs.mkdirSync(freshFinalStaging);
  assertEmptyBeforeFinalBuild(freshFinalStaging);
  createApplicationPayload(repoRoot, path.join(freshFinalStaging, 'application-payload'));
  const freshFinalPayloadResult = assertNoWp1ProvenanceAfterGeneration(freshFinalStaging, [pipeline.provenanceIndexPath]);
  if (freshFinalPayloadResult.status !== 'PASS') throw new Wp1Error('WP1_FRESH_FINAL_PAYLOAD_FALSE_POSITIVE', 'fresh final payload was incorrectly classified as reused WP1 output');

  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(outputDir, { recursive: true });
  const common = { schemaVersion: 2, status: 'PASS', sourceCommit: identity.sourceCommit, sourceTree: identity.sourceTree, repositoryClean: true, generatedAtUtc };
  const outputs = {
    'release-identity-tooling.json': {
      ...common,
      buildId: pipeline.summary.buildId,
      releaseSource: 'release/release-source.json',
      singleHumanMaintainedReleaseSource: true,
      sourcePackageVersion: '0.0.0-development',
      generatedPackageVersion: pipeline.manifest.productVersion,
      databaseSchemaVersion: schemaAuthority.databaseSchemaVersion,
      databaseSchemaAuthorities: schemaAuthority.authorities,
      artifactClass: pipeline.summary.artifactClass,
      finalReleaseEvidence: false,
      releaseManifestSha256: pipeline.summary.releaseManifestSha256,
      r5RequiredTests: R5_REQUIRED_TEST_FILES.map(name => ({ name: name.replace(/\.js$/, ''), status: 'PASS' })),
      supplementalTests: SUPPLEMENTAL_TEST_FILES.map(name => ({ name: name.replace(/\.js$/, ''), status: 'PASS' }))
    },
    'payload-hash-vectors.json': {
      ...common,
      buildId: pipeline.summary.buildId,
      payloadFileCount: pipeline.summary.payloadFileCount,
      payloadFilesSha256: pipeline.summary.payloadFilesSha256,
      applicationPayloadSha256: pipeline.summary.applicationPayloadSha256,
      runtimeAllowlistRoots: pipeline.summary.includedRoots,
      forbiddenPayloadFiles: [],
      payloadFilesDefinition: 'SHA256(raw bytes of canonical payload-files.json)',
      applicationPayloadDefinition: 'SHA256(sorted UTF-8 records encoded as <path>\\0<sizeBytes>\\0<sha256>\\n)'
    },
    'payload-path-validation.json': { ...common, normalization: 'Unicode NFC', windowsCaseCollisionPolicy: 'REJECT', cases: pathCases },
    'build-id-consistency.json': {
      ...common,
      expectedBuildId: pipeline.summary.buildId,
      defaultInstalledLayoutUsed: true,
      explicitManifestPathInjectedPerConsumer: false,
      consumers: consumerIdentities.map(item => ({ consumer: item.consumer, buildId: item.buildId, manifestSha256: item.manifestSha256 })),
      allConsumersMatch: true,
      mismatchPolicy: 'FAIL_CLOSED',
      mismatchReasonCode: 'BOOT_BUILD_ID_MISMATCH'
    },
    'pipeline-test-artifact-boundary.json': {
      ...common,
      artifactClass: 'PIPELINE_TEST_ONLY',
      finalReleaseEvidence: false,
      wp7ReuseAllowed: false,
      guards: ['assert-empty-before-final-build', 'assert-no-wp1-provenance-after-generation'],
      selectiveCopyCases: selectiveCases,
      missingProvenanceIndexCase: missingIndexCase,
      freshFinalPayloadWithIdenticalRuntimeBytesAllowed: freshFinalPayloadResult.status === 'PASS',
      ordinaryApplicationPayloadHashesUsedAsReuseEvidence: false,
      buildSessionReceipt: pipeline.buildSessionReceipt,
      rejectedReasonCode: FINAL_REUSE_REASON,
      missingIndexReasonCode: PROVENANCE_INDEX_REQUIRED_REASON,
      provenanceIndexSha256: sha256File(pipeline.provenanceIndexPath)
    },
    'single-release-source.json': { ...common, ...singleSource, databaseSchemaVersion: schemaAuthority.databaseSchemaVersion, databaseSchemaAuthorities: schemaAuthority.authorities },
    'manifest-schema-validation.json': {
      ...common,
      canonicalGitCommitField: 'gitCommit',
      sourceCommitEqualityRequired: true,
      validatedFields: ['gitCommit', 'sourceCommit', 'sourceTree', 'buildTimestampUtc', 'productVersion', 'stageVersion', 'phase', 'distributionMode', 'applicationPayloadSha256', 'payloadFilesSha256', 'apiContractVersion', 'credentialProtocolVersion', 'runtimeLockProtocolVersion', 'databaseSchemaVersion', 'buildId'],
      negativeTestsIncluded: ['missing-field', 'wrong-type', 'wrong-hash', 'wrong-commit', 'wrong-time', 'sourceCommit-mismatch', 'buildId-mismatch']
    },
    'real-payload-scope.json': { ...common, builder: 'createApplicationPayload', payloadFileCount: pipeline.records.length, runtimeAllowlistRoots: pipeline.summary.includedRoots, copiedFilesByRoot: pipeline.summary.copiedFilesByRoot, forbiddenFiles: [], installerToolingIncluded: false, backendTestsIncluded: false },
    'installed-layout-consumers.json': { ...common, resourcesPathLayout: 'resources/release-manifest.json + resources/release-manifest.sha256', consumers: consumerIdentities.map(item => ({ consumer: item.consumer, buildId: item.buildId, manifestSha256: item.manifestSha256 })), allConsumersMatch: true, diagnosticsUsesVerifiedReleaseIdentity: true },
    'staging-selective-copy.json': {
      ...common,
      preBuildEmptyGate: 'PASS',
      postGenerationProvenanceGate: 'PASS',
      cases: selectiveCases,
      missingProvenanceIndexCase: missingIndexCase,
      freshFinalPayloadWithIdenticalRuntimeBytesAllowed: freshFinalPayloadResult.status === 'PASS',
      ordinaryApplicationPayloadHashesUsedAsReuseEvidence: false,
      buildSessionReceipt: pipeline.buildSessionReceipt,
      reasonCode: FINAL_REUSE_REASON
    }
  };
  for (const [name, value] of Object.entries(outputs)) writeCanonicalJson(path.join(outputDir, name), value);
  const index = { ...common, evidenceDirectory: '.', files: Object.keys(outputs).sort().map(name => ({ name, sha256: sha256File(path.join(outputDir, name)) })) };
  writeCanonicalJson(path.join(outputDir, 'evidence-index.json'), index);
  process.stdout.write(`${JSON.stringify({ status: 'PASS', reasonCode: null, sourceCommit: identity.sourceCommit, sourceTree: identity.sourceTree, repositoryClean: true, buildId: pipeline.summary.buildId, r5RequiredTests: `${R5_REQUIRED_TEST_FILES.length}/${R5_REQUIRED_TEST_FILES.length} PASS`, supplementalTests: `${SUPPLEMENTAL_TEST_FILES.length}/${SUPPLEMENTAL_TEST_FILES.length} PASS`, evidenceOutputCount: Object.keys(outputs).length, outputDirectory: '.', generatedAtUtc }, null, 2)}\n`);
}

try { main(); }
catch (error) {
  process.stdout.write(`${JSON.stringify({ status: 'FAIL', reasonCode: error.reasonCode || 'WP1_EVIDENCE_FAILED', message: error.message, details: error.details || {} }, null, 2)}\n`);
  process.exit(error instanceof Wp1Error ? 2 : 1);
}
