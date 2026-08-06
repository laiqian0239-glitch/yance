'use strict';

const crypto = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');

const SHA40 = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const REPOSITORY = 'laiqian0239-glitch/yance';
const WORK_PACKAGE = 'OSS-A';
const AUTHORIZATION_PATH = 'governance/layered-ci/oss-a-source-merge-authorization.json';
const AUTHORIZATION_DOCUMENT_TYPE = 'YANCE_OSS_A_SOURCE_MERGE_POLICY_AUTHORIZATION';
const AUTHORIZATION_STATUS = 'POLICY_AUTHORIZED_AFTER_TRUSTED_MAIN_MERGE_AND_SEAL';
const AUTHORIZATION_SEAL_STATUS = 'SEALED';
const POLICY_PULL_REQUEST = 82;
const POLICY_BRANCH = 'governance/oss-a-source-merge-policy';
const SOURCE_PULL_REQUEST = 67;
const SOURCE_BRANCH = 'oss/a-supply-chain-foundation';
const CHECKPOINT_HEAD = '028535eb6c092c47ad92bce3f0675c7d7b23f22d';
const IMPLEMENTATION_RECEIPT_PATH = 'governance/open-source-acceleration/oss-a-supply-chain-authorization-receipt.json';
const IMPLEMENTATION_DIGEST = 'fb99d7c9b090a0c8b92b5655c401b80f0e0674c6e6f5725bad8264c9ec19a175';
const POLICY_IMPLEMENTATION_PATHS = Object.freeze([
  AUTHORIZATION_PATH,
  'shared/release/openSourceSourceMergeAuthorizationPolicy.js',
  'tests/wp0/open-source-source-merge-authorization.test.js'
]);
const FINAL_SEAL_BRANCH = 'governance/oss-a-source-merge-candidate-seal';
const FINAL_SEAL_PATH = 'governance/layered-ci/oss-a-source-merge-candidate-seal.json';
const CHECKPOINT_WORKFLOW_EVIDENCE = Object.freeze([
  Object.freeze([31084829850, 'success']),
  Object.freeze([31084829808, 'success']),
  Object.freeze([31084830046, 'success']),
  Object.freeze([31084829997, 'success']),
  Object.freeze([31084829858, 'success']),
  Object.freeze([31084829813, 'skipped-by-design'])
]);

function result(pass, reasonCode, details = {}) {
  return Object.freeze({ pass, reasonCode, ...details });
}

function fail(reasonCode, details = {}) {
  return result(false, reasonCode, details);
}

function pass(reasonCode, details = {}) {
  return result(true, reasonCode, details);
}

function isObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isExactRepositoryPath(value) {
  if (typeof value !== 'string'
    || !value
    || value !== value.trim()
    || value.startsWith('/')
    || value.startsWith('./')
    || value.endsWith('/')
    || value.includes('\\')
    || /^[A-Za-z]:\//u.test(value)
    || /[\u0000-\u001f\u007f]/u.test(value)) return false;
  return value.split('/').every(segment => segment && segment !== '.' && segment !== '..');
}

function normalizePaths(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.filter(isExactRepositoryPath))].sort();
}

function sameArray(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function isExactPathSet(values, expected) {
  if (!Array.isArray(values)
    || !Array.isArray(expected)
    || values.length !== expected.length
    || !values.every(isExactRepositoryPath)
    || new Set(values).size !== values.length) return false;
  return sameArray([...values].sort(), [...expected].sort());
}

function changedFileSetSha256(values) {
  const normalized = normalizePaths(values);
  return crypto.createHash('sha256').update(`${normalized.join('\n')}\n`, 'utf8').digest('hex');
}

function isPositiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function validateCheckpointIdentity(document) {
  const checkpoint = document.reviewedImplementationCheckpoint;
  if (!isObject(checkpoint)
    || checkpoint.pullRequest !== SOURCE_PULL_REQUEST
    || checkpoint.branch !== SOURCE_BRANCH
    || checkpoint.baseBranch !== 'main'
    || checkpoint.implementationBaseCommit !== document.base.commit
    || checkpoint.exactHead !== CHECKPOINT_HEAD
    || checkpoint.candidateChangedFileCount !== 24
    || checkpoint.implementationChangedFileCount !== 23
    || checkpoint.implementationChangedFileSetSha256 !== IMPLEMENTATION_DIGEST
    || checkpoint.implementationReceiptPath !== IMPLEMENTATION_RECEIPT_PATH
    || checkpoint.structuredIndependentReviewId !== 4872646973
    || checkpoint.reviewDecision !== 'ALLOW_MERGE'
    || checkpoint.reviewP0 !== 0
    || checkpoint.reviewP1 !== 0
    || checkpoint.unresolvedReviewThreads !== 0
    || checkpoint.isFinalSourceMergeHead !== false) {
    return fail('CHECKPOINT_IDENTITY_INVALID');
  }
  return pass('CHECKPOINT_IDENTITY_VALID');
}

function validateCheckpointEvidenceShape(document) {
  const evidence = document.exactCheckpointEvidence;
  if (!isObject(evidence)
    || evidence.ossProvenanceRunId !== 31084829850
    || evidence.stageWp0RunId !== 31084829808
    || evidence.layeredCiRunId !== 31084830046
    || evidence.acv2RunId !== 31084829997
    || evidence.wpAPostMergeValidationRunId !== 31084829858
    || evidence.promotionAuthorizationRunId !== 31084829813
    || evidence.promotionAuthorizationConclusion !== 'skipped-by-design'
    || evidence.allRequiredRunsGreen !== true
    || evidence.futurePolicyMustVerifyEvidenceThroughTrustedAdapters !== true
    || evidence.selfAssertedRunConclusionsAreInsufficient !== true) {
    return fail('CHECKPOINT_EVIDENCE_SHAPE_INVALID');
  }
  return pass('CHECKPOINT_EVIDENCE_SHAPE_VALID');
}

function validateImplementationScope(document) {
  const implementation = document.implementation;
  const normalized = normalizePaths(implementation?.allowedChangedPaths);
  if (!isObject(implementation)
    || implementation.branch !== POLICY_BRANCH
    || implementation.requiredBase !== 'the exact ordinary main merge commit containing this authorization'
    || !sameArray(normalized, POLICY_IMPLEMENTATION_PATHS)
    || !sameArray(implementation.allowedChangedPaths, POLICY_IMPLEMENTATION_PATHS)
    || implementation.approvedChangedFileCount !== POLICY_IMPLEMENTATION_PATHS.length
    || implementation.approvedChangedFileSetSha256 !== changedFileSetSha256(POLICY_IMPLEMENTATION_PATHS)
    || implementation.authorizationFileMayOnlyAddTrustedMergeSealAndPolicyBinding !== true
    || implementation.newDependencyAllowed !== false
    || implementation.workflowModificationAllowed !== false
    || implementation.productRouteImplementationAllowed !== false
    || implementation.oss1aSpecificRoleCopyAllowed !== false) {
    return fail('POLICY_IMPLEMENTATION_SCOPE_INVALID');
  }
  return pass('POLICY_IMPLEMENTATION_SCOPE_VALID');
}

function validateGovernanceClosure(document) {
  const governance = document.governance;
  if (!isObject(governance)
    || governance.authorizationPredatesImplementation !== true
    || governance.twoPhasePolicySealRequired !== true
    || governance.reviewedCodeAndEvidenceTipSeparated !== true
    || governance.separateFinalCandidateSealRequired !== true
    || governance.exactPathScopeOnly !== true
    || governance.independentBranchAndPullRequestRequired !== true
    || governance.pr67MustRemainDraftThroughPolicyImplementation !== true
    || governance.sourceMergeDirectlyAuthorized !== false
    || governance.productionUseAuthorized !== false
    || governance.formalRelease !== false
    || governance.publish !== false
    || governance.readyForPromotion !== false
    || governance.automaticNextWorkPackageAuthorization !== false) {
    return fail('POLICY_GOVERNANCE_CLOSURE_INVALID');
  }
  return pass('POLICY_GOVERNANCE_CLOSURE_VALID');
}

function validateAuthorizationSeal(document) {
  const seal = document.requiredAuthorizationSeal;
  const binding = document.policyBinding;
  if (!isObject(seal)
    || seal.status !== AUTHORIZATION_SEAL_STATUS
    || !SHA40.test(String(seal.authorizationMergeCommit || ''))
    || seal.authorizationMergeFirstParent !== document.base.commit
    || !SHA40.test(String(seal.authorizationReviewedHead || ''))
    || !SHA40.test(String(seal.authorizationOriginalBlobSha || ''))
    || !SHA256.test(String(seal.authorizationOriginalFileSha256 || ''))
    || !SHA40.test(String(seal.policyReviewedHead || ''))
    || seal.exactTwoParentOrderRequired !== true
    || seal.sealMayNotChangeCheckpointIdentityOrImplementationScope !== true
    || !isObject(binding)
    || !SHA40.test(String(binding.redHead || ''))
    || binding.reviewedHead !== seal.policyReviewedHead
    || binding.branch !== POLICY_BRANCH
    || binding.allowedPostReviewCommitsClassification !== 'GOVERNANCE_METADATA_ONLY'
    || !sameArray(binding.allowedPostReviewPaths, [AUTHORIZATION_PATH])) {
    return fail('POLICY_AUTHORIZATION_SEAL_INVALID');
  }
  return pass('POLICY_AUTHORIZATION_SEAL_VALID');
}

function validatePolicyAuthorization(document) {
  if (!isObject(document)
    || document.schemaVersion !== 1
    || document.documentType !== AUTHORIZATION_DOCUMENT_TYPE
    || document.repository !== REPOSITORY
    || document.workPackage !== WORK_PACKAGE
    || document.status !== AUTHORIZATION_STATUS
    || document.base?.branch !== 'main'
    || !SHA40.test(String(document.base?.commit || ''))
    || document.authorizationBranch?.name !== 'governance/oss-a-source-merge-authorization'
    || document.authorizationBranch?.mustRemainSingleFile !== true
    || !sameArray(document.authorizationBranch?.allowedChangedPaths, [AUTHORIZATION_PATH])) {
    return fail('POLICY_AUTHORIZATION_IDENTITY_INVALID');
  }
  if (document.requiredAuthorizationSeal?.status !== AUTHORIZATION_SEAL_STATUS) {
    return fail('POLICY_AUTHORIZATION_UNSEALED');
  }
  for (const validator of [
    validateCheckpointIdentity,
    validateCheckpointEvidenceShape,
    validateImplementationScope,
    validateGovernanceClosure,
    validateAuthorizationSeal
  ]) {
    const validation = validator(document);
    if (!validation.pass) return validation;
  }
  return pass('POLICY_AUTHORIZATION_VALID', {
    policyReviewedHead: document.requiredAuthorizationSeal.policyReviewedHead,
    implementationChangedFileSetSha256: document.implementation.approvedChangedFileSetSha256
  });
}

function verifyCheckpointEvidence(document, evidence) {
  if (!isObject(evidence)
    || typeof evidence.verifyWorkflowRun !== 'function'
    || typeof evidence.verifyStructuredReview !== 'function') {
    return false;
  }
  for (const [runId, conclusion] of CHECKPOINT_WORKFLOW_EVIDENCE) {
    if (evidence.verifyWorkflowRun(runId, conclusion) !== true) return false;
  }
  const checkpoint = document.reviewedImplementationCheckpoint;
  return evidence.verifyStructuredReview({
    id: checkpoint.structuredIndependentReviewId,
    decision: checkpoint.reviewDecision,
    p0: checkpoint.reviewP0,
    p1: checkpoint.reviewP1,
    unresolvedThreads: checkpoint.unresolvedReviewThreads
  }) === true;
}

function evaluatePolicyImplementation({ authorization, graph, evidence } = {}) {
  const authorizationResult = validatePolicyAuthorization(authorization);
  if (!authorizationResult.pass) return authorizationResult;
  if (!isObject(graph)
    || typeof graph.commitParents !== 'function'
    || typeof graph.blobAt !== 'function'
    || typeof graph.fileSha256At !== 'function'
    || typeof graph.jsonAt !== 'function'
    || typeof graph.isAncestor !== 'function'
    || typeof graph.remoteTip !== 'function'
    || typeof graph.changedFilesBetween !== 'function'
    || typeof graph.commitsBetween !== 'function') {
    return fail('POLICY_GRAPH_ADAPTER_INVALID');
  }
  const seal = authorization.requiredAuthorizationSeal;
  const binding = authorization.policyBinding;
  const parents = graph.commitParents(seal.authorizationMergeCommit);
  if (!sameArray(parents, [seal.authorizationMergeFirstParent, seal.authorizationReviewedHead])) {
    return fail('AUTHORIZATION_MERGE_IDENTITY_INVALID');
  }
  if (graph.blobAt(seal.authorizationReviewedHead, AUTHORIZATION_PATH) !== seal.authorizationOriginalBlobSha
    || graph.fileSha256At(seal.authorizationReviewedHead, AUTHORIZATION_PATH) !== seal.authorizationOriginalFileSha256) {
    return fail('AUTHORIZATION_ORIGINAL_IDENTITY_INVALID');
  }
  if (!verifyCheckpointEvidence(authorization, evidence)) {
    return fail('CHECKPOINT_EVIDENCE_INVALID');
  }
  if (graph.isAncestor(seal.authorizationMergeCommit, binding.reviewedHead) !== true) {
    return fail('POLICY_REVIEWED_HEAD_ANCESTRY_INVALID');
  }
  const implementationPaths = graph.changedFilesBetween(
    seal.authorizationMergeCommit,
    binding.reviewedHead
  );
  if (!isExactPathSet(implementationPaths, POLICY_IMPLEMENTATION_PATHS)
    || !isExactPathSet(implementationPaths, authorization.implementation.allowedChangedPaths)) {
    return fail('POLICY_IMPLEMENTATION_SCOPE_INVALID');
  }
  const policyTip = graph.remoteTip(binding.branch);
  if (!SHA40.test(String(policyTip || ''))
    || policyTip === binding.reviewedHead
    || graph.isAncestor(binding.reviewedHead, policyTip) !== true) {
    return fail('POLICY_BRANCH_TIP_INVALID');
  }
  const postReviewPaths = graph.changedFilesBetween(binding.reviewedHead, policyTip);
  const postReviewCommits = graph.commitsBetween(binding.reviewedHead, policyTip);
  if (!isExactPathSet(postReviewPaths, binding.allowedPostReviewPaths)
    || !Array.isArray(postReviewCommits)
    || postReviewCommits.length !== 1
    || postReviewCommits[0] !== policyTip) {
    return fail('POLICY_POST_REVIEW_SCOPE_INVALID');
  }
  if (!isDeepStrictEqual(graph.jsonAt(policyTip, AUTHORIZATION_PATH), authorization)) {
    return fail('POLICY_DOCUMENT_SOURCE_INVALID');
  }
  return pass('POLICY_IMPLEMENTATION_AUTHORIZED', {
    policyReviewedHead: binding.reviewedHead,
    policyBranchTip: policyTip,
    authorizationMergeCommit: seal.authorizationMergeCommit
  });
}

function validateFinalCandidateGovernance(seal) {
  const governance = seal.governance;
  if (!isObject(governance)
    || governance.singleFileSeal !== true
    || governance.remainUnmergedUntilConsumed !== true
    || governance.explicitUserApprovalRequired !== true
    || governance.productionUseAuthorized !== false
    || governance.formalRelease !== false
    || governance.publish !== false
    || governance.readyForPromotion !== false
    || governance.automaticNextWorkPackageAuthorization !== false) {
    return fail('FINAL_CANDIDATE_GOVERNANCE_CLOSURE_INVALID');
  }
  return pass('FINAL_CANDIDATE_GOVERNANCE_CLOSURE_VALID');
}

function validateFinalCandidateSeal(seal, authorization) {
  const authorizationResult = validatePolicyAuthorization(authorization);
  if (!authorizationResult.pass) return authorizationResult;
  if (!isObject(seal)
    || seal.schemaVersion !== 1
    || seal.documentType !== 'YANCE_OSS_A_SOURCE_MERGE_CANDIDATE_SEAL'
    || seal.repository !== REPOSITORY
    || seal.workPackage !== WORK_PACKAGE
    || seal.status !== 'FINAL_CANDIDATE_SEALED'
    || seal.authorizationPath !== AUTHORIZATION_PATH
    || seal.authorizationMergeCommit !== authorization.requiredAuthorizationSeal.authorizationMergeCommit
    || seal.policyPullRequest !== POLICY_PULL_REQUEST
    || seal.policyBranch !== POLICY_BRANCH
    || seal.policyReviewedHead !== authorization.requiredAuthorizationSeal.policyReviewedHead
    || !SHA40.test(String(seal.policyBranchTip || ''))
    || seal.policyBranchTip === seal.policyReviewedHead
    || !SHA40.test(String(seal.policyMergeFirstParent || ''))
    || seal.policyMergeFirstParent === seal.policyBranchTip
    || !SHA40.test(String(seal.policyMainCommit || ''))
    || seal.trustedMain !== seal.policyMainCommit
    || seal.sourcePullRequest !== SOURCE_PULL_REQUEST
    || seal.sourceBranch !== SOURCE_BRANCH
    || !SHA40.test(String(seal.sourceHead || ''))
    || seal.checkpointHead !== CHECKPOINT_HEAD
    || seal.implementationReceiptPath !== IMPLEMENTATION_RECEIPT_PATH
    || seal.candidateChangedFileCount !== 24
    || seal.implementationChangedFileCount !== 23
    || seal.implementationChangedFileSetSha256 !== IMPLEMENTATION_DIGEST
    || !isObject(seal.exactHeadEvidence)
    || seal.exactHeadEvidence.allRequiredRunsGreen !== true
    || !isPositiveInteger(seal.exactHeadEvidence.ossProvenanceRunId)
    || !isPositiveInteger(seal.exactHeadEvidence.stageWp0RunId)
    || !isPositiveInteger(seal.exactHeadEvidence.layeredCiRunId)
    || !isPositiveInteger(seal.exactHeadEvidence.acv2RunId)
    || !isPositiveInteger(seal.exactHeadEvidence.wpAPostMergeValidationRunId)
    || !isObject(seal.independentReview)
    || seal.independentReview.decision !== 'ALLOW_MERGE'
    || seal.independentReview.p0 !== 0
    || seal.independentReview.p1 !== 0
    || seal.independentReview.unresolvedThreads !== 0) {
    return fail('FINAL_CANDIDATE_SEAL_INVALID');
  }
  if (seal.sourceHead === seal.checkpointHead) {
    return fail('FINAL_CANDIDATE_NOT_REFRESHED');
  }
  if (seal.receiptImplementationBaseCommit !== seal.trustedMain) {
    return fail('FINAL_CANDIDATE_BASE_INVALID');
  }
  const governance = validateFinalCandidateGovernance(seal);
  if (!governance.pass) return governance;
  return pass('FINAL_CANDIDATE_SEAL_VALID', {
    sourceHead: seal.sourceHead,
    trustedMain: seal.trustedMain,
    implementationChangedFileSetSha256: seal.implementationChangedFileSetSha256
  });
}

function validateSealPullRequest(sealPullRequest, finalSeal, graph) {
  if (!isObject(sealPullRequest)
    || sealPullRequest.branch !== FINAL_SEAL_BRANCH
    || sealPullRequest.base !== finalSeal.trustedMain
    || !SHA40.test(String(sealPullRequest.exactHead || ''))
    || !isExactPathSet(sealPullRequest.changedFiles, [FINAL_SEAL_PATH])
    || sealPullRequest.merged !== false
    || sealPullRequest.state !== 'open'
    || sealPullRequest.explicitUserApproval !== true
    || graph.remoteTip(FINAL_SEAL_BRANCH) !== sealPullRequest.exactHead
    || !isExactPathSet(
      graph.changedFilesBetween(finalSeal.trustedMain, sealPullRequest.exactHead),
      [FINAL_SEAL_PATH]
    )) {
    return fail('FINAL_CANDIDATE_SEAL_PR_INVALID');
  }
  if (!isDeepStrictEqual(
    graph.jsonAt(sealPullRequest.exactHead, FINAL_SEAL_PATH),
    finalSeal
  )) {
    return fail('FINAL_CANDIDATE_SEAL_SOURCE_INVALID');
  }
  return pass('FINAL_CANDIDATE_SEAL_PR_VALID');
}

function evaluateSourceMergeReadiness({
  authorization,
  finalSeal,
  sealPullRequest,
  proposedMergeParents,
  graph,
  evidence
} = {}) {
  const sealResult = validateFinalCandidateSeal(finalSeal, authorization);
  if (!sealResult.pass) return sealResult;
  if (!isObject(graph)
    || typeof graph.commitParents !== 'function'
    || typeof graph.jsonAt !== 'function'
    || typeof graph.remoteTip !== 'function'
    || typeof graph.changedFilesBetween !== 'function'
    || typeof graph.isAncestor !== 'function') {
    return fail('SOURCE_MERGE_GRAPH_ADAPTER_INVALID');
  }
  const prResult = validateSealPullRequest(sealPullRequest, finalSeal, graph);
  if (!prResult.pass) return prResult;
  if (graph.remoteTip(POLICY_BRANCH) !== finalSeal.policyBranchTip
    || graph.isAncestor(finalSeal.policyReviewedHead, finalSeal.policyBranchTip) !== true) {
    return fail('POLICY_BRANCH_TIP_DRIFT');
  }
  if (!sameArray(
    graph.commitParents(finalSeal.policyMainCommit),
    [finalSeal.policyMergeFirstParent, finalSeal.policyBranchTip]
  ) || graph.isAncestor(
    authorization.requiredAuthorizationSeal.authorizationMergeCommit,
    finalSeal.policyMergeFirstParent
  ) !== true) {
    return fail('POLICY_MAIN_MERGE_IDENTITY_INVALID');
  }
  if (!sameArray(proposedMergeParents, [finalSeal.trustedMain, finalSeal.sourceHead])) {
    return fail('SOURCE_MERGE_PARENT_ORDER_INVALID');
  }
  if (graph.remoteTip('main') !== finalSeal.trustedMain) {
    return fail('TRUSTED_MAIN_DRIFT');
  }
  if (graph.remoteTip(finalSeal.sourceBranch) !== finalSeal.sourceHead
    || graph.isAncestor(finalSeal.checkpointHead, finalSeal.sourceHead) !== true
    || graph.isAncestor(finalSeal.policyMainCommit, finalSeal.sourceHead) !== true) {
    return fail('FINAL_SOURCE_HEAD_DRIFT');
  }
  if (!isObject(evidence)
    || typeof evidence.verifyFinalCandidateRuns !== 'function'
    || evidence.verifyFinalCandidateRuns({
      sourceHead: finalSeal.sourceHead,
      allRequiredRunsGreen: finalSeal.exactHeadEvidence.allRequiredRunsGreen,
      exactHeadEvidence: finalSeal.exactHeadEvidence
    }) !== true) {
    return fail('FINAL_CANDIDATE_EVIDENCE_INVALID');
  }
  if (typeof evidence.verifyFinalCandidateReview !== 'function'
    || evidence.verifyFinalCandidateReview({
      sourceHead: finalSeal.sourceHead,
      ...finalSeal.independentReview
    }) !== true) {
    return fail('FINAL_CANDIDATE_REVIEW_INVALID');
  }
  return pass('SOURCE_MERGE_AUTHORIZED', {
    firstParent: finalSeal.trustedMain,
    secondParent: finalSeal.sourceHead,
    sealHead: sealPullRequest.exactHead,
    productionUseAuthorized: false,
    formalReleaseAuthorized: false,
    publishAuthorized: false,
    readyForPromotionAuthorized: false
  });
}

module.exports = {
  AUTHORIZATION_PATH,
  POLICY_IMPLEMENTATION_PATHS,
  FINAL_SEAL_BRANCH,
  FINAL_SEAL_PATH,
  changedFileSetSha256,
  validatePolicyAuthorization,
  evaluatePolicyImplementation,
  validateFinalCandidateSeal,
  evaluateSourceMergeReadiness
};
