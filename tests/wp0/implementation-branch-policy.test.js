'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  canonicalStageBranch,
  isReleaseClosureRebuildBranch,
  isAuthorizedDelegatedGovernanceBranch,
  evaluateDelegatedGovernanceAuthorizationProposal,
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
    ...overrides.document
  };
}

function genericTrustedAuthorityOptions(overrides = {}) {
  const authorization = overrides.authorization || genericDelegatedAuthorization();
  return {
    trustedMainHead: overrides.trustedMainHead || GENERIC_TRUSTED_MAIN,
    evaluatedHead: overrides.evaluatedHead || GENERIC_IMPLEMENTATION_HEAD,
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
      if ([GENERIC_MERGE, GENERIC_REVIEWED_HEAD, GENERIC_TRUSTED_MAIN].includes(commit)) {
        return overrides.blobByCommit?.[commit] || GENERIC_BLOB;
      }
      return null;
    },
    resolveChangedFilesBetween: (base, head) => (
      base === GENERIC_BASE && head === GENERIC_REVIEWED_HEAD
        ? (overrides.reviewedChangedFiles || [GENERIC_AUTHORIZATION_PATH])
        : []
    ),
    isTrustedAncestor: (base, head) => {
      if (overrides.ancestorResultByPair?.[`${base}:${head}`] !== undefined) {
        return overrides.ancestorResultByPair[`${base}:${head}`];
      }
      return (base === GENERIC_MERGE && head === GENERIC_TRUSTED_MAIN)
        || (base === GENERIC_MERGE && head === GENERIC_IMPLEMENTATION_HEAD);
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


test('authorization proposal transport is single-file and never grants implementation authority', () => {
  assert.equal(typeof evaluateDelegatedGovernanceAuthorizationProposal, 'function');
  const authorization = genericDelegatedAuthorization();
  const accepted = evaluateDelegatedGovernanceAuthorizationProposal({
    branch: GENERIC_AUTHORIZATION_BRANCH,
    changedFiles: [GENERIC_AUTHORIZATION_PATH],
    authorizationPath: GENERIC_AUTHORIZATION_PATH,
    authorization
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
      authorization
    }
  });
  assert.equal(transported.pass, true, JSON.stringify(transported));
  assert.equal(transported.authorityMode, 'AUTHORIZATION_PROPOSAL_TRANSPORT');
  assert.equal(transported.implementationAuthorityGranted, false);

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
    }]
  ]) {
    const result = evaluateDelegatedGovernanceAuthorizationProposal({
      branch: GENERIC_AUTHORIZATION_BRANCH,
      changedFiles: candidate.changedFiles || [GENERIC_AUTHORIZATION_PATH],
      authorizationPath: GENERIC_AUTHORIZATION_PATH,
      authorization: candidate.authorization || authorization
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
      reviewedChangedFiles: [GENERIC_AUTHORIZATION_PATH, 'governance/layered-ci/extra.json']
    })
  }), false, 'reviewed authorization Head must remain single-file');

  assert.equal(isAuthorizedDelegatedGovernanceBranch(GENERIC_IMPLEMENTATION_BRANCH, {
    generic: genericTrustedAuthorityOptions({
      ancestorResultByPair: { [`${GENERIC_MERGE}:${GENERIC_TRUSTED_MAIN}`]: false }
    })
  }), false, 'candidate-owned merge not on canonical main must not authorize');

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
  const current = checkRuntimeTargetGate({ branch, changedFiles: [] });
  if (branch === 'oss/a-supply-chain-foundation') {
    assert.equal(current.pass, false, 'candidate-owned policy must not self-authorize the sealed OSS receipt');
    assert.equal(current.reasonCode, 'WP0_REJECTED_STAGE_TARGET_DENIED');
  } else {
    assert.equal(current.pass, true, JSON.stringify(current));
  }

  const denied = checkRuntimeTargetGate({ branch: 'feature/unreviewed-release', changedFiles: [] });
  assert.equal(denied.pass, false);
  assert.equal(denied.reasonCode, 'WP0_REJECTED_STAGE_TARGET_DENIED');
});