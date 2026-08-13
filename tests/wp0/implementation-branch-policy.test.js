'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  canonicalStageBranch,
  isReleaseClosureRebuildBranch,
  isAuthorizedDelegatedGovernanceBranch,
  isValidGenericDelegatedGovernanceAuthorization,
  evaluateDelegatedGovernanceAuthorizationProposal,
  evaluateTrustedDelegatedGovernanceBranch,
  isAuthorizedImplementationBranch,
  authorizedImplementationBranchDescription,
  buildTrustedGitEnvironment,
  loadWorkPackageScopeAmendment,
  loadWorkPackageTaskScopeChain,
  loadWorkPackagePostMergeDefect,
  isValidWorkPackageScopeAmendment,
  validateWorkPackageTaskScopeChain,
  isValidWorkPackagePostMergeDefect,
  evaluateAuthorizedWorkPackageScope,
  evaluateAuthorizedWorkPackageTaskScope,
  evaluateAuthorizedPostMergeDefectScope,
  workPackageChangedFilesSha256
} = require('../../shared/release/implementationBranchPolicy');
const { CURRENT_STAGE, currentBranch, checkRuntimeTargetGate } = require('../../tools/wp0/lib');

const REPO_ROOT = path.join(__dirname, '..', '..');
const AUTHORIZATION_PATH = path.join(REPO_ROOT, 'governance', 'architecture-closure-v2', 'implementation-plan-authorization.json');
const A6_CLOSURE_PATH = path.join(REPO_ROOT, 'governance', 'architecture-closure-v2', 'wp-a-a6-closure.json');
const PARENT_GOVERNANCE_HEAD = 'd81599d8a3f3de891da369b6f1ddbd01e264c78d';
const A6_FROZEN_DIGEST = 'd2cac11bd6864b02e09fa68015dbdba5c41bb2777bf79e821f00a846b651702a';
const SOURCE_MERGE_AUTHORIZATION_PATH = 'governance/layered-ci/oss-a-source-merge-authorization.json';
const BRANCH_REPAIR_AUTHORIZATION_PATH = 'governance/layered-ci/oss-a-source-merge-policy-branch-authority-authorization.json';
const SOURCE_MERGE_POLICY_BRANCH = 'governance/oss-a-source-merge-policy';
const BRANCH_REPAIR_BRANCH = 'fix/oss-a-source-merge-policy-branch-authority';
const SOURCE_AUTH_MERGE = 'fac7d298f182043f4ecc6e41a780248ce3a03132';
const SOURCE_AUTH_PARENT = 'ad195d8497ec61fbe3387c606692110f5645fba0';
const SOURCE_AUTH_HEAD = 'f50590181e19cdc134c35d91ae9421af5b532ce8';
const SOURCE_AUTH_BLOB = '99ee3e5243d07fed5cea6661cb6ad82123771bc8';
const REPAIR_AUTH_MERGE = '8311cd15572bdc89316c47485459017613b2e2c8';
const REPAIR_AUTH_PARENT = SOURCE_AUTH_MERGE;
const REPAIR_AUTH_HEAD = '97e6ebc2d83d7e775879603e2383dd1f321fa868';
const REPAIR_AUTH_BLOB = '5c675b30e71de55e524bf8ce5c0ac6d60718d11b';
const GENERIC_AUTHORIZATION_PATH = 'governance/layered-ci/pvep-wp0-branch-authority-v2-authorization.json';
const GENERIC_AUTHORIZATION_BRANCH = 'governance/pvep-wp0-branch-authority-v2-authorization';
const GENERIC_IMPLEMENTATION_BRANCH = 'fix/pvep-wp0-branch-authority-v2';
const GENERIC_BASE = '1'.repeat(40);
const GENERIC_REVIEWED_HEAD = '2'.repeat(40);
const GENERIC_MERGE = '3'.repeat(40);
const GENERIC_TRUSTED_MAIN = '4'.repeat(40);
const GENERIC_IMPLEMENTATION_HEAD = '5'.repeat(40);
const GENERIC_BLOB = '6'.repeat(40);


function authorization() {
  return JSON.parse(fs.readFileSync(AUTHORIZATION_PATH, 'utf8'));
}

function readRepositoryJson(repositoryPath) {
  return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, ...repositoryPath.split('/')), 'utf8'));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function changedFilesFrom(baseHead) {
  const output = execFileSync('git', [
    '-c',
    'core.quotePath=false',
    'diff',
    '--name-only',
    '-z',
    baseHead,
    'HEAD',
    '--'
  ], {
    cwd: REPO_ROOT,
    encoding: null
  });
  return output.toString('utf8').split('\0').filter(Boolean).sort();
}

function actualWorkPackageChangedFiles() {
  return changedFilesFrom(PARENT_GOVERNANCE_HEAD);
}

function scopeAmendment(document, changedFiles) {
  return {
    schemaVersion: 1,
    documentType: 'YANCE_ACV2_WORK_PACKAGE_SCOPE_AMENDMENT',
    status: 'APPROVED_INDEPENDENT_REVIEW_SCOPE_AMENDMENT',
    repository: document.repository,
    workPackage: document.currentAuthorizedWorkPackage,
    task: 'A6_INDEPENDENT_ROOT_REPAIR_AND_GOVERNANCE_SCOPE_CLOSURE',
    authorizedBranch: document.authorizedBranch,
    pullRequest: 5,
    baseAuthorizationPath: 'governance/architecture-closure-v2/implementation-plan-authorization.json',
    baseAuthorizationBlobSha: '203697b36c06e0dc72c92113ef58f1a8f2394312',
    parentGovernanceHead: PARENT_GOVERNANCE_HEAD,
    approvedChangedFileCount: changedFiles.length,
    approvedChangedFileSetSha256: workPackageChangedFilesSha256(changedFiles),
    additionalAllowedPaths: [
      'backend/runtime/AppRuntime.js',
      'tools/wp0/lib.js'
    ],
    governance: {
      exactPathExpansionOnly: true,
      wildcardExpansionAllowed: false,
      prMustRemainDraft: true,
      automaticNextTaskAuthorization: false,
      automaticNextWorkPackageAuthorization: false,
      readyForPromotion: false
    }
  };
}

function genericDelegatedAuthorization(overrides = {}) {
  const allowedChangedPaths = overrides.allowedChangedPaths || [
    'shared/release/implementationBranchPolicy.js',
    'tests/wp0/implementation-branch-policy.test.js',
    'tools/wp0/lib.js'
  ];
  return {
    schemaVersion: 1,
    documentType: 'YANCE_DELEGATED_GOVERNANCE_BRANCH_AUTHORIZATION',
    repository: 'laiqian0239-glitch/yance',
    workPackage: 'PVEP',
    status: 'AUTHORIZED_AFTER_TRUSTED_MAIN_MERGE',
    base: { branch: 'main', commit: GENERIC_BASE },
    effectiveness: {
      effectiveBeforeMerge: false,
      requiresOrdinaryTwoParentMainMerge: true,
      implementationMayStartOnlyFromAuthorizationMergeCommit: true,
      authorizationProposalTransportIsNotImplementationAuthority: true
    },
    authorizationBranch: {
      name: GENERIC_AUTHORIZATION_BRANCH,
      allowedChangedPaths: [GENERIC_AUTHORIZATION_PATH],
      mustRemainSingleFile: true
    },
    implementation: {
      branch: GENERIC_IMPLEMENTATION_BRANCH,
      allowedChangedPaths,
      approvedChangedFileCount: allowedChangedPaths.length,
      approvedChangedFileSetSha256: workPackageChangedFilesSha256(allowedChangedPaths),
      newDependencyAllowed: false,
      workflowModificationAllowed: false
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
    },
    // Nested objects in overrides.document intentionally replace the fixture defaults.
    ...overrides.document
  };
}

function genericTrustedAuthorityOptions(overrides = {}) {
  const authorization = overrides.authorization || genericDelegatedAuthorization();
  const evaluatedHead = overrides.evaluatedHead || GENERIC_IMPLEMENTATION_HEAD;
  return {
    trustedMainHead: overrides.trustedMainHead || GENERIC_TRUSTED_MAIN,
    evaluatedHead,
    listAuthorizationPaths: () => overrides.authorizationPaths || [GENERIC_AUTHORIZATION_PATH],
    loadAuthorizationAtTrustedHead: repositoryPath => (
      repositoryPath === GENERIC_AUTHORIZATION_PATH ? authorization : null
    ),
    findAuthorizationIntroductionMerges: repositoryPath => (
      repositoryPath === GENERIC_AUTHORIZATION_PATH
        ? (overrides.introductionMerges || [GENERIC_MERGE])
        : []
    ),
    resolveCommitParents: commit => (
      commit === GENERIC_MERGE
        ? (overrides.mergeParents || [GENERIC_BASE, GENERIC_REVIEWED_HEAD])
        : []
    ),
    resolveCommitBlobSha: (commit, repositoryPath) => {
      if (repositoryPath !== GENERIC_AUTHORIZATION_PATH) return null;
      if (Object.prototype.hasOwnProperty.call(overrides.blobByCommit || {}, commit)) {
        return overrides.blobByCommit[commit];
      }
      if ([GENERIC_MERGE, GENERIC_REVIEWED_HEAD, GENERIC_TRUSTED_MAIN].includes(commit)) {
        return GENERIC_BLOB;
      }
      return null;
    },
    resolveCommitPathMode: (commit, repositoryPath) => {
      if (repositoryPath !== GENERIC_AUTHORIZATION_PATH) return null;
      return overrides.pathModeByCommit?.[commit] || '100644';
    },
    resolveMergeBases: () => overrides.mergeBases || [GENERIC_MERGE],
    resolveChangedFilesBetween: (base, head) => {
      if (base === GENERIC_BASE && head === GENERIC_REVIEWED_HEAD) {
        return overrides.reviewedChangedFiles || [GENERIC_AUTHORIZATION_PATH];
      }
      if (base === GENERIC_BASE && head === GENERIC_MERGE) {
        return overrides.mergeChangedFiles || [GENERIC_AUTHORIZATION_PATH];
      }
      if (base === GENERIC_MERGE && head === evaluatedHead) {
        return overrides.implementationChangedFiles || authorization.implementation.allowedChangedPaths;
      }
      throw new Error(`unexpected diff request ${base}..${head}`);
    },
    isTrustedAncestor: (base, head) => {
      if (base === head) return true;
      if (overrides.ancestorResultByPair?.[`${base}:${head}`] !== undefined) {
        return overrides.ancestorResultByPair[`${base}:${head}`];
      }
      return (base === GENERIC_BASE && head === GENERIC_REVIEWED_HEAD)
        || (base === GENERIC_MERGE && head === GENERIC_TRUSTED_MAIN)
        || (base === GENERIC_MERGE && head === evaluatedHead);
    }
  };
}

function delegatedGovernanceOptions(overrides = {}) {
  const sourceAuthorization = readRepositoryJson(SOURCE_MERGE_AUTHORIZATION_PATH);
  const repairAuthorization = readRepositoryJson(BRANCH_REPAIR_AUTHORIZATION_PATH);
  const authorizationByPath = {
    [SOURCE_MERGE_AUTHORIZATION_PATH]: sourceAuthorization,
    [BRANCH_REPAIR_AUTHORIZATION_PATH]: repairAuthorization,
    ...(overrides.authorizationByPath || {})
  };
  const trustedAuthorizationByPath = overrides.trustedAuthorizationByPath || {
    [SOURCE_MERGE_AUTHORIZATION_PATH]: sourceAuthorization,
    [BRANCH_REPAIR_AUTHORIZATION_PATH]: repairAuthorization
  };
  const parentsByCommit = {
    [SOURCE_AUTH_MERGE]: [SOURCE_AUTH_PARENT, SOURCE_AUTH_HEAD],
    [REPAIR_AUTH_MERGE]: [REPAIR_AUTH_PARENT, REPAIR_AUTH_HEAD],
    ...(overrides.parentsByCommit || {})
  };
  const blobByIdentity = {
    [`${SOURCE_AUTH_MERGE}:${SOURCE_MERGE_AUTHORIZATION_PATH}`]: SOURCE_AUTH_BLOB,
    [`${REPAIR_AUTH_MERGE}:${BRANCH_REPAIR_AUTHORIZATION_PATH}`]: REPAIR_AUTH_BLOB,
    ...(overrides.blobByIdentity || {})
  };
  return {
    trustedPolicyHead: overrides.trustedPolicyHead || REPAIR_AUTH_MERGE,
    authorizationByPath,
    loadAuthorization: authority => trustedAuthorizationByPath[authority.authorizationPath] || null,
    resolveCommitParents: commit => parentsByCommit[commit] || [],
    resolveCommitBlobSha: (commit, repositoryPath) => blobByIdentity[`${commit}:${repositoryPath}`] || null,
    isTrustedAncestor: overrides.isTrustedAncestor || ((base, head) => (
      base === head
      || (base === SOURCE_AUTH_MERGE && head === REPAIR_AUTH_MERGE)
    ))
  };
}

test('canonical Stage6 branch remains authorized without permitting rewrite aliases', () => {
  const branch = canonicalStageBranch(CURRENT_STAGE);
  assert.equal(branch, 'stage/6.4.5.9-architecture-closure');
  assert.equal(isAuthorizedImplementationBranch(branch, CURRENT_STAGE), true);
  assert.equal(isAuthorizedImplementationBranch(`${branch}-copy`, CURRENT_STAGE), false);
});

test('dated Windows release-closure rebuild branches are authorized', () => {
  assert.equal(isReleaseClosureRebuildBranch('rebuild/windows-release-closure-20260712'), true);
  assert.equal(isReleaseClosureRebuildBranch('rebuild/windows-release-closure-20260712-gate-fix'), true);
  assert.equal(isAuthorizedImplementationBranch('rebuild/windows-release-closure-20260712', CURRENT_STAGE), true);
});

test('exact machine-authorized ACV2 work-package branch is accepted without a wildcard', () => {
  const document = authorization();
  const exact = document.authorizedBranch;
  assert.equal(isAuthorizedImplementationBranch(exact, CURRENT_STAGE, { authorization: document }), true);
  assert.match(
    authorizedImplementationBranchDescription(CURRENT_STAGE, { authorization: document }),
    new RegExp(exact.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  );

  for (const branch of [
    'acv2/wp-a-arbitrary',
    'acv2/wp-b-durable-execution-outbox',
    `${exact}-copy`,
    'acv2/wp-a/escape'
  ]) assert.equal(isAuthorizedImplementationBranch(branch, CURRENT_STAGE, { authorization: document }), false, branch);

  assert.equal(isAuthorizedImplementationBranch(exact, CURRENT_STAGE, { authorization: { ...document, schemaVersion: 99 } }), false);
  assert.equal(isAuthorizedImplementationBranch(exact, CURRENT_STAGE, { authorization: { ...document, status: 'REVOKED' } }), false);
  assert.equal(isAuthorizedImplementationBranch(exact, CURRENT_STAGE, {
    authorization: { ...document, governance: { ...document.governance, automaticNextWorkPackageAuthorization: true } }
  }), false);
});

test('historical A6 amendment remains immutable and independently valid', () => {
  const document = authorization();
  const amendment = loadWorkPackageScopeAmendment();
  assert.ok(amendment, 'historical A6 scope amendment must exist');
  assert.equal(isValidWorkPackageScopeAmendment(amendment, document), true);
  assert.equal(amendment.approvedChangedFileCount, 83);
  assert.equal(amendment.approvedChangedFileSetSha256, A6_FROZEN_DIGEST);
  assert.equal(amendment.governance.readyForPromotion, false);
});

test('work-package scope requires an exact independently reviewed amendment', () => {
  assert.equal(typeof evaluateAuthorizedWorkPackageScope, 'function');
  assert.equal(typeof workPackageChangedFilesSha256, 'function');
  const document = authorization();
  const changedFiles = [
    'backend/runtime/AppRuntimeFactory.js',
    'backend/runtime/AppRuntime.js',
    'tools/wp0/lib.js'
  ];

  const withoutAmendment = evaluateAuthorizedWorkPackageScope({
    branch: document.authorizedBranch,
    changedFiles,
    authorization: document,
    amendment: null
  });
  assert.equal(withoutAmendment.pass, false);
  assert.deepEqual(withoutAmendment.unauthorizedPaths, [
    'backend/runtime/AppRuntime.js',
    'tools/wp0/lib.js'
  ]);

  const approved = scopeAmendment(document, changedFiles);
  const accepted = evaluateAuthorizedWorkPackageScope({
    branch: document.authorizedBranch,
    changedFiles,
    authorization: document,
    amendment: approved
  });
  assert.equal(accepted.pass, true);
  assert.deepEqual(accepted.unauthorizedPaths, []);

  const unknownPath = 'backend/runtime/UnreviewedWriter.js';
  const expanded = [...changedFiles, unknownPath];
  const unknownResult = evaluateAuthorizedWorkPackageScope({
    branch: document.authorizedBranch,
    changedFiles: expanded,
    authorization: document,
    amendment: {
      ...approved,
      approvedChangedFileCount: expanded.length,
      approvedChangedFileSetSha256: workPackageChangedFilesSha256(expanded)
    }
  });
  assert.equal(unknownResult.pass, false);
  assert.deepEqual(unknownResult.unauthorizedPaths, [unknownPath]);

  const wildcardExpansion = evaluateAuthorizedWorkPackageScope({
    branch: document.authorizedBranch,
    changedFiles,
    authorization: document,
    amendment: { ...approved, additionalAllowedPaths: ['backend/**'] }
  });
  assert.equal(wildcardExpansion.reasonCode, 'ACV2_SCOPE_AMENDMENT_INVALID');

  const wrongParent = evaluateAuthorizedWorkPackageScope({
    branch: document.authorizedBranch,
    changedFiles,
    authorization: document,
    amendment: { ...approved, parentGovernanceHead: 'f'.repeat(40) }
  });
  assert.equal(wrongParent.reasonCode, 'ACV2_SCOPE_AMENDMENT_INVALID');

  const wrongCount = evaluateAuthorizedWorkPackageScope({
    branch: document.authorizedBranch,
    changedFiles,
    authorization: document,
    amendment: { ...approved, approvedChangedFileCount: changedFiles.length + 1 }
  });
  assert.equal(wrongCount.reasonCode, 'ACV2_CHANGED_FILE_SET_MISMATCH');
});

test('checked-out scope preserves immutable A8 closure and validates an exact post-close defect when present', () => {
  const document = authorization();
  const chain = loadWorkPackageTaskScopeChain();
  assert.ok(chain, 'task scope chain must exist and parse as JSON');
  assert.equal(validateWorkPackageTaskScopeChain(chain, document), true);
  assert.equal(chain.activeTask, 'A8');
  assert.equal(chain.status, 'A8_CLOSED');

  const closure = JSON.parse(fs.readFileSync(A6_CLOSURE_PATH, 'utf8'));
  assert.equal(closure.task, 'A6');
  assert.equal(closure.status, 'CLOSED');
  assert.equal(closure.frozenEvidenceBranchTip, chain.tasks[0].evidenceBranchTip);
  assert.equal(closure.governance.readyForPromotion, false);

  const defect = loadWorkPackagePostMergeDefect();
  if (defect && isValidWorkPackagePostMergeDefect(defect)) {
    const changedFiles = [...defect.scope.exactPaths];
    const result = evaluateAuthorizedPostMergeDefectScope({
      branch: defect.scope.targetBranch,
      changedFiles,
      defect
    });
    assert.equal(result.pass, true, JSON.stringify(result));
    assert.equal(result.defectId, 'WP-A-POST-MERGE-DEFECT-001');
    assert.equal(result.changedFileSetSha256, defect.scope.approvedChangedFileSetSha256);
    assert.equal(changedFiles.length, defect.scope.approvedChangedFileCount);
    assert.deepEqual(result.unauthorizedPaths, []);
    assert.equal(result.readyForPromotion, true);

    const currentChangedFiles = changedFilesFrom(defect.scope.baseHead);
    if (workPackageChangedFilesSha256(currentChangedFiles)
      !== defect.scope.approvedChangedFileSetSha256) {
      const currentResult = evaluateAuthorizedPostMergeDefectScope({
        branch: defect.scope.targetBranch,
        changedFiles: currentChangedFiles,
        defect
      });
      assert.equal(currentResult.pass, false);
    }
    return;
  }

  const changedFiles = actualWorkPackageChangedFiles();
  const result = evaluateAuthorizedWorkPackageTaskScope({
    branch: document.authorizedBranch,
    changedFiles,
    authorization: document,
    taskScopeChain: chain
  });
  assert.equal(result.pass, true, JSON.stringify(result));
  assert.equal(result.activeTask, 'A8');
  assert.equal(result.changedFileSetSha256, chain.approvedChangedFileSetSha256);
  assert.equal(changedFiles.length, chain.approvedChangedFileCount);
  assert.deepEqual(result.unauthorizedPaths, []);
  assert.equal(result.readyForPromotion, false);
});

test('trusted Git child environment strips repository and configuration overrides', () => {
  assert.equal(typeof buildTrustedGitEnvironment, 'function');
  const controlled = buildTrustedGitEnvironment({
    PATH: '/trusted/bin',
    SystemRoot: 'C:\\Windows',
    COMSPEC: 'C:\\Windows\\System32\\cmd.exe',
    PATHEXT: '.COM;.EXE;.BAT;.CMD',
    TEMP: '/trusted/tmp',
    GIT_DIR: '/attacker/repository',
    GIT_WORK_TREE: '/attacker/worktree',
    GIT_OBJECT_DIRECTORY: '/attacker/objects',
    GIT_ALTERNATE_OBJECT_DIRECTORIES: '/attacker/alternate',
    GIT_NAMESPACE: 'attacker',
    GIT_CEILING_DIRECTORIES: '/',
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'alias.show',
    GIT_CONFIG_VALUE_0: '!false',
    GIT_CONFIG_GLOBAL: '/attacker/gitconfig',
    GIT_CONFIG_SYSTEM: '/attacker/system-gitconfig',
    HOME: '/attacker/home'
  });
  assert.equal(controlled.PATH, '/trusted/bin');
  assert.equal(controlled.SystemRoot, 'C:\\Windows');
  assert.equal(controlled.GIT_DIR, undefined);
  assert.equal(controlled.GIT_WORK_TREE, undefined);
  assert.equal(controlled.GIT_OBJECT_DIRECTORY, undefined);
  assert.equal(controlled.GIT_ALTERNATE_OBJECT_DIRECTORIES, undefined);
  assert.equal(controlled.GIT_NAMESPACE, undefined);
  assert.equal(controlled.GIT_CEILING_DIRECTORIES, undefined);
  assert.equal(controlled.GIT_CONFIG_COUNT, undefined);
  assert.equal(controlled.GIT_CONFIG_KEY_0, undefined);
  assert.equal(controlled.GIT_CONFIG_VALUE_0, undefined);
  assert.equal(controlled.GIT_CONFIG_SYSTEM, undefined);
  assert.equal(controlled.HOME, undefined);
  assert.equal(controlled.GIT_CONFIG_NOSYSTEM, '1');
  assert.ok(['/dev/null', 'NUL'].includes(controlled.GIT_CONFIG_GLOBAL));
  assert.equal(controlled.GIT_TERMINAL_PROMPT, '0');
});

test('trusted-main delegated governance authorization is exact and fails closed on graph or document drift', () => {
  const exact = delegatedGovernanceOptions();
  assert.equal(isAuthorizedImplementationBranch(BRANCH_REPAIR_BRANCH, CURRENT_STAGE, {
    delegatedGovernance: exact
  }), true);
  assert.equal(isAuthorizedImplementationBranch(SOURCE_MERGE_POLICY_BRANCH, CURRENT_STAGE, {
    delegatedGovernance: exact
  }), true);
  assert.equal(isAuthorizedImplementationBranch(`${SOURCE_MERGE_POLICY_BRANCH}-copy`, CURRENT_STAGE, {
    delegatedGovernance: exact
  }), false);
  assert.equal(isAuthorizedImplementationBranch('governance/arbitrary-policy', CURRENT_STAGE, {
    delegatedGovernance: exact
  }), false);

  const wrongParents = delegatedGovernanceOptions({
    parentsByCommit: { [REPAIR_AUTH_MERGE]: [REPAIR_AUTH_HEAD, REPAIR_AUTH_PARENT] }
  });
  assert.equal(isAuthorizedImplementationBranch(BRANCH_REPAIR_BRANCH, CURRENT_STAGE, {
    delegatedGovernance: wrongParents
  }), false);

  const wrongBlob = delegatedGovernanceOptions({
    blobByIdentity: { [`${SOURCE_AUTH_MERGE}:${SOURCE_MERGE_AUTHORIZATION_PATH}`]: 'f'.repeat(40) }
  });
  assert.equal(isAuthorizedImplementationBranch(SOURCE_MERGE_POLICY_BRANCH, CURRENT_STAGE, {
    delegatedGovernance: wrongBlob
  }), false);

  const tampered = readRepositoryJson(BRANCH_REPAIR_AUTHORIZATION_PATH);
  tampered.implementation.branch = 'governance/arbitrary-policy';
  const structurallyInvalid = delegatedGovernanceOptions({
    authorizationByPath: { [BRANCH_REPAIR_AUTHORIZATION_PATH]: tampered }
  });
  assert.equal(isAuthorizedImplementationBranch('governance/arbitrary-policy', CURRENT_STAGE, {
    delegatedGovernance: structurallyInvalid
  }), false);

  const widened = readRepositoryJson(BRANCH_REPAIR_AUTHORIZATION_PATH);
  widened.implementation.allowedChangedPaths.push('shared/release/parallel-authority.js');
  const digestInvalid = delegatedGovernanceOptions({
    authorizationByPath: { [BRANCH_REPAIR_AUTHORIZATION_PATH]: widened }
  });
  assert.equal(isAuthorizedImplementationBranch(BRANCH_REPAIR_BRANCH, CURRENT_STAGE, {
    delegatedGovernance: digestInvalid
  }), false);

  const originalRepair = readRepositoryJson(BRANCH_REPAIR_AUTHORIZATION_PATH);
  const candidateMismatch = clone(originalRepair);
  candidateMismatch.reason = `${candidateMismatch.reason} candidate-owned drift`;
  const crossCheckInvalid = delegatedGovernanceOptions({
    authorizationByPath: { [BRANCH_REPAIR_AUTHORIZATION_PATH]: candidateMismatch },
    trustedAuthorizationByPath: {
      [SOURCE_MERGE_AUTHORIZATION_PATH]: readRepositoryJson(SOURCE_MERGE_AUTHORIZATION_PATH),
      [BRANCH_REPAIR_AUTHORIZATION_PATH]: originalRepair
    }
  });
  assert.equal(isAuthorizedImplementationBranch(BRANCH_REPAIR_BRANCH, CURRENT_STAGE, {
    delegatedGovernance: crossCheckInvalid
  }), false);
});


test('generic delegated authorization forbids workflow and dependency control paths when their authority flags are false', () => {
  for (const repositoryPath of [
    '.github/workflows/pvep.yml',
    '.github/actions/pvep/action.yml',
    'package.json',
    'package-lock.json',
    'services/facebook-worker/package.json'
  ]) {
    const authorization = genericDelegatedAuthorization({ allowedChangedPaths: [repositoryPath] });
    assert.equal(
      isValidGenericDelegatedGovernanceAuthorization(authorization, GENERIC_AUTHORIZATION_PATH),
      false,
      repositoryPath
    );
  }
});

test('authorization proposal transport is single-file and never grants implementation authority', () => {
  assert.equal(typeof evaluateDelegatedGovernanceAuthorizationProposal, 'function');
  const authorization = genericDelegatedAuthorization();
  const accepted = evaluateDelegatedGovernanceAuthorizationProposal({
    branch: GENERIC_AUTHORIZATION_BRANCH,
    changedFiles: [GENERIC_AUTHORIZATION_PATH],
    authorizationPath: GENERIC_AUTHORIZATION_PATH,
    authorization,
    trustedMainHead: GENERIC_BASE,
    evaluatedHead: GENERIC_REVIEWED_HEAD,
    isTrustedAncestor: (base, head) => base === GENERIC_BASE && head === GENERIC_REVIEWED_HEAD,
    resolveCommitBlobSha: (commit) => commit === GENERIC_BASE ? null : GENERIC_BLOB,
    resolveCommitPathMode: () => '100644'
  });
  assert.equal(accepted.pass, true, JSON.stringify(accepted));
  assert.equal(accepted.mode, 'AUTHORIZATION_PROPOSAL_TRANSPORT');
  assert.equal(accepted.implementationAuthorityGranted, false);

  assert.equal(isAuthorizedImplementationBranch(GENERIC_AUTHORIZATION_BRANCH, CURRENT_STAGE), false);
  const transported = checkRuntimeTargetGate({
    branch: GENERIC_AUTHORIZATION_BRANCH,
    changedFiles: [GENERIC_AUTHORIZATION_PATH],
    authorizationProposal: {
      authorizationPath: GENERIC_AUTHORIZATION_PATH,
      authorization,
      trustedMainHead: GENERIC_BASE,
      evaluatedHead: GENERIC_REVIEWED_HEAD,
      isTrustedAncestor: (base, head) => base === GENERIC_BASE && head === GENERIC_REVIEWED_HEAD,
      resolveCommitBlobSha: (commit) => commit === GENERIC_BASE ? null : GENERIC_BLOB,
      resolveCommitPathMode: () => '100644'
    }
  });
  assert.equal(transported.pass, true, JSON.stringify(transported));
  assert.equal(transported.authorityMode, 'AUTHORIZATION_PROPOSAL_TRANSPORT');
  assert.equal(transported.implementationAuthorityGranted, false);

  const spoofedProposalFacts = checkRuntimeTargetGate({
    branch: 'feature/unreviewed-release',
    changedFiles: [GENERIC_AUTHORIZATION_PATH, 'tools/wp0/lib.js'],
    authorizationProposal: {
      branch: GENERIC_AUTHORIZATION_BRANCH,
      changedFiles: [GENERIC_AUTHORIZATION_PATH],
      authorizationPath: GENERIC_AUTHORIZATION_PATH,
      authorization,
      trustedMainHead: GENERIC_BASE,
      evaluatedHead: GENERIC_REVIEWED_HEAD,
      isTrustedAncestor: () => true,
      resolveCommitBlobSha: (commit) => commit === GENERIC_BASE ? null : GENERIC_BLOB,
      resolveCommitPathMode: () => '100644'
    }
  });
  assert.equal(spoofedProposalFacts.pass, false, 'proposal injection must not override actual branch or changed-file facts');
  assert.equal(spoofedProposalFacts.reasonCode, 'WP0_REJECTED_STAGE_TARGET_DENIED');

  const rejectedTransport = checkRuntimeTargetGate({
    branch: GENERIC_AUTHORIZATION_BRANCH,
    changedFiles: [GENERIC_AUTHORIZATION_PATH, 'tools/wp0/lib.js'],
    authorizationProposal: {
      authorizationPath: GENERIC_AUTHORIZATION_PATH,
      authorization,
      trustedMainHead: GENERIC_BASE,
      evaluatedHead: GENERIC_REVIEWED_HEAD,
      isTrustedAncestor: (base, head) => base === GENERIC_BASE && head === GENERIC_REVIEWED_HEAD
    }
  });
  assert.equal(rejectedTransport.pass, false);
  assert.equal(rejectedTransport.reasonCode, 'WP0_REJECTED_STAGE_TARGET_DENIED');
  assert.equal(
    rejectedTransport.authorizationProposalReasonCode,
    'WP0_AUTHORIZATION_PROPOSAL_TRANSPORT_INVALID'
  );

  const staleMain = evaluateDelegatedGovernanceAuthorizationProposal({
    branch: GENERIC_AUTHORIZATION_BRANCH,
    changedFiles: [GENERIC_AUTHORIZATION_PATH],
    authorizationPath: GENERIC_AUTHORIZATION_PATH,
    authorization,
    trustedMainHead: 'f'.repeat(40)
  });
  assert.equal(staleMain.pass, false);

  const unrelatedHead = evaluateDelegatedGovernanceAuthorizationProposal({
    branch: GENERIC_AUTHORIZATION_BRANCH,
    changedFiles: [GENERIC_AUTHORIZATION_PATH],
    authorizationPath: GENERIC_AUTHORIZATION_PATH,
    authorization,
    trustedMainHead: GENERIC_BASE,
    evaluatedHead: GENERIC_REVIEWED_HEAD,
    isTrustedAncestor: () => false
  });
  assert.equal(unrelatedHead.pass, false, 'proposal Head must descend from its trusted-main base');

  const existingAuthorizationPath = evaluateDelegatedGovernanceAuthorizationProposal({
    branch: GENERIC_AUTHORIZATION_BRANCH,
    changedFiles: [GENERIC_AUTHORIZATION_PATH],
    authorizationPath: GENERIC_AUTHORIZATION_PATH,
    authorization,
    trustedMainHead: GENERIC_BASE,
    evaluatedHead: GENERIC_REVIEWED_HEAD,
    isTrustedAncestor: () => true,
    resolveCommitBlobSha: () => GENERIC_BLOB,
    resolveCommitPathMode: () => '100644'
  });
  assert.equal(existingAuthorizationPath.pass, false, 'proposal transport must not overwrite an existing authority path');

  const symlinkAuthorization = evaluateDelegatedGovernanceAuthorizationProposal({
    branch: GENERIC_AUTHORIZATION_BRANCH,
    changedFiles: [GENERIC_AUTHORIZATION_PATH],
    authorizationPath: GENERIC_AUTHORIZATION_PATH,
    authorization,
    trustedMainHead: GENERIC_BASE,
    evaluatedHead: GENERIC_REVIEWED_HEAD,
    isTrustedAncestor: () => true,
    resolveCommitBlobSha: () => null,
    resolveCommitPathMode: () => '120000'
  });
  assert.equal(symlinkAuthorization.pass, false, 'authorization proposal must be a regular 100644 blob');

  for (const [name, candidate] of [
    ['extra changed path', {
      changedFiles: [GENERIC_AUTHORIZATION_PATH, 'shared/release/implementationBranchPolicy.js']
    }],
    ['effective before merge', {
      authorization: genericDelegatedAuthorization({
        document: {
          effectiveness: {
            ...authorization.effectiveness,
            effectiveBeforeMerge: true
          }
        }
      })
    }],
    ['proposal self-authorizes', {
      authorization: genericDelegatedAuthorization({
        document: {
          implementation: {
            ...authorization.implementation,
            branch: GENERIC_AUTHORIZATION_BRANCH
          }
        }
      })
    }],
    ['wildcard implementation path', {
      authorization: genericDelegatedAuthorization({
        allowedChangedPaths: ['shared/release/**']
      })
    }],
    ['authorization branch mismatch', {
      authorization: genericDelegatedAuthorization({
        document: {
          authorizationBranch: {
            ...authorization.authorizationBranch,
            name: 'governance/some-other-authorization'
          }
        }
      })
    }],
    ['single-file guarantee removed', {
      authorization: genericDelegatedAuthorization({
        document: {
          authorizationBranch: {
            ...authorization.authorizationBranch,
            mustRemainSingleFile: false
          }
        }
      })
    }]
  ]) {
    const result = evaluateDelegatedGovernanceAuthorizationProposal({
      branch: GENERIC_AUTHORIZATION_BRANCH,
      changedFiles: candidate.changedFiles || [GENERIC_AUTHORIZATION_PATH],
      authorizationPath: GENERIC_AUTHORIZATION_PATH,
      authorization: candidate.authorization || authorization,
      trustedMainHead: GENERIC_BASE
    });
    assert.equal(result.pass, false, name);
  }
});

test('generic delegated authority activates only from canonical main two-parent introduction', () => {
  const exact = genericTrustedAuthorityOptions();
  assert.equal(isAuthorizedDelegatedGovernanceBranch(GENERIC_IMPLEMENTATION_BRANCH, {
    generic: exact
  }), true);
  assert.equal(isAuthorizedDelegatedGovernanceBranch(`${GENERIC_IMPLEMENTATION_BRANCH}-copy`, {
    generic: exact
  }), false);

  assert.equal(isAuthorizedDelegatedGovernanceBranch(GENERIC_IMPLEMENTATION_BRANCH, {
    generic: genericTrustedAuthorityOptions({
      mergeParents: [GENERIC_REVIEWED_HEAD, GENERIC_BASE]
    })
  }), false, 'wrong parent order must fail closed');

  assert.equal(isAuthorizedDelegatedGovernanceBranch(GENERIC_IMPLEMENTATION_BRANCH, {
    generic: genericTrustedAuthorityOptions({
      blobByCommit: { [GENERIC_TRUSTED_MAIN]: 'f'.repeat(40) }
    })
  }), false, 'trusted-main blob drift must fail closed');

  assert.equal(isAuthorizedDelegatedGovernanceBranch(GENERIC_IMPLEMENTATION_BRANCH, {
    generic: genericTrustedAuthorityOptions({
      pathModeByCommit: { [GENERIC_REVIEWED_HEAD]: '120000' }
    })
  }), false, 'authorization path must remain a regular 100644 blob across reviewed, merge, and trusted-main identities');

  assert.equal(isAuthorizedDelegatedGovernanceBranch(GENERIC_IMPLEMENTATION_BRANCH, {
    generic: genericTrustedAuthorityOptions({
      blobByCommit: { [GENERIC_BASE]: 'e'.repeat(40) }
    })
  }), false, 'authorization path already present at base must fail closed');

  assert.equal(isAuthorizedDelegatedGovernanceBranch(GENERIC_IMPLEMENTATION_BRANCH, {
    generic: genericTrustedAuthorityOptions({
      reviewedChangedFiles: [GENERIC_AUTHORIZATION_PATH, 'governance/layered-ci/extra.json']
    })
  }), false, 'reviewed authorization Head must remain single-file');

  assert.equal(isAuthorizedDelegatedGovernanceBranch(GENERIC_IMPLEMENTATION_BRANCH, {
    generic: genericTrustedAuthorityOptions({
      mergeChangedFiles: [GENERIC_AUTHORIZATION_PATH, 'governance/layered-ci/merge-only-extra.json']
    })
  }), false, 'authorization introduction merge must remain single-file against first parent');

  assert.equal(isAuthorizedDelegatedGovernanceBranch(GENERIC_IMPLEMENTATION_BRANCH, {
    generic: genericTrustedAuthorityOptions({
      ancestorResultByPair: { [`${GENERIC_MERGE}:${GENERIC_TRUSTED_MAIN}`]: false }
    })
  }), false, 'candidate-owned merge not on canonical main must not authorize');

  assert.equal(isAuthorizedDelegatedGovernanceBranch(GENERIC_IMPLEMENTATION_BRANCH, {
    generic: genericTrustedAuthorityOptions({
      ancestorResultByPair: { [`${GENERIC_BASE}:${GENERIC_REVIEWED_HEAD}`]: false }
    })
  }), false, 'reviewed authorization Head must descend from its declared trusted-main base');

  const widened = genericDelegatedAuthorization({
    document: {
      implementation: {
        ...genericDelegatedAuthorization().implementation,
        approvedChangedFileSetSha256: 'f'.repeat(64)
      }
    }
  });
  assert.equal(isAuthorizedDelegatedGovernanceBranch(GENERIC_IMPLEMENTATION_BRANCH, {
    generic: genericTrustedAuthorityOptions({ authorization: widened })
  }), false, 'implementation path digest drift must fail closed');

  assert.equal(typeof evaluateTrustedDelegatedGovernanceBranch, 'function');
  const scoped = evaluateTrustedDelegatedGovernanceBranch({
    branch: GENERIC_IMPLEMENTATION_BRANCH,
    ...exact
  });
  assert.equal(scoped.pass, true, JSON.stringify(scoped));
  assert.equal(scoped.authorityMode, 'TRUSTED_MAIN_DELEGATED_GOVERNANCE');
  assert.deepEqual(scoped.unauthorizedPaths, []);

  const scopeEscape = evaluateTrustedDelegatedGovernanceBranch({
    branch: GENERIC_IMPLEMENTATION_BRANCH,
    ...genericTrustedAuthorityOptions({
      implementationChangedFiles: [
        ...genericDelegatedAuthorization().implementation.allowedChangedPaths,
        'shared/release/unreviewed-authority.js'
      ].sort()
    })
  });
  assert.equal(scopeEscape.pass, false);
  assert.deepEqual(scopeEscape.unauthorizedPaths, ['shared/release/unreviewed-authority.js']);

  const ambiguousMergeBase = evaluateTrustedDelegatedGovernanceBranch({
    branch: GENERIC_IMPLEMENTATION_BRANCH,
    ...genericTrustedAuthorityOptions({
      mergeBases: [GENERIC_MERGE, '7'.repeat(40)]
    })
  });
  assert.equal(ambiguousMergeBase.pass, false);
  assert.equal(ambiguousMergeBase.reasonCode, 'WP0_DELEGATED_GOVERNANCE_AUTHORITY_INVALID');
});


function isolatedGitEnvironment(root) {
  const nullDevice = process.platform === 'win32' ? 'NUL' : '/dev/null';
  return {
    ...buildTrustedGitEnvironment(process.env),
    HOME: root,
    USERPROFILE: root,
    GIT_CONFIG_GLOBAL: nullDevice,
    GIT_CONFIG_SYSTEM: nullDevice,
    GIT_CONFIG_NOSYSTEM: '1'
  };
}

test('generic delegated authority verifies a real two-parent Git introduction and exact implementation diff', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-generic-authority-'));
  const git = (...args) => execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: isolatedGitEnvironment(root)
  }).trim();
  const write = (repositoryPath, content) => {
    const filePath = path.join(root, ...repositoryPath.split('/'));
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
  };

  try {
    git('init', '-b', 'main');
    git('config', 'user.name', 'Yance Test');
    git('config', 'user.email', 'yance-test@example.invalid');
    write('.base', 'base\n');
    git('add', '.base');
    git('commit', '-m', 'base');
    const base = git('rev-parse', 'HEAD');

    const authorizationPath = 'governance/layered-ci/real-git-authority-authorization.json';
    const authorizationBranch = 'governance/real-git-authority-authorization';
    const implementationBranch = 'fix/real-git-authority';
    const allowedChangedPaths = ['shared/release/implementationBranchPolicy.js'];
    const authorization = genericDelegatedAuthorization({
      allowedChangedPaths,
      document: {
        base: { branch: 'main', commit: base },
        authorizationBranch: {
          name: authorizationBranch,
          allowedChangedPaths: [authorizationPath],
          mustRemainSingleFile: true
        },
        implementation: {
          branch: implementationBranch,
          allowedChangedPaths,
          approvedChangedFileCount: allowedChangedPaths.length,
          approvedChangedFileSetSha256: workPackageChangedFilesSha256(allowedChangedPaths),
          newDependencyAllowed: false,
          workflowModificationAllowed: false
        }
      }
    });

    git('switch', '-c', authorizationBranch);
    write(authorizationPath, `${JSON.stringify(authorization, null, 2)}\n`);
    git('add', authorizationPath);
    git('commit', '-m', 'authorize exact delegated repair');
    const reviewedHead = git('rev-parse', 'HEAD');

    git('switch', 'main');
    git('merge', '--no-ff', authorizationBranch, '-m', 'merge delegated authorization');
    const authorizationMerge = git('rev-parse', 'HEAD');
    assert.deepEqual(git('rev-list', '--parents', '-n', '1', authorizationMerge).split(/\s+/u).slice(1), [
      base,
      reviewedHead
    ]);

    git('switch', '-c', implementationBranch);
    write(allowedChangedPaths[0], 'module.exports = true;\n');
    git('add', allowedChangedPaths[0]);
    git('commit', '-m', 'implement exact delegated repair');
    const implementationHead = git('rev-parse', 'HEAD');

    const accepted = evaluateTrustedDelegatedGovernanceBranch({
      branch: implementationBranch,
      trustedPolicyRoot: root,
      evaluatedHead: implementationHead
    });
    assert.equal(accepted.pass, true, JSON.stringify(accepted));
    assert.equal(accepted.authorizationMergeCommit, authorizationMerge);
    assert.equal(accepted.reviewedAuthorizationHead, reviewedHead);
    assert.deepEqual(accepted.unauthorizedPaths, []);

    write('shared/release/unreviewed-authority.js', 'module.exports = false;\n');
    git('add', 'shared/release/unreviewed-authority.js');
    git('commit', '-m', 'escape exact delegated scope');
    const escapedHead = git('rev-parse', 'HEAD');
    const rejected = evaluateTrustedDelegatedGovernanceBranch({
      branch: implementationBranch,
      trustedPolicyRoot: root,
      evaluatedHead: escapedHead
    });
    assert.equal(rejected.pass, false);
    assert.equal(rejected.reasonCode, 'WP0_DELEGATED_GOVERNANCE_SCOPE_DENIED');
    assert.deepEqual(rejected.unauthorizedPaths, ['shared/release/unreviewed-authority.js']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});


test('authorization proposal transport rejects a rename disguised as a single destination path', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-authorization-rename-'));
  const git = (...args) => execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: isolatedGitEnvironment(root)
  }).trim();
  const write = (repositoryPath, content) => {
    const filePath = path.join(root, ...repositoryPath.split('/'));
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
  };

  try {
    git('init', '-b', 'main');
    git('config', 'user.name', 'Yance Test');
    git('config', 'user.email', 'yance-test@example.invalid');
    const sourcePath = 'governance/layered-ci/rename-source-authorization.json';
    const authorizationPath = 'governance/layered-ci/rename-target-authorization.json';
    const authorizationBranch = 'governance/rename-target-authorization';
    const implementationBranch = 'fix/rename-target-authority';
    const allowedChangedPaths = ['tools/wp0/lib.js'];
    const seed = genericDelegatedAuthorization({
      allowedChangedPaths,
      document: {
        base: { branch: 'main', commit: '0'.repeat(40) },
        authorizationBranch: {
          name: authorizationBranch,
          allowedChangedPaths: [authorizationPath],
          mustRemainSingleFile: true
        },
        implementation: {
          branch: implementationBranch,
          allowedChangedPaths,
          approvedChangedFileCount: 1,
          approvedChangedFileSetSha256: workPackageChangedFilesSha256(allowedChangedPaths),
          newDependencyAllowed: false,
          workflowModificationAllowed: false
        }
      }
    });
    write(sourcePath, `${JSON.stringify(seed, null, 2)}\n`);
    git('add', sourcePath);
    git('commit', '-m', 'seed similar authorization bytes');
    const base = git('rev-parse', 'HEAD');

    git('switch', '-c', authorizationBranch);
    fs.renameSync(
      path.join(root, ...sourcePath.split('/')),
      path.join(root, ...authorizationPath.split('/'))
    );
    const authorization = {
      ...seed,
      base: { branch: 'main', commit: base }
    };
    write(authorizationPath, `${JSON.stringify(authorization, null, 2)}\n`);
    git('add', '-A');
    git('commit', '-m', 'rename into authorization path');
    const evaluatedHead = git('rev-parse', 'HEAD');

    const detectedByGit = git('diff', '--name-status', '-M', base, evaluatedHead, '--');
    assert.match(detectedByGit, /^R\d+\s+/u, `fixture must be detected as a rename: ${detectedByGit}`);

    const result = evaluateDelegatedGovernanceAuthorizationProposal({
      branch: authorizationBranch,
      trustedPolicyRoot: root,
      trustedMainHead: base,
      evaluatedHead
    });
    assert.equal(result.pass, false, JSON.stringify(result));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('malformed, impossible-date and arbitrary branches remain denied', () => {
  for (const branch of [
    'rebuild/windows-release-closure-latest',
    'rebuild/windows-release-closure-20260230',
    'rebuild/windows-release-closure-20260712/escape',
    'feature/windows-release-closure-20260712',
    'main'
  ]) assert.equal(isAuthorizedImplementationBranch(branch, CURRENT_STAGE), false, branch);
});

test('current repository branch uses local authority only when locally provable and arbitrary branches fail', () => {
  const branch = process.env.IMPLEMENTATION_BRANCH || currentBranch();
  assert.ok(branch, 'current repository branch must come from the trusted workflow identity or an attached local branch');
  const current = checkRuntimeTargetGate({ branch });
  if (branch === 'oss/a-supply-chain-foundation') {
    assert.equal(current.pass, false, 'candidate-owned policy must not self-authorize the sealed OSS receipt');
    assert.equal(current.reasonCode, 'WP0_REJECTED_STAGE_TARGET_DENIED');
  } else {
    assert.equal(current.pass, true, JSON.stringify(current));
  }

  if (current.authorityMode === 'AUTHORIZATION_PROPOSAL_TRANSPORT') {
    const deniedFalseFacts = checkRuntimeTargetGate({ branch, changedFiles: [] });
    assert.equal(deniedFalseFacts.pass, false, 'proposal transport must reject an explicitly empty changed-file fact set');
    assert.equal(deniedFalseFacts.authorizationProposalReasonCode, 'WP0_AUTHORIZATION_PROPOSAL_TRANSPORT_INVALID');
  }

  const denied = checkRuntimeTargetGate({ branch: 'feature/unreviewed-release', changedFiles: [] });
  assert.equal(denied.pass, false);
  assert.equal(denied.reasonCode, 'WP0_REJECTED_STAGE_TARGET_DENIED');
});

test('generic delegated authority scopes implementation from the unique current trusted-main merge base', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-trusted-main-refresh-'));
  const git = (...args) => execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: isolatedGitEnvironment(root)
  }).trim();
  const write = (repositoryPath, content) => {
    const filePath = path.join(root, ...repositoryPath.split('/'));
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
  };

  try {
    git('init', '-b', 'main');
    git('config', 'user.name', 'Yance Test');
    git('config', 'user.email', 'yance-test@example.invalid');
    write('.base', 'base\n');
    git('add', '.base');
    git('commit', '-m', 'base');
    const base = git('rev-parse', 'HEAD');

    const authorizationPath = 'governance/layered-ci/trusted-main-refresh-fixture-authorization.json';
    const authorizationBranch = 'governance/trusted-main-refresh-fixture-authorization';
    const implementationBranch = 'fix/trusted-main-refresh-fixture';
    const allowedChangedPaths = ['shared/release/implementationBranchPolicy.js'];
    const authorization = genericDelegatedAuthorization({
      allowedChangedPaths,
      document: {
        base: { branch: 'main', commit: base },
        authorizationBranch: {
          name: authorizationBranch,
          allowedChangedPaths: [authorizationPath],
          mustRemainSingleFile: true
        },
        implementation: {
          branch: implementationBranch,
          allowedChangedPaths,
          approvedChangedFileCount: allowedChangedPaths.length,
          approvedChangedFileSetSha256: workPackageChangedFilesSha256(allowedChangedPaths),
          newDependencyAllowed: false,
          workflowModificationAllowed: false
        }
      }
    });

    git('switch', '-c', authorizationBranch);
    write(authorizationPath, `${JSON.stringify(authorization, null, 2)}\n`);
    git('add', authorizationPath);
    git('commit', '-m', 'authorize exact delegated repair');
    const reviewedHead = git('rev-parse', 'HEAD');

    git('switch', 'main');
    git('merge', '--no-ff', authorizationBranch, '-m', 'merge delegated authorization');
    const authorizationMerge = git('rev-parse', 'HEAD');
    assert.deepEqual(git('rev-list', '--parents', '-n', '1', authorizationMerge).split(/\s+/u).slice(1), [
      base,
      reviewedHead
    ]);

    git('switch', '-c', implementationBranch);
    write(allowedChangedPaths[0], 'module.exports = true;\n');
    git('add', allowedChangedPaths[0]);
    git('commit', '-m', 'implement exact delegated repair');

    git('switch', 'main');
    write('governance/trusted-main-only.txt', 'trusted main only\n');
    git('add', 'governance/trusted-main-only.txt');
    git('commit', '-m', 'advance trusted main');
    const trustedMainHead = git('rev-parse', 'HEAD');

    git('switch', implementationBranch);
    git('merge', '--no-ff', 'main', '-m', 'merge fresh trusted main');
    const refreshedHead = git('rev-parse', 'HEAD');

    const accepted = evaluateTrustedDelegatedGovernanceBranch({
      branch: implementationBranch,
      trustedPolicyRoot: root,
      trustedMainHead,
      evaluatedHead: refreshedHead
    });
    assert.equal(accepted.pass, true, JSON.stringify(accepted));
    assert.deepEqual(accepted.unauthorizedPaths, []);

    write('shared/release/unreviewed-authority.js', 'module.exports = false;\n');
    git('add', 'shared/release/unreviewed-authority.js');
    git('commit', '-m', 'escape exact delegated scope');
    const escapedHead = git('rev-parse', 'HEAD');
    const rejected = evaluateTrustedDelegatedGovernanceBranch({
      branch: implementationBranch,
      trustedPolicyRoot: root,
      trustedMainHead,
      evaluatedHead: escapedHead
    });
    assert.equal(rejected.pass, false);
    assert.equal(rejected.reasonCode, 'WP0_DELEGATED_GOVERNANCE_SCOPE_DENIED');
    assert.deepEqual(rejected.unauthorizedPaths, ['shared/release/unreviewed-authority.js']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('delegated authorization with invalid supersession declaration fails with specific reason code', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-invalid-supersession-'));
  const git = (...args) => execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: isolatedGitEnvironment(root)
  }).trim();
  const write = (repositoryPath, content) => {
    const filePath = path.join(root, ...repositoryPath.split('/'));
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
  };
  const allowedChangedPaths = ['shared/release/implementationBranchPolicy.js'];
  const exactImplementation = branch => ({
    branch,
    allowedChangedPaths,
    approvedChangedFileCount: allowedChangedPaths.length,
    approvedChangedFileSetSha256: workPackageChangedFilesSha256(allowedChangedPaths),
    newDependencyAllowed: false,
    workflowModificationAllowed: false
  });

  try {
    git('init', '-b', 'main');
    git('config', 'user.name', 'Yance Test');
    git('config', 'user.email', 'yance-test@example.invalid');
    write('.base', 'base\n');
    git('add', '.base');
    git('commit', '-m', 'base');
    const base = git('rev-parse', 'HEAD');

    const targetAuthorizationPath = 'governance/layered-ci/invalid-target-authorization.json';
    const targetAuthorizationBranch = 'governance/invalid-target-authorization';
    const targetImplementationBranch = 'fix/invalid-target';
    const targetAuthorization = genericDelegatedAuthorization({
      allowedChangedPaths,
      document: {
        workPackage: 'INVALID-TARGET',
        base: { branch: 'main', commit: base },
        authorizationBranch: {
          name: targetAuthorizationBranch,
          allowedChangedPaths: [targetAuthorizationPath],
          mustRemainSingleFile: true
        },
        implementation: exactImplementation(targetImplementationBranch)
      }
    });

    git('switch', '-c', targetAuthorizationBranch);
    write(targetAuthorizationPath, `${JSON.stringify(targetAuthorization, null, 2)}\n`);
    git('add', targetAuthorizationPath);
    git('commit', '-m', 'authorize target');
    const targetReviewedHead = git('rev-parse', 'HEAD');

    git('switch', 'main');
    git('merge', '--no-ff', targetAuthorizationBranch, '-m', 'merge target authorization');
    const targetMerge = git('rev-parse', 'HEAD');
    assert.deepEqual(git('rev-list', '--parents', '-n', '1', targetMerge).split(/\s+/u).slice(1), [
      base,
      targetReviewedHead
    ]);

    const invalidAuthorizationPath = 'governance/layered-ci/invalid-supersession-authorization.json';
    const invalidAuthorizationBranch = 'governance/invalid-supersession-authorization';
    const invalidImplementationBranch = 'fix/invalid-supersession';
    const invalidAuthorization = genericDelegatedAuthorization({
      allowedChangedPaths,
      document: {
        workPackage: 'INVALID-SUPERSESSION',
        supersedes: {
          authorizationPath: targetAuthorizationPath,
          implementationBranch: 'fix/mismatched-branch-name',
          reason: 'invalid supersession with mismatched implementation branch'
        },
        base: { branch: 'main', commit: targetMerge },
        authorizationBranch: {
          name: invalidAuthorizationBranch,
          allowedChangedPaths: [invalidAuthorizationPath],
          mustRemainSingleFile: true
        },
        implementation: exactImplementation(invalidImplementationBranch)
      }
    });

    git('switch', '-c', invalidAuthorizationBranch);
    write(invalidAuthorizationPath, `${JSON.stringify(invalidAuthorization, null, 2)}\n`);
    git('add', invalidAuthorizationPath);
    git('commit', '-m', 'authorize invalid supersession');
    const invalidReviewedHead = git('rev-parse', 'HEAD');

    git('switch', 'main');
    git('merge', '--no-ff', invalidAuthorizationBranch, '-m', 'merge invalid authorization');
    const trustedMainHead = git('rev-parse', 'HEAD');
    assert.deepEqual(git('rev-list', '--parents', '-n', '1', trustedMainHead).split(/\s+/u).slice(1), [
      targetMerge,
      invalidReviewedHead
    ]);

    const invalidResult = evaluateTrustedDelegatedGovernanceBranch({
      branch: invalidImplementationBranch,
      trustedPolicyRoot: root,
      trustedMainHead,
      evaluatedHead: trustedMainHead
    });
    assert.equal(invalidResult.pass, false, JSON.stringify(invalidResult));
    assert.equal(invalidResult.reasonCode, 'WP0_DELEGATED_GOVERNANCE_SUPERSESSION_INVALID');
    assert.equal(invalidResult.authorizationPath, invalidAuthorizationPath);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('later effective delegated authorization supersedes the exact earlier implementation branch', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-delegated-supersession-'));
  const git = (...args) => execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: isolatedGitEnvironment(root)
  }).trim();
  const write = (repositoryPath, content) => {
    const filePath = path.join(root, ...repositoryPath.split('/'));
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
  };
  const allowedChangedPaths = ['shared/release/implementationBranchPolicy.js'];
  const exactImplementation = branch => ({
    branch,
    allowedChangedPaths,
    approvedChangedFileCount: allowedChangedPaths.length,
    approvedChangedFileSetSha256: workPackageChangedFilesSha256(allowedChangedPaths),
    newDependencyAllowed: false,
    workflowModificationAllowed: false
  });

  try {
    git('init', '-b', 'main');
    git('config', 'user.name', 'Yance Test');
    git('config', 'user.email', 'yance-test@example.invalid');
    write('.base', 'base\n');
    git('add', '.base');
    git('commit', '-m', 'base');
    const base = git('rev-parse', 'HEAD');

    const v1AuthorizationPath = 'governance/layered-ci/supersession-v1-authorization.json';
    const v1AuthorizationBranch = 'governance/supersession-v1-authorization';
    const v1ImplementationBranch = 'fix/supersession-v1';
    const v1Authorization = genericDelegatedAuthorization({
      allowedChangedPaths,
      document: {
        workPackage: 'SUPERSESSION-V1',
        base: { branch: 'main', commit: base },
        authorizationBranch: {
          name: v1AuthorizationBranch,
          allowedChangedPaths: [v1AuthorizationPath],
          mustRemainSingleFile: true
        },
        implementation: exactImplementation(v1ImplementationBranch)
      }
    });

    git('switch', '-c', v1AuthorizationBranch);
    write(v1AuthorizationPath, `${JSON.stringify(v1Authorization, null, 2)}\n`);
    git('add', v1AuthorizationPath);
    git('commit', '-m', 'authorize v1');
    const v1ReviewedHead = git('rev-parse', 'HEAD');

    git('switch', 'main');
    git('merge', '--no-ff', v1AuthorizationBranch, '-m', 'merge v1 authorization');
    const v1Merge = git('rev-parse', 'HEAD');
    assert.deepEqual(git('rev-list', '--parents', '-n', '1', v1Merge).split(/\s+/u).slice(1), [
      base,
      v1ReviewedHead
    ]);

    const beforeSupersession = evaluateTrustedDelegatedGovernanceBranch({
      branch: v1ImplementationBranch,
      trustedPolicyRoot: root,
      trustedMainHead: v1Merge,
      evaluatedHead: v1Merge
    });
    assert.equal(beforeSupersession.pass, true, JSON.stringify(beforeSupersession));

    const v2AuthorizationPath = 'governance/layered-ci/supersession-v2-authorization.json';
    const v2AuthorizationBranch = 'governance/supersession-v2-authorization';
    const v2ImplementationBranch = 'fix/supersession-v2';
    const v2Authorization = genericDelegatedAuthorization({
      allowedChangedPaths,
      document: {
        workPackage: 'SUPERSESSION-V2',
        supersedes: {
          authorizationPath: v1AuthorizationPath,
          implementationBranch: v1ImplementationBranch,
          reason: 'replace exact v1 delegated authority'
        },
        base: { branch: 'main', commit: v1Merge },
        authorizationBranch: {
          name: v2AuthorizationBranch,
          allowedChangedPaths: [v2AuthorizationPath],
          mustRemainSingleFile: true
        },
        implementation: exactImplementation(v2ImplementationBranch)
      }
    });

    git('switch', '-c', v2AuthorizationBranch);
    write(v2AuthorizationPath, `${JSON.stringify(v2Authorization, null, 2)}\n`);
    git('add', v2AuthorizationPath);
    git('commit', '-m', 'authorize v2 supersession');
    const v2ReviewedHead = git('rev-parse', 'HEAD');

    git('switch', 'main');
    git('merge', '--no-ff', v2AuthorizationBranch, '-m', 'merge v2 authorization');
    const trustedMainHead = git('rev-parse', 'HEAD');
    assert.deepEqual(git('rev-list', '--parents', '-n', '1', trustedMainHead).split(/\s+/u).slice(1), [
      v1Merge,
      v2ReviewedHead
    ]);

    const superseded = evaluateTrustedDelegatedGovernanceBranch({
      branch: v1ImplementationBranch,
      trustedPolicyRoot: root,
      trustedMainHead,
      evaluatedHead: v1Merge
    });
    assert.equal(superseded.pass, false, JSON.stringify(superseded));
    assert.equal(superseded.reasonCode, 'WP0_DELEGATED_GOVERNANCE_AUTHORITY_SUPERSEDED');
    assert.equal(superseded.authorizationPath, v1AuthorizationPath);
    assert.equal(superseded.supersededByAuthorizationPath, v2AuthorizationPath);

    const replacement = evaluateTrustedDelegatedGovernanceBranch({
      branch: v2ImplementationBranch,
      trustedPolicyRoot: root,
      trustedMainHead,
      evaluatedHead: trustedMainHead
    });
    assert.equal(replacement.pass, true, JSON.stringify(replacement));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('generic delegated authority exposes its canonical implementation base to downstream verifiers', () => {
  const result = evaluateTrustedDelegatedGovernanceBranch({
    branch: GENERIC_IMPLEMENTATION_BRANCH,
    ...genericTrustedAuthorityOptions()
  });
  assert.equal(result.pass, true, JSON.stringify(result));
  assert.equal(
    result.implementationBase,
    GENERIC_MERGE,
    JSON.stringify(result)
  );
});

test('Stage GOVERNANCE_WP0 executes the repository OSS-first authorization gate', () => {
  const workflowPath = path.join(REPO_ROOT, '.github', 'workflows', 'stage-6459-wp0-gates.yml');
  const workflow = fs.readFileSync(workflowPath, 'utf8');
  const governanceHeader = '  wp0-governance:';
  const governanceIndex = workflow.indexOf(governanceHeader);
  assert.ok(governanceIndex >= 0, 'Stage workflow must define wp0-governance');
  const afterHeader = workflow.slice(governanceIndex + governanceHeader.length);
  const nextJobMatch = afterHeader.match(/\n  [a-z0-9][a-z0-9-]*:\n/u);
  const nextJobIndex = nextJobMatch
    ? governanceIndex + governanceHeader.length + nextJobMatch.index
    : workflow.length;
  const governanceJob = workflow.slice(governanceIndex, nextJobIndex);
  assert.match(
    governanceJob,
    /node --test --test-concurrency=1 tests\/wp0\/oss-first-development-policy\.test\.js/u,
    'wp0-governance must execute the repository OSS-first authorization gate'
  );
});

test('generic delegated route guard accepts frozen governance exact bootstrap additions', () => {
  const policy = require('../../shared/release/implementationBranchPolicy');
  const validate = policy.validateDelegatedRoutePolicyMutation;
  assert.equal(typeof validate, 'function');

  const basePolicy = readRepositoryJson('governance/layered-ci/wp0-routing-policy.json');
  const bootstrapPath = 'tests/wp0/base-owned-evaluated-repository-root.test.js';
  const authorization = {
    governanceBootstrapPaths: [bootstrapPath],
    governanceBootstrapPathCount: 1,
    governanceBootstrapPathSetSha256: workPackageChangedFilesSha256([bootstrapPath])
  };

  const candidatePolicy = clone(basePolicy);
  candidatePolicy.governanceExactPaths = [
    ...new Set([...(candidatePolicy.governanceExactPaths || []), bootstrapPath])
  ].sort();

  const result = validate({ authorization, basePolicy, candidatePolicy });
  assert.equal(result.pass, true, JSON.stringify(result));
  assert.equal(result.reasonCode, null, JSON.stringify(result));
});

test('generic delegated route guard rejects governance bootstrap ambiguity and semantic drift', () => {
  const policy = require('../../shared/release/implementationBranchPolicy');
  const validate = policy.validateDelegatedRoutePolicyMutation;
  const basePolicy = readRepositoryJson('governance/layered-ci/wp0-routing-policy.json');
  const bootstrapPath = 'tests/wp0/base-owned-evaluated-repository-root.test.js';
  const digest = workPackageChangedFilesSha256([bootstrapPath]);
  const baseAuthorization = {
    governanceBootstrapPaths: [bootstrapPath],
    governanceBootstrapPathCount: 1,
    governanceBootstrapPathSetSha256: digest
  };
  const exactCandidate = () => {
    const candidate = clone(basePolicy);
    candidate.governanceExactPaths = [
      ...new Set([...(candidate.governanceExactPaths || []), bootstrapPath])
    ].sort();
    return candidate;
  };
  const denied = (authorization, candidatePolicy) => {
    const result = validate({ authorization, basePolicy, candidatePolicy });
    assert.equal(result.pass, false, JSON.stringify(result));
    assert.equal(result.reasonCode, 'WP0_DELEGATED_ROUTE_POLICY_MUTATION_DENIED', JSON.stringify(result));
  };

  const simultaneous = clone(baseAuthorization);
  simultaneous.bootstrapPaths = ['runtime/forbidden-bootstrap.json'];
  simultaneous.bootstrapPathCount = 1;
  simultaneous.bootstrapPathSetSha256 = workPackageChangedFilesSha256(simultaneous.bootstrapPaths);
  denied(simultaneous, exactCandidate());

  const wrongCount = clone(baseAuthorization);
  wrongCount.governanceBootstrapPathCount = 2;
  denied(wrongCount, exactCandidate());

  const wrongDigest = clone(baseAuthorization);
  wrongDigest.governanceBootstrapPathSetSha256 = '0'.repeat(64);
  denied(wrongDigest, exactCandidate());

  const nonExact = {
    governanceBootstrapPaths: ['tests/wp0/*'],
    governanceBootstrapPathCount: 1,
    governanceBootstrapPathSetSha256: workPackageChangedFilesSha256(['tests/wp0/*'])
  };
  const nonExactCandidate = clone(basePolicy);
  nonExactCandidate.governanceExactPaths = [...basePolicy.governanceExactPaths, 'tests/wp0/*'].sort();
  denied(nonExact, nonExactCandidate);

  const unrelatedExact = exactCandidate();
  unrelatedExact.governanceExactPaths.push('tests/wp0/unapproved-governance-contract.test.js');
  unrelatedExact.governanceExactPaths.sort();
  denied(baseAuthorization, unrelatedExact);

  const removedExisting = exactCandidate();
  removedExisting.governanceExactPaths = removedExisting.governanceExactPaths
    .filter(repositoryPath => repositoryPath !== basePolicy.governanceExactPaths[0]);
  denied(baseAuthorization, removedExisting);

  const productDrift = exactCandidate();
  productDrift.productExactPaths = [...productDrift.productExactPaths, 'runtime/unapproved-product.json'].sort();
  denied(baseAuthorization, productDrift);

  const prefixDrift = exactCandidate();
  prefixDrift.governancePrefixes = [...prefixDrift.governancePrefixes, 'runtime/'];
  denied(baseAuthorization, prefixDrift);

  const documentationDrift = exactCandidate();
  documentationDrift.productDocumentationExtensions = [
    ...documentationDrift.productDocumentationExtensions,
    '.txt'
  ];
  denied(baseAuthorization, documentationDrift);

  const failClosedWeakening = exactCandidate();
  failClosedWeakening.unknownPathFailsClosed = false;
  denied(baseAuthorization, failClosedWeakening);
});
