'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { verifyRegistry } = require('../../../../tools/architecture-closure-v2/verify-wp-b-open-source-adoption');
const packageVerifier = require('../../../../tools/architecture-closure-v2/verify-wp-b-xstate-package');
const upstreamVerifier = require('../../../../tools/architecture-closure-v2/verify-wp-b-xstate-upstream');

const XSTATE_VERSION = '5.32.5';
const XSTATE_INTEGRITY = 'sha512-631+ENa9BCjf/Rn/aWthqY8CWnHT6LHAANtB9zTHb9Tz6SgoI8NA+IWjG3qfIcnEubyksdYGhWCOle4eA/pP4A==';
const XSTATE_COMMIT = 'c25dba07a2b68565edbe83d83c5d679dd85e00b2';

function exactPackageJson() {
  return {
    name: 'xstate-upstream-evidence-fixture',
    version: '1.0.0',
    private: true,
    dependencies: { xstate: XSTATE_VERSION }
  };
}

function exactPackageLock() {
  return {
    name: 'xstate-upstream-evidence-fixture',
    version: '1.0.0',
    lockfileVersion: 3,
    requires: true,
    packages: {
      '': {
        name: 'xstate-upstream-evidence-fixture',
        version: '1.0.0',
        dependencies: { xstate: XSTATE_VERSION }
      },
      'node_modules/xstate': {
        version: XSTATE_VERSION,
        resolved: `https://registry.npmjs.org/xstate/-/xstate-${XSTATE_VERSION}.tgz`,
        integrity: XSTATE_INTEGRITY,
        license: 'MIT'
      }
    }
  };
}

function withSyntheticRepository(work) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-wp-b-xstate-upstream-evidence-'));
  try {
    fs.writeFileSync(path.join(root, 'package.json'), `${JSON.stringify(exactPackageJson(), null, 2)}\n`);
    fs.writeFileSync(path.join(root, 'package-lock.json'), `${JSON.stringify(exactPackageLock(), null, 2)}\n`);
    return work(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function baseFixture() {
  return {
    gate: require('../../../../governance/architecture-closure-v2/wp-b-open-source-adoption-gate.json'),
    registry: require('../../../../governance/architecture-closure-v2/wp-b-open-source-adoption-registry.json'),
    baseline: require('../../../../governance/architecture-closure-v2/wp-b-baseline.json'),
    authorization: require('../../../../governance/architecture-closure-v2/wp-b-design-authorization.json')
  };
}

test('step 7 cannot complete without bound upstream execution evidence', () => {
  const fixture = baseFixture();
  const registry = structuredClone(fixture.registry);
  const xstate = registry.candidates.find(candidate => candidate.project === 'XState');
  xstate.gateSteps.UPSTREAM_TESTS_PASS = 'COMPLETE';
  delete xstate.upstreamTestEvidence;

  withSyntheticRepository(repositoryRoot => {
    const report = verifyRegistry({ ...fixture, registry, repositoryRoot });
    assert.equal(report.ok, false);
    assert.ok(report.violations.some(item => item.code === 'WP_B_XSTATE_UPSTREAM_TEST_EVIDENCE_INVALID'));
  });
});

test('step 7 rejects failures, skips, missing platforms and unbound log digests', () => {
  const fixture = baseFixture();
  const registry = structuredClone(fixture.registry);
  const xstate = registry.candidates.find(candidate => candidate.project === 'XState');
  xstate.gateSteps.UPSTREAM_TESTS_PASS = 'COMPLETE';
  xstate.upstreamTestEvidence = {
    upstreamTestSelection: ['XSTATE_PNPM_TEST_CORE'],
    upstreamTestCommand: 'corepack pnpm test:core',
    runtimeVersion: 'node@22',
    passCount: 1,
    failCount: 1,
    skipCount: 1,
    reviewedHead: 'not-a-head',
    platforms: {
      ubuntu: {
        status: 'FAILED',
        reviewedHead: 'not-a-head',
        workflowRunId: 1,
        jobId: 1,
        testLogSha256: ''
      }
    }
  };

  withSyntheticRepository(repositoryRoot => {
    const report = verifyRegistry({ ...fixture, registry, repositoryRoot });
    assert.equal(report.ok, false);
    assert.ok(report.violations.some(item => item.code === 'WP_B_XSTATE_UPSTREAM_TEST_EVIDENCE_INVALID'));
  });
});

test('exact XState tag checkout uses one exact git ref with hard timeouts and no REST API', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-wp-b-exact-tag-'));
  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = () => {
    throw new Error('HTTP must not be used for exact tag resolution');
  };
  try {
    const checkout = packageVerifier.checkoutExactUpstreamTag({
      checkoutRoot: path.join(root, 'xstate'),
      runCommand(command, args, options) {
        calls.push({ command, args: [...args], options: { ...options } });
        if (args[0] === 'rev-parse') {
          return Object.freeze({ status: 0, stdout: `${XSTATE_COMMIT}\n`, stderr: '' });
        }
        return Object.freeze({ status: 0, stdout: '', stderr: '' });
      }
    });

    assert.equal(checkout.tagName, 'xstate@5.32.5');
    assert.equal(checkout.commitSha, XSTATE_COMMIT);
    const fetchCall = calls.find(call => call.args[0] === 'fetch');
    assert.ok(fetchCall);
    assert.ok(fetchCall.args.includes('refs/tags/xstate@5.32.5'));
    assert.equal(calls.some(call => call.args.some(value => /api\.github\.com/u.test(String(value)))), false);
    assert.equal(calls.every(call => Number.isInteger(call.options.timeoutMs) && call.options.timeoutMs > 0), true);
  } finally {
    global.fetch = originalFetch;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('governed upstream commands convert timeout and rate limiting into stable governance errors', () => {
  assert.throws(
    () => packageVerifier.runGovernedCommand('git', ['fetch'], {
      commandKind: 'GIT_FETCH',
      timeoutMs: 2500,
      spawnSyncImpl: () => ({
        error: Object.assign(new Error('spawnSync git ETIMEDOUT'), { code: 'ETIMEDOUT' }),
        status: null,
        signal: 'SIGTERM',
        stdout: '',
        stderr: ''
      })
    }),
    error => error.code === 'WP_B_UPSTREAM_COMMAND_TIMEOUT'
      && error.commandKind === 'GIT_FETCH'
      && error.timeoutMs === 2500
  );

  assert.throws(
    () => packageVerifier.runGovernedCommand('npm', ['view', 'xstate@5.32.5'], {
      commandKind: 'NPM_METADATA',
      timeoutMs: 2500,
      spawnSyncImpl: () => ({
        error: null,
        status: 1,
        signal: null,
        stdout: '',
        stderr: 'npm ERR! code E429\nnpm ERR! 429 Too Many Requests'
      })
    }),
    error => error.code === 'WP_B_UPSTREAM_RATE_LIMITED'
      && error.commandKind === 'NPM_METADATA'
      && error.status === 1
  );
});

test('upstream verification runs the real XState pnpm test:core command', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-wp-b-xstate-core-'));
  const calls = [];
  try {
    fs.writeFileSync(path.join(root, 'package.json'), `${JSON.stringify({
      name: 'xstate-monorepo',
      private: true,
      scripts: { 'test:core': 'vitest run --project xstate' },
      packageManager: 'pnpm@9.15.9'
    }, null, 2)}\n`);

    const report = upstreamVerifier.runUpstreamCoreTests({
      checkoutRoot: root,
      commitSha: XSTATE_COMMIT,
      runCommand(command, args, options) {
        calls.push({ command, args: [...args], options: { ...options } });
        if (args.includes('test:core')) {
          return Object.freeze({
            status: 0,
            stdout: 'Test Files  75 passed (75)\nTests  1721 passed | 13 skipped | 1 todo (1735)\n',
            stderr: ''
          });
        }
        return Object.freeze({ status: 0, stdout: 'Lockfile is up to date\n', stderr: '' });
      }
    });

    assert.deepEqual(report.upstreamTestSelection, ['XSTATE_PNPM_TEST_CORE']);
    assert.equal(report.upstreamTestCommand, 'corepack pnpm test:core');
    assert.equal(report.passCount, 1);
    assert.equal(report.failCount, 0);
    assert.equal(report.skipCount, 0);
    assert.deepEqual(report.testSummary, {
      testFilePassCount: 75,
      testFileFailCount: 0,
      testPassCount: 1721,
      testFailCount: 0,
      skipCount: 13,
      todoCount: 1
    });
    assert.match(report.testLogSha256, /^[0-9a-f]{64}$/u);
    assert.ok(calls.some(call => call.args[0] === 'pnpm' && call.args[1] === 'install' && call.args.includes('--frozen-lockfile')));
    assert.ok(calls.some(call => call.args[0] === 'pnpm' && call.args[1] === 'test:core'));
    assert.equal(calls.every(call => Number.isInteger(call.options.timeoutMs) && call.options.timeoutMs > 0), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
