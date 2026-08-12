'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  REPO_ROOT,
  checkForbiddenHotfixEntrypoints,
  checkProtectedCommandPolicy,
  checkRepositoryScope,
  classifyScanPath,
  referenceOnlyRootPolicies,
  scanRepositoryReleaseSurfaces
} = require('../../tools/wp0/lib');

const FIXTURE_BRANCH = 'rebuild/windows-release-closure-20260806-wp0-fixture';
const FIXTURE_ENV = Object.freeze({ ...process.env, GIT_LFS_SKIP_SMUDGE: '1' });
const APPROVED_SUPPLY_CHAIN_EVIDENCE_PATHS = Object.freeze([
  'THIRD_PARTY_NOTICES.md',
  'third_party/github-actions-lock.json',
  'third_party/licenses/actions-checkout-MIT.txt',
  'third_party/licenses/actions-setup-node-MIT.txt',
  'third_party/licenses/actions-upload-artifact-MIT.txt',
  'third_party/licenses/baileys-MIT.txt',
  'third_party/provenance.json',
  'third_party/sbom.cdx.json'
]);
const REVIEWED_PROVENANCE_TOKEN = 'existing-yance-postinstall-patch';
const REVIEWED_BINDING_PATH = 'release/production-dependency-binding.json';
const REVIEWED_BINDING_POSTINSTALL_PATH = 'node_modules/@letta-ai/letta-code/scripts/postinstall-patches.js';
const REVIEWED_BINDING_LEGACY_TOKEN = 'postinstall-patch';

function evaluatedRepositoryEnv(repo) {
  return {
    ...FIXTURE_ENV,
    YANCE_EVALUATED_REPOSITORY_ROOT: repo
  };
}

function makeAuthorizedFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-wp0-command-fixture-'));
  const repo = path.join(root, 'repo');
  const head = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: REPO_ROOT,
    encoding: 'utf8'
  }).trim();
  execFileSync('git', [
    '-c', 'core.autocrlf=false',
    '-c', 'core.eol=lf',
    'clone',
    '--config', 'core.autocrlf=false',
    '--config', 'core.eol=lf',
    '--quiet',
    '--no-local',
    REPO_ROOT,
    repo
  ], { encoding: 'utf8', env: FIXTURE_ENV });
  execFileSync('git', ['switch', '--force-create', FIXTURE_BRANCH, head], {
    cwd: repo,
    encoding: 'utf8',
    env: FIXTURE_ENV
  });
  assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repo,
    encoding: 'utf8'
  }).trim(), head);
  return { root, repo };
}

function makeReleaseSurfaceFixture(relativePath, content) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-wp0-release-surface-'));
  const full = path.join(root, ...relativePath.split('/'));
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
  return root;
}

function reviewedBindingLegacyTokenFixture() {
  const content = JSON.stringify({
    files: [{ path: REVIEWED_BINDING_POSTINSTALL_PATH }]
  });
  assert.equal(REVIEWED_BINDING_POSTINSTALL_PATH.includes(REVIEWED_BINDING_LEGACY_TOKEN), true);
  assert.equal(content.includes(REVIEWED_BINDING_LEGACY_TOKEN), true);
  return content;
}

test('forbidden-hotfix-entrypoints.test', () => {
  const result = checkForbiddenHotfixEntrypoints();
  assert.equal(result.pass, true, JSON.stringify(result));
  assert.equal(result.details.enumerationMethod, 'git ls-files -z');
});

test('local build package and release commands are guarded by executable WP0 gate on an isolated authorized rebuild branch', () => {
  const policy = checkProtectedCommandPolicy();
  assert.equal(policy.pass, true, JSON.stringify(policy));
  const { root, repo } = makeAuthorizedFixture();
  try {
    for (const command of ['build', 'package', 'release']) {
      const stdout = execFileSync(process.execPath, ['tools/wp0/run-protected-command.js', command, '--gate-only'], {
        cwd: repo,
        encoding: 'utf8',
        env: evaluatedRepositoryEnv(repo)
      });
      const result = JSON.parse(stdout);
      assert.equal(result.status, 'PASS', JSON.stringify(result));
      assert.equal(result.gateStatus, 'PASS');
      assert.equal(result.workPackageScope.effectiveBranch, FIXTURE_BRANCH);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
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

test('the eight reviewed supply-chain evidence paths use an exact non-active classification', () => {
  for (const evidencePath of APPROVED_SUPPLY_CHAIN_EVIDENCE_PATHS) {
    assert.equal(
      classifyScanPath(evidencePath),
      'SUPPLY_CHAIN_EVIDENCE',
      `${evidencePath} must be classified only by the reviewed exact-path authority`
    );
  }
});

test('reviewed provenance evidence is not interpreted as an executable legacy release mechanism', () => {
  const root = makeReleaseSurfaceFixture(
    'third_party/provenance.json',
    JSON.stringify({ modifications: [REVIEWED_PROVENANCE_TOKEN] })
  );
  try {
    const scan = scanRepositoryReleaseSurfaces(root);
    const provenance = scan.scannedFiles.find((item) => item.path === 'third_party/provenance.json');
    assert.equal(provenance?.classification, 'SUPPLY_CHAIN_EVIDENCE');
    assert.equal(scan.violationCount, 0, JSON.stringify(scan.violations));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a case-variant evidence path remains active and fails closed', () => {
  const relativePath = 'third_party/PROVENANCE.JSON';
  const root = makeReleaseSurfaceFixture(relativePath, JSON.stringify({ action: REVIEWED_PROVENANCE_TOKEN }));
  try {
    assert.equal(classifyScanPath(relativePath), 'ACTIVE_SOURCE_OR_AUTOMATION');
    const scan = scanRepositoryReleaseSurfaces(root);
    assert.equal(scan.violationCount, 1, JSON.stringify(scan));
    assert.equal(scan.violations[0]?.reasonCode, 'WP0_FORBIDDEN_LEGACY_RELEASE_MECHANISM');
    assert.equal(scan.violations[0]?.file, relativePath);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('an unknown future third-party file remains active and fails closed on a legacy release token', () => {
  const relativePath = 'third_party/future-release-plan.json';
  const root = makeReleaseSurfaceFixture(relativePath, JSON.stringify({ action: REVIEWED_PROVENANCE_TOKEN }));
  try {
    assert.equal(classifyScanPath(relativePath), 'ACTIVE_SOURCE_OR_AUTOMATION');
    const scan = scanRepositoryReleaseSurfaces(root);
    assert.equal(scan.violationCount, 1, JSON.stringify(scan));
    assert.equal(scan.violations[0]?.reasonCode, 'WP0_FORBIDDEN_LEGACY_RELEASE_MECHANISM');
    assert.equal(scan.violations[0]?.file, relativePath);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the reviewed provenance token remains forbidden under an active tools path', () => {
  const relativePath = 'tools/release/future-plan.json';
  const root = makeReleaseSurfaceFixture(relativePath, JSON.stringify({ action: REVIEWED_PROVENANCE_TOKEN }));
  try {
    const scan = scanRepositoryReleaseSurfaces(root);
    assert.equal(scan.violationCount, 1, JSON.stringify(scan));
    assert.equal(scan.violations[0]?.reasonCode, 'WP0_FORBIDDEN_LEGACY_RELEASE_MECHANISM');
    assert.equal(scan.violations[0]?.file, relativePath);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the reviewed WP7 production dependency binding uses an exact non-active classification', () => {
  assert.equal(
    classifyScanPath(REVIEWED_BINDING_PATH),
    'SUPPLY_CHAIN_EVIDENCE',
    `${REVIEWED_BINDING_PATH} must be classified only by the exact reviewed binding authority`
  );
});

test('reviewed WP7 binding inventory does not interpret the Letta postinstall patch filename as an executable legacy release mechanism', () => {
  const root = makeReleaseSurfaceFixture(REVIEWED_BINDING_PATH, reviewedBindingLegacyTokenFixture());
  try {
    const scan = scanRepositoryReleaseSurfaces(root);
    const binding = scan.scannedFiles.find((item) => item.path === REVIEWED_BINDING_PATH);
    assert.equal(binding?.classification, 'SUPPLY_CHAIN_EVIDENCE');
    assert.equal(scan.violationCount, 0, JSON.stringify(scan.violations));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('an unknown future release binding remains active and fails closed on the exact Letta postinstall patch token', () => {
  const relativePath = 'release/future-production-dependency-binding.json';
  const root = makeReleaseSurfaceFixture(relativePath, reviewedBindingLegacyTokenFixture());
  try {
    assert.equal(classifyScanPath(relativePath), 'ACTIVE_SOURCE_OR_AUTOMATION');
    const scan = scanRepositoryReleaseSurfaces(root);
    assert.equal(scan.violationCount, 1, JSON.stringify(scan));
    assert.equal(scan.violations[0]?.reasonCode, 'WP0_FORBIDDEN_LEGACY_RELEASE_MECHANISM');
    assert.equal(scan.violations[0]?.file, relativePath);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the exact Letta postinstall patch token remains forbidden under an active tools path', () => {
  const relativePath = 'tools/release/future-production-dependency-binding.json';
  const root = makeReleaseSurfaceFixture(relativePath, reviewedBindingLegacyTokenFixture());
  try {
    assert.equal(classifyScanPath(relativePath), 'ACTIVE_SOURCE_OR_AUTOMATION');
    const scan = scanRepositoryReleaseSurfaces(root);
    assert.equal(scan.violationCount, 1, JSON.stringify(scan));
    assert.equal(scan.violations[0]?.reasonCode, 'WP0_FORBIDDEN_LEGACY_RELEASE_MECHANISM');
    assert.equal(scan.violations[0]?.file, relativePath);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
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
