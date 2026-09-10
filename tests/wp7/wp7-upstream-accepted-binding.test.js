'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  assertActivationBinding,
  gitIdentity,
  ACCEPTED_BINDING_COMMIT,
  IMPLEMENTATION_BRANCH,
  REPO_ROOT
} = require('../../tools/wp7/lib');

function currentIdentity() {
  return { ...gitIdentity(), branch: IMPLEMENTATION_BRANCH, repositoryClean: true };
}

test('WP7 current release source consumes accepted historical binding only through explicit ledger fallback', () => {
  const objectProbe = spawnSync('git', ['cat-file', '-e', `${ACCEPTED_BINDING_COMMIT}^{commit}`], {
    cwd: REPO_ROOT,
    stdio: 'ignore'
  });
  assert.notEqual(objectProbe.status, 0, 'accepted historical Activation object must remain absent from the current release graph');

  const identity = currentIdentity();
  assert.throws(
    () => assertActivationBinding(REPO_ROOT, { identity, requireClean: false }),
    error => error?.reasonCode === 'WP7_ACTIVATION_BINDING_MISMATCH'
  );

  const result = assertActivationBinding(REPO_ROOT, {
    identity,
    requireClean: false,
    allowAcceptedHistoryLedger: true
  });
  assert.equal(result.status, 'PASS');
  assert.equal(result.acceptedBindingAuthority, 'SOURCE_FIX_LEDGER');
  assert.match(result.acceptedBindingLedgerSha256, /^[0-9a-f]{64}$/);
});

test('WP7 accepted-history ledger fallback rejects tampered historical binding', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wp7-accepted-history-tamper-'));
  try {
    const init = spawnSync('git', ['init'], { cwd: root, encoding: 'utf8' });
    assert.equal(init.status, 0, init.stderr || init.stdout);
    const ledgerDirectory = path.join(root, 'governance', 'windows-release-closure');
    fs.mkdirSync(ledgerDirectory, { recursive: true });
    const ledger = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'governance', 'windows-release-closure', 'source-fix-ledger.json'), 'utf8'));
    ledger.authoritativeHistory.activationTree = '0'.repeat(40);
    fs.writeFileSync(path.join(ledgerDirectory, 'source-fix-ledger.json'), `${JSON.stringify(ledger, null, 2)}\n`, 'utf8');

    const identity = {
      sourceCommit: '1'.repeat(40),
      sourceTree: '2'.repeat(40),
      branch: IMPLEMENTATION_BRANCH,
      repositoryClean: true
    };
    assert.throws(
      () => assertActivationBinding(root, {
        identity,
        requireClean: false,
        allowAcceptedHistoryLedger: true
      }),
      error => error?.reasonCode === 'WP7_ACTIVATION_BINDING_MISMATCH'
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test('WP7 activation binding still rejects an arbitrary non-release branch after ledger fallback', () => {
  const identity = { ...currentIdentity(), branch: 'feature/unreviewed-release' };
  assert.throws(
    () => assertActivationBinding(REPO_ROOT, {
      identity,
      requireClean: false,
      allowAcceptedHistoryLedger: true
    }),
    error => error?.reasonCode === 'WP7_WP0_GATE_BRANCH_MISMATCH'
  );
});
