'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  workPackageChangedFilesSha256
} = require('../../shared/release/implementationBranchPolicy');

const ROOT = path.resolve(__dirname, '..', '..');
const VERIFIER_PATH = path.join(ROOT, 'tools', 'layered-ci', 'verify-delegated-product-l2.js');
const AUTHORIZATION_PATH = 'governance/layered-ci/v21-model-brain-p0-v3-final-authorization.json';
const IMPLEMENTATION_BRANCH = 'product/v21-model-brain-p0-v3';
const CANDIDATE_SHA = '7f852691ca89d3089ad1b10837e97cc55a226361';
const EXPECTED_TREE = '4e3c062666f5ff3192dff64cdb38953dc1b57671';
const AUTHORIZATION_MERGE = '86164ecf5aff844a16e6a884f8b1808c69c0c093';
const MODEL_BRAIN_PATH_COUNT = 40;
const MODEL_BRAIN_PATH_DIGEST = '23bf7a688309f488870f82bb9e99b4db4f55eb0c133dc66c3729af55bc3ea401';
const SUPERSEDED_BRANCH = 'governance/v21-delegated-product-l2-p0';
const SUPERSEDED_HEAD = '411a04d55e6771fa4e269cfa218283ae2e748e67';
const ALLOWED_PATHS = Object.freeze([
  '.github/workflows/v21-model-brain-p0-windows.yml',
  'backend/routes/models.js',
  'backend/services/aiBrainOrchestrator.js',
  'backend/services/aiGateway.js'
].sort());

function loadVerifierModule() {
  assert.equal(
    fs.existsSync(VERIFIER_PATH),
    true,
    'delegated-product L2 verifier must exist before this contract can pass'
  );
  delete require.cache[require.resolve(VERIFIER_PATH)];
  const verifier = require(VERIFIER_PATH);
  assert.equal(
    typeof verifier.verifyDelegatedProductL2Candidate,
    'function',
    'verifier must export verifyDelegatedProductL2Candidate'
  );
  return verifier;
}

function loadVerifier() {
  return loadVerifierModule().verifyDelegatedProductL2Candidate;
}

function authorization(overrides = {}) {
  const implementation = {
    branch: IMPLEMENTATION_BRANCH,
    allowedChangedPaths: ALLOWED_PATHS,
    approvedChangedFileCount: ALLOWED_PATHS.length,
    approvedChangedFileSetSha256: workPackageChangedFilesSha256(ALLOWED_PATHS),
    ...overrides.implementation
  };
  return {
    implementation,
    ...overrides,
    implementation
  };
}

function input(overrides = {}) {
  return {
    candidateBranch: IMPLEMENTATION_BRANCH,
    candidateSha: CANDIDATE_SHA,
    expectedTree: EXPECTED_TREE,
    requiredLevel: 'L2',
    suite: 'full_work_package',
    ...overrides
  };
}

function dependencies(overrides = {}) {
  return {
    evaluateAuthority: () => ({
      pass: true,
      authorityMode: 'TRUSTED_MAIN_DELEGATED_GOVERNANCE',
      authorizationPath: AUTHORIZATION_PATH,
      authorizationMergeCommit: AUTHORIZATION_MERGE,
      reviewedAuthorizationHead: '1'.repeat(40),
      unauthorizedPaths: []
    }),
    loadAuthorizationAtTrustedHead: repositoryPath => (
      repositoryPath === AUTHORIZATION_PATH ? authorization() : null
    ),
    resolveCandidateTree: () => EXPECTED_TREE,
    resolveRemoteBranchTip: () => CANDIDATE_SHA,
    resolveChangedFilesBetween: () => [...ALLOWED_PATHS],
    ...overrides
  };
}

test('trusted delegated product exact candidate is eligible only for L2 full_work_package', () => {
  const verify = loadVerifier();
  const result = verify(input(), dependencies());
  assert.equal(result.pass, true);
  assert.equal(result.route, 'DELEGATED_PRODUCT_L2');

  for (const invalid of [
    { requiredLevel: 'L1' },
    { requiredLevel: 'L3' },
    { suite: 'wp0' },
    { suite: 'layered_governance' }
  ]) {
    const rejected = verify(input(invalid), dependencies());
    assert.equal(rejected.pass, false, JSON.stringify(invalid));
    assert.equal(rejected.readyForPromotion, false, JSON.stringify(invalid));
  }
});

test('tree identity mismatch fails closed', () => {
  const verify = loadVerifier();
  const result = verify(input({ expectedTree: '2'.repeat(40) }), dependencies());
  assert.equal(result.pass, false);
  assert.equal(result.reasonCode, 'L2_DELEGATED_PRODUCT_TREE_MISMATCH');
  assert.equal(result.readyForPromotion, false);
});

test('remote branch tip mismatch fails closed', () => {
  const verify = loadVerifier();
  const result = verify(input(), dependencies({
    resolveRemoteBranchTip: () => '3'.repeat(40)
  }));
  assert.equal(result.pass, false);
  assert.equal(result.reasonCode, 'L2_DELEGATED_PRODUCT_REMOTE_REF_MISMATCH');
  assert.equal(result.readyForPromotion, false);
});

test('candidate-owned or unmerged authority cannot spoof delegated product eligibility', () => {
  const verify = loadVerifier();
  let candidateAuthorizationRead = false;
  const result = verify(input(), dependencies({
    evaluateAuthority: () => ({
      pass: false,
      reasonCode: 'WP0_DELEGATED_GOVERNANCE_AUTHORITY_INVALID',
      authorityMode: null,
      unauthorizedPaths: []
    }),
    loadAuthorizationAtCandidate: () => {
      candidateAuthorizationRead = true;
      return authorization();
    }
  }));
  assert.equal(result.pass, false);
  assert.equal(candidateAuthorizationRead, false);
  assert.equal(result.reasonCode, 'WP0_DELEGATED_GOVERNANCE_AUTHORITY_INVALID');
});

test('subset scope is rejected even when every changed path is individually authorized', () => {
  const verify = loadVerifier();
  const result = verify(input(), dependencies({
    resolveChangedFilesBetween: () => ALLOWED_PATHS.slice(0, -1)
  }));
  assert.equal(result.pass, false);
  assert.equal(result.reasonCode, 'L2_DELEGATED_PRODUCT_SCOPE_MISMATCH');
});

test('extra unauthorized path is rejected', () => {
  const verify = loadVerifier();
  const result = verify(input(), dependencies({
    resolveChangedFilesBetween: () => [...ALLOWED_PATHS, 'backend/unreviewed.js'].sort()
  }));
  assert.equal(result.pass, false);
  assert.equal(result.reasonCode, 'L2_DELEGATED_PRODUCT_SCOPE_MISMATCH');
});

test('ambiguous and superseded delegated authorities remain fail closed', () => {
  const verify = loadVerifier();
  for (const reasonCode of [
    'WP0_DELEGATED_GOVERNANCE_AUTHORITY_AMBIGUOUS',
    'WP0_DELEGATED_GOVERNANCE_AUTHORITY_SUPERSEDED',
    'WP0_DELEGATED_GOVERNANCE_SUPERSESSION_INVALID'
  ]) {
    const result = verify(input(), dependencies({
      evaluateAuthority: () => ({
        pass: false,
        reasonCode,
        authorityMode: null,
        unauthorizedPaths: []
      })
    }));
    assert.equal(result.pass, false, reasonCode);
    assert.equal(result.reasonCode, reasonCode, reasonCode);
    assert.equal(result.readyForPromotion, false, reasonCode);
  }
});

test('trusted authorization count and digest must match the exact actual path set', () => {
  const verify = loadVerifier();
  for (const badAuthorization of [
    authorization({ implementation: { approvedChangedFileCount: ALLOWED_PATHS.length + 1 } }),
    authorization({ implementation: { approvedChangedFileSetSha256: 'f'.repeat(64) } })
  ]) {
    const result = verify(input(), dependencies({
      loadAuthorizationAtTrustedHead: () => badAuthorization
    }));
    assert.equal(result.pass, false);
    assert.equal(result.reasonCode, 'L2_DELEGATED_PRODUCT_SCOPE_MISMATCH');
  }
});

test('real Model Brain exact head passes trusted Git L2 full_work_package verification', { timeout: 45000 }, () => {
  const {
    verifyDelegatedProductL2Candidate,
    prepareGitDependencies
  } = loadVerifierModule();
  assert.equal(
    typeof prepareGitDependencies,
    'function',
    'verifier must export its production trusted-Git dependency preparation'
  );

  const realDependencies = prepareGitDependencies(IMPLEMENTATION_BRANCH, CANDIDATE_SHA);
  assert.ok(realDependencies, 'trusted Git identity preparation must resolve current main and exact remote Model Brain ref');

  const result = verifyDelegatedProductL2Candidate(input(), realDependencies);
  assert.equal(result.pass, true, JSON.stringify(result));
  assert.equal(result.reasonCode, null);
  assert.equal(result.route, 'DELEGATED_PRODUCT_L2');
  assert.equal(result.readyForPromotion, false);
  assert.equal(result.candidateBranch, IMPLEMENTATION_BRANCH);
  assert.equal(result.candidateSha, CANDIDATE_SHA);
  assert.equal(result.expectedTree, EXPECTED_TREE);
  assert.equal(result.authorizationPath, AUTHORIZATION_PATH);
  assert.equal(result.authorizationMergeCommit, AUTHORIZATION_MERGE);
  assert.equal(result.changedFileCount, MODEL_BRAIN_PATH_COUNT);
  assert.equal(result.changedFileSetSha256, MODEL_BRAIN_PATH_DIGEST);
});

test('real contaminated V1 branch is revoked by trusted-main V2 supersession', { timeout: 45000 }, () => {
  const {
    verifyDelegatedProductL2Candidate,
    prepareGitDependencies
  } = loadVerifierModule();
  const realDependencies = prepareGitDependencies(SUPERSEDED_BRANCH, SUPERSEDED_HEAD);
  assert.ok(realDependencies, 'trusted Git identity preparation must resolve the preserved contaminated branch');

  const result = verifyDelegatedProductL2Candidate(input({
    candidateBranch: SUPERSEDED_BRANCH,
    candidateSha: SUPERSEDED_HEAD,
    expectedTree: '0'.repeat(40)
  }), realDependencies);
  assert.equal(result.pass, false, JSON.stringify(result));
  assert.equal(result.reasonCode, 'WP0_DELEGATED_GOVERNANCE_AUTHORITY_SUPERSEDED');
  assert.equal(result.route, null);
  assert.equal(result.readyForPromotion, false);
});
