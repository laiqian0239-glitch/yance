'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');
const POLICY_PATH = 'governance/layered-ci/oss-first-development-policy.json';
const POLICY_FILE = path.join(ROOT, ...POLICY_PATH.split('/'));
const AUTHORIZATION_PATH = /^governance\/layered-ci\/[a-z0-9][a-z0-9._-]*-authorization\.json$/u;
const ADOPTION_ORDER = Object.freeze([
  'full-product',
  'sidecar-service',
  'source-module',
  'official-sdk-cli-native-prebuild-runtime',
  'existing-repository-seam',
  'thin-yance-adapter',
  'minimal-proven-gap'
]);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function git(args) {
  return String(execFileSync('git', ['-C', ROOT, ...args], { encoding: 'utf8' })).trim();
}

function resolveMainRef() {
  for (const ref of ['refs/remotes/origin/main', 'refs/heads/main']) {
    try {
      const commit = git(['rev-parse', '--verify', `${ref}^{commit}`]);
      if (/^[0-9a-f]{40}$/u.test(commit)) return ref;
    } catch (_) {}
  }
  return null;
}

function changedAuthorizationPaths() {
  const mainRef = resolveMainRef();
  if (!mainRef) return [];
  const mergeBase = git(['merge-base', 'HEAD', mainRef]);
  if (!/^[0-9a-f]{40}$/u.test(mergeBase)) throw new Error('OSS-first gate could not resolve trusted main merge base');
  const output = execFileSync('git', [
    '-C', ROOT,
    '-c', 'core.quotePath=false',
    'diff', '--no-renames', '--diff-filter=AM', '--name-only', '-z',
    mergeBase, 'HEAD', '--', 'governance/layered-ci'
  ]);
  return output.toString('utf8').split('\0').filter(Boolean).filter(file => AUTHORIZATION_PATH.test(file));
}

function assertNonEmptyText(value, label) {
  assert.equal(typeof value, 'string', `${label} must be a string`);
  assert.notEqual(value.trim(), '', `${label} must not be empty`);
}

function assertOssFit(authorization, authorizationPath, policy) {
  const ossFit = authorization.ossFit;
  assert.ok(ossFit && typeof ossFit === 'object' && !Array.isArray(ossFit), `${authorizationPath}: ossFit evidence is required before implementation`);
  assertNonEmptyText(ossFit.decision, `${authorizationPath}: ossFit.decision`);
  assert.equal(typeof ossFit.matureOssAvailable, 'boolean', `${authorizationPath}: ossFit.matureOssAvailable must be boolean`);
  assert.equal(typeof ossFit.newGeneralPurposeInfrastructure, 'boolean', `${authorizationPath}: ossFit.newGeneralPurposeInfrastructure must be boolean`);
  assertNonEmptyText(ossFit.selectedAdoptionMode, `${authorizationPath}: ossFit.selectedAdoptionMode`);
  assert.ok(policy.adoptionOrder.includes(ossFit.selectedAdoptionMode), `${authorizationPath}: selectedAdoptionMode must use repository adoption order`);
  assert.ok(Array.isArray(ossFit.reviewedCandidates) && ossFit.reviewedCandidates.length > 0, `${authorizationPath}: ossFit.reviewedCandidates must record at least one mature OSS or existing repository seam candidate`);
  for (const [index, candidate] of ossFit.reviewedCandidates.entries()) {
    assert.ok(candidate && typeof candidate === 'object' && !Array.isArray(candidate), `${authorizationPath}: reviewedCandidates[${index}] must be an object`);
    for (const field of ['name', 'source', 'license', 'adoptionMode', 'fit', 'reason']) {
      assertNonEmptyText(candidate[field], `${authorizationPath}: reviewedCandidates[${index}].${field}`);
    }
    assert.ok(['FIT', 'PARTIAL_FIT', 'GAP'].includes(candidate.fit), `${authorizationPath}: reviewedCandidates[${index}].fit must be FIT, PARTIAL_FIT, or GAP`);
  }
  assert.ok(Array.isArray(ossFit.retireOrAvoid) && ossFit.retireOrAvoid.length > 0, `${authorizationPath}: ossFit.retireOrAvoid must state which duplicate Yance paths are retired or forbidden`);
  ossFit.retireOrAvoid.forEach((value, index) => assertNonEmptyText(value, `${authorizationPath}: ossFit.retireOrAvoid[${index}]`));

  if (ossFit.newGeneralPurposeInfrastructure === true || ossFit.selectedAdoptionMode === 'minimal-proven-gap') {
    const gap = ossFit.uncoveredGap;
    assert.ok(gap && typeof gap === 'object' && !Array.isArray(gap), `${authorizationPath}: self-built/minimal-gap work requires ossFit.uncoveredGap`);
    assertNonEmptyText(gap.capability, `${authorizationPath}: ossFit.uncoveredGap.capability`);
    assertNonEmptyText(gap.reason, `${authorizationPath}: ossFit.uncoveredGap.reason`);
    assert.ok(Array.isArray(gap.rejectedAdoptionModes) && gap.rejectedAdoptionModes.length >= 5, `${authorizationPath}: uncoveredGap must explain rejected product/sidecar/module/SDK/repository-seam adoption modes`);
  }
}

test('repository OSS-first development policy is an enforced pre-implementation authority', () => {
  assert.equal(fs.existsSync(POLICY_FILE), true, `missing repository OSS-first policy SSOT: ${POLICY_PATH}`);
  const policy = readJson(POLICY_FILE);
  assert.equal(policy.schemaVersion, 1);
  assert.equal(policy.documentType, 'YANCE_OSS_FIRST_DEVELOPMENT_POLICY');
  assert.equal(policy.status, 'ENFORCED');
  assert.deepEqual(policy.adoptionOrder, ADOPTION_ORDER);
  assert.equal(policy.authorizationEvidenceRequired, true);
  assert.equal(policy.redRepairReevaluationRequired, true);
  assert.equal(policy.retireEquivalentYanceImplementationWhenOssFits, true);
  assert.equal(policy.userMachineBuildEnvironmentForbiddenByDefault, true);
  assert.equal(policy.newGeneralPurposeInfrastructureRequiresProvenGap, true);
  assert.ok(Array.isArray(policy.uatDefaultProhibitions));
  for (const required of ['npm-ci-on-user-machine', 'node-gyp-on-user-machine', 'visual-studio-build-prerequisite', 'spectre-sdk-prerequisite', 'native-addon-compilation-on-user-machine']) {
    assert.ok(policy.uatDefaultProhibitions.includes(required), `OSS-first UAT policy missing prohibition: ${required}`);
  }
});

test('every future changed delegated authorization records auditable OSS-fit before implementation', () => {
  const policy = readJson(POLICY_FILE);
  for (const authorizationPath of changedAuthorizationPaths()) {
    const authorization = readJson(path.join(ROOT, ...authorizationPath.split('/')));
    assertOssFit(authorization, authorizationPath, policy);
  }
});
