'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.join(__dirname, '..', '..');
const verifyGatePath = path.join(repoRoot, 'tools', 'wp0', 'verify-gate.js');
const protectedCommandPath = path.join(repoRoot, 'tools', 'wp0', 'run-protected-command.js');
const sharedScopeGatePath = path.join(repoRoot, 'tools', 'wp0', 'work-package-scope-gate.js');
const legacyScopeGatePath = path.join(repoRoot, 'tools', 'wp0', 'work-package-scope-gate-legacy.js');
const activeAuthorityPath = path.join(repoRoot, 'shared', 'release', 'acv2ActiveWorkPackageAuthority.js');
const authorizationPath = path.join(repoRoot, 'governance', 'architecture-closure-v2', 'implementation-plan-authorization.json');
const taskScopeChainPath = path.join(repoRoot, 'governance', 'architecture-closure-v2', 'wp-a-task-scope-chain.json');
const postMergeDefectPath = path.join(repoRoot, 'governance', 'architecture-closure-v2', 'wp-a-post-merge-defect-001.json');

test('every executable WP0 entrypoint consumes one shared ACV2 work-package scope gate', () => {
  const verifySource = fs.readFileSync(verifyGatePath, 'utf8');
  const protectedSource = fs.readFileSync(protectedCommandPath, 'utf8');
  assert.match(verifySource, /require\(['"]\.\/work-package-scope-gate['"]\)/);
  assert.match(protectedSource, /require\(['"]\.\/work-package-scope-gate['"]\)/);
  assert.match(verifySource, /evaluateWorkPackageScopeForGate/);
  assert.match(protectedSource, /evaluateWorkPackageScopeForGate/);
  assert.match(verifySource, /workPackageScope/);
  assert.match(protectedSource, /workPackageScope/);
  assert.match(protectedSource, /evidenceMode:\s*Boolean\(evidenceSourceCommit\)/);
  assert.match(protectedSource, /evidenceSourceCommit/);
});

test('shared scope gate routes exact active WP-B authority while preserving immutable WP-A legacy scope', () => {
  for (const filePath of [sharedScopeGatePath, legacyScopeGatePath, activeAuthorityPath]) {
    assert.equal(fs.existsSync(filePath), true, `${path.relative(repoRoot, filePath)} must exist`);
  }

  const sharedSource = fs.readFileSync(sharedScopeGatePath, 'utf8');
  assert.match(sharedSource, /require\(['"]\.\/work-package-scope-gate-legacy['"]\)/);
  assert.match(sharedSource, /resolveWpBImplementationAuthority/);
  assert.match(sharedSource, /evaluateAuthorizedWpBScope/);
  assert.match(sharedSource, /hasExplicitLegacyContext/);
  assert.match(sharedSource, /legacy\.evaluateWorkPackageScopeForGate/);
  assert.match(sharedSource, /status[^\n]*--porcelain/);
  assert.match(sharedSource, /core\.quotePath=false/);
  assert.match(sharedSource, /diff[\s\S]*--name-only/);
  assert.match(sharedSource, /merge-base[^\n]*--is-ancestor/);
  assert.match(sharedSource, /ACV2_WP_B_(?:AUTHORIZATION|SCOPE)_/);

  const legacySource = fs.readFileSync(legacyScopeGatePath, 'utf8');
  assert.match(legacySource, /evaluateAuthorizedWorkPackageTaskScope/);
  assert.match(legacySource, /loadWorkPackageTaskScopeChain/);
  assert.match(legacySource, /validateWorkPackageTaskScopeChain/);
  assert.match(legacySource, /evaluateAuthorizedWorkPackageScope/);
  assert.match(legacySource, /loadWorkPackageScopeAmendment/);
  assert.match(legacySource, /evaluateAuthorizedPostMergeDefectScope/);
  assert.match(legacySource, /loadWorkPackagePostMergeDefect/);
  assert.match(legacySource, /isValidWorkPackagePostMergeDefect/);
  assert.match(legacySource, /ACV2_AUTHORIZATION_BLOB_SHA/);
  assert.match(legacySource, /ACV2_WP_A_PARENT_GOVERNANCE_HEAD/);

  const activeSource = fs.readFileSync(activeAuthorityPath, 'utf8');
  assert.match(activeSource, /wp-b-design-authorization\.json/);
  assert.match(activeSource, /wp-b-baseline\.json/);
  assert.match(activeSource, /wp-b-operation-inventory\.json/);
  assert.match(activeSource, /evaluateAuthorizedWpBScope/);
  assert.match(activeSource, /temporaryBypassAllowed/);
  assert.match(activeSource, /formalRelease/);
  assert.match(activeSource, /publish/);
});

test('repository task scope chain is machine-readable and pins A6 and A7 closed before A8', () => {
  const document = JSON.parse(fs.readFileSync(taskScopeChainPath, 'utf8'));
  assert.equal(document.documentType, 'YANCE_ACV2_TASK_SCOPE_CHAIN');
  assert.equal(document.activeTask, 'A8');
  assert.equal(document.tasks[0].task, 'A6');
  assert.equal(document.tasks[0].state, 'CLOSED');
  assert.equal(document.tasks[1].task, 'A7');
  assert.equal(document.tasks[1].state, 'CLOSED');
  assert.equal(document.tasks[1].parentTask, 'A6');
  assert.equal(document.tasks[1].parentEvidenceBranchTip, document.tasks[0].evidenceBranchTip);
  assert.equal(document.tasks[2].task, 'A8');
  assert.equal(document.tasks[2].state, 'CLOSED');
  assert.equal(document.tasks[2].parentTask, 'A7');
  assert.equal(document.tasks[2].parentEvidenceBranchTip, document.tasks[1].evidenceBranchTip);
  assert.equal(document.governance.wildcardExpansionAllowed, false);
  assert.equal(document.governance.readyForPromotion, false);
});

test('detached evidence at an A8-R1 commit uses the exact post-close defect scope', () => {
  const { evaluateWorkPackageScopeForGate } = require('../../tools/wp0/work-package-scope-gate');
  const authorization = JSON.parse(fs.readFileSync(authorizationPath, 'utf8'));
  const defect = JSON.parse(fs.readFileSync(postMergeDefectPath, 'utf8'));
  const sourceCommit = 'a'.repeat(40);
  const calls = [];
  const git = args => {
    calls.push([...args]);
    if (args[0] === 'status') return '';
    if (args[0] === 'rev-parse' && args[1] === 'HEAD') return sourceCommit;
    if (args[0] === 'cat-file' || args[0] === 'merge-base') return '';
    if (args.includes('diff') && args.includes('--name-only')) return defect.scope.exactPaths.join('\n');
    throw new Error(`unexpected git command: ${args.join(' ')}`);
  };

  const result = evaluateWorkPackageScopeForGate({
    branch: null,
    evidenceMode: true,
    evidenceSourceCommit: sourceCommit,
    authorization,
    postMergeDefect: defect,
    git
  });

  assert.equal(result.applicable, true);
  assert.equal(result.pass, true, JSON.stringify(result));
  assert.equal(result.effectiveBranch, defect.scope.targetBranch);
  assert.equal(result.postMergeDefectScopeApplied, true);
  assert.equal(result.taskScopeChainApplied, false);
  assert.equal(result.defectId, defect.defectId);
  assert.equal(result.changedFileCount, defect.scope.approvedChangedFileCount);
  assert.equal(result.changedFileSetSha256, defect.scope.approvedChangedFileSetSha256);
  assert.equal(result.readyForPromotion, true);
  assert.ok(calls.some(args => args.includes('diff') && args.includes('--name-only')));
});

test('historical detached evidence without an A8-R1 document retains the prior ACV2 scope path', () => {
  const { evaluateWorkPackageScopeForGate } = require('../../tools/wp0/work-package-scope-gate');
  const authorization = JSON.parse(fs.readFileSync(authorizationPath, 'utf8'));
  const sourceCommit = 'b'.repeat(40);
  const git = args => {
    if (args[0] === 'status') return '';
    if (args[0] === 'rev-parse' && args[1] === 'HEAD') return sourceCommit;
    if (args[0] === 'rev-parse' && String(args[1]).startsWith('HEAD:')) {
      return '203697b36c06e0dc72c92113ef58f1a8f2394312';
    }
    if (args[0] === 'cat-file' || args[0] === 'merge-base') return '';
    if (args.includes('diff') && args.includes('--name-only')) return '';
    throw new Error(`unexpected git command: ${args.join(' ')}`);
  };
  const result = evaluateWorkPackageScopeForGate({
    branch: null,
    evidenceMode: true,
    evidenceSourceCommit: sourceCommit,
    authorization,
    postMergeDefect: null,
    taskScopeChain: null,
    amendment: null,
    git
  });
  assert.equal(result.applicable, true);
  assert.equal(result.pass, true, JSON.stringify(result));
  assert.equal(result.effectiveBranch, authorization.authorizedBranch);
  assert.equal(result.postMergeDefectScopeApplied, false);
  assert.equal(result.taskScopeChainApplied, false);
  assert.equal(result.readyForPromotion, false);
});

test('current WP-B detached evidence uses the exact active baseline and cannot claim promotion readiness', () => {
  const {
    resolveWpBImplementationAuthority
  } = require('../../shared/release/implementationBranchPolicy');
  const { evaluateWorkPackageScopeForGate } = require('../../tools/wp0/work-package-scope-gate');
  const authority = resolveWpBImplementationAuthority();
  assert.ok(authority, 'active WP-B authority must resolve');
  const sourceCommit = 'c'.repeat(40);
  const changedFiles = [
    '.github/workflows/wp-b-validation.yml',
    'backend/migrations/architectureClosureV2WpB.js',
    'backend/services/durableExecutionAuthority.js',
    'backend/tests/architectureClosureV2/wpB/schema23SqliteIntegration.test.js',
    'governance/architecture-closure-v2/wp-b-baseline.json',
    'shared/release/acv2ActiveWorkPackageAuthority.js',
    'tools/wp0/work-package-scope-gate.js'
  ].sort();
  const git = args => {
    if (args[0] === 'status') return '';
    if (args[0] === 'rev-parse' && args[1] === 'HEAD') return sourceCommit;
    if (args[0] === 'cat-file' || args[0] === 'merge-base') return '';
    if (args.includes('diff') && args.includes('--name-only')) return changedFiles.join('\n');
    throw new Error(`unexpected git command: ${args.join(' ')}`);
  };
  const result = evaluateWorkPackageScopeForGate({
    branch: null,
    evidenceMode: true,
    evidenceSourceCommit: sourceCommit,
    wpBAuthority: authority,
    git
  });
  assert.equal(result.applicable, true);
  assert.equal(result.pass, true, JSON.stringify(result));
  assert.equal(result.workPackage, 'WP-B');
  assert.equal(result.effectiveBranch, authority.authorizedBranch);
  assert.equal(result.parentGovernanceHead, authority.baseHead);
  assert.equal(result.changedFileCount, changedFiles.length);
  assert.deepEqual(result.unauthorizedPaths, []);
  assert.equal(result.readyForPromotion, false);
});

test('WP-B authorizes only the two exact WP-A regression contracts needed by Schema 23 integration', () => {
  const {
    evaluateAuthorizedWpBScope,
    resolveWpBImplementationAuthority
  } = require('../../shared/release/implementationBranchPolicy');
  const authority = resolveWpBImplementationAuthority();
  assert.ok(authority, 'active WP-B authority must resolve');

  const exactRegressionContracts = [
    'backend/tests/architectureClosureV2/wpA/authorityWriteHost.test.js',
    'backend/tests/architectureClosureV2/wpA/sourceClosureInventory.test.js'
  ];
  const exactResult = evaluateAuthorizedWpBScope({
    authority,
    branch: authority.authorizedBranch,
    changedFiles: exactRegressionContracts
  });
  assert.equal(exactResult.pass, true, JSON.stringify(exactResult));
  assert.deepEqual(exactResult.unauthorizedPaths, []);

  const unrelatedWpAContract = 'backend/tests/architectureClosureV2/wpA/schema22PostMergeIntegrityMigration.test.js';
  const unrelatedResult = evaluateAuthorizedWpBScope({
    authority,
    branch: authority.authorizedBranch,
    changedFiles: [unrelatedWpAContract]
  });
  assert.equal(unrelatedResult.pass, false);
  assert.equal(unrelatedResult.reasonCode, 'ACV2_WP_B_SCOPE_VIOLATION');
  assert.deepEqual(unrelatedResult.unauthorizedPaths, [unrelatedWpAContract]);
  assert.equal(authority.allowedProductionPaths.includes('backend/tests/architectureClosureV2/wpA/**'), false);
});

test('active task chain evaluation reports A8 and cannot claim promotion readiness', () => {
  const { evaluateWorkPackageScopeForGate } = require('../../tools/wp0/work-package-scope-gate');
  const authorization = JSON.parse(fs.readFileSync(authorizationPath, 'utf8'));
  const chain = JSON.parse(fs.readFileSync(taskScopeChainPath, 'utf8'));
  const changedFiles = [
    ...authorization.allowedProductionPaths,
    ...chain.tasks.flatMap(task => task.additionalAllowedPaths)
  ].filter((value, index, values) => values.indexOf(value) === index).sort();
  const calls = [];
  const git = args => {
    calls.push([...args]);
    if (args[0] === 'status') return '';
    if (args[0] === 'rev-parse' && String(args[1]).startsWith('HEAD:')) {
      return '203697b36c06e0dc72c92113ef58f1a8f2394312';
    }
    if (args[0] === 'cat-file' || args[0] === 'merge-base') return '';
    if (args.includes('diff')) return changedFiles.join('\n');
    throw new Error(`unexpected git command: ${args.join(' ')}`);
  };
  const testChain = {
    ...chain,
    approvedChangedFileCount: changedFiles.length,
    approvedChangedFileSetSha256: require('../../shared/release/implementationBranchPolicy')
      .workPackageChangedFilesSha256(changedFiles)
  };

  const result = evaluateWorkPackageScopeForGate({
    branch: authorization.authorizedBranch,
    authorization,
    taskScopeChain: testChain,
    git
  });
  assert.equal(result.pass, true, JSON.stringify(result));
  assert.equal(result.taskScopeChainApplied, true);
  assert.equal(result.activeTask, 'A8');
  assert.equal(result.readyForPromotion, false);
});

test('WP-B authority keeps exact internal engines and packaged evidence without adjacent expansion', () => {
  const {
    ADDITIONAL_WP_B_AUTHORITY_PATHS,
    evaluateAuthorizedWpBScope,
    resolveWpBImplementationAuthority
  } = require('../../shared/release/implementationBranchPolicy');
  const authority = resolveWpBImplementationAuthority();
  assert.ok(authority, 'active WP-B authority must resolve');
  const exactPaths = [
    'backend/lib/r32SqliteStoreEngineLegacy.js',
    'backend/migrations/architectureClosureV2WpBEngine.js',
    'release/architecture-closure-v2/wp-b-governance-package.json',
    'shared/release/acv2ActiveWorkPackageAuthorityEngine.js'
  ];
  assert.deepEqual([...ADDITIONAL_WP_B_AUTHORITY_PATHS].sort(), exactPaths);

  const exact = evaluateAuthorizedWpBScope({
    authority,
    branch: authority.authorizedBranch,
    changedFiles: exactPaths
  });
  assert.equal(exact.pass, true, JSON.stringify(exact));
  assert.deepEqual(exact.unauthorizedPaths, []);

  const adjacent = [
    'backend/lib/r32SqliteStoreEngineLegacyCopy.js',
    'backend/migrations/architectureClosureV2WpCEngine.js',
    'release/architecture-closure-v2/wp-c-governance-package.json',
    'shared/release/anotherAuthorityEngine.js'
  ];
  const rejected = evaluateAuthorizedWpBScope({
    authority,
    branch: authority.authorizedBranch,
    changedFiles: adjacent
  });
  assert.equal(rejected.pass, false);
  assert.equal(rejected.reasonCode, 'ACV2_WP_B_SCOPE_VIOLATION');
  assert.deepEqual(rejected.unauthorizedPaths, adjacent.sort());
});
