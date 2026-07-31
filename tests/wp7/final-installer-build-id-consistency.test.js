'use strict';
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildAuthorizedFinalWindowsInstaller, FINAL_PACKAGING_TOKEN, readJson, validateBuildIdentity, createReviewFixtureBrandingOptions } = require('../../tools/wp7/lib');
const { cloneCurrentRepository, createPreacceptanceRecord, createFakeElectronDist, createFakeTrustedNodeRuntime, fakeElectronOfficialRecords, productionDependencyFixture, createFakeNsisCompiler, createFakeRceditRunner } = require('./helpers');
const { isFinalExecution, load, finalContext } = require('./final-phase-helpers');

test('final-installer-build-id-consistency.test', () => {
  if (isFinalExecution()) {
    const context = finalContext();
    const evidence = load('evidence/wp7/build-identity.json');
    assert.equal(evidence.buildId, context.finalReleaseEvidence.buildId);
    const consumers = evidence.consumers;
    assert.ok(consumers && typeof consumers === 'object');
    assert.equal(validateBuildIdentity(consumers).status, 'PASS');
    return;
  }
  const { root, repo } = cloneCurrentRepository();
  const binding = createPreacceptanceRecord(repo, root);
  const result = buildAuthorizedFinalWindowsInstaller({
    repoRoot: repo,
    outputRoot: path.join(root, 'output'),
    authorizationToken: FINAL_PACKAGING_TOKEN,
    preacceptanceRecordPath: binding.recordPath,
    preacceptanceRecordSha256: binding.recordSha256,
    buildTimestampUtc: '2026-07-05T00:00:00.000Z',
    allowNonWindows: true,
    allowNonWindowsCompiler: true,
    installProductionDependencies: false,
    productionNodeModulesSource: productionDependencyFixture(repo),
    electronDist: createFakeElectronDist(root),
    trustedNodeExecutable: createFakeTrustedNodeRuntime(root),
    electronOfficialRecords: fakeElectronOfficialRecords(),
    compilerPath: createFakeNsisCompiler(root),
    ...createReviewFixtureBrandingOptions(createFakeRceditRunner())
  });
  assert.ok(result.outputFile.endsWith('.exe'));
  assert.equal(result.preacceptance.implementationCommit, binding.implementationCommit);
  const release = readJson(result.evidencePath);
  const identity = { buildId: release.buildId, productVersion: release.productVersion, stageVersion: release.stageVersion, sourceCommit: release.frozenSourceCommit, sourceTree: release.frozenSourceTree, manifestSha256: release.releaseManifestSha256 };
  assert.equal(validateBuildIdentity({ electron: identity, backend: { ...identity }, installer: { ...identity }, diagnostics: { ...identity } }).status, 'PASS');
  assert.ok(result.manifestPath.includes(path.join('application-payload', 'resources', 'release-manifest.json')));
});
