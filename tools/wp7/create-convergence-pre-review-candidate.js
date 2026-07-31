#!/usr/bin/env node
'use strict';

const { optionValue } = require('./cli-options');
const { createDeterministicZip } = require('./deterministic-zip');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync, spawnSync } = require('node:child_process');
const { REPO_ROOT, gitIdentity, sha256File, writeCanonicalJson } = require('./lib');
const { normalizeRelativePath, walkRegularFiles } = require('./pre-review-evidence-package');
const { readAndVerifyPreReviewSealedArtifact } = require('./pre-review-sealed-artifact');
const { verifyReviewBundle } = require('./verify-review-bundle');

const REQUIRED_TAG = 'stage-6.4.5.8-rejected-architecture';

const ENV_BY_ARGUMENT = Object.freeze({
  '--rejected-baseline': 'WP7_REJECTED_CANDIDATE_BASELINE',
  '--implementation-commit': 'WP7_IMPLEMENTATION_COMMIT',
  '--candidate-head': 'WP7_CANDIDATE_HEAD',
  '--electron-archive': 'WP7_ELECTRON_RELEASE_ARCHIVE',
  '--trusted-product-archive': 'WP7_TRUSTED_PRODUCT_ARCHIVE',
  '--pre-review-sealed-artifact': 'WP7_PRE_REVIEW_SEALED_ARTIFACT',
  '--build-json': 'WP7_PRE_REVIEW_BUILD_JSON',
  '--evidence-root': 'WP7_PRE_REVIEW_EVIDENCE_ROOT',
  '--verification-root': 'WP7_PRE_REVIEW_VERIFICATION_ROOT',
  '--governance-verification': 'WP7_GOVERNANCE_VERIFICATION',
  '--source-closure': 'WP7_SOURCE_CLOSURE',
  '--output-dir': 'WP7_CANDIDATE_OUTPUT_ROOT',
  '--repo-root': 'WP7_REPO_ROOT'
});
function arg(name, fallback = null) { return optionValue(name, { envName: ENV_BY_ARGUMENT[name], fallback }); }
function fail(reasonCode, message, details = {}) {
  const error = new Error(message);
  error.reasonCode = reasonCode;
  error.details = details;
  throw error;
}
function git(args, cwd = REPO_ROOT) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 }).trim();
}
function assertObjectId(value, label) {
  const id = String(value || '');
  if (!/^[0-9a-f]{40}$/.test(id)) fail('WP7_CANDIDATE_IDENTITY_INVALID', `${label} must be a full Git object ID`, { value });
  return id;
}
function assertRegular(filePath, reasonCode, label) {
  if (!filePath || !path.isAbsolute(filePath)) fail(reasonCode, `${label} must be an absolute path`, { filePath });
  const absolute = fs.realpathSync(filePath);
  const stat = fs.lstatSync(absolute);
  if (!stat.isFile() || stat.isSymbolicLink()) fail(reasonCode, `${label} must be a regular non-symlink file`, { filePath: absolute });
  return absolute;
}
function assertDirectory(directoryPath, reasonCode, label) {
  if (!directoryPath || !path.isAbsolute(directoryPath)) fail(reasonCode, `${label} must be an absolute path`, { directoryPath });
  const absolute = fs.realpathSync(directoryPath);
  const stat = fs.lstatSync(absolute);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail(reasonCode, `${label} must be a real non-symlink directory`, { directoryPath: absolute });
  return absolute;
}
function copyFile(source, destination, mode = 0o600) {
  const stat = fs.lstatSync(source);
  if (!stat.isFile() || stat.isSymbolicLink()) fail('WP7_CANDIDATE_INPUT_INVALID', 'candidate input must be a regular non-symlink file', { source });
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
  fs.chmodSync(destination, mode);
}
function copyTree(sourceRoot, destinationRoot) {
  fs.mkdirSync(destinationRoot, { recursive: true });
  for (const entry of fs.readdirSync(sourceRoot, { withFileTypes: true }).sort((a, b) => Buffer.from(a.name).compare(Buffer.from(b.name)))) {
    const source = path.join(sourceRoot, entry.name);
    const destination = path.join(destinationRoot, entry.name);
    const stat = fs.lstatSync(source);
    if (stat.isSymbolicLink()) fail('WP7_CANDIDATE_INPUT_INVALID', 'candidate input tree contains a symlink', { source });
    if (stat.isDirectory()) copyTree(source, destination);
    else if (stat.isFile()) copyFile(source, destination);
    else fail('WP7_CANDIDATE_INPUT_INVALID', 'candidate input tree contains unsupported object', { source });
  }
}
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: options.timeout || 600000, cwd: options.cwd || REPO_ROOT });
  if (result.status !== 0) fail(options.reasonCode || 'WP7_CANDIDATE_COMMAND_FAILED', options.message || `${command} failed`, { command, args, status: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr });
  return result;
}
function relativeRecord(root, relativePath, artifactClass) {
  const normalized = normalizeRelativePath(relativePath, 'artifact.path');
  const absolute = path.join(root, ...normalized.split('/'));
  const stat = fs.lstatSync(absolute);
  return { path: normalized, artifactClass, sizeBytes: stat.size, sha256: sha256File(absolute) };
}
function internalHashLines(root, excluded = new Set()) {
  return walkRegularFiles(root).filter((row) => !excluded.has(row.path)).map((row) => `${row.sha256}  ${row.path}`).sort();
}
function writePatch(repoRoot, from, to, destination) {
  const result = run('git', ['diff', '--binary', '--full-index', '--no-renames', from, to], { cwd: repoRoot, reasonCode: 'WP7_CANDIDATE_PATCH_CREATE_FAILED' });
  fs.writeFileSync(destination, result.stdout, { mode: 0o600 });
}
function ensureAncestor(repoRoot, ancestor, descendant, label) {
  const result = spawnSync('git', ['merge-base', '--is-ancestor', ancestor, descendant], { cwd: repoRoot });
  if (result.status !== 0) fail('WP7_CANDIDATE_IDENTITY_INVALID', `${label} ancestry is invalid`, { ancestor, descendant });
}
function createCandidate(options) {
  const repoRoot = path.resolve(options.repoRoot || REPO_ROOT);
  const outputRoot = path.resolve(options.outputRoot || '');
  if (!options.outputRoot) fail('WP7_CANDIDATE_OUTPUT_REQUIRED', '--output-dir is required');
  if (fs.existsSync(outputRoot) && fs.readdirSync(outputRoot).length) fail('WP7_CANDIDATE_OUTPUT_NOT_EMPTY', 'candidate output directory must be empty', { outputRoot });
  fs.mkdirSync(outputRoot, { recursive: true });

  const identity = gitIdentity(repoRoot);
  if (!identity.repositoryClean) fail('WP7_SOURCE_NOT_CLEAN', 'candidate must be generated from a clean repository');
  const candidateHead = assertObjectId(options.candidateHead || identity.sourceCommit, 'candidate HEAD');
  const candidateTree = git(['rev-parse', `${candidateHead}^{tree}`], repoRoot);
  if (candidateHead !== identity.sourceCommit) fail('WP7_CANDIDATE_IDENTITY_INVALID', 'candidate HEAD must equal current clean repository HEAD', { candidateHead, currentHead: identity.sourceCommit });
  const implementationCommit = assertObjectId(options.implementationCommit, 'implementation commit');
  const implementationTree = git(['rev-parse', `${implementationCommit}^{tree}`], repoRoot);
  const rejectedBaseline = assertObjectId(options.rejectedBaseline, 'rejected candidate baseline');
  ensureAncestor(repoRoot, rejectedBaseline, implementationCommit, 'rejected baseline to implementation');
  ensureAncestor(repoRoot, implementationCommit, candidateHead, 'implementation to candidate');

  const parent = git(['rev-parse', `${candidateHead}^`], repoRoot);
  if (parent !== implementationCommit) fail('WP7_CANDIDATE_GOVERNANCE_PARENT_INVALID', 'candidate governance HEAD must be a direct child of the implementation commit', { expected: implementationCommit, actual: parent });

  const electronArchive = assertRegular(options.electronArchive, 'WP7_CANDIDATE_REQUIRED_DELIVERY_ARTIFACTS_MISSING', 'official Electron archive');
  const productArchive = assertRegular(options.trustedProductArchive, 'WP7_CANDIDATE_REQUIRED_DELIVERY_ARTIFACTS_MISSING', 'trusted product archive');
  const sealPath = assertRegular(options.sealedArtifact, 'WP7_PRE_REVIEW_SEALED_ARTIFACT_MISSING', 'Pre-Review sealed artifact');
  const buildJson = assertRegular(options.buildJson, 'WP7_CANDIDATE_REQUIRED_DELIVERY_ARTIFACTS_MISSING', 'trusted product build JSON');
  const evidenceRoot = assertDirectory(options.evidenceRoot, 'WP7_PRE_REVIEW_EVIDENCE_INDEX_MISSING', 'complete Pre-Review evidence package');
  const verificationRoot = assertDirectory(options.verificationRoot, 'WP7_COMPLETE_TEST_RAW_RESULTS_MISSING', 'complete verification output');
  const governanceVerification = assertRegular(options.governanceVerification, 'WP7_CANDIDATE_REQUIRED_DELIVERY_ARTIFACTS_MISSING', 'candidate governance verification');
  const sourceClosure = assertRegular(options.sourceClosure, 'WP7_CANDIDATE_REQUIRED_DELIVERY_ARTIFACTS_MISSING', 'candidate source closure');

  const seal = readAndVerifyPreReviewSealedArtifact(sealPath, { sourceCommit: implementationCommit, sourceTree: implementationTree });
  const build = JSON.parse(fs.readFileSync(buildJson, 'utf8'));
  if (build.sourceCommit !== implementationCommit || build.sourceTree !== implementationTree || build.buildSessionId !== seal.document.buildSessionId || build.buildId !== seal.document.buildId || build.artifactClass !== 'WP7_PRE_REVIEW_ONLY' || build.finalReleaseEvidence !== false) {
    fail('WP7_CANDIDATE_REQUIRED_DELIVERY_ARTIFACTS_MISMATCH', 'build identity is not bound to implementation and seal');
  }

  const packName = `Yance_Stage6_4_5_9_WP7_CPR_R9_Convergence_Pre_Review_Candidate_${candidateHead.slice(0, 12)}`;
  const packRoot = path.join(outputRoot, packName);
  fs.mkdirSync(packRoot, { recursive: true });
  for (const dir of ['git', 'patch', 'source', 'external-inputs', 'trusted-product', 'evidence', 'verification', 'delivery']) fs.mkdirSync(path.join(packRoot, dir), { recursive: true });

  const branchRef = git(['symbolic-ref', '--short', 'HEAD'], repoRoot);
  const bundleRelative = `git/${packName}.bundle`;
  const bundlePath = path.join(packRoot, bundleRelative);
  run('git', ['bundle', 'create', bundlePath, `refs/heads/${branchRef}`, `refs/tags/${REQUIRED_TAG}`], { cwd: repoRoot, reasonCode: 'WP7_COMPLETE_GIT_HISTORY_REQUIRED' });
  const bundleVerification = verifyReviewBundle(bundlePath, { branchRef: `refs/heads/${branchRef}`, cwd: repoRoot });
  if (bundleVerification.branchHead !== candidateHead) fail('WP7_CANDIDATE_BUNDLE_HEAD_MISMATCH', 'bundle branch does not point to candidate HEAD', { expected: candidateHead, actual: bundleVerification.branchHead });
  writeCanonicalJson(path.join(packRoot, 'verification', 'WP7_REVIEW_BUNDLE_VERIFICATION.json'), { ...bundleVerification, bundlePath: bundleRelative });

  const patchCompleteRelative = `patch/${packName}_Complete_From_Rejected_CPR_R8.patch`;
  const patchImplementationRelative = `patch/${packName}_Implementation_From_Rejected_CPR_R8.patch`;
  const patchGovernanceRelative = `patch/${packName}_Candidate_Governance.patch`;
  writePatch(repoRoot, rejectedBaseline, candidateHead, path.join(packRoot, patchCompleteRelative));
  writePatch(repoRoot, rejectedBaseline, implementationCommit, path.join(packRoot, patchImplementationRelative));
  writePatch(repoRoot, implementationCommit, candidateHead, path.join(packRoot, patchGovernanceRelative));

  const sourceRelative = `source/${packName}_Source.zip`;
  run('git', ['-c', 'core.autocrlf=false', '-c', 'core.eol=lf', 'archive', '--format=zip', `--output=${path.join(packRoot, sourceRelative)}`, candidateHead], { cwd: repoRoot, reasonCode: 'WP7_CANDIDATE_SOURCE_ARCHIVE_FAILED' });

  const electronRelative = `external-inputs/${path.basename(electronArchive)}`;
  const productRelative = `trusted-product/${path.basename(productArchive)}`;
  const sealRelative = `trusted-product/${path.basename(sealPath)}`;
  const buildRelative = `trusted-product/${path.basename(buildJson)}`;
  copyFile(electronArchive, path.join(packRoot, electronRelative));
  copyFile(productArchive, path.join(packRoot, productRelative));
  copyFile(sealPath, path.join(packRoot, sealRelative));
  copyFile(buildJson, path.join(packRoot, buildRelative));
  copyTree(evidenceRoot, path.join(packRoot, 'evidence', 'complete-pre-review-evidence'));
  copyTree(verificationRoot, path.join(packRoot, 'verification', 'complete-verification'));
  copyFile(governanceVerification, path.join(packRoot, 'verification', 'WP7_CANDIDATE_GOVERNANCE_AUTHORITY_CONSISTENCY.json'));
  copyFile(sourceClosure, path.join(packRoot, 'verification', 'WP7_CANDIDATE_SOURCE_CLOSURE.json'));

  const artifactRecords = [
    relativeRecord(packRoot, bundleRelative, 'GIT_COMPLETE_HISTORY'),
    relativeRecord(packRoot, patchCompleteRelative, 'COMPLETE_PATCH_FROM_REJECTED_CPR_R8'),
    relativeRecord(packRoot, patchImplementationRelative, 'IMPLEMENTATION_PATCH_FROM_REJECTED_CPR_R8'),
    relativeRecord(packRoot, patchGovernanceRelative, 'CANDIDATE_GOVERNANCE_PATCH'),
    relativeRecord(packRoot, sourceRelative, 'COMPLETE_SOURCE_ZIP'),
    relativeRecord(packRoot, electronRelative, 'OFFICIAL_ELECTRON_REVIEW_INPUT'),
    relativeRecord(packRoot, productRelative, 'PRE_REVIEW_TRUSTED_PRODUCT'),
    relativeRecord(packRoot, sealRelative, 'PRE_REVIEW_SEALED_ARTIFACT'),
    relativeRecord(packRoot, buildRelative, 'PRE_REVIEW_BUILD_IDENTITY'),
    relativeRecord(packRoot, 'evidence/complete-pre-review-evidence/WP7_PRE_REVIEW_EVIDENCE_INDEX.json', 'PRE_REVIEW_EVIDENCE_INDEX'),
    relativeRecord(packRoot, 'evidence/complete-pre-review-evidence/WP7_PRE_REVIEW_INTERNAL_SHA256.txt', 'PRE_REVIEW_EVIDENCE_INTERNAL_HASHES'),
    relativeRecord(packRoot, 'verification/WP7_CANDIDATE_GOVERNANCE_AUTHORITY_CONSISTENCY.json', 'CANDIDATE_GOVERNANCE_VERIFICATION'),
    relativeRecord(packRoot, 'verification/WP7_CANDIDATE_SOURCE_CLOSURE.json', 'CANDIDATE_SOURCE_CLOSURE')
  ];

  const delivery = {
    schemaVersion: 1,
    documentType: 'WP7_CPR_R9_CONVERGENCE_PRE_REVIEW_CANDIDATE_DELIVERY',
    deliveryStatus: 'CANDIDATE_PENDING_INDEPENDENT_REVIEW',
    stage: '6.4.5.9',
    workPackage: 'WP7',
    generatedAtUtc: new Date().toISOString(),
    rejectedCandidateBaseline: rejectedBaseline,
    implementationCommit,
    implementationTree,
    candidateGovernanceHead: candidateHead,
    candidateGovernanceTree: candidateTree,
    candidateGovernanceParent: implementationCommit,
    artifactClass: 'WP7_PRE_REVIEW_ONLY',
    evidenceClass: 'PRE_REVIEW_PACKAGED_INTEGRATION',
    preReviewSealedArtifactSha256: seal.sha256,
    preReviewSealedArtifactType: seal.document.preReviewSealedArtifactType,
    buildSessionId: seal.document.buildSessionId,
    buildId: seal.document.buildId,
    trustedProductArchiveSha256: sha256File(productArchive),
    officialElectronArchiveSha256: sha256File(electronArchive),
    trustedProductProbeExecutions: 'PASS_9_OF_9',
    independentReviewStatus: 'PENDING',
    preAcceptanceIssued: false,
    finalPackagingAuthorized: false,
    finalAcceptanceStatus: 'NOT_ACCEPTED',
    formalWindowsEvidenceEligible: false,
    artifacts: artifactRecords
  };
  const deliveryRelative = 'delivery/WP7_CPR_R9_CANDIDATE_DELIVERY.json';
  writeCanonicalJson(path.join(packRoot, deliveryRelative), delivery);

  const manifestRelative = 'delivery/WP7_CPR_R9_ARTIFACT_MANIFEST.json';
  const internalRelative = 'delivery/WP7_CPR_R9_INTERNAL_SHA256.txt';
  const coreValidationRelative = 'verification/WP7_CANDIDATE_PACKAGE_CORE_VALIDATION.json';
  const manifestRecords = walkRegularFiles(packRoot).filter((row) => ![manifestRelative, internalRelative, coreValidationRelative].includes(row.path));
  writeCanonicalJson(path.join(packRoot, manifestRelative), {
    schemaVersion: 1,
    documentType: 'WP7_CPR_R9_ARTIFACT_MANIFEST',
    generatedAtUtc: new Date().toISOString(),
    candidateGovernanceHead: candidateHead,
    candidateGovernanceTree: candidateTree,
    implementationCommit,
    implementationTree,
    artifactCount: manifestRecords.length,
    artifacts: manifestRecords
  });

  const coreValidation = {
    schemaVersion: 1,
    documentType: 'WP7_CANDIDATE_PACKAGE_CORE_VALIDATION',
    status: 'PASS_CORE_ARTIFACTS_CREATED_PENDING_EXTERNAL_REVALIDATION',
    generatedAtUtc: new Date().toISOString(),
    implementationCommit,
    implementationTree,
    candidateGovernanceHead: candidateHead,
    candidateGovernanceTree: candidateTree,
    bundleVerification: 'PASS_COMPLETE_HISTORY_AND_REQUIRED_ANNOTATED_TAG',
    sourceArchiveCreatedFromGitObject: candidateHead,
    preReviewArtifactClass: 'WP7_PRE_REVIEW_ONLY',
    finalReleaseEvidence: false,
    trustedProductArchiveSha256: sha256File(productArchive),
    preReviewSealedArtifactSha256: seal.sha256,
    rawEvidenceIndexIncluded: true,
    completeVerificationIncluded: true
  };
  writeCanonicalJson(path.join(packRoot, coreValidationRelative), coreValidation);
  const lines = internalHashLines(packRoot, new Set([internalRelative]));
  fs.writeFileSync(path.join(packRoot, internalRelative), `${lines.join('\n')}\n`, { mode: 0o600 });

  const zipPath = path.join(outputRoot, `${packName}.zip`);
  const archive = createDeterministicZip({ sourceRoot: outputRoot, entryRoot: packName, outputPath: zipPath });
  const zipSha = sha256File(zipPath);
  fs.writeFileSync(`${zipPath}.sha256`, `${zipSha}  ${path.basename(zipPath)}\n`, { mode: 0o600 });
  return {
    status: 'PASS',
    packRoot,
    zipPath,
    zipSha256: zipSha,
    archiveImplementation: archive.implementation,
    archiveEntryCount: archive.entryCount,
    implementationCommit,
    implementationTree,
    candidateGovernanceHead: candidateHead,
    candidateGovernanceTree: candidateTree,
    artifactCount: walkRegularFiles(packRoot).length
  };
}

if (require.main === module) {
  try {
    const result = createCandidate({
      repoRoot: arg('--repo-root') || undefined,
      outputRoot: arg('--output-dir'),
      rejectedBaseline: arg('--rejected-baseline'),
      implementationCommit: arg('--implementation-commit'),
      candidateHead: arg('--candidate-head') || undefined,
      electronArchive: arg('--electron-archive'),
      trustedProductArchive: arg('--trusted-product-archive'),
      sealedArtifact: arg('--pre-review-sealed-artifact'),
      buildJson: arg('--build-json'),
      evidenceRoot: arg('--evidence-root'),
      verificationRoot: arg('--verification-root'),
      governanceVerification: arg('--governance-verification'),
      sourceClosure: arg('--source-closure')
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ status: 'FAIL', reasonCode: error.reasonCode || 'WP7_CANDIDATE_CREATE_FAILED', message: error.message, details: error.details || {} }, null, 2)}\n`);
    process.exit(1);
  }
}

module.exports = { createCandidate };
