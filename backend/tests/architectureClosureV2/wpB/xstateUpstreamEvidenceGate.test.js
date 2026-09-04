'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { verifyRegistry } = require('../../../../tools/architecture-closure-v2/verify-wp-b-open-source-adoption');
const packageVerifier = require('../../../../tools/architecture-closure-v2/verify-wp-b-xstate-package');
const upstreamVerifier = require('../../../../tools/architecture-closure-v2/verify-wp-b-xstate-upstream');
const vulnerabilityVerifier = require('../../../../tools/architecture-closure-v2/verify-wp-b-xstate-vulnerability-evidence');
const refreshTool = require('../../../../tools/architecture-closure-v2/refresh-wp-b-xstate-vulnerability-evidence');
const REPO_ROOT = path.resolve(__dirname, '../../../..');

const XSTATE_VERSION = '5.32.5';
const XSTATE_INTEGRITY = 'sha512-ULazi1oe6wGrXl0Frb6otSlkm5HLifbbVTkMk5kkSKqz4TkxJaVpnl6jOJwKeid3ORPxYyZQgNLUSYX9q65SIA==';
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

test('live refresh primitives share bounded cleanup while candidate verification owns no scratch/network refresh', () => {
  const packageSource = fs.readFileSync(
    require.resolve('../../../../tools/architecture-closure-v2/verify-wp-b-xstate-package'),
    'utf8'
  );
  const upstreamSource = fs.readFileSync(
    require.resolve('../../../../tools/architecture-closure-v2/verify-wp-b-xstate-upstream'),
    'utf8'
  );

  assert.equal(packageSource.includes('fs.rmSync('), false);
  assert.match(
    packageSource,
    /removeGovernedScratchDirectory\(checkoutRoot, \{ primaryError \}\)/u
  );
  assert.match(
    packageSource,
    /removeGovernedScratchDirectory\(tempRoot, \{ primaryError \}\)/u
  );
  assert.equal(upstreamSource.includes('fs.rmSync('), false);
  assert.match(packageSource, /const EXACT_VERSION = '5\.32\.5';/u);
  assert.match(packageSource, /NPM_AUDIT:\s*120_000/u);
  assert.match(
    upstreamSource,
    /const UPSTREAM_TEST_COMMAND = 'corepack pnpm test:core';/u
  );

  const packageCandidate = packageSource.slice(
    packageSource.indexOf('async function verify(options = {}) {'),
    packageSource.indexOf('async function main() {')
  );
  const upstreamCandidate = upstreamSource.slice(
    upstreamSource.indexOf('async function verify(options = {}) {'),
    upstreamSource.indexOf('async function main() {')
  );

  assert.equal(packageCandidate.includes('runGovernedNpmAudit('), false);
  assert.equal(packageCandidate.includes('checkoutExactUpstreamTag('), false);
  assert.equal(upstreamCandidate.includes('runUpstreamCoreTests('), false);
  assert.equal(upstreamCandidate.includes('checkoutExactUpstreamTag('), false);
});

test('explicit refresh authority materializes exact XState before npm audit without package-lock-only shortcut', () => {
  const source = fs.readFileSync(
    require.resolve('../../../../tools/architecture-closure-v2/verify-wp-b-xstate-package'),
    'utf8'
  ).replace(/\r\n/g, '\n');

  const start = source.indexOf('function refreshVulnerabilityEvidence(options = {}) {');
  const end = source.indexOf('async function verify(options = {}) {', start);
  const refreshSource = source.slice(start, end);

  assert.ok(start >= 0);
  assert.equal(refreshSource.includes("'--package-lock-only'"), false);
  assert.ok(refreshSource.indexOf("'install'") >= 0);
  assert.ok(refreshSource.indexOf("'--ignore-scripts'") >= 0);
  assert.ok(refreshSource.indexOf("'--save-exact'") >= 0);
  assert.ok(refreshSource.indexOf('runGovernedNpmAudit(tempRoot') > refreshSource.indexOf("'install'"));
});

test('candidate XState verification is deterministic sealed evidence and performs no live refresh', async () => {
  const nowMs = Date.parse('2026-09-04T06:00:00.000Z');

  const packageReport = await packageVerifier.verify({
    repositoryRoot: REPO_ROOT,
    nowMs
  });
  assert.equal(packageReport.ok, true);
  assert.equal(packageReport.evidenceMode, 'SEALED_REPOSITORY_EVIDENCE');
  assert.equal(
    packageReport.security.evidenceMode,
    'SEALED_REPOSITORY_VULNERABILITY_EVIDENCE'
  );

  const report = await upstreamVerifier.verify({
    repositoryRoot: REPO_ROOT,
    nowMs
  });

  assert.equal(report.ok, true);
  assert.equal(
    report.candidateEvidenceMode,
    'DETERMINISTIC_SEALED_REPOSITORY_EVIDENCE'
  );
  assert.equal(
    report.upstreamTests.evidenceMode,
    'SEALED_UPSTREAM_CONFORMANCE_EVIDENCE'
  );
  assert.equal(report.upstreamTests.failCount, 0);
});

test('sealed vulnerability receipt fails closed on stale, future, digest and identity drift without fallback', () => {
  const receipt = require(
    '../../../../governance/architecture-closure-v2/wp-b-xstate-vulnerability-evidence.json'
  );

  assert.equal(
    vulnerabilityVerifier.verifyEvidence({
      repositoryRoot: REPO_ROOT,
      document: receipt,
      nowMs: Date.parse('2026-09-04T06:00:00.000Z')
    }).ok,
    true
  );

  assert.throws(
    () => vulnerabilityVerifier.verifyEvidence({
      repositoryRoot: REPO_ROOT,
      document: receipt,
      nowMs: Date.parse('2026-09-18T00:00:00.000Z')
    }),
    error => error.code === 'WP_B_XSTATE_VULNERABILITY_EVIDENCE_EXPIRED'
  );

  const badDigest = structuredClone(receipt);
  badDigest.receiptDigestSha256 = '0'.repeat(64);
  assert.throws(
    () => vulnerabilityVerifier.verifyEvidence({
      repositoryRoot: REPO_ROOT,
      document: badDigest,
      nowMs: Date.parse('2026-09-04T06:00:00.000Z')
    }),
    error => error.code === 'WP_B_XSTATE_VULNERABILITY_EVIDENCE_DIGEST_MISMATCH'
  );

  const identity = structuredClone(receipt);
  identity.package.version = '5.32.4';
  identity.receiptDigestSha256 =
    vulnerabilityVerifier.computeReceiptDigest(identity);
  assert.throws(
    () => vulnerabilityVerifier.verifyEvidence({
      repositoryRoot: REPO_ROOT,
      document: identity,
      nowMs: Date.parse('2026-09-04T06:00:00.000Z')
    }),
    error => error.code === 'WP_B_XSTATE_VULNERABILITY_EVIDENCE_IDENTITY_MISMATCH'
  );

  const future = structuredClone(receipt);
  future.source.capturedAt = '2026-09-10T00:00:00.000Z';
  future.source.expiresAt = '2026-09-17T00:00:00.000Z';
  future.receiptDigestSha256 =
    vulnerabilityVerifier.computeReceiptDigest(future);
  assert.throws(
    () => vulnerabilityVerifier.verifyEvidence({
      repositoryRoot: REPO_ROOT,
      document: future,
      nowMs: Date.parse('2026-09-04T06:00:00.000Z')
    }),
    error => error.code === 'WP_B_XSTATE_VULNERABILITY_EVIDENCE_FUTURE_DATED'
  );
});

test('sealed vulnerability policy hard-blocks high/critical while lower severities remain reportable', () => {
  const receipt = require(
    '../../../../governance/architecture-closure-v2/wp-b-xstate-vulnerability-evidence.json'
  );

  const lower = structuredClone(receipt);
  lower.source.type = 'LIVE_NPM_AUDIT_REFRESH';
  lower.source.workflowRunId = 123;
  lower.source.runAttempt = 1;
  lower.source.headSha = '1'.repeat(40);
  lower.source.command = 'npm audit --omit=dev --json';
  lower.result.vulnerabilities = {
    info: 0,
    low: 2,
    moderate: 1,
    high: 0,
    critical: 0,
    total: 3
  };
  lower.receiptDigestSha256 =
    vulnerabilityVerifier.computeReceiptDigest(lower);

  const lowerReport = vulnerabilityVerifier.verifyEvidence({
    repositoryRoot: REPO_ROOT,
    document: lower,
    nowMs: Date.parse('2026-09-04T06:00:00.000Z')
  });
  assert.equal(lowerReport.vulnerabilities.low, 2);
  assert.equal(lowerReport.vulnerabilities.moderate, 1);

  for (const severity of ['high', 'critical']) {
    const blocked = structuredClone(lower);
    blocked.result.vulnerabilities[severity] = 1;
    blocked.result.vulnerabilities.total = 4;
    blocked.receiptDigestSha256 =
      vulnerabilityVerifier.computeReceiptDigest(blocked);

    assert.throws(
      () => vulnerabilityVerifier.verifyEvidence({
        repositoryRoot: REPO_ROOT,
        document: blocked,
        nowMs: Date.parse('2026-09-04T06:00:00.000Z')
      }),
      error => error.code === 'WP_B_XSTATE_HIGH_OR_CRITICAL_VULNERABILITY'
    );
  }
});

test('bootstrap receipt is bound to immutable historical run and exact zero-audit observation', () => {
  const receipt = require(
    '../../../../governance/architecture-closure-v2/wp-b-xstate-vulnerability-evidence.json'
  );
  const mutated = structuredClone(receipt);
  mutated.source.workflowRunId += 1;
  mutated.receiptDigestSha256 =
    vulnerabilityVerifier.computeReceiptDigest(mutated);

  assert.throws(
    () => vulnerabilityVerifier.verifyEvidence({
      repositoryRoot: REPO_ROOT,
      document: mutated,
      nowMs: Date.parse('2026-09-04T06:00:00.000Z')
    }),
    error => error.code === 'WP_B_XSTATE_VULNERABILITY_EVIDENCE_BOOTSTRAP_MISMATCH'
  );
});

test('explicit refresh helper reuses governed npm/materialized sandbox with deterministic injected transport', () => {
  const calls = [];

  const report = packageVerifier.refreshVulnerabilityEvidence({
    repositoryRoot: REPO_ROOT,
    runCommand(command, args, options) {
      calls.push({ command, args: [...args], options: { ...options } });

      if (args[0] === 'install') {
        fs.mkdirSync(
          path.join(options.cwd, 'node_modules', 'xstate'),
          { recursive: true }
        );
        fs.writeFileSync(
          path.join(options.cwd, 'node_modules', 'xstate', 'package.json'),
          JSON.stringify({ name: 'xstate', version: '5.32.5' })
        );
        fs.writeFileSync(
          path.join(options.cwd, 'package-lock.json'),
          JSON.stringify({
            lockfileVersion: 3,
            packages: {
              'node_modules/xstate': {
                version: '5.32.5',
                resolved: 'https://registry.npmjs.org/xstate/-/xstate-5.32.5.tgz',
                integrity: 'sha512-ULazi1oe6wGrXl0Frb6otSlkm5HLifbbVTkMk5kkSKqz4TkxJaVpnl6jOJwKeid3ORPxYyZQgNLUSYX9q65SIA==',
                license: 'MIT'
              }
            }
          })
        );
        return Object.freeze({
          status: 0,
          signal: null,
          stdout: '',
          stderr: ''
        });
      }

      if (args[0] === 'audit') {
        return Object.freeze({
          status: 0,
          signal: null,
          stdout: JSON.stringify({
            metadata: {
              vulnerabilities: {
                info: 0,
                low: 0,
                moderate: 0,
                high: 0,
                critical: 0,
                total: 0
              }
            }
          }),
          stderr: ''
        });
      }

      throw new Error('unexpected command ' + command + ' ' + args.join(' '));
    }
  });

  assert.equal(report.vulnerabilities.total, 0);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].args[0], 'install');
  assert.equal(calls[1].args[0], 'audit');
  assert.equal(calls[1].options.timeoutMs, 120_000);
});

test('refresh receipt builder produces digest-bound live evidence without performing network I/O itself', () => {
  const document = refreshTool.buildReceipt({
    repositoryRoot: REPO_ROOT,
    capturedAt: '2026-09-04T06:00:00.000Z',
    workflowRunId: 123,
    runAttempt: 1,
    headSha: '1'.repeat(40),
    observation: {
      vulnerabilities: {
        info: 0,
        low: 0,
        moderate: 0,
        high: 0,
        critical: 0,
        total: 0
      }
    }
  });

  assert.equal(
    document.receiptDigestSha256,
    vulnerabilityVerifier.computeReceiptDigest(document)
  );

  assert.equal(
    vulnerabilityVerifier.verifyEvidence({
      repositoryRoot: REPO_ROOT,
      document,
      nowMs: Date.parse('2026-09-04T06:01:00.000Z')
    }).ok,
    true
  );
});

test('refresh workflow is manual-only and cannot mutate repository history', () => {
  const source = fs.readFileSync(
    path.join(
      REPO_ROOT,
      '.github/workflows/wp-b-xstate-vulnerability-refresh.yml'
    ),
    'utf8'
  );

  assert.match(source, /\bworkflow_dispatch:/u);
  assert.equal(/\bpull_request:/u.test(source), false);
  assert.equal(/^\s*push:/mu.test(source), false);
  assert.match(source, /permissions:\s*\n\s*contents:\s*read/u);
  assert.match(
    source,
    /refresh-wp-b-xstate-vulnerability-evidence\.js/u
  );
  assert.match(source, /actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02/u);
  assert.equal(/\bgit\s+push\b/u.test(source), false);
});

test('candidate WP-B workflow consumes sealed evidence and never invokes live vulnerability refresh', () => {
  const source = fs.readFileSync(
    path.join(REPO_ROOT, '.github/workflows/wp-b-validation.yml'),
    'utf8'
  );

  assert.match(
    source,
    /WP_B_VULNERABILITY_EVIDENCE_PATH:\s*governance\/architecture-closure-v2\/wp-b-xstate-vulnerability-evidence\.json/u
  );
  assert.match(
    source,
    /node tools\/architecture-closure-v2\/verify-wp-b-xstate-upstream\.js/u
  );
  assert.equal(
    /run:\s*node tools\/architecture-closure-v2\/refresh-wp-b-xstate-vulnerability-evidence\.js/u.test(source),
    false
  );
});
