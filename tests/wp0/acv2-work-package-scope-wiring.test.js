'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const repoRoot = path.join(__dirname, '..', '..');
const verifyGatePath = path.join(repoRoot, 'tools', 'wp0', 'verify-gate.js');
const protectedCommandPath = path.join(repoRoot, 'tools', 'wp0', 'run-protected-command.js');
const sharedScopeGatePath = path.join(repoRoot, 'tools', 'wp0', 'work-package-scope-gate.js');
const authorizationPath = path.join(repoRoot, 'governance', 'architecture-closure-v2', 'implementation-plan-authorization.json');
const taskScopeChainPath = path.join(repoRoot, 'governance', 'architecture-closure-v2', 'wp-a-task-scope-chain.json');
const postMergeDefectPath = path.join(repoRoot, 'governance', 'architecture-closure-v2', 'wp-a-post-merge-defect-001.json');

function nulPathBuffer(paths) {
  return paths.length ? Buffer.from(`${paths.join('\0')}\0`, 'utf8') : Buffer.alloc(0);
}

function frozenTaskChainChangedFiles(chain) {
  const activeTask = chain.tasks.find(task => task.task === chain.activeTask);
  assert.ok(activeTask?.evidenceBranchTip, 'active task must have a frozen evidence branch tip');
  const raw = execFileSync('git', [
    '-c',
    'core.quotePath=false',
    'diff',
    '--name-only',
    '-z',
    chain.parentGovernanceHead,
    activeTask.evidenceBranchTip,
    '--'
  ], { cwd: repoRoot, encoding: null });
  return raw.toString('utf8').split('\0').filter(Boolean).sort();
}

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

test('shared scope gate preserves the immutable task chain and adds fail-closed post-close defect scope', () => {
  assert.equal(fs.existsSync(sharedScopeGatePath), true, 'shared work-package scope gate must exist');
  const source = fs.readFileSync(sharedScopeGatePath, 'utf8');
  assert.match(source, /evaluateAuthorizedWorkPackageTaskScope/);
  assert.match(source, /loadWorkPackageTaskScopeChain/);
  assert.match(source, /validateWorkPackageTaskScopeChain/);
  assert.match(source, /taskScopeChainApplied/);
  assert.match(source, /activeTask/);
  assert.match(source, /evaluateAuthorizedWorkPackageScope/);
  assert.match(source, /loadWorkPackageScopeAmendment/);
  assert.match(source, /evaluateAuthorizedPostMergeDefectScope/);
  assert.match(source, /loadWorkPackagePostMergeDefect/);
  assert.match(source, /isValidWorkPackagePostMergeDefect/);
  assert.match(source, /postMergeDefectScopeApplied/);
  assert.match(source, /ACV2_AUTHORIZATION_BLOB_SHA/);
  assert.match(source, /ACV2_WP_A_PARENT_GOVERNANCE_HEAD/);
  assert.match(source, /status[^\n]*--porcelain/);
  assert.match(source, /core\.quotePath=false/);
  assert.match(source, /diff[\s\S]*--name-only/);
  assert.match(source, /merge-base[^\n]*--is-ancestor/);
  assert.match(source, /ACV2_(?:WORK_PACKAGE|TASK|POST_MERGE_DEFECT)_SCOPE_/);
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
    if (args.includes('diff') && args.includes('--name-only')) return nulPathBuffer(defect.scope.exactPaths);
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
    if (args.includes('diff') && args.includes('--name-only')) return Buffer.alloc(0);
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

test('active task chain evaluation uses the frozen A8 evidence diff and cannot claim promotion readiness', () => {
  const { evaluateWorkPackageScopeForGate } = require('../../tools/wp0/work-package-scope-gate');
  const { workPackageChangedFilesSha256 } = require('../../shared/release/implementationBranchPolicy');
  const authorization = JSON.parse(fs.readFileSync(authorizationPath, 'utf8'));
  const chain = JSON.parse(fs.readFileSync(taskScopeChainPath, 'utf8'));
  const changedFiles = frozenTaskChainChangedFiles(chain);
  assert.equal(changedFiles.length, chain.approvedChangedFileCount);
  assert.equal(workPackageChangedFilesSha256(changedFiles), chain.approvedChangedFileSetSha256);
  const git = args => {
    if (args[0] === 'status') return '';
    if (args[0] === 'rev-parse' && String(args[1]).startsWith('HEAD:')) {
      return '203697b36c06e0dc72c92113ef58f1a8f2394312';
    }
    if (args[0] === 'cat-file' || args[0] === 'merge-base') return '';
    if (args.includes('diff')) return nulPathBuffer(changedFiles);
    throw new Error(`unexpected git command: ${args.join(' ')}`);
  };

  const result = evaluateWorkPackageScopeForGate({
    branch: authorization.authorizedBranch,
    authorization,
    taskScopeChain: chain,
    git
  });
  assert.equal(result.pass, true, JSON.stringify(result));
  assert.equal(result.taskScopeChainApplied, true);
  assert.equal(result.activeTask, 'A8');
  assert.equal(result.readyForPromotion, false);
});

test('String-delimited Git path evidence fails closed after the Buffer transport upgrade', () => {
  const { evaluateWorkPackageScopeForGate } = require('../../tools/wp0/work-package-scope-gate');
  const authorization = JSON.parse(fs.readFileSync(authorizationPath, 'utf8'));
  const chain = JSON.parse(fs.readFileSync(taskScopeChainPath, 'utf8'));
  const git = args => {
    if (args[0] === 'status') return '';
    if (args[0] === 'rev-parse' && String(args[1]).startsWith('HEAD:')) {
      return '203697b36c06e0dc72c92113ef58f1a8f2394312';
    }
    if (args[0] === 'cat-file' || args[0] === 'merge-base') return '';
    if (args.includes('diff')) return authorization.allowedProductionPaths.join('\n');
    throw new Error(`unexpected git command: ${args.join(' ')}`);
  };
  const result = evaluateWorkPackageScopeForGate({
    branch: authorization.authorizedBranch,
    authorization,
    taskScopeChain: chain,
    git
  });
  assert.equal(result.pass, false);
  assert.equal(result.reasonCode, 'ACV2_WORK_PACKAGE_SCOPE_DIFF_FAILED');
  assert.match(result.error, /must return a Buffer/u);
});
