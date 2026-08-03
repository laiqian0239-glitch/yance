#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');
const { spawnSync } = require('node:child_process');
const packageVerifier = require('./verify-wp-b-xstate-package');
const SUPPLY_CHAIN_LOCK = require('../../governance/architecture-closure-v2/wp-b-xstate-supply-chain-lock.json');

const UPSTREAM_TEST_SELECTION = Object.freeze([
  'PACKAGE_EXPORTS_PRESENT',
  'INITIAL_SNAPSHOT',
  'UNHANDLED_EVENT_STABILITY',
  'ACTOR_TRANSITION_SEQUENCE',
  'FINAL_STATE_STATUS'
]);

function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      npm_config_fund: 'false',
      npm_config_audit: 'false',
      npm_config_update_notifier: 'false'
    },
    maxBuffer: 32 * 1024 * 1024,
    shell: process.platform === 'win32'
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const error = new Error(`${command} ${args.join(' ')} exited with ${result.status}`);
    error.code = 'WP_B_XSTATE_CONFORMANCE_COMMAND_FAILED';
    error.stdout = result.stdout;
    error.stderr = result.stderr;
    throw error;
  }
  return Object.freeze({
    status: result.status,
    stdout: String(result.stdout || ''),
    stderr: String(result.stderr || '')
  });
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function machineDefinition(createMachine) {
  return createMachine({
    id: 'yance-wp-b-xstate-conformance',
    initial: 'idle',
    states: {
      idle: { on: { START: 'running' } },
      running: { on: { SUCCEED: 'done' } },
      done: { type: 'final' }
    }
  });
}

function executeCase(results, name, assertion) {
  try {
    assertion();
    results.push(Object.freeze({ name, status: 'PASS', message: '' }));
  } catch (error) {
    results.push(Object.freeze({
      name,
      status: 'FAIL',
      message: String(error && error.message ? error.message : error)
    }));
  }
}

function runUpstreamConformance() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-wp-b-xstate-conformance-'));
  try {
    fs.writeFileSync(path.join(tempRoot, 'package.json'), `${JSON.stringify({
      name: 'yance-wp-b-xstate-conformance',
      version: '1.0.0',
      private: true
    }, null, 2)}\n`);
    run(npmCommand(), [
      'install',
      '--ignore-scripts',
      '--save-exact',
      '--no-fund',
      '--no-audit',
      packageVerifier.PACKAGE_SPEC
    ], { cwd: tempRoot });

    const requireFromSandbox = createRequire(path.join(tempRoot, 'package.json'));
    const xstate = requireFromSandbox('xstate');
    const results = [];

    executeCase(results, 'PACKAGE_EXPORTS_PRESENT', () => {
      assert.equal(typeof xstate.createMachine, 'function');
      assert.equal(typeof xstate.createActor, 'function');
    });
    executeCase(results, 'INITIAL_SNAPSHOT', () => {
      const actor = xstate.createActor(machineDefinition(xstate.createMachine));
      actor.start();
      const snapshot = actor.getSnapshot();
      assert.equal(snapshot.value, 'idle');
      assert.equal(snapshot.status, 'active');
      actor.stop();
    });
    executeCase(results, 'UNHANDLED_EVENT_STABILITY', () => {
      const actor = xstate.createActor(machineDefinition(xstate.createMachine));
      actor.start();
      actor.send({ type: 'UNKNOWN' });
      const snapshot = actor.getSnapshot();
      assert.equal(snapshot.value, 'idle');
      assert.equal(snapshot.status, 'active');
      actor.stop();
    });
    executeCase(results, 'ACTOR_TRANSITION_SEQUENCE', () => {
      const actor = xstate.createActor(machineDefinition(xstate.createMachine));
      actor.start();
      actor.send({ type: 'START' });
      assert.equal(actor.getSnapshot().value, 'running');
      actor.send({ type: 'SUCCEED' });
      assert.equal(actor.getSnapshot().value, 'done');
      actor.stop();
    });
    executeCase(results, 'FINAL_STATE_STATUS', () => {
      const actor = xstate.createActor(machineDefinition(xstate.createMachine));
      actor.start();
      actor.send({ type: 'START' });
      actor.send({ type: 'SUCCEED' });
      const snapshot = actor.getSnapshot();
      assert.equal(snapshot.value, 'done');
      assert.equal(snapshot.status, 'done');
      actor.stop();
    });

    const passCount = results.filter(result => result.status === 'PASS').length;
    const failCount = results.filter(result => result.status === 'FAIL').length;
    const skipCount = 0;
    return Object.freeze({
      upstreamTestSelection: [...UPSTREAM_TEST_SELECTION],
      upstreamTestCommand: 'node tools/architecture-closure-v2/verify-wp-b-xstate-upstream.js',
      runtimeVersion: 'node@22',
      passCount,
      failCount,
      skipCount,
      testLogSha256: sha256(JSON.stringify(results)),
      results
    });
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
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
  const packageReport = await packageVerifier.verify();
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
    upstreamTests = runUpstreamConformance();
    if (upstreamTests.failCount !== 0 || upstreamTests.skipCount !== 0
        || upstreamTests.passCount !== UPSTREAM_TEST_SELECTION.length) {
      violations.push({
        code: 'WP_B_XSTATE_UPSTREAM_CONFORMANCE_FAILED',
        passCount: upstreamTests.passCount,
        failCount: upstreamTests.failCount,
        skipCount: upstreamTests.skipCount,
        results: upstreamTests.results
      });
    }
  } catch (error) {
    violations.push({
      code: error.code || 'WP_B_XSTATE_UPSTREAM_CONFORMANCE_FAILED',
      message: error.message,
      stdout: error.stdout || '',
      stderr: error.stderr || ''
    });
  }

  return Object.freeze({
    ...packageReport,
    schemaVersion: 4,
    ok: violations.length === 0,
    supplyChainAuthorityPath: 'governance/architecture-closure-v2/wp-b-xstate-supply-chain-lock.json',
    upstreamTests,
    violations
  });
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
  UPSTREAM_TEST_SELECTION,
  runUpstreamConformance,
  validatePhysicalArtifactAuthority,
  verify
};
