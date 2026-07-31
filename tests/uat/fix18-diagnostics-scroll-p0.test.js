'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { expectedSourceIdentity, gitIdentity } = require('../../tools/uat/sourceUatP0Preflight');

const root = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('P0 source identity follows the packaged checkpoint instead of a historical hard-coded commit', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-fix18-checkpoint-'));
  const checkpoint = {
    branch: 'uat/diagnostics-scroll-authority-fix18-20260724',
    commit: '1'.repeat(40),
    tree: '2'.repeat(40),
    parent: '3'.repeat(40)
  };
  fs.writeFileSync(path.join(temp, 'YANCE_SOURCE_CHECKPOINT.json'), `${JSON.stringify(checkpoint, null, 2)}\n`);
  const expected = expectedSourceIdentity(temp);
  assert.equal(expected.commit, checkpoint.commit);
  assert.equal(expected.tree, checkpoint.tree);
  assert.equal(expected.authority, 'source-checkpoint');
  const actual = gitIdentity(temp, expected);
  assert.equal(actual.available, false);
  assert.equal(actual.identityAuthority, 'source-checkpoint');
  assert.equal(actual.baselineContained, true);
});

test('P0 preflight source contains no obsolete Fix8 baseline identity', () => {
  const source = read('tools/uat/sourceUatP0Preflight.js');
  assert.doesNotMatch(source, /a65bf967b557e8e422d2cf2c3e4b4ce332647821/);
  assert.match(source, /sourceIdentityAuthority/);
  assert.match(source, /source-checkpoint/);
});


test('P0 source identity accepts a metadata-only delivery commit that contains the checkpoint implementation', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-fix18-metadata-head-'));
  const branch = 'architecture/test-metadata-delivery';
  const git = args => execFileSync('git', args, { cwd: temp, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git(['init']);
  git(['config', 'user.email', 'yance-test@example.invalid']);
  git(['config', 'user.name', 'Yance Test']);
  git(['checkout', '-b', branch]);
  fs.writeFileSync(path.join(temp, 'implementation.txt'), 'functional source\n');
  git(['add', 'implementation.txt']);
  git(['commit', '-m', 'functional implementation']);
  const implementationCommit = git(['rev-parse', 'HEAD']);
  const implementationTree = git(['rev-parse', 'HEAD^{tree}']);
  fs.writeFileSync(path.join(temp, 'YANCE_SOURCE_CHECKPOINT.json'), `${JSON.stringify({
    schemaVersion: 2,
    branch,
    commit: implementationCommit,
    tree: implementationTree,
    identitySemantics: 'A later metadata-only delivery commit may contain this implementation commit.'
  }, null, 2)}\n`);
  git(['add', 'YANCE_SOURCE_CHECKPOINT.json']);
  git(['commit', '-m', 'metadata delivery']);

  const expected = expectedSourceIdentity(temp);
  const actual = gitIdentity(temp, expected);
  assert.equal(actual.available, true);
  assert.notEqual(actual.commit, implementationCommit);
  assert.equal(actual.checkpointTreeMatchesCommit, true);
  assert.equal(actual.implementationAncestor, true);
  assert.equal(actual.metadataOnlyDelivery, true);
  assert.equal(actual.branchCompatible, true);
  assert.equal(actual.baselineContained, true);
});

test('P0 source identity rejects a checkpoint tree that does not belong to the implementation commit', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-fix18-wrong-tree-'));
  const branch = 'architecture/test-wrong-tree';
  const git = args => execFileSync('git', args, { cwd: temp, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git(['init']);
  git(['config', 'user.email', 'yance-test@example.invalid']);
  git(['config', 'user.name', 'Yance Test']);
  git(['checkout', '-b', branch]);
  fs.writeFileSync(path.join(temp, 'implementation.txt'), 'functional source\n');
  git(['add', 'implementation.txt']);
  git(['commit', '-m', 'functional implementation']);
  const implementationCommit = git(['rev-parse', 'HEAD']);
  fs.writeFileSync(path.join(temp, 'YANCE_SOURCE_CHECKPOINT.json'), `${JSON.stringify({
    branch,
    commit: implementationCommit,
    tree: 'f'.repeat(40)
  }, null, 2)}\n`);

  const expected = expectedSourceIdentity(temp);
  const actual = gitIdentity(temp, expected);
  assert.equal(actual.checkpointTreeMatchesCommit, false);
  assert.equal(actual.implementationAncestor, false);
  assert.equal(actual.baselineContained, false);
});

test('P0 source identity rejects a descendant commit that changes functional source after the frozen implementation', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-fix18-functional-descendant-'));
  const branch = 'architecture/test-functional-descendant';
  const git = args => execFileSync('git', args, { cwd: temp, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git(['init']);
  git(['config', 'user.email', 'yance-test@example.invalid']);
  git(['config', 'user.name', 'Yance Test']);
  git(['checkout', '-b', branch]);
  fs.mkdirSync(path.join(temp, 'backend'), { recursive: true });
  fs.writeFileSync(path.join(temp, 'backend', 'core.js'), 'module.exports = 1;\n');
  git(['add', 'backend/core.js']);
  git(['commit', '-m', 'functional implementation']);
  const implementationCommit = git(['rev-parse', 'HEAD']);
  const implementationTree = git(['rev-parse', 'HEAD^{tree}']);
  fs.writeFileSync(path.join(temp, 'YANCE_SOURCE_CHECKPOINT.json'), `${JSON.stringify({
    schemaVersion: 2,
    branch,
    commit: implementationCommit,
    tree: implementationTree
  }, null, 2)}\n`);
  git(['add', 'YANCE_SOURCE_CHECKPOINT.json']);
  git(['commit', '-m', 'metadata delivery']);
  fs.writeFileSync(path.join(temp, 'backend', 'core.js'), 'module.exports = 999;\n');
  git(['add', 'backend/core.js']);
  git(['commit', '-m', 'unauthorized functional mutation']);

  const expected = expectedSourceIdentity(temp);
  const actual = gitIdentity(temp, expected);
  assert.equal(actual.checkpointTreeMatchesCommit, true);
  assert.equal(actual.implementationAncestor, true);
  assert.equal(actual.metadataOnlyChanges, false);
  assert.equal(actual.metadataOnlyDelivery, false);
  assert.deepEqual(actual.functionalChangedPaths, ['backend/core.js']);
  assert.equal(actual.baselineContained, false);
});

test('P0 source identity cannot hide a functional deletion behind a metadata-looking rename', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-fix18-rename-bypass-'));
  const branch = 'architecture/test-rename-bypass';
  const git = args => execFileSync('git', args, { cwd: temp, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git(['init']);
  git(['config', 'user.email', 'yance-test@example.invalid']);
  git(['config', 'user.name', 'Yance Test']);
  git(['checkout', '-b', branch]);
  fs.mkdirSync(path.join(temp, 'backend'), { recursive: true });
  fs.writeFileSync(path.join(temp, 'backend', 'core.js'), 'module.exports = 1;\n');
  git(['add', 'backend/core.js']);
  git(['commit', '-m', 'functional implementation']);
  const implementationCommit = git(['rev-parse', 'HEAD']);
  const implementationTree = git(['rev-parse', 'HEAD^{tree}']);
  fs.writeFileSync(path.join(temp, 'YANCE_SOURCE_CHECKPOINT.json'), `${JSON.stringify({ branch, commit: implementationCommit, tree: implementationTree }, null, 2)}\n`);
  git(['add', 'YANCE_SOURCE_CHECKPOINT.json']);
  git(['commit', '-m', 'metadata delivery']);
  git(['mv', 'backend/core.js', 'ROUND99_FAKE_DELIVERY_REPORT_ZH.md']);
  git(['commit', '-m', 'rename functional source as metadata']);

  const expected = expectedSourceIdentity(temp);
  const actual = gitIdentity(temp, expected);
  assert.equal(actual.metadataOnlyChanges, false);
  assert.ok(actual.functionalChangedPaths.includes('backend/core.js'));
  assert.equal(actual.baselineContained, false);
});

test('P0 source identity rejects a dirty Git worktree even when HEAD is a valid metadata-only delivery', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-fix18-dirty-worktree-'));
  const branch = 'architecture/test-dirty-worktree';
  const git = args => execFileSync('git', args, { cwd: temp, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git(['init']);
  git(['config', 'user.email', 'yance-test@example.invalid']);
  git(['config', 'user.name', 'Yance Test']);
  git(['checkout', '-b', branch]);
  fs.mkdirSync(path.join(temp, 'backend'), { recursive: true });
  fs.writeFileSync(path.join(temp, 'backend', 'core.js'), 'module.exports = 1;\n');
  git(['add', 'backend/core.js']);
  git(['commit', '-m', 'functional implementation']);
  const implementationCommit = git(['rev-parse', 'HEAD']);
  const implementationTree = git(['rev-parse', 'HEAD^{tree}']);
  fs.writeFileSync(path.join(temp, 'YANCE_SOURCE_CHECKPOINT.json'), `${JSON.stringify({ branch, commit: implementationCommit, tree: implementationTree }, null, 2)}\n`);
  git(['add', 'YANCE_SOURCE_CHECKPOINT.json']);
  git(['commit', '-m', 'metadata delivery']);
  fs.writeFileSync(path.join(temp, 'backend', 'core.js'), 'module.exports = 2;\n');

  const expected = expectedSourceIdentity(temp);
  const actual = gitIdentity(temp, expected);
  assert.equal(actual.implementationAncestor, true);
  assert.equal(actual.metadataOnlyChanges, true);
  assert.equal(actual.workingTreeClean, false);
  assert.ok(actual.workingTreeStatus.some(line => line.includes('backend/core.js')));
  assert.equal(actual.baselineContained, false);
});
