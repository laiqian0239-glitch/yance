#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const packageVerifier = require('./verify-wp-b-xstate-package');
const SUPPLY_CHAIN_LOCK = require('../../governance/architecture-closure-v2/wp-b-xstate-supply-chain-lock.json');

const UPSTREAM_TEST_SELECTION = Object.freeze(['XSTATE_PNPM_TEST_CORE']);
const UPSTREAM_TEST_COMMAND = 'corepack pnpm test:core';
const UPSTREAM_INSTALL_TIMEOUT_MS = 8 * 60 * 1000;
const UPSTREAM_TEST_TIMEOUT_MS = 8 * 60 * 1000;
const ANSI_ESCAPE_PATTERN = /\u001b\[[0-?]*[ -/]*[@-~]/gu;

function corepackCommand() {
  return process.platform === 'win32' ? 'corepack.cmd' : 'corepack';
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function readUpstreamManifest(checkoutRoot) {
  try {
    return JSON.parse(fs.readFileSync(path.join(checkoutRoot, 'package.json'), 'utf8'));
  } catch (_) {
    const error = new Error('The exact XState upstream checkout has no valid root package.json');
    error.code = 'WP_B_XSTATE_UPSTREAM_MANIFEST_INVALID';
    throw error;
  }
}

function metric(line, name) {
  const match = String(line || '').match(new RegExp(`(?:^|\\|\\s)(\\d+)\\s+${name}(?:\\s|\\||$)`, 'iu'));
  return match ? Number(match[1]) : 0;
}

function parseVitestSummary(output) {
  const clean = String(output || '').replace(ANSI_ESCAPE_PATTERN, '');
  const lines = clean.split(/\r?\n/u);
  const testFilesLine = lines.find(line => /Test Files/iu.test(line));
  const testsLine = lines.find(line => /^\s*Tests\s/iu.test(line));
  if (!testFilesLine || !testsLine) {
    const error = new Error('The XState test:core output does not contain a complete Vitest summary');
    error.code = 'WP_B_XSTATE_UPSTREAM_TEST_SUMMARY_MISSING';
    throw error;
  }

  const summary = Object.freeze({
    testFilePassCount: metric(testFilesLine, 'passed'),
    testFileFailCount: metric(testFilesLine, 'failed'),
    testPassCount: metric(testsLine, 'passed'),
    testFailCount: metric(testsLine, 'failed'),
    skipCount: metric(testsLine, 'skipped'),
    todoCount: metric(testsLine, 'todo')
  });
  if (summary.testFilePassCount <= 0 || summary.testPassCount <= 0) {
    const error = new Error('The XState test:core Vitest summary has no passing files or tests');
    error.code = 'WP_B_XSTATE_UPSTREAM_TEST_SUMMARY_INVALID';
    error.summary = summary;
    throw error;
  }
  return summary;
}

function runUpstreamCoreTests(options = {}) {
  const checkoutRoot = path.resolve(options.checkoutRoot || '');
  const commitSha = String(options.commitSha || '').toLowerCase();
  const runCommand = options.runCommand || packageVerifier.runGovernedCommand;
  const expectedCommit = String(SUPPLY_CHAIN_LOCK.artifact.upstreamCommit || '').toLowerCase();
  if (!checkoutRoot || !fs.existsSync(checkoutRoot)) {
    const error = new Error('The exact XState upstream checkout is required');
    error.code = 'WP_B_XSTATE_UPSTREAM_CHECKOUT_MISSING';
    throw error;
  }
  if (commitSha !== expectedCommit) {
    const error = new Error('The checked-out XState commit does not match the supply-chain authority');
    error.code = 'WP_B_XSTATE_UPSTREAM_COMMIT_MISMATCH';
    error.expectedCommit = expectedCommit;
    error.actualCommit = commitSha;
    throw error;
  }

  const manifest = readUpstreamManifest(checkoutRoot);
  if (manifest?.scripts?.['test:core'] !== 'vitest run --project xstate') {
    const error = new Error('The exact XState source does not expose the reviewed test:core command');
    error.code = 'WP_B_XSTATE_UPSTREAM_CORE_SCRIPT_INVALID';
    throw error;
  }
  if (!/^pnpm@9\.15\.9(?:\+|$)/u.test(String(manifest.packageManager || ''))) {
    const error = new Error('The exact XState source does not bind the reviewed pnpm 9.15.9 toolchain');
    error.code = 'WP_B_XSTATE_UPSTREAM_PACKAGE_MANAGER_INVALID';
    throw error;
  }

  const install = runCommand(corepackCommand(), ['pnpm', 'install', '--frozen-lockfile'], {
    cwd: checkoutRoot,
    commandKind: 'XSTATE_PNPM_INSTALL',
    timeoutMs: UPSTREAM_INSTALL_TIMEOUT_MS
  });
  const coreTest = runCommand(corepackCommand(), ['pnpm', 'test:core'], {
    cwd: checkoutRoot,
    commandKind: 'XSTATE_PNPM_TEST_CORE',
    timeoutMs: UPSTREAM_TEST_TIMEOUT_MS
  });
  const testSummary = parseVitestSummary(`${coreTest.stdout}\n${coreTest.stderr}`);
  if (testSummary.testFileFailCount !== 0 || testSummary.testFailCount !== 0) {
    const error = new Error('The XState test:core summary contains failed files or tests');
    error.code = 'WP_B_XSTATE_UPSTREAM_CORE_TEST_FAILED';
    error.summary = testSummary;
    throw error;
  }
  const testLogSha256 = sha256(JSON.stringify({
    upstreamCommit: commitSha,
    command: UPSTREAM_TEST_COMMAND,
    stdout: coreTest.stdout,
    stderr: coreTest.stderr
  }));

  return Object.freeze({
    upstreamTestSelection: [...UPSTREAM_TEST_SELECTION],
    upstreamTestCommand: UPSTREAM_TEST_COMMAND,
    runtimeVersion: 'node@22',
    packageManager: manifest.packageManager,
    upstreamCommit: commitSha,
    installLogSha256: sha256(JSON.stringify({ stdout: install.stdout, stderr: install.stderr })),
    passCount: 1,
    failCount: 0,
    skipCount: 0,
    testSummary,
    testLogSha256,
    results: [Object.freeze({
      name: 'XSTATE_PNPM_TEST_CORE',
      status: 'PASS',
      command: UPSTREAM_TEST_COMMAND,
      testSummary,
      testLogSha256
    })]
  });
}

function validatePhysicalArtifactAuthority(packageReport) {
  const expected = SUPPLY_CHAIN_LOCK.artifact;
  const actual = packageReport.package || {};
  const actualAudit = packageReport.security?.vulnerabilities || {};
  const reasons = [];
  if (actual.name !== expected.packageName) reasons.push('PACKAGE_NAME');
  if (actual.version !== expected.version) reasons.push('VERSION');
  if (actual.license !== expected.license) reasons.push('LICENSE');
  if (actual.upstreamTag !== expected.upstreamTag) reasons.push('UPSTREAM_TAG');
  if (actual.upstreamCommit !== expected.upstreamCommit) reasons.push('UPSTREAM_COMMIT');
  if (actual.distIntegrity !== expected.integrity) reasons.push('DIST_INTEGRITY');
  if (actual.distShasum !== expected.shasum) reasons.push('DIST_SHASUM');
  if (actual.tarballSha512 !== expected.integrity) reasons.push('TARBALL_INTEGRITY');
  if (actual.tarballSha1 !== expected.shasum) reasons.push('TARBALL_SHASUM');
  if (actual.licenseTextSha256 !== expected.licenseTextSha256) reasons.push('LICENSE_TEXT_SHA256');
  if (Number(actual.packageFileCount) !== Number(expected.packageFileCount)) reasons.push('PACKAGE_FILE_COUNT');
  if (Number(actual.runtimeDependencyCount) !== Number(expected.runtimeDependencyCount)) reasons.push('RUNTIME_DEPENDENCY_COUNT');
  if (JSON.stringify(actual.installLifecycleScripts || []) !== JSON.stringify(expected.installLifecycleScripts || [])) {
    reasons.push('INSTALL_LIFECYCLE_SCRIPTS');
  }
  if (JSON.stringify(actual.suspiciousPackageFiles || []) !== JSON.stringify(expected.suspiciousPackageFiles || [])) {
    reasons.push('SUSPICIOUS_PACKAGE_FILES');
  }
  for (const severity of ['info', 'low', 'moderate', 'high', 'critical', 'total']) {
    if (Number(actualAudit[severity] || 0) !== Number(expected.npmAudit[severity] || 0)) reasons.push(`AUDIT_${severity.toUpperCase()}`);
  }
  const sandbox = actual.sandboxLockEntry || {};
  if (sandbox.version !== expected.version
      || sandbox.resolved !== expected.resolved
      || sandbox.integrity !== expected.integrity
      || sandbox.license !== expected.license) {
    reasons.push('SANDBOX_LOCK_ENTRY');
  }
  return reasons;
}

async function verify() {
  const tempRoot = packageVerifier.createGovernedScratchDirectory({
    prefix: 'yance-wp-b-xstate-upstream-'
  });
  try {
    const upstreamCheckout = packageVerifier.checkoutExactUpstreamTag({
      checkoutRoot: path.join(tempRoot, 'xstate')
    });
    const packageReport = await packageVerifier.verify({ upstreamCheckout });
    const violations = [...packageReport.violations];
    const authorityReasons = validatePhysicalArtifactAuthority(packageReport);
    if (authorityReasons.length !== 0) {
      violations.push({
        code: 'WP_B_XSTATE_PHYSICAL_ARTIFACT_AUTHORITY_MISMATCH',
        reasons: authorityReasons
      });
    }

    let upstreamTests = null;
    try {
      upstreamTests = runUpstreamCoreTests({
        checkoutRoot: upstreamCheckout.root,
        commitSha: upstreamCheckout.commitSha
      });
      if (upstreamTests.failCount !== 0 || upstreamTests.skipCount !== 0
          || upstreamTests.passCount !== UPSTREAM_TEST_SELECTION.length) {
        violations.push({
          code: 'WP_B_XSTATE_UPSTREAM_CORE_TEST_FAILED',
          passCount: upstreamTests.passCount,
          failCount: upstreamTests.failCount,
          skipCount: upstreamTests.skipCount,
          results: upstreamTests.results
        });
      }
    } catch (error) {
      violations.push({
        code: error.code || 'WP_B_XSTATE_UPSTREAM_CORE_TEST_FAILED',
        message: error.message,
        summary: error.summary || null,
        commandKind: error.commandKind || '',
        timeoutMs: error.timeoutMs || 0,
        status: error.status === undefined ? null : error.status,
        signal: error.signal || null,
        stdout: error.stdout || '',
        stderr: error.stderr || ''
      });
    }

    return Object.freeze({
      ...packageReport,
      schemaVersion: 6,
      ok: violations.length === 0,
      supplyChainAuthorityPath: 'governance/architecture-closure-v2/wp-b-xstate-supply-chain-lock.json',
      upstreamTests,
      violations
    });
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

async function main() {
  try {
    const report = await verify();
    const serialized = `${JSON.stringify(report, null, 2)}\n`;
    if (process.env.WP_B_EVIDENCE_PATH) {
      fs.mkdirSync(path.dirname(process.env.WP_B_EVIDENCE_PATH), { recursive: true });
      fs.writeFileSync(process.env.WP_B_EVIDENCE_PATH, serialized);
    }
    process.stdout.write(serialized);
    if (!report.ok) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      schemaVersion: 1,
      documentType: 'YANCE_ACV2_WP_B_XSTATE_UPSTREAM_VERIFICATION_FAILURE',
      ok: false,
      code: error.code || 'WP_B_XSTATE_UPSTREAM_VERIFICATION_FAILED',
      message: error.message,
      commandKind: error.commandKind || '',
      timeoutMs: error.timeoutMs || 0,
      status: error.status === undefined ? null : error.status,
      signal: error.signal || null,
      stdout: error.stdout || '',
      stderr: error.stderr || ''
    }, null, 2)}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  ...packageVerifier,
  SUPPLY_CHAIN_LOCK,
  UPSTREAM_INSTALL_TIMEOUT_MS,
  UPSTREAM_TEST_COMMAND,
  UPSTREAM_TEST_SELECTION,
  UPSTREAM_TEST_TIMEOUT_MS,
  parseVitestSummary,
  runUpstreamConformance: runUpstreamCoreTests,
  runUpstreamCoreTests,
  validatePhysicalArtifactAuthority,
  verify
};
