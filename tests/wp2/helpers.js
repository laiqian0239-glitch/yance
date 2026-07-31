'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { expectedBuildId } = require('../../shared/release/releaseManifestSchema');

function sha256(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex'); }

function createInstalledResources(options = {}) {
  const resourcesPath = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-wp2-resources-'));
  const manifest = {
    schemaVersion: 1,
    buildId: '',
    productName: '言策',
    productVersion: '29.2.5',
    stageVersion: '6.4.5.9',
    phase: 'core-runtime-p1',
    distributionMode: 'LOCAL_PRIVATE_UNSIGNED',
    gitCommit: options.gitCommit || 'a'.repeat(40),
    sourceCommit: options.gitCommit || 'a'.repeat(40),
    sourceTree: options.sourceTree || 'b'.repeat(40),
    buildTimestampUtc: options.buildTimestampUtc || '2026-07-03T00:00:00.000Z',
    applicationPayloadSha256: 'c'.repeat(64),
    payloadFilesSha256: 'd'.repeat(64),
    apiContractVersion: 2,
    credentialProtocolVersion: 2,
    runtimeLockProtocolVersion: 1,
    databaseSchemaVersion: 9,
    artifactClass: 'PIPELINE_TEST_ONLY',
    finalReleaseEvidence: false
  };
  manifest.buildId = expectedBuildId(manifest);
  const manifestPath = path.join(resourcesPath, 'release-manifest.json');
  const raw = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  fs.writeFileSync(manifestPath, raw);
  const manifestSha256 = sha256(raw);
  fs.writeFileSync(path.join(resourcesPath, 'release-manifest.sha256'), `${manifestSha256}  release-manifest.json\n`);
  return { resourcesPath, manifest, manifestSha256 };
}

module.exports = { createInstalledResources, sha256 };
