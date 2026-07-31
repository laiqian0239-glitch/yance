'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { validateProbeSemantics } = require('./wp7InstalledRuntimeProbeSemantics');
const { FORMAL_PROBE_IDS } = require('../shared/wp7/formalProbeIds');

const GIT_RE = /^[0-9a-f]{40}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const BUILD_SESSION_RE = /^[0-9a-f]{16,64}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EXECUTION_CLASSES = Object.freeze(['FINAL_WINDOWS', 'PRE_REVIEW_PACKAGED_INTEGRATION']);

class Wp7InstalledRuntimeProbeError extends Error {
  constructor(reasonCode, message, details = {}) {
    super(message);
    this.name = 'Wp7InstalledRuntimeProbeError';
    this.reasonCode = reasonCode;
    this.details = details;
  }
}

function canonicalJson(value) {
  function sort(input) {
    if (Array.isArray(input)) return input.map(sort);
    if (!input || typeof input !== 'object') return input;
    return Object.fromEntries(Object.keys(input).sort().map((key) => [key, sort(input[key])]));
  }
  return `${JSON.stringify(sort(value), null, 2)}\n`;
}

function realRoot(rootPath) {
  const absolute = path.resolve(rootPath || '');
  if (!rootPath || !path.isAbsolute(rootPath) || !fs.existsSync(absolute) || !fs.statSync(absolute).isDirectory()) {
    throw new Wp7InstalledRuntimeProbeError('WP7_PROBE_OUTPUT_ROOT_INVALID', 'probe output root must be an existing absolute directory', { rootPath: absolute });
  }
  const real = fs.realpathSync(absolute);
  if (fs.lstatSync(real).isSymbolicLink()) {
    throw new Wp7InstalledRuntimeProbeError('WP7_PROBE_OUTPUT_ROOT_INVALID', 'probe output root cannot be a symlink', { rootPath: real });
  }
  return real;
}

function requireString(env, key) {
  const value = String(env?.[key] || '').trim();
  if (!value) throw new Wp7InstalledRuntimeProbeError('WP7_INSTALLED_RUNTIME_PROBE_REQUEST_INVALID', `${key} is required`);
  return value;
}

function readInstalledRuntimeProbeRequest(env = process.env, options = {}) {
  const id = String(env.WP7_PROBE_ID || '').trim();
  const output = String(env.WP7_PROBE_OUTPUT_PATH || '').trim();
  const root = String(env.WP7_PROBE_ROOT || '').trim();
  if (!id && !output && !root) return null;
  if (!id || !output || !root) {
    throw new Wp7InstalledRuntimeProbeError('WP7_INSTALLED_RUNTIME_PROBE_REQUEST_INVALID', 'probe ID, root and output path must be supplied together');
  }
  if (options.requirePackaged !== false && options.isPackaged !== true) {
    throw new Wp7InstalledRuntimeProbeError('WP7_INSTALLED_RUNTIME_PROBE_PACKAGED_APP_REQUIRED', 'formal runtime probes require the packaged installed application');
  }
  const executionClass = String(env.WP7_PROBE_EXECUTION_CLASS || 'FINAL_WINDOWS').trim();
  if (!EXECUTION_CLASSES.includes(executionClass)) {
    throw new Wp7InstalledRuntimeProbeError('WP7_INSTALLED_RUNTIME_PROBE_REQUEST_INVALID', 'unknown probe execution class', { executionClass });
  }
  const actualPlatform = options.platform || process.platform;
  const formalWindows = executionClass === 'FINAL_WINDOWS';
  if (formalWindows && options.requireWindows !== false && actualPlatform !== 'win32') {
    throw new Wp7InstalledRuntimeProbeError('WP7_WINDOWS_FINAL_BUILD_REQUIRED', 'formal installed runtime probes require win32', { actualPlatform });
  }
  if (!formalWindows && options.allowPreReviewPackagedIntegration !== true) {
    throw new Wp7InstalledRuntimeProbeError('WP7_INSTALLED_RUNTIME_PROBE_REQUEST_INVALID', 'pre-review packaged integration requires explicit application authorization', { executionClass });
  }
  if (!FORMAL_PROBE_IDS.includes(id)) {
    throw new Wp7InstalledRuntimeProbeError('WP7_INSTALLED_RUNTIME_PROBE_ID_UNKNOWN', 'unknown installed runtime probe ID', { probeId: id });
  }
  const trustedRoot = realRoot(root);
  if (!path.isAbsolute(output)) {
    throw new Wp7InstalledRuntimeProbeError('WP7_PROBE_OUTPUT_PATH_INVALID', 'probe output path must be absolute', { output });
  }
  const absoluteOutput = path.resolve(output);
  const expectedOutput = path.join(trustedRoot, 'probe-results', `${id}.json`);
  if (absoluteOutput !== expectedOutput) {
    throw new Wp7InstalledRuntimeProbeError('WP7_PROBE_OUTPUT_PATH_INVALID', 'probe output path does not match the trusted formal path', { expectedOutput, actualOutput: absoluteOutput });
  }
  const parent = path.dirname(absoluteOutput);
  fs.mkdirSync(parent, { recursive: true });
  const realParent = fs.realpathSync(parent);
  if (realParent !== path.join(trustedRoot, 'probe-results')) {
    throw new Wp7InstalledRuntimeProbeError('WP7_PROBE_OUTPUT_PATH_INVALID', 'probe output parent escaped the trusted root', { trustedRoot, realParent });
  }
  if (fs.existsSync(absoluteOutput)) {
    throw new Wp7InstalledRuntimeProbeError('WP7_PROBE_STALE_RESULT_PRESENT', 'probe output must not exist before a formal execution', { outputPath: absoluteOutput });
  }

  const sealedIdentity = formalWindows ? {
    installerSha256: requireString(env, 'WP7_PROBE_INSTALLER_SHA256').toLowerCase()
  } : {
    preReviewSealedArtifactSha256: requireString(env, 'WP7_PROBE_PRE_REVIEW_SEALED_ARTIFACT_SHA256').toLowerCase(),
    preReviewSealedArtifactType: requireString(env, 'WP7_PROBE_PRE_REVIEW_SEALED_ARTIFACT_TYPE')
  };
  if (!formalWindows && String(env.WP7_PROBE_INSTALLER_SHA256 || '').trim()) {
    throw new Wp7InstalledRuntimeProbeError('WP7_INSTALLED_RUNTIME_PROBE_REQUEST_INVALID', 'pre-review probe context cannot use installerSha256');
  }
  const request = {
    probeId: id,
    outputRoot: trustedRoot,
    outputPath: absoluteOutput,
    buildSessionId: requireString(env, 'WP7_PROBE_BUILD_SESSION_ID'),
    ...sealedIdentity,
    expectedBuildId: requireString(env, 'WP7_PROBE_EXPECTED_BUILD_ID'),
    expectedSourceCommit: requireString(env, 'WP7_PROBE_EXPECTED_SOURCE_COMMIT').toLowerCase(),
    expectedSourceTree: requireString(env, 'WP7_PROBE_EXPECTED_SOURCE_TREE').toLowerCase(),
    requestedAtUtc: new Date().toISOString(),
    executionNonce: requireString(env, 'WP7_PROBE_EXECUTION_NONCE'),
    expectedProductExecutableSha256: requireString(env, 'WP7_PROBE_EXPECTED_PRODUCT_EXECUTABLE_SHA256').toLowerCase(),
    expectedMainEntrySha256: requireString(env, 'WP7_PROBE_EXPECTED_MAIN_ENTRY_SHA256').toLowerCase(),
    executionClass
  };
  const sealedIdentityValid = formalWindows
    ? SHA256_RE.test(request.installerSha256)
    : SHA256_RE.test(request.preReviewSealedArtifactSha256) && request.preReviewSealedArtifactType === 'TRUSTED_PRODUCT_BUILD_SESSION_SEAL_V1';
  if (!BUILD_SESSION_RE.test(request.buildSessionId) || !sealedIdentityValid || !GIT_RE.test(request.expectedSourceCommit) || !GIT_RE.test(request.expectedSourceTree)
      || !UUID_RE.test(request.executionNonce) || !SHA256_RE.test(request.expectedProductExecutableSha256) || !SHA256_RE.test(request.expectedMainEntrySha256)) {
    throw new Wp7InstalledRuntimeProbeError('WP7_INSTALLED_RUNTIME_PROBE_REQUEST_INVALID', 'probe identity fields are malformed', { request: { ...request, outputRoot: undefined, outputPath: undefined } });
  }
  return Object.freeze(request);
}

function bindProbeIdentity(request, releaseIdentity) {
  const actual = {
    buildId: String(releaseIdentity?.buildId || ''),
    sourceCommit: String(releaseIdentity?.sourceCommit || releaseIdentity?.gitCommit || '').toLowerCase(),
    sourceTree: String(releaseIdentity?.sourceTree || '').toLowerCase()
  };
  const expected = {
    buildId: request.expectedBuildId,
    sourceCommit: request.expectedSourceCommit,
    sourceTree: request.expectedSourceTree
  };
  const mismatches = Object.keys(expected).filter((key) => actual[key] !== expected[key]);
  if (mismatches.length) {
    throw new Wp7InstalledRuntimeProbeError('WP7_INSTALLED_RUNTIME_PROBE_IDENTITY_MISMATCH', 'installed release identity does not match the sealed probe context', { mismatches, expected, actual });
  }
  return Object.freeze({
    buildSessionId: request.buildSessionId,
    buildId: actual.buildId,
    frozenSourceCommit: actual.sourceCommit,
    frozenSourceTree: actual.sourceTree,
    ...(request.executionClass === 'FINAL_WINDOWS' ? {
      installerSha256: request.installerSha256
    } : {
      preReviewSealedArtifactSha256: request.preReviewSealedArtifactSha256,
      preReviewSealedArtifactType: request.preReviewSealedArtifactType
    })
  });
}

function validateMeasurements(probeId, measurements) {
  if (!measurements || typeof measurements !== 'object' || Array.isArray(measurements) || !Object.keys(measurements).length) {
    throw new Wp7InstalledRuntimeProbeError('WP7_INSTALLED_RUNTIME_PROBE_MEASUREMENT_MISSING', 'probe measurements must be a non-empty object', { probeId });
  }
  const forbidden = ['status', 'platform', 'actualPlatform', 'fixtureMode', 'buildId', 'installerSha256', 'preReviewSealedArtifactSha256', 'preReviewSealedArtifactType'];
  const present = forbidden.filter((key) => Object.prototype.hasOwnProperty.call(measurements, key));
  if (present.length) {
    throw new Wp7InstalledRuntimeProbeError('WP7_INSTALLED_RUNTIME_PROBE_MEASUREMENT_INVALID', 'measurements cannot override formal result fields', { probeId, present });
  }
  return validateProbeSemantics(probeId, measurements);
}

function writeFreshResult(request, document) {
  if (fs.existsSync(request.outputPath)) {
    throw new Wp7InstalledRuntimeProbeError('WP7_PROBE_STALE_RESULT_PRESENT', 'probe result path was populated before the final atomic write', { outputPath: request.outputPath });
  }
  const temp = path.join(path.dirname(request.outputPath), `.${path.basename(request.outputPath)}.${request.executionNonce}.tmp`);
  let fd;
  try {
    fd = fs.openSync(temp, 'wx', 0o600);
    fs.writeFileSync(fd, canonicalJson(document), 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(temp, request.outputPath);
    if (process.platform !== 'win32') {
      const dirFd = fs.openSync(path.dirname(request.outputPath), 'r');
      try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
    }
  } catch (error) {
    if (fd !== undefined) try { fs.closeSync(fd); } catch (_) {}
    try { fs.rmSync(temp, { force: true }); } catch (_) {}
    if (error instanceof Wp7InstalledRuntimeProbeError) throw error;
    throw new Wp7InstalledRuntimeProbeError('WP7_INSTALLED_RUNTIME_PROBE_RESULT_WRITE_FAILED', 'failed to atomically write the installed runtime probe result', { message: error.message, outputPath: request.outputPath });
  }
  const stored = JSON.parse(fs.readFileSync(request.outputPath, 'utf8'));
  if (stored.executionNonce !== request.executionNonce || stored.probeId !== request.probeId) {
    throw new Wp7InstalledRuntimeProbeError('WP7_INSTALLED_RUNTIME_PROBE_RESULT_WRITE_FAILED', 'stored result identity does not match this execution');
  }
  return stored;
}

async function executeInstalledRuntimeProbe(request, options = {}) {
  if (!request) return null;
  const releaseIdentity = options.releaseIdentity;
  const operations = options.operations || {};
  const operation = operations[request.probeId];
  if (typeof operation !== 'function') {
    throw new Wp7InstalledRuntimeProbeError('WP7_INSTALLED_RUNTIME_PROBE_IMPLEMENTATION_MISSING', 'installed application has no producer for the requested formal probe', { probeId: request.probeId });
  }
  const startedAtUtc = new Date().toISOString();
  const identity = bindProbeIdentity(request, releaseIdentity);
  const measurements = validateMeasurements(request.probeId, await operation({ request, identity, startedAtUtc }));
  const producerExecutablePath = fs.realpathSync(path.resolve(options.producerExecutablePath || process.execPath));
  const producerMainEntryPath = fs.realpathSync(path.resolve(options.producerMainEntryPath || ''));
  const producerExecutableSha256 = crypto.createHash('sha256').update(fs.readFileSync(producerExecutablePath)).digest('hex');
  const producerMainEntrySha256 = crypto.createHash('sha256').update(fs.readFileSync(producerMainEntryPath)).digest('hex');
  if (producerExecutableSha256 !== request.expectedProductExecutableSha256 || producerMainEntrySha256 !== request.expectedMainEntrySha256) {
    throw new Wp7InstalledRuntimeProbeError('WP7_INSTALLED_RUNTIME_PROBE_PRODUCER_IDENTITY_MISMATCH', 'probe producer executable or Electron main entry does not match the sealed parent context', {
      expectedProductExecutableSha256: request.expectedProductExecutableSha256,
      actualProductExecutableSha256: producerExecutableSha256,
      expectedMainEntrySha256: request.expectedMainEntrySha256,
      actualMainEntrySha256: producerMainEntrySha256
    });
  }
  const completedAtUtc = new Date().toISOString();
  const document = {
    schemaVersion: 1,
    documentType: 'WP7_INSTALLED_RUNTIME_PROBE_RESULT',
    probeId: request.probeId,
    status: 'PASS',
    generatedAtUtc: completedAtUtc,
    startedAtUtc,
    completedAtUtc,
    executionNonce: request.executionNonce,
    actualPlatform: options.platform || process.platform,
    fixtureMode: false,
    executionClass: request.executionClass,
    formalWindowsEvidenceEligible: request.executionClass === 'FINAL_WINDOWS' && (options.platform || process.platform) === 'win32',
    producerPid: process.pid,
    producerParentPid: process.ppid,
    producerExecutablePath,
    producerExecutableSha256,
    producerMainEntryPath,
    producerMainEntrySha256,
    ...identity,
    measurements
  };
  const stored = writeFreshResult(request, document);
  if (typeof options.onResultCommitted === 'function') await options.onResultCommitted(stored);
  return stored;
}

module.exports = {
  EXECUTION_CLASSES,
  FORMAL_PROBE_IDS,
  Wp7InstalledRuntimeProbeError,
  bindProbeIdentity,
  executeInstalledRuntimeProbe,
  readInstalledRuntimeProbeRequest,
  validateMeasurements,
  writeFreshResult
};
