'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  REPO_ROOT,
  checkForbiddenHotfixEntrypoints,
  checkProtectedCommandPolicy,
  checkRepositoryScope,
  classifyScanPath,
  currentBranch,
  isThirdPartyProvenanceMetadataPath,
  referenceOnlyRootPolicies
} = require('../../tools/wp0/lib');
const { createReviewedImplementationClone } = require('./helpers/reviewedImplementationFixture');

test('forbidden-hotfix-entrypoints.test', () => {
  const result = checkForbiddenHotfixEntrypoints();
  assert.equal(result.pass, true, JSON.stringify(result));
  assert.equal(result.details.enumerationMethod, 'git ls-files -z');
});

test('third-party provenance metadata is non-executable while imported source remains active', () => {
  for (const file of [
    'third_party/provenance.json',
    'third_party/licenses/baileys-MIT.txt',
    'third_party/licenses/LICENSE.baileys'
  ]) {
    assert.equal(isThirdPartyProvenanceMetadataPath(file), true, file);
    assert.equal(classifyScanPath(file), 'THIRD_PARTY_PROVENANCE_METADATA', file);
  }

  for (const file of [
    'third_party/baileys/runtime.js',
    'third_party/licenses/untrusted.js',
    'third_party/provenance-helper.js'
  ]) {
    assert.equal(isThirdPartyProvenanceMetadataPath(file), false, file);
    assert.equal(classifyScanPath(file), 'ACTIVE_SOURCE_OR_AUTOMATION', file);
  }
});

test('local build package and release commands require an exact reviewed implementation branch', t => {
  const policy = checkProtectedCommandPolicy();
  assert.equal(policy.pass, true, JSON.stringify(policy));

  const activeBranch = currentBranch();
  if (activeBranch === 'governance/oss-1a-implementation-authorization') {
    for (const command of ['build', 'package', 'release']) {
      const denied = spawnSync(process.execPath, ['tools/wp0/run-protected-command.js', command, '--gate-only'], {
        cwd: REPO_ROOT,
        encoding: 'utf8'
      });
      assert.notEqual(denied.status, 0, `${command} unexpectedly passed on governance branch`);
      const result = JSON.parse(denied.stdout);
      assert.equal(result.status, 'FAIL');
      assert.equal(result.reasonCode, 'WP0_REJECTED_STAGE_TARGET_DENIED');
    }
  }

  const fixture = createReviewedImplementationClone();
  t.after(() => fixture.cleanup());
  for (const command of ['build', 'package', 'release']) {
    const stdout = execFileSync(process.execPath, ['tools/wp0/run-protected-command.js', command, '--gate-only'], {
      cwd: fixture.repo,
      encoding: 'utf8'
    });
    const result = JSON.parse(stdout);
    assert.equal(result.status, 'PASS', JSON.stringify(result));
    assert.equal(result.gateStatus, 'PASS');
    assert.equal(result.workPackageScope.applicable, false);
  }
});

test('repository scope is explicit and does not claim unavailable original release source', () => {
  const scope = checkRepositoryScope();
  assert.equal(scope.pass, true, JSON.stringify(scope));
  assert.equal(scope.sourceOrigin, 'EXTRACTED_29_2_4_INSTALLER_SOURCE_BASELINE');
  assert.equal(scope.runtimeSourceForExtractedArtifactPresent, true);
  assert.equal(scope.completeOriginalDevelopmentAndReleaseSourceProven, false);
  assert.equal(scope.fullOriginalRepositoryClaimAllowed, false);
  assert.equal(scope.untrackedReleaseCandidateCount, 0);
});

test('hotfix entrypoint scanner rejects forbidden fixture filename', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-wp0-hotfix-'));
  fs.mkdirSync(path.join(root, 'release-scripts'), { recursive: true });
  fs.writeFileSync(path.join(root, 'release-scripts', 'START_UPDATE.cmd'), '@echo off\n');
  const result = checkForbiddenHotfixEntrypoints(root);
  assert.equal(result.pass, false);
  assert.equal(result.reasonCode, 'WP0_FORBIDDEN_HOTFIX_ENTRYPOINT');
});

test('historical audit delivery is classified by policy as reference-only', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-wp0-audit-reference-'));
  try {
    const auditRoot = path.join(root, 'INDEPENDENT_AUDIT_DELIVERY');
    fs.mkdirSync(auditRoot, { recursive: true });
    fs.writeFileSync(
      path.join(auditRoot, 'FULL_SOURCE_FILE_MANIFEST.json'),
      JSON.stringify({ historicalStage: '6.4.5.8', disposition: 'rejected hotfix release candidate' })
    );
    const result = checkForbiddenHotfixEntrypoints(root);
    assert.equal(result.pass, true, JSON.stringify(result));
    const scanned = result.details.scannedFiles.find((item) => item.path === 'INDEPENDENT_AUDIT_DELIVERY/FULL_SOURCE_FILE_MANIFEST.json');
    assert.equal(scanned?.classification, 'REFERENCE_ONLY_AUDIT_DELIVERY');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the same rejected-stage text remains forbidden in active tools', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-wp0-active-control-'));
  try {
    const toolsRoot = path.join(root, 'tools', 'release');
    fs.mkdirSync(toolsRoot, { recursive: true });
    fs.writeFileSync(
      path.join(toolsRoot, 'release-plan.json'),
      JSON.stringify({ targetStage: '6.4.5.8', action: 'hotfix release candidate' })
    );
    const result = checkForbiddenHotfixEntrypoints(root);
    assert.equal(result.pass, false);
    assert.equal(result.reasonCode, 'WP0_FORBIDDEN_HOTFIX_ENTRYPOINT');
    assert.equal(result.details.violations[0]?.file, 'tools/release/release-plan.json');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('reference-only policy cannot overlap repository execution authorities', () => {
  const protectedAuthorities = [
    '.github',
    '.github/workflows',
    '.gitattributes',
    '.gitignore',
    'package.json',
    'package-lock.json',
    'release'
  ];
  for (const authorityPath of protectedAuthorities) {
    assert.throws(
      () => referenceOnlyRootPolicies({
        schemaVersion: 2,
        referenceOnlyRoots: [{
          path: authorityPath,
          classification: 'REFERENCE_ONLY_TEST_FIXTURE'
        }]
      }),
      /overlaps protected active authority path/,
      `${authorityPath} must remain active and cannot be excluded from release-surface enforcement`
    );
  }
});
