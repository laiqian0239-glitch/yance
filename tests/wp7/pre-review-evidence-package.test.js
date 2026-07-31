'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { FORMAL_PROBE_IDS } = require('../../shared/wp7/formalProbeIds');
const { measurementFor } = require('./installed-runtime-probe-fixtures');
const { createPreReviewSealedArtifact, SEALED_ARTIFACT_TYPE } = require('../../tools/wp7/pre-review-sealed-artifact');
const { validateNineProbeRawEvidence } = require('../../tools/wp7/pre-review-evidence-package');

function hash(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function writeJson(filePath, document) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600 });
}
function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wp7-pre-review-raw-evidence-'));
  const h = 'a'.repeat(64);
  const identity = {
    generatedAtUtc: '2026-07-06T10:00:00.000Z',
    buildSessionId: 'b'.repeat(32), buildId: 'test-build', sourceCommit: 'c'.repeat(40), sourceTree: 'd'.repeat(40),
    electronReleaseArchiveSha256: h, productExecutableSha256: h, releaseManifestSha256: h,
    applicationPayloadSha256: h, applicationPayloadFilesystemIdentitySha256: h, payloadFilesSha256: h,
    productionDependencyBindingSha256: h, productionDependencyPackageGraphSha256: h, productionDependencyFileTreeSha256: h,
    productionDependencyModeTreeSha256: h, productionDependencyDirectoryModeTreeSha256: h, gitPayloadModeTreeSha256: h,
    electronDistributionTreeSha256: h, nodeRuntimeExecutableSha256: h, nodeRuntimeTreeSha256: h, nativeBinaryScanSha256: h
  };
  const sealPath = path.join(root, 'WP7_PRE_REVIEW_SEALED_ARTIFACT.json');
  const seal = createPreReviewSealedArtifact(sealPath, identity);
  const rows = [];
  const now = '2026-07-06T10:01:00.000Z';
  for (let index = 0; index < FORMAL_PROBE_IDS.length; index += 1) {
    const probeId = FORMAL_PROBE_IDS[index];
    const probeRoot = path.join(root, 'runs', probeId);
    const nonce = `123e4567-e89b-42d3-a456-${String(index).padStart(12, '0')}`;
    const pid = 1000 + index;
    const parentPid = 900;
    const resultPath = path.join(probeRoot, 'probe-results', `${probeId}.json`);
    const stdoutPath = path.join(probeRoot, 'stdout.log');
    const stderrPath = path.join(probeRoot, 'stderr.log');
    const custodyPath = path.join(probeRoot, 'process-custody.json');
    const contextPath = path.join(probeRoot, 'execution-context.json');
    writeJson(resultPath, {
      schemaVersion: 1, documentType: 'WP7_INSTALLED_RUNTIME_PROBE_RESULT', probeId, status: 'PASS', generatedAtUtc: now,
      startedAtUtc: now, completedAtUtc: now, executionNonce: nonce, actualPlatform: 'linux', fixtureMode: false,
      executionClass: 'PRE_REVIEW_PACKAGED_INTEGRATION', formalWindowsEvidenceEligible: false,
      producerPid: pid, producerParentPid: parentPid, producerExecutablePath: '/review/product/Yance', producerExecutableSha256: h,
      producerMainEntryPath: '/review/product/resources/app/electron/main.js', producerMainEntrySha256: h,
      buildSessionId: identity.buildSessionId, buildId: identity.buildId, frozenSourceCommit: identity.sourceCommit, frozenSourceTree: identity.sourceTree,
      preReviewSealedArtifactSha256: seal.sha256, preReviewSealedArtifactType: SEALED_ARTIFACT_TYPE,
      measurements: measurementFor(probeId)
    });
    fs.mkdirSync(probeRoot, { recursive: true });
    fs.writeFileSync(stdoutPath, `stdout ${probeId}\n`);
    fs.writeFileSync(stderrPath, '');
    writeJson(custodyPath, {
      schemaVersion: 1, documentType: 'WP7_TRUSTED_PRODUCT_PROCESS_CUSTODY', probeId, executionNonce: nonce,
      productPid: pid, runnerPid: parentPid, startedAtUtc: now, endedAtUtc: now, exitCode: 0, signal: null, timeoutTriggered: false
    });
    writeJson(contextPath, {
      schemaVersion: 1, documentType: 'WP7_TRUSTED_PRODUCT_PROBE_EXECUTION_CONTEXT', probeId,
      executionClass: 'PRE_REVIEW_PACKAGED_INTEGRATION', executionNonce: nonce,
      buildSessionId: identity.buildSessionId, buildId: identity.buildId, sourceCommit: identity.sourceCommit, sourceTree: identity.sourceTree,
      preReviewSealedArtifactSha256: seal.sha256, preReviewSealedArtifactType: SEALED_ARTIFACT_TYPE,
      productExecutableSha256: h, mainEntrySha256: h, networkIsolationRequired: probeId === 'offline-start'
    });
    const relative = (filePath) => path.relative(root, filePath).split(path.sep).join('/');
    let networkIsolation = null;
    if (probeId === 'offline-start') {
      const proofPath = path.join(probeRoot, 'network-isolation-proof', `${pid}.json`);
      writeJson(proofPath, { schemaVersion: 1, documentType: 'WP7_NETWORK_ISOLATION_PRE_MAIN_PROOF', pid, parentPid, nonce, unixSeconds: 1, unixNanoseconds: 0 });
      networkIsolation = { sourceSha256: h, librarySha256: h, proofPath: relative(proofPath), proofSha256: hash(fs.readFileSync(proofPath)), proofPid: pid, proofParentPid: parentPid, proofNonce: nonce };
    }
    rows.push({
      probeId, status: 'PASS', processPid: pid, processParentPid: parentPid, startedAtUtc: now, endedAtUtc: now, exitCode: 0, signal: null,
      stdoutSha256: hash(fs.readFileSync(stdoutPath)), stderrSha256: hash(fs.readFileSync(stderrPath)),
      probeResultPath: relative(resultPath), probeResultSha256: hash(fs.readFileSync(resultPath)),
      stdoutPath: relative(stdoutPath), stderrPath: relative(stderrPath),
      processCustodyPath: relative(custodyPath), processCustodySha256: hash(fs.readFileSync(custodyPath)),
      executionContextPath: relative(contextPath), executionContextSha256: hash(fs.readFileSync(contextPath)),
      executionNonce: nonce, networkIsolation
    });
  }
  const aggregate = {
    schemaVersion: 2, documentType: 'WP7_PACKAGED_YANCE_NINE_PROBE_INTEGRATION_RESULT', status: 'PASS', generatedAtUtc: now,
    executionClass: 'PRE_REVIEW_PACKAGED_INTEGRATION', formalWindowsEvidenceEligible: false, actualPlatform: 'linux', actualArch: 'x64',
    electronVersion: '39.8.5', electronReleaseArchiveFileName: 'electron-v39.8.5-linux-x64.zip', electronReleaseArchiveSha256: h,
    productExecutableFileName: 'Yance', productExecutableSha256: h, packagedPayloadClass: 'TRUSTED_PRODUCT_ARCHIVE_PAYLOAD',
    packagedMainRelativePath: 'resources/app/electron/main.js', packagedMainSha256: h,
    payloadFilesSha256: h, applicationPayloadSha256: h, applicationPayloadFilesystemIdentitySha256: h,
    releaseManifestSha256: h, productionDependencyBindingSha256: h, productionDependencyPackageGraphSha256: h,
    productionDependencyFileTreeSha256: h, productionDependencyModeTreeSha256: h, productionDependencyDirectoryModeTreeSha256: h,
    gitPayloadModeTreeSha256: h, electronDistributionTreeSha256: h, nodeRuntimeExecutableSha256: h, nodeRuntimeTreeSha256: h,
    nativeBinaryScanSha256: h, nativeBinaryFileCount: 1, nativeBinaryFailureCount: 0, nativeBinaryTargetPlatform: 'linux', nativeBinaryTargetArch: 'x64',
    buildSessionId: identity.buildSessionId, preReviewSealedArtifactFileName: path.basename(sealPath), preReviewSealedArtifactSha256: seal.sha256,
    preReviewSealedArtifactType: SEALED_ARTIFACT_TYPE, artifactClass: 'WP7_PRE_REVIEW_ONLY', finalReleaseEvidence: false,
    buildId: identity.buildId, sourceCommit: identity.sourceCommit, sourceTree: identity.sourceTree,
    formalProbeScopePath: 'governance/wp7/trusted-product-probe-scope.json', networkIsolationSourceSha256: h, networkIsolationLibrarySha256: h,
    requiredProbeIds: [...FORMAL_PROBE_IDS], executedProbeCount: FORMAL_PROBE_IDS.length, probeResults: rows
  };
  const aggregatePath = path.join(root, 'nine-fresh-final-result.json');
  writeJson(aggregatePath, aggregate);
  return { root, sealPath, aggregatePath, aggregate };
}

test('complete nine-probe raw evidence validates every result, log, custody, context and offline proof', () => {
  const fixture = createFixture();
  try {
    const result = validateNineProbeRawEvidence({ evidenceRoot: fixture.root, aggregateRelativePath: 'nine-fresh-final-result.json', sealedArtifactPath: fixture.sealPath });
    assert.equal(result.aggregate.executedProbeCount, 9);
    assert.equal(result.artifactRecords.length, 47);
  } finally { fs.rmSync(fixture.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
});

test('missing raw stdout evidence is rejected', () => {
  const fixture = createFixture();
  try {
    fs.rmSync(path.join(fixture.root, fixture.aggregate.probeResults[0].stdoutPath));
    assert.throws(() => validateNineProbeRawEvidence({ evidenceRoot: fixture.root, aggregateRelativePath: 'nine-fresh-final-result.json', sealedArtifactPath: fixture.sealPath }), (error) => error?.reasonCode === 'WP7_TRUSTED_PRODUCT_RAW_PROBE_EVIDENCE_MISSING');
  } finally { fs.rmSync(fixture.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
});

test('temporary absolute path references in the aggregate are rejected', () => {
  const fixture = createFixture();
  try {
    fixture.aggregate.probeResults[0].stdoutPath = '/tmp/runtime-oai/stdout.log';
    writeJson(fixture.aggregatePath, fixture.aggregate);
    assert.throws(() => validateNineProbeRawEvidence({ evidenceRoot: fixture.root, aggregateRelativePath: 'nine-fresh-final-result.json', sealedArtifactPath: fixture.sealPath }), (error) => error?.reasonCode === 'WP7_PRE_REVIEW_EVIDENCE_PATH_INVALID');
  } finally { fs.rmSync(fixture.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
});
