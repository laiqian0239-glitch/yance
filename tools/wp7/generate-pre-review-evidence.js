#!/usr/bin/env node
'use strict';

const { optionValue } = require('./cli-options');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  REPO_ROOT,
  gitIdentity,
  assertActivationBinding,
  assertWp6Binding,
  verifyRuntimeProtocolConvergence,
  validateAllGovernance,
  writeCanonicalJson,
  RISK_IDS
} = require('./lib');
const {
  ARTIFACT_CLASS,
  EVIDENCE_CLASS,
  SEALED_ARTIFACT_TYPE,
  readAndVerifyPreReviewSealedArtifact
} = require('./pre-review-sealed-artifact');
const {
  normalizeRelativePath,
  sha256File,
  validateNineProbeRawEvidence,
  walkRegularFiles
} = require('./pre-review-evidence-package');

const ENV_BY_ARGUMENT = Object.freeze({
  '--probe-output-dir': 'WP7_PROBE_OUTPUT_DIR',
  '--nine-probe-result': 'WP7_NINE_PROBE_RESULT',
  '--pre-review-sealed-artifact': 'WP7_PRE_REVIEW_SEALED_ARTIFACT',
  '--trusted-product-archive': 'WP7_TRUSTED_PRODUCT_ARCHIVE',
  '--electron-archive': 'WP7_ELECTRON_RELEASE_ARCHIVE',
  '--build-json': 'WP7_PRE_REVIEW_BUILD_JSON',
  '--verification-root': 'WP7_PRE_REVIEW_VERIFICATION_ROOT',
  '--output-dir': 'WP7_PRE_REVIEW_EVIDENCE_OUTPUT'
});
function arg(name, fallback = null) { return optionValue(name, { envName: ENV_BY_ARGUMENT[name], fallback }); }
function fail(reasonCode, message, details = {}) {
  const error = new Error(message);
  error.reasonCode = reasonCode;
  error.details = details;
  throw error;
}
function assertRegular(filePath, reasonCode, label) {
  const absolute = path.resolve(String(filePath || ''));
  if (!filePath || !path.isAbsolute(String(filePath)) || !fs.existsSync(absolute)) fail(reasonCode, `${label} must be an existing absolute file`, { filePath: absolute });
  const stat = fs.lstatSync(absolute);
  if (!stat.isFile() || stat.isSymbolicLink()) fail(reasonCode, `${label} must be a regular non-symlink file`, { filePath: absolute });
  return fs.realpathSync(absolute);
}
function assertDirectory(directoryPath, reasonCode, label) {
  const absolute = path.resolve(String(directoryPath || ''));
  if (!directoryPath || !path.isAbsolute(String(directoryPath)) || !fs.existsSync(absolute)) fail(reasonCode, `${label} must be an existing absolute directory`, { directoryPath: absolute });
  const stat = fs.lstatSync(absolute);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail(reasonCode, `${label} must be a real non-symlink directory`, { directoryPath: absolute });
  return fs.realpathSync(absolute);
}
function readJson(filePath, reasonCode, label) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch (error) { fail(reasonCode, `${label} is not valid JSON`, { filePath, message: error.message }); }
}
function copyFile(source, destination) {
  const stat = fs.lstatSync(source);
  if (!stat.isFile() || stat.isSymbolicLink()) fail('WP7_PRE_REVIEW_EVIDENCE_INPUT_INVALID', 'evidence input is not a regular non-symlink file', { source });
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
  fs.chmodSync(destination, 0o600);
}
function copyTree(sourceRoot, destinationRoot) {
  fs.mkdirSync(destinationRoot, { recursive: true });
  function visit(source, destination) {
    for (const entry of fs.readdirSync(source, { withFileTypes: true }).sort((a, b) => Buffer.from(a.name).compare(Buffer.from(b.name)))) {
      const sourcePath = path.join(source, entry.name);
      const destinationPath = path.join(destination, entry.name);
      const stat = fs.lstatSync(sourcePath);
      if (stat.isSymbolicLink()) fail('WP7_PRE_REVIEW_EVIDENCE_INPUT_INVALID', 'evidence input tree contains a symlink', { sourcePath });
      if (stat.isDirectory()) {
        fs.mkdirSync(destinationPath, { recursive: true });
        visit(sourcePath, destinationPath);
      } else if (stat.isFile()) copyFile(sourcePath, destinationPath);
      else fail('WP7_PRE_REVIEW_EVIDENCE_INPUT_INVALID', 'evidence input tree contains an unsupported filesystem object', { sourcePath });
    }
  }
  visit(sourceRoot, destinationRoot);
}
function artifactRecord(packageRoot, relativePath, artifactClass, extra = {}) {
  const normalized = normalizeRelativePath(relativePath, 'artifact.path');
  const absolute = path.join(packageRoot, ...normalized.split('/'));
  const stat = fs.lstatSync(absolute);
  if (!stat.isFile() || stat.isSymbolicLink()) fail('WP7_PRE_REVIEW_EVIDENCE_INDEX_INVALID', 'indexed artifact is not a regular file', { path: normalized });
  return { path: normalized, artifactClass, sizeBytes: stat.size, sha256: sha256File(absolute), ...extra };
}
function assertIdentity(document, expected, reasonCode, label) {
  const mismatches = Object.entries(expected).filter(([, value]) => value !== undefined).filter(([field, value]) => document[field] !== value).map(([field, value]) => ({ field, expected: value, actual: document[field] }));
  if (mismatches.length) fail(reasonCode, `${label} identity mismatch`, { mismatches });
}
function internalHashLines(root, excludedRelativePath) {
  return walkRegularFiles(root).filter((row) => row.path !== excludedRelativePath).map((row) => `${row.sha256}  ${row.path}`).sort();
}

const outputRoot = path.resolve(arg('--output-dir', path.join(os.tmpdir(), `yance-wp7-pre-review-evidence-${process.pid}`)));
const probeOutputRootInput = arg('--probe-output-dir');
const aggregateInput = arg('--nine-probe-result');
const sealedArtifactInput = arg('--pre-review-sealed-artifact');
const trustedProductArchiveInput = arg('--trusted-product-archive');
const electronArchiveInput = arg('--electron-archive');
const buildJsonInput = arg('--build-json');
const verificationRootInput = arg('--verification-root');
const generatedAtUtc = arg('--generated-at-utc', new Date().toISOString());

try {
  if (fs.existsSync(outputRoot) && fs.readdirSync(outputRoot).length) fail('WP7_EVIDENCE_OUTPUT_NOT_EMPTY', 'evidence output directory must be empty', { outputRoot });
  fs.mkdirSync(outputRoot, { recursive: true });
  const identity = gitIdentity(REPO_ROOT);
  assertActivationBinding(REPO_ROOT, { identity, requireClean: true, requireBranch: true });
  const wp6 = assertWp6Binding();
  const protocol = verifyRuntimeProtocolConvergence();
  const governance = validateAllGovernance();

  const probeOutputRoot = assertDirectory(probeOutputRootInput, 'WP7_TRUSTED_PRODUCT_RAW_PROBE_EVIDENCE_MISSING', 'nine-probe raw output directory');
  const aggregatePath = assertRegular(aggregateInput, 'WP7_TRUSTED_PRODUCT_RAW_PROBE_EVIDENCE_MISSING', 'nine-probe aggregate result');
  const sealedArtifactPath = assertRegular(sealedArtifactInput, 'WP7_PRE_REVIEW_SEALED_ARTIFACT_MISSING', 'Pre-Review sealed artifact');
  const trustedProductArchivePath = assertRegular(trustedProductArchiveInput, 'WP7_CANDIDATE_REQUIRED_DELIVERY_ARTIFACTS_MISSING', 'trusted product archive');
  const electronArchivePath = assertRegular(electronArchiveInput, 'WP7_CANDIDATE_REQUIRED_DELIVERY_ARTIFACTS_MISSING', 'official Electron archive');
  const buildJsonPath = assertRegular(buildJsonInput, 'WP7_CANDIDATE_REQUIRED_DELIVERY_ARTIFACTS_MISSING', 'trusted product build identity');
  const verificationRoot = assertDirectory(verificationRootInput, 'WP7_COMPLETE_TEST_RAW_RESULTS_MISSING', 'complete verification output');

  if (path.dirname(aggregatePath) !== probeOutputRoot) fail('WP7_TRUSTED_PRODUCT_RAW_PROBE_EVIDENCE_INVALID', 'nine-probe aggregate must be located at the raw probe output root', { aggregatePath, probeOutputRoot });
  const sourceValidation = validateNineProbeRawEvidence({ evidenceRoot: probeOutputRoot, aggregateRelativePath: path.basename(aggregatePath), sealedArtifactPath });
  const aggregate = sourceValidation.aggregate;
  assertIdentity(aggregate, { sourceCommit: identity.sourceCommit, sourceTree: identity.sourceTree }, 'WP7_TRUSTED_PRODUCT_RAW_PROBE_EVIDENCE_INVALID', 'nine-probe aggregate');
  const seal = readAndVerifyPreReviewSealedArtifact(sealedArtifactPath, { buildSessionId: aggregate.buildSessionId, buildId: aggregate.buildId, sourceCommit: identity.sourceCommit, sourceTree: identity.sourceTree });
  const build = readJson(buildJsonPath, 'WP7_CANDIDATE_REQUIRED_DELIVERY_ARTIFACTS_MISSING', 'trusted product build identity');
  assertIdentity(build, {
    documentType: 'WP7_PRE_REVIEW_TRUSTED_PRODUCT_BUILD',
    status: 'PASS',
    artifactClass: ARTIFACT_CLASS,
    finalReleaseEvidence: false,
    formalWindowsEvidenceEligible: false,
    sourceCommit: identity.sourceCommit,
    sourceTree: identity.sourceTree,
    buildSessionId: aggregate.buildSessionId,
    buildId: aggregate.buildId,
    releaseManifestSha256: aggregate.releaseManifestSha256,
    applicationPayloadSha256: aggregate.applicationPayloadSha256,
    applicationPayloadFilesystemIdentitySha256: aggregate.applicationPayloadFilesystemIdentitySha256,
    payloadFilesSha256: aggregate.payloadFilesSha256,
    electronDistributionTreeSha256: aggregate.electronDistributionTreeSha256,
    nodeRuntimeTreeSha256: aggregate.nodeRuntimeTreeSha256,
    nativeBinaryScanSha256: aggregate.nativeBinaryScanSha256
  }, 'WP7_PRE_REVIEW_BUILD_IDENTITY_INVALID', 'trusted product build document');
  if (sha256File(electronArchivePath) !== aggregate.electronReleaseArchiveSha256) fail('WP7_OFFICIAL_ELECTRON_ARCHIVE_IDENTITY_MISMATCH', 'official Electron archive SHA256 does not match the nine-probe aggregate');

  const verificationSummaryPath = path.join(verificationRoot, 'WP7_PRE_REVIEW_VERIFICATION_SUMMARY.json');
  const verificationResultsRoot = path.join(verificationRoot, 'results');
  const verificationSummary = readJson(assertRegular(verificationSummaryPath, 'WP7_COMPLETE_TEST_RAW_RESULTS_MISSING', 'verification summary'), 'WP7_COMPLETE_TEST_RAW_RESULTS_MISSING', 'verification summary');
  if (verificationSummary.status !== 'PASS' || !Array.isArray(verificationSummary.commands) || verificationSummary.commands.some((row) => row.status !== 'PASS')) fail('WP7_COMPLETE_TEST_RAW_RESULTS_MISSING', 'verification summary does not prove a complete PASS test set', { status: verificationSummary.status, failed: verificationSummary.commands?.filter((row) => row.status !== 'PASS') });
  assertIdentity(verificationSummary, { sourceCommit: identity.sourceCommit, sourceTree: identity.sourceTree, repositoryClean: true }, 'WP7_COMPLETE_TEST_RAW_RESULTS_MISSING', 'verification summary');
  assertDirectory(verificationResultsRoot, 'WP7_COMPLETE_TEST_RAW_RESULTS_MISSING', 'verification raw results directory');
  for (const command of verificationSummary.commands) {
    if (!command.name || command.status !== 'PASS') fail('WP7_COMPLETE_TEST_RAW_RESULTS_MISSING', 'verification command record is incomplete', { command });
    if (command.executionModel === 'ONE_NODE_TEST_PROCESS_PER_FILE') {
      const summaryPath = path.join(verificationResultsRoot, `${command.name}.summary.json`);
      assertRegular(summaryPath, 'WP7_COMPLETE_TEST_RAW_RESULTS_MISSING', `${command.name} summary`);
    } else {
      assertRegular(path.join(verificationResultsRoot, `${command.name}.stdout.log`), 'WP7_COMPLETE_TEST_RAW_RESULTS_MISSING', `${command.name} stdout`);
      assertRegular(path.join(verificationResultsRoot, `${command.name}.stderr.log`), 'WP7_COMPLETE_TEST_RAW_RESULTS_MISSING', `${command.name} stderr`);
    }
  }

  const artifactRoot = path.join(outputRoot, 'artifacts');
  const sealDestination = path.join(artifactRoot, 'pre-review-seal', 'WP7_PRE_REVIEW_SEALED_ARTIFACT.json');
  const productDestination = path.join(artifactRoot, 'trusted-product', path.basename(trustedProductArchivePath));
  const electronDestination = path.join(artifactRoot, 'official-electron', path.basename(electronArchivePath));
  const buildDestination = path.join(artifactRoot, 'build', 'WP7_PRE_REVIEW_TRUSTED_PRODUCT_BUILD.json');
  copyFile(sealedArtifactPath, sealDestination);
  copyFile(trustedProductArchivePath, productDestination);
  copyFile(electronArchivePath, electronDestination);
  copyFile(buildJsonPath, buildDestination);

  const rawProbeRoot = path.join(outputRoot, 'raw-probes');
  copyTree(probeOutputRoot, rawProbeRoot);
  const copiedSeal = readAndVerifyPreReviewSealedArtifact(sealDestination, { buildSessionId: aggregate.buildSessionId, buildId: aggregate.buildId, sourceCommit: identity.sourceCommit, sourceTree: identity.sourceTree });
  const copiedRawValidation = validateNineProbeRawEvidence({ evidenceRoot: rawProbeRoot, aggregateRelativePath: path.basename(aggregatePath), sealedArtifactPath: sealDestination });
  if (copiedRawValidation.aggregateSha256 !== sourceValidation.aggregateSha256 || copiedSeal.sha256 !== seal.sha256) fail('WP7_PRE_REVIEW_EVIDENCE_COPY_MISMATCH', 'copied raw evidence or seal differs from its validated source');

  const rawTestRoot = path.join(outputRoot, 'raw-tests');
  copyTree(verificationRoot, rawTestRoot);
  const copiedVerification = readJson(path.join(rawTestRoot, 'WP7_PRE_REVIEW_VERIFICATION_SUMMARY.json'), 'WP7_COMPLETE_TEST_RAW_RESULTS_MISSING', 'copied verification summary');
  assertIdentity(copiedVerification, { status: 'PASS', sourceCommit: identity.sourceCommit, sourceTree: identity.sourceTree, repositoryClean: true }, 'WP7_COMPLETE_TEST_RAW_RESULTS_MISSING', 'copied verification summary');

  const common = (documentType, evidenceKind) => ({
    schemaVersion: 4,
    documentType,
    stage: '6.4.5.9',
    phase: 'core-runtime-p1',
    workPackage: 'WP7',
    evidenceKind,
    evidenceClass: EVIDENCE_CLASS,
    artifactClass: ARTIFACT_CLASS,
    status: 'PASS',
    generatedAtUtc,
    frozenSourceCommit: identity.sourceCommit,
    frozenSourceTree: identity.sourceTree,
    buildSessionId: aggregate.buildSessionId,
    buildId: aggregate.buildId,
    preReviewSealedArtifactSha256: seal.sha256,
    preReviewSealedArtifactType: SEALED_ARTIFACT_TYPE,
    trustedProductArchiveSha256: sha256File(trustedProductArchivePath),
    electronReleaseArchiveSha256: aggregate.electronReleaseArchiveSha256,
    releaseManifestSha256: aggregate.releaseManifestSha256,
    applicationPayloadSha256: aggregate.applicationPayloadSha256,
    applicationPayloadFilesystemIdentitySha256: aggregate.applicationPayloadFilesystemIdentitySha256,
    payloadFilesSha256: aggregate.payloadFilesSha256,
    nativeBinaryScanSha256: aggregate.nativeBinaryScanSha256,
    nativeBinaryFileCount: aggregate.nativeBinaryFileCount,
    nativeBinaryFailureCount: aggregate.nativeBinaryFailureCount,
    nativeBinaryTargetPlatform: aggregate.nativeBinaryTargetPlatform,
    nativeBinaryTargetArch: aggregate.nativeBinaryTargetArch,
    upstreamBindings: {
      wp6AcceptedFinalDeliveryHead: wp6.wp6AcceptedHead,
      wp6AcceptedFinalSourceTree: wp6.wp6AcceptedTree,
      activationIdentityBindingCommit: '4ac6d2185bed28823210849704f3850cd875b5fb',
      activationBindingSourceTree: 'd7f64dbf602ded1075978c13bea8449d7ef7e5e2'
    },
    inheritedRiskAcceptances: RISK_IDS.map((id) => ({ id, status: 'INHERITED', scopeExpansionAllowed: false })),
    finalInstaller: false,
    finalReleaseEvidence: false,
    formalWindowsEvidenceEligible: false,
    assertions: [],
    reasonCodes: []
  });
  const evidenceRoot = path.join(outputRoot, 'evidence', 'wp7', 'pre-review');
  const docs = {
    'source-freeze.json': { ...common('WP7_PRE_REVIEW_SOURCE_FREEZE', 'SOURCE_FREEZE'), assertions: ['repositoryClean', 'activationBindingAncestor', 'authorizedBranch'], sourceCommit: identity.sourceCommit, sourceTree: identity.sourceTree, repositoryClean: identity.repositoryClean, branch: identity.branch },
    'upstream-contract-binding.json': { ...common('WP7_PRE_REVIEW_UPSTREAM_BINDING', 'UPSTREAM_BINDING'), assertions: ['WP6_ACCEPTED', 'WP7_ACTIVATION_ACCEPTED', 'WP7_DESIGN_GATE_CONFIRMED'], wp6 },
    'protocol-version-binding.json': { ...common('WP7_PRE_REVIEW_PROTOCOL_BINDING', 'PROTOCOL_BINDING'), assertions: ['credentialProtocolVersion=3'], protocol },
    'build-identity.json': { ...common('WP7_PRE_REVIEW_BUILD_IDENTITY', 'BUILD_IDENTITY'), assertions: ['electron=backend=installerReceipt=diagnostics', 'preReviewSealVerified'], consumers: ['electron','backend','installerReceipt','diagnostics'] },
    'build-session-integrity.json': { ...common('WP7_PRE_REVIEW_BUILD_SESSION_INTEGRITY', 'BUILD_SESSION'), assertions: ['actualSealFileVerified', 'nineProbeFreshSetSameSession'], rawProbeAggregateSha256: copiedRawValidation.aggregateSha256 },
    'trusted-product-identity.json': { ...common('WP7_PRE_REVIEW_TRUSTED_PRODUCT_IDENTITY', 'TRUSTED_PRODUCT'), assertions: ['officialElectronBound', 'node22Bound', 'dependencyTreeBound', 'payloadFilesystemBound'], productExecutableSha256: aggregate.productExecutableSha256, electronDistributionTreeSha256: aggregate.electronDistributionTreeSha256, nodeRuntimeTreeSha256: aggregate.nodeRuntimeTreeSha256, productionDependencyFileTreeSha256: aggregate.productionDependencyFileTreeSha256, nativeBinaryScanSha256: aggregate.nativeBinaryScanSha256, nativeBinaryFileCount: aggregate.nativeBinaryFileCount, nativeBinaryFailureCount: aggregate.nativeBinaryFailureCount },
    'raw-probe-evidence-closure.json': { ...common('WP7_PRE_REVIEW_RAW_PROBE_EVIDENCE_CLOSURE', 'RAW_PROBE_EVIDENCE'), assertions: ['9/9 raw result JSON', '9/9 stdout', '9/9 stderr', '9/9 process custody', '9/9 execution context', 'offline pre-main proof'], executedProbeCount: aggregate.executedProbeCount, rawProbeArtifactCount: copiedRawValidation.artifactRecords.length },
    'governance-validation.json': { ...common('WP7_PRE_REVIEW_GOVERNANCE_VALIDATION', 'GOVERNANCE'), assertions: ['A01-A10 mapped', 'WS01-WS10 traceable', 'noPreAcceptanceClaim', 'noFinalPackagingAuthorization'], governance }
  };
  const supportingEvidence = [];
  for (const [name, document] of Object.entries(docs)) {
    const target = path.join(evidenceRoot, name);
    writeCanonicalJson(target, document);
    supportingEvidence.push(artifactRecord(outputRoot, `evidence/wp7/pre-review/${name}`, 'SUPPORTING_EVIDENCE'));
  }

  const rawProbeArtifacts = walkRegularFiles(rawProbeRoot, 'raw-probes').map((row) => ({ ...row, artifactClass: 'RAW_TRUSTED_PRODUCT_PROBE_EVIDENCE' }));
  const rawTestArtifacts = walkRegularFiles(rawTestRoot, 'raw-tests').map((row) => ({ ...row, artifactClass: 'RAW_TEST_RESULT' }));
  if (!rawTestArtifacts.length) fail('WP7_COMPLETE_TEST_RAW_RESULTS_MISSING', 'no raw test result files were copied');
  const deliveryArtifacts = [
    artifactRecord(outputRoot, 'artifacts/pre-review-seal/WP7_PRE_REVIEW_SEALED_ARTIFACT.json', 'PRE_REVIEW_SEALED_ARTIFACT'),
    artifactRecord(outputRoot, `artifacts/trusted-product/${path.basename(trustedProductArchivePath)}`, 'TRUSTED_PRODUCT_ARCHIVE'),
    artifactRecord(outputRoot, `artifacts/official-electron/${path.basename(electronArchivePath)}`, 'OFFICIAL_ELECTRON_ARCHIVE'),
    artifactRecord(outputRoot, 'artifacts/build/WP7_PRE_REVIEW_TRUSTED_PRODUCT_BUILD.json', 'TRUSTED_PRODUCT_BUILD_IDENTITY')
  ];

  const index = {
    schemaVersion: 2,
    documentType: 'WP7_PRE_REVIEW_EVIDENCE_INDEX',
    status: 'PASS',
    generatedAtUtc,
    stage: '6.4.5.9',
    workPackage: 'WP7',
    artifactClass: ARTIFACT_CLASS,
    evidenceClass: EVIDENCE_CLASS,
    finalInstaller: false,
    finalReleaseEvidence: false,
    formalWindowsEvidenceEligible: false,
    sourceCommit: identity.sourceCommit,
    sourceTree: identity.sourceTree,
    buildSessionId: aggregate.buildSessionId,
    buildId: aggregate.buildId,
    preReviewSealedArtifactSha256: seal.sha256,
    preReviewSealedArtifactType: SEALED_ARTIFACT_TYPE,
    trustedProductProbeStatus: 'PASS_9_OF_9',
    executedProbeCount: aggregate.executedProbeCount,
    correctionMatrixExpectedTotal: 128,
    deliveryArtifacts,
    supportingEvidence,
    rawProbeEvidence: {
      aggregatePath: `raw-probes/${path.basename(aggregatePath)}`,
      aggregateSha256: copiedRawValidation.aggregateSha256,
      artifactCount: rawProbeArtifacts.length,
      artifacts: rawProbeArtifacts
    },
    completeTestRawResults: {
      verificationSummaryPath: 'raw-tests/WP7_PRE_REVIEW_VERIFICATION_SUMMARY.json',
      verificationSummarySha256: sha256File(path.join(rawTestRoot, 'WP7_PRE_REVIEW_VERIFICATION_SUMMARY.json')),
      commandCount: verificationSummary.commands.length,
      artifactCount: rawTestArtifacts.length,
      artifacts: rawTestArtifacts
    },
    forbiddenClaims: ['WP7_PREACCEPTED_FOR_FINAL_PACKAGING','WP7_ACCEPTED','STAGE_6_4_5_9_ACCEPTED','PHASE1_ACCEPTED','FORMAL_WINDOWS_RELEASE'],
    preAcceptanceIssued: false,
    finalPackagingAuthorized: false,
    finalWindowsEvidenceExecuted: false,
    finalAcceptanceStatus: 'NOT_ACCEPTED'
  };
  const indexPath = path.join(outputRoot, 'WP7_PRE_REVIEW_EVIDENCE_INDEX.json');
  writeCanonicalJson(indexPath, index);

  const internalHashPath = path.join(outputRoot, 'WP7_PRE_REVIEW_INTERNAL_SHA256.txt');
  fs.writeFileSync(internalHashPath, `${internalHashLines(outputRoot, 'WP7_PRE_REVIEW_INTERNAL_SHA256.txt').join('\n')}\n# Self-hash excluded by policy.\n`, { mode: 0o600 });

  const finalRecords = walkRegularFiles(outputRoot);
  const indexedPaths = new Set([
    ...deliveryArtifacts.map((row) => row.path),
    ...supportingEvidence.map((row) => row.path),
    ...rawProbeArtifacts.map((row) => row.path),
    ...rawTestArtifacts.map((row) => row.path),
    'WP7_PRE_REVIEW_EVIDENCE_INDEX.json',
    'WP7_PRE_REVIEW_INTERNAL_SHA256.txt'
  ]);
  const unindexed = finalRecords.map((row) => row.path).filter((relativePath) => !indexedPaths.has(relativePath));
  if (unindexed.length) fail('WP7_PRE_REVIEW_EVIDENCE_INDEX_INVALID', 'evidence package contains unindexed files', { unindexed });

  process.stdout.write(`${JSON.stringify({
    status: 'PASS',
    outputRoot,
    sourceCommit: identity.sourceCommit,
    sourceTree: identity.sourceTree,
    buildSessionId: aggregate.buildSessionId,
    buildId: aggregate.buildId,
    preReviewSealedArtifactSha256: seal.sha256,
    trustedProductProbeCount: aggregate.executedProbeCount,
    rawProbeArtifactCount: rawProbeArtifacts.length,
    rawTestArtifactCount: rawTestArtifacts.length,
    supportingEvidenceCount: supportingEvidence.length,
    totalFileCount: finalRecords.length,
    evidenceIndexSha256: sha256File(indexPath),
    internalSha256ManifestSha256: sha256File(internalHashPath)
  }, null, 2)}\n`);
} catch (error) {
  process.stdout.write(`${JSON.stringify({ status: 'FAIL', reasonCode: error.reasonCode || 'WP7_PRE_REVIEW_EVIDENCE_GENERATION_FAILED', message: error.message, details: error.details || {} }, null, 2)}\n`);
  process.exit(1);
}
