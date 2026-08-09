'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isValidGenericDelegatedGovernanceAuthorization,
  evaluateTrustedDelegatedGovernanceBranch,
  validateDelegatedDependencyIdentityMutation,
  workPackageChangedFilesSha256
} = require('../../shared/release/implementationBranchPolicy');

const AUTHORIZATION_PATH = 'governance/layered-ci/dependency-identity-fixture-authorization.json';
const AUTHORIZATION_BRANCH = 'governance/dependency-identity-fixture-authorization';
const IMPLEMENTATION_BRANCH = 'fix/dependency-identity-fixture';
const MANIFEST_PATH = 'integration/element-module/package.json';
const BASE = '1'.repeat(40);
const REVIEWED = '2'.repeat(40);
const MERGE = '3'.repeat(40);
const TRUSTED_MAIN = '4'.repeat(40);
const CANDIDATE = '5'.repeat(40);
const AUTH_BLOB = '6'.repeat(40);
const DENIED = 'WP0_DELEGATED_DEPENDENCY_IDENTITY_MUTATION_DENIED';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function baseManifest() {
  return {
    name: '@yance/element-module',
    version: '0.0.0',
    private: true,
    type: 'module',
    scripts: {
      build: 'vite build'
    },
    dependencies: {
      '@element-hq/element-web-module-api': '0.8.0'
    },
    devDependencies: {
      vite: '6.1.0'
    }
  };
}

function exactManifest() {
  const manifest = baseManifest();
  manifest.dependencies['livekit-client'] = '2.21.0';
  return manifest;
}

function dependencyIdentityPolicy(entries = [{
  path: MANIFEST_PATH,
  section: 'dependencies',
  name: 'livekit-client',
  version: '2.21.0'
}]) {
  return { entries };
}

function authorization(identityPolicy = dependencyIdentityPolicy()) {
  const allowedChangedPaths = [MANIFEST_PATH];
  return {
    schemaVersion: 1,
    documentType: 'YANCE_DELEGATED_GOVERNANCE_BRANCH_AUTHORIZATION',
    repository: 'laiqian0239-glitch/yance',
    workPackage: 'DEPENDENCY-IDENTITY-FIXTURE',
    status: 'AUTHORIZED_AFTER_TRUSTED_MAIN_MERGE',
    base: { branch: 'main', commit: BASE },
    effectiveness: {
      effectiveBeforeMerge: false,
      requiresOrdinaryTwoParentMainMerge: true,
      implementationMayStartOnlyFromAuthorizationMergeCommit: true,
      authorizationProposalTransportIsNotImplementationAuthority: true
    },
    authorizationBranch: {
      name: AUTHORIZATION_BRANCH,
      allowedChangedPaths: [AUTHORIZATION_PATH],
      mustRemainSingleFile: true
    },
    implementation: {
      branch: IMPLEMENTATION_BRANCH,
      allowedChangedPaths,
      approvedChangedFileCount: 1,
      approvedChangedFileSetSha256: workPackageChangedFilesSha256(allowedChangedPaths),
      newDependencyAllowed: true,
      workflowModificationAllowed: false,
      dependencyModificationPolicy: {
        allowedDependencyPaths: allowedChangedPaths,
        approvedDependencyPathCount: 1,
        approvedDependencyPathSetSha256: workPackageChangedFilesSha256(allowedChangedPaths)
      },
      dependencyIdentityPolicy: identityPolicy
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

function trustedOptions(candidateManifest, auth = authorization()) {
  return {
    branch: IMPLEMENTATION_BRANCH,
    trustedMainHead: TRUSTED_MAIN,
    evaluatedHead: CANDIDATE,
    listAuthorizationPaths: () => [AUTHORIZATION_PATH],
    loadAuthorizationAtTrustedHead: path => path === AUTHORIZATION_PATH ? auth : null,
    findAuthorizationIntroductionMerges: path => path === AUTHORIZATION_PATH ? [MERGE] : [],
    resolveCommitParents: commit => commit === MERGE ? [BASE, REVIEWED] : [],
    resolveCommitBlobSha: (commit, path) => {
      if (path !== AUTHORIZATION_PATH || commit === BASE) return null;
      return [REVIEWED, MERGE, TRUSTED_MAIN].includes(commit) ? AUTH_BLOB : null;
    },
    resolveCommitPathMode: (commit, path) => {
      if (path !== AUTHORIZATION_PATH || commit === BASE) return null;
      return [REVIEWED, MERGE, TRUSTED_MAIN].includes(commit) ? '100644' : null;
    },
    resolveChangedFilesBetween: (base, head) => {
      if (base === BASE && [REVIEWED, MERGE].includes(head)) return [AUTHORIZATION_PATH];
      if (base === MERGE && head === CANDIDATE) return [MANIFEST_PATH];
      return [];
    },
    resolveMergeBases: () => [MERGE],
    isTrustedAncestor: (base, head) => base === head
      || (base === BASE && head === REVIEWED)
      || (base === MERGE && head === TRUSTED_MAIN)
      || (base === MERGE && head === CANDIDATE),
    loadDependencyManifestAtCommit: (commit, path) => {
      if (path !== MANIFEST_PATH) return null;
      if (commit === MERGE) return baseManifest();
      if (commit === CANDIDATE) return candidateManifest;
      return null;
    }
  };
}

test('delegated authorization schema accepts an exact dependency identity declaration and rejects malformed variants', () => {
  const exact = authorization();
  assert.equal(isValidGenericDelegatedGovernanceAuthorization(exact, AUTHORIZATION_PATH), true);

  const cases = [];
  cases.push({ name: 'duplicate identity tuple', policy: dependencyIdentityPolicy([
    dependencyIdentityPolicy().entries[0],
    dependencyIdentityPolicy().entries[0]
  ]) });
  cases.push({ name: 'undeclared manifest path', policy: dependencyIdentityPolicy([{
    path: 'package.json', section: 'dependencies', name: 'livekit-client', version: '2.21.0'
  }]) });
  cases.push({ name: 'unsupported dependency section', policy: dependencyIdentityPolicy([{
    path: MANIFEST_PATH, section: 'bundledDependencies', name: 'livekit-client', version: '2.21.0'
  }]) });
  cases.push({ name: 'range version', policy: dependencyIdentityPolicy([{
    path: MANIFEST_PATH, section: 'dependencies', name: 'livekit-client', version: '^2.21.0'
  }]) });
  cases.push({ name: 'empty package name', policy: dependencyIdentityPolicy([{
    path: MANIFEST_PATH, section: 'dependencies', name: '', version: '2.21.0'
  }]) });

  for (const fixture of cases) {
    assert.equal(
      isValidGenericDelegatedGovernanceAuthorization(authorization(fixture.policy), AUTHORIZATION_PATH),
      false,
      fixture.name
    );
  }
});

test('generic dependency identity mutation helper exists and accepts only the exact declared addition', () => {
  assert.equal(typeof validateDelegatedDependencyIdentityMutation, 'function');
  const result = validateDelegatedDependencyIdentityMutation({
    authorization: authorization(),
    repositoryPath: MANIFEST_PATH,
    baseManifest: baseManifest(),
    candidateManifest: exactManifest()
  });
  assert.equal(result.pass, true, JSON.stringify(result));
  assert.equal(result.reasonCode, null, JSON.stringify(result));
});

test('generic dependency identity mutation helper rejects extra package, wrong version and wrong section', () => {
  assert.equal(typeof validateDelegatedDependencyIdentityMutation, 'function');
  const fixtures = [];

  const extra = exactManifest();
  extra.dependencies['left-pad'] = '1.3.0';
  fixtures.push(['extra dependency', extra]);

  const wrongVersion = baseManifest();
  wrongVersion.dependencies['livekit-client'] = '2.20.0';
  fixtures.push(['wrong version', wrongVersion]);

  const wrongSection = baseManifest();
  wrongSection.devDependencies['livekit-client'] = '2.21.0';
  fixtures.push(['wrong section', wrongSection]);

  for (const [name, candidateManifest] of fixtures) {
    const result = validateDelegatedDependencyIdentityMutation({
      authorization: authorization(),
      repositoryPath: MANIFEST_PATH,
      baseManifest: baseManifest(),
      candidateManifest
    });
    assert.equal(result.pass, false, `${name}: ${JSON.stringify(result)}`);
    assert.equal(result.reasonCode, DENIED, name);
  }
});

test('generic dependency identity mutation helper rejects dependency moves, removals and existing version mutations', () => {
  assert.equal(typeof validateDelegatedDependencyIdentityMutation, 'function');
  const fixtures = [];

  const moved = exactManifest();
  delete moved.dependencies['@element-hq/element-web-module-api'];
  moved.devDependencies['@element-hq/element-web-module-api'] = '0.8.0';
  fixtures.push(['section move', moved]);

  const removed = exactManifest();
  delete removed.devDependencies.vite;
  fixtures.push(['removal', removed]);

  const mutated = exactManifest();
  mutated.dependencies['@element-hq/element-web-module-api'] = '0.9.0';
  fixtures.push(['existing version mutation', mutated]);

  for (const [name, candidateManifest] of fixtures) {
    const result = validateDelegatedDependencyIdentityMutation({
      authorization: authorization(),
      repositoryPath: MANIFEST_PATH,
      baseManifest: baseManifest(),
      candidateManifest
    });
    assert.equal(result.pass, false, `${name}: ${JSON.stringify(result)}`);
    assert.equal(result.reasonCode, DENIED, name);
  }
});

test('trusted delegated evaluator invokes dependency identity guard instead of accepting path-only authority', () => {
  const exact = evaluateTrustedDelegatedGovernanceBranch(trustedOptions(exactManifest()));
  assert.equal(exact.pass, true, JSON.stringify(exact));

  const extra = exactManifest();
  extra.dependencies['left-pad'] = '1.3.0';
  const extraResult = evaluateTrustedDelegatedGovernanceBranch(trustedOptions(extra));
  assert.equal(extraResult.pass, false, JSON.stringify(extraResult));
  assert.equal(extraResult.reasonCode, DENIED, JSON.stringify(extraResult));

  const wrongVersion = baseManifest();
  wrongVersion.dependencies['livekit-client'] = '2.20.0';
  const versionResult = evaluateTrustedDelegatedGovernanceBranch(trustedOptions(wrongVersion));
  assert.equal(versionResult.pass, false, JSON.stringify(versionResult));
  assert.equal(versionResult.reasonCode, DENIED, JSON.stringify(versionResult));
});

test('dependency identity policy also prevents unrelated package-manifest script drift', () => {
  const candidate = exactManifest();
  candidate.scripts.build = 'node unreviewed-build.js';
  const result = evaluateTrustedDelegatedGovernanceBranch(trustedOptions(candidate));
  assert.equal(result.pass, false, JSON.stringify(result));
  assert.equal(result.reasonCode, DENIED, JSON.stringify(result));
});

test('historical delegated authorization without dependencyIdentityPolicy remains valid', () => {
  const historical = authorization();
  delete historical.implementation.dependencyIdentityPolicy;
  assert.equal(isValidGenericDelegatedGovernanceAuthorization(historical, AUTHORIZATION_PATH), true);

  const candidate = exactManifest();
  candidate.dependencies['historical-extra'] = '1.0.0';
  const result = evaluateTrustedDelegatedGovernanceBranch(trustedOptions(candidate, historical));
  assert.equal(result.pass, true, JSON.stringify(result));
});
