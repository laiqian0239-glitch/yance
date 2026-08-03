#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const core = require('./verify-wp-b-open-source-adoption-core');

const EXPECTED_UPSTREAM_TEST_SELECTION = Object.freeze([
  'PACKAGE_EXPORTS_PRESENT',
  'INITIAL_SNAPSHOT',
  'UNHANDLED_EVENT_STABILITY',
  'ACTOR_TRANSITION_SEQUENCE',
  'FINAL_STATE_STATUS'
]);
const EXPECTED_UPSTREAM_TEST_COMMAND = 'node tools/architecture-closure-v2/verify-wp-b-xstate-upstream.js';
const EXPECTED_RUNTIME_VERSION = 'node@22';
const HEAD_PATTERN = /^[0-9a-f]{40}$/u;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;

function readJson(root, relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
}

function validateUpstreamTestEvidence(candidate) {
  const evidence = candidate && candidate.upstreamTestEvidence;
  const reasons = [];
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    return ['EVIDENCE_MISSING'];
  }

  if (JSON.stringify(evidence.upstreamTestSelection || []) !== JSON.stringify(EXPECTED_UPSTREAM_TEST_SELECTION)) {
    reasons.push('SELECTION_INVALID');
  }
  if (evidence.upstreamTestCommand !== EXPECTED_UPSTREAM_TEST_COMMAND) reasons.push('COMMAND_INVALID');
  if (evidence.runtimeVersion !== EXPECTED_RUNTIME_VERSION) reasons.push('RUNTIME_VERSION_INVALID');
  if (Number(evidence.passCount) !== EXPECTED_UPSTREAM_TEST_SELECTION.length) reasons.push('PASS_COUNT_INVALID');
  if (Number(evidence.failCount) !== 0) reasons.push('FAIL_COUNT_NONZERO');
  if (Number(evidence.skipCount) !== 0) reasons.push('SKIP_COUNT_NONZERO');
  if (!HEAD_PATTERN.test(String(evidence.reviewedHead || ''))) reasons.push('REVIEWED_HEAD_INVALID');

  for (const platformName of ['ubuntu', 'windows']) {
    const platform = evidence.platforms && evidence.platforms[platformName];
    if (!platform || typeof platform !== 'object' || Array.isArray(platform)) {
      reasons.push(`${platformName.toUpperCase()}_EVIDENCE_MISSING`);
      continue;
    }
    if (platform.status !== 'PASSED') reasons.push(`${platformName.toUpperCase()}_STATUS_INVALID`);
    if (platform.reviewedHead !== evidence.reviewedHead || !HEAD_PATTERN.test(String(platform.reviewedHead || ''))) {
      reasons.push(`${platformName.toUpperCase()}_HEAD_INVALID`);
    }
    if (!Number.isInteger(platform.workflowRunId) || platform.workflowRunId <= 0) {
      reasons.push(`${platformName.toUpperCase()}_RUN_ID_INVALID`);
    }
    if (!Number.isInteger(platform.jobId) || platform.jobId <= 0) {
      reasons.push(`${platformName.toUpperCase()}_JOB_ID_INVALID`);
    }
    if (!SHA256_PATTERN.test(String(platform.testLogSha256 || ''))) {
      reasons.push(`${platformName.toUpperCase()}_LOG_DIGEST_INVALID`);
    }
  }

  return reasons;
}

function verifyRegistry(options) {
  const base = core.verifyRegistry(options);
  const violations = [...base.violations];
  const xstate = base.candidates && base.candidates.xstate;
  if (xstate && xstate.gateSteps && xstate.gateSteps.UPSTREAM_TESTS_PASS === 'COMPLETE') {
    const reasons = validateUpstreamTestEvidence(xstate);
    if (reasons.length !== 0) {
      violations.push({
        code: 'WP_B_XSTATE_UPSTREAM_TEST_EVIDENCE_INVALID',
        reasons
      });
    }
  }

  return Object.freeze({
    ...base,
    ok: violations.length === 0,
    productionUseAuthorized: base.productionUseAuthorized && violations.length === 0,
    violations
  });
}

function verifyFiles(repositoryRoot = path.resolve(__dirname, '..', '..')) {
  return verifyRegistry({
    gate: readJson(repositoryRoot, core.GATE_PATH),
    registry: readJson(repositoryRoot, core.REGISTRY_PATH),
    baseline: readJson(repositoryRoot, core.BASELINE_PATH),
    authorization: readJson(repositoryRoot, core.AUTHORIZATION_PATH),
    repositoryRoot
  });
}

if (require.main === module) {
  try {
    const report = verifyFiles();
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.ok) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      schemaVersion: 1,
      documentType: 'YANCE_ACV2_WP_B_OPEN_SOURCE_ADOPTION_VERIFICATION_FAILURE',
      ok: false,
      code: error.code || 'WP_B_OPEN_SOURCE_VERIFICATION_FAILED',
      message: error.message
    }, null, 2)}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  ...core,
  EXPECTED_RUNTIME_VERSION,
  EXPECTED_UPSTREAM_TEST_COMMAND,
  EXPECTED_UPSTREAM_TEST_SELECTION,
  validateUpstreamTestEvidence,
  verifyFiles,
  verifyRegistry
};
