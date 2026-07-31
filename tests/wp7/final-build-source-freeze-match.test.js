'use strict';
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildAuthorizedFinalWindowsInstaller, FINAL_PACKAGING_TOKEN, createReviewFixtureBrandingOptions } = require('../../tools/wp7/lib');
const { cloneCurrentRepository, createPreacceptanceRecord, createFakeElectronDist, fakeElectronOfficialRecords, productionDependencyFixture, createFakeNsisCompiler, createFakeRceditRunner, expectReason } = require('./helpers');
const { isFinalExecution, load, finalContext } = require('./final-phase-helpers');

test('final-build-source-freeze-match.test', () => {
  if (isFinalExecution()) {
    const context = finalContext();
    const source = load('evidence/wp7/source-freeze.json');
    assert.equal(source.frozenSourceCommit, context.implementationCommit);
    assert.equal(source.frozenSourceTree, context.implementationSourceTree);
    assert.ok(source.assertions.includes('SOURCE_STABLE_THROUGH_SEAL'));
    return;
  }
  const { root, repo } = cloneCurrentRepository();
  const binding = createPreacceptanceRecord(repo, root);
  expectReason(assert, () => buildAuthorizedFinalWindowsInstaller({
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
    electronOfficialRecords: fakeElectronOfficialRecords(),
    compilerPath: createFakeNsisCompiler(root),
    ...createReviewFixtureBrandingOptions(createFakeRceditRunner()),
    afterPayloadHook: () => fs.appendFileSync(path.join(repo, 'release', 'release-source.json'), '\n')
  }), 'WP7_SOURCE_CHANGED_DURING_BUILD');

  const second = cloneCurrentRepository();
  const binding2 = createPreacceptanceRecord(second.repo, second.root);
  fs.writeFileSync(path.join(second.repo, 'UNREVIEWED_DESCENDANT.txt'), 'not independently reviewed\n');
  require('node:child_process').execFileSync('git', ['add', 'UNREVIEWED_DESCENDANT.txt'], { cwd: second.repo });
  require('node:child_process').execFileSync('git', ['commit', '-m', 'test: unreviewed descendant'], { cwd: second.repo, stdio: 'ignore' });
  expectReason(assert, () => buildAuthorizedFinalWindowsInstaller({
    repoRoot: second.repo,
    outputRoot: path.join(second.root, 'output'),
    authorizationToken: FINAL_PACKAGING_TOKEN,
    preacceptanceRecordPath: binding2.recordPath,
    preacceptanceRecordSha256: binding2.recordSha256,
    allowNonWindows: true,
    allowNonWindowsCompiler: true,
    installProductionDependencies: false,
    productionNodeModulesSource: productionDependencyFixture(second.repo),
    electronDist: createFakeElectronDist(second.root),
    electronOfficialRecords: fakeElectronOfficialRecords(),
    compilerPath: createFakeNsisCompiler(second.root),
    ...createReviewFixtureBrandingOptions(createFakeRceditRunner())
  }), 'WP7_PREACCEPTED_IMPLEMENTATION_IDENTITY_NOT_ENFORCED');
});
