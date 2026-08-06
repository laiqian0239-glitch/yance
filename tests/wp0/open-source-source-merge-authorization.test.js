'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const authorizationPath = 'governance/layered-ci/oss-a-source-merge-authorization.json';
const policyModulePath = path.join(repoRoot, 'shared', 'release', 'openSourceSourceMergeAuthorizationPolicy.js');
const authorizationBytes = fs.readFileSync(path.join(repoRoot, authorizationPath));
const checkedInAuthorizationFileSha256 = crypto.createHash('sha256').update(authorizationBytes).digest('hex');
const authorizationTemplate = JSON.parse(authorizationBytes.toString('utf8'));

const BASE = 'ad195d8497ec61fbe3387c606692110f5645fba0';
const AUTH_HEAD = 'f50590181e19cdc134c35d91ae9421af5b532ce8';
const AUTH_MERGE = 'fac7d298f182043f4ecc6e41a780248ce3a03132';
const AUTH_BLOB = '99ee3e5243d07fed5cea6661cb6ad82123771bc8';
const PRE_SEAL_AUTHORIZATION_FILE_SHA256 = 'a9c6022c7a59e49dd3c4c957d6e7e56de70697b84609f338d00a4cc5c07fe0fd';
const RED_HEAD = '1111111111111111111111111111111111111111';
const POLICY_HEAD = '2222222222222222222222222222222222222222';
const POLICY_TIP = '3333333333333333333333333333333333333333';
const POLICY_MAIN = '4444444444444444444444444444444444444444';
const FINAL_HEAD = '5555555555555555555555555555555555555555';
const SEAL_TIP = '6666666666666666666666666666666666666666';
const CHECKPOINT_HEAD = '028535eb6c092c47ad92bce3f0675c7d7b23f22d';
const IMPLEMENTATION_DIGEST = 'fb99d7c9b090a0c8b92b5655c401b80f0e0674c6e6f5725bad8264c9ec19a175';
const IMPLEMENTATION_PATHS = [
  authorizationPath,
  'shared/release/openSourceSourceMergeAuthorizationPolicy.js',
  'tests/wp0/open-source-source-merge-authorization.test.js'
];
const SEAL_PATH = 'governance/layered-ci/oss-a-source-merge-candidate-seal.json';

function loadPolicy() {
  assert.equal(fs.existsSync(policyModulePath), true, 'source-merge authorization policy must exist');
  return require(policyModulePath);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function unsealedAuthorization() {
  const value = clone(authorizationTemplate);
  value.status = 'POLICY_AUTHORIZED_AFTER_TRUSTED_MAIN_MERGE_AND_SEAL';
  value.requiredAuthorizationSeal = {
    ...value.requiredAuthorizationSeal,
    authorizationMergeCommit: 'TO_BE_SEALED_AFTER_ORDINARY_MAIN_MERGE',
    authorizationMergeFirstParent: BASE,
    authorizationReviewedHead: 'TO_BE_SEALED_FROM_THIS_BRANCH_FINAL_EXACT_HEAD',
    authorizationOriginalBlobSha: 'TO_BE_SEALED_FROM_THIS_FILE_AT_FINAL_EXACT_HEAD',
    authorizationOriginalFileSha256: 'TO_BE_SEALED_FROM_THIS_FILE_AT_FINAL_EXACT_HEAD',
    policyReviewedHead: 'TO_BE_RECORDED_BY_LATER_EVIDENCE_COMMIT'
  };
  delete value.policyBinding;
  return value;
}

function sealedAuthorization() {
  const value = clone(authorizationTemplate);
  value.status = 'POLICY_AUTHORIZATION_SEALED';
  value.requiredAuthorizationSeal = {
    ...value.requiredAuthorizationSeal,
    authorizationMergeCommit: AUTH_MERGE,
    authorizationMergeFirstParent: BASE,
    authorizationReviewedHead: AUTH_HEAD,
    authorizationOriginalBlobSha: AUTH_BLOB,
    authorizationOriginalFileSha256: PRE_SEAL_AUTHORIZATION_FILE_SHA256,
    policyReviewedHead: POLICY_HEAD
  };
  value.policyBinding = {
    redHead: RED_HEAD,
    reviewedHead: POLICY_HEAD,
    branch: 'governance/oss-a-source-merge-policy',
    allowedPostReviewCommitsClassification: 'GOVERNANCE_METADATA_ONLY',
    allowedPostReviewPaths: [authorizationPath]
  };
  return value;
}

function validEvidence() {
  return {
    verifyWorkflowRun(id, conclusion) {
      const expected = new Map([
        [31084829850, 'success'],
        [31084829808, 'success'],
        [31084830046, 'success'],
        [31084829997, 'success'],
        [31084829858, 'success'],
        [31084829813, 'skipped-by-design']
      ]);
      return expected.get(id) === conclusion;
    },
    verifyStructuredReview(values) {
      return values.id === 4872646973
        && values.decision === 'ALLOW_MERGE'
        && values.p0 === 0
        && values.p1 === 0
        && values.unresolvedThreads === 0;
    },
    verifyFinalCandidateRuns(values) {
      return values.sourceHead === FINAL_HEAD && values.allRequiredRunsGreen === true;
    },
    verifyFinalCandidateReview(values) {
      return values.sourceHead === FINAL_HEAD
        && values.decision === 'ALLOW_MERGE'
        && values.p0 === 0
        && values.p1 === 0
        && values.unresolvedThreads === 0;
    }
  };
}

function validGraph() {
  return {
    commitParents(sha) {
      if (sha === AUTH_MERGE) return [BASE, AUTH_HEAD];
      if (sha === POLICY_MAIN) return [AUTH_MERGE, POLICY_TIP];
      return [];
    },
    blobAt(commit, repositoryPath) {
      return commit === AUTH_HEAD && repositoryPath === authorizationPath ? AUTH_BLOB : null;
    },
    fileSha256At(commit, repositoryPath) {
      return commit === AUTH_HEAD && repositoryPath === authorizationPath
        ? PRE_SEAL_AUTHORIZATION_FILE_SHA256
        : null;
    },
    isAncestor(ancestor, descendant) {
      const valid = new Set([
        `${AUTH_MERGE}:${POLICY_HEAD}`,
        `${POLICY_HEAD}:${POLICY_TIP}`,
        `${CHECKPOINT_HEAD}:${FINAL_HEAD}`,
        `${POLICY_MAIN}:${FINAL_HEAD}`
      ]);
      return ancestor === descendant || valid.has(`${ancestor}:${descendant}`);
    },
    remoteTip(branch) {
      if (branch === 'governance/oss-a-source-merge-policy') return POLICY_TIP;
      if (branch === 'governance/oss-a-source-merge-candidate-seal') return SEAL_TIP;
      if (branch === 'oss/a-supply-chain-foundation') return FINAL_HEAD;
      if (branch === 'main') return POLICY_MAIN;
      return null;
    },
    changedFilesBetween(base, head) {
      if (base === AUTH_MERGE && head === POLICY_HEAD) return [...IMPLEMENTATION_PATHS];
      if (base === POLICY_HEAD && head === POLICY_TIP) return [authorizationPath];
      if (base === POLICY_MAIN && head === SEAL_TIP) return [SEAL_PATH];
      return [];
    },
    commitsBetween(base, head) {
      if (base === POLICY_HEAD && head === POLICY_TIP) return [POLICY_TIP];
      return [];
    }
  };
}

function finalCandidateSeal() {
  return {
    schemaVersion: 1,
    documentType: 'YANCE_OSS_A_SOURCE_MERGE_CANDIDATE_SEAL',
    repository: 'laiqian0239-glitch/yance',
    workPackage: 'OSS-A',
    status: 'FINAL_CANDIDATE_SEALED',
    authorizationPath,
    authorizationMergeCommit: AUTH_MERGE,
    policyMainCommit: POLICY_MAIN,
    trustedMain: POLICY_MAIN,
    sourcePullRequest: 67,
    sourceBranch: 'oss/a-supply-chain-foundation',
    sourceHead: FINAL_HEAD,
    checkpointHead: CHECKPOINT_HEAD,
    implementationReceiptPath: 'governance/open-source-acceleration/oss-a-supply-chain-authorization-receipt.json',
    receiptImplementationBaseCommit: POLICY_MAIN,
    candidateChangedFileCount: 24,
    implementationChangedFileCount: 23,
    implementationChangedFileSetSha256: IMPLEMENTATION_DIGEST,
    exactHeadEvidence: {
      allRequiredRunsGreen: true,
      ossProvenanceRunId: 9001,
      stageWp0RunId: 9002,
      layeredCiRunId: 9003,
      acv2RunId: 9004,
      wpAPostMergeValidationRunId: 9005
    },
    independentReview: {
      decision: 'ALLOW_MERGE',
      p0: 0,
      p1: 0,
      unresolvedThreads: 0
    },
    governance: {
      singleFileSeal: true,
      remainUnmergedUntilConsumed: true,
      explicitUserApprovalRequired: true,
      productionUseAuthorized: false,
      formalRelease: false,
      publish: false,
      readyForPromotion: false,
      automaticNextWorkPackageAuthorization: false
    }
  };
}

function validSealPullRequest() {
  return {
    branch: 'governance/oss-a-source-merge-candidate-seal',
    exactHead: SEAL_TIP,
    base: POLICY_MAIN,
    changedFiles: [SEAL_PATH],
    merged: false,
    state: 'open',
    explicitUserApproval: true
  };
}

test('preserves the exact pre-seal authorization identity across the evidence commit', () => {
  assert.match(PRE_SEAL_AUTHORIZATION_FILE_SHA256, /^[0-9a-f]{64}$/u);
  if (authorizationTemplate.status === 'POLICY_AUTHORIZATION_SEALED') {
    assert.equal(
      authorizationTemplate.requiredAuthorizationSeal.authorizationOriginalFileSha256,
      PRE_SEAL_AUTHORIZATION_FILE_SHA256
    );
    assert.notEqual(checkedInAuthorizationFileSha256, PRE_SEAL_AUTHORIZATION_FILE_SHA256);
  } else {
    assert.equal(authorizationTemplate.status, 'POLICY_AUTHORIZED_AFTER_TRUSTED_MAIN_MERGE_AND_SEAL');
    assert.equal(checkedInAuthorizationFileSha256, PRE_SEAL_AUTHORIZATION_FILE_SHA256);
  }
  console.log(`# authorization_file_sha256 ${PRE_SEAL_AUTHORIZATION_FILE_SHA256}`);
});

test('unsealed policy authorization fails closed', () => {
  const { validatePolicyAuthorization } = loadPolicy();
  const result = validatePolicyAuthorization(unsealedAuthorization());
  assert.equal(result.pass, false);
  assert.equal(result.reasonCode, 'POLICY_AUTHORIZATION_UNSEALED');
});

test('sealed policy authorization validates exact checkpoint, closure and implementation scope', () => {
  const { validatePolicyAuthorization } = loadPolicy();
  assert.equal(validatePolicyAuthorization(sealedAuthorization()).pass, true);

  const drift = sealedAuthorization();
  drift.reviewedImplementationCheckpoint.implementationChangedFileCount = 22;
  assert.equal(validatePolicyAuthorization(drift).reasonCode, 'CHECKPOINT_IDENTITY_INVALID');

  const widened = sealedAuthorization();
  widened.implementation.allowedChangedPaths.push('shared/release/parallel-authority.js');
  assert.equal(validatePolicyAuthorization(widened).reasonCode, 'POLICY_IMPLEMENTATION_SCOPE_INVALID');

  const production = sealedAuthorization();
  production.governance.productionUseAuthorized = true;
  assert.equal(validatePolicyAuthorization(production).reasonCode, 'POLICY_GOVERNANCE_CLOSURE_INVALID');
});

test('policy implementation authority verifies merge identity, trusted evidence and reviewed-code topology', () => {
  const { evaluatePolicyImplementation } = loadPolicy();
  const authorization = sealedAuthorization();
  assert.equal(evaluatePolicyImplementation({ authorization, graph: validGraph(), evidence: validEvidence() }).pass, true);

  const wrongParents = validGraph();
  wrongParents.commitParents = () => [AUTH_HEAD, BASE];
  assert.equal(evaluatePolicyImplementation({ authorization, graph: wrongParents, evidence: validEvidence() }).reasonCode, 'AUTHORIZATION_MERGE_IDENTITY_INVALID');

  const extraPath = validGraph();
  extraPath.changedFilesBetween = (base, head) => (
    base === AUTH_MERGE && head === POLICY_HEAD
      ? [...IMPLEMENTATION_PATHS, 'shared/release/parallel-authority.js']
      : base === POLICY_HEAD && head === POLICY_TIP
        ? [authorizationPath]
        : []
  );
  assert.equal(evaluatePolicyImplementation({ authorization, graph: extraPath, evidence: validEvidence() }).reasonCode, 'POLICY_IMPLEMENTATION_SCOPE_INVALID');

  const untrustedEvidence = validEvidence();
  untrustedEvidence.verifyWorkflowRun = () => false;
  assert.equal(evaluatePolicyImplementation({ authorization, graph: validGraph(), evidence: untrustedEvidence }).reasonCode, 'CHECKPOINT_EVIDENCE_INVALID');
});

test('policy evidence tip may contain only the authorization metadata path', () => {
  const { evaluatePolicyImplementation } = loadPolicy();
  const graph = validGraph();
  graph.changedFilesBetween = (base, head) => (
    base === AUTH_MERGE && head === POLICY_HEAD
      ? [...IMPLEMENTATION_PATHS]
      : base === POLICY_HEAD && head === POLICY_TIP
        ? [authorizationPath, 'shared/release/openSourceSourceMergeAuthorizationPolicy.js']
        : []
  );
  assert.equal(evaluatePolicyImplementation({ authorization: sealedAuthorization(), graph, evidence: validEvidence() }).reasonCode, 'POLICY_POST_REVIEW_SCOPE_INVALID');
});

test('final candidate seal preserves refreshed main, receipt base, 23-path digest and non-production closure', () => {
  const { validateFinalCandidateSeal } = loadPolicy();
  assert.equal(validateFinalCandidateSeal(finalCandidateSeal(), sealedAuthorization()).pass, true);

  const stale = finalCandidateSeal();
  stale.sourceHead = CHECKPOINT_HEAD;
  assert.equal(validateFinalCandidateSeal(stale, sealedAuthorization()).reasonCode, 'FINAL_CANDIDATE_NOT_REFRESHED');

  const wrongBase = finalCandidateSeal();
  wrongBase.receiptImplementationBaseCommit = BASE;
  assert.equal(validateFinalCandidateSeal(wrongBase, sealedAuthorization()).reasonCode, 'FINAL_CANDIDATE_BASE_INVALID');

  const release = finalCandidateSeal();
  release.governance.formalRelease = true;
  assert.equal(validateFinalCandidateSeal(release, sealedAuthorization()).reasonCode, 'FINAL_CANDIDATE_GOVERNANCE_CLOSURE_INVALID');
});

test('source-merge readiness requires an open unmerged one-file seal, trusted evidence and exact parent order', () => {
  const { evaluateSourceMergeReadiness } = loadPolicy();
  const options = {
    authorization: sealedAuthorization(),
    finalSeal: finalCandidateSeal(),
    sealPullRequest: validSealPullRequest(),
    proposedMergeParents: [POLICY_MAIN, FINAL_HEAD],
    graph: validGraph(),
    evidence: validEvidence()
  };
  assert.equal(evaluateSourceMergeReadiness(options).pass, true);

  assert.equal(evaluateSourceMergeReadiness({
    ...options,
    proposedMergeParents: [FINAL_HEAD, POLICY_MAIN]
  }).reasonCode, 'SOURCE_MERGE_PARENT_ORDER_INVALID');

  assert.equal(evaluateSourceMergeReadiness({
    ...options,
    sealPullRequest: { ...validSealPullRequest(), merged: true, state: 'closed' }
  }).reasonCode, 'FINAL_CANDIDATE_SEAL_PR_INVALID');

  const staleMain = validGraph();
  staleMain.remoteTip = branch => branch === 'main' ? BASE : validGraph().remoteTip(branch);
  assert.equal(evaluateSourceMergeReadiness({ ...options, graph: staleMain }).reasonCode, 'TRUSTED_MAIN_DRIFT');

  const untrustedReview = validEvidence();
  untrustedReview.verifyFinalCandidateReview = () => false;
  assert.equal(evaluateSourceMergeReadiness({ ...options, evidence: untrustedReview }).reasonCode, 'FINAL_CANDIDATE_REVIEW_INVALID');
});
