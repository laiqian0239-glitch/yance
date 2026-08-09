#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  REPO_ROOT,
  PRE_REVIEW_ARTIFACT_CLASS,
  buildFinalWindowsPayload,
  gitIdentity,
  writeCanonicalJson
} = require('./lib');
const { validateApplicationPayloadClosure } = require('./packaged-payload-closure');
const { verifyTrustedProductExecutable, sha256File } = require('./packaged-product-trust');
const { createDeterministicTarGzip } = require('./deterministic-tar-gzip');
const RELEASE_SOURCE = require('../../release/release-source.json');

const ENV_BY_ARGUMENT = Object.freeze({
  '--repo-root': 'WP7_REPO_ROOT',
  '--electron-archive': 'WP7_ELECTRON_RELEASE_ARCHIVE',
  '--electron-dist': 'WP7_ELECTRON_DISTRIBUTION_ROOT',
  '--production-node-modules': 'WP7_PRODUCTION_NODE_MODULES',
  '--trusted-node-executable': 'WP7_TRUSTED_NODE_EXECUTABLE',
  '--parlant-runtime': 'WP7_PARLANT_RUNTIME_ROOT',
  '--rcedit-path': 'WP7_RCEDIT_PATH',
  '--platform-auth-config': 'WP7_PLATFORM_AUTH_CONFIG_PATH',
  '--platform-auth-sha256': 'WP7_PLATFORM_AUTH_CONFIG_SHA256_PATH',
  '--output-dir': 'WP7_PRE_REVIEW_PRODUCT_OUTPUT',
  '--build-timestamp-utc': 'WP7_PRE_REVIEW_BUILD_TIMESTAMP_UTC',
  '--build-session-id': 'WP7_PRE_REVIEW_BUILD_SESSION_ID',
  '--target-platform': 'WP7_TARGET_PLATFORM',
  '--target-arch': 'WP7_TARGET_ARCH'
});

function fail(reasonCode, message, details = {}) {
  const error = new Error(message);
  error.reasonCode = reasonCode;
  error.details = details;
  throw error;
}
function argumentValue(name, options = {}) {
  const argv = options.argv || process.argv.slice(2);
  const env = options.env || process.env;
  const index = argv.indexOf(name);
  if (index >= 0) {
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) fail('WP7_PRE_REVIEW_ARGUMENT_INVALID', `${name} requires a value`, { name });
    return value;
  }
  const envName = ENV_BY_ARGUMENT[name];
  return envName && env[envName] ? env[envName] : options.fallback ?? null;
}
function booleanArgument(name, options = {}) {
  const argv = options.argv || process.argv.slice(2);
  const env = options.env || process.env;
  if (argv.includes(name)) return true;
  const envName = options.envName;
  return envName ? ['1', 'true', 'yes'].includes(String(env[envName] || '').toLowerCase()) : false;
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
function canonicalUtc(value) {
  const timestamp = String(value || '');
  const parsed = new Date(timestamp);
  if (!timestamp.endsWith('Z') || Number.isNaN(parsed.getTime()) || parsed.toISOString() !== timestamp) fail('WP7_PRE_REVIEW_BUILD_TIMESTAMP_INVALID', 'build timestamp must be canonical UTC', { value });
  return timestamp;
}
function resolveBuildInputs(options = {}) {
  const repoRoot = path.resolve(argumentValue('--repo-root', { ...options, fallback: REPO_ROOT }));
  const outputValue = argumentValue('--output-dir', options);
  if (!outputValue) fail('WP7_PRE_REVIEW_TRUSTED_PRODUCT_OUTPUT_REQUIRED', '--output-dir or WP7_PRE_REVIEW_PRODUCT_OUTPUT is required');
  const targetPlatform = argumentValue('--target-platform', { ...options, fallback: 'win32' });
  const targetArch = argumentValue('--target-arch', { ...options, fallback: 'x64' });
  const allowNonWindowsReviewFixture = booleanArgument('--allow-non-windows-review-fixture', { ...options, envName: 'WP7_ALLOW_NON_WINDOWS_REVIEW_FIXTURE' });
  if (targetPlatform !== 'win32' || targetArch !== 'x64') {
    fail('WP7_WINDOWS_FINAL_BUILD_REQUIRED', 'pre-review trusted product builder is bound to the Windows x64 release target', { targetPlatform, targetArch });
  }
  if (process.platform !== 'win32' && !allowNonWindowsReviewFixture) {
    fail('WP7_WINDOWS_FINAL_BUILD_REQUIRED', 'Windows pre-review trusted product must be built by native Windows Node; WSL/Cygwin/Linux substitution is not accepted', { actualHostPlatform: process.platform, targetPlatform });
  }
  const outputRoot = path.resolve(outputValue);
  return Object.freeze({
    repoRoot,
    outputRoot,
    electronArchivePath: assertRegular(argumentValue('--electron-archive', options), 'WP7_OFFICIAL_ELECTRON_ARCHIVE_REQUIRED', 'official Electron archive'),
    electronDist: assertDirectory(argumentValue('--electron-dist', options), 'WP7_OFFICIAL_ELECTRON_DISTRIBUTION_REQUIRED', 'official Electron extracted distribution'),
    productionNodeModulesSource: assertDirectory(argumentValue('--production-node-modules', options), 'WP7_PRODUCTION_DEPENDENCY_DIRECTORY_TREE_MISMATCH', 'reviewed production node_modules'),
    trustedNodeExecutable: assertRegular(argumentValue('--trusted-node-executable', options), 'WP7_NODE_RUNTIME_EXECUTABLE_MISSING', 'trusted Node executable'),
    parlantRuntimeSource: assertDirectory(argumentValue('--parlant-runtime', options), 'WP7_PARLANT_RUNTIME_REQUIRED', 'presealed Parlant runtime'),
    rceditPath: assertRegular(argumentValue('--rcedit-path', options), 'WP7_RCEDIT_EXECUTABLE_REQUIRED', 'trusted rcedit executable'),
    platformAuthConfigPath: argumentValue('--platform-auth-config', options) ? assertRegular(argumentValue('--platform-auth-config', options), 'WP7_PLATFORM_AUTH_RELEASE_CONFIG_MISSING', 'sealed platform auth configuration') : null,
    platformAuthHashPath: argumentValue('--platform-auth-sha256', options) ? assertRegular(argumentValue('--platform-auth-sha256', options), 'WP7_PLATFORM_AUTH_RELEASE_CONFIG_MISSING', 'platform auth detached SHA-256') : null,
    requirePlatformAuth: booleanArgument('--require-platform-auth', { ...options, envName: 'WP7_REQUIRE_PLATFORM_AUTH' }),
    buildTimestampUtc: canonicalUtc(argumentValue('--build-timestamp-utc', { ...options, fallback: new Date().toISOString() })),
    buildSessionId: argumentValue('--build-session-id', { ...options, fallback: crypto.randomBytes(16).toString('hex') }),
    targetPlatform,
    targetArch,
    allowNonWindowsReviewFixture
  });
}
function archiveProduct(stagingRoot, archivePath, timestamp, targetPlatform) {
  return createDeterministicTarGzip({ sourceRoot: stagingRoot, entryRoot: 'application-payload', outputPath: archivePath, timestamp, targetPlatform });
}
function run(options = {}) {
  const inputs = resolveBuildInputs(options);
  const {
    repoRoot, outputRoot, electronArchivePath, electronDist, productionNodeModulesSource,
    trustedNodeExecutable, parlantRuntimeSource, rceditPath, platformAuthConfigPath, platformAuthHashPath, requirePlatformAuth,
    buildTimestampUtc, buildSessionId, targetPlatform, targetArch, allowNonWindowsReviewFixture
  } = inputs;
  if (!/^[0-9a-f]{16,64}$/.test(buildSessionId)) fail('WP7_PRE_REVIEW_BUILD_SESSION_ID_INVALID', 'build session ID must be 16-64 lowercase hexadecimal characters', { buildSessionId });
  if (fs.existsSync(outputRoot) && fs.readdirSync(outputRoot).length) fail('WP7_PRE_REVIEW_TRUSTED_PRODUCT_OUTPUT_NOT_EMPTY', 'trusted product output directory must be empty', { outputRoot });
  fs.mkdirSync(outputRoot, { recursive: true });
  const identity = gitIdentity(repoRoot);
  if (!identity.repositoryClean) fail('WP7_SOURCE_NOT_CLEAN', 'trusted product must be built from a clean reviewed source identity');
  const stagingRoot = path.join(outputRoot, 'staging');
  const built = buildFinalWindowsPayload({
    repoRoot,
    stagingRoot,
    identity,
    buildTimestampUtc,
    allowNonWindows: allowNonWindowsReviewFixture,
    installProductionDependencies: false,
    productionNodeModulesSource,
    electronDist,
    trustedNodeExecutable,
    parlantRuntimeSource,
    electronArchivePath,
    rceditPath,
    platformAuthConfigPath,
    platformAuthHashPath,
    requirePlatformAuth,
    targetPlatform,
    targetArch,
    artifactClass: PRE_REVIEW_ARTIFACT_CLASS,
    finalReleaseEvidence: false
  });
  const closure = validateApplicationPayloadClosure(built.payloadRoot, built.resourcesRoot, { repoRoot, platform: targetPlatform, arch: targetArch });
  const productExecutable = path.join(built.payloadRoot, targetPlatform === 'win32' ? RELEASE_SOURCE.executableName : path.parse(RELEASE_SOURCE.executableName).name);
  const trust = verifyTrustedProductExecutable({ repoRoot, electronArchivePath, electronDist, productExecutablePath: productExecutable, payloadRoot: built.payloadRoot, platform: targetPlatform, arch: targetArch });
  if (built.manifest.artifactClass !== PRE_REVIEW_ARTIFACT_CLASS || built.manifest.finalReleaseEvidence !== false || closure.identity.artifactClass !== PRE_REVIEW_ARTIFACT_CLASS || closure.identity.finalReleaseEvidence !== false) {
    fail('WP7_PRE_REVIEW_ARTIFACT_CLASSIFICATION_INVALID', 'trusted product was not assembled as PRE_REVIEW_ONLY');
  }
  const archiveName = `Yance_Stage6_4_5_9_WP7_PreReview_Trusted_Product_${identity.sourceCommit.slice(0, 12)}.tar.gz`;
  const archivePath = path.join(outputRoot, archiveName);
  const archive = archiveProduct(stagingRoot, archivePath, buildTimestampUtc, targetPlatform);
  const buildDocument = {
    schemaVersion: 2,
    documentType: 'WP7_PRE_REVIEW_TRUSTED_PRODUCT_BUILD',
    status: 'PASS',
    generatedAtUtc: new Date().toISOString(),
    buildTimestampUtc,
    artifactClass: PRE_REVIEW_ARTIFACT_CLASS,
    evidenceClass: 'PRE_REVIEW_PACKAGED_INTEGRATION',
    finalInstaller: false,
    finalReleaseEvidence: false,
    formalWindowsEvidenceEligible: false,
    buildSessionId,
    buildId: built.buildId,
    sourceCommit: identity.sourceCommit,
    sourceTree: identity.sourceTree,
    platform: targetPlatform,
    arch: targetArch,
    hostPlatform: process.platform,
    hostArch: process.arch,
    archiveImplementation: 'NODE_USTAR_STREAM_GZIP_V2',
    archiveEntryCount: archive.entryCount,
    electronVersion: trust.electronVersion,
    electronReleaseArchiveFileName: path.basename(electronArchivePath),
    electronReleaseArchiveSha256: trust.archiveSha256,
    electronDistributionFileCount: trust.electronDistributionFileCount,
    electronDistributionModeBoundFileCount: trust.electronDistributionModeBoundFileCount,
    electronDistributionTreeSha256: trust.electronDistributionTreeSha256,
    productExecutableFileName: path.basename(productExecutable),
    productExecutableSha256: trust.productExecutableSha256,
    payloadArchiveRoot: 'application-payload',
    resourcesRelativePath: 'application-payload/resources',
    releaseManifestSha256: built.releaseManifestSha256,
    applicationPayloadSha256: closure.applicationPayloadSha256,
    applicationPayloadFilesystemIdentitySha256: closure.applicationPayloadFilesystemIdentitySha256,
    payloadFilesSha256: closure.payloadFilesSha256,
    payloadRecordCount: closure.records.length,
    reviewedProjectFileCount: closure.source.projectFileCount,
    gitPayloadModeTreeSha256: closure.source.gitPayloadModeTreeSha256,
    gitPayloadModeRecordCount: closure.source.gitPayloadModeRecordCount,
    productionDependencyBindingSha256: closure.dependencies.externalBindingSha256,
    productionDependencyPackageGraphSha256: closure.dependencies.packageGraphSha256,
    productionDependencyFileTreeSha256: closure.dependencies.dependencyFileTreeSha256,
    productionDependencyModeTreeSha256: closure.dependencies.dependencyModeTreeSha256,
    productionDependencyDirectoryModeTreeSha256: closure.dependencies.dependencyDirectoryModeTreeSha256,
    productionDependencyPackageCount: closure.dependencies.packageCount,
    productionDependencyFileCount: closure.dependencies.fileCount,
    productionDependencyDirectoryCount: closure.dependencies.directoryCount,
    rceditFileName: path.basename(rceditPath),
    rceditSha256: sha256File(rceditPath),
    nodeRuntimeVersion: closure.nodeRuntime.version,
    nodeRuntimeExecutableRelativePath: `application-payload/resources/runtime/node22/${closure.nodeRuntime.executableRelativePath}`,
    nodeRuntimeExecutableSha256: closure.nodeRuntime.executableSha256,
    nodeRuntimeTreeSha256: closure.nodeRuntime.runtimeTreeSha256,
    nodeRuntimeFileCount: closure.nodeRuntime.fileCount,
    parlantRuntimeRelativePath: 'application-payload/resources/parlant-runtime',
    parlantRuntimeSealSha256: built.runtime.parlantRuntime.sealSha256,
    parlantRuntimeTreeSha256: built.runtime.parlantRuntime.treeSha256,
    parlantRuntimeFileCount: built.runtime.parlantRuntime.fileCount,
    nativeBinaryScanSha256: closure.nativeBinaryScanSha256,
    nativeBinaryFileCount: closure.nativeBinaryScan.fileCount,
    nativeBinaryFailureCount: closure.nativeBinaryScan.failureCount,
    nativeBinaryTargetPlatform: closure.nativeBinaryScan.targetPlatform,
    nativeBinaryTargetArch: closure.nativeBinaryScan.targetArch,
    nativeBinaryTargetLoadableFileCount: closure.nativeBinaryScan.targetLoadableFileCount,
    nativeBinaryInertForeignVariantCount: closure.nativeBinaryScan.inertForeignVariantCount,
    trustedProductArchiveFileName: archiveName,
    trustedProductArchiveSha256: sha256File(archivePath)
  };
  const buildJsonPath = path.join(outputRoot, 'WP7_PRE_REVIEW_TRUSTED_PRODUCT_BUILD.json');
  writeCanonicalJson(buildJsonPath, buildDocument);
  fs.writeFileSync(`${archivePath}.sha256`, `${buildDocument.trustedProductArchiveSha256}  ${archiveName}\n`, { mode: 0o600 });
  return Object.freeze({ status: 'PASS', outputRoot, buildJsonPath, archivePath, archiveSha256: buildDocument.trustedProductArchiveSha256, payloadRoot: built.payloadRoot, resourcesRoot: built.resourcesRoot, productExecutable, buildSessionId, buildId: built.buildId, sourceCommit: identity.sourceCommit, sourceTree: identity.sourceTree, artifactClass: PRE_REVIEW_ARTIFACT_CLASS });
}
function main() {
  try {
    process.stdout.write(`${JSON.stringify(run(), null, 2)}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ status: 'FAIL', reasonCode: error.reasonCode || 'WP7_PRE_REVIEW_TRUSTED_PRODUCT_BUILD_FAILED', message: error.message, details: error.details || {} }, null, 2)}\n`);
    process.exitCode = 1;
  }
}
if (require.main === module) main();

module.exports = {
  ENV_BY_ARGUMENT,
  archiveProduct,
  argumentValue,
  main,
  resolveBuildInputs,
  run
};
