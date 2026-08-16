'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function git(root, args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
}

function initCandidateRepository(root) {
  fs.mkdirSync(path.join(root, 'release'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'release', 'release-source.json'),
    `${JSON.stringify({ stageVersion: '6.4.5.9' }, null, 2)}\n`,
    'utf8'
  );
  git(root, ['init', '--quiet']);
  git(root, ['config', 'user.name', 'Yance WP0 test']);
  git(root, ['config', 'user.email', 'wp0-test@example.invalid']);
  git(root, ['add', 'release/release-source.json']);
  git(root, ['commit', '--quiet', '-m', 'candidate fixture']);
  return git(root, ['rev-parse', 'HEAD']);
}

test('base-owned WP0 split-root caller binds candidate identity and preserves explicit overrides', t => {
  const candidateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-wp0-candidate-'));
  const candidateHead = initCandidateRepository(candidateRoot);
  const policyModulePath = require.resolve('../../shared/release/implementationBranchPolicy');
  const wp0LibPath = require.resolve('../../tools/wp0/lib');
  const previousEvaluatedRoot = process.env.YANCE_EVALUATED_REPOSITORY_ROOT;
  const previousPolicyModule = require.cache[policyModulePath];
  const previousWp0Lib = require.cache[wp0LibPath];
  const calls = [];

  t.after(() => {
    if (previousEvaluatedRoot === undefined) delete process.env.YANCE_EVALUATED_REPOSITORY_ROOT;
    else process.env.YANCE_EVALUATED_REPOSITORY_ROOT = previousEvaluatedRoot;
    if (previousPolicyModule) require.cache[policyModulePath] = previousPolicyModule;
    else delete require.cache[policyModulePath];
    if (previousWp0Lib) require.cache[wp0LibPath] = previousWp0Lib;
    else delete require.cache[wp0LibPath];
    fs.rmSync(candidateRoot, { recursive: true, force: true });
  });

  process.env.YANCE_EVALUATED_REPOSITORY_ROOT = candidateRoot;
  require.cache[policyModulePath] = {
    id: policyModulePath,
    filename: policyModulePath,
    loaded: true,
    exports: {
      REBUILD_BRANCH_PATTERN_SOURCE: '^rebuild/.+$',
      canonicalStageBranch: stage => `stage/${stage}`,
      isAuthorizedImplementationBranch: (branch, stage, options) => {
        calls.push({ branch, stage, options: { ...options } });
        return true;
      },
      evaluateDelegatedGovernanceAuthorizationProposal: () => ({
        pass: false,
        reasonCode: 'NOT_USED'
      }),
      authorizedImplementationBranchDescription: stage => `authorized implementation branch for ${stage}`
    }
  };
  delete require.cache[wp0LibPath];

  const { checkRuntimeTargetGate, REPO_ROOT } = require('../../tools/wp0/lib');
  assert.equal(REPO_ROOT, candidateRoot);

  const branch = 'fix/v21-base-owned-evaluated-repository-root-p0';
  const automatic = checkRuntimeTargetGate({
    targetStage: '6.4.5.9',
    branch,
    changedFiles: []
  });
  assert.equal(automatic.pass, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.evaluatedRepositoryRoot, candidateRoot);
  assert.equal(calls[0].options.evaluatedHead, candidateHead);

  const explicitHead = 'f'.repeat(40);
  const explicitRoot = path.join(candidateRoot, 'explicit-root');
  const explicit = checkRuntimeTargetGate({
    targetStage: '6.4.5.9',
    branch,
    changedFiles: [],
    implementationBranchOptions: {
      evaluatedHead: explicitHead,
      evaluatedRepositoryRoot: explicitRoot
    }
  });
  assert.equal(explicit.pass, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].options.evaluatedRepositoryRoot, explicitRoot);
  assert.equal(calls[1].options.evaluatedHead, explicitHead);
});
