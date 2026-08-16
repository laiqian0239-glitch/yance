'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  ROUTES,
  classifyWp0Route
} = require('../../tools/layered-ci/wp0-routing');
const {
  DELEGATED_ROUTE_POLICY_MUTATION_DENIED,
  evaluateTrustedDelegatedGovernanceBranch,
  isValidGenericDelegatedGovernanceAuthorization,
  validateDelegatedRoutePolicyMutation,
  workPackageChangedFilesSha256
} = require('../../shared/release/implementationBranchPolicy.js');

const ROOT = path.resolve(__dirname, '..', '..');
const routingPolicy = JSON.parse(fs.readFileSync(
  path.join(ROOT, 'governance/layered-ci/wp0-routing-policy.json'),
  'utf8'
));

const AUTH_PATH = 'governance/layered-ci/fast-closure-v2-fixture-authorization.json';
const AUTH_BRANCH = 'governance/fast-closure-v2-fixture-authorization';
const IMPL_BRANCH = 'fix/fast-closure-v2-fixture';
const POLICY_PATH = 'shared/release/implementationBranchPolicy.js';
const TEST_PATH = 'tests/layered-ci/fast-closure-v2-policy.test.js';
const BASE = '1'.repeat(40);
const REVIEWED = '2'.repeat(40);
const MERGE = '3'.repeat(40);
const TRUSTED_MAIN = '4'.repeat(40);
const RED1 = '7'.repeat(40);
const RED2 = '8'.repeat(40);
const PRODUCTION = 'a'.repeat(40);
const BLOB = '6'.repeat(40);
const REQUIRED_CLOSURE_TRAILER = 'Yance-Closure-Matrix-Unknown-Blockers: 0';

function fastClosureV2Declaration(overrides = {}) {
  return {
    enabled: true,
    requiredClosureTrailer: REQUIRED_CLOSURE_TRAILER,
    ...overrides
  };
}

function authorization(overrides = {}) {
  const allowedChangedPaths = [POLICY_PATH, TEST_PATH];
  const failureFirstCommit = {
    mustBeFirstImplementationCommit: true,
    allowedChangedPaths: [TEST_PATH],
    approvedChangedFileCount: 1,
    approvedChangedFileSetSha256: workPackageChangedFilesSha256([TEST_PATH]),
    productionCodeChanged: false,
    freshCausalRedRequired: true,
    fastClosureV2: fastClosureV2Declaration(),
    ...(overrides.failureFirstCommit || {})
  };
  return {
    schemaVersion: 1,
    documentType: 'YANCE_DELEGATED_GOVERNANCE_BRANCH_AUTHORIZATION',
    repository: 'laiqian0239-glitch/yance',
    workPackage: 'FAST-CLOSURE-V2-FIXTURE',
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

function failureEvidence(redHead, runId = '31920000000') {
  return [
    `Yance-Failure-First-Red-Head: ${redHead}`,
    `Yance-Failure-First-Red-Run: ${runId}`,
    'Yance-Failure-First-Red-Conclusion: failure'
  ];
}

function commitMessage(subject, redHead, options = {}) {
  return [
    subject,
    '',
    ...failureEvidence(redHead, options.runId),
    ...(options.includeClosure === true ? ['', REQUIRED_CLOSURE_TRAILER] : [])
  ].join('\n');
}

function options(overrides = {}) {
  const document = overrides.authorization || authorization();
  const evaluatedHead = overrides.evaluatedHead || RED1;
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
    resolveFirstParentCommitsBetween: () => overrides.firstParentCommits || [RED1],
    resolveCommitMessage: commit => overrides.commitMessagesByCommit?.[commit] || '',
    isTrustedAncestor: (base, head) => base === head
      || (base === BASE && head === REVIEWED)
      || (base === MERGE && head === TRUSTED_MAIN)
      || (base === MERGE && head === evaluatedHead)
  };
}

test('root AGENTS protocol descriptor is an exact GOVERNANCE_WP0 path', () => {
  const result = classifyWp0Route(routingPolicy, ['AGENTS.md']);
  assert.equal(result.pass, true, JSON.stringify(result));
  assert.equal(result.route, ROUTES.GOVERNANCE, JSON.stringify(result));
  assert.equal(result.governanceChangesPresent, true, JSON.stringify(result));
  assert.equal(result.productChangesPresent, false, JSON.stringify(result));
  assert.equal(routingPolicy.governanceExactPaths.includes('AGENTS.md'), true);
});

test('existing delegated route guard admits only the exact AGENTS governance bootstrap', () => {
  const basePolicy = JSON.parse(JSON.stringify(routingPolicy));
  basePolicy.governanceExactPaths = basePolicy.governanceExactPaths.filter(value => value !== 'AGENTS.md');
  const candidatePolicy = JSON.parse(JSON.stringify(basePolicy));
  candidatePolicy.governanceExactPaths.push('AGENTS.md');
  const bootstrapAuthorization = {
    governanceBootstrapPaths: ['AGENTS.md'],
    governanceBootstrapPathCount: 1,
    governanceBootstrapPathSetSha256: workPackageChangedFilesSha256(['AGENTS.md'])
  };

  const accepted = validateDelegatedRoutePolicyMutation({
    authorization: bootstrapAuthorization,
    basePolicy,
    candidatePolicy
  });
  assert.equal(accepted.pass, true, JSON.stringify(accepted));
  assert.equal(accepted.destinationPolicyField, 'governanceExactPaths');

  const drift = JSON.parse(JSON.stringify(candidatePolicy));
  drift.governancePrefixes.push('root-governance/');
  const denied = validateDelegatedRoutePolicyMutation({
    authorization: bootstrapAuthorization,
    basePolicy,
    candidatePolicy: drift
  });
  assert.equal(denied.pass, false, JSON.stringify(denied));
  assert.equal(denied.reasonCode, DELEGATED_ROUTE_POLICY_MUTATION_DENIED);
});

test('Fast Closure V2 opt-in contract is exact and cannot be weakened', () => {
  assert.equal(isValidGenericDelegatedGovernanceAuthorization(authorization(), AUTH_PATH), true);
  for (const fastClosureV2 of [
    fastClosureV2Declaration({ enabled: false }),
    fastClosureV2Declaration({ requiredClosureTrailer: 'Yance-Closure-Matrix-Unknown-Blockers: 1' }),
    { ...fastClosureV2Declaration(), permissiveFallback: true }
  ]) {
    const document = authorization({ failureFirstCommit: { fastClosureV2 } });
    assert.equal(
      isValidGenericDelegatedGovernanceAuthorization(document, AUTH_PATH),
      false,
      JSON.stringify(fastClosureV2)
    );
  }
});

test('additional tests-only diagnostic head carries exact prior RED evidence and may await its own remote RED', () => {
  const common = {
    evaluatedHead: RED2,
    implementationChangedFiles: [TEST_PATH],
    firstParentCommits: [RED1, RED2],
    parentsByCommit: { [RED1]: [MERGE], [RED2]: [RED1] },
    changedFilesByRange: {
      [`${MERGE}:${RED1}`]: [TEST_PATH],
      [`${RED1}:${RED2}`]: [TEST_PATH]
    }
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
        [RED2]: commitMessage('test(governance): expose second same-root boundary', RED1)
      }
    })
  });
  assert.equal(accepted.pass, true, JSON.stringify(accepted));
});

test('first production commit binds latest diagnostic RED and requires unknownBlockers=0', () => {
  const common = {
    evaluatedHead: PRODUCTION,
    implementationChangedFiles: [POLICY_PATH, TEST_PATH],
    firstParentCommits: [RED1, RED2, PRODUCTION],
    parentsByCommit: { [RED1]: [MERGE], [RED2]: [RED1], [PRODUCTION]: [RED2] },
    changedFilesByRange: {
      [`${MERGE}:${RED1}`]: [TEST_PATH],
      [`${RED1}:${RED2}`]: [TEST_PATH],
      [`${RED2}:${PRODUCTION}`]: [POLICY_PATH]
    },
    commitMessagesByCommit: {
      [RED2]: commitMessage('test(governance): expose second same-root boundary', RED1)
    }
  };

  const missingProductionEvidence = evaluateTrustedDelegatedGovernanceBranch({
    branch: IMPL_BRANCH,
    ...options(common)
  });
  assert.equal(missingProductionEvidence.pass, false, JSON.stringify(missingProductionEvidence));
  assert.equal(
    missingProductionEvidence.reasonCode,
    'WP0_DELEGATED_GOVERNANCE_FAILURE_FIRST_EVIDENCE_INVALID'
  );

  const staleRed = evaluateTrustedDelegatedGovernanceBranch({
    branch: IMPL_BRANCH,
    ...options({
      ...common,
      commitMessagesByCommit: {
        ...common.commitMessagesByCommit,
        [PRODUCTION]: commitMessage('fix(governance): close Fast Closure V2 policy root', RED1, { includeClosure: true })
      }
    })
  });
  assert.equal(staleRed.pass, false, JSON.stringify(staleRed));
  assert.equal(staleRed.reasonCode, 'WP0_DELEGATED_GOVERNANCE_FAILURE_FIRST_EVIDENCE_INVALID');

  const missingClosure = evaluateTrustedDelegatedGovernanceBranch({
    branch: IMPL_BRANCH,
    ...options({
      ...common,
      commitMessagesByCommit: {
        ...common.commitMessagesByCommit,
        [PRODUCTION]: commitMessage('fix(governance): close Fast Closure V2 policy root', RED2)
      }
    })
  });
  assert.equal(missingClosure.pass, false, JSON.stringify(missingClosure));
  assert.equal(missingClosure.reasonCode, 'WP0_DELEGATED_GOVERNANCE_CLOSURE_MATRIX_INVALID');

  const accepted = evaluateTrustedDelegatedGovernanceBranch({
    branch: IMPL_BRANCH,
    ...options({
      ...common,
      commitMessagesByCommit: {
        ...common.commitMessagesByCommit,
        [PRODUCTION]: commitMessage(
          'fix(governance): close Fast Closure V2 policy root',
          RED2,
          { includeClosure: true }
        )
      }
    })
  });
  assert.equal(accepted.pass, true, JSON.stringify(accepted));
});

test('legacy failure-first authorization keeps fixed first-post-RED semantics without Fast Closure V2 opt-in', () => {
  const document = authorization();
  delete document.implementation.failureFirstCommit.fastClosureV2;
  assert.equal(isValidGenericDelegatedGovernanceAuthorization(document, AUTH_PATH), true);

  const result = evaluateTrustedDelegatedGovernanceBranch({
    branch: IMPL_BRANCH,
    ...options({
      authorization: document,
      evaluatedHead: PRODUCTION,
      implementationChangedFiles: [POLICY_PATH, TEST_PATH],
      firstParentCommits: [RED1, RED2, PRODUCTION],
      parentsByCommit: { [RED1]: [MERGE], [RED2]: [RED1], [PRODUCTION]: [RED2] },
      changedFilesByRange: { [`${MERGE}:${RED1}`]: [TEST_PATH] },
      commitMessagesByCommit: {
        [RED2]: commitMessage('test(governance): legacy first post-RED evidence', RED1)
      }
    })
  });
  assert.equal(result.pass, true, JSON.stringify(result));
});
