'use strict';

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const {
  CONTROL_PIPE_FD,
  CREDENTIAL_CUSTODY_PIPE_FD,
  CREDENTIAL_PIPE_FD,
  STARTUP_PROTOCOL_VERSION,
  STARTUP_FRAME_PROTOCOL_VERSION,
  M1_STARTUP_CONTRACT_VERSION,
  READY_PROTOCOL_VERSION,
  RUNTIME_MODE_DESKTOP_HOSTED,
  createApiSessionToken,
  encodeStartupFrame,
  deriveCustodyPipeName
} = require('./startupProtocol');
const { CredentialIpcHost } = require('./CredentialIpcHost');
const { CredentialCustodyHost } = require('./CredentialCustodyHost');
const { BackendOwnerRegistry } = require('./BackendOwnerRegistry');
const { CREDENTIAL_PROTOCOL_VERSION, CREDENTIAL_HYDRATION_TIMEOUT_MS, createCredentialOneTimeToken, makeCredentialFrame } = require('../../shared/credentialProtocol');

const PROCESS_STATES = Object.freeze({
  NOT_STARTED: 'NOT_STARTED', STARTING: 'STARTING', RUNNING: 'RUNNING', STOPPING: 'STOPPING',
  STOPPED: 'STOPPED', START_FAILED: 'START_FAILED', CRASHED: 'CRASHED'
});

function sanitizedEnvironment(environment = {}) {
  const env = { ...environment };
  for (const key of Object.keys(env)) {
    if (/^(?:YANCE_)?(?:API|LOCAL_API|SESSION).*TOKEN$/i.test(key)) delete env[key];
  }
  delete env.apiSessionToken;
  delete env.YANCE_SAFE_MODE;
  return env;
}

const NODE_RUNTIME_PROBE_CACHE = new Map();

function probeNodeRuntimeExecutable(executablePath, options = {}) {
  const absolute = path.resolve(String(executablePath || ''));
  const cached = NODE_RUNTIME_PROBE_CACHE.get(absolute);
  if (cached && options.noCache !== true) return cached;
  const spawnSync = options.spawnSync || childProcess.spawnSync;
  let result;
  try {
    result = spawnSync(absolute, ['--version'], {
      cwd: options.cwd || path.dirname(absolute),
      env: sanitizedEnvironment(options.env || process.env),
      encoding: 'utf8',
      windowsHide: true,
      timeout: Math.max(1000, Number(options.timeoutMs || 5000))
    });
  } catch (cause) {
    throw startupFailure('M1_NODE_RUNTIME_PROBE_FAILED', 'Trusted Node runtime could not be executed', {
      nodeRuntimeExecutablePath: absolute,
      causeCode: cause?.code || '',
      causeMessage: cause?.message || String(cause || '')
    });
  }
  if (result?.error || Number(result?.status) !== 0) {
    const cause = result?.error;
    throw startupFailure('M1_NODE_RUNTIME_PROBE_FAILED', 'Trusted Node runtime preflight failed before backend fork', {
      nodeRuntimeExecutablePath: absolute,
      exitCode: result?.status ?? null,
      signal: result?.signal || null,
      causeCode: cause?.code || '',
      causeMessage: cause?.message || '',
      stdoutTail: String(result?.stdout || '').slice(-2000),
      stderrTail: String(result?.stderr || '').slice(-4000)
    });
  }
  const version = String(result.stdout || '').trim();
  if (!/^v\d+\.\d+\.\d+(?:[-+].*)?$/.test(version)) {
    throw startupFailure('M1_NODE_RUNTIME_VERSION_INVALID', 'Trusted Node runtime returned an invalid version response', {
      nodeRuntimeExecutablePath: absolute,
      version,
      stderrTail: String(result.stderr || '').slice(-4000)
    });
  }
  const report = Object.freeze({ ok: true, executablePath: absolute, version });
  if (options.noCache !== true) NODE_RUNTIME_PROBE_CACHE.set(absolute, report);
  return report;
}

function processExited(child) {
  return !child || child.exitCode !== null || child.__desktopHostExited === true;
}

function createChildOutputTail(limitBytes = 8192) {
  const state = { stdout: '', stderr: '' };
  const append = (field, chunk) => {
    const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk || '');
    state[field] = (state[field] + text).slice(-Math.max(1024, Number(limitBytes || 8192)));
  };
  return {
    attach(child) {
      child?.stdout?.on?.('data', chunk => append('stdout', chunk));
      child?.stderr?.on?.('data', chunk => append('stderr', chunk));
    },
    snapshot() { return { stdoutTail: state.stdout, stderrTail: state.stderr }; }
  };
}

function waitForExit(child, timeoutMs) {
  if (processExited(child)) return Promise.resolve({ exited: true, exitCode: child?.exitCode ?? null, signalCode: child?.signalCode ?? null });
  return new Promise(resolve => {
    let settled = false;
    const finish = (exited, exitCode = child.exitCode, signalCode = child.signalCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.removeListener?.('exit', onExit);
      resolve({ exited, exitCode: exitCode ?? null, signalCode: signalCode ?? null });
    };
    const onExit = (code, signal) => finish(true, code, signal);
    const timer = setTimeout(() => finish(false), Math.max(25, Number(timeoutMs || 1000)));
    child.once?.('exit', onExit);
  });
}

function delay(ms) { return new Promise(resolve => setTimeout(resolve, Math.max(0, Number(ms || 0)))); }

function probeBackendHttpReady({ port, token, path: requestPath = '/api/health', timeoutMs = 5000, retries = 0, retryDelayMs = 100 } = {}) {
  const backendPort = Number(port || 0);
  if (!Number.isInteger(backendPort) || backendPort < 1 || backendPort > 65535) return Promise.resolve({ skipped: true, reason: 'port-not-available' });
  const attemptRequest = attempt => new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port: backendPort,
      path: requestPath,
      method: 'GET',
      headers: token ? { Authorization: `Bearer ${token}`, 'X-Yance-Contract-Version': '2' } : { 'X-Yance-Contract-Version': '2' },
      timeout: Math.max(100, Number(timeoutMs || 5000))
    }, res => {
      res.resume();
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 500) return resolve({ ok: true, statusCode: res.statusCode, attempt, port: backendPort, path: requestPath });
        reject(startupFailure('M1_BACKEND_READY_HEALTHCHECK_FAILED', 'Backend ready health check returned an invalid status', { statusCode: res.statusCode, attempt, port: backendPort, path: requestPath }));
      });
    });
    req.once('timeout', () => {
      const error = startupFailure('M1_BACKEND_READY_HEALTHCHECK_TIMEOUT', 'Backend ready health check timed out', { attempt, port: backendPort, path: requestPath, timeoutMs });
      req.destroy(error);
    });
    req.once('error', error => reject(startupFailure('M1_BACKEND_READY_HEALTHCHECK_FAILED', 'Backend ready health check failed', { causeCode: error.code || '', causeMessage: error.message, attempt, port: backendPort, path: requestPath })));
    req.end();
  });
  return (async () => {
    let lastError = null;
    const maxRetries = Math.max(0, Number(retries || 0));
    for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
      try { return await attemptRequest(attempt); }
      catch (error) {
        lastError = error;
        const transient = ['ECONNREFUSED', 'ECONNRESET', 'EPIPE', 'ETIMEDOUT'].includes(String(error.causeCode || error.code || ''))
          || ['M1_BACKEND_READY_HEALTHCHECK_TIMEOUT', 'M1_BACKEND_READY_HEALTHCHECK_FAILED'].includes(String(error.reasonCode || ''));
        if (attempt > maxRetries || !transient) break;
        await delay(Math.max(25, Number(retryDelayMs || 100)) * attempt);
      }
    }
    throw lastError;
  })();
}

function pathExists(filePath, fsApi = fs) {
  if (typeof filePath !== 'string' || filePath.length === 0) return false;
  try { return fsApi.existsSync(filePath); } catch (_) { return false; }
}

function firstExistingDelimitedPath(value, fsApi = fs) {
  const raw = String(value || '');
  if (!raw) return '';
  return raw.split(path.delimiter).map(item => item.trim()).find(item => item && pathExists(item, fsApi)) || '';
}

function normalizeBackendPort(options = {}, env = {}) {
  const raw = env.YANCE_PORT || options.backendPort || 0;
  const port = Number(raw || 0);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw startupFailure('M1_BACKEND_PORT_INVALID', 'Backend port must be an integer from 0 to 65535', { backendPort: raw });
  }
  return port;
}

function normalizeReadyTimeoutMs(options = {}) {
  const configured = options.readyTimeoutMs ?? options.env?.YANCE_BACKEND_STARTUP_TIMEOUT_MS ?? 30000;
  const readyTimeoutMs = Number(configured);
  if (!Number.isInteger(readyTimeoutMs) || readyTimeoutMs < 100) {
    throw startupFailure('M1_READY_TIMEOUT_INVALID', 'Backend ready timeout must be at least 100ms', { readyTimeoutMs: configured });
  }
  return Math.min(180000, readyTimeoutMs);
}

function validateReleaseStartupConfig(releaseStartupConfig = {}, fsApi = fs) {
  if (!releaseStartupConfig || typeof releaseStartupConfig !== 'object') {
    throw startupFailure('M1_RELEASE_CONTRACT_INVALID', 'Release startup config is required');
  }
  for (const field of ['resourcesPath', 'expectedBuildId', 'manifestSha256']) {
    if (typeof releaseStartupConfig[field] !== 'string' || !releaseStartupConfig[field]) {
      throw startupFailure('M1_RELEASE_CONTRACT_INVALID', `Release startup config requires ${field}`, { field });
    }
  }
  if (!/^[0-9a-f]{64}$/.test(releaseStartupConfig.manifestSha256)) {
    throw startupFailure('M1_RELEASE_CONTRACT_INVALID', 'Release manifest SHA256 must be lowercase SHA256', { field: 'manifestSha256' });
  }
  for (const field of ['manifestPath', 'releaseManifestPath']) {
    if (releaseStartupConfig[field] && !pathExists(releaseStartupConfig[field], fsApi)) {
      throw startupFailure('M1_RELEASE_MANIFEST_MISSING', 'Release manifest file declared by contract does not exist', { field, path: releaseStartupConfig[field] });
    }
  }
  for (const field of ['detachedHashPath', 'releaseManifestSha256Path']) {
    if (releaseStartupConfig[field] && !pathExists(releaseStartupConfig[field], fsApi)) {
      throw startupFailure('M1_RELEASE_MANIFEST_SHA256_MISSING', 'Release manifest SHA256 file declared by contract does not exist', { field, path: releaseStartupConfig[field] });
    }
  }
  return Object.freeze({ ...releaseStartupConfig });
}

function validateBackendLaunchContract(options = {}, fsApi = fs) {
  if (!options.entry || !options.cwd || !options.releaseStartupConfig) {
    throw startupFailure('M1_START_CONFIGURATION_INVALID', 'BackendProcessHost requires entry, cwd, and releaseStartupConfig');
  }
  const releaseStartupConfig = validateReleaseStartupConfig(options.releaseStartupConfig, fsApi);
  if (!pathExists(options.cwd, fsApi)) throw startupFailure('M1_APP_ROOT_MISSING', 'Backend application root does not exist', { appRoot: options.cwd });
  if (!pathExists(options.entry, fsApi)) throw startupFailure('M1_BACKEND_ENTRY_MISSING', 'Backend entry file does not exist', { backendEntryPath: options.entry });
  const nodeRuntimeExecutablePath = options.nodeRuntimeExecutablePath || options.execPath || '';
  if (!nodeRuntimeExecutablePath || !pathExists(nodeRuntimeExecutablePath, fsApi)) {
    throw startupFailure('M1_NODE_RUNTIME_MISSING', 'Backend Node runtime executable does not exist', { nodeRuntimeExecutablePath });
  }
  const env = options.env || {};
  const nodeModulesPath = env.NODE_PATH || options.nodeModulesPath || '';
  if (nodeModulesPath && !firstExistingDelimitedPath(nodeModulesPath, fsApi)) {
    throw startupFailure('M1_NODE_MODULES_MISSING', 'Backend NODE_PATH does not contain an existing node_modules directory', { nodeModulesPath });
  }
  return Object.freeze({
    appRoot: options.cwd,
    backendEntryPath: options.entry,
    nodeRuntimeExecutablePath,
    nodeModulesPath,
    backendPort: normalizeBackendPort(options, env),
    readyTimeoutMs: normalizeReadyTimeoutMs(options),
    releaseStartupConfig
  });
}

function startupFailure(reasonCode, message, details = {}) {
  const error = new Error(message);
  error.reasonCode = reasonCode;
  Object.assign(error, details);
  return error;
}

const CREDENTIAL_HANDSHAKE_FIELDS = Object.freeze([
  'pid', 'startupNonce', 'vaultEpoch', 'generation', 'authorityEventId', 'authorityHeadDigest',
  'vaultReferenceCount', 'decryptedEntryCount', 'frameEntryCount', 'entryCount', 'payloadBytes',
  'restoredReferenceCount'
]);
const READY_AUTHORITY_RECEIPT_FIELDS = Object.freeze([
  'accepted', 'mode', 'vaultEpoch', 'initialGeneration', 'readyGeneration', 'authorityEventId',
  'authorityHeadDigest', 'referenceCount', 'payloadBytes', 'committedAdvanceCount',
  'ownerSessionMatched', 'journalHeadMatched'
]);

function credentialHandshakeDifferences(message, expected) {
  const missing = CREDENTIAL_HANDSHAKE_FIELDS.filter(field => !Object.prototype.hasOwnProperty.call(message || {}, field));
  const mismatches = CREDENTIAL_HANDSHAKE_FIELDS.filter(field => Object.prototype.hasOwnProperty.call(message || {}, field) && message[field] !== expected[field]);
  return Object.freeze({ missing, mismatches, exact: missing.length === 0 && mismatches.length === 0 });
}

function assertCredentialHandshakeBinding(message, expected, phase) {
  const differences = credentialHandshakeDifferences(message, expected);
  if (!differences.exact) {
    throw startupFailure('DESKTOP_CREDENTIAL_HYDRATION_ACK_MISMATCH', `Credential ${phase} metadata does not match the transmitted snapshot`, {
      missingFields: differences.missing,
      mismatchedFields: differences.mismatches
    });
  }
  return true;
}

function createInitialReadyAuthorityReceipt(readyMetadata, initialMetadata) {
  return Object.freeze({
    accepted: true,
    mode: 'INITIAL_FD5_EXACT',
    vaultEpoch: readyMetadata.vaultEpoch,
    initialGeneration: initialMetadata.generation,
    readyGeneration: readyMetadata.generation,
    authorityEventId: readyMetadata.authorityEventId,
    authorityHeadDigest: readyMetadata.authorityHeadDigest,
    referenceCount: readyMetadata.vaultReferenceCount,
    payloadBytes: readyMetadata.payloadBytes,
    committedAdvanceCount: 0,
    ownerSessionMatched: true,
    journalHeadMatched: true
  });
}

function assertReadyCredentialAuthorityReceipt(receipt, readyMetadata, initialMetadata) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt) || !Object.isFrozen(receipt)) {
    throw startupFailure('DESKTOP_CREDENTIAL_READY_AUTHORITY_RECEIPT_INVALID', 'Credential READY authority validator must return a frozen receipt');
  }
  const keys = Object.keys(receipt).sort();
  const expectedKeys = [...READY_AUTHORITY_RECEIPT_FIELDS].sort();
  if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) {
    throw startupFailure('DESKTOP_CREDENTIAL_READY_AUTHORITY_RECEIPT_INVALID', 'Credential READY authority receipt has an unexpected shape', { receiptFields: keys });
  }
  const mode = String(receipt.mode || '');
  const advanced = mode === 'SAME_OWNER_PRE_READY_FD6_COMMITTED_ADVANCE';
  const exact = mode === 'INITIAL_FD5_EXACT';
  const generationAdvance = Number(readyMetadata.generation) - Number(initialMetadata.generation);
  const valid = receipt.accepted === true
    && (exact || advanced)
    && receipt.vaultEpoch === readyMetadata.vaultEpoch
    && Number(receipt.initialGeneration) === Number(initialMetadata.generation)
    && Number(receipt.readyGeneration) === Number(readyMetadata.generation)
    && receipt.authorityEventId === readyMetadata.authorityEventId
    && receipt.authorityHeadDigest === readyMetadata.authorityHeadDigest
    && Number(receipt.referenceCount) === Number(readyMetadata.vaultReferenceCount)
    && Number(receipt.payloadBytes) === Number(readyMetadata.payloadBytes)
    && receipt.ownerSessionMatched === true
    && receipt.journalHeadMatched === true
    && ((exact && generationAdvance === 0 && Number(receipt.committedAdvanceCount) === 0)
      || (advanced && generationAdvance > 0 && Number(receipt.committedAdvanceCount) === generationAdvance));
  if (!valid) {
    throw startupFailure('DESKTOP_CREDENTIAL_READY_AUTHORITY_RECEIPT_INVALID', 'Credential READY authority receipt does not bind the current metadata to the initial FD5 boundary');
  }
  return receipt;
}

class BackendProcessHost {
  constructor(options = {}) {
    this.fork = options.fork || childProcess.fork;
    this.probeNodeRuntime = options.probeNodeRuntime || probeNodeRuntimeExecutable;
    this.randomBytes = options.randomBytes || crypto.randomBytes;
    this.randomUUID = options.randomUUID || crypto.randomUUID;
    this.killProcess = options.killProcess || ((pid, signal) => process.kill(pid, signal));
    this.isProcessAlive = options.isProcessAlive || (pid => {
      const value = Number(pid || 0);
      if (!Number.isInteger(value) || value < 1) return false;
      try { this.killProcess(value, 0); return true; }
      catch (cause) { return cause?.code !== 'ESRCH'; }
    });
    this.encodeStartupFrame = options.encodeStartupFrame || encodeStartupFrame;
    this.createCredentialCustodyServer = options.createCredentialCustodyServer || (() => net.createServer());
    this.log = options.log || (() => {});
    this.child = null;
    this.session = null;
    this.startAttempt = null;
    this.state = PROCESS_STATES.NOT_STARTED;
    this.stateHistory = [{ state: this.state, at: new Date().toISOString(), reason: 'constructed' }];
    this.lastExit = null;
    this.lastFailure = null;
    this.lastStartCancellation = null;
    this.operation = Promise.resolve();
    this.credentialIpcHost = new CredentialIpcHost({ enabled: true });
    this.credentialCustodyHost = null;
    this.credentialCustodyServer = null;
    this.defaultCredentialVaultEpoch = this.randomUUID();
    this.defaultCredentialGeneration = 0;
    this.ownerExitRecoveryByChild = new WeakMap();
    this.lastOwnerExitRecovery = null;
    this.ownerRegistry = options.ownerRegistry || new BackendOwnerRegistry({
      file: options.ownerRecordPath || '',
      fs: options.fs,
      clock: options.clock,
      isProcessAlive: this.isProcessAlive,
      captureIdentity: options.captureProcessIdentity
    });
    this.ownerRegistryFailure = this.ownerRegistry.loadFailure || null;
    this.autoRecoverRejectedOwner = options.autoRecoverRejectedOwner === true;
    this.orphanOwnerRecord = null;
    this.rejectedOwner = null;
    this._restoreOwnerRegistry();
  }

  _restoreOwnerRegistry() {
    const record = this.ownerRegistry.snapshot();
    if (!record || record.ownershipActive !== true) return;
    const probe = this.ownerRegistry.probe(record);
    this.orphanOwnerRecord = Object.freeze({ ...record, probe });
    const base = {
      backendPid: Number(record.backendPid || 0),
      startupNonce: String(record.startupNonce || ''),
      backendSessionId: String(record.backendSessionId || ''),
      fd6PipeInstanceId: String(record.fd6PipeInstanceId || ''),
      childStillLive: probe.alive === true && probe.identityMatch !== false,
      pidIdentityMatch: probe.identityMatch,
      restoredFromOwnerRegistry: true,
      markedAtUtc: new Date().toISOString()
    };
    if (probe.identityMatch === false) {
      this.ownerRegistryFailure = {
        reasonCode: 'WP4_DESKTOP_BACKEND_OWNER_IDENTITY_MISMATCH_RECOVERY_REQUIRED',
        message: 'Persisted backend owner PID now resolves to a different process identity; explicit recovery is required',
        backendPid: Number(record.backendPid || 0),
        probe,
        recoveryRequired: true,
        atUtc: new Date().toISOString()
      };
      this.rejectedOwner = Object.freeze({ ...base, reasonCode: 'WP4_DESKTOP_ORPHAN_OWNER_PID_REUSED', childStillLive: false });
      this._transition(PROCESS_STATES.STOPPED, 'orphan-owner-pid-reused-recovery-required', { backendPid: Number(record.backendPid || 0) });
      return;
    }
    if (probe.alive === true && probe.identityMatch === null) {
      this.ownerRegistryFailure = {
        reasonCode: 'WP4_DESKTOP_BACKEND_OWNER_IDENTITY_UNVERIFIED_RECOVERY_REQUIRED',
        message: 'Persisted backend owner is live but its process identity cannot be verified; replacement is fail-closed',
        backendPid: Number(record.backendPid || 0),
        probe,
        recoveryRequired: true,
        atUtc: new Date().toISOString()
      };
      this.rejectedOwner = Object.freeze({ ...base, reasonCode: probe.reasonCode === 'OWNER_LIVENESS_EPERM' ? 'WP4_DESKTOP_ORPHAN_OWNER_LIVENESS_EPERM' : 'WP4_DESKTOP_ORPHAN_OWNER_IDENTITY_UNVERIFIED' });
      this._transition(PROCESS_STATES.STOPPING, 'orphan-owner-identity-unverified', { backendPid: Number(record.backendPid || 0), identityReasonCode: probe.reasonCode });
      return;
    }
    if (probe.alive === true) {
      this.rejectedOwner = Object.freeze({ ...base, reasonCode: 'WP4_DESKTOP_ORPHAN_OWNER_RESTORED' });
      this._transition(PROCESS_STATES.STOPPING, 'orphan-owner-restored', { backendPid: Number(record.backendPid || 0), identityReasonCode: probe.reasonCode });
      return;
    }
    this.rejectedOwner = Object.freeze({ ...base, reasonCode: 'WP4_DESKTOP_ORPHAN_OWNER_EXIT_RECOVERY_REQUIRED', childStillLive: false });
    this._transition(PROCESS_STATES.STOPPED, 'orphan-owner-exit-recovery-required', { backendPid: Number(record.backendPid || 0), identityReasonCode: probe.reasonCode });
  }

  _transition(state, reason, detail = {}) {
    this.state = state;
    this.stateHistory.push({ state, at: new Date().toISOString(), reason: String(reason || ''), ...detail });
    if (this.stateHistory.length > 150) this.stateHistory.shift();
  }

  _enqueue(operation) {
    const next = this.operation.catch(() => {}).then(operation);
    this.operation = next.catch(() => {});
    return next;
  }

  getApiSessionToken() { return (this.rejectedOwner || this.ownerRegistryFailure) ? '' : (this.session?.apiSessionToken || ''); }

  getApiSessionBinding(options = {}) {
    const session = this.session;
    const snapshot = this.snapshot();
    if (!session || snapshot.running !== true || snapshot.apiSessionEstablished !== true || this.rejectedOwner || this.ownerRegistryFailure) return null;
    const ownerContext = session.ownerContext || {};
    const binding = {
      backendPid: Number(session.backendPid || snapshot.backendPid || 0),
      startupNonce: String(session.startupNonce || ''),
      backendSessionId: String(session.backendSessionId || ''),
      fd6PipeInstanceId: String(session.fd6PipeInstanceId || ''),
      ownerSessionId: String(ownerContext.ownerSessionId || ownerContext.authorityEventId || session.credentialAuthorityEventId || session.backendSessionId || ''),
      ownerTrusted: snapshot.ownerTrusted === true
    };
    if (options.includeToken === true) binding.apiSessionToken = String(session.apiSessionToken || '');
    return Object.freeze(binding);
  }

  _recordFailure(reasonCode, child) {
    this.lastFailure = Object.freeze({ reasonCode: reasonCode || 'DESKTOP_BACKEND_OPERATION_FAILED', at: new Date().toISOString(), backendPid: child?.pid || 0 });
  }

  _bindChildLifecycle(child, attempt) {
    const lifecycleMessages = [];
    child.__desktopHostLifecycleMessages = lifecycleMessages;
    const onMessage = message => {
      if (!message || typeof message !== 'object') return;
      if (!['backend:ready', 'backend:startup-failed', 'backend:credential-hydrated'].includes(message.type)) return;
      lifecycleMessages.push({ ...message, observedAt: new Date().toISOString() });
      if (lifecycleMessages.length > 32) lifecycleMessages.shift();
      if (message.type === 'backend:startup-failed' && !attempt.error) {
        attempt.error = startupFailure(message.reasonCode || message.code || 'DESKTOP_BACKEND_START_FAILED', message.message || 'Backend startup failed', {
          backendPid: child.pid || 0,
          phase: String(message.phase || ''),
          stackHash: String(message.stackHash || ''),
          causeCodeHash: String(message.causeCodeHash || ''),
          runtimeSubphase: String(message.runtimeSubphase || '')
        });
        attempt.error.phase = String(message.phase || '');
        attempt.error.stackHash = String(message.stackHash || '');
        attempt.error.causeCodeHash = String(message.causeCodeHash || '');
        attempt.error.runtimeSubphase = String(message.runtimeSubphase || '');
        attempt.cancelled = true;
        this.lastStartCancellation = Object.freeze({ reasonCode: attempt.error.reasonCode || 'DESKTOP_BACKEND_START_FAILED', source: 'backend:startup-failed', backendPid: child.pid || 0, at: new Date().toISOString(), observedAtMs: Date.now() });
        if (!attempt.abortController?.signal?.aborted) attempt.abortController?.abort?.(attempt.error);
        this._recordFailure(attempt.error.reasonCode, child);
        if (this.child === child && this.state === PROCESS_STATES.STARTING) this._transition(PROCESS_STATES.START_FAILED, attempt.error.reasonCode, { backendPid: child.pid || 0 });
      }
    };
    const onError = cause => {
      if (!attempt.error) attempt.error = startupFailure('DESKTOP_BACKEND_CHILD_ERROR', 'Backend child emitted an asynchronous error', { causeCode: cause?.code || '', backendPid: child.pid || 0 });
      attempt.cancelled = true;
      this.lastStartCancellation = Object.freeze({ reasonCode: attempt.error.reasonCode || 'DESKTOP_BACKEND_CHILD_ERROR', source: 'child-error', backendPid: child.pid || 0, at: new Date().toISOString(), observedAtMs: Date.now() });
      if (!attempt.abortController?.signal?.aborted) attempt.abortController?.abort?.(attempt.error);
      this._recordFailure(attempt.error.reasonCode, child);
      if (this.child === child && this.state === PROCESS_STATES.STARTING) {
        this._transition(PROCESS_STATES.START_FAILED, attempt.error.reasonCode, { backendPid: child.pid || 0 });
      } else if (this.child === child && this.state === PROCESS_STATES.RUNNING) {
        this._transition(PROCESS_STATES.CRASHED, attempt.error.reasonCode, { backendPid: child.pid || 0 });
        this.session = null;
        this.credentialIpcHost.close();
        this.credentialCustodyHost?.close?.();
        this.credentialCustodyHost = null;
      }
    };
    const onExit = (exitCode, signalCode) => {
      child.__desktopHostExited = true;
      child.exitCode = exitCode;
      child.signalCode = signalCode;
      attempt.exit = { exitCode: exitCode ?? null, signalCode: signalCode || null };
      attempt.cancelled = true;
      const stateAtExit = this.state;
      const expected = stateAtExit === PROCESS_STATES.STOPPING || stateAtExit === PROCESS_STATES.START_FAILED;
      if (stateAtExit === PROCESS_STATES.STARTING && !attempt.error) {
        attempt.error = startupFailure('DESKTOP_BACKEND_EXIT_DURING_START', 'Backend exited before startup handshake completed', { backendPid: child.pid || 0, exitCode: exitCode ?? null, signalCode: signalCode || null });
      }
      if (attempt.error && !attempt.abortController?.signal?.aborted) attempt.abortController?.abort?.(attempt.error);
      this.lastExit = Object.freeze({ backendPid: child.pid || 0, exitCode: exitCode ?? null, signalCode: signalCode || null, expected, at: new Date().toISOString() });
      if (this.child !== child) return;
      if (stateAtExit === PROCESS_STATES.STOPPING) this._transition(PROCESS_STATES.STOPPED, 'child-exited-after-stop', { backendPid: child.pid || 0, exitCode, signalCode });
      else if (stateAtExit === PROCESS_STATES.STARTING) {
        this._recordFailure('DESKTOP_BACKEND_EXIT_DURING_START', child);
        this._transition(PROCESS_STATES.START_FAILED, 'DESKTOP_BACKEND_EXIT_DURING_START', { backendPid: child.pid || 0, exitCode, signalCode });
      } else if (stateAtExit !== PROCESS_STATES.START_FAILED) this._transition(PROCESS_STATES.CRASHED, 'unexpected-child-exit', { backendPid: child.pid || 0, exitCode, signalCode });
      const ownerContext = this.session?.ownerContext || attempt.ownerContext || null;
      this.credentialIpcHost.close();
      this.credentialCustodyHost?.close?.();
      this.credentialCustodyHost = null;
      const recoveryPromise = ownerContext && typeof attempt.handleBackendOwnerExit === 'function'
        ? Promise.resolve().then(() => attempt.handleBackendOwnerExit(ownerContext)).then(
          result => { this.lastOwnerExitRecovery = { status: 'PASS', ownerContext, result, at: new Date().toISOString() }; return result; },
          error => { this.lastOwnerExitRecovery = { status: 'FAIL', ownerContext, reasonCode: error.reasonCode || error.code || 'WP4_CREDENTIAL_OWNER_EXIT_RECOVERY_FAILED', at: new Date().toISOString() }; throw error; }
        )
        : Promise.resolve({ recovered: true, notRequired: true });
      this.ownerExitRecoveryByChild.set(child, recoveryPromise);
      if (this.rejectedOwner && Number(this.rejectedOwner.backendPid || 0) === Number(child.pid || 0)) {
        this.rejectedOwner = Object.freeze({ ...this.rejectedOwner, childStillLive: false, exitedAtUtc: new Date().toISOString(), exitCode: exitCode ?? null, signalCode: signalCode || null });
      }
      try { this.ownerRegistry.markExited({ exitCode, signalCode, reasonCode: expected ? 'OWNER_EXIT_CONFIRMED' : 'OWNER_EXIT_UNEXPECTED' }); }
      catch (registryCause) { this.ownerRegistryFailure = { reasonCode: 'WP4_DESKTOP_BACKEND_OWNER_REGISTRY_EXIT_WRITE_FAILED', message: registryCause.message, atUtc: new Date().toISOString() }; }
      this.orphanOwnerRecord = this.ownerRegistry.snapshot();
      this.child = null;
      this.session = null;
    };
    child.on?.('message', onMessage);
    child.on?.('error', onError);
    child.once?.('exit', onExit);
    attempt.listeners = { onMessage, onError, onExit };
  }

  _assertStartStillValid(child, attempt, phase) {
    let error = null;
    if (attempt.error) error = attempt.error;
    else if (attempt.exit || processExited(child)) error = startupFailure('DESKTOP_BACKEND_EXIT_DURING_START', `Backend exited during startup (${phase})`, { backendPid: child?.pid || 0 });
    else if (attempt.cancelled) error = startupFailure('DESKTOP_BACKEND_START_CANCELLED', `Backend startup was cancelled (${phase})`, { backendPid: child?.pid || 0 });
    else if (this.child !== child) error = startupFailure('DESKTOP_BACKEND_START_OWNERSHIP_LOST', `Backend child ownership changed during startup (${phase})`, { backendPid: child?.pid || 0 });
    else if (this.state !== PROCESS_STATES.STARTING) error = startupFailure('DESKTOP_BACKEND_START_STATE_INVALID', `Backend startup state changed to ${this.state} (${phase})`, { backendPid: child?.pid || 0 });
    if (error) throw error;
  }

  _cancelStartAttempt(reasonCode = 'DESKTOP_BACKEND_START_CANCELLED', message = 'Backend startup was cancelled') {
    const attempt = this.startAttempt;
    if (this.state !== PROCESS_STATES.STARTING || !attempt) return false;
    attempt.cancelled = true;
    if (!attempt.error) attempt.error = startupFailure(reasonCode, message, { backendPid: this.child?.pid || 0 });
    this.lastStartCancellation = Object.freeze({ reasonCode: attempt.error.reasonCode || reasonCode, source: 'host-cancel', backendPid: this.child?.pid || 0, at: new Date().toISOString(), observedAtMs: Date.now() });
    if (!attempt.abortController?.signal?.aborted) attempt.abortController?.abort?.(attempt.error);
    return true;
  }

  _disposeChildHandles(child) {
    if (!child) return;
    for (const stream of child.stdio || []) { try { stream?.destroy?.(); } catch (_) {} }
    try { if (child.connected) child.disconnect(); } catch (_) {}
  }

  async _awaitSpawnIdentity(child, attempt, timeoutMs = 2000) {
    if (Number.isInteger(child?.pid) && child.pid > 0) return child.pid;
    const deadline = Date.now() + Math.max(100, Number(timeoutMs || 2000));
    while (Date.now() < deadline) {
      if (attempt.error) throw attempt.error;
      if (attempt.exit || processExited(child)) throw startupFailure('DESKTOP_BACKEND_EXIT_DURING_START', 'Backend exited before exposing a valid PID', { backendPid: child?.pid || 0 });
      if (Number.isInteger(child?.pid) && child.pid > 0) return child.pid;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    if (attempt.error) throw attempt.error;
    throw startupFailure('DESKTOP_BACKEND_PID_INVALID', 'Backend child process did not expose a valid PID');
  }

  async _writeStartupFrame(controlPipe, encoded, timeoutMs, signal = null) {
    await new Promise((resolve, reject) => {
      let settled = false;
      const finish = error => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        controlPipe.removeListener?.('error', onError);
        signal?.removeEventListener?.('abort', onAbort);
        if (error) reject(error); else resolve();
      };
      const onError = cause => finish(startupFailure('DESKTOP_STARTUP_PIPE_WRITE_FAILED', `Dedicated backend startup pipe failed: ${cause.message}`, { cause }));
      const onAbort = () => {
        const reason = signal?.reason;
        finish(reason instanceof Error ? reason : startupFailure('DESKTOP_BACKEND_START_CANCELLED', 'Backend startup was cancelled while writing the startup frame'));
      };
      const timer = setTimeout(() => finish(startupFailure('DESKTOP_STARTUP_PIPE_WRITE_TIMEOUT', 'Dedicated backend startup pipe write timed out')), Math.max(100, Number(timeoutMs || 10000)));
      controlPipe.once?.('error', onError);
      signal?.addEventListener?.('abort', onAbort, { once: true });
      if (signal?.aborted) return onAbort();
      try {
        controlPipe.write(encoded, error => {
          if (error) return onError(error);
          try { controlPipe.end(); } catch (_) {}
          finish();
        });
      } catch (cause) { onError(cause); }
    });
  }

  async _waitForChildMessage(child, predicate, options = {}) {
    const timeoutMs = Math.max(25, Number(options.timeoutMs || 10000));
    const signal = options.signal || null;
    const phase = options.phase || 'startup handshake';
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error, message) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.removeListener?.('message', onMessage);
        child.removeListener?.('exit', onExit);
        child.removeListener?.('error', onError);
        signal?.removeEventListener?.('abort', onAbort);
        if (error) reject(error); else resolve(message);
      };
      const onMessage = message => {
        if (message?.type === 'backend:startup-failed') return finish(startupFailure(message.reasonCode || message.code || 'DESKTOP_BACKEND_START_FAILED', message.message || `Backend reported startup failure during ${phase}`, { backendPid: child.pid || 0, phase: message.phase || '' }));
        let accepted = false;
        try { accepted = predicate(message); } catch (cause) { return finish(cause); }
        if (accepted) finish(null, message);
      };
      const onExit = (exitCode, signalCode) => finish(startupFailure('DESKTOP_BACKEND_EXIT_DURING_START', `Backend exited before ${phase} completed`, { backendPid: child.pid || 0, exitCode: exitCode ?? null, signalCode: signalCode || null }));
      const onError = cause => finish(startupFailure('DESKTOP_BACKEND_CHILD_ERROR', `Backend child failed during ${phase}`, { backendPid: child.pid || 0, causeCode: cause?.code || '' }));
      const onAbort = () => {
        const reason = signal?.reason;
        finish(reason instanceof Error ? reason : startupFailure('DESKTOP_BACKEND_START_CANCELLED', `Backend startup was cancelled during ${phase}`, { backendPid: child.pid || 0 }));
      };
      const timer = setTimeout(() => finish(startupFailure('DESKTOP_BACKEND_START_TIMEOUT', `Backend did not complete ${phase} before timeout`, { backendPid: child.pid || 0, timeoutMs })), timeoutMs);
      child.on?.('message', onMessage);
      child.once?.('exit', onExit);
      child.once?.('error', onError);
      signal?.addEventListener?.('abort', onAbort, { once: true });
      if (signal?.aborted) onAbort();
      for (const message of child.__desktopHostLifecycleMessages || []) {
        if (settled) break;
        onMessage(message);
      }
    });
  }

  async _resolveCredentialSnapshot(options, context) {
    const hasVaultHost = options.credentialVaultHost && typeof options.credentialVaultHost.createHydrationFrame === 'function';
    const createSnapshot = hasVaultHost
      ? input => options.credentialVaultHost.createHydrationFrame(input)
      : (typeof options.createCredentialSnapshot === 'function' ? options.createCredentialSnapshot : null);
    const credentialHandshakeRequired = options.credentialHandshakeRequired !== false;
    if (!createSnapshot) {
      if (credentialHandshakeRequired) throw startupFailure('DESKTOP_CREDENTIAL_VAULT_HOST_REQUIRED', 'Backend startup requires the CredentialVaultHost FD5 frame authority');
      return null;
    }
    const created = await createSnapshot(context);
    if (!created) {
      if (credentialHandshakeRequired) throw startupFailure('DESKTOP_CREDENTIAL_VAULT_HOST_REQUIRED', 'CredentialVaultHost did not provide an FD5 frame');
      return null;
    }
    const frame = created.frame || created;
    const resetAuthorization = created.resetAuthorization || null;
    const ownerSession = created.ownerSession || null;
    return Object.freeze({ frame, resetAuthorization, ownerSession, source: hasVaultHost ? 'CredentialVaultHost' : 'custom' });
  }

  async _createCustodyServer(pipeName, custodyHost, timeoutMs = 10000) {
    const server = this.createCredentialCustodyServer();
    await new Promise((resolve, reject) => {
      let settled = false;
      const finish = error => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        server.removeListener?.('error', onError);
        if (error) reject(error); else resolve();
      };
      const onError = cause => finish(startupFailure('DESKTOP_CREDENTIAL_CUSTODY_SERVER_FAILED', `Credential custody server failed: ${cause.message}`, { cause }));
      const timer = setTimeout(() => finish(startupFailure('DESKTOP_CREDENTIAL_CUSTODY_SERVER_TIMEOUT', 'Credential custody server did not bind before timeout')), Math.max(100, Number(timeoutMs || 10000)));
      server.once?.('error', onError);
      server.listen(pipeName, () => finish());
    });
    server.on('connection', socket => custodyHost.accept(socket));
    return server;
  }

  _bindCredentialCustodyHost(options = {}, context = {}) {
    const vaultHost = options.credentialVaultHost;
    if (!vaultHost || typeof vaultHost.prepareCustodyTransaction !== 'function') {
      throw startupFailure('DESKTOP_CREDENTIAL_VAULT_HOST_REQUIRED', 'FD6 credential custody requires CredentialVaultHost transactional methods');
    }
    const custody = new CredentialCustodyHost({
      enabled: true,
      timeoutMs: options.credentialCustodyTimeoutMs || CREDENTIAL_HYDRATION_TIMEOUT_MS,
      prepare: request => vaultHost.prepareCustodyTransaction(request),
      commit: request => vaultHost.commitCustodyTransaction(request),
      abort: (request, reasonCode) => vaultHost.abortCustodyTransaction(request, reasonCode),
      query: request => vaultHost.queryCustodyTransaction(request),
      ownerSession: context.ownerSession,
      pipeInstanceId: context.fd6PipeInstanceId
    });
    this.credentialCustodyHost = custody;
    return custody;
  }

  async _terminateAndWait(child, options = {}) {
    if (!child || processExited(child)) return { exited: true, forced: false, exitCode: child?.exitCode ?? null, signalCode: child?.signalCode ?? null };
    const gracefulMs = Math.max(0, Number(options.gracefulMs ?? 5000));
    const forceMs = Math.max(100, Number(options.forceMs ?? 5000));
    const reason = String(options.reason || 'desktop-host-stop');
    try { if (child.connected && typeof child.send === 'function') child.send({ type: 'desktop:shutdown', reason }); } catch (_) {}
    let waited = await waitForExit(child, gracefulMs);
    if (waited.exited) return { ...waited, forced: false };
    try { child.kill?.('SIGTERM'); } catch (_) {}
    waited = await waitForExit(child, forceMs);
    if (waited.exited) return { ...waited, forced: true, signal: 'SIGTERM' };
    try { child.kill?.('SIGKILL'); } catch (_) {}
    waited = await waitForExit(child, forceMs);
    if (!waited.exited) throw startupFailure('DESKTOP_BACKEND_STOP_TIMEOUT', 'Backend process did not exit after forced termination', { backendPid: child.pid || 0 });
    return { ...waited, forced: true, signal: 'SIGKILL' };
  }

  async _recoverStartFailure(child, attempt, error) {
    this._recordFailure(error.reasonCode || error.code || 'DESKTOP_BACKEND_START_FAILED', child);
    if (this.child === child && this.state === PROCESS_STATES.STARTING) this._transition(PROCESS_STATES.START_FAILED, error.reasonCode || error.code || 'DESKTOP_BACKEND_START_FAILED', { backendPid: child?.pid || 0 });
    try { await this._terminateAndWait(child, { gracefulMs: 0, forceMs: 2000, reason: 'startup-failed' }); } catch (_) {}
    this.credentialIpcHost.close();
    this.credentialCustodyHost?.close?.();
    this.credentialCustodyHost = null;
    if (this.credentialCustodyServer) {
      try { await new Promise(resolve => this.credentialCustodyServer.close(() => resolve())); } catch (_) {}
      this.credentialCustodyServer = null;
    }
    const ownerContext = attempt.ownerContext || null;
    if (ownerContext && typeof attempt.handleBackendOwnerExit === 'function') {
      try {
        const result = await attempt.handleBackendOwnerExit(ownerContext);
        this.lastOwnerExitRecovery = { status: 'PASS', ownerContext, result, at: new Date().toISOString() };
      } catch (recoveryError) {
        this.lastOwnerExitRecovery = { status: 'FAIL', ownerContext, reasonCode: recoveryError.reasonCode || recoveryError.code || 'WP4_CREDENTIAL_OWNER_EXIT_RECOVERY_FAILED', at: new Date().toISOString() };
      }
    }
    try { this.ownerRegistry.markRejected({ reasonCode: error.reasonCode || error.code || 'DESKTOP_BACKEND_START_FAILED' }); } catch (_) {}
    this.orphanOwnerRecord = this.ownerRegistry.snapshot();
    this._disposeChildHandles(child);
    if (this.child === child) this.child = null;
    this.session = null;
  }

  async _ensureStartable(options = {}) {
    if (this.ownerRegistryFailure) throw startupFailure(this.ownerRegistryFailure.reasonCode || 'WP4_DESKTOP_BACKEND_OWNER_REGISTRY_UNAVAILABLE', this.ownerRegistryFailure.message || 'Backend owner registry requires recovery', { ownerRegistryFailure: this.ownerRegistryFailure });
    if (this.rejectedOwner) {
      if (this.autoRecoverRejectedOwner || options.autoRecoverRejectedOwner === true) {
        await this.clearRejectedOwner({ requireExit: true, recoverOwnerExit: true });
      } else {
        throw startupFailure('WP4_DESKTOP_BACKEND_REJECTED_OWNER_PRESENT', 'A rejected or orphaned backend owner must be recovered before replacement', { rejectedOwner: this.rejectedOwner });
      }
    }
    if (this.child && !processExited(this.child)) throw startupFailure('DESKTOP_BACKEND_ALREADY_RUNNING', 'Backend process is already owned by this host', { backendPid: this.child.pid || 0 });
    if (this.state === PROCESS_STATES.STARTING || this.state === PROCESS_STATES.STOPPING) throw startupFailure('DESKTOP_BACKEND_OPERATION_IN_PROGRESS', `Backend process is ${this.state}`);
  }

  start(options = {}) { return this._enqueue(() => this._startUnlocked(options)); }

  async _startUnlocked(options = {}) {
    await this._ensureStartable(options);
    const launch = validateBackendLaunchContract(options, options.fs || fs);
    const runtimeProbe = this.probeNodeRuntime(launch.nodeRuntimeExecutablePath, { cwd: launch.appRoot, env: options.env || process.env, spawnSync: options.spawnSync, timeoutMs: options.nodeRuntimeProbeTimeoutMs });
    const startupNonce = this.randomBytes(24).toString('base64url');
    const apiSessionToken = createApiSessionToken(() => this.randomBytes(32));
    const startupAttemptId = this.randomUUID();
    const backendSessionId = `backend-session:${this.randomUUID()}`;
    const fd6PipeInstanceId = `fd6:${this.randomUUID()}`;
    const credentialOneTimeToken = createCredentialOneTimeToken(() => this.randomBytes(32));
    const credentialTimeoutMs = Math.max(100, Number(options.credentialTimeoutMs || CREDENTIAL_HYDRATION_TIMEOUT_MS));
    const readyTimeoutMs = launch.readyTimeoutMs;
    const env = sanitizedEnvironment({ ...(options.env || process.env), YANCE_RUNTIME_MODE: RUNTIME_MODE_DESKTOP_HOSTED });
    env.YANCE_PORT = String(launch.backendPort);
    const abortController = new AbortController();
    const attempt = {
      startupAttemptId, cancelled: false, error: null, exit: null, listeners: null, abortController,
      ownerContext: null,
      handleBackendOwnerExit: options.credentialVaultHost && typeof options.credentialVaultHost.handleBackendOwnerExit === 'function'
        ? context => options.credentialVaultHost.handleBackendOwnerExit(context)
        : null
    };
    this.startAttempt = attempt;
    this._transition(PROCESS_STATES.STARTING, 'start-requested');

    let child = null;
    let custodyServer = null;
    let outputTail = null;
    try {
      const stdio = ['ignore', 'pipe', 'pipe', 'ipc'];
      while (stdio.length <= Math.max(CONTROL_PIPE_FD, CREDENTIAL_PIPE_FD, CREDENTIAL_CUSTODY_PIPE_FD)) stdio.push('pipe');
      child = this.fork(launch.backendEntryPath, [], {
        cwd: launch.appRoot,
        env,
        execPath: launch.nodeRuntimeExecutablePath,
        stdio,
        windowsHide: true,
        serialization: 'advanced'
      });
      this.child = child;
      outputTail = createChildOutputTail(options.childOutputTailBytes || 8192);
      outputTail.attach(child);
      this._bindChildLifecycle(child, attempt);
      const backendPid = await this._awaitSpawnIdentity(child, attempt, options.spawnIdentityTimeoutMs || 3000);
      this._assertStartStillValid(child, attempt, 'spawn');

      const prepared = await this._resolveCredentialSnapshot(options, {
        startupAttemptId,
        startupNonce,
        oneTimeToken: credentialOneTimeToken,
        backendPid,
        manifestSha256: launch.releaseStartupConfig.manifestSha256,
        backendSessionId,
        fd6PipeInstanceId
      });
      const credentialFrame = prepared?.frame || makeCredentialFrame({
        startupNonce,
        oneTimeToken: credentialOneTimeToken,
        backendPid,
        manifestSha256: launch.releaseStartupConfig.manifestSha256,
        vaultEpoch: this.defaultCredentialVaultEpoch,
        generation: this.defaultCredentialGeneration,
        authorityEventId: `event:${startupAttemptId}`,
        authorityHeadDigest: crypto.createHash('sha256').update(`head:${startupAttemptId}`).digest('hex'),
        entries: []
      });
      const credentialResetAuthorization = prepared?.resetAuthorization || null;
      const ownerSession = prepared?.ownerSession || Object.freeze({
        backendPid,
        startupNonce,
        backendSessionId,
        manifestSha256: launch.releaseStartupConfig.manifestSha256,
        vaultEpoch: credentialFrame.vaultEpoch,
        hydrationGeneration: credentialFrame.generation,
        fd6PipeInstanceId
      });
      attempt.ownerContext = ownerSession;
      const expectedCredentialMetadata = Object.freeze({
        pid: backendPid,
        startupNonce,
        vaultEpoch: credentialFrame.vaultEpoch,
        generation: credentialFrame.generation,
        authorityEventId: credentialFrame.authorityEventId,
        authorityHeadDigest: credentialFrame.authorityHeadDigest,
        vaultReferenceCount: credentialFrame.vaultReferenceCount,
        decryptedEntryCount: credentialFrame.decryptedEntryCount,
        frameEntryCount: credentialFrame.frameEntryCount,
        entryCount: credentialFrame.payload.entries.length,
        payloadBytes: credentialFrame.payloadBytes,
        restoredReferenceCount: credentialFrame.payload.entries.length
      });

      const custodyPipeName = deriveCustodyPipeName(startupNonce, backendPid, fd6PipeInstanceId);
      const custodyHost = this._bindCredentialCustodyHost(options, { ownerSession, fd6PipeInstanceId });
      custodyServer = await this._createCustodyServer(custodyPipeName, custodyHost, options.credentialCustodyBindTimeoutMs || 10000);
      this.credentialCustodyServer = custodyServer;
      this._assertStartStillValid(child, attempt, 'custody-server');

      const frame = {
        protocolVersion: STARTUP_PROTOCOL_VERSION,
        startupFrameProtocolVersion: STARTUP_FRAME_PROTOCOL_VERSION,
        startupContractVersion: M1_STARTUP_CONTRACT_VERSION,
        readyProtocolVersion: READY_PROTOCOL_VERSION,
        runtimeMode: RUNTIME_MODE_DESKTOP_HOSTED,
        startupAttemptId,
        startupNonce,
        backendSessionId,
        fd6PipeInstanceId,
        apiSessionToken,
        credentialProtocolVersion: CREDENTIAL_PROTOCOL_VERSION,
        credentialTimeoutMs,
        credentialCustodyPipeName: custodyPipeName,
        release: launch.releaseStartupConfig,
        backend: {
          appRoot: launch.appRoot,
          entry: launch.backendEntryPath,
          port: launch.backendPort,
          nodeRuntimeExecutablePath: launch.nodeRuntimeExecutablePath,
          nodeModulesPath: launch.nodeModulesPath
        }
      };
      const encoded = this.encodeStartupFrame(frame);
      const controlPipe = child.stdio?.[CONTROL_PIPE_FD];
      const credentialPipe = child.stdio?.[CREDENTIAL_PIPE_FD];
      if (!controlPipe || !credentialPipe) throw startupFailure('DESKTOP_STARTUP_PIPE_MISSING', 'Backend child did not expose required dedicated startup pipes');

      const hydrationPromise = this._waitForChildMessage(child, message => message?.type === 'backend:credential-hydrated' && message.startupNonce === startupNonce, { timeoutMs: credentialTimeoutMs, signal: abortController.signal, phase: 'credential hydration acknowledgement' });
      const readyPromise = this._waitForChildMessage(child, message => message?.type === 'backend:ready' && message.startupNonce === startupNonce, { timeoutMs: readyTimeoutMs, signal: abortController.signal, phase: 'ready acknowledgement' });
      const credentialDelivery = this.credentialIpcHost.hydrate({ pipe: credentialPipe, frame: credentialFrame, timeoutMs: credentialTimeoutMs });
      await this._writeStartupFrame(controlPipe, encoded, options.startupPipeWriteTimeoutMs || 10000, abortController.signal);
      this._assertStartStillValid(child, attempt, 'startup-frame');
      const [hydration, readiness] = await Promise.all([hydrationPromise, readyPromise, credentialDelivery]).then(values => [values[0], values[1]]);
      this._assertStartStillValid(child, attempt, 'handshake');

      if (hydration?.protocolVersion !== CREDENTIAL_PROTOCOL_VERSION) throw startupFailure('DESKTOP_CREDENTIAL_PROTOCOL_MISMATCH', 'Backend credential hydration protocol version mismatch');
      assertCredentialHandshakeBinding(hydration, expectedCredentialMetadata, 'hydration acknowledgement');
      if (options.credentialVaultHost && typeof options.credentialVaultHost.markHydrationAccepted === 'function') {
        const accepted = options.credentialVaultHost.markHydrationAccepted(hydration);
        if (accepted !== true) throw startupFailure('DESKTOP_CREDENTIAL_HYDRATION_ACK_MISMATCH', 'CredentialVaultHost rejected the backend hydration acknowledgement');
      }
      if (readiness?.protocolVersion !== READY_PROTOCOL_VERSION || readiness?.startupFrameProtocolVersion !== STARTUP_FRAME_PROTOCOL_VERSION || readiness?.runtimeMode !== RUNTIME_MODE_DESKTOP_HOSTED) {
        throw startupFailure('M1_BACKEND_READY_PROTOCOL_MISMATCH', 'Backend ready acknowledgement protocol mismatch', { readiness });
      }
      if (String(readiness.startupAttemptId || '') !== startupAttemptId || String(readiness.backendSessionId || '') !== backendSessionId || String(readiness.fd6PipeInstanceId || '') !== fd6PipeInstanceId || Number(readiness.pid || 0) !== backendPid) {
        throw startupFailure('M1_BACKEND_READY_SESSION_MISMATCH', 'Backend ready acknowledgement does not match the current startup attempt');
      }

      const readyCredentialMetadata = Object.freeze({ pid: backendPid, startupNonce, ...(readiness.credentialMetadata || {}) });
      const readyDifferences = credentialHandshakeDifferences(readyCredentialMetadata, expectedCredentialMetadata);
      let readyCredentialAuthorityReceipt;
      if (readyDifferences.exact) {
        readyCredentialAuthorityReceipt = assertReadyCredentialAuthorityReceipt(
          createInitialReadyAuthorityReceipt(readyCredentialMetadata, expectedCredentialMetadata),
          readyCredentialMetadata,
          expectedCredentialMetadata
        );
      } else {
        const validateReadyAuthority = options.credentialVaultHost?.validateReadyCredentialAuthority;
        if (typeof validateReadyAuthority !== 'function') {
          throw startupFailure('DESKTOP_CREDENTIAL_READY_AUTHORITY_VALIDATOR_REQUIRED', 'Credential READY metadata advanced beyond FD5 but CredentialVaultHost did not provide the required validator', {
            missingFields: readyDifferences.missing,
            mismatchedFields: readyDifferences.mismatches
          });
        }
        const receipt = validateReadyAuthority.call(options.credentialVaultHost, {
          startupAttemptId,
          initialFrame: credentialFrame,
          hydrationAcknowledgement: hydration,
          readyMetadata: readyCredentialMetadata,
          ownerSession
        });
        readyCredentialAuthorityReceipt = assertReadyCredentialAuthorityReceipt(receipt, readyCredentialMetadata, expectedCredentialMetadata);
      }

      const readyPort = Number(readiness.port ?? launch.backendPort);
      if (!Number.isInteger(readyPort) || readyPort < 1 || readyPort > 65535) throw startupFailure('M1_BACKEND_READY_PORT_INVALID', 'Backend ready acknowledgement did not include a usable bound port', { readyPort });
      if (launch.backendPort > 0 && readyPort !== launch.backendPort) throw startupFailure('M1_BACKEND_READY_PORT_MISMATCH', 'Backend bound port does not match the configured port', { configuredPort: launch.backendPort, readyPort });
      const releaseEvidence = readiness.releaseEvidence || {};
      if (releaseEvidence.releaseBuildId !== launch.releaseStartupConfig.expectedBuildId || releaseEvidence.manifestSha256 !== launch.releaseStartupConfig.manifestSha256) {
        throw startupFailure('M1_BACKEND_READY_RELEASE_MISMATCH', 'Backend ready acknowledgement does not match the validated release contract', { expectedBuildId: launch.releaseStartupConfig.expectedBuildId, readyBuildId: releaseEvidence.releaseBuildId, expectedManifestSha256: launch.releaseStartupConfig.manifestSha256, readyManifestSha256: releaseEvidence.manifestSha256 });
      }
      if (options.readyHealthCheck !== false) {
        await probeBackendHttpReady({ port: readyPort, token: apiSessionToken, path: options.readyHealthCheckPath || '/api/health', timeoutMs: options.readyHealthCheckTimeoutMs || 5000, retries: options.readyHealthCheckRetries || 0, retryDelayMs: options.readyHealthCheckRetryDelayMs || 100 });
      }
      this._assertStartStillValid(child, attempt, 'ready-healthcheck');

      this.ownerRegistry.markOwned({
        backendPid,
        startupNonce,
        backendSessionId,
        fd6PipeInstanceId,
        manifestSha256: launch.releaseStartupConfig.manifestSha256,
        ownerContext,
        reasonCode: 'BACKEND_OWNER_READY_ACCEPTED'
      });
      this.orphanOwnerRecord = this.ownerRegistry.snapshot();
      const session = Object.freeze({
        startupAttemptId,
        startupNonce,
        backendSessionId,
        fd6PipeInstanceId,
        backendPid,
        backendPort: readyPort,
        apiSessionToken,
        appRoot: launch.appRoot,
        backendEntryPath: launch.backendEntryPath,
        nodeRuntimeExecutablePath: launch.nodeRuntimeExecutablePath,
        nodeRuntimeVersion: runtimeProbe.version,
        nodeModulesPath: launch.nodeModulesPath,
        releaseBuildId: launch.releaseStartupConfig.expectedBuildId,
        releaseManifestSha256: launch.releaseStartupConfig.manifestSha256,
        credentialProtocolVersion: CREDENTIAL_PROTOCOL_VERSION,
        credentialVaultEpoch: credentialFrame.vaultEpoch,
        credentialGeneration: credentialFrame.generation,
        credentialAuthorityEventId: credentialFrame.authorityEventId,
        credentialAuthorityHeadDigest: credentialFrame.authorityHeadDigest,
        credentialEntryCount: credentialFrame.payload.entries.length,
        credentialPayloadBytes: credentialFrame.payloadBytes,
        credentialRestoredReferenceCount: credentialFrame.payload.entries.length,
        credentialResetAuthorization,
        readyCredentialMetadata: Object.freeze({ ...(readiness.credentialMetadata || {}) }),
        readyCredentialAuthorityReceipt,
        ownerContext: Object.freeze({ ...ownerSession }),
        startedAt: new Date().toISOString()
      });
      this.session = session;
      this._transition(PROCESS_STATES.RUNNING, 'ready-accepted', { backendPid, backendPort: readyPort });
      return Object.freeze({ child, ...session, readiness: Object.freeze({ ...readiness }), hydration: Object.freeze({ ...hydration }) });
    } catch (error) {
      const output = outputTail?.snapshot?.() || {};
      if (!error.stdoutTail && output.stdoutTail) error.stdoutTail = output.stdoutTail;
      if (!error.stderrTail && output.stderrTail) error.stderrTail = output.stderrTail;
      await this._recoverStartFailure(child, attempt, error);
      throw error;
    } finally {
      if (this.startAttempt === attempt) this.startAttempt = null;
    }
  }

  async _terminateOrphanOwner(record, options = {}) {
    const pid = Number(record?.backendPid || 0);
    if (!Number.isInteger(pid) || pid < 1) return { exited: true, forced: false, backendPid: 0 };
    const initialProbe = this.ownerRegistry.probe(record);
    if (initialProbe.identityMatch === false) return { exited: true, forced: false, backendPid: pid, pidReused: true, identityReasonCode: initialProbe.reasonCode };
    if (initialProbe.alive !== true) return { exited: true, forced: false, backendPid: pid, identityReasonCode: initialProbe.reasonCode };
    if (initialProbe.identityMatch !== true) throw startupFailure('WP4_DESKTOP_BACKEND_OWNER_IDENTITY_UNVERIFIED_RECOVERY_REQUIRED', 'Cannot signal an orphan owner whose process identity is not verified', { backendPid: pid, probe: initialProbe });
    const forceMs = Math.max(100, Number(options.forceMs ?? 5000));
    try { this.killProcess(pid, 'SIGTERM'); } catch (cause) { if (cause?.code !== 'ESRCH') throw cause; }
    const deadline = Date.now() + forceMs;
    while (Date.now() < deadline) {
      const probe = this.ownerRegistry.probe(record);
      if (probe.identityMatch === false || probe.alive !== true) return { exited: true, forced: true, signal: 'SIGTERM', backendPid: pid, pidReused: probe.identityMatch === false, identityReasonCode: probe.reasonCode };
      await delay(50);
    }
    const beforeKill = this.ownerRegistry.probe(record);
    if (beforeKill.identityMatch !== true) {
      if (beforeKill.identityMatch === false || beforeKill.alive !== true) return { exited: true, forced: true, signal: 'SIGTERM', backendPid: pid, pidReused: beforeKill.identityMatch === false, identityReasonCode: beforeKill.reasonCode };
      throw startupFailure('WP4_DESKTOP_BACKEND_OWNER_IDENTITY_UNVERIFIED_RECOVERY_REQUIRED', 'Cannot force-kill an orphan owner whose identity is no longer verified', { backendPid: pid, probe: beforeKill });
    }
    try { this.killProcess(pid, 'SIGKILL'); } catch (cause) { if (cause?.code !== 'ESRCH') throw cause; }
    const forceDeadline = Date.now() + forceMs;
    while (Date.now() < forceDeadline) {
      const probe = this.ownerRegistry.probe(record);
      if (probe.identityMatch === false || probe.alive !== true) return { exited: true, forced: true, signal: 'SIGKILL', backendPid: pid, pidReused: probe.identityMatch === false, identityReasonCode: probe.reasonCode };
      await delay(50);
    }
    throw startupFailure('WP4_DESKTOP_BACKEND_ORPHAN_STOP_TIMEOUT', 'Orphan backend owner did not exit after forced termination', { backendPid: pid });
  }

  async _stopUnlocked(options = {}) {
    const child = this.child;
    if (!child) {
      if (this.rejectedOwner) {
        const rejectedOwner = this.rejectedOwner;
        const ownerRecord = this.ownerRegistry.snapshot() || this.orphanOwnerRecord || rejectedOwner;
        let terminated;
        try { terminated = await this._terminateOrphanOwner(ownerRecord, options); }
        catch (error) {
          this._recordFailure(error.reasonCode || error.code || 'DESKTOP_BACKEND_ORPHAN_STOP_FAILED', null);
          this._transition(PROCESS_STATES.STOPPING, 'orphan-owner-stop-failed', { backendPid: Number(ownerRecord?.backendPid || 0) });
          throw error;
        }
        if (!terminated.exited) return Object.freeze({ stopped: false, alreadyStopped: false, rejectedOwner: true, ...terminated });
        const ownerContext = rejectedOwner.ownerContext || ownerRecord.ownerContext || {
          backendPid: rejectedOwner.backendPid || ownerRecord.backendPid,
          startupNonce: rejectedOwner.startupNonce || ownerRecord.startupNonce,
          backendSessionId: rejectedOwner.backendSessionId || ownerRecord.backendSessionId,
          fd6PipeInstanceId: rejectedOwner.fd6PipeInstanceId || ownerRecord.fd6PipeInstanceId,
          manifestSha256: rejectedOwner.manifestSha256 || ownerRecord.manifestSha256,
          vaultEpoch: rejectedOwner.vaultEpoch || ownerRecord.vaultEpoch,
          hydrationGeneration: rejectedOwner.hydrationGeneration || ownerRecord.hydrationGeneration
        };
        if (options.recoverOwnerExit !== false && typeof options.handleBackendOwnerExit === 'function') {
          await options.handleBackendOwnerExit(ownerContext);
        }
        this.ownerRegistry.markRecovered({ reasonCode: 'ORPHAN_OWNER_EXIT_RECOVERED' });
        this.orphanOwnerRecord = this.ownerRegistry.snapshot();
        this.rejectedOwner = null;
        this.ownerRegistryFailure = null;
        this._transition(PROCESS_STATES.STOPPED, 'orphan-owner-stopped', { backendPid: Number(ownerRecord?.backendPid || 0) });
        return Object.freeze({ stopped: true, alreadyStopped: false, rejectedOwner: true, ...terminated });
      }
      if (![PROCESS_STATES.NOT_STARTED, PROCESS_STATES.STOPPED].includes(this.state)) this._transition(PROCESS_STATES.STOPPED, 'stop-without-child');
      return Object.freeze({ stopped: true, alreadyStopped: true, backendPid: 0 });
    }
    this._transition(PROCESS_STATES.STOPPING, 'stop-requested', { backendPid: child.pid || 0 });
    const ownerContext = this.session?.ownerContext || this.startAttempt?.ownerContext || null;
    const result = await this._terminateAndWait(child, options);
    const recovery = await this.waitForOwnerExitRecovery(child, options.ownerExitRecoveryTimeoutMs || 15000).catch(error => { throw error; });
    this.credentialIpcHost.close();
    this.credentialCustodyHost?.close?.();
    this.credentialCustodyHost = null;
    if (this.credentialCustodyServer) {
      await new Promise(resolve => {
        try { this.credentialCustodyServer.close(() => resolve()); } catch (_) { resolve(); }
      });
      this.credentialCustodyServer = null;
    }
    this._disposeChildHandles(child);
    if (this.child === child) this.child = null;
    this.session = null;
    this.ownerRegistry.markRecovered({ reasonCode: 'OWNER_EXIT_RECOVERED_AFTER_STOP' });
    this.orphanOwnerRecord = this.ownerRegistry.snapshot();
    this._transition(PROCESS_STATES.STOPPED, 'stop-completed', { backendPid: child.pid || 0, forced: result.forced === true });
    return Object.freeze({ stopped: true, alreadyStopped: false, backendPid: child.pid || 0, ownerContext, recovery, ...result });
  }

  stop(options = {}) {
    if (this.state === PROCESS_STATES.STARTING) this._cancelStartAttempt(options.reasonCode || 'DESKTOP_BACKEND_START_CANCELLED', options.reason || 'Backend startup cancelled by stop request');
    return this._enqueue(() => this._stopUnlocked(options));
  }

  restart(options = {}) {
    if (this.state === PROCESS_STATES.STARTING) this._cancelStartAttempt('DESKTOP_BACKEND_START_CANCELLED', 'Backend startup cancelled by restart request');
    return this._enqueue(async () => {
      await this._stopUnlocked({ ...options, reason: options.reason || 'desktop-host-restart' });
      return this._startUnlocked(options);
    });
  }

  acceptBackendOwner(context = {}) {
    if (!this.child || this.state !== PROCESS_STATES.RUNNING) throw startupFailure('WP4_DESKTOP_BACKEND_OWNER_NOT_READY', 'Backend owner can be accepted only after RUNNING');
    if (Number(context.backendPid || 0) !== Number(this.child.pid || 0)) throw startupFailure('WP4_DESKTOP_BACKEND_OWNER_PID_MISMATCH', 'Accepted backend owner PID does not match the owned child');
    const existing = this.session || {};
    this.session = Object.freeze({ ...existing, ownerAccepted: true, ownerAcceptedAt: new Date().toISOString(), ownerContext: Object.freeze({ ...(context.ownerContext || existing.ownerContext || {}) }) });
    this.ownerRegistry.markOwned({ backendPid: this.child.pid, startupNonce: this.session.startupNonce, backendSessionId: this.session.backendSessionId, fd6PipeInstanceId: this.session.fd6PipeInstanceId, manifestSha256: this.session.releaseManifestSha256, ownerContext: this.session.ownerContext, reasonCode: 'BACKEND_OWNER_EXPLICITLY_ACCEPTED' });
    this.rejectedOwner = null;
    return this.snapshot();
  }

  containRejectedOwner(context = {}) {
    const child = context.child || this.child;
    const backendPid = Number(context.backendPid || child?.pid || this.session?.backendPid || 0);
    const ownerContext = context.ownerContext || this.session?.ownerContext || this.startAttempt?.ownerContext || null;
    this.rejectedOwner = Object.freeze({
      backendPid,
      startupNonce: String(context.startupNonce || this.session?.startupNonce || ownerContext?.startupNonce || ''),
      backendSessionId: String(context.backendSessionId || this.session?.backendSessionId || ownerContext?.backendSessionId || ''),
      fd6PipeInstanceId: String(context.fd6PipeInstanceId || this.session?.fd6PipeInstanceId || ownerContext?.fd6PipeInstanceId || ''),
      reasonCode: String(context.reasonCode || 'WP4_DESKTOP_BACKEND_OWNER_REJECTED'),
      childStillLive: backendPid > 0 ? this.isProcessAlive(backendPid) : false,
      ownerContext: ownerContext ? Object.freeze({ ...ownerContext }) : null,
      markedAtUtc: new Date().toISOString()
    });
    this.ownerRegistry.markRejected({ reasonCode: this.rejectedOwner.reasonCode });
    this.orphanOwnerRecord = this.ownerRegistry.snapshot();
    this.session = null;
    this._transition(PROCESS_STATES.STOPPING, 'rejected-owner-contained', { backendPid, reasonCode: this.rejectedOwner.reasonCode });
    return this.rejectedOwner;
  }

  persistRejectedOwnerMarker(context = {}) { return this.containRejectedOwner(context); }

  async clearRejectedOwner(options = {}) {
    const rejectedOwner = this.rejectedOwner;
    if (!rejectedOwner) {
      if (this.ownerRegistryFailure && options.requireExit !== false) {
        const record = this.ownerRegistry.snapshot() || this.orphanOwnerRecord;
        if (record?.ownershipActive) await this._terminateOrphanOwner(record, options);
        this.ownerRegistry.markRecovered({ reasonCode: 'OWNER_REGISTRY_FAILURE_RECOVERED' });
        this.orphanOwnerRecord = this.ownerRegistry.snapshot();
        this.ownerRegistryFailure = null;
      }
      return false;
    }
    const record = this.ownerRegistry.snapshot() || this.orphanOwnerRecord || rejectedOwner;
    if (options.requireExit !== false) await this._terminateOrphanOwner(record, options);
    const ownerContext = rejectedOwner.ownerContext || record.ownerContext || {
      backendPid: rejectedOwner.backendPid || record.backendPid,
      startupNonce: rejectedOwner.startupNonce || record.startupNonce,
      backendSessionId: rejectedOwner.backendSessionId || record.backendSessionId,
      fd6PipeInstanceId: rejectedOwner.fd6PipeInstanceId || record.fd6PipeInstanceId,
      manifestSha256: rejectedOwner.manifestSha256 || record.manifestSha256,
      vaultEpoch: rejectedOwner.vaultEpoch || record.vaultEpoch,
      hydrationGeneration: rejectedOwner.hydrationGeneration || record.hydrationGeneration
    };
    if (options.recoverOwnerExit === true && typeof options.handleBackendOwnerExit === 'function') await options.handleBackendOwnerExit(ownerContext);
    this.ownerRegistry.markRecovered({ reasonCode: 'REJECTED_OWNER_RECOVERED' });
    this.orphanOwnerRecord = this.ownerRegistry.snapshot();
    this.rejectedOwner = null;
    this.ownerRegistryFailure = null;
    if (!this.child) this._transition(PROCESS_STATES.STOPPED, 'rejected-owner-cleared');
    return true;
  }

  isRejectedOwnerLive() {
    const rejectedOwner = this.rejectedOwner;
    if (!rejectedOwner) return false;
    const record = this.ownerRegistry.snapshot() || this.orphanOwnerRecord || rejectedOwner;
    const probe = this.ownerRegistry.probe(record);
    return probe.alive === true && probe.identityMatch !== false;
  }

  async waitForOwnerExitRecovery(child, timeoutMs = 15000) {
    const promise = this.ownerExitRecoveryByChild.get(child);
    if (!promise) return { recovered: true, notRequired: true };
    let timer;
    try {
      return await Promise.race([
        promise,
        new Promise((_, reject) => { timer = setTimeout(() => reject(startupFailure('WP4_CREDENTIAL_OWNER_EXIT_RECOVERY_TIMEOUT', 'Credential owner-exit recovery timed out', { backendPid: child?.pid || 0 })), Math.max(100, Number(timeoutMs || 15000))); })
      ]);
    } finally { if (timer) clearTimeout(timer); }
  }

  getOwnedChild() { return this.child; }
  hasOwnership(child = this.child) { return Boolean(child && this.child === child && !processExited(child)); }

  snapshot() {
    const child = this.child;
    const session = this.session;
    const running = Boolean(child && this.state === PROCESS_STATES.RUNNING && !processExited(child));
    return Object.freeze({
      processState: this.state,
      running,
      backendPid: child?.pid || session?.backendPid || this.rejectedOwner?.backendPid || 0,
      backendPort: session?.backendPort || 0,
      appRoot: session?.appRoot || '',
      backendEntryPath: session?.backendEntryPath || '',
      nodeRuntimeExecutablePath: session?.nodeRuntimeExecutablePath || '',
      nodeRuntimeVersion: session?.nodeRuntimeVersion || '',
      nodeModulesPath: session?.nodeModulesPath || '',
      releaseBuildId: session?.releaseBuildId || '',
      releaseManifestSha256: session?.releaseManifestSha256 || '',
      runtimeMode: session ? RUNTIME_MODE_DESKTOP_HOSTED : '',
      startupAttemptId: session?.startupAttemptId || this.startAttempt?.startupAttemptId || '',
      startupNonce: session?.startupNonce || this.rejectedOwner?.startupNonce || '',
      backendSessionId: session?.backendSessionId || this.rejectedOwner?.backendSessionId || '',
      fd6PipeInstanceId: session?.fd6PipeInstanceId || this.rejectedOwner?.fd6PipeInstanceId || '',
      apiSessionEstablished: Boolean(session?.apiSessionToken) && !this.rejectedOwner && !this.ownerRegistryFailure,
      credentialProtocolVersion: session?.credentialProtocolVersion || 0,
      credentialVaultEpoch: session?.credentialVaultEpoch || '',
      credentialGeneration: session?.credentialGeneration || 0,
      credentialAuthorityEventId: session?.credentialAuthorityEventId || '',
      credentialAuthorityHeadDigest: session?.credentialAuthorityHeadDigest || '',
      credentialEntryCount: session?.credentialEntryCount || 0,
      credentialPayloadBytes: session?.credentialPayloadBytes || 0,
      credentialRestoredReferenceCount: session?.credentialRestoredReferenceCount || 0,
      credentialResetAuthorization: session?.credentialResetAuthorization || null,
      readyCredentialMetadata: session?.readyCredentialMetadata || null,
      readyCredentialAuthorityReceipt: session?.readyCredentialAuthorityReceipt || null,
      ownerContext: session?.ownerContext || null,
      ownerAccepted: session?.ownerAccepted === true,
      ownerTrusted: running && !this.rejectedOwner && !this.ownerRegistryFailure,
      rejectedOwner: this.rejectedOwner || null,
      orphanOwnerRecord: this.orphanOwnerRecord || null,
      ownerRegistryFailure: this.ownerRegistryFailure || null,
      ownerRegistry: this.ownerRegistry.snapshot(),
      credentialCustody: this.credentialCustodyHost?.snapshot?.() || null,
      lastOwnerExitRecovery: this.lastOwnerExitRecovery,
      lastExit: this.lastExit,
      lastFailure: this.lastFailure,
      lastStartCancellation: this.lastStartCancellation,
      stateHistory: this.stateHistory.slice(-30)
    });
  }
}

module.exports = {
  BackendProcessHost,
  PROCESS_STATES,
  assertCredentialHandshakeBinding,
  probeBackendHttpReady,
  probeNodeRuntimeExecutable,
  sanitizedEnvironment,
  validateBackendLaunchContract,
  waitForExit
};
