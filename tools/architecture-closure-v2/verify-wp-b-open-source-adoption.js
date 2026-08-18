#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const core = require('./verify-wp-b-open-source-adoption-core');

const EVIDENCE_PATH = 'governance/architecture-closure-v2/wp-b-open-source-adoption-evidence-xstate-5.32.5.json';
const EXPECTED_UPSTREAM_TEST_SELECTION = Object.freeze(['XSTATE_PNPM_TEST_CORE']);
const EXPECTED_UPSTREAM_TEST_COMMAND = 'corepack pnpm test:core';
const EXPECTED_RUNTIME_VERSION = 'node@22';
const EXPECTED_PACKAGE_MANAGER_PATTERN = /^pnpm@9\.15\.9(?:\+|$)/u;
const HEAD_PATTERN = /^[0-9a-f]{40}$/u;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;

function readJson(root, relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function gitBlobSha(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return crypto.createHash('sha1').update(Buffer.concat([
    Buffer.from(`blob ${buffer.length}\0`),
    buffer
  ])).digest('hex');
}

function validateTestSummary(summary, prefix, reasons) {
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) {
    reasons.push(`${prefix}_TEST_SUMMARY_MISSING`);
    return;
  }
  const positive = ['testFilePassCount', 'testPassCount'];
  const zero = ['testFileFailCount', 'testFailCount'];
  const nonNegative = ['skipCount', 'todoCount'];
  for (const field of positive) {
    if (!Number.isInteger(summary[field]) || summary[field] <= 0) reasons.push(`${prefix}_${field.toUpperCase()}_INVALID`);
  }
  for (const field of zero) {
    if (summary[field] !== 0) reasons.push(`${prefix}_${field.toUpperCase()}_NONZERO`);
  }
  for (const field of nonNegative) {
    if (!Number.isInteger(summary[field]) || summary[field] < 0) reasons.push(`${prefix}_${field.toUpperCase()}_INVALID`);
  }
}

function validateUpstreamTestEvidence(candidate) {
  const evidence = candidate && candidate.upstreamTestEvidence;
  const reasons = [];
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return ['EVIDENCE_MISSING'];

  if (JSON.stringify(evidence.upstreamTestSelection || []) !== JSON.stringify(EXPECTED_UPSTREAM_TEST_SELECTION)) {
    reasons.push('SELECTION_INVALID');
  }
  if (evidence.upstreamTestCommand !== EXPECTED_UPSTREAM_TEST_COMMAND) reasons.push('COMMAND_INVALID');
  if (evidence.runtimeVersion !== EXPECTED_RUNTIME_VERSION) reasons.push('RUNTIME_VERSION_INVALID');
  if (!EXPECTED_PACKAGE_MANAGER_PATTERN.test(String(evidence.packageManager || ''))) reasons.push('PACKAGE_MANAGER_INVALID');
  if (evidence.upstreamCommit !== core.SUPPLY_CHAIN_LOCK.artifact.upstreamCommit) reasons.push('UPSTREAM_COMMIT_INVALID');
  if (Number(evidence.passCount) !== EXPECTED_UPSTREAM_TEST_SELECTION.length) reasons.push('PASS_COUNT_INVALID');
  if (Number(evidence.failCount) !== 0) reasons.push('FAIL_COUNT_NONZERO');
  if (Number(evidence.skipCount) !== 0) reasons.push('SKIP_COUNT_NONZERO');
  if (!HEAD_PATTERN.test(String(evidence.reviewedHead || ''))) reasons.push('REVIEWED_HEAD_INVALID');

  const platformSummaries = [];
  for (const platformName of ['ubuntu', 'windows']) {
    const prefix = platformName.toUpperCase();
    const platform = evidence.platforms && evidence.platforms[platformName];
    if (!platform || typeof platform !== 'object' || Array.isArray(platform)) {
      reasons.push(`${prefix}_EVIDENCE_MISSING`);
      continue;
    }
    if (platform.status !== 'PASSED') reasons.push(`${prefix}_STATUS_INVALID`);
    if (platform.reviewedHead !== evidence.reviewedHead || !HEAD_PATTERN.test(String(platform.reviewedHead || ''))) {
      reasons.push(`${prefix}_HEAD_INVALID`);
    }
    if (!Number.isInteger(platform.workflowRunId) || platform.workflowRunId <= 0) reasons.push(`${prefix}_RUN_ID_INVALID`);
    if (!Number.isInteger(platform.jobId) || platform.jobId <= 0) reasons.push(`${prefix}_JOB_ID_INVALID`);
    if (!SHA256_PATTERN.test(String(platform.installLogSha256 || ''))) reasons.push(`${prefix}_INSTALL_LOG_DIGEST_INVALID`);
    if (!SHA256_PATTERN.test(String(platform.testLogSha256 || ''))) reasons.push(`${prefix}_LOG_DIGEST_INVALID`);
    validateTestSummary(platform.testSummary, prefix, reasons);
    if (platform.testSummary && typeof platform.testSummary === 'object' && !Array.isArray(platform.testSummary)) {
      platformSummaries.push(JSON.stringify(platform.testSummary));
    }
  }
  if (platformSummaries.length === 2 && platformSummaries[0] !== platformSummaries[1]) {
    reasons.push('CROSS_PLATFORM_TEST_SUMMARY_MISMATCH');
  }
  return reasons;
}

function compareArtifactBindings({ repositoryRoot, registry, evidence }) {
  const violations = [];
  const authority = core.SUPPLY_CHAIN_LOCK;
  const artifact = authority.artifact;
  const xstate = (registry.candidates || []).find(candidate => candidate.project === 'XState');
  const packageJson = readJson(repositoryRoot, 'package.json');
  const packageLock = readJson(repositoryRoot, 'package-lock.json');
  const lockEntry = packageLock?.packages?.['node_modules/xstate'];
  const lockBytes = fs.readFileSync(path.join(repositoryRoot, 'package-lock.json'));

  const expectedLockEntry = {
    version: artifact.version,
    resolved: artifact.resolved,
    integrity: artifact.integrity,
    license: artifact.license
  };
  if (packageJson?.dependencies?.xstate !== artifact.version
      || packageLock?.packages?.['']?.dependencies?.xstate !== artifact.version
      || JSON.stringify(lockEntry) !== JSON.stringify(expectedLockEntry)) {
    violations.push({ code: 'WP_B_XSTATE_PHYSICAL_LOCK_MISMATCH', actual: lockEntry || null, expected: expectedLockEntry });
  }
  if (gitBlobSha(lockBytes) !== authority.repositoryBinding.expectedPackageLockBlobSha
      || sha256(lockBytes) !== authority.repositoryBinding.expectedPackageLockSha256) {
    violations.push({
      code: 'WP_B_XSTATE_PACKAGE_LOCK_DIGEST_MISMATCH',
      actualBlobSha: gitBlobSha(lockBytes),
      expectedBlobSha: authority.repositoryBinding.expectedPackageLockBlobSha,
      actualSha256: sha256(lockBytes),
      expectedSha256: authority.repositoryBinding.expectedPackageLockSha256
    });
  }

  const registryFacts = xstate && xstate.verifiedPackageEvidence;
  if (!registryFacts
      || registryFacts.distIntegrity !== artifact.integrity
      || registryFacts.distShasum !== artifact.shasum
      || registryFacts.upstreamCommit !== artifact.upstreamCommit
      || registryFacts.licenseTextSha256 !== artifact.licenseTextSha256
      || Number(xstate.runtimeDependencyCount) !== Number(artifact.runtimeDependencyCount)) {
    violations.push({ code: 'WP_B_XSTATE_REGISTRY_SUPPLY_CHAIN_MISMATCH' });
  }

  if (evidence?.exactVersionAndLicenseReview?.exactVersion !== artifact.version
      || evidence?.exactVersionAndLicenseReview?.license !== artifact.license
      || evidence?.exactVersionAndLicenseReview?.upstreamCommit !== artifact.upstreamCommit
      || evidence?.exactVersionAndLicenseReview?.licenseTextSha256 !== artifact.licenseTextSha256
      || Number(evidence?.dependencyAndSecurityScan?.runtimeDependencyCount) !== Number(artifact.runtimeDependencyCount)
      || Number(evidence?.dependencyAndSecurityScan?.packageFileCount) !== Number(artifact.packageFileCount)
      || evidence?.dependencyAndSecurityScan?.distIntegrity !== artifact.integrity
      || evidence?.dependencyAndSecurityScan?.distShasum !== artifact.shasum
      || Number(evidence?.dependencyAndSecurityScan?.npmAudit?.total) !== Number(artifact.npmAudit.total)) {
    violations.push({ code: 'WP_B_XSTATE_EVIDENCE_SUPPLY_CHAIN_MISMATCH' });
  }

  if (authority.status !== 'LOCKED') violations.push({ code: 'WP_B_XSTATE_SUPPLY_CHAIN_NOT_LOCKED', status: authority.status });
  if (authority.governance.temporaryBypassAllowed !== false
      || authority.governance.productionUseAuthorized !== false) {
    violations.push({ code: 'WP_B_XSTATE_SUPPLY_CHAIN_RELEASE_GOVERNANCE_INVALID' });
  }
  return violations;
}

function verifyRegistry(options) {
  const base = core.verifyRegistry(options);
  const violations = [...base.violations];
  const xstate = base.candidates && base.candidates.xstate;
  if (xstate && xstate.gateSteps && xstate.gateSteps.UPSTREAM_TESTS_PASS === 'COMPLETE') {
    const reasons = validateUpstreamTestEvidence(xstate);
    if (reasons.length !== 0) violations.push({ code: 'WP_B_XSTATE_UPSTREAM_TEST_EVIDENCE_INVALID', reasons });
  }
  return Object.freeze({
    ...base,
    ok: violations.length === 0,
    productionUseAuthorized: base.productionUseAuthorized && violations.length === 0,
    violations
  });
}

function verifyFiles(repositoryRoot = path.resolve(__dirname, '..', '..')) {
  const registry = readJson(repositoryRoot, core.REGISTRY_PATH);
  const coreReport = core.verifyFiles(repositoryRoot);
  const violations = [...coreReport.violations];
  const xstate = coreReport.candidates && coreReport.candidates.xstate;
  if (xstate && xstate.gateSteps && xstate.gateSteps.UPSTREAM_TESTS_PASS === 'COMPLETE') {
    const reasons = validateUpstreamTestEvidence(xstate);
    if (reasons.length !== 0) violations.push({ code: 'WP_B_XSTATE_UPSTREAM_TEST_EVIDENCE_INVALID', reasons });
  }
  violations.push(...compareArtifactBindings({
    repositoryRoot,
    registry,
    evidence: readJson(repositoryRoot, EVIDENCE_PATH)
  }));
  return Object.freeze({
    ...coreReport,
    schemaVersion: 7,
    ok: violations.length === 0,
    productionUseAuthorized: coreReport.productionUseAuthorized && violations.length === 0,
    supplyChainAuthorityPath: core.SUPPLY_CHAIN_LOCK_PATH,
    violations: Object.freeze(violations.map(item => Object.freeze(item)))
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
  EVIDENCE_PATH,
  EXPECTED_RUNTIME_VERSION,
  EXPECTED_UPSTREAM_TEST_COMMAND,
  EXPECTED_UPSTREAM_TEST_SELECTION,
  compareArtifactBindings,
  validateTestSummary,
  validateUpstreamTestEvidence,
  verifyFiles,
  verifyRegistry
};
