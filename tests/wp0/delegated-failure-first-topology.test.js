'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isValidGenericDelegatedGovernanceAuthorization,
  evaluateTrustedDelegatedGovernanceBranch,
  workPackageChangedFilesSha256
} = require('../../shared/release/implementationBranchPolicy.js');

const AUTH_PATH = 'governance/layered-ci/failure-first-fixture-authorization.json';
const AUTH_BRANCH = 'governance/failure-first-fixture-authorization';
const IMPL_BRANCH = 'governance/failure-first-fixture';
const POLICY_PATH = 'shared/release/implementationBranchPolicy.js';
const TEST_PATH = 'tests/wp0/delegated-failure-first-topology.test.js';
const BASE = '1'.repeat(40);
const REVIEWED = '2'.repeat(40);
const MERGE = '3'.repeat(40);
const TRUSTED_MAIN = '4'.repeat(40);
const RED = '7'.repeat(40);
const GREEN = '8'.repeat(40);
const OTHER_PARENT = '9'.repeat(40);
const BLOB = '6'.repeat(40);

function authorization(overrides = {}) {
  const allowedChangedPaths = [POLICY_PATH, TEST_PATH];
  const failureFirstCommit = {
    mustBeFirstImplementationCommit: true,
    allowedChangedPaths: [TEST_PATH],
    approvedChangedFileCount: 1,
    approvedChangedFileSetSha256: workPackageChangedFilesSha256([TEST_PATH]),
    productionCodeChanged: false,
    freshCausalRedRequired: true,
    ...(overrides.failureFirstCommit || {})
  };
  return {
    schemaVersion: 1,
    documentType: 'YANCE_DELEGATED_GOVERNANCE_BRANCH_AUTHORIZATION',
    repository: 'laiqian0239-glitch/yance',
    workPackage: 'FAILURE-FIRST-FIXTURE',
    status: 'AUTHORIZED_AFTER_TRUSTED_MAIN_MERGE',
    base: { branch: 'main', commit: BASE },
    effectiveness: {
      effectiveBeforeMerge: false,
      requiresOrdinaryTwoParentMainMerge: true,
      implementationMayStartOnlyFromAuthorizationMergeCommit: true,
      authorizationProposalTransportIsNotImplementationAuthority: true
    },
    authorizationBranch: {
      name: AUTH_BRANCH,
      allowedChangedPaths: [AUTH_PATH],
      mustRemainSingleFile: true
    },
    implementation: {
      branch: IMPL_BRANCH,
      allowedChangedPaths,
      approvedChangedFileCount: allowedChangedPaths.length,
      approvedChangedFileSetSha256: workPackageChangedFilesSha256(allowedChangedPaths),
      newDependencyAllowed: false,
      workflowModificationAllowed: false,
      failureFirstCommit
    },
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

function options(overrides = {}) {
  const document = overrides.authorization || authorization();
  const evaluatedHead = overrides.evaluatedHead || RED;
  return {
    trustedMainHead: TRUSTED_MAIN,
    evaluatedHead,
    listAuthorizationPaths: () => [AUTH_PATH],
    loadAuthorizationAtTrustedHead: repositoryPath => repositoryPath === AUTH_PATH ? document : null,
    findAuthorizationIntroductionMerges: repositoryPath => repositoryPath === AUTH_PATH ? [MERGE] : [],
    resolveCommitParents: commit => {
      if (Object.prototype.hasOwnProperty.call(overrides.parentsByCommit || {}, commit)) {
        return overrides.parentsByCommit[commit];
      }
      if (commit === MERGE) return [BASE, REVIEWED];
      return [];
    },
    resolveCommitBlobSha: (commit, repositoryPath) => {
      if (repositoryPath !== AUTH_PATH) return null;
      return [MERGE, REVIEWED, TRUSTED_MAIN].includes(commit) ? BLOB : null;
    },
    resolveCommitPathMode: (_commit, repositoryPath) => repositoryPath === AUTH_PATH ? '100644' : null,
    resolveMergeBases: () => [MERGE],
    resolveChangedFilesBetween: (base, head) => {
      const key = `${base}:${head}`;
      if (Object.prototype.hasOwnProperty.call(overrides.changedFilesByRange || {}, key)) {
        return overrides.changedFilesByRange[key];
      }
      if (base === BASE && head === REVIEWED) return [AUTH_PATH];
      if (base === BASE && head === MERGE) return [AUTH_PATH];
      if (base === MERGE && head === evaluatedHead) {
        return overrides.implementationChangedFiles || document.implementation.allowedChangedPaths;
      }
      throw new Error(`unexpected diff request ${base}..${head}`);
    },
    resolveFirstParentCommitsBetween: () => overrides.firstParentCommits || [RED],
    resolveCommitMessage: commit => overrides.commitMessagesByCommit?.[commit] || '',
    isTrustedAncestor: (base, head) => base === head
      || (base === BASE && head === REVIEWED)
      || (base === MERGE && head === TRUSTED_MAIN)
      || (base === MERGE && head === evaluatedHead)
  };
}

test('failure-first declaration rejects a mismatched tests-only digest', () => {
  const document = authorization({ failureFirstCommit: { approvedChangedFileSetSha256: 'f'.repeat(64) } });
  assert.equal(isValidGenericDelegatedGovernanceAuthorization(document, AUTH_PATH), false);
});

test('failure-first RED Head must contain exactly the declared tests-only path', () => {
  const result = evaluateTrustedDelegatedGovernanceBranch({
    branch: IMPL_BRANCH,
    ...options({
      implementationChangedFiles: [POLICY_PATH, TEST_PATH],
      parentsByCommit: { [RED]: [MERGE] },
      changedFilesByRange: { [`${MERGE}:${RED}`]: [POLICY_PATH, TEST_PATH] }
    })
  });
  assert.equal(result.pass, false, JSON.stringify(result));
  assert.equal(result.reasonCode, 'WP0_DELEGATED_GOVERNANCE_FAILURE_FIRST_INVALID');
});

test('failure-first RED Head must have exactly one parent equal to the authorization merge', () => {
  for (const parents of [[MERGE, OTHER_PARENT], [OTHER_PARENT]]) {
    const result = evaluateTrustedDelegatedGovernanceBranch({
      branch: IMPL_BRANCH,
      ...options({
        implementationChangedFiles: [TEST_PATH],
        parentsByCommit: { [RED]: parents },
        changedFilesByRange: { [`${MERGE}:${RED}`]: [TEST_PATH] }
      })
    });
    assert.equal(result.pass, false, `${parents.join(',')}: ${JSON.stringify(result)}`);
    assert.equal(result.reasonCode, 'WP0_DELEGATED_GOVERNANCE_FAILURE_FIRST_INVALID');
  }
});

test('exact tests-only RED Head is permitted before remote RED evidence can exist', () => {
  const result = evaluateTrustedDelegatedGovernanceBranch({
    branch: IMPL_BRANCH,
    ...options({
      implementationChangedFiles: [TEST_PATH],
      parentsByCommit: { [RED]: [MERGE] },
      changedFilesByRange: { [`${MERGE}:${RED}`]: [TEST_PATH] }
    })
  });
  assert.equal(result.pass, true, JSON.stringify(result));
});

test('first post-RED implementation commit requires exact RED head/run/conclusion trailers', () => {
  const common = {
    evaluatedHead: GREEN,
    implementationChangedFiles: [POLICY_PATH, TEST_PATH],
    firstParentCommits: [RED, GREEN],
    parentsByCommit: { [RED]: [MERGE], [GREEN]: [RED] },
    changedFilesByRange: { [`${MERGE}:${RED}`]: [TEST_PATH] }
  };

  const missing = evaluateTrustedDelegatedGovernanceBranch({
    branch: IMPL_BRANCH,
    ...options(common)
  });
  assert.equal(missing.pass, false, JSON.stringify(missing));
  assert.equal(missing.reasonCode, 'WP0_DELEGATED_GOVERNANCE_FAILURE_FIRST_EVIDENCE_INVALID');

  const accepted = evaluateTrustedDelegatedGovernanceBranch({
    branch: IMPL_BRANCH,
    ...options({
      ...common,
      commitMessagesByCommit: {
        [GREEN]: [
          'fix(governance): enforce delegated failure-first topology',
          '',
          `Yance-Failure-First-Red-Head: ${RED}`,
          'Yance-Failure-First-Red-Run: 31650000000',
          'Yance-Failure-First-Red-Conclusion: failure'
        ].join('\n')
      }
    })
  });
  assert.equal(accepted.pass, true, JSON.stringify(accepted));
});

test('authorizations without failureFirstCommit preserve existing semantics', () => {
  const document = authorization();
  delete document.implementation.failureFirstCommit;
  assert.equal(isValidGenericDelegatedGovernanceAuthorization(document, AUTH_PATH), true);
  const result = evaluateTrustedDelegatedGovernanceBranch({
    branch: IMPL_BRANCH,
    ...options({ authorization: document, implementationChangedFiles: [POLICY_PATH, TEST_PATH] })
  });
  assert.equal(result.pass, true, JSON.stringify(result));
});
