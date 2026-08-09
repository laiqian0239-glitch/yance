'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isValidGenericDelegatedGovernanceAuthorization,
  workPackageChangedFilesSha256
} = require('../../shared/release/implementationBranchPolicy');

const AUTHORIZATION_PATH = 'governance/layered-ci/v21-comms-p0-authorization.json';
const POLICY_PATH = 'shared/release/implementationBranchPolicy.js';
const TEST_PATH = 'tests/layered-ci/v21-exact-dependency-delegation.test.js';
const DEPENDENCY_PATH = 'integration/element-module/package.json';

function authorization({
  allowedChangedPaths = [POLICY_PATH, TEST_PATH],
  newDependencyAllowed = false,
  dependencyModificationPolicy
} = {}) {
  const implementation = {
    branch: 'product/v21-comms-p0',
    allowedChangedPaths: [...allowedChangedPaths].sort(),
    approvedChangedFileCount: allowedChangedPaths.length,
    approvedChangedFileSetSha256: workPackageChangedFilesSha256(allowedChangedPaths),
    newDependencyAllowed,
    workflowModificationAllowed: false
  };
  if (dependencyModificationPolicy !== undefined) {
    implementation.dependencyModificationPolicy = dependencyModificationPolicy;
  }
  return {
    schemaVersion: 1,
    documentType: 'YANCE_DELEGATED_GOVERNANCE_BRANCH_AUTHORIZATION',
    repository: 'laiqian0239-glitch/yance',
    workPackage: 'V21-COMMS-P0',
    status: 'AUTHORIZED_AFTER_TRUSTED_MAIN_MERGE',
    base: { branch: 'main', commit: '1'.repeat(40) },
    effectiveness: {
      effectiveBeforeMerge: false,
      requiresOrdinaryTwoParentMainMerge: true,
      implementationMayStartOnlyFromAuthorizationMergeCommit: true,
      authorizationProposalTransportIsNotImplementationAuthority: true
    },
    authorizationBranch: {
      name: 'governance/v21-comms-p0-authorization',
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

function dependencyPolicy(paths = [DEPENDENCY_PATH]) {
  return {
    allowedDependencyPaths: [...paths].sort(),
    approvedDependencyPathCount: paths.length,
    approvedDependencyPathSetSha256: workPackageChangedFilesSha256(paths)
  };
}

test('generic delegated governance keeps dependency-control changes denied by default', () => {
  assert.equal(isValidGenericDelegatedGovernanceAuthorization(authorization(), AUTHORIZATION_PATH), true);
  const withDependency = authorization({ allowedChangedPaths: [POLICY_PATH, DEPENDENCY_PATH] });
  assert.equal(isValidGenericDelegatedGovernanceAuthorization(withDependency, AUTHORIZATION_PATH), false);
});

test('exact dependency-control delegation is accepted only with an exact path policy', () => {
  const exact = authorization({
    allowedChangedPaths: [POLICY_PATH, DEPENDENCY_PATH],
    newDependencyAllowed: true,
    dependencyModificationPolicy: dependencyPolicy()
  });
  assert.equal(isValidGenericDelegatedGovernanceAuthorization(exact, AUTHORIZATION_PATH), true);

  const missingPolicy = authorization({
    allowedChangedPaths: [POLICY_PATH, DEPENDENCY_PATH],
    newDependencyAllowed: true
  });
  assert.equal(isValidGenericDelegatedGovernanceAuthorization(missingPolicy, AUTHORIZATION_PATH), false);
});

test('dependency delegation rejects count, digest, path-set and wildcard drift', () => {
  const cases = [
    { ...dependencyPolicy(), approvedDependencyPathCount: 2 },
    { ...dependencyPolicy(), approvedDependencyPathSetSha256: 'f'.repeat(64) },
    dependencyPolicy([DEPENDENCY_PATH, 'integration/other/package.json']),
    dependencyPolicy(['integration/*/package.json'])
  ];
  for (const policy of cases) {
    const candidate = authorization({
      allowedChangedPaths: [POLICY_PATH, DEPENDENCY_PATH],
      newDependencyAllowed: true,
      dependencyModificationPolicy: policy
    });
    assert.equal(isValidGenericDelegatedGovernanceAuthorization(candidate, AUTHORIZATION_PATH), false);
  }
});

test('dependency delegation rejects undeclared dependency-control drift', () => {
  const candidate = authorization({
    allowedChangedPaths: [POLICY_PATH, DEPENDENCY_PATH, 'integration/other/package.json'],
    newDependencyAllowed: true,
    dependencyModificationPolicy: dependencyPolicy()
  });
  assert.equal(isValidGenericDelegatedGovernanceAuthorization(candidate, AUTHORIZATION_PATH), false);
});
