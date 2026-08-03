#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const PACKAGE_NAME = 'xstate';
const EXACT_VERSION = '5.32.5';
const PACKAGE_SPEC = `${PACKAGE_NAME}@${EXACT_VERSION}`;
const EXPECTED_LICENSE = 'MIT';
const EXPECTED_RUNTIME_DEPENDENCY_COUNT = 0;
const INSTALL_LIFECYCLE_SCRIPTS = Object.freeze(['preinstall', 'install', 'postinstall']);
const SUSPICIOUS_PACKAGE_FILE_PATTERN = /(?:^|\/)(?:[^/]+\.(?:node|dll|exe|ps1|bat|cmd)|install\.sh)$/iu;

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
  if (!options.allowFailure && result.status !== 0) {
    const error = new Error(`${command} ${args.join(' ')} exited with ${result.status}`);
    error.code = 'WP_B_UPSTREAM_COMMAND_FAILED';
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

function parseJsonOutput(result, label) {
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    const wrapped = new Error(`${label} did not return valid JSON: ${error.message}`);
    wrapped.code = 'WP_B_UPSTREAM_JSON_INVALID';
    wrapped.stdout = result.stdout;
    wrapped.stderr = result.stderr;
    throw wrapped;
  }
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function sha512Base64(value) {
  return crypto.createHash('sha512').update(value).digest('base64');
}

function sha1(value) {
  return crypto.createHash('sha1').update(value).digest('hex');
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      accept: 'text/plain, application/json',
      'user-agent': 'yance-wp-b-open-source-gate'
    },
    redirect: 'follow'
  });
  if (!response.ok) {
    const error = new Error(`GET ${url} returned ${response.status}`);
    error.code = 'WP_B_UPSTREAM_FETCH_FAILED';
    throw error;
  }
  return response.text();
}

function normalizeRepository(repository) {
  if (typeof repository === 'string') return repository;
  if (repository && typeof repository.url === 'string') return repository.url;
  return '';
}

function auditCounts(audit) {
  const vulnerabilities = audit && audit.metadata && audit.metadata.vulnerabilities
    ? audit.metadata.vulnerabilities
    : {};
  return Object.freeze({
    info: Number(vulnerabilities.info || 0),
    low: Number(vulnerabilities.low || 0),
    moderate: Number(vulnerabilities.moderate || 0),
    high: Number(vulnerabilities.high || 0),
    critical: Number(vulnerabilities.critical || 0),
    total: Number(vulnerabilities.total || 0)
  });
}

async function verify() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-wp-b-xstate-'));
  const violations = [];
  try {
    const metadata = parseJsonOutput(
      run(npmCommand(), ['view', PACKAGE_SPEC, '--json']),
      'npm view'
    );

    const dependencies = metadata.dependencies && typeof metadata.dependencies === 'object'
      ? metadata.dependencies
      : {};
    const scripts = metadata.scripts && typeof metadata.scripts === 'object'
      ? metadata.scripts
      : {};
    const installLifecycleScripts = INSTALL_LIFECYCLE_SCRIPTS.filter(name => typeof scripts[name] === 'string' && scripts[name].trim());

    if (metadata.name !== PACKAGE_NAME) violations.push({ code: 'WP_B_XSTATE_PACKAGE_NAME_MISMATCH', actual: metadata.name || '' });
    if (metadata.version !== EXACT_VERSION) violations.push({ code: 'WP_B_XSTATE_VERSION_MISMATCH', actual: metadata.version || '' });
    if (metadata.license !== EXPECTED_LICENSE) violations.push({ code: 'WP_B_XSTATE_LICENSE_MISMATCH', actual: metadata.license || '' });
    if (Object.keys(dependencies).length !== EXPECTED_RUNTIME_DEPENDENCY_COUNT) {
      violations.push({ code: 'WP_B_XSTATE_RUNTIME_DEPENDENCIES_PRESENT', dependencies });
    }
    if (installLifecycleScripts.length !== 0) {
      violations.push({ code: 'WP_B_XSTATE_INSTALL_LIFECYCLE_SCRIPTS_PRESENT', installLifecycleScripts });
    }
    if (!metadata.dist || typeof metadata.dist.integrity !== 'string' || typeof metadata.dist.shasum !== 'string') {
      violations.push({ code: 'WP_B_XSTATE_DIST_DIGEST_MISSING' });
    }
    if (!/^[0-9a-f]{40}$/iu.test(String(metadata.gitHead || ''))) {
      violations.push({ code: 'WP_B_XSTATE_GIT_HEAD_MISSING', actual: metadata.gitHead || '' });
    }

    const packResult = parseJsonOutput(
      run(npmCommand(), ['pack', PACKAGE_SPEC, '--json', '--ignore-scripts'], { cwd: tempRoot }),
      'npm pack'
    );
    const packed = Array.isArray(packResult) ? packResult[0] : null;
    if (!packed || !packed.filename) violations.push({ code: 'WP_B_XSTATE_PACK_RESULT_INVALID' });

    let tarballSha512 = '';
    let tarballSha1 = '';
    let packageFileCount = 0;
    let suspiciousPackageFiles = [];
    if (packed && packed.filename) {
      const tarball = fs.readFileSync(path.join(tempRoot, packed.filename));
      tarballSha512 = `sha512-${sha512Base64(tarball)}`;
      tarballSha1 = sha1(tarball);
      packageFileCount = Array.isArray(packed.files) ? packed.files.length : 0;
      suspiciousPackageFiles = (packed.files || [])
        .map(file => String(file.path || ''))
        .filter(filePath => SUSPICIOUS_PACKAGE_FILE_PATTERN.test(filePath));
      if (tarballSha512 !== metadata.dist.integrity) {
        violations.push({ code: 'WP_B_XSTATE_TARBALL_INTEGRITY_MISMATCH', expected: metadata.dist.integrity, actual: tarballSha512 });
      }
      if (tarballSha1 !== metadata.dist.shasum) {
        violations.push({ code: 'WP_B_XSTATE_TARBALL_SHASUM_MISMATCH', expected: metadata.dist.shasum, actual: tarballSha1 });
      }
      if (suspiciousPackageFiles.length !== 0) {
        violations.push({ code: 'WP_B_XSTATE_SUSPICIOUS_PACKAGE_FILES_PRESENT', suspiciousPackageFiles });
      }
    }

    const auditRoot = path.join(tempRoot, 'audit');
    fs.mkdirSync(auditRoot, { recursive: true });
    fs.writeFileSync(path.join(auditRoot, 'package.json'), `${JSON.stringify({
      name: 'yance-wp-b-xstate-audit-sandbox',
      version: '1.0.0',
      private: true
    }, null, 2)}\n`);
    run(npmCommand(), [
      'install',
      '--package-lock-only',
      '--ignore-scripts',
      '--save-exact',
      '--no-fund',
      '--no-audit',
      PACKAGE_SPEC
    ], { cwd: auditRoot });
    const auditResult = run(npmCommand(), ['audit', '--omit=dev', '--json'], { cwd: auditRoot, allowFailure: true });
    const audit = parseJsonOutput(auditResult, 'npm audit');
    const vulnerabilities = auditCounts(audit);
    if (vulnerabilities.high !== 0 || vulnerabilities.critical !== 0) {
      violations.push({ code: 'WP_B_XSTATE_HIGH_OR_CRITICAL_VULNERABILITY', vulnerabilities });
    }

    let licenseText = '';
    if (/^[0-9a-f]{40}$/iu.test(String(metadata.gitHead || ''))) {
      licenseText = await fetchText(`https://raw.githubusercontent.com/statelyai/xstate/${metadata.gitHead}/LICENSE`);
      if (!/MIT License/iu.test(licenseText)) {
        violations.push({ code: 'WP_B_XSTATE_LICENSE_TEXT_INVALID' });
      }
    }

    const lock = JSON.parse(fs.readFileSync(path.join(auditRoot, 'package-lock.json'), 'utf8'));
    const lockEntry = lock.packages && lock.packages['node_modules/xstate'];
    if (!lockEntry || lockEntry.version !== EXACT_VERSION) {
      violations.push({ code: 'WP_B_XSTATE_SANDBOX_LOCK_INVALID', actual: lockEntry || null });
    }
    if (lockEntry && lockEntry.integrity !== metadata.dist.integrity) {
      violations.push({ code: 'WP_B_XSTATE_SANDBOX_LOCK_INTEGRITY_MISMATCH', expected: metadata.dist.integrity, actual: lockEntry.integrity || '' });
    }

    return Object.freeze({
      schemaVersion: 1,
      documentType: 'YANCE_ACV2_WP_B_XSTATE_UPSTREAM_VERIFICATION',
      ok: violations.length === 0,
      package: {
        name: metadata.name || '',
        version: metadata.version || '',
        license: metadata.license || '',
        repository: normalizeRepository(metadata.repository),
        gitHead: metadata.gitHead || '',
        runtimeDependencyCount: Object.keys(dependencies).length,
        runtimeDependencies: dependencies,
        installLifecycleScripts,
        distIntegrity: metadata.dist && metadata.dist.integrity ? metadata.dist.integrity : '',
        distShasum: metadata.dist && metadata.dist.shasum ? metadata.dist.shasum : '',
        tarballSha512,
        tarballSha1,
        packageFileCount,
        suspiciousPackageFiles,
        licenseTextSha256: licenseText ? sha256(licenseText) : '',
        sandboxLockEntry: lockEntry || null
      },
      security: {
        auditExitCode: auditResult.status,
        vulnerabilities
      },
      runtime: {
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        npmUserAgent: process.env.npm_config_user_agent || ''
      },
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
      stdout: error.stdout || '',
      stderr: error.stderr || ''
    }, null, 2)}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  EXACT_VERSION,
  PACKAGE_NAME,
  PACKAGE_SPEC,
  auditCounts,
  verify
};
