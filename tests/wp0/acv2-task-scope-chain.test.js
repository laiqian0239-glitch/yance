'use strict';

// RED contract: production task-scope APIs are intentionally absent at this commit.
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validateWorkPackageTaskScopeChain,
  evaluateAuthorizedWorkPackageTaskScope,
  workPackageChangedFilesSha256
} = require('../../shared/release/implementationBranchPolicy');

const AUTHORIZATION = Object.freeze({
  schemaVersion: 1,
  documentType: 'YANCE_ACV2_WORK_PACKAGE_AUTHORIZATION',
  program: 'Architecture Closure V2',
  repository: 'laiqian0239-glitch/yance',
  currentAuthorizedWorkPackage: 'WP-A',
  authorizedBranch: 'acv2/wp-a-identity-ledger-write-host',
  requiredBaseRef: 'main',
  approvedParentHead: 'd81599d8a3f3de891da369b6f1ddbd01e264c78d',
  status: 'WP_A_IMPLEMENTATION_AUTHORIZED',
  productionScope: 'WP_A_ONLY',
  allowedProductionPaths: ['backend/runtime/AppRuntimeFactory.js'],
  lockedWorkPackages: ['WP-B'],
  governance: {
    automaticNextWorkPackageAuthorization: false,
    pr4MustRemainDraft: true
  }
});

const A6_PATHS = Object.freeze([
  'backend/runtime/AppRuntime.js',
  'tools/wp0/work-package-scope-gate.js'
]);
const A7_PATHS = Object.freeze([
  'backend/services/ledgerReplayAuthority.js',
  'backend/services/ledgerArchiveAuthority.js',
  'backend/tests/architectureClosureV2/wpA/ledgerReplay.test.js',
  'backend/tests/architectureClosureV2/wpA/ledgerArchiveFaultMatrix.test.js',
  'tools/architecture-closure-v2/wp-a-replay-evidence.js',
  'governance/architecture-closure-v2/wp-a-a6-closure.json',
  'governance/architecture-closure-v2/wp-a-a7-task-contract.json',
  'governance/architecture-closure-v2/wp-a-task-scope-chain.json',
  'tests/wp0/acv2-task-scope-chain.test.js'
]);

function chain(overrides = {}) {
  const changedFiles = [
    ...AUTHORIZATION.allowedProductionPaths,
    ...A6_PATHS,
    ...A7_PATHS
  ];
  return {
    schemaVersion: 1,
    documentType: 'YANCE_ACV2_TASK_SCOPE_CHAIN',
    status: 'A7_RED_LOCKED',
    repository: AUTHORIZATION.repository,
    workPackage: 'WP-A',
    authorizedBranch: AUTHORIZATION.authorizedBranch,
    pullRequest: 5,
    baseAuthorizationPath: 'governance/architecture-closure-v2/implementation-plan-authorization.json',
    baseAuthorizationBlobSha: '203697b36c06e0dc72c92113ef58f1a8f2394312',
    parentGovernanceHead: AUTHORIZATION.approvedParentHead,
    activeTask: 'A7',
    approvedChangedFileCount: changedFiles.length,
    approvedChangedFileSetSha256: workPackageChangedFilesSha256(changedFiles),
    tasks: [
      {
        task: 'A6',
        state: 'CLOSED',
        reviewedCodeHead: '3684dbd840faec8d6e732b0b68eae25f1ad9b2b3',
        evidenceBranchTip: 'e877aec9e16663296e632c224a1da3b7892f1f2b',
        closureReceiptPath: 'governance/architecture-closure-v2/wp-a-a6-closure.json',
        additionalAllowedPaths: [...A6_PATHS]
      },
      {
        task: 'A7',
        state: 'RED_LOCKED',
        parentTask: 'A6',
        parentEvidenceBranchTip: 'e877aec9e16663296e632c224a1da3b7892f1f2b',
        additionalAllowedPaths: [...A7_PATHS]
      }
    ],
    governance: {
      exactPathExpansionOnly: true,
      wildcardExpansionAllowed: false,
      previousTaskClosureRequired: true,
      prMustRemainDraft: true,
      automaticNextTaskAuthorization: false,
      automaticNextWorkPackageAuthorization: false,
      readyForPromotion: false
    },
    ...overrides
  };
}

test('task scope chain API exists and accepts a sequential closed-A6 to RED-locked-A7 chain', () => {
  assert.equal(typeof validateWorkPackageTaskScopeChain, 'function');
  assert.equal(typeof evaluateAuthorizedWorkPackageTaskScope, 'function');
  const document = chain();
  assert.equal(validateWorkPackageTaskScopeChain(document, AUTHORIZATION), true);
  const changedFiles = [
    ...AUTHORIZATION.allowedProductionPaths,
    ...A6_PATHS,
    ...A7_PATHS
  ];
  const result = evaluateAuthorizedWorkPackageTaskScope({
    branch: AUTHORIZATION.authorizedBranch,
    changedFiles,
    authorization: AUTHORIZATION,
    taskScopeChain: document
  });
  assert.equal(result.pass, true, JSON.stringify(result));
  assert.equal(result.activeTask, 'A7');
  assert.equal(result.readyForPromotion, false);
});

test('A7 cannot open unless A6 is closed on the exact inherited evidence tip', () => {
  for (const invalid of [
    chain({ tasks: [{ ...chain().tasks[0], state: 'INDEPENDENT_REVIEW' }, chain().tasks[1]] }),
    chain({ tasks: [chain().tasks[0], { ...chain().tasks[1], parentTask: 'A5' }] }),
    chain({ tasks: [chain().tasks[0], { ...chain().tasks[1], parentEvidenceBranchTip: 'f'.repeat(40) }] })
  ]) {
    assert.equal(validateWorkPackageTaskScopeChain(invalid, AUTHORIZATION), false);
  }
});

test('task scope chain rejects wildcards, duplicate task IDs and unregistered changed paths', () => {
  const wildcard = chain({
    tasks: [chain().tasks[0], { ...chain().tasks[1], additionalAllowedPaths: ['backend/**'] }]
  });
  assert.equal(validateWorkPackageTaskScopeChain(wildcard, AUTHORIZATION), false);

  const duplicate = chain({ tasks: [chain().tasks[0], { ...chain().tasks[1], task: 'A6' }] });
  assert.equal(validateWorkPackageTaskScopeChain(duplicate, AUTHORIZATION), false);

  const document = chain();
  const changedFiles = [
    ...AUTHORIZATION.allowedProductionPaths,
    ...A6_PATHS,
    ...A7_PATHS,
    'backend/services/unreviewedReplayBypass.js'
  ];
  const result = evaluateAuthorizedWorkPackageTaskScope({
    branch: AUTHORIZATION.authorizedBranch,
    changedFiles,
    authorization: AUTHORIZATION,
    taskScopeChain: {
      ...document,
      approvedChangedFileCount: changedFiles.length,
      approvedChangedFileSetSha256: workPackageChangedFilesSha256(changedFiles)
    }
  });
  assert.equal(result.pass, false);
  assert.equal(result.reasonCode, 'ACV2_TASK_SCOPE_VIOLATION');
  assert.deepEqual(result.unauthorizedPaths, ['backend/services/unreviewedReplayBypass.js']);
});
