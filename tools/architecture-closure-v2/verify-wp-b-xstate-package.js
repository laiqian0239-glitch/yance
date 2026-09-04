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
const UPSTREAM_REPOSITORY = 'statelyai/xstate';
const UPSTREAM_REPOSITORY_URL = `https://github.com/${UPSTREAM_REPOSITORY}.git`;
const EXACT_UPSTREAM_TAG = `xstate@${EXACT_VERSION}`;
const UPSTREAM_TAG_CANDIDATES = Object.freeze([EXACT_UPSTREAM_TAG]);
const INSTALL_LIFECYCLE_SCRIPTS = Object.freeze(['preinstall', 'install', 'postinstall']);
const SUSPICIOUS_PACKAGE_FILE_PATTERN = /(?:^|\/)(?:[^/]+\.(?:node|dll|exe|ps1|bat|cmd)|install\.sh)$/iu;
const MAX_DIAGNOSTIC_BYTES = 64 * 1024;
const NPM_AUDIT_MAX_ATTEMPTS = 2;
const NPM_AUDIT_FETCH_POLICY = Object.freeze({
  fetchTimeoutMs: 30_000,
  fetchRetries: 1,
  fetchRetryMinTimeoutMs: 1_000,
  fetchRetryMaxTimeoutMs: 5_000
});
const NPM_AUDIT_MAX_FETCH_CYCLE_MS = (NPM_AUDIT_FETCH_POLICY.fetchRetries + 1)
  * NPM_AUDIT_FETCH_POLICY.fetchTimeoutMs
  + NPM_AUDIT_FETCH_POLICY.fetchRetries * NPM_AUDIT_FETCH_POLICY.fetchRetryMaxTimeoutMs;
const NPM_AUDIT_ENV = Object.freeze({
  npm_config_fetch_timeout: String(NPM_AUDIT_FETCH_POLICY.fetchTimeoutMs),
  npm_config_fetch_retries: String(NPM_AUDIT_FETCH_POLICY.fetchRetries),
  npm_config_fetch_retry_mintimeout: String(NPM_AUDIT_FETCH_POLICY.fetchRetryMinTimeoutMs),
  npm_config_fetch_retry_maxtimeout: String(NPM_AUDIT_FETCH_POLICY.fetchRetryMaxTimeoutMs)
});
const NPM_AUDIT_RETRYABLE_NETWORK_TIMEOUT_MESSAGES = Object.freeze([
  'network timeout at: https://registry.npmjs.org/-/npm/v1/security/advisories/bulk',
  'network timeout at: https://registry.npmjs.org/-/npm/v1/security/audits/quick'
]);
const SCRATCH_CLEANUP_MAX_RETRIES = 5;
const SCRATCH_CLEANUP_RETRY_DELAY_MS = 100;
const COMMAND_TIMEOUTS = Object.freeze({
  GIT_INIT: 30_000,
  GIT_CONFIG: 30_000,
  GIT_REMOTE: 30_000,
  GIT_FETCH: 120_000,
  GIT_CHECKOUT: 60_000,
  GIT_REV_PARSE: 30_000,
  NPM_METADATA: 60_000,
  NPM_PACK: 120_000,
  NPM_LOCK_INSTALL: 180_000,
  NPM_AUDIT: 120_000
});

if (NPM_AUDIT_MAX_FETCH_CYCLE_MS >= COMMAND_TIMEOUTS.NPM_AUDIT) {
  throw new Error('NPM audit native fetch policy must remain below the governed outer timeout');
}

function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function boundedText(value) {
  const text = String(value || '');
  if (Buffer.byteLength(text, 'utf8') <= MAX_DIAGNOSTIC_BYTES) return text;
  return `${text.slice(0, MAX_DIAGNOSTIC_BYTES)}\n[TRUNCATED_BY_WP_B_GOVERNANCE]`;
}

function createGovernanceError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  for (const [key, value] of Object.entries(details)) error[key] = value;
  return error;
}

function isRateLimited(text) {
  return /(?:\b429\b|E429|too many requests|rate limit exceeded|secondary rate limit)/iu.test(String(text || ''));
}

function runGovernedCommand(command, args, options = {}) {
  const timeoutMs = Number(options.timeoutMs);
  const commandKind = String(options.commandKind || 'UPSTREAM_COMMAND');
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw createGovernanceError(
      'WP_B_UPSTREAM_TIMEOUT_POLICY_INVALID',
      `A positive hard timeout is required for ${commandKind}`,
      { commandKind, timeoutMs }
    );
  }

  const spawnSyncImpl = options.spawnSyncImpl || spawnSync;
  const useShell = options.shell === undefined
    ? (process.platform === 'win32' && /\.(?:cmd|bat)$/iu.test(command))
    : Boolean(options.shell);
  const result = spawnSyncImpl(command, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      CI: process.env.CI || '1',
      COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
      npm_config_fund: 'false',
      npm_config_audit: 'false',
      npm_config_update_notifier: 'false',
      ...(options.env || {})
    },
    maxBuffer: 32 * 1024 * 1024,
    timeout: timeoutMs,
    killSignal: 'SIGKILL',
    shell: useShell
  }) || {};

  const stdout = boundedText(result.stdout);
  const stderr = boundedText(result.stderr);
  const combined = `${stdout}\n${stderr}\n${result.error && result.error.message ? result.error.message : ''}`;
  const details = {
    commandKind,
    timeoutMs,
    status: Number.isInteger(result.status) ? result.status : null,
    signal: result.signal || null,
    stdout,
    stderr
  };

  if (result.error) {
    if (result.error.code === 'ETIMEDOUT' || result.signal) {
      throw createGovernanceError(
        'WP_B_UPSTREAM_COMMAND_TIMEOUT',
        `${commandKind} exceeded its ${timeoutMs}ms hard timeout`,
        details
      );
    }
    if (result.error.code === 'ENOENT') {
      throw createGovernanceError(
        'WP_B_UPSTREAM_TOOL_UNAVAILABLE',
        `${commandKind} could not start because the required tool is unavailable`,
        details
      );
    }
    throw createGovernanceError(
      'WP_B_UPSTREAM_COMMAND_EXECUTION_FAILED',
      `${commandKind} could not be executed`,
      details
    );
  }

  if (isRateLimited(combined)) {
    throw createGovernanceError(
      'WP_B_UPSTREAM_RATE_LIMITED',
      `${commandKind} was rejected by an upstream rate limit`,
      details
    );
  }

  if (!options.allowFailure && result.status !== 0) {
    throw createGovernanceError(
      'WP_B_UPSTREAM_COMMAND_FAILED',
      `${commandKind} exited with status ${result.status}`,
      details
    );
  }

  return Object.freeze({
    status: Number.isInteger(result.status) ? result.status : null,
    stdout,
    stderr
  });
}

function parseNpmAuditResultObject(result) {
  if (!result || typeof result.stdout !== 'string') return null;
  try {
    const parsed = JSON.parse(result.stdout);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed
      : null;
  } catch (_) {
    return null;
  }
}

function isNpmAuditErrorEnvelope(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
  return Object.prototype.hasOwnProperty.call(parsed, 'error')
    || typeof parsed.method === 'string'
    || typeof parsed.uri === 'string'
    || Object.prototype.hasOwnProperty.call(parsed, 'statusCode')
    || Object.prototype.hasOwnProperty.call(parsed, 'body');
}

function isRetryableNpmAuditEndpointTransportFailure(result, parsed) {
  if (!Number.isInteger(result?.status) || result.status === 0) return false;

  return Boolean(
    parsed
    && typeof parsed === 'object'
    && !Array.isArray(parsed)
    && parsed.error
    && typeof parsed.error === 'object'
    && !Array.isArray(parsed.error)
    && typeof parsed.message === 'string'
    && NPM_AUDIT_RETRYABLE_NETWORK_TIMEOUT_MESSAGES.includes(parsed.message)
  );
}

function createNpmAuditEndpointResultError(code, message, result, parsed, attempts) {
  return createGovernanceError(
    code,
    message,
    {
      commandKind: 'NPM_AUDIT',
      timeoutMs: COMMAND_TIMEOUTS.NPM_AUDIT,
      status: Number.isInteger(result?.status) ? result.status : null,
      signal: result?.signal || null,
      stdout: boundedText(result?.stdout),
      stderr: boundedText(result?.stderr),
      attempts,
      method: typeof parsed?.method === 'string' ? parsed.method : '',
      uri: typeof parsed?.uri === 'string' ? parsed.uri : '',
      statusCode: Object.prototype.hasOwnProperty.call(parsed || {}, 'statusCode')
        ? parsed.statusCode
        : null
    }
  );
}

function runGovernedNpmAudit(auditRoot, options = {}) {
  const runCommand = options.runCommand || runGovernedCommand;

  for (let attempt = 1; attempt <= NPM_AUDIT_MAX_ATTEMPTS; attempt += 1) {
    try {
      const result = runCommand(npmCommand(), ['audit', '--omit=dev', '--json'], {
        cwd: auditRoot,
        allowFailure: true,
        commandKind: 'NPM_AUDIT',
        timeoutMs: COMMAND_TIMEOUTS.NPM_AUDIT,
        env: NPM_AUDIT_ENV
      });

      const parsed = parseNpmAuditResultObject(result);

      if (!isNpmAuditErrorEnvelope(parsed)) return result;

      if (isRetryableNpmAuditEndpointTransportFailure(result, parsed)) {
        if (attempt < NPM_AUDIT_MAX_ATTEMPTS) continue;

        throw createNpmAuditEndpointResultError(
          'WP_B_UPSTREAM_NPM_AUDIT_ENDPOINT_TRANSPORT_FAILED',
          'npm audit endpoint transport failed after the bounded whole-audit retry',
          result,
          parsed,
          attempt
        );
      }

      throw createNpmAuditEndpointResultError(
        'WP_B_UPSTREAM_NPM_AUDIT_ENDPOINT_FAILED',
        'npm audit returned a non-retryable endpoint error envelope',
        result,
        parsed,
        attempt
      );
    } catch (error) {
      if (
        error?.code === 'WP_B_UPSTREAM_COMMAND_TIMEOUT'
        && attempt < NPM_AUDIT_MAX_ATTEMPTS
      ) {
        continue;
      }
      throw error;
    }
  }

  throw createGovernanceError(
    'WP_B_UPSTREAM_COMMAND_TIMEOUT',
    `NPM_AUDIT exceeded its ${COMMAND_TIMEOUTS.NPM_AUDIT}ms hard timeout`,
    { commandKind: 'NPM_AUDIT', timeoutMs: COMMAND_TIMEOUTS.NPM_AUDIT }
  );
}

function parseJsonOutput(result, label) {
  try {
    return JSON.parse(result.stdout);
  } catch (_) {
    throw createGovernanceError(
      'WP_B_UPSTREAM_JSON_INVALID',
      `${label} did not return valid JSON`,
      { stdout: boundedText(result.stdout), stderr: boundedText(result.stderr) }
    );
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

function governedJoin(baseDirectory, child) {
  return /^[A-Za-z]:[\\/]/u.test(baseDirectory)
    ? path.win32.join(baseDirectory, child)
    : path.join(baseDirectory, child);
}

function createGovernedScratchDirectory(options = {}) {
  const baseDirectory = String(options.baseDirectory || process.env.RUNNER_TEMP || os.tmpdir());
  const realpathImpl = options.realpathImpl || fs.realpathSync.native || fs.realpathSync;
  const mkdtempImpl = options.mkdtempImpl || fs.mkdtempSync;
  let canonicalBase;
  try {
    canonicalBase = realpathImpl(baseDirectory);
  } catch (_) {
    throw createGovernanceError(
      'WP_B_UPSTREAM_SCRATCH_ROOT_INVALID',
      'The governed upstream scratch root could not be canonicalized',
      { baseDirectory }
    );
  }
  const prefix = String(options.prefix || 'yance-wp-b-xstate-');
  return mkdtempImpl(governedJoin(String(canonicalBase), prefix));
}

function removeGovernedScratchDirectory(scratchRoot, options = {}) {
  const rmSyncImpl = options.rmSyncImpl || fs.rmSync;
  const primaryError = options.primaryError || null;
  try {
    rmSyncImpl(scratchRoot, {
      recursive: true,
      force: true,
      maxRetries: SCRATCH_CLEANUP_MAX_RETRIES,
      retryDelay: SCRATCH_CLEANUP_RETRY_DELAY_MS
    });
    return true;
  } catch (error) {
    const cleanupCauseCode = String(error?.code || '');
    const cleanupError = createGovernanceError(
      'WP_B_UPSTREAM_SCRATCH_CLEANUP_FAILED',
      'Governed XState upstream scratch cleanup failed after bounded retries',
      {
        scratchRoot: String(scratchRoot || ''),
        cleanupCauseCode,
        maxRetries: SCRATCH_CLEANUP_MAX_RETRIES,
        retryDelayMs: SCRATCH_CLEANUP_RETRY_DELAY_MS
      }
    );
    if (primaryError) {
      primaryError.cleanupCode = cleanupError.code;
      primaryError.cleanupMessage = cleanupError.message;
      primaryError.cleanupCauseCode = cleanupCauseCode;
      primaryError.cleanupScratchRoot = cleanupError.scratchRoot;
      primaryError.cleanupMaxRetries = cleanupError.maxRetries;
      primaryError.cleanupRetryDelayMs = cleanupError.retryDelayMs;
      return false;
    }
    throw cleanupError;
  }
}

function checkoutExactUpstreamTag(options = {}) {
  const checkoutRoot = path.resolve(options.checkoutRoot || createGovernedScratchDirectory({
    prefix: 'yance-wp-b-xstate-source-'
  }));
  const runCommand = options.runCommand || runGovernedCommand;
  const mkdirImpl = options.mkdirImpl || fs.mkdirSync;
  mkdirImpl(checkoutRoot, { recursive: true });

  runCommand('git', ['init', '--quiet'], {
    cwd: checkoutRoot,
    commandKind: 'GIT_INIT',
    timeoutMs: COMMAND_TIMEOUTS.GIT_INIT
  });
  runCommand('git', ['config', 'core.autocrlf', 'false'], {
    cwd: checkoutRoot,
    commandKind: 'GIT_CONFIG_AUTOCRLF',
    timeoutMs: COMMAND_TIMEOUTS.GIT_CONFIG
  });
  runCommand('git', ['config', 'core.eol', 'lf'], {
    cwd: checkoutRoot,
    commandKind: 'GIT_CONFIG_EOL',
    timeoutMs: COMMAND_TIMEOUTS.GIT_CONFIG
  });
  runCommand('git', ['remote', 'add', 'origin', UPSTREAM_REPOSITORY_URL], {
    cwd: checkoutRoot,
    commandKind: 'GIT_REMOTE',
    timeoutMs: COMMAND_TIMEOUTS.GIT_REMOTE
  });
  runCommand('git', ['fetch', '--depth=1', '--no-tags', 'origin', `refs/tags/${EXACT_UPSTREAM_TAG}`], {
    cwd: checkoutRoot,
    commandKind: 'GIT_FETCH',
    timeoutMs: COMMAND_TIMEOUTS.GIT_FETCH
  });
  runCommand('git', ['checkout', '--detach', '--force', 'FETCH_HEAD'], {
    cwd: checkoutRoot,
    commandKind: 'GIT_CHECKOUT',
    timeoutMs: COMMAND_TIMEOUTS.GIT_CHECKOUT
  });
  const revision = runCommand('git', ['rev-parse', 'HEAD^{commit}'], {
    cwd: checkoutRoot,
    commandKind: 'GIT_REV_PARSE',
    timeoutMs: COMMAND_TIMEOUTS.GIT_REV_PARSE
  });
  const commitSha = String(revision.stdout || '').trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/u.test(commitSha)) {
    throw createGovernanceError(
      'WP_B_XSTATE_TAG_TARGET_INVALID',
      `Exact upstream tag ${EXACT_UPSTREAM_TAG} did not resolve to a commit`,
      { tagName: EXACT_UPSTREAM_TAG }
    );
  }

  return Object.freeze({
    root: checkoutRoot,
    tagName: EXACT_UPSTREAM_TAG,
    commitSha,
    repositoryUrl: UPSTREAM_REPOSITORY_URL
  });
}

function resolveUpstreamTagCommit(options = {}) {
  const ownedRoot = !options.checkoutRoot;
  const checkoutRoot = options.checkoutRoot || createGovernedScratchDirectory({
    prefix: 'yance-wp-b-xstate-tag-'
  });
  let primaryError = null;
  try {
    const checkout = checkoutExactUpstreamTag({ ...options, checkoutRoot });
    return Object.freeze({ tagName: checkout.tagName, commitSha: checkout.commitSha });
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    if (ownedRoot) removeGovernedScratchDirectory(checkoutRoot, { primaryError });
  }
}

function normalizeRepository(repository) {
  if (typeof repository === 'string') return repository;
  if (repository && typeof repository.url === 'string') return repository.url;
  return '';
}

function auditCounts(audit) {
  const fields = ['info', 'low', 'moderate', 'high', 'critical', 'total'];
  const vulnerabilities = audit?.metadata?.vulnerabilities;
  if (audit && Object.prototype.hasOwnProperty.call(audit, 'error')) {
    throw createGovernanceError('WP_B_XSTATE_AUDIT_REPORT_INVALID', 'npm audit returned a top-level error payload');
  }
  if (!vulnerabilities || typeof vulnerabilities !== 'object' || Array.isArray(vulnerabilities)) {
    throw createGovernanceError('WP_B_XSTATE_AUDIT_REPORT_INVALID', 'npm audit metadata.vulnerabilities is required');
  }
  for (const field of fields) {
    const value = vulnerabilities[field];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw createGovernanceError(
        'WP_B_XSTATE_AUDIT_REPORT_INVALID',
        `npm audit metadata.vulnerabilities.${field} must be a finite non-negative number`,
        { field, actual: value }
      );
    }
  }
  return Object.freeze(Object.fromEntries(fields.map(field => [field, vulnerabilities[field]])));
}

function evaluateAuditReport(audit) {
  const vulnerabilities = auditCounts(audit);
  return Object.freeze({
    vulnerabilities,
    violations: Object.freeze(vulnerabilities.high !== 0 || vulnerabilities.critical !== 0
      ? [Object.freeze({ code: 'WP_B_XSTATE_HIGH_OR_CRITICAL_VULNERABILITY', vulnerabilities })]
      : [])
  });
}

function readLicenseText(upstreamCheckout) {
  const licensePath = path.join(upstreamCheckout.root, 'LICENSE');
  try {
    return fs.readFileSync(licensePath, 'utf8');
  } catch (_) {
    throw createGovernanceError(
      'WP_B_XSTATE_LICENSE_FILE_MISSING',
      'The exact XState upstream checkout does not contain the required LICENSE file',
      { tagName: upstreamCheckout.tagName, commitSha: upstreamCheckout.commitSha }
    );
  }
}

async function verify(options = {}) {
  const tempRoot = createGovernedScratchDirectory({ prefix: 'yance-wp-b-xstate-package-' });
  const violations = [];
  let primaryError = null;
  try {
    const metadata = parseJsonOutput(
      runGovernedCommand(npmCommand(), ['view', PACKAGE_SPEC, '--json'], {
        commandKind: 'NPM_METADATA',
        timeoutMs: COMMAND_TIMEOUTS.NPM_METADATA
      }),
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

    const upstream = options.upstreamCheckout || checkoutExactUpstreamTag({
      checkoutRoot: path.join(tempRoot, 'upstream')
    });
    if (upstream.tagName !== EXACT_UPSTREAM_TAG) {
      violations.push({ code: 'WP_B_XSTATE_EXACT_TAG_MISSING', actual: upstream.tagName || '' });
    }
    if (metadata.gitHead && metadata.gitHead !== upstream.commitSha) {
      violations.push({
        code: 'WP_B_XSTATE_NPM_GIT_HEAD_TAG_MISMATCH',
        npmGitHead: metadata.gitHead,
        upstreamCommit: upstream.commitSha
      });
    }

    const packResult = parseJsonOutput(
      runGovernedCommand(npmCommand(), ['pack', PACKAGE_SPEC, '--json', '--ignore-scripts'], {
        cwd: tempRoot,
        commandKind: 'NPM_PACK',
        timeoutMs: COMMAND_TIMEOUTS.NPM_PACK
      }),
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
    runGovernedCommand(npmCommand(), [
      'install',
      '--package-lock-only',
      '--ignore-scripts',
      '--save-exact',
      '--no-fund',
      '--no-audit',
      PACKAGE_SPEC
    ], {
      cwd: auditRoot,
      commandKind: 'NPM_LOCK_INSTALL',
      timeoutMs: COMMAND_TIMEOUTS.NPM_LOCK_INSTALL
    });
    const auditResult = runGovernedNpmAudit(auditRoot);
    const audit = parseJsonOutput(auditResult, 'npm audit');
    const auditEvaluation = evaluateAuditReport(audit);
    const vulnerabilities = auditEvaluation.vulnerabilities;
    violations.push(...auditEvaluation.violations);

    const licenseText = readLicenseText(upstream);
    if (!/MIT License/iu.test(licenseText)) {
      violations.push({ code: 'WP_B_XSTATE_LICENSE_TEXT_INVALID' });
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
      schemaVersion: 4,
      documentType: 'YANCE_ACV2_WP_B_XSTATE_UPSTREAM_VERIFICATION',
      ok: violations.length === 0,
      package: {
        name: metadata.name || '',
        version: metadata.version || '',
        license: metadata.license || '',
        repository: normalizeRepository(metadata.repository),
        npmGitHead: metadata.gitHead || '',
        upstreamTag: upstream.tagName,
        upstreamCommit: upstream.commitSha,
        runtimeDependencyCount: Object.keys(dependencies).length,
        runtimeDependencies: dependencies,
        installLifecycleScripts,
        distIntegrity: metadata.dist && metadata.dist.integrity ? metadata.dist.integrity : '',
        distShasum: metadata.dist && metadata.dist.shasum ? metadata.dist.shasum : '',
        tarballSha512,
        tarballSha1,
        packageFileCount,
        suspiciousPackageFiles,
        licenseTextSha256: sha256(licenseText),
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
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    removeGovernedScratchDirectory(tempRoot, { primaryError });
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
  COMMAND_TIMEOUTS,
  EXACT_UPSTREAM_TAG,
  EXACT_VERSION,
  NPM_AUDIT_ENV,
  NPM_AUDIT_FETCH_POLICY,
  NPM_AUDIT_MAX_ATTEMPTS,
  NPM_AUDIT_MAX_FETCH_CYCLE_MS,
  PACKAGE_NAME,
  PACKAGE_SPEC,
  SCRATCH_CLEANUP_MAX_RETRIES,
  SCRATCH_CLEANUP_RETRY_DELAY_MS,
  UPSTREAM_REPOSITORY,
  UPSTREAM_REPOSITORY_URL,
  UPSTREAM_TAG_CANDIDATES,
  auditCounts,
  checkoutExactUpstreamTag,
  createGovernedScratchDirectory,
  evaluateAuditReport,
  parseJsonOutput,
  removeGovernedScratchDirectory,
  resolveUpstreamTagCommit,
  runGovernedCommand,
  runGovernedNpmAudit,
  verify
};
