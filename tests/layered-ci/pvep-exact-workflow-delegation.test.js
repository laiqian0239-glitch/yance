'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isValidGenericDelegatedGovernanceAuthorization,
  workPackageChangedFilesSha256
} = require('../../shared/release/implementationBranchPolicy');

const AUTHORIZATION_PATH = 'governance/layered-ci/pvep-workflow-bootstrap-authorization.json';
const POLICY_PATH = 'shared/release/implementationBranchPolicy.js';
const TEST_PATH = 'tests/layered-ci/pvep-exact-workflow-delegation.test.js';
const WORKFLOW_PATH = '.github/workflows/pvep-attested-evidence.yml';

function authorization({
  allowedChangedPaths = [POLICY_PATH, TEST_PATH],
  workflowModificationAllowed = false,
  workflowModificationPolicy
} = {}) {
  const implementation = {
    branch: 'governance/pvep-attestation-bootstrap-authorized',
    allowedChangedPaths: [...allowedChangedPaths].sort(),
    approvedChangedFileCount: allowedChangedPaths.length,
    approvedChangedFileSetSha256: workPackageChangedFilesSha256(allowedChangedPaths),
    newDependencyAllowed: false,
    workflowModificationAllowed
  };
  if (workflowModificationPolicy !== undefined) implementation.workflowModificationPolicy = workflowModificationPolicy;
  return {
    schemaVersion: 1,
    documentType: 'YANCE_DELEGATED_GOVERNANCE_BRANCH_AUTHORIZATION',
    repository: 'laiqian0239-glitch/yance',
    workPackage: 'PVEP-WORKFLOW-DELEGATION',
    status: 'AUTHORIZED_AFTER_TRUSTED_MAIN_MERGE',
    base: { branch: 'main', commit: '1'.repeat(40) },
    effectiveness: {
      effectiveBeforeMerge: false,
      requiresOrdinaryTwoParentMainMerge: true,
      implementationMayStartOnlyFromAuthorizationMergeCommit: true,
      authorizationProposalTransportIsNotImplementationAuthority: true
    },
    authorizationBranch: {
      name: 'governance/pvep-workflow-bootstrap-authorization',
      allowedChangedPaths: [AUTHORIZATION_PATH],
      mustRemainSingleFile: true
    },
    implementation,
    governance: {
      authorizationPredatesImplementation: true,
      exactPathScopeOnly: true,
      independentBranchAndPullRequestRequired: true,
      productionUseAuthorized: false,
      formalReleaseAuthorized: false,
      publishAuthorized: false,
      readyForPromotionAuthorized: false,
      automaticNextWorkPackageAuthorizationAuthorized: false
    }
  };
}

function workflowPolicy(paths = [WORKFLOW_PATH]) {
  return {
    allowedWorkflowPaths: [...paths].sort(),
    approvedWorkflowPathCount: paths.length,
    approvedWorkflowPathSetSha256: workPackageChangedFilesSha256(paths)
  };
}

test('generic delegated governance keeps workflow modification denied by default', () => {
  assert.equal(isValidGenericDelegatedGovernanceAuthorization(authorization(), AUTHORIZATION_PATH), true);
  const withWorkflow = authorization({ allowedChangedPaths: [POLICY_PATH, WORKFLOW_PATH] });
  assert.equal(isValidGenericDelegatedGovernanceAuthorization(withWorkflow, AUTHORIZATION_PATH), false);
});

test('exact workflow-control delegation is accepted only with an exact path policy', () => {
  const exact = authorization({
    allowedChangedPaths: [POLICY_PATH, WORKFLOW_PATH],
    workflowModificationAllowed: true,
    workflowModificationPolicy: workflowPolicy()
  });
  assert.equal(isValidGenericDelegatedGovernanceAuthorization(exact, AUTHORIZATION_PATH), true);

  const missingPolicy = authorization({
    allowedChangedPaths: [POLICY_PATH, WORKFLOW_PATH],
    workflowModificationAllowed: true
  });
  assert.equal(isValidGenericDelegatedGovernanceAuthorization(missingPolicy, AUTHORIZATION_PATH), false);
});

test('workflow delegation rejects count, digest, path-set and wildcard drift', () => {
  const cases = [
    { ...workflowPolicy(), approvedWorkflowPathCount: 2 },
    { ...workflowPolicy(), approvedWorkflowPathSetSha256: 'f'.repeat(64) },
    workflowPolicy([WORKFLOW_PATH, '.github/workflows/unreviewed.yml']),
    workflowPolicy(['.github/workflows/*'])
  ];
  for (const policy of cases) {
    const candidate = authorization({
      allowedChangedPaths: [POLICY_PATH, WORKFLOW_PATH],
      workflowModificationAllowed: true,
      workflowModificationPolicy: policy
    });
    assert.equal(isValidGenericDelegatedGovernanceAuthorization(candidate, AUTHORIZATION_PATH), false);
  }
});

test('workflow delegation never authorizes dependency-control files', () => {
  const candidate = authorization({
    allowedChangedPaths: [POLICY_PATH, WORKFLOW_PATH, 'nested/package.json'],
    workflowModificationAllowed: true,
    workflowModificationPolicy: workflowPolicy()
  });
  assert.equal(isValidGenericDelegatedGovernanceAuthorization(candidate, AUTHORIZATION_PATH), false);
});
