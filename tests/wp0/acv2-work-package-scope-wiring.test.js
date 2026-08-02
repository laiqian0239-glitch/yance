'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.join(__dirname, '..', '..');
const verifyGatePath = path.join(repoRoot, 'tools', 'wp0', 'verify-gate.js');
const protectedCommandPath = path.join(repoRoot, 'tools', 'wp0', 'run-protected-command.js');
const sharedScopeGatePath = path.join(repoRoot, 'tools', 'wp0', 'work-package-scope-gate.js');
const authorizationPath = path.join(repoRoot, 'governance', 'architecture-closure-v2', 'implementation-plan-authorization.json');
const taskScopeChainPath = path.join(repoRoot, 'governance', 'architecture-closure-v2', 'wp-a-task-scope-chain.json');

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

test('shared scope gate prefers the sequential task chain and preserves historical amendment fallback', () => {
  assert.equal(fs.existsSync(sharedScopeGatePath), true, 'shared work-package scope gate must exist');
  const source = fs.readFileSync(sharedScopeGatePath, 'utf8');
  assert.match(source, /evaluateAuthorizedWorkPackageTaskScope/);
  assert.match(source, /loadWorkPackageTaskScopeChain/);
  assert.match(source, /validateWorkPackageTaskScopeChain/);
  assert.match(source, /taskScopeChainApplied/);
  assert.match(source, /activeTask/);
  assert.match(source, /evaluateAuthorizedWorkPackageScope/);
  assert.match(source, /loadWorkPackageScopeAmendment/);
  assert.match(source, /ACV2_AUTHORIZATION_BLOB_SHA/);
  assert.match(source, /ACV2_WP_A_PARENT_GOVERNANCE_HEAD/);
  assert.match(source, /status[^\n]*--porcelain/);
  assert.match(source, /core\.quotePath=false/);
  assert.match(source, /diff[\s\S]*--name-only/);
  assert.match(source, /merge-base[^\n]*--is-ancestor/);
  assert.match(source, /ACV2_(?:WORK_PACKAGE|TASK)_SCOPE_/);
});

test('repository task scope chain is machine-readable and pins A6 closed before A7', () => {
  const document = JSON.parse(fs.readFileSync(taskScopeChainPath, 'utf8'));
  assert.equal(document.documentType, 'YANCE_ACV2_TASK_SCOPE_CHAIN');
  assert.equal(document.activeTask, 'A7');
  assert.equal(document.tasks[0].task, 'A6');
  assert.equal(document.tasks[0].state, 'CLOSED');
  assert.equal(document.tasks[1].task, 'A7');
  assert.equal(document.tasks[1].parentTask, 'A6');
  assert.equal(document.tasks[1].parentEvidenceBranchTip, document.tasks[0].evidenceBranchTip);
  assert.equal(document.governance.wildcardExpansionAllowed, false);
  assert.equal(document.governance.readyForPromotion, false);
});

test('detached evidence mode still evaluates the authorized ACV2 changed-file scope', () => {
  const { evaluateWorkPackageScopeForGate } = require('../../tools/wp0/work-package-scope-gate');
  const authorization = JSON.parse(fs.readFileSync(authorizationPath, 'utf8'));
  const sourceCommit = 'a'.repeat(40);
  const calls = [];
  const git = args => {
    calls.push([...args]);
    if (args[0] === 'status') return '';
    if (args[0] === 'rev-parse' && args[1] === 'HEAD') return sourceCommit;
    if (args[0] === 'rev-parse' && String(args[1]).startsWith('HEAD:')) {
      return '203697b36c06e0dc72c92113ef58f1a8f2394312';
    }
    if (args[0] === 'cat-file') return '';
    if (args[0] === 'merge-base') return '';
    if (args.includes('diff') && args.includes('--name-only')) return '';
    throw new Error(`unexpected git command: ${args.join(' ')}`);
  };

  const result = evaluateWorkPackageScopeForGate({
    branch: null,
    evidenceMode: true,
    evidenceSourceCommit: sourceCommit,
    authorization,
    taskScopeChain: null,
    amendment: null,
    git
  });

  assert.equal(result.applicable, true);
  assert.equal(result.pass, true);
  assert.equal(result.effectiveBranch, authorization.authorizedBranch);
  assert.equal(result.taskScopeChainApplied, false);
  assert.ok(calls.some(args => args.includes('diff') && args.includes('--name-only')));
});

test('active task chain evaluation reports A7 and cannot claim promotion readiness', () => {
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
  assert.equal(result.activeTask, 'A7');
  assert.equal(result.readyForPromotion, false);
});
