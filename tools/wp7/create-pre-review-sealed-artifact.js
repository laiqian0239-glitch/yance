#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { verifyTrustedProductExecutable } = require('./packaged-product-trust');
const { validatePackagedPayload, readIdentity } = require('./run-packaged-electron-probe-integration');
const { createPreReviewSealedArtifact } = require('./pre-review-sealed-artifact');

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : '';
}
function fail(reasonCode, message, details = {}) {
  const error = new Error(message);
  error.reasonCode = reasonCode;
  error.details = details;
  throw error;
}

function createFromReviewedProduct(options = {}) {
  const repoRoot = path.resolve(options.repoRoot || path.join(__dirname, '..', '..'));
  const trust = verifyTrustedProductExecutable({
    repoRoot,
    electronArchivePath: options.electronArchivePath,
    productExecutablePath: options.productExecutablePath,
    payloadRoot: options.payloadRoot,
    platform: options.platform || process.platform,
    arch: options.arch || process.arch
  });
  const payload = validatePackagedPayload(trust.payloadRoot, options.resourcesRoot, { repoRoot, platform: options.platform || process.platform, arch: options.arch || process.arch });
  const { identity } = readIdentity(payload.resources, repoRoot);
  if (identity.artifactClass !== 'WP7_PRE_REVIEW_ONLY' || identity.finalReleaseEvidence !== false) {
    fail('WP7_PRE_REVIEW_ARTIFACT_CLASSIFICATION_INVALID', 'sealed artifact can only be created for a PRE_REVIEW_ONLY product', { artifactClass: identity.artifactClass, finalReleaseEvidence: identity.finalReleaseEvidence });
  }
  const buildSessionId = String(options.buildSessionId || '').toLowerCase();
  if (!/^[0-9a-f]{16,64}$/.test(buildSessionId)) fail('WP7_PRE_REVIEW_SEALED_ARTIFACT_SCHEMA_INVALID', 'buildSessionId is invalid', { buildSessionId });
  return createPreReviewSealedArtifact(path.resolve(options.outputPath), {
    generatedAtUtc: options.generatedAtUtc || new Date().toISOString(),
    buildSessionId,
    buildId: identity.buildId,
    sourceCommit: identity.sourceCommit,
    sourceTree: identity.sourceTree,
    electronReleaseArchiveSha256: trust.archiveSha256,
    productExecutableSha256: trust.productExecutableSha256,
    releaseManifestSha256: identity.manifestSha256,
    applicationPayloadSha256: payload.applicationPayloadSha256,
    applicationPayloadFilesystemIdentitySha256: payload.applicationPayloadFilesystemIdentitySha256,
    payloadFilesSha256: payload.payloadManifestSha256,
    productionDependencyBindingSha256: payload.productionDependencies.externalBindingSha256,
    productionDependencyPackageGraphSha256: payload.productionDependencies.packageGraphSha256,
    productionDependencyFileTreeSha256: payload.productionDependencies.dependencyFileTreeSha256,
    productionDependencyModeTreeSha256: payload.productionDependencies.dependencyModeTreeSha256,
    productionDependencyDirectoryModeTreeSha256: payload.productionDependencies.dependencyDirectoryModeTreeSha256,
    gitPayloadModeTreeSha256: payload.gitPayloadModeTreeSha256,
    electronDistributionTreeSha256: trust.electronDistributionTreeSha256,
    nodeRuntimeExecutableSha256: payload.nodeRuntime.executableSha256,
    nodeRuntimeTreeSha256: payload.nodeRuntime.runtimeTreeSha256,
    nativeBinaryScanSha256: payload.nativeBinaryScanSha256
  });
}

if (require.main === module) {
  try {
    const result = createFromReviewedProduct({
      repoRoot: arg('--repo-root') || undefined,
      electronArchivePath: arg('--electron-archive'),
      productExecutablePath: arg('--product-executable'),
      payloadRoot: arg('--payload-root'),
      resourcesRoot: arg('--resources-root') || undefined,
      buildSessionId: arg('--build-session-id'),
      outputPath: arg('--output'),
      generatedAtUtc: arg('--generated-at-utc') || undefined
    });
    process.stdout.write(`${JSON.stringify({ status: 'PASS', path: result.path, sha256: result.sha256, document: result.document }, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ status: 'FAIL', reasonCode: error.reasonCode || 'WP7_PRE_REVIEW_SEALED_ARTIFACT_CREATE_FAILED', message: error.message, details: error.details || null }, null, 2)}\n`);
    process.exitCode = 1;
  }
}

module.exports = { createFromReviewedProduct };
