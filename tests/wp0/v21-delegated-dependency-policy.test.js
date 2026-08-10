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
const LOCK_PATH = 'integration/element-module/package-lock.json';
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

function baseLockfile() {
  return {
    name: '@yance/element-module',
    version: '0.0.0',
    lockfileVersion: 3,
    requires: true,
    packages: {
      '': {
        name: '@yance/element-module',
        version: '0.0.0',
        dependencies: {
          '@element-hq/element-web-module-api': '0.8.0'
        },
        devDependencies: {
          vite: '6.1.0'
        }
      },
      'node_modules/@element-hq/element-web-module-api': {
        version: '0.8.0'
      },
      'node_modules/vite': {
        version: '6.1.0',
        dev: true
      }
    }
  };
}

function exactLockfile() {
  const lockfile = baseLockfile();
  lockfile.packages[''].dependencies['livekit-client'] = '2.21.0';
  lockfile.packages['node_modules/livekit-client'] = {
    version: '2.21.0'
  };
  return lockfile;
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

function authorizationWithLockfile(identityPolicy = dependencyIdentityPolicy()) {
  const document = authorization(identityPolicy);
  const allowedChangedPaths = [LOCK_PATH, MANIFEST_PATH].sort();
  document.implementation.allowedChangedPaths = allowedChangedPaths;
  document.implementation.approvedChangedFileCount = allowedChangedPaths.length;
  document.implementation.approvedChangedFileSetSha256 = workPackageChangedFilesSha256(allowedChangedPaths);
  document.implementation.dependencyModificationPolicy = {
    allowedDependencyPaths: allowedChangedPaths,
    approvedDependencyPathCount: allowedChangedPaths.length,
    approvedDependencyPathSetSha256: workPackageChangedFilesSha256(allowedChangedPaths)
  };
  return document;
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

function trustedOptionsWithLockfile({
  candidateManifest = exactManifest(),
  candidateLockfile = exactLockfile(),
  changedPaths = [LOCK_PATH, MANIFEST_PATH].sort(),
  auth = authorizationWithLockfile()
} = {}) {
  const options = trustedOptions(candidateManifest, auth);
  options.resolveChangedFilesBetween = (base, head) => {
    if (base === BASE && [REVIEWED, MERGE].includes(head)) return [AUTHORIZATION_PATH];
    if (base === MERGE && head === CANDIDATE) return [...changedPaths];
    return [];
  };
  options.loadDependencyControlAtCommit = (commit, path) => {
    if (path === MANIFEST_PATH) {
      if (commit === MERGE) return baseManifest();
      if (commit === CANDIDATE) return candidateManifest;
    }
    if (path === LOCK_PATH) {
      if (commit === MERGE) return baseLockfile();
      if (commit === CANDIDATE) return candidateLockfile;
    }
    return null;
  };
  return options;
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

test('trusted delegated evaluator accepts exact package identity with synchronized npm lockfile closure', () => {
  const auth = authorizationWithLockfile();
  assert.equal(isValidGenericDelegatedGovernanceAuthorization(auth, AUTHORIZATION_PATH), true);

  const result = evaluateTrustedDelegatedGovernanceBranch(trustedOptionsWithLockfile({ auth }));
  assert.equal(result.pass, true, JSON.stringify(result));
});

test('trusted delegated evaluator rejects stale or extra npm lockfile direct-dependency closure', () => {
  const stale = baseLockfile();
  const staleResult = evaluateTrustedDelegatedGovernanceBranch(trustedOptionsWithLockfile({
    candidateLockfile: stale
  }));
  assert.equal(staleResult.pass, false, JSON.stringify(staleResult));
  assert.equal(staleResult.reasonCode, DENIED, JSON.stringify(staleResult));

  const extra = exactLockfile();
  extra.packages[''].dependencies['left-pad'] = '1.3.0';
  extra.packages['node_modules/left-pad'] = { version: '1.3.0' };
  const extraResult = evaluateTrustedDelegatedGovernanceBranch(trustedOptionsWithLockfile({
    candidateLockfile: extra
  }));
  assert.equal(extraResult.pass, false, JSON.stringify(extraResult));
  assert.equal(extraResult.reasonCode, DENIED, JSON.stringify(extraResult));
});

test('trusted delegated evaluator rejects an unreferenced npm lock artifact descriptor', () => {
  const descriptorOnly = exactLockfile();
  descriptorOnly.packages['node_modules/left-pad'] = {
    version: '1.3.0',
    resolved: 'https://mirror.example.invalid/left-pad-1.3.0.tgz',
    integrity: 'sha512-undeclared-left-pad'
  };

  const result = evaluateTrustedDelegatedGovernanceBranch(trustedOptionsWithLockfile({
    candidateLockfile: descriptorOnly
  }));
  assert.equal(result.pass, false, JSON.stringify(result));
  assert.equal(result.reasonCode, DENIED, JSON.stringify(result));
});

test('trusted delegated evaluator rejects lockfile-only dependency identity drift', () => {
  const result = evaluateTrustedDelegatedGovernanceBranch(trustedOptionsWithLockfile({
    candidateManifest: baseManifest(),
    candidateLockfile: exactLockfile(),
    changedPaths: [LOCK_PATH]
  }));
  assert.equal(result.pass, false, JSON.stringify(result));
  assert.equal(result.reasonCode, DENIED, JSON.stringify(result));
});

test('trusted delegated evaluator requires an authorized existing npm lockfile companion to change with its manifest', () => {
  const result = evaluateTrustedDelegatedGovernanceBranch(trustedOptionsWithLockfile({
    changedPaths: [MANIFEST_PATH]
  }));
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

test('trusted delegated evaluator rejects stale direct npm lock entry versions', () => {
  const staleResolution = exactLockfile();
  staleResolution.packages['node_modules/livekit-client'].version = '2.20.0';

  const result = evaluateTrustedDelegatedGovernanceBranch(trustedOptionsWithLockfile({
    candidateLockfile: staleResolution
  }));
  assert.equal(result.pass, false, JSON.stringify(result));
  assert.equal(result.reasonCode, DENIED, JSON.stringify(result));
});

test('trusted delegated evaluator rejects manifest-only identity when base already has an omitted npm lockfile', () => {
  const options = trustedOptions(exactManifest());
  const resolveAuthorizationBlob = options.resolveCommitBlobSha;
  const lockBlob = '7'.repeat(40);
  options.resolveCommitBlobSha = (commit, repositoryPath) => {
    if (repositoryPath === LOCK_PATH && [MERGE, TRUSTED_MAIN, CANDIDATE].includes(commit)) return lockBlob;
    return resolveAuthorizationBlob(commit, repositoryPath);
  };
  options.loadDependencyControlAtCommit = (commit, repositoryPath) => {
    if (repositoryPath === MANIFEST_PATH) {
      if (commit === MERGE) return baseManifest();
      if (commit === CANDIDATE) return exactManifest();
    }
    if (repositoryPath === LOCK_PATH) {
      if (commit === MERGE) return baseLockfile();
      if (commit === CANDIDATE) return baseLockfile();
    }
    return null;
  };

  const result = evaluateTrustedDelegatedGovernanceBranch(options);
  assert.equal(result.pass, false, JSON.stringify(result));
  assert.equal(result.reasonCode, DENIED, JSON.stringify(result));
});

test('trusted delegated evaluator rejects manifest-only identity when trusted main adds an npm lockfile after the implementation base', () => {
  const options = trustedOptions(exactManifest());
  const resolveAuthorizationBlob = options.resolveCommitBlobSha;
  const lockBlob = '8'.repeat(40);
  options.resolveCommitBlobSha = (commit, repositoryPath) => {
    if (repositoryPath === LOCK_PATH && commit === TRUSTED_MAIN) return lockBlob;
    return resolveAuthorizationBlob(commit, repositoryPath);
  };

  const result = evaluateTrustedDelegatedGovernanceBranch(options);
  assert.equal(result.pass, false, JSON.stringify(result));
  assert.equal(result.reasonCode, DENIED, JSON.stringify(result));
});

test('trusted delegated evaluator rejects unrelated existing direct npm lock descriptor drift', () => {
  const driftedLockfile = exactLockfile();
  driftedLockfile.packages['node_modules/vite'].version = '6.2.0';

  const result = evaluateTrustedDelegatedGovernanceBranch(trustedOptionsWithLockfile({
    candidateLockfile: driftedLockfile
  }));
  assert.equal(result.pass, false, JSON.stringify(result));
  assert.equal(result.reasonCode, DENIED, JSON.stringify(result));
});

test('trusted delegated evaluator rejects unrelated existing direct npm lock artifact drift at the same version', () => {
  const baselineLockfile = baseLockfile();
  baselineLockfile.packages['node_modules/vite'].resolved = 'https://registry.npmjs.org/vite/-/vite-6.1.0.tgz';
  baselineLockfile.packages['node_modules/vite'].integrity = 'sha512-baseline-vite';

  const driftedLockfile = exactLockfile();
  driftedLockfile.packages['node_modules/vite'].resolved = 'https://mirror.example.invalid/vite-6.1.0.tgz';
  driftedLockfile.packages['node_modules/vite'].integrity = 'sha512-drifted-vite';

  const options = trustedOptionsWithLockfile({ candidateLockfile: driftedLockfile });
  const loadDependencyControlAtCommit = options.loadDependencyControlAtCommit;
  options.loadDependencyControlAtCommit = (commit, repositoryPath) => {
    if (repositoryPath === LOCK_PATH && commit === MERGE) return baselineLockfile;
    return loadDependencyControlAtCommit(commit, repositoryPath);
  };

  const result = evaluateTrustedDelegatedGovernanceBranch(options);
  assert.equal(result.pass, false, JSON.stringify(result));
  assert.equal(result.reasonCode, DENIED, JSON.stringify(result));
});

test('trusted delegated evaluator rejects an installed peer that violates the exact authorized peer version', () => {
  const peerIdentity = dependencyIdentityPolicy([{
    path: MANIFEST_PATH,
    section: 'peerDependencies',
    name: 'livekit-client',
    version: '2.21.0'
  }]);
  const candidateManifest = baseManifest();
  candidateManifest.peerDependencies = { 'livekit-client': '2.21.0' };
  const candidateLockfile = baseLockfile();
  candidateLockfile.packages[''].peerDependencies = { 'livekit-client': '2.21.0' };
  candidateLockfile.packages['node_modules/livekit-client'] = { version: '2.20.0' };

  const result = evaluateTrustedDelegatedGovernanceBranch(trustedOptionsWithLockfile({
    candidateManifest,
    candidateLockfile,
    auth: authorizationWithLockfile(peerIdentity)
  }));
  assert.equal(result.pass, false, JSON.stringify(result));
  assert.equal(result.reasonCode, DENIED, JSON.stringify(result));
});

test('trusted delegated evaluator rejects missing required npm topology while preserving optional absence', () => {
  const missingRequired = exactLockfile();
  missingRequired.packages['node_modules/livekit-client'].dependencies = {
    'missing-required-child': '1.0.0'
  };
  const requiredResult = evaluateTrustedDelegatedGovernanceBranch(trustedOptionsWithLockfile({
    candidateLockfile: missingRequired
  }));
  assert.equal(requiredResult.pass, false, JSON.stringify(requiredResult));
  assert.equal(requiredResult.reasonCode, DENIED, JSON.stringify(requiredResult));

  const missingOptional = exactLockfile();
  missingOptional.packages['node_modules/livekit-client'].optionalDependencies = {
    'missing-optional-child': '1.0.0'
  };
  const optionalResult = evaluateTrustedDelegatedGovernanceBranch(trustedOptionsWithLockfile({
    candidateLockfile: missingOptional
  }));
  assert.equal(optionalResult.pass, true, JSON.stringify(optionalResult));
});

test('trusted delegated evaluator accepts an exact brand-new npm manifest with exact authorized sibling lock closure', () => {
  const candidateManifest = {
    dependencies: {
      'livekit-client': '2.21.0'
    }
  };
  const candidateLockfile = {
    lockfileVersion: 3,
    requires: true,
    packages: {
      '': {
        dependencies: {
          'livekit-client': '2.21.0'
        }
      },
      'node_modules/livekit-client': {
        version: '2.21.0'
      }
    }
  };
  const options = trustedOptionsWithLockfile({ candidateManifest, candidateLockfile });
  options.loadDependencyControlAtCommit = (commit, repositoryPath) => {
    if (commit === MERGE && [MANIFEST_PATH, LOCK_PATH].includes(repositoryPath)) return null;
    if (commit === CANDIDATE && repositoryPath === MANIFEST_PATH) return candidateManifest;
    if (commit === CANDIDATE && repositoryPath === LOCK_PATH) return candidateLockfile;
    return null;
  };

  const result = evaluateTrustedDelegatedGovernanceBranch(options);
  assert.equal(result.pass, true, JSON.stringify(result));
  assert.equal(result.reasonCode, null, JSON.stringify(result));
});

test('trusted delegated evaluator keeps brand-new npm manifests exact and rejects extra metadata, scripts and dependencies', () => {
  const exactNewManifest = {
    dependencies: {
      'livekit-client': '2.21.0'
    }
  };
  const exactNewLockfile = {
    lockfileVersion: 3,
    requires: true,
    packages: {
      '': {
        dependencies: {
          'livekit-client': '2.21.0'
        }
      },
      'node_modules/livekit-client': {
        version: '2.21.0'
      }
    }
  };
  const fixtures = [
    ['metadata', { ...exactNewManifest, name: 'unreviewed-runtime' }],
    ['scripts', { ...exactNewManifest, scripts: { postinstall: 'node unreviewed.js' } }],
    ['dependency', { dependencies: { ...exactNewManifest.dependencies, 'left-pad': '1.3.0' } }]
  ];

  for (const [name, candidateManifest] of fixtures) {
    const candidateLockfile = clone(exactNewLockfile);
    if (name === 'dependency') {
      candidateLockfile.packages[''].dependencies['left-pad'] = '1.3.0';
      candidateLockfile.packages['node_modules/left-pad'] = { version: '1.3.0' };
    }
    const options = trustedOptionsWithLockfile({ candidateManifest, candidateLockfile });
    options.loadDependencyControlAtCommit = (commit, repositoryPath) => {
      if (commit === MERGE && [MANIFEST_PATH, LOCK_PATH].includes(repositoryPath)) return null;
      if (commit === CANDIDATE && repositoryPath === MANIFEST_PATH) return candidateManifest;
      if (commit === CANDIDATE && repositoryPath === LOCK_PATH) return candidateLockfile;
      return null;
    };
    const result = evaluateTrustedDelegatedGovernanceBranch(options);
    assert.equal(result.pass, false, `${name}: ${JSON.stringify(result)}`);
    assert.equal(result.reasonCode, DENIED, name);
  }
});
