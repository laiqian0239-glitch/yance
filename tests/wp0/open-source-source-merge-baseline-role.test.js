'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  classifyProductRouteBranchRole,
  evaluateProductRouteExecutablePolicy
} = require('../../tools/wp0/product-route-executable-policy');
const workPackagePolicy = require('../../shared/release/openSourceWorkPackagePolicy');

const TARGET_BRANCH = 'governance/oss-1a-canonical-projection-checkpoint-authorization';
const SOURCE_BRANCH = 'oss/1a-baileys-lifecycle';
const REVIEWED_CANDIDATE_BRANCH = 'reviewed-candidate/oss1a-task11';
const REVIEWED_HEAD = '3e3a52ed9dd255ca5ba027a3b12704b5e281448d';
const REVIEWED_CANDIDATE_TIP = 'e01a93edc10de165681c4a419f00421ec28788fd';
const TRUSTED_BASE = 'df10c3059b5cd1f69b8cbca6aaf75ef640c6d914';
const SOURCE_MERGE_COMMIT = '51f924079c020fb165409da9d03d4184d8d2d787';
const CURRENT_HEAD = 'd'.repeat(40);
const AUTHORIZATION_PATH = 'governance/open-source-acceleration/oss-1a-implementation-authorization-v11.json';
const AUTHORIZATION_RECEIPT_PATH = 'governance/open-source-acceleration/oss-1a-authorization-receipt-v11.json';
const SOURCE_MERGE_RECEIPT_PATH = 'governance/open-source-acceleration/oss-1a-source-merge-receipt.json';
const REVIEWED_CANDIDATE_MANIFEST_PATH = 'governance/open-source-acceleration/oss-1a-reviewed-candidate-task11.json';
const POST_MERGE_PATHS = Object.freeze([
  'governance/open-source-acceleration/open-source-work-package-registry.json',
  SOURCE_MERGE_RECEIPT_PATH,
  'shared/release/openSourceSourceMergePolicy.js',
  'shared/release/openSourceWorkPackagePolicy.js',
  'tests/layered-ci/open-source-work-package-registry.test.js',
  'tests/wp0/open-source-source-merge-baseline-role.test.js',
  'tools/wp0/product-route-executable-policy.js'
]);

const entry = Object.freeze({
  workPackage: 'OSS-1A',
  authorizedBranch: SOURCE_BRANCH,
  authorizationPath: AUTHORIZATION_PATH,
  receiptPath: AUTHORIZATION_RECEIPT_PATH,
  sourceMergeReceiptPath: SOURCE_MERGE_RECEIPT_PATH
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
  requiredBaseRef: 'governance/oss-1a-uat-diagnostics-runtime-authorization'
});

const authorizationReceipt = Object.freeze({
  workPackage: 'OSS-1A',
  authorizedBranch: SOURCE_BRANCH,
  authorizationPath: AUTHORIZATION_PATH
});

const reviewedCandidateManifest = Object.freeze({
  schemaVersion: 1,
  documentType: 'YANCE_OSS_REVIEWED_CANDIDATE',
  repository: 'laiqian0239-glitch/yance',
  workPackage: 'OSS-1A',
  task: 11,
  pullRequest: 24,
  continuationPullRequest: 51,
  sourceBranch: SOURCE_BRANCH,
  reviewedCandidateBranch: REVIEWED_CANDIDATE_BRANCH,
  governanceBase: '14d6cb6b8c0328d66a1dac4a3ea71f85f8fd7fd0',
  reviewedHead: REVIEWED_HEAD,
  branchTip: REVIEWED_CANDIDATE_TIP,
  reviewedChangedFileCount: 98,
  postReviewEvidencePaths: [
    '.github/workflows/oss1a-baileys-lifecycle.yml',
    REVIEWED_CANDIDATE_MANIFEST_PATH,
    'tests/wp0/oss1a-runtime-workflow.test.js',
    'tools/oss1a/workflow-branch-role.js'
  ],
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

const sourceMergeReceipt = Object.freeze({
  schemaVersion: 1,
  documentType: 'YANCE_OPEN_SOURCE_SOURCE_MERGE_RECEIPT',
  program: 'Open Source Acceleration',
  repository: 'laiqian0239-glitch/yance',
  workPackage: 'OSS-1A',
  status: 'SOURCE_MERGED_BASELINE_SEALED',
  sourcePullRequest: 51,
  sourceBranch: REVIEWED_CANDIDATE_BRANCH,
  targetBranch: TARGET_BRANCH,
  reviewedCandidateManifestPath: REVIEWED_CANDIDATE_MANIFEST_PATH,
  authorizationPath: AUTHORIZATION_PATH,
  authorizationReceiptPath: AUTHORIZATION_RECEIPT_PATH,
  reviewedHead: REVIEWED_HEAD,
  reviewedCandidateTip: REVIEWED_CANDIDATE_TIP,
  trustedBase: TRUSTED_BASE,
  sourceMergeCommit: SOURCE_MERGE_COMMIT,
  sourceMergeParents: [TRUSTED_BASE, REVIEWED_CANDIDATE_TIP],
  postMergeGovernancePaths: [...POST_MERGE_PATHS],
  evidence: {
    preMergeOss1aRunId: 31045078454,
    preMergeProvenanceRunId: 31045083619,
    preMergeWp0RunId: 31045078580,
    postMergeOss1aRunId: 31045336834,
    postMergeProvenanceRunId: 31045333414,
    postMergeWp0RunId: 31045338002,
    postMergeWp0ProductJobId: 92439521538,
    observedPostMergeReasonCode: 'WP0_PRODUCT_ROUTE_BRANCH_ROLE_UNKNOWN'
  },
  governance: {
    exactParentOrderRequired: true,
    exactPostMergeGovernancePathsOnly: true,
    sourceMergeOnly: true,
    productionUseAuthorized: false,
    formalRelease: false,
    publish: false,
    automaticNextWorkPackageAuthorization: false,
    temporaryBypassAllowed: false,
    warningOnlyClosureAllowed: false,
    readyForPromotion: false
  },
  readyForPromotion: false
});

function options(overrides = {}) {
  return {
    registry,
    authorizationByPath: { [AUTHORIZATION_PATH]: authorization },
    receiptByPath: { [AUTHORIZATION_RECEIPT_PATH]: authorizationReceipt },
    sourceMergeReceiptByPath: { [SOURCE_MERGE_RECEIPT_PATH]: sourceMergeReceipt },
    reviewedCandidateManifest,
    validateAuthorization: () => true,
    validateReceipt: () => true,
    isLegacyImplementationBranch: () => false,
    isOpenSourceImplementationBranch: () => false,
    currentHead: CURRENT_HEAD,
    resolveRemoteTip: branch => branch === TARGET_BRANCH ? CURRENT_HEAD : null,
    resolveCommitParents: commit => commit === SOURCE_MERGE_COMMIT
      ? [TRUSTED_BASE, REVIEWED_CANDIDATE_TIP]
      : [],
    isAncestor: (base, head) => base === SOURCE_MERGE_COMMIT && head === CURRENT_HEAD,
    changedFilesBetween: (base, head) => base === SOURCE_MERGE_COMMIT && head === CURRENT_HEAD
      ? [...POST_MERGE_PATHS]
      : [],
    ...overrides
  };
}

test('exact source merge receipt grants a closed source-merged baseline role', () => {
  const role = classifyProductRouteBranchRole(TARGET_BRANCH, options());
  assert.equal(role.pass, true, JSON.stringify(role));
  assert.equal(role.role, 'SOURCE_MERGED_BASELINE');
  assert.equal(role.workPackage, 'OSS-1A');
  assert.equal(role.sourceMergeCommit, SOURCE_MERGE_COMMIT);
  assert.equal(role.readyForPromotion, false);

  const evaluation = evaluateProductRouteExecutablePolicy({
    branch: TARGET_BRANCH,
    ...options(),
    verifyGate: () => { throw new Error('implementation gate must not own source-merge identity'); },
    evaluateScope: () => { throw new Error('implementation scope must not absorb closure governance paths'); }
  });
  assert.equal(evaluation.pass, true, JSON.stringify(evaluation));
  assert.equal(evaluation.mode, 'SOURCE_MERGED_BASELINE');
  assert.equal(evaluation.readyForPromotion, false);
});

test('source-merged baseline fails closed on topology, remote tip, path set, or authority drift', () => {
  for (const candidate of [
    options({ resolveCommitParents: () => [REVIEWED_CANDIDATE_TIP, TRUSTED_BASE] }),
    options({ resolveRemoteTip: () => 'f'.repeat(40) }),
    options({ changedFilesBetween: () => [...POST_MERGE_PATHS, 'backend/lib/unreviewed.js'] }),
    options({ sourceMergeReceiptByPath: {
      [SOURCE_MERGE_RECEIPT_PATH]: {
        ...sourceMergeReceipt,
        authorizationPath: 'governance/open-source-acceleration/oss-1a-implementation-authorization-v10.json'
      }
    } })
  ]) {
    const role = classifyProductRouteBranchRole(TARGET_BRANCH, candidate);
    assert.equal(role.pass, false, JSON.stringify(role));
    assert.equal(role.reasonCode, 'WP0_PRODUCT_ROUTE_SOURCE_MERGE_INVALID');
  }
});

test('registry and product route share an explicit source-merge receipt authority', () => {
  const sharedPolicyPath = path.resolve(__dirname, '..', '..', 'shared', 'release', 'openSourceSourceMergePolicy.js');
  const productPolicy = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'tools', 'wp0', 'product-route-executable-policy.js'),
    'utf8'
  );
  assert.equal(fs.existsSync(sharedPolicyPath), true, 'shared source-merge policy must exist');
  assert.equal(workPackagePolicy.validateOpenSourceWorkPackageRegistry(registry), true);
  assert.match(productPolicy, /openSourceSourceMergePolicy/u);
  assert.doesNotMatch(productPolicy, /governance\/oss-1a-canonical-projection-checkpoint-authorization/u);
});
