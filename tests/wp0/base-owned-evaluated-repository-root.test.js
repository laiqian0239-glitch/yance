'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const POLICY_PATH = require.resolve('../../shared/release/implementationBranchPolicy');
const LIB_PATH = require.resolve('../../tools/wp0/lib');

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function createCandidateRepository() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-wp0-evaluated-root-'));
  fs.mkdirSync(path.join(root, 'release'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'release', 'release-source.json'),
    `${JSON.stringify({ stageVersion: '6.4.5.9' }, null, 2)}\n`,
    'utf8'
  );
  git(root, ['init']);
  git(root, ['config', 'user.name', 'Yance WP0 Test']);
  git(root, ['config', 'user.email', 'wp0-test@example.invalid']);
  git(root, ['add', 'release/release-source.json']);
  git(root, ['commit', '-m', 'fixture: candidate head']);
  return { root, head: git(root, ['rev-parse', 'HEAD']) };
}

test('base-owned WP0 binds split-root candidate identity into delegated implementation policy', (t) => {
  const candidate = createCandidateRepository();
  const previousRoot = process.env.YANCE_EVALUATED_REPOSITORY_ROOT;
  const previousPolicyCache = require.cache[POLICY_PATH];
  const previousLibCache = require.cache[LIB_PATH];
  const captured = [];

  process.env.YANCE_EVALUATED_REPOSITORY_ROOT = candidate.root;
  require.cache[POLICY_PATH] = {
    id: POLICY_PATH,
    filename: POLICY_PATH,
    loaded: true,
    exports: {
      REBUILD_BRANCH_PATTERN_SOURCE: '^$',
      canonicalStageBranch: (stage) => `stage/${stage}`,
      isAuthorizedImplementationBranch: (_branch, _stage, options) => {
        captured.push({ ...options });
        return true;
      },
      evaluateDelegatedGovernanceAuthorizationProposal: () => ({ pass: false, reasonCode: 'TEST_NOT_USED' }),
      authorizedImplementationBranchDescription: () => 'test-authorized-branch'
    }
  };
  delete require.cache[LIB_PATH];

  t.after(() => {
    fs.rmSync(candidate.root, { recursive: true, force: true });
    if (previousRoot === undefined) delete process.env.YANCE_EVALUATED_REPOSITORY_ROOT;
    else process.env.YANCE_EVALUATED_REPOSITORY_ROOT = previousRoot;
    if (previousPolicyCache) require.cache[POLICY_PATH] = previousPolicyCache;
    else delete require.cache[POLICY_PATH];
    if (previousLibCache) require.cache[LIB_PATH] = previousLibCache;
    else delete require.cache[LIB_PATH];
  });

  const lib = require(LIB_PATH);
  const result = lib.checkRuntimeTargetGate({
    targetStage: '6.4.5.9',
    branch: 'product/v21-voice-brain-p0-v2-product-experience-reconciliation',
    changedFiles: []
  });

  assert.equal(result.pass, true);
  assert.equal(captured.length, 1);
  assert.equal(captured[0].evaluatedHead, candidate.head);
  assert.equal(captured[0].evaluatedRepositoryRoot, path.resolve(candidate.root));

  const explicitHead = 'f'.repeat(40);
  const explicitRoot = path.join(candidate.root, 'explicit-root');
  lib.checkRuntimeTargetGate({
    targetStage: '6.4.5.9',
    branch: 'fix/explicit-override-fixture',
    changedFiles: [],
    implementationBranchOptions: {
      evaluatedHead: explicitHead,
      evaluatedRepositoryRoot: explicitRoot
    }
  });

  assert.equal(captured.length, 2);
  assert.equal(captured[1].evaluatedHead, explicitHead);
  assert.equal(captured[1].evaluatedRepositoryRoot, explicitRoot);
});
