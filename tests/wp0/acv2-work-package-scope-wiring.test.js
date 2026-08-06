'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  ACV2_AUTHORIZATION_BLOB_SHA,
  ACV2_AUTHORIZATION_REPOSITORY_PATH,
  ACV2_WP_A_PARENT_GOVERNANCE_HEAD,
  changedFileSetSha256,
  loadWorkPackageAuthorization,
  loadWorkPackagePostMergeDefect
} = require('../../shared/release/implementationBranchPolicy');
const { evaluateWorkPackageScopeForGate } = require('../../tools/wp0/work-package-scope-gate');

const ROOT = path.resolve(__dirname, '..', '..');
const AUTHORIZATION = loadWorkPackageAuthorization();
const AUTHORIZED_BRANCH = AUTHORIZATION.authorizedBranch;

function exactPathBuffer(changedFiles) {
  return changedFiles.length
    ? Buffer.from(`${changedFiles.join('\0')}\0`, 'utf8')
    : Buffer.alloc(0);
}

function makeGitAdapter(changedFiles, options = {}) {
  const status = options.status || '';
  const head = options.head || 'f'.repeat(40);
  const authorizationBlob = Object.prototype.hasOwnProperty.call(options, 'authorizationBlob')
    ? options.authorizationBlob
    : ACV2_AUTHORIZATION_BLOB_SHA;
  return (args) => {
    if (args[0] === 'status') return status;
    if (args[0] === 'rev-parse' && args[1] === 'HEAD') return head;
    if (args[0] === 'rev-parse' && args[1] === `HEAD:${ACV2_AUTHORIZATION_REPOSITORY_PATH}`) {
      if (authorizationBlob instanceof Error) throw authorizationBlob;
      return authorizationBlob;
    }
    if (args[0] === 'cat-file') return '';
    if (args[0] === 'merge-base') return '';
    if (args.includes('diff')) return exactPathBuffer(changedFiles);
    throw new Error(`unexpected git command: ${args.join(' ')}`);
  };
}

function expectedAuthorizationPaths() {
  return [...AUTHORIZATION.exactPaths];
}

test('authorized ACV2 scope passes with exact NUL-framed changed-file evidence', () => {
  const changedFiles = expectedAuthorizationPaths();
  const result = evaluateWorkPackageScopeForGate({
    branch: AUTHORIZED_BRANCH,
    git: makeGitAdapter(changedFiles),
    authorization: AUTHORIZATION,
    taskScopeChain: null,
    amendment: null
  });

  assert.equal(result.applicable, true);
  assert.equal(result.pass, true, JSON.stringify(result));
  assert.equal(result.reasonCode, null);
  assert.equal(result.parentGovernanceHead, ACV2_WP_A_PARENT_GOVERNANCE_HEAD);
  assert.equal(result.changedFileCount, changedFiles.length);
  assert.deepEqual(result.unauthorizedPaths, []);
});

test('ACV2 scope rejects unauthorized paths and authorization-blob drift', () => {
  const changedFiles = [...expectedAuthorizationPaths(), 'backend/runtime/unauthorized.js'];
  const scope = evaluateWorkPackageScopeForGate({
    branch: AUTHORIZED_BRANCH,
    git: makeGitAdapter(changedFiles),
    authorization: AUTHORIZATION,
    taskScopeChain: null,
    amendment: null
  });
  assert.equal(scope.pass, false);
  assert.equal(scope.reasonCode, 'ACV2_WORK_PACKAGE_SCOPE_VIOLATION');
  assert.deepEqual(scope.unauthorizedPaths, ['backend/runtime/unauthorized.js']);

  const blob = evaluateWorkPackageScopeForGate({
    branch: AUTHORIZED_BRANCH,
    git: makeGitAdapter(expectedAuthorizationPaths(), { authorizationBlob: '0'.repeat(40) }),
    authorization: AUTHORIZATION,
    taskScopeChain: null,
    amendment: null
  });
  assert.equal(blob.pass, false);
  assert.equal(blob.reasonCode, 'ACV2_WORK_PACKAGE_SCOPE_AUTHORIZATION_BLOB_MISMATCH');
});

test('ACV2 scope fails closed on dirty worktrees, unavailable parents, and invalid transport', () => {
  const dirty = evaluateWorkPackageScopeForGate({
    branch: AUTHORIZED_BRANCH,
    git: makeGitAdapter(expectedAuthorizationPaths(), { status: ' M backend/runtime/AppRuntime.js' }),
    authorization: AUTHORIZATION,
    taskScopeChain: null,
    amendment: null
  });
  assert.equal(dirty.pass, false);
  assert.equal(dirty.reasonCode, 'ACV2_WORK_PACKAGE_SCOPE_WORKTREE_DIRTY');

  const unavailable = evaluateWorkPackageScopeForGate({
    branch: AUTHORIZED_BRANCH,
    git: (args) => {
      if (args[0] === 'status') return '';
      if (args[0] === 'rev-parse' && args[1] === `HEAD:${ACV2_AUTHORIZATION_REPOSITORY_PATH}`) {
        return ACV2_AUTHORIZATION_BLOB_SHA;
      }
      if (args[0] === 'cat-file') throw new Error('missing parent');
      throw new Error(`unexpected git command: ${args.join(' ')}`);
    },
    authorization: AUTHORIZATION,
    taskScopeChain: null,
    amendment: null
  });
  assert.equal(unavailable.pass, false);
  assert.equal(unavailable.reasonCode, 'ACV2_WORK_PACKAGE_SCOPE_PARENT_UNAVAILABLE');

  const invalidTransport = evaluateWorkPackageScopeForGate({
    branch: AUTHORIZED_BRANCH,
    git: (args) => {
      if (args[0] === 'status') return '';
      if (args[0] === 'rev-parse' && args[1] === `HEAD:${ACV2_AUTHORIZATION_REPOSITORY_PATH}`) {
        return ACV2_AUTHORIZATION_BLOB_SHA;
      }
      if (args[0] === 'cat-file' || args[0] === 'merge-base') return '';
      if (args.includes('diff')) return `${expectedAuthorizationPaths().join('\n')}\n`;
      throw new Error(`unexpected git command: ${args.join(' ')}`);
    },
    authorization: AUTHORIZATION,
    taskScopeChain: null,
    amendment: null
  });
  assert.equal(invalidTransport.pass, false);
  assert.equal(invalidTransport.reasonCode, 'ACV2_WORK_PACKAGE_SCOPE_DIFF_FAILED');
  assert.match(invalidTransport.error, /must return a Buffer/u);
});

test('detached evidence requires exact checked-out commit and exact scope', () => {
  const changedFiles = expectedAuthorizationPaths();
  const evidenceHead = 'e'.repeat(40);
  const pass = evaluateWorkPackageScopeForGate({
    branch: '',
    evidenceMode: true,
    evidenceSourceCommit: evidenceHead,
    git: makeGitAdapter(changedFiles, { head: evidenceHead }),
    authorization: AUTHORIZATION,
    taskScopeChain: null,
    amendment: null
  });
  assert.equal(pass.pass, true, JSON.stringify(pass));
  assert.equal(pass.effectiveBranch, AUTHORIZED_BRANCH);

  const mismatch = evaluateWorkPackageScopeForGate({
    branch: '',
    evidenceMode: true,
    evidenceSourceCommit: evidenceHead,
    git: makeGitAdapter(changedFiles, { head: 'd'.repeat(40) }),
    authorization: AUTHORIZATION,
    taskScopeChain: null,
    amendment: null
  });
  assert.equal(mismatch.pass, false);
  assert.equal(mismatch.reasonCode, 'ACV2_WORK_PACKAGE_SCOPE_EVIDENCE_COMMIT_MISMATCH');
});

test('checked-out repository preserves the frozen ACV2 authorization scope', () => {
  const authorizationPath = path.join(ROOT, ACV2_AUTHORIZATION_REPOSITORY_PATH);
  assert.equal(fs.existsSync(authorizationPath), true);
  assert.equal(AUTHORIZATION.approvedChangedFileSetSha256, changedFileSetSha256(AUTHORIZATION.exactPaths));
  assert.equal(AUTHORIZATION.approvedChangedFileCount, AUTHORIZATION.exactPaths.length);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-acv2-scope-'));
  try {
    execFileSync('git', ['init', '--quiet'], { cwd: tmp });
    execFileSync('git', ['config', 'user.email', 'scope@example.invalid'], { cwd: tmp });
    execFileSync('git', ['config', 'user.name', 'Scope Fixture'], { cwd: tmp });
    fs.writeFileSync(path.join(tmp, 'baseline.txt'), 'baseline\n', 'utf8');
    execFileSync('git', ['add', '.'], { cwd: tmp });
    execFileSync('git', ['commit', '--quiet', '-m', 'baseline'], { cwd: tmp });
    const base = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: tmp, encoding: 'utf8' }).trim();

    const fixtureFiles = ['backend/runtime/AppRuntime.js', 'tests/wp0/freeze-rejected-baseline.test.js'];
    for (const relative of fixtureFiles) {
      const full = path.join(tmp, ...relative.split('/'));
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, `${relative}\n`, 'utf8');
    }
    execFileSync('git', ['add', '.'], { cwd: tmp });
    execFileSync('git', ['commit', '--quiet', '-m', 'candidate'], { cwd: tmp });
    const raw = execFileSync('git', ['diff', '--name-only', '-z', base, 'HEAD', '--'], {
      cwd: tmp,
      encoding: null
    });
    assert.deepEqual(raw.toString('utf8').split('\0').filter(Boolean).sort(), fixtureFiles.sort());
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('post-merge defect scope uses exact frozen paths rather than current candidate changes', () => {
  const defect = loadWorkPackagePostMergeDefect();
  assert.ok(defect);
  const result = evaluateWorkPackageScopeForGate({
    branch: defect.scope.targetBranch,
    git: makeGitAdapter(defect.scope.exactPaths),
    postMergeDefect: defect
  });
  assert.equal(result.pass, true, JSON.stringify(result));
  assert.equal(result.postMergeDefectScopeApplied, true);
  assert.equal(result.defectId, defect.defectId);
});
