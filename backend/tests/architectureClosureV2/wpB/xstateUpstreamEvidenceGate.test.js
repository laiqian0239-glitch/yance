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

test('bounded npm audit recovery uses the native fetch policy and retries only governed timeout', () => {
  let calls = 0;
  const ok = packageVerifier.runGovernedNpmAudit('/audit', {
    runCommand(command, args, options) {
      calls += 1;
      assert.match(command, /^npm(?:\.cmd)?$/u);
      assert.deepEqual(args, ['audit', '--omit=dev', '--json']);
      assert.equal(options.commandKind, 'NPM_AUDIT');
      assert.equal(options.timeoutMs, 120_000);
      assert.equal(options.allowFailure, true);
      assert.deepEqual(options.env, {
        npm_config_fetch_timeout: '30000',
        npm_config_fetch_retries: '1',
        npm_config_fetch_retry_mintimeout: '1000',
        npm_config_fetch_retry_maxtimeout: '5000'
      });
      if (calls === 1) throw Object.assign(new Error('timeout'), { code: 'WP_B_UPSTREAM_COMMAND_TIMEOUT' });
      return Object.freeze({ status: 0, stdout: '{}', stderr: '' });
    }
  });
  assert.equal(ok.status, 0);
  assert.equal(calls, 2);
  assert.equal(packageVerifier.NPM_AUDIT_MAX_FETCH_CYCLE_MS, 65_000);
  assert.ok(packageVerifier.NPM_AUDIT_MAX_FETCH_CYCLE_MS < packageVerifier.COMMAND_TIMEOUTS.NPM_AUDIT);

  for (const code of ['WP_B_UPSTREAM_RATE_LIMITED', 'WP_B_UPSTREAM_COMMAND_EXECUTION_FAILED', 'WP_B_UPSTREAM_TOOL_UNAVAILABLE']) {
    calls = 0;
    assert.throws(() => packageVerifier.runGovernedNpmAudit('/audit', {
      runCommand() {
        calls += 1;
        throw Object.assign(new Error(code), { code });
      }
    }), error => error.code === code);
    assert.equal(calls, 1);
  }

  calls = 0;
  assert.throws(() => packageVerifier.runGovernedNpmAudit('/audit', {
    runCommand() {
      calls += 1;
      throw Object.assign(new Error('timeout'), { code: 'WP_B_UPSTREAM_COMMAND_TIMEOUT' });
    }
  }), error => error.code === 'WP_B_UPSTREAM_COMMAND_TIMEOUT');
  assert.equal(calls, 2);
});

test('both exact pinned npm audit timeout messages retry exactly once', () => {
  const messages = [
    'network timeout at: https://registry.npmjs.org/-/npm/v1/security/advisories/bulk',
    'network timeout at: https://registry.npmjs.org/-/npm/v1/security/audits/quick'
  ];

  for (const message of messages) {
    const transient = Object.freeze({
      status: 1,
      signal: null,
      stdout: JSON.stringify({
        message,
        error: { summary: '', detail: '' }
      }),
      stderr: 'npm error audit endpoint returned an error'
    });

    let calls = 0;

    const recovered = packageVerifier.runGovernedNpmAudit('/audit', {
      runCommand() {
        calls += 1;
        if (calls === 1) return transient;
        return Object.freeze({
          status: 0,
          signal: null,
          stdout: '{}',
          stderr: ''
        });
      }
    });

    assert.equal(calls, 2);
    assert.equal(recovered.status, 0);
  }
});

test('both exact pinned npm audit timeout messages fail closed after exactly two attempts', () => {
  const messages = [
    'network timeout at: https://registry.npmjs.org/-/npm/v1/security/advisories/bulk',
    'network timeout at: https://registry.npmjs.org/-/npm/v1/security/audits/quick'
  ];

  for (const message of messages) {
    const transient = Object.freeze({
      status: 1,
      signal: null,
      stdout: JSON.stringify({
        message,
        error: { summary: '', detail: '' }
      }),
      stderr: 'npm error audit endpoint returned an error'
    });

    let calls = 0;

    assert.throws(
      () => packageVerifier.runGovernedNpmAudit('/audit', {
        runCommand() {
          calls += 1;
          return transient;
        }
      }),
      error => {
        assert.equal(
          error.code,
          'WP_B_UPSTREAM_NPM_AUDIT_ENDPOINT_TRANSPORT_FAILED'
        );
        assert.equal(error.status, 1);
        assert.equal(error.stdout, transient.stdout);
        assert.equal(error.stderr, transient.stderr);
        assert.equal(error.attempts, 2);
        return true;
      }
    );

    assert.equal(calls, 2);
  }
});

test('near-miss and unbound npm audit errors never retry', () => {
  const payloads = [
    {
      message: 'network timeout at: https://registry.npmjs.org/-/npm/v1/security/audits/quick ',
      error: { summary: '', detail: '' }
    },
    {
      message: 'network timeout at: https://registry.npmjs.org/-/npm/v1/security/audits/other',
      error: { summary: '', detail: '' }
    },
    {
      message: 'network timeout',
      error: { summary: '', detail: '' }
    },
    {
      message: 'network timeout at: https://registry.npmjs.org/-/npm/v1/security/audits/quick'
    },
    {
      message: 'arbitrary top-level audit error',
      error: { summary: '', detail: '' }
    }
  ];

  for (const payload of payloads) {
    const result = Object.freeze({
      status: 1,
      signal: null,
      stdout: JSON.stringify(payload),
      stderr: 'npm error audit endpoint returned an error'
    });

    let calls = 0;

    if (payload.error) {
      assert.throws(
        () => packageVerifier.runGovernedNpmAudit('/audit', {
          runCommand() {
            calls += 1;
            return result;
          }
        }),
        error => {
          assert.equal(
            error.code,
            'WP_B_UPSTREAM_NPM_AUDIT_ENDPOINT_FAILED'
          );
          assert.equal(error.status, 1);
          assert.equal(error.stdout, result.stdout);
          assert.equal(error.stderr, result.stderr);
          assert.equal(error.attempts, 1);
          return true;
        }
      );
    } else {
      const returned = packageVerifier.runGovernedNpmAudit('/audit', {
        runCommand() {
          calls += 1;
          return result;
        }
      });

      assert.equal(returned, result);

      assert.throws(
        () => packageVerifier.evaluateAuditReport(
          JSON.parse(returned.stdout)
        ),
        error => error.code === 'WP_B_XSTATE_AUDIT_REPORT_INVALID'
      );
    }

    assert.equal(calls, 1);
  }
});

test('nonzero valid vulnerability report is not mistaken for npm endpoint transport failure', () => {
  const result = Object.freeze({
    status: 1,
    signal: null,
    stdout: JSON.stringify({
      metadata: {
        vulnerabilities: {
          info: 0,
          low: 0,
          moderate: 0,
          high: 1,
          critical: 0,
          total: 1
        }
      }
    }),
    stderr: ''
  });

  let calls = 0;

  const returned = packageVerifier.runGovernedNpmAudit('/audit', {
    runCommand() {
      calls += 1;
      return result;
    }
  });

  assert.equal(calls, 1);
  assert.equal(returned, result);

  const evaluation =
    packageVerifier.evaluateAuditReport(JSON.parse(returned.stdout));

  assert.deepEqual(
    evaluation.violations.map(item => item.code),
    ['WP_B_XSTATE_HIGH_OR_CRITICAL_VULNERABILITY']
  );
});

test('npm audit report evaluation accepts complete lower severities and preserves vulnerability policy', () => {
  const lowerOnly = packageVerifier.evaluateAuditReport({
    metadata: { vulnerabilities: { info: 1, low: 2, moderate: 3, high: 0, critical: 0, total: 6 } }
  });
  assert.deepEqual(lowerOnly.vulnerabilities, { info: 1, low: 2, moderate: 3, high: 0, critical: 0, total: 6 });
  assert.deepEqual(lowerOnly.violations, []);

  const prohibited = packageVerifier.evaluateAuditReport({
    metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 1, critical: 1, total: 2 } }
  });
  assert.deepEqual(prohibited.violations.map(item => item.code), ['WP_B_XSTATE_HIGH_OR_CRITICAL_VULNERABILITY']);
});

test('npm audit report evaluation fails closed for invalid parseable structures and counts', () => {
  const valid = { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 };
  const invalidReports = [
    {},
    { metadata: {} },
    { error: { code: 'EAUDIT' }, metadata: { vulnerabilities: { ...valid } } },
    { metadata: { vulnerabilities: { ...valid, low: '0' } } },
    { metadata: { vulnerabilities: { ...valid, high: -1 } } },
    { metadata: { vulnerabilities: { ...valid, moderate: Number.NaN } } },
    { metadata: { vulnerabilities: { ...valid, critical: Number.POSITIVE_INFINITY } } }
  ];
  const missing = { ...valid };
  delete missing.info;
  invalidReports.push({ metadata: { vulnerabilities: missing } });

  for (const report of invalidReports) {
    assert.throws(
      () => packageVerifier.evaluateAuditReport(report),
      error => error.code === 'WP_B_XSTATE_AUDIT_REPORT_INVALID'
    );
  }
});

test('npm audit malformed JSON fails closed before report evaluation', () => {
  assert.throws(
    () => packageVerifier.parseJsonOutput(
      { stdout: '{"metadata":', stderr: 'transport truncated' },
      'npm audit'
    ),
    error => error.code === 'WP_B_UPSTREAM_JSON_INVALID'
  );
});
test('governed scratch cleanup uses Node bounded retry and preserves primary failure', () => {
  let received = null;
  assert.equal(packageVerifier.removeGovernedScratchDirectory('scratch', {
    rmSyncImpl(root, options) {
      assert.equal(root, 'scratch');
      received = options;
    }
  }), true);
  assert.deepEqual(received, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });

  const busy = () => { throw Object.assign(new Error('busy'), { code: 'EBUSY' }); };
  assert.throws(() => packageVerifier.removeGovernedScratchDirectory('scratch', { rmSyncImpl: busy }),
    error => error.code === 'WP_B_UPSTREAM_SCRATCH_CLEANUP_FAILED' && error.cleanupCauseCode === 'EBUSY');
  const primary = Object.assign(new Error('primary timeout'), { code: 'WP_B_UPSTREAM_COMMAND_TIMEOUT' });
  assert.equal(packageVerifier.removeGovernedScratchDirectory('scratch', { primaryError: primary, rmSyncImpl: busy }), false);
  assert.equal(primary.code, 'WP_B_UPSTREAM_COMMAND_TIMEOUT');
  assert.equal(primary.message, 'primary timeout');
  assert.equal(primary.cleanupCode, 'WP_B_UPSTREAM_SCRATCH_CLEANUP_FAILED');
  assert.equal(primary.cleanupCauseCode, 'EBUSY');
  assert.equal(primary.cleanupScratchRoot, 'scratch');
  assert.equal(primary.cleanupMaxRetries, 5);
  assert.equal(primary.cleanupRetryDelayMs, 100);
});

test('all XState scratch owners share cleanup authority without weakening supply-chain checks', () => {
  const packageSource = fs.readFileSync(require.resolve('../../../../tools/architecture-closure-v2/verify-wp-b-xstate-package'), 'utf8');
  const upstreamSource = fs.readFileSync(require.resolve('../../../../tools/architecture-closure-v2/verify-wp-b-xstate-upstream'), 'utf8');
  assert.equal(packageSource.includes('fs.rmSync('), false);
  assert.match(packageSource, /removeGovernedScratchDirectory\(checkoutRoot, \{ primaryError \}\)/u);
  assert.match(packageSource, /removeGovernedScratchDirectory\(tempRoot, \{ primaryError \}\)/u);
  assert.equal(upstreamSource.includes('fs.rmSync('), false);
  assert.match(upstreamSource, /status: error\.status === undefined \? null : error\.status/u);
  assert.match(upstreamSource, /signal: error\.signal \|\| null/u);
  assert.match(upstreamSource, /stdout: error\.stdout \|\| ''/u);
  assert.match(upstreamSource, /stderr: error\.stderr \|\| ''/u);
  assert.match(upstreamSource, /packageVerifier\.removeGovernedScratchDirectory\(tempRoot, \{ primaryError \}\)/u);
  assert.match(packageSource, /const EXACT_VERSION = '5\.32\.5';/u);
  assert.match(packageSource, /NPM_AUDIT:\s*120_000/u);
  assert.match(upstreamSource, /const UPSTREAM_TEST_COMMAND = 'corepack pnpm test:core';/u);
});

test('audit sandbox materializes the physical XState package tree before real npm audit', () => {
  const source = fs.readFileSync(
    require.resolve('../../../../tools/architecture-closure-v2/verify-wp-b-xstate-package'),
    'utf8'
  ).replace(/\r\n/g, '\n');

  assert.equal(source.includes("'--package-lock-only'"), false);

  const materializedInstall = [
    "runGovernedCommand(npmCommand(), [",
    "      'install',",
    "      '--ignore-scripts',",
    "      '--save-exact',",
    "      '--no-fund',",
    "      '--no-audit',",
    "      PACKAGE_SPEC",
    "    ], {",
    "      cwd: auditRoot,",
    "      commandKind: 'NPM_LOCK_INSTALL',",
    "      timeoutMs: COMMAND_TIMEOUTS.NPM_LOCK_INSTALL",
    "    });"
  ].join('\n');

  const installIndex = source.indexOf(materializedInstall);
  const auditIndex = source.indexOf(
    'const auditResult = runGovernedNpmAudit(auditRoot);'
  );

  assert.ok(installIndex >= 0);
  assert.ok(auditIndex > installIndex);
});
