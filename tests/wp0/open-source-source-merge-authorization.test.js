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
const AUTHORIZATION_STATUS = 'POLICY_AUTHORIZED_AFTER_TRUSTED_MAIN_MERGE_AND_SEAL';
const AUTHORIZATION_SEAL_STATUS = 'SEALED';
const PRE_SEAL_AUTHORIZATION_FILE_SHA256 = 'a9c6022c7a59e49dd3c4c957d6e7e56de70697b84609f338d00a4cc5c07fe0fd';
const RED_HEAD = '1111111111111111111111111111111111111111';
const POLICY_HEAD = '2222222222222222222222222222222222222222';
const POLICY_TIP = '3333333333333333333333333333333333333333';
const POLICY_MAIN = '4444444444444444444444444444444444444444';
const FINAL_HEAD = '5555555555555555555555555555555555555555';
const SEAL_TIP = '6666666666666666666666666666666666666666';
const POLICY_BASE = '7777777777777777777777777777777777777777';
const CHECKPOINT_HEAD = '028535eb6c092c47ad92bce3f0675c7d7b23f22d';
const IMPLEMENTATION_DIGEST = 'fb99d7c9b090a0c8b92b5655c401b80f0e0674c6e6f5725bad8264c9ec19a175';
const IMPLEMENTATION_PATHS = [
  authorizationPath,
  'shared/release/openSourceSourceMergeAuthorizationPolicy.js',
  'tests/wp0/open-source-source-merge-authorization.test.js'
];
const POLICY_BRANCH = 'governance/oss-a-source-merge-policy';
const SEAL_BRANCH = 'governance/oss-a-source-merge-candidate-seal';
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
  value.status = AUTHORIZATION_STATUS;
  value.requiredAuthorizationSeal = {
    ...value.requiredAuthorizationSeal,
    authorizationMergeCommit: 'TO_BE_SEALED_AFTER_ORDINARY_MAIN_MERGE',
    authorizationMergeFirstParent: BASE,
    authorizationReviewedHead: 'TO_BE_SEALED_FROM_THIS_BRANCH_FINAL_EXACT_HEAD',
    authorizationOriginalBlobSha: 'TO_BE_SEALED_FROM_THIS_FILE_AT_FINAL_EXACT_HEAD',
    authorizationOriginalFileSha256: 'TO_BE_SEALED_FROM_THIS_FILE_AT_FINAL_EXACT_HEAD',
    policyReviewedHead: 'TO_BE_RECORDED_BY_LATER_EVIDENCE_COMMIT'
  };
  delete value.requiredAuthorizationSeal.status;
  delete value.policyBinding;
  return value;
}

function sealedAuthorization() {
  const value = clone(authorizationTemplate);
  value.status = AUTHORIZATION_STATUS;
  value.requiredAuthorizationSeal = {
    ...value.requiredAuthorizationSeal,
    status: AUTHORIZATION_SEAL_STATUS,
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
    branch: POLICY_BRANCH,
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
      if (sha === POLICY_MAIN) return [POLICY_BASE, POLICY_TIP];
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
    jsonAt(commit, repositoryPath) {
      if (commit === POLICY_TIP && repositoryPath === authorizationPath) return sealedAuthorization();
      if (commit === SEAL_TIP && repositoryPath === SEAL_PATH) return finalCandidateSeal();
      return null;
    },
    isAncestor(ancestor, descendant) {
      const valid = new Set([
        `${AUTH_MERGE}:${RED_HEAD}`,
        `${RED_HEAD}:${POLICY_HEAD}`,
        `${AUTH_MERGE}:${POLICY_BASE}`,
        `${AUTH_MERGE}:${POLICY_HEAD}`,
        `${POLICY_HEAD}:${POLICY_TIP}`,
        `${CHECKPOINT_HEAD}:${FINAL_HEAD}`,
        `${POLICY_MAIN}:${FINAL_HEAD}`
      ]);
      return ancestor === descendant || valid.has(`${ancestor}:${descendant}`);
    },
    remoteTip(branch) {
      if (branch === POLICY_BRANCH) return POLICY_TIP;
      if (branch === SEAL_BRANCH) return SEAL_TIP;
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
    policyPullRequest: 82,
    policyBranch: POLICY_BRANCH,
    policyReviewedHead: POLICY_HEAD,
    policyBranchTip: POLICY_TIP,
    policyMergeFirstParent: POLICY_BASE,
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
    branch: SEAL_BRANCH,
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
  assert.equal(authorizationTemplate.status, AUTHORIZATION_STATUS);
  if (authorizationTemplate.requiredAuthorizationSeal?.status === AUTHORIZATION_SEAL_STATUS) {
    assert.equal(
      authorizationTemplate.requiredAuthorizationSeal.authorizationOriginalFileSha256,
      PRE_SEAL_AUTHORIZATION_FILE_SHA256
    );
    assert.notEqual(checkedInAuthorizationFileSha256, PRE_SEAL_AUTHORIZATION_FILE_SHA256);
  } else {
    assert.equal(authorizationTemplate.requiredAuthorizationSeal?.status, undefined);
    assert.equal(checkedInAuthorizationFileSha256, PRE_SEAL_AUTHORIZATION_FILE_SHA256);
  }
  console.log(`# authorization_file_sha256 ${PRE_SEAL_AUTHORIZATION_FILE_SHA256}`);
});

test('keeps runtime authority identity stable while evidence seal state is orthogonal', () => {
  const unsealed = unsealedAuthorization();
  const sealed = sealedAuthorization();
  assert.equal(unsealed.status, AUTHORIZATION_STATUS);
  assert.equal(sealed.status, AUTHORIZATION_STATUS);
  assert.equal(unsealed.requiredAuthorizationSeal.status, undefined);
  assert.equal(sealed.requiredAuthorizationSeal.status, AUTHORIZATION_SEAL_STATUS);
});

test('rejects the legacy top-level seal state and a missing evidence seal marker', () => {
  const { validatePolicyAuthorization } = loadPolicy();

  const legacyTopLevelSeal = sealedAuthorization();
  legacyTopLevelSeal.status = 'POLICY_AUTHORIZATION_SEALED';
  assert.equal(
    validatePolicyAuthorization(legacyTopLevelSeal).reasonCode,
    'POLICY_AUTHORIZATION_IDENTITY_INVALID'
  );

  const missingSealMarker = sealedAuthorization();
  delete missingSealMarker.requiredAuthorizationSeal.status;
  assert.equal(
    validatePolicyAuthorization(missingSealMarker).reasonCode,
    'POLICY_AUTHORIZATION_UNSEALED'
  );
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

test('declared failure-first topology is mandatory', () => {
  const { validatePolicyAuthorization } = loadPolicy();
  const weakened = sealedAuthorization();
  weakened.policyReviewTopology.redTestCommitMustPrecedeImplementation = false;
  assert.equal(
    validatePolicyAuthorization(weakened).reasonCode,
    'POLICY_AUTHORIZATION_SEAL_INVALID'
  );
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

test('RED Head must follow the authorization merge and precede the reviewed policy Head', () => {
  const { evaluatePolicyImplementation } = loadPolicy();
  const graph = validGraph();
  graph.isAncestor = (ancestor, descendant) => {
    if (ancestor === RED_HEAD && descendant === POLICY_HEAD) return false;
    return validGraph().isAncestor(ancestor, descendant);
  };
  assert.equal(evaluatePolicyImplementation({
    authorization: sealedAuthorization(),
    graph,
    evidence: validEvidence()
  }).reasonCode, 'POLICY_RED_HEAD_ANCESTRY_INVALID');
});

test('adapter path sets reject invalid or duplicate entries instead of normalizing them away', () => {
  const { evaluatePolicyImplementation, evaluateSourceMergeReadiness } = loadPolicy();

  const invalidImplementationPath = validGraph();
  invalidImplementationPath.changedFilesBetween = (base, head) => (
    base === AUTH_MERGE && head === POLICY_HEAD
      ? [...IMPLEMENTATION_PATHS, '../ignored']
      : base === POLICY_HEAD && head === POLICY_TIP
        ? [authorizationPath]
        : []
  );
  assert.equal(evaluatePolicyImplementation({
    authorization: sealedAuthorization(),
    graph: invalidImplementationPath,
    evidence: validEvidence()
  }).reasonCode, 'POLICY_IMPLEMENTATION_SCOPE_INVALID');

  const duplicatePostReviewPath = validGraph();
  duplicatePostReviewPath.changedFilesBetween = (base, head) => (
    base === AUTH_MERGE && head === POLICY_HEAD
      ? [...IMPLEMENTATION_PATHS]
      : base === POLICY_HEAD && head === POLICY_TIP
        ? [authorizationPath, authorizationPath]
        : []
  );
  assert.equal(evaluatePolicyImplementation({
    authorization: sealedAuthorization(),
    graph: duplicatePostReviewPath,
    evidence: validEvidence()
  }).reasonCode, 'POLICY_POST_REVIEW_SCOPE_INVALID');

  const invalidSealPath = validSealPullRequest();
  invalidSealPath.changedFiles = [SEAL_PATH, '../ignored'];
  assert.equal(evaluateSourceMergeReadiness({
    authorization: sealedAuthorization(),
    finalSeal: finalCandidateSeal(),
    sealPullRequest: invalidSealPath,
    proposedMergeParents: [POLICY_MAIN, FINAL_HEAD],
    graph: validGraph(),
    evidence: validEvidence()
  }).reasonCode, 'FINAL_CANDIDATE_SEAL_PR_INVALID');
});

test('policy and final-seal documents must be loaded from their exact remote commit', () => {
  const { evaluatePolicyImplementation, evaluateSourceMergeReadiness } = loadPolicy();

  const forgedAuthorization = sealedAuthorization();
  forgedAuthorization.untrustedAnnotation = 'not committed';
  assert.equal(evaluatePolicyImplementation({
    authorization: forgedAuthorization,
    graph: validGraph(),
    evidence: validEvidence()
  }).reasonCode, 'POLICY_DOCUMENT_SOURCE_INVALID');

  const forgedFinalSeal = finalCandidateSeal();
  forgedFinalSeal.untrustedAnnotation = 'not committed';
  assert.equal(evaluateSourceMergeReadiness({
    authorization: sealedAuthorization(),
    finalSeal: forgedFinalSeal,
    sealPullRequest: validSealPullRequest(),
    proposedMergeParents: [POLICY_MAIN, FINAL_HEAD],
    graph: validGraph(),
    evidence: validEvidence()
  }).reasonCode, 'FINAL_CANDIDATE_SEAL_SOURCE_INVALID');
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

test('final candidate seal preserves refreshed main, policy merge, receipt base, 23-path digest and non-production closure', () => {
  const { validateFinalCandidateSeal } = loadPolicy();
  assert.equal(validateFinalCandidateSeal(finalCandidateSeal(), sealedAuthorization()).pass, true);

  const stale = finalCandidateSeal();
  stale.sourceHead = CHECKPOINT_HEAD;
  assert.equal(validateFinalCandidateSeal(stale, sealedAuthorization()).reasonCode, 'FINAL_CANDIDATE_NOT_REFRESHED');

  const wrongBase = finalCandidateSeal();
  wrongBase.receiptImplementationBaseCommit = BASE;
  assert.equal(validateFinalCandidateSeal(wrongBase, sealedAuthorization()).reasonCode, 'FINAL_CANDIDATE_BASE_INVALID');

  const wrongPolicyHead = finalCandidateSeal();
  wrongPolicyHead.policyReviewedHead = RED_HEAD;
  assert.equal(validateFinalCandidateSeal(wrongPolicyHead, sealedAuthorization()).reasonCode, 'FINAL_CANDIDATE_SEAL_INVALID');

  const release = finalCandidateSeal();
  release.governance.formalRelease = true;
  assert.equal(validateFinalCandidateSeal(release, sealedAuthorization()).reasonCode, 'FINAL_CANDIDATE_GOVERNANCE_CLOSURE_INVALID');
});

test('source-merge readiness proves the policy ordinary merge and exact source parent order', () => {
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

  const wrongPolicyMerge = validGraph();
  wrongPolicyMerge.commitParents = sha => (
    sha === AUTH_MERGE ? [BASE, AUTH_HEAD]
      : sha === POLICY_MAIN ? [POLICY_TIP, POLICY_BASE]
        : []
  );
  assert.equal(evaluateSourceMergeReadiness({
    ...options,
    graph: wrongPolicyMerge
  }).reasonCode, 'POLICY_MAIN_MERGE_IDENTITY_INVALID');

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
