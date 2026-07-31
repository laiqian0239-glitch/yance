'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  ACCEPTANCE_MAPPING_PATH,
  EVIDENCE_REQUIREMENTS_PATH,
  PHASE_MODEL_PATH,
  RISK_IDS,
  UPSTREAM_ACCEPTED_BINDINGS,
  Wp7Error,
  readJson,
  sha256File,
  validateAcceptanceMapping,
  validateBootFailureDiagnostics,
  validateCleanInstallEvidence,
  validateCrossFileIdentity,
  validateEvidenceCommon,
  validateEvidenceReferences,
  writeCanonicalJson
} = require('./lib');
const { readFinalExecutionContext } = require('./final-context');

const AGGREGATE_PATH = 'evidence/phase1-acceptance-evidence.json';
const FINAL_RELEASE_PATH = 'evidence/wp7/final-release-evidence.json';
const SHA256_RE = /^[0-9a-f]{64}$/;

function finalOutputs() {
  const requirements = readJson(EVIDENCE_REQUIREMENTS_PATH);
  return requirements.finalEvidenceSchema.finalEvidenceOutputs.slice();
}

function commonIdentity(document) {
  const keys = [
    'schemaVersion', 'stage', 'phase', 'workPackage', 'generatedAtUtc',
    'frozenSourceCommit', 'frozenSourceTree', 'buildSessionId', 'buildId',
    'productVersion', 'stageVersion', 'distributionMode', 'apiContractVersion',
    'credentialProtocolVersion', 'runtimeLockProtocolVersion', 'databaseSchemaVersion',
    'releaseManifestSha256', 'applicationPayloadSha256', 'applicationPayloadFilesystemIdentitySha256', 'payloadFilesSha256',
    'productionDependencyBindingSha256', 'productionDependencyPackageGraphSha256', 'productionDependencyFileTreeSha256', 'productionDependencyModeTreeSha256', 'productionDependencyDirectoryModeTreeSha256',
    'productionDependencyFileModePolicy', 'productionDependencyDirectoryModePolicy', 'productionDependencyPackageCount', 'productionDependencyFileCount', 'productionDependencyModeRecordCount', 'productionDependencyDirectoryCount', 'productionDependencyDirectoryModeRecordCount',
    'gitPayloadModeTreeSha256', 'gitPayloadModeRecordCount',
    'electronDistributionTreeSha256', 'electronDistributionFileCount', 'electronDistributionModeBoundFileCount',
    'nodeRuntimeVersion', 'nodeRuntimeExecutablePath', 'nodeRuntimeExecutableSha256', 'nodeRuntimeTreeSha256', 'nodeRuntimeFileCount', 'nodeRuntimeModeBoundFileCount',
    'nativeBinaryScanSha256', 'nativeBinaryFileCount', 'nativeBinaryFailureCount', 'nativeBinaryTargetPlatform', 'nativeBinaryTargetArch',
    'installerFileName', 'installerSizeBytes', 'installerSha256',
    'upstreamBindings', 'inheritedRiskAcceptances', 'finalInstallationMode',
    'legacyTestDataMigrationRequired', 'legacyTestVersionRollbackRequired',
    'completeProjectSourceTreeSha256'
  ];
  return Object.fromEntries(keys.map((key) => [key, document[key]]));
}

function assertUpstreamBindings(document) {
  const actual = document.upstreamBindings || {};
  for (const [wp, expected] of Object.entries(UPSTREAM_ACCEPTED_BINDINGS)) {
    const observed = actual[wp];
    if (!observed) throw new Wp7Error('WP7_ACCEPTANCE_EVIDENCE_SCHEMA_INVALID', `missing ${wp} upstream binding`);
    for (const [key, value] of Object.entries(expected)) {
      if (JSON.stringify(observed[key]) !== JSON.stringify(value)) {
        throw new Wp7Error('WP7_ACCEPTANCE_EVIDENCE_SCHEMA_INVALID', `${wp}.${key} upstream binding mismatch`, { expected: value, actual: observed[key] });
      }
    }
  }
}

function validateSpecialized(relativePath, document) {
  if (relativePath === 'evidence/wp7/clean-install.json') validateCleanInstallEvidence(document);
  if (relativePath === 'evidence/wp7/boot-failure-diagnostics.json') validateBootFailureDiagnostics(document);
  if (relativePath === 'evidence/wp7/preinstall-installer-sha256.json') {
    if (document.installerSha256VerifiedImmediatelyBeforeInstall !== true || document.observedInstallerSha256 !== document.installerSha256) {
      throw new Wp7Error('WP7_PREINSTALL_INSTALLER_SHA256_MISMATCH', 'preinstall installer hash evidence mismatch');
    }
  }
  if (relativePath === 'evidence/wp7/full-source-delivery-closure.json') {
    const required = ['finalDeliveryHead', 'finalDeliveryTree', 'trackedFileCount', 'sourceZipFileCount', 'missingFiles', 'extraFiles', 'mismatchedFiles', 'duplicatePaths', 'bundleAncestryIncludesWp6AcceptedHead', 'sourceZipSha256', 'bundleSha256'];
    const missing = required.filter((key) => document[key] === undefined);
    if (missing.length) throw new Wp7Error('WP7_COMPLETE_PROJECT_SOURCE_REQUIRED', 'full-source delivery closure fields missing', { missing });
    if (document.missingFiles !== 0 || document.extraFiles !== 0 || document.mismatchedFiles !== 0 || document.duplicatePaths !== 0 || document.bundleAncestryIncludesWp6AcceptedHead !== true || document.wp0ImmutableTagIncluded !== true) {
      throw new Wp7Error('WP7_COMPLETE_PROJECT_SOURCE_REQUIRED', 'full-source delivery closure did not pass');
    }
    if (!SHA256_RE.test(document.sourceZipSha256) || !SHA256_RE.test(document.bundleSha256)) throw new Wp7Error('WP7_COMPLETE_PROJECT_SOURCE_REQUIRED', 'full-source delivery hashes invalid');
  }
  if (relativePath === 'evidence/wp7/upstream-contract-binding.json') assertUpstreamBindings(document);
  if (document.platform !== 'win32' || document.actualPlatform !== 'win32' || document.fixtureMode !== false) {
    throw new Wp7Error('WP7_FINAL_WINDOWS_EVIDENCE_PROVENANCE_BYPASS', 'final child evidence is not bound to actual non-fixture Windows execution', { relativePath });
  }
  if (!document.provenance || document.provenance.callerSuppliedObservations !== false || document.provenance.callerSuppliedTestResults !== false || !Array.isArray(document.provenance.commandIds) || !document.provenance.commandIds.length) {
    throw new Wp7Error('WP7_FINAL_WINDOWS_EVIDENCE_PROVENANCE_BYPASS', 'final child evidence provenance is incomplete', { relativePath });
  }
  if (document.status !== 'PASS') throw new Wp7Error('WP7_ACCEPTANCE_EVIDENCE_SCHEMA_INVALID', 'final evidence document is not PASS', { relativePath, status: document.status });
}

function runnerResultDocument(filePath, expectedMode, context) {
  const absolute = path.resolve(filePath || '');
  if (!filePath || !fs.existsSync(absolute)) throw new Wp7Error('WP7_FINAL_REPEAT_TESTS_NOT_BOUND_TO_FINAL_ARTIFACTS', `${expectedMode} runner result is missing`, { absolute });
  const document = readJson(absolute);
  if (document.documentType !== 'WP7_FINAL_REQUIRED_TEST_RESULTS' || document.status !== 'PASS' || document.executionMode !== expectedMode) {
    throw new Wp7Error('WP7_FINAL_REPEAT_TESTS_NOT_BOUND_TO_FINAL_ARTIFACTS', `${expectedMode} runner result is invalid`);
  }
  const identityFields = {
    contextSha256: context.contextSha256,
    buildSessionId: context.buildSessionId,
    installerSha256: context.installerSha256,
    frozenSourceCommit: context.implementationCommit,
    frozenSourceTree: context.implementationSourceTree,
    finalDeliveryHead: context.finalDeliveryHead,
    finalDeliveryTree: context.finalDeliveryTree
  };
  const mismatches = Object.entries(identityFields).filter(([key, value]) => document[key] !== value).map(([key, value]) => ({ key, expected: value, actual: document[key] }));
  if (mismatches.length) throw new Wp7Error('WP7_FINAL_REPEAT_TESTS_NOT_BOUND_TO_FINAL_ARTIFACTS', 'runner result identity differs from final context', { mismatches });
  for (const [testId, result] of Object.entries(document.results || {})) {
    if (result.status !== 'PASS' || result.contextSha256 !== context.contextSha256 || result.installerSha256 !== context.installerSha256 || result.buildSessionId !== context.buildSessionId) {
      throw new Wp7Error('WP7_FINAL_REPEAT_TESTS_NOT_BOUND_TO_FINAL_ARTIFACTS', 'individual final test is not bound to the final context', { testId });
    }
    for (const [pathKey, hashKey] of [['stdoutPath', 'stdoutSha256'], ['stderrPath', 'stderrSha256']]) {
      if (!result[pathKey] || !SHA256_RE.test(result[hashKey] || '') || !fs.existsSync(result[pathKey]) || sha256File(result[pathKey]) !== result[hashKey]) {
        throw new Wp7Error('WP7_FINAL_REPEAT_TESTS_NOT_BOUND_TO_FINAL_ARTIFACTS', 'final test raw output provenance mismatch', { testId, pathKey });
      }
    }
  }
  return { absolute, document, sha256: sha256File(absolute) };
}

function validateFinalTestResults(packagingResults, windowsResults, context) {
  const phaseModel = readJson(PHASE_MODEL_PATH);
  const failures = [];
  const combined = { ...(packagingResults.results || {}), ...(windowsResults.results || {}) };
  for (const id of phaseModel.testAssignments.PRE_REVIEW_AND_FINAL) {
    const result = packagingResults.results?.[id];
    if (!result || result.status !== 'PASS' || result.executionPhase !== 'FINAL' || result.contextSha256 !== context.contextSha256) failures.push(`${id}:FINAL_EXECUTION_REQUIRED`);
  }
  for (const id of phaseModel.testAssignments.FINAL_PACKAGING) {
    const result = packagingResults.results?.[id];
    if (!result || result.status !== 'PASS' || result.executionPhase !== 'FINAL_PACKAGING' || result.contextSha256 !== context.contextSha256) failures.push(`${id}:FINAL_PACKAGING_EXECUTION_REQUIRED`);
  }
  for (const id of phaseModel.testAssignments.FINAL_WINDOWS) {
    const result = windowsResults.results?.[id];
    if (!result || result.status !== 'PASS' || result.executionPhase !== 'FINAL_WINDOWS' || result.contextSha256 !== context.contextSha256) failures.push(`${id}:FINAL_WINDOWS_EXECUTION_REQUIRED`);
  }
  if (failures.length) throw new Wp7Error('WP7_FINAL_REPEAT_TESTS_NOT_BOUND_TO_FINAL_ARTIFACTS', 'final required test results incomplete or not artifact-bound', { failures });
  return { status: 'PASS', requiredCount: Object.keys(combined).length, results: combined };
}

function normalizeRawChild(relativePath, raw, common, rawFilePath) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Wp7Error('WP7_FINAL_EVIDENCE_CLOSURE_INCOMPLETE', 'raw final evidence child is missing', { relativePath });
  if (raw.platform !== 'win32' || raw.actualPlatform !== 'win32' || raw.fixtureMode !== false || raw.evidenceClass !== 'RAW_WINDOWS_PROBE_EVIDENCE') {
    throw new Wp7Error('WP7_FINAL_WINDOWS_EVIDENCE_PROVENANCE_BYPASS', 'raw child is not formal Windows probe evidence', { relativePath });
  }
  const document = {
    ...common,
    ...raw,
    schemaVersion: 3,
    stage: '6.4.5.9',
    phase: 'core-runtime-p1',
    workPackage: 'WP7',
    evidenceClass: 'FINAL_MACHINE_READABLE',
    status: 'PASS',
    upstreamBindings: JSON.parse(JSON.stringify(common.upstreamBindings)),
    inheritedRiskAcceptances: JSON.parse(JSON.stringify(common.inheritedRiskAcceptances)),
    finalInstallationMode: 'CLEAN_INSTALL',
    legacyTestDataMigrationRequired: false,
    legacyTestVersionRollbackRequired: false,
    rawEvidenceReference: { path: rawFilePath, sha256: sha256File(rawFilePath) }
  };
  validateEvidenceCommon(document, { final: true });
  assertUpstreamBindings(document);
  validateSpecialized(relativePath, document);
  return document;
}

function buildAcceptanceAggregate({ common, outputRoot, testResults, generatedDocuments, context, packagingResultRef, windowsResultRef }) {
  const mappingDocument = readJson(ACCEPTANCE_MAPPING_PATH);
  validateAcceptanceMapping(mappingDocument);
  const items = mappingDocument.acceptanceChecks || mappingDocument.acceptanceCheckMapping;
  const acceptanceResults = items.map((item) => {
    const evidenceReferences = item.requiredEvidenceFiles
      .filter((relativePath) => relativePath !== AGGREGATE_PATH)
      .map((relativePath) => {
        const absolute = path.resolve(outputRoot, ...relativePath.split('/'));
        if (!fs.existsSync(absolute)) throw new Wp7Error('WP7_FINAL_EVIDENCE_CLOSURE_INCOMPLETE', 'acceptance child evidence missing', { acceptanceId: item.acceptanceId, relativePath });
        return { path: relativePath, sha256: sha256File(absolute) };
      });
    validateEvidenceReferences(evidenceReferences, { final: true, rootDir: outputRoot });
    const requiredTestResults = item.requiredTestIds.map((id) => ({ testId: id, ...testResults[id] }));
    if (requiredTestResults.some((result) => result.status !== 'PASS' || result.contextSha256 !== context.contextSha256)) {
      throw new Wp7Error('WP7_ACCEPTANCE_EVIDENCE_SCHEMA_INVALID', 'acceptance test result is not final-context-bound PASS', { acceptanceId: item.acceptanceId });
    }
    return { ...item, status: 'PASS', requiredTestResults, evidenceReferences };
  });
  const childEvidenceReferences = finalOutputs()
    .filter((relativePath) => relativePath !== AGGREGATE_PATH)
    .map((relativePath) => ({ path: relativePath, sha256: sha256File(path.resolve(outputRoot, ...relativePath.split('/'))) }));
  validateEvidenceReferences(childEvidenceReferences, { final: true, rootDir: outputRoot });
  const aggregate = {
    ...common,
    schemaVersion: 3,
    documentType: 'PHASE1_ACCEPTANCE_EVIDENCE',
    stage: '6.4.5.9', phase: 'core-runtime-p1', workPackage: 'WP7',
    evidenceKind: 'PHASE1_ACCEPTANCE_AGGREGATE', evidenceClass: 'FINAL_MACHINE_READABLE', status: 'PASS',
    platform: 'win32', actualPlatform: 'win32', fixtureMode: false,
    assertions: ['A01_A10_COMPLETE', 'ALL_CHILDREN_SHA256_PINNED', 'ONE_FINAL_IDENTITY_TUPLE', 'NO_DEVELOPMENT_EVIDENCE_REFERENCES', 'TEST_RESULTS_RUNNER_GENERATED', 'RAW_WINDOWS_PROVENANCE_BOUND'],
    reasonCodes: [],
    provenance: { source: 'WP7_FINAL_EVIDENCE_ASSEMBLER', actualHostPlatform: 'win32', commandIds: ['FINAL_PACKAGING_TEST_RUNNER', 'FINAL_WINDOWS_TEST_RUNNER'], callerSuppliedObservations: false, callerSuppliedTestResults: false },
    finalExecutionContextSha256: context.contextSha256,
    finalPackagingTestResultReference: packagingResultRef,
    finalWindowsTestResultReference: windowsResultRef,
    acceptanceResults,
    childEvidenceReferences
  };
  validateEvidenceCommon(aggregate, { final: true });
  assertUpstreamBindings(aggregate);
  const ids = aggregate.acceptanceResults.map((item) => item.acceptanceId);
  if (JSON.stringify(ids) !== JSON.stringify(Array.from({ length: 10 }, (_, i) => `A${String(i + 1).padStart(2, '0')}`))) {
    throw new Wp7Error('WP7_ACCEPTANCE_EVIDENCE_SCHEMA_INVALID', 'A01-A10 aggregate mapping incomplete', { ids });
  }
  validateCrossFileIdentity({ aggregate, ...generatedDocuments });
  return aggregate;
}

function generateFinalEvidenceSet(options = {}) {
  if (options.observations !== undefined || options.testResults !== undefined) {
    throw new Wp7Error('WP7_FINAL_WINDOWS_EVIDENCE_PROVENANCE_BYPASS', 'caller-supplied observations/testResults are forbidden');
  }
  const outputRoot = path.resolve(options.outputRoot || '');
  if (!options.outputRoot) throw new Wp7Error('WP7_FINAL_EVIDENCE_CLOSURE_INCOMPLETE', 'outputRoot is required');
  if (fs.existsSync(outputRoot) && fs.readdirSync(outputRoot).length) throw new Wp7Error('WP7_FINAL_EVIDENCE_CLOSURE_INCOMPLETE', 'final evidence output root must start empty', { outputRoot });
  fs.mkdirSync(outputRoot, { recursive: true });
  const context = readFinalExecutionContext(path.resolve(options.contextPath || ''), { mode: 'ALL_FINAL' });
  const packaging = runnerResultDocument(options.finalPackagingResultsPath, 'FINAL_PACKAGING', context);
  const windows = runnerResultDocument(options.finalWindowsResultsPath, 'FINAL_WINDOWS', context);
  const validatedTests = validateFinalTestResults(packaging.document, windows.document, context);
  const finalReleaseEvidence = context.finalReleaseEvidence;
  validateEvidenceCommon(finalReleaseEvidence, { final: true });
  assertUpstreamBindings(finalReleaseEvidence);
  const common = commonIdentity(finalReleaseEvidence);
  const generatedDocuments = {};

  for (const relativePath of finalOutputs()) {
    if (relativePath === AGGREGATE_PATH) continue;
    const absolute = path.resolve(outputRoot, ...relativePath.split('/'));
    let document;
    if (relativePath === FINAL_RELEASE_PATH) {
      document = {
        ...finalReleaseEvidence,
        platform: 'win32', actualPlatform: 'win32', fixtureMode: false,
        provenance: { source: 'WP7_SEALED_FINAL_BUILD', actualHostPlatform: 'win32', commandIds: ['FINAL_BUILD'], callerSuppliedObservations: false, callerSuppliedTestResults: false }
      };
      validateEvidenceCommon(document, { final: true });
    } else {
      const rawPath = path.resolve(context.rawWindowsEvidenceRoot, ...relativePath.split('/'));
      if (!fs.existsSync(rawPath)) throw new Wp7Error('WP7_FINAL_EVIDENCE_CLOSURE_INCOMPLETE', 'raw Windows child evidence is missing', { relativePath });
      document = normalizeRawChild(relativePath, readJson(rawPath), common, rawPath);
    }
    writeCanonicalJson(absolute, document);
    generatedDocuments[relativePath] = document;
  }
  validateCrossFileIdentity(generatedDocuments);
  const packagingResultRef = { path: packaging.absolute, sha256: packaging.sha256 };
  const windowsResultRef = { path: windows.absolute, sha256: windows.sha256 };
  const aggregate = buildAcceptanceAggregate({ common, outputRoot, testResults: validatedTests.results, generatedDocuments, context, packagingResultRef, windowsResultRef });
  writeCanonicalJson(path.resolve(outputRoot, ...AGGREGATE_PATH.split('/')), aggregate);
  const report = validateFinalEvidenceDirectory(outputRoot);
  return { status: 'PASS', outputRoot, aggregatePath: path.resolve(outputRoot, ...AGGREGATE_PATH.split('/')), report, contextSha256: context.contextSha256 };
}

function validateFinalEvidenceDirectory(rootDir) {
  const root = path.resolve(rootDir);
  const documents = {};
  const missing = [];
  for (const relativePath of finalOutputs()) {
    const absolute = path.resolve(root, ...relativePath.split('/'));
    if (!fs.existsSync(absolute)) { missing.push(relativePath); continue; }
    const document = readJson(absolute);
    validateEvidenceCommon(document, { final: true });
    assertUpstreamBindings(document);
    if (relativePath !== AGGREGATE_PATH) validateSpecialized(relativePath, document);
    documents[relativePath] = document;
  }
  if (missing.length) throw new Wp7Error('WP7_FINAL_EVIDENCE_CLOSURE_INCOMPLETE', 'final evidence outputs missing', { missing });
  validateCrossFileIdentity(documents);
  const aggregate = documents[AGGREGATE_PATH];
  if (aggregate.platform !== 'win32' || aggregate.actualPlatform !== 'win32' || aggregate.fixtureMode !== false) throw new Wp7Error('WP7_FINAL_WINDOWS_EVIDENCE_PROVENANCE_BYPASS', 'aggregate platform/fixture binding is invalid');
  const ids = aggregate.acceptanceResults?.map((item) => item.acceptanceId) || [];
  if (ids.length !== 10 || new Set(ids).size !== 10) throw new Wp7Error('WP7_ACCEPTANCE_EVIDENCE_SCHEMA_INVALID', 'aggregate acceptance IDs incomplete', { ids });
  validateEvidenceReferences(aggregate.childEvidenceReferences, { final: true, rootDir: root });
  for (const result of aggregate.acceptanceResults) validateEvidenceReferences(result.evidenceReferences, { final: true, rootDir: root });
  return { status: 'PASS', outputCount: finalOutputs().length, acceptanceCount: ids.length, identity: commonIdentity(aggregate) };
}

module.exports = {
  AGGREGATE_PATH,
  FINAL_RELEASE_PATH,
  finalOutputs,
  commonIdentity,
  assertUpstreamBindings,
  validateFinalTestResults,
  generateFinalEvidenceSet,
  validateFinalEvidenceDirectory
};
