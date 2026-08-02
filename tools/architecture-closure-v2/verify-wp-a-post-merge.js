'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const POLICY_PATH = path.join(
  ROOT,
  'governance',
  'architecture-closure-v2',
  'wp-a-post-merge-validation-policy.json'
);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function git(args, cwd = ROOT) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function assertFullSha(value, field) {
  assert.match(String(value || ''), /^[a-f0-9]{40}$/u, `${field} must be a full lowercase SHA`);
}

function validatePolicy(policy) {
  assert.equal(policy.schemaVersion, 1);
  assert.equal(policy.documentType, 'YANCE_ACV2_WP_A_POST_MERGE_VALIDATION_POLICY');
  assert.equal(policy.program, 'Architecture Closure V2');
  assert.equal(policy.repository, 'laiqian0239-glitch/yance');
  assert.equal(policy.workPackage, 'WP-A');
  assert.equal(policy.status, 'POST_MERGE_VALIDATION_REQUIRED');
  assert.equal(policy.defaultBranch, 'main');

  const integration = policy.integration;
  assert.equal(integration.candidatePullRequest, 5);
  assert.equal(integration.promotionAuthorizationPullRequest, 13);
  for (const field of ['candidateHead', 'promotionAuthorizationCommit', 'mergeCommit', 'a8ClosureBlobSha', 'promotionAuthorizationBlobSha']) {
    assertFullSha(integration[field], `integration.${field}`);
  }
  assert.equal(integration.a8ClosurePath, 'governance/architecture-closure-v2/wp-a-a8-closure.json');
  assert.equal(integration.promotionAuthorizationPath, 'governance/architecture-closure-v2/wp-a-promotion-authorization.json');

  const required = policy.requiredValidation;
  for (const field of [
    'identityAndAncestry',
    'ubuntuContracts',
    'windowsContracts',
    'legacyIdentityRegressions',
    'sqliteOwnershipAndFencingRegressions',
    'sealedExportRegressions',
    'portableGovernanceContracts'
  ]) assert.equal(required[field], true, `${field} must remain required`);
  assert.equal(required.sourceClosureViolationCount, 0);

  assert.equal(policy.activation.trigger, 'PUSH_TO_MAIN_ON_RELEVANT_WP_A_SURFACE');
  assert.equal(policy.activation.exactCheckedOutCommitRequired, true);
  assert.equal(policy.activation.cleanWorktreeRequired, true);
  assert.equal(policy.activation.cancelPreviousMainValidation, false);

  assert.equal(policy.governance.readyForPromotion, true);
  assert.equal(policy.governance.formalRelease, false);
  assert.equal(policy.governance.publish, false);
  assert.equal(policy.governance.automaticNextWorkPackageAuthorization, false);
  assert.equal(policy.governance.wpBAuthorized, false);
  assert.equal(policy.governance.temporaryBypassAllowed, false);
  assert.equal(policy.governance.continueOnErrorAllowed, false);
  assert.equal(policy.governance.wildcardAuthorizationAllowed, false);
  return true;
}

function validateDocuments(policy, closure, authorization) {
  const integration = policy.integration;
  assert.equal(closure.documentType, 'YANCE_ACV2_TASK_CLOSURE_RECEIPT');
  assert.equal(closure.workPackage, 'WP-A');
  assert.equal(closure.task, 'A8');
  assert.equal(closure.status, 'CLOSED');
  assert.equal(closure.pullRequest, integration.candidatePullRequest);
  assert.equal(closure.independentReview.decision, 'ALLOW_MERGE');
  assert.equal(closure.independentReview.openP0, 0);
  assert.equal(closure.independentReview.openP1, 0);
  assert.equal(closure.independentReview.temporaryBypassDetected, false);
  assert.equal(closure.verification.sourceClosureViolationCount, 0);
  assert.equal(closure.governance.formalRelease, false);
  assert.equal(closure.governance.publish, false);

  assert.equal(authorization.documentType, 'YANCE_ACV2_PROMOTION_AUTHORIZATION');
  assert.equal(authorization.workPackage, 'WP-A');
  assert.equal(authorization.promotionCandidate.pullRequest, integration.candidatePullRequest);
  assert.equal(authorization.promotionCandidate.candidateHead, integration.candidateHead);
  assert.equal(authorization.activation.requiredDefaultBranch, 'main');
  assert.equal(authorization.activation.effectiveOnlyWhenPresentOnDefaultBranch, true);
  assert.equal(authorization.activation.afterActivation.readyForPromotion, true);
  assert.equal(authorization.activation.afterActivation.formalRelease, false);
  assert.equal(authorization.activation.afterActivation.publish, false);
  assert.equal(authorization.governance.wpBAuthorized, false);
  return true;
}

function verifyRepository(options = {}) {
  const cwd = path.resolve(options.cwd || ROOT);
  const policy = options.policy || readJson(path.join(cwd, path.relative(ROOT, POLICY_PATH)));
  validatePolicy(policy);

  const head = git(['rev-parse', 'HEAD'], cwd);
  const expectedHead = String(options.expectedHead || process.env.GITHUB_SHA || '').trim();
  if (expectedHead) {
    assertFullSha(expectedHead, 'expectedHead');
    assert.equal(head, expectedHead, 'checked-out commit does not match expected workflow commit');
  }

  if (options.requireOriginMain === true) {
    const originMain = git(['rev-parse', 'refs/remotes/origin/main'], cwd);
    assert.equal(head, originMain, 'post-merge validation must run at the exact current origin/main');
  }

  for (const [label, commit] of [
    ['candidate', policy.integration.candidateHead],
    ['promotion authorization', policy.integration.promotionAuthorizationCommit],
    ['WP-A merge', policy.integration.mergeCommit]
  ]) {
    try {
      execFileSync('git', ['merge-base', '--is-ancestor', commit, head], { cwd, stdio: 'pipe' });
    } catch (_) {
      assert.fail(`${label} commit is not an ancestor of the validated main commit`);
    }
  }

  const closureBlob = git(['rev-parse', `HEAD:${policy.integration.a8ClosurePath}`], cwd);
  const authorizationBlob = git(['rev-parse', `HEAD:${policy.integration.promotionAuthorizationPath}`], cwd);
  assert.equal(closureBlob, policy.integration.a8ClosureBlobSha, 'A8 closure receipt blob drifted');
  assert.equal(authorizationBlob, policy.integration.promotionAuthorizationBlobSha, 'Promotion Authorization blob drifted');

  const closure = readJson(path.join(cwd, policy.integration.a8ClosurePath));
  const authorization = readJson(path.join(cwd, policy.integration.promotionAuthorizationPath));
  validateDocuments(policy, closure, authorization);

  assert.equal(git(['status', '--porcelain=v1', '--untracked-files=all'], cwd), '', 'post-merge worktree must remain clean');

  return Object.freeze({
    ok: true,
    validatedHead: head,
    candidateHead: policy.integration.candidateHead,
    promotionAuthorizationCommit: policy.integration.promotionAuthorizationCommit,
    mergeCommit: policy.integration.mergeCommit,
    sourceClosureViolationCount: 0,
    readyForPromotion: true,
    formalRelease: false,
    publish: false,
    wpBAuthorized: false
  });
}

function runCli(argv = process.argv.slice(2)) {
  const requireOriginMain = argv.includes('--require-origin-main');
  const unexpected = argv.filter(value => value !== '--require-origin-main');
  assert.deepEqual(unexpected, [], `unexpected arguments: ${unexpected.join(', ')}`);
  const result = verifyRepository({ requireOriginMain });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result;
}

if (require.main === module) {
  try {
    runCli();
  } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  POLICY_PATH,
  readJson,
  validateDocuments,
  validatePolicy,
  verifyRepository,
  runCli
};
