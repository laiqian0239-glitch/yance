'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { verifyRegistry } = require('../../../../tools/architecture-closure-v2/verify-wp-b-open-source-adoption');

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const XSTATE_VERSION = '5.32.5';
const XSTATE_INTEGRITY = 'sha512-631+ENa9BCjf/Rn/aWthqY8CWnHT6LHAANtB9zTHb9Tz6SgoI8NA+IWjG3qfIcnEubyksdYGhWCOle4eA/pP4A==';

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
    selection: ['ACTOR_TRANSITION_SEQUENCE'],
    command: 'node tools/architecture-closure-v2/verify-wp-b-xstate-upstream.js',
    passCount: 1,
    failCount: 1,
    skipCount: 1,
    platforms: {
      ubuntu: {
        status: 'FAILED',
        reviewedHead: 'not-a-head',
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
