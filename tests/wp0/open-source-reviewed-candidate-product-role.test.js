'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  classifyProductRouteBranchRole,
  evaluateProductRouteExecutablePolicy
} = require('../../tools/wp0/product-route-executable-policy');

const SOURCE_BRANCH = 'oss/1a-baileys-lifecycle';
const REVIEWED_BRANCH = 'reviewed-candidate/oss1a-task11';
const REVIEWED_HEAD = '3e3a52ed9dd255ca5ba027a3b12704b5e281448d';
const GOVERNANCE_BASE = '14d6cb6b8c0328d66a1dac4a3ea71f85f8fd7fd0';
const BRANCH_TIP = 'e01a93edc10de165681c4a419f00421ec28788fd';
const EVIDENCE_PATHS = Object.freeze([
  '.github/workflows/oss1a-baileys-lifecycle.yml',
  'governance/open-source-acceleration/oss-1a-reviewed-candidate-task11.json',
  'tests/wp0/oss1a-runtime-workflow.test.js',
  'tools/oss1a/workflow-branch-role.js'
]);

const entry = Object.freeze({
  workPackage: 'OSS-1A',
  authorizedBranch: SOURCE_BRANCH,
  authorizationPath: 'governance/open-source-acceleration/oss-1a-implementation-authorization.json',
  receiptPath: 'governance/open-source-acceleration/oss-1a-authorization-receipt.json'
});

const registry = Object.freeze({
  schemaVersion: 1,
  documentType: 'YANCE_OPEN_SOURCE_WORK_PACKAGE_REGISTRY',
  program: 'Open Source Acceleration',
  repository: 'laiqian0239-glitch/yance',
  entries: [entry],
  governance: {
    explicitEntriesOnly: true,
    directoryAutoDiscoveryAllowed: false,
    exactBranchSelectionOnly: true,
    multipleMatchesFailClosed: true,
    automaticNextWorkPackageAuthorization: false,
    readyForPromotion: false
  }
});

const authorization = Object.freeze({
  workPackage: 'OSS-1A',
  authorizedBranch: SOURCE_BRANCH,
  requiredBaseRef: 'governance/oss-1a-canonical-projection-checkpoint-authorization'
});

const manifest = Object.freeze({
  schemaVersion: 1,
  documentType: 'YANCE_OSS_REVIEWED_CANDIDATE',
  repository: 'laiqian0239-glitch/yance',
  workPackage: 'OSS-1A',
  task: 11,
  pullRequest: 24,
  continuationPullRequest: 51,
  sourceBranch: SOURCE_BRANCH,
  reviewedCandidateBranch: REVIEWED_BRANCH,
  governanceBase: GOVERNANCE_BASE,
  reviewedHead: REVIEWED_HEAD,
  branchTip: BRANCH_TIP,
  reviewedChangedFileCount: 98,
  postReviewEvidencePaths: [...EVIDENCE_PATHS],
  review: {
    id: 4868185392,
    protocolVersion: 1,
    reviewerMode: 'CHATGPT_GITHUB_CONNECTED_SESSION',
    decision: 'ALLOW_MERGE',
    p0Count: 0,
    p1Count: 0,
    temporaryBypassDetected: false,
    missingEvidence: [],
    blockers: []
  },
  requiredEvidence: {
    task11DualPlatformRunId: 31037900425,
    wp0RoutingRepairRunId: 31039773665,
    implementationExactHeadWp0RunId: 31039985555,
    implementationExactHeadOss1aRunId: 31039985632,
    implementationExactHeadProvenanceRunId: 31039985881,
    registrationGovernanceRunId: 31042007637
  },
  governance: {
    exactPostReviewEvidenceOnly: true,
    wildcardAuthorizationAllowed: false,
    temporaryBypassAllowed: false,
    warningOnlyClosureAllowed: false,
    sourceMergeOnly: true,
    productionUseAuthorized: false,
    formalRelease: false,
    automaticNextWorkPackageAuthorization: false
  },
  readyForPromotion: false
});

function candidateOptions(overrides = {}) {
  return {
    registry,
    authorizationByPath: { [entry.authorizationPath]: authorization },
    receiptByPath: { [entry.receiptPath]: { workPackage: 'OSS-1A' } },
    validateAuthorization: () => true,
    validateReceipt: () => true,
    isLegacyImplementationBranch: () => false,
    isOpenSourceImplementationBranch: branch => branch === SOURCE_BRANCH,
    reviewedCandidateManifest: manifest,
    currentHead: BRANCH_TIP,
    resolveRemoteTip: branch => branch === REVIEWED_BRANCH ? BRANCH_TIP : null,
    resolveCommitParents: commit => commit === BRANCH_TIP
      ? [REVIEWED_HEAD, GOVERNANCE_BASE]
      : [],
    changedFilesBetween: (base, head) => base === REVIEWED_HEAD && head === BRANCH_TIP
      ? [...EVIDENCE_PATHS]
      : [],
    ...overrides
  };
}

test('exact manifest-backed reviewed candidate receives an executable source-merge role', () => {
  const role = classifyProductRouteBranchRole(REVIEWED_BRANCH, candidateOptions());
  assert.equal(role.pass, true, JSON.stringify(role));
  assert.equal(role.role, 'REVIEWED_CANDIDATE_EXECUTABLE');
  assert.equal(role.workPackage, 'OSS-1A');
  assert.equal(role.reviewedHead, REVIEWED_HEAD);
  assert.equal(role.branchTip, BRANCH_TIP);
  assert.equal(role.readyForPromotion, false);

  const evaluation = evaluateProductRouteExecutablePolicy({
    branch: REVIEWED_BRANCH,
    ...candidateOptions(),
    verifyGate: () => { throw new Error('generic implementation branch gate must not own reviewed-candidate identity'); },
    evaluateScope: () => { throw new Error('implementation scope must not absorb sealed post-review governance evidence'); }
  });
  assert.equal(evaluation.pass, true, JSON.stringify(evaluation));
  assert.equal(evaluation.mode, 'REVIEWED_CANDIDATE_EXECUTABLE');
  assert.equal(evaluation.readyForPromotion, false);
});

test('reviewed candidate fails closed on tip, parent, evidence-path, or review mismatch', () => {
  const wrongTip = classifyProductRouteBranchRole(REVIEWED_BRANCH, candidateOptions({
    currentHead: 'f'.repeat(40)
  }));
  assert.equal(wrongTip.pass, false);
  assert.equal(wrongTip.reasonCode, 'WP0_PRODUCT_ROUTE_REVIEWED_CANDIDATE_INVALID');

  const wrongParents = classifyProductRouteBranchRole(REVIEWED_BRANCH, candidateOptions({
    resolveCommitParents: () => [GOVERNANCE_BASE, REVIEWED_HEAD]
  }));
  assert.equal(wrongParents.pass, false);
  assert.equal(wrongParents.reasonCode, 'WP0_PRODUCT_ROUTE_REVIEWED_CANDIDATE_INVALID');

  const extraPath = classifyProductRouteBranchRole(REVIEWED_BRANCH, candidateOptions({
    changedFilesBetween: () => [...EVIDENCE_PATHS, 'backend/lib/unreviewed.js']
  }));
  assert.equal(extraPath.pass, false);
  assert.equal(extraPath.reasonCode, 'WP0_PRODUCT_ROUTE_REVIEWED_CANDIDATE_INVALID');

  const blockedReview = classifyProductRouteBranchRole(REVIEWED_BRANCH, candidateOptions({
    reviewedCandidateManifest: {
      ...manifest,
      review: { ...manifest.review, p1Count: 1 }
    }
  }));
  assert.equal(blockedReview.pass, false);
  assert.equal(blockedReview.reasonCode, 'WP0_PRODUCT_ROUTE_REVIEWED_CANDIDATE_INVALID');
});

test('workflow and permanent WP0 consume one shared reviewed-candidate policy authority', () => {
  const resolver = fs.readFileSync(path.resolve(__dirname, '..', '..', 'tools', 'oss1a', 'workflow-branch-role.js'), 'utf8');
  const productPolicy = fs.readFileSync(path.resolve(__dirname, '..', '..', 'tools', 'wp0', 'product-route-executable-policy.js'), 'utf8');
  assert.match(resolver, /openSourceReviewedCandidatePolicy/u);
  assert.match(productPolicy, /openSourceReviewedCandidatePolicy/u);
  assert.doesNotMatch(productPolicy, /reviewed-candidate\/oss1a-task11/u);
});
