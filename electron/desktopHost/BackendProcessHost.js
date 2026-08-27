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

  // The legacy safe-mode environment authority was retired when runtime_state
  // became the single durable authority. A persistent user/machine variable,
  // or an older launcher that still supplies the retired key with value "0",
  // must not be
  // inherited by a new backend generation. Presence alone is an obsolete
  // authority input and has caused real Windows child boots to fail before the
  // production server could expose diagnostics.
  delete env.YANCE_SAFE_MODE;
  return env;
}

const NODE_RUNTIME_PROBE_CACHE = new Map();

function promisifiedExecFile(execFileImpl) {
  return (file, args, options) => new Promise((resolve, reject) => {
    execFileImpl(file, args, options, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function probeNodeRuntimeExecutable(executablePath, options = {}) {
  const absolute = path.resolve(String(executablePath || ''));
  const cached = NODE_RUNTIME_PROBE_CACHE.get(absolute);
  if (cached && options.noCache !== true) return cached;
  // Accept a promise-based execFile (production uses child_process.execFile via
  // a promise wrapper so the Electron main event loop is never blocked) or a
  // synchronous collector injected by legacy tests. `await` tolerates both.
  const execImpl = options.execFile || promisifiedExecFile(childProcess.execFile);
  const execOptions = {
    cwd: options.cwd || path.dirname(absolute),
    env: sanitizedEnvironment(options.env || process.env),
    encoding: 'utf8',
    windowsHide: true,
    timeout: Math.max(1000, Number(options.timeoutMs || 5000))
  };
  let stdout = '';
  let stderr = '';
  try {
    const result = await execImpl(absolute, ['--version'], execOptions);
    stdout = String(result?.stdout || '');
    stderr = String(result?.stderr || '');
    if (result && (result.error || (result.status != null && Number(result.status) !== 0))) {
      const inner = result.error;
      throw Object.assign(new Error(inner?.message || `exit ${result.status}`), {
        status: result.status ?? null,
        signal: result.signal || null,
        code: inner?.code || '',
        stdout,
        stderr
      });
    }
  } catch (cause) {
    stdout = String(cause?.stdout || stdout || '');
    stderr = String(cause?.stderr || stderr || '');
    throw startupFailure('M1_NODE_RUNTIME_PROBE_FAILED', 'Trusted Node runtime preflight failed before backend fork', {
      nodeRuntimeExecutablePath: absolute,
      exitCode: cause?.status ?? null,
      signal: cause?.signal || null,
      causeCode: cause?.code || '',
      causeMessage: cause?.message || '',
      stdoutTail: stdout.slice(-2000),
      stderrTail: stderr.slice(-4000)
    });
  }
  const version = stdout.trim();
  if (!/^v\d+\.\d+\.\d+(?:[-+].*)?$/.test(version)) {
    throw startupFailure('M1_NODE_RUNTIME_VERSION_INVALID', 'Trusted Node runtime returned an invalid version response', {
      nodeRuntimeExecutablePath: absolute,
      version,
      stderrTail: stderr.slice(-4000)
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
        const error = startupFailure('M1_BACKEND_READY_HEALTHCHECK_FAILED', 'Backend ready health check returned an invalid status', { statusCode: res.statusCode, attempt, port: backendPort, path: requestPath });
        reject(error);
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


async function pathExists(filePath, fsApi = fs) {
  if (typeof filePath !== 'string' || filePath.length === 0) return false;
  // Boot-reachable path/manifest/node_modules existence validation must never
  // call the synchronous fsApi.existsSync on the Electron main event loop. Use
  // the promise-capable access surface (node:fs.promises.access by default,
  // compatible with test fakes exposing async access directly or under .promises).
  const probe = (fsApi && fsApi.promises) || fsApi;
  try { await probe.access(filePath); return true; } catch (_) { return false; }
}

async function firstExistingDelimitedPath(value, fsApi = fs) {
  const raw = String(value || '');
  if (!raw) return '';
  for (const item of raw.split(path.delimiter).map(part => part.trim())) {
    if (item && await pathExists(item, fsApi)) return item;
  }
  return '';
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

async function validateReleaseStartupConfig(releaseStartupConfig = {}, fsApi = fs) {
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
    if (releaseStartupConfig[field] && !await pathExists(releaseStartupConfig[field], fsApi)) {
      throw startupFailure('M1_RELEASE_MANIFEST_MISSING', 'Release manifest file declared by contract does not exist', { field, path: releaseStartupConfig[field] });
    }
  }
  for (const field of ['detachedHashPath', 'releaseManifestSha256Path']) {
    if (releaseStartupConfig[field] && !await pathExists(releaseStartupConfig[field], fsApi)) {
      throw startupFailure('M1_RELEASE_MANIFEST_SHA256_MISSING', 'Release manifest SHA256 file declared by contract does not exist', { field, path: releaseStartupConfig[field] });
    }
  }
  return Object.freeze({ ...releaseStartupConfig });
}

async function validateBackendLaunchContract(options = {}, fsApi = fs) {
  if (!options.entry || !options.cwd || !options.releaseStartupConfig) {
    throw startupFailure('M1_START_CONFIGURATION_INVALID', 'BackendProcessHost requires entry, cwd, and releaseStartupConfig');
  }
  const releaseStartupConfig = await validateReleaseStartupConfig(options.releaseStartupConfig, fsApi);
  if (!await pathExists(options.cwd, fsApi)) {
    throw startupFailure('M1_APP_ROOT_MISSING', 'Backend application root does not exist', { appRoot: options.cwd });
  }
  if (!await pathExists(options.entry, fsApi)) {
    throw startupFailure('M1_BACKEND_ENTRY_MISSING', 'Backend entry file does not exist', { backendEntryPath: options.entry });
  }
  const nodeRuntimeExecutablePath = options.nodeRuntimeExecutablePath || options.execPath || '';
  if (!nodeRuntimeExecutablePath || !await pathExists(nodeRuntimeExecutablePath, fsApi)) {
    throw startupFailure('M1_NODE_RUNTIME_MISSING', 'Backend Node runtime executable does not exist', { nodeRuntimeExecutablePath });
  }
  const env = options.env || {};
  const nodeModulesPath = env.NODE_PATH || options.nodeModulesPath || '';
  if (nodeModulesPath && !await firstExistingDelimitedPath(nodeModulesPath, fsApi)) {
    throw startupFailure('M1_NODE_MODULES_MISSING', 'Backend NODE_PATH does not contain an existing node_modules directory', { nodeModulesPath });
  }
  const backendPort = normalizeBackendPort(options, env);
  const readyTimeoutMs = normalizeReadyTimeoutMs(options);
  return Object.freeze({
    appRoot: options.cwd,
    backendEntryPath: options.entry,
    nodeRuntimeExecutablePath,
    nodeModulesPath,
    backendPort,
    readyTimeoutMs,
    releaseStartupConfig
  });
}

function startupFailure(reasonCode, message, details = {}) {
  const error = new Error(message);
  error.reasonCode = reasonCode;
  Object.assign(error, details);
  return error;
}

function assertCredentialHandshakeBinding(message, expected, phase) {
  const fields = ['pid', 'startupNonce', 'vaultEpoch', 'generation', 'authorityEventId', 'vaultReferenceCount', 'decryptedEntryCount', 'frameEntryCount', 'entryCount', 'payloadBytes', 'restoredReferenceCount'];
  const missing = fields.filter(field => !Object.prototype.hasOwnProperty.call(message || {}, field));
  const mismatches = fields.filter(field => Object.prototype.hasOwnProperty.call(message || {}, field) && message[field] !== expected[field]);
  if (missing.length || mismatches.length) {
    throw startupFailure('DESKTOP_CREDENTIAL_HYDRATION_ACK_MISMATCH', `Credential ${phase} metadata does not match the transmitted snapshot`, { missingFields: missing, mismatchedFields: mismatches });
  }
  return true;
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

    // A durable active-owner claim is never silently downgraded to "no owner".
    // Even after liveness proves the process is gone, the record must be
    // explicitly transitioned to RECOVERED before any replacement can start.
    this.rejectedOwner = Object.freeze({
      ...base,
      reasonCode: 'WP4_DESKTOP_ORPHAN_OWNER_EXIT_RECOVERY_REQUIRED',
      childStillLive: false
    });
    this._transition(PROCESS_STATES.STOPPED, 'orphan-owner-exit-recovery-required', { backendPid: Number(record.backendPid || 0), identityReasonCode: probe.reasonCode });
  }

  async _refreshRestoredOwnerIdentityForMutation() {
    if (!this.rejectedOwner?.restoredFromOwnerRegistry) return null;
    const record = this.ownerRegistry.snapshot();
    if (!record || record.ownershipActive !== true) return null;
    const currentReasonCode = String(this.ownerRegistryFailure?.reasonCode || '');
    const needsAsyncIdentity = currentReasonCode === 'WP4_DESKTOP_BACKEND_OWNER_IDENTITY_UNVERIFIED_RECOVERY_REQUIRED'
      || this.rejectedOwner.pidIdentityMatch == null;
    if (!needsAsyncIdentity) return null;

    const probe = await this.ownerRegistry.probeAsync(record);
    this.orphanOwnerRecord = Object.freeze({ ...record, probe });
    const backendPid = Number(record.backendPid || 0);
    const base = {
      ...this.rejectedOwner,
      backendPid,
      pidIdentityMatch: probe.identityMatch,
      childStillLive: probe.alive === true && probe.identityMatch !== false,
      restoredFromOwnerRegistry: true
    };

    if (probe.identityMatch === false) {
      this.ownerRegistryFailure = {
        reasonCode: 'WP4_DESKTOP_BACKEND_OWNER_IDENTITY_MISMATCH_RECOVERY_REQUIRED',
        message: 'Persisted backend owner PID now resolves to a different process identity; explicit recovery is required',
        backendPid,
        probe,
        recoveryRequired: true,
        atUtc: new Date().toISOString()
      };
      this.rejectedOwner = Object.freeze({
        ...base,
        reasonCode: 'WP4_DESKTOP_ORPHAN_OWNER_PID_REUSED',
        childStillLive: false
      });
      this._transition(PROCESS_STATES.STOPPED, 'orphan-owner-pid-reused-recovery-required', { backendPid });
      return probe;
    }

    if (probe.alive === true && probe.identityMatch === null) {
      this.ownerRegistryFailure = {
        reasonCode: 'WP4_DESKTOP_BACKEND_OWNER_IDENTITY_UNVERIFIED_RECOVERY_REQUIRED',
        message: 'Persisted backend owner is live but its process identity cannot be verified; replacement is fail-closed',
        backendPid,
        probe,
        recoveryRequired: true,
        atUtc: new Date().toISOString()
      };
      this.rejectedOwner = Object.freeze({
        ...base,
        reasonCode: probe.reasonCode === 'OWNER_LIVENESS_EPERM'
          ? 'WP4_DESKTOP_ORPHAN_OWNER_LIVENESS_EPERM'
          : 'WP4_DESKTOP_ORPHAN_OWNER_IDENTITY_UNVERIFIED'
      });
      this._transition(PROCESS_STATES.STOPPING, 'orphan-owner-identity-unverified', { backendPid, identityReasonCode: probe.reasonCode });
      return probe;
    }

    this.ownerRegistryFailure = null;
    if (probe.alive === true) {
      this.rejectedOwner = Object.freeze({ ...base, reasonCode: 'WP4_DESKTOP_ORPHAN_OWNER_RESTORED' });
      this._transition(PROCESS_STATES.STOPPING, 'orphan-owner-restored', { backendPid, identityReasonCode: probe.reasonCode });
      return probe;
    }

    this.rejectedOwner = Object.freeze({
      ...base,
      reasonCode: 'WP4_DESKTOP_ORPHAN_OWNER_EXIT_RECOVERY_REQUIRED',
      childStillLive: false
    });
    this._transition(PROCESS_STATES.STOPPED, 'orphan-owner-exit-recovery-required', { backendPid, identityReasonCode: probe.reasonCode });
    return probe;
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
    this.lastFailure = Object.freeze({
      reasonCode: reasonCode || 'DESKTOP_BACKEND_OPERATION_FAILED',
      at: new Date().toISOString(),
      backendPid: child?.pid || 0
    });
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
        if (this.child === child && this.state === PROCESS_STATES.STARTING) {
          this._transition(PROCESS_STATES.START_FAILED, attempt.error.reasonCode, { backendPid: child.pid || 0 });
        }
      }
    };
    const onError = cause => {
      if (!attempt.error) {
        attempt.error = startupFailure('DESKTOP_BACKEND_CHILD_ERROR', 'Backend child emitted an asynchronous error', {
          causeCode: cause?.code || '', backendPid: child.pid || 0
        });
      }
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
        attempt.error = startupFailure('DESKTOP_BACKEND_EXIT_DURING_START', 'Backend exited before startup handshake completed', {
          backendPid: child.pid || 0,
          exitCode: exitCode ?? null,
          signalCode: signalCode || null
        });
      }
      if (attempt.error && !attempt.abortController?.signal?.aborted) attempt.abortController?.abort?.(attempt.error);
      this.lastExit = Object.freeze({ backendPid: child.pid || 0, exitCode: exitCode ?? null, signalCode: signalCode || null, expected, at: new Date().toISOString() });
      if (this.child !== child) return;
      if (stateAtExit === PROCESS_STATES.STOPPING) {
        this._transition(PROCESS_STATES.STOPPED, 'child-exited-after-stop', { backendPid: child.pid || 0, exitCode, signalCode });
      } else if (stateAtExit === PROCESS_STATES.STARTING) {
        this._recordFailure('DESKTOP_BACKEND_EXIT_DURING_START', child);
        this._transition(PROCESS_STATES.START_FAILED, 'DESKTOP_BACKEND_EXIT_DURING_START', { backendPid: child.pid || 0, exitCode, signalCode });
      } else if (stateAtExit !== PROCESS_STATES.START_FAILED) {
        this._transition(PROCESS_STATES.CRASHED, 'unexpected-child-exit', { backendPid: child.pid || 0, exitCode, signalCode });
      }
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
      const durableOwner = this.ownerRegistry.snapshot();
      const exitingChildOwnsDurableClaim = Boolean(
        durableOwner?.ownershipActive === true
        && Number(durableOwner.backendPid || 0) === Number(child.pid || 0)
        && String(durableOwner.startupNonce || '') === String(attempt.startupNonce || '')
        && String(durableOwner.backendSessionId || '') === String(attempt.backendSessionId || '')
      );
      if (exitingChildOwnsDurableClaim) {
        try {
          this.ownerRegistry.markExited({ exitCode, signalCode, reasonCode: expected ? 'OWNER_EXIT_CONFIRMED' : 'OWNER_EXIT_UNEXPECTED' });
        } catch (registryCause) {
          this.ownerRegistryFailure = { reasonCode: 'WP4_DESKTOP_BACKEND_OWNER_REGISTRY_EXIT_WRITE_FAILED', message: registryCause.message, atUtc: new Date().toISOString() };
        }
      } else {
        this.log('backend-owner-exit-record-skip', {
          backendPid: Number(child.pid || 0),
          durableBackendPid: Number(durableOwner?.backendPid || 0),
          reasonCode: 'EXITING_CHILD_DOES_NOT_OWN_DURABLE_CLAIM'
        });
      }
      if (attempt.startupAdmission && attempt.ownerClaimRegistered !== true) {
        const admission = attempt.startupAdmission;
        attempt.startupAdmission = null;
        Promise.resolve(admission.release()).catch(registryCause => {
          this.ownerRegistryFailure = {
            reasonCode: registryCause.reasonCode || 'WP4_DESKTOP_BACKEND_OWNER_CLAIM_LOCK_FAILED',
            message: registryCause.message,
            atUtc: new Date().toISOString()
          };
        });
      }
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
    if (!attempt.error) {
      attempt.error = startupFailure(reasonCode, message, { backendPid: this.child?.pid || 0 });
    }
    this.lastStartCancellation = Object.freeze({ reasonCode: attempt.error.reasonCode || reasonCode, source: 'host-cancel', backendPid: this.child?.pid || 0, at: new Date().toISOString(), observedAtMs: Date.now() });
    if (!attempt.abortController?.signal?.aborted) attempt.abortController?.abort?.(attempt.error);
    return true;
  }


  _disposeChildHandles(child) {
    if (!child) return;
    for (const stream of child.stdio || []) {
      try { stream?.destroy?.(); } catch (_) {}
    }
    try { if (child.connected) child.disconnect(); } catch (_) {}
  }

  async _awaitSpawnIdentity(child, attempt, timeoutMs = 2000) {
    if (Number.isInteger(child?.pid) && child.pid > 0) return child.pid;
    const deadline = Date.now() + Math.max(100, Number(timeoutMs || 2000));
    while (Date.now() < deadline) {
      if (attempt.error) throw attempt.error;
      if (attempt.exit || processExited(child)) {
        throw startupFailure('DESKTOP_BACKEND_EXIT_DURING_START', 'Backend exited before exposing a valid PID', { backendPid: child?.pid || 0 });
      }
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
      const onError = cause => {
        const error = startupFailure('DESKTOP_STARTUP_PIPE_WRITE_FAILED', `Dedicated backend startup pipe failed: ${cause.message}`, { cause });
        finish(error);
      };
      const onAbort = () => {
        const reason = signal?.reason;
        finish(reason instanceof Error
          ? reason
          : startupFailure('DESKTOP_BACKEND_START_CANCELLED', 'Backend startup was cancelled while writing the startup frame'));
      };
      const timer = setTimeout(() => finish(startupFailure('DESKTOP_STARTUP_PIPE_WRITE_TIMEOUT', 'Timed out writing dedicated backend startup frame')), Math.max(100, Number(timeoutMs || 5000)));
      if (signal?.aborted) return onAbort();
      signal?.addEventListener?.('abort', onAbort, { once: true });
      controlPipe.once?.('error', onError);
      try {
        controlPipe.end(encoded, error => error ? onError(error) : finish());
      } catch (cause) { onError(cause); }
    });
  }

  async _terminateAndWait(child, options = {}) {
    const gracefulMs = Math.max(25, Number(options.gracefulMs || options.timeoutMs || 7000));
    const forceMs = Math.max(25, Number(options.forceMs || 3000));
    if (processExited(child)) return { exited: true, exitConfirmed: true, forced: false, exitCode: child?.exitCode ?? null, signalCode: child?.signalCode ?? null };
    let termAccepted = false;
    try { termAccepted = child.kill('SIGTERM') !== false; } catch (_) {}
    let result = await waitForExit(child, gracefulMs);
    if (result.exited) return { ...result, exitConfirmed: true, forced: false, termAccepted };
    let killAccepted = false;
    try { killAccepted = child.kill('SIGKILL') !== false; } catch (_) {}
    result = await waitForExit(child, forceMs);
    if (!result.exited) {
      throw startupFailure(killAccepted ? 'DESKTOP_BACKEND_FORCE_EXIT_TIMEOUT' : 'DESKTOP_BACKEND_SIGKILL_FAILED', 'Backend process remained alive after forced termination', { backendPid: child.pid || 0 });
    }
    return { ...result, exitConfirmed: true, forced: true, termAccepted, killAccepted };
  }

  _waitForChildMessage(child, attempt, predicate, timeoutMs, timeoutReasonCode) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const signal = attempt?.abortController?.signal || null;
      const finish = (error, message) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.removeListener?.('message', onMessage);
        child.removeListener?.('exit', onExit);
        child.removeListener?.('error', onError);
        signal?.removeEventListener?.('abort', onAbort);
        error ? reject(error) : resolve(message);
      };
      const onMessage = message => {
        if (message?.type === 'backend:startup-failed') {
          const error = startupFailure(message.reasonCode || message.code || 'DESKTOP_BACKEND_START_FAILED', message.message || 'Backend startup failed', {
            backendPid: child.pid || 0,
            phase: String(message.phase || ''),
            stackHash: String(message.stackHash || ''),
            causeCodeHash: String(message.causeCodeHash || ''),
            runtimeSubphase: String(message.runtimeSubphase || '')
          });
          error.phase = String(message.phase || '');
          error.stackHash = String(message.stackHash || '');
          error.causeCodeHash = String(message.causeCodeHash || '');
          error.runtimeSubphase = String(message.runtimeSubphase || '');
          return finish(error);
        }
        if (predicate(message)) finish(null, message);
      };
      const onExit = (code, signal) => finish(startupFailure('DESKTOP_BACKEND_EXIT_DURING_START', 'Backend exited before startup handshake completed', { backendPid: child.pid || 0, exitCode: code, signalCode: signal || null }));
      const onError = cause => finish(startupFailure('DESKTOP_BACKEND_CHILD_ERROR', cause.message, { backendPid: child.pid || 0, causeCode: cause.code || '' }));
      const onAbort = () => {
        const reason = signal?.reason || attempt?.error;
        finish(reason instanceof Error
          ? reason
          : startupFailure('DESKTOP_BACKEND_START_CANCELLED', 'Backend startup handshake was cancelled', { backendPid: child.pid || 0 }));
      };
      const timer = setTimeout(() => finish(startupFailure(timeoutReasonCode, `Timed out waiting for backend handshake: ${timeoutReasonCode}`, { backendPid: child.pid || 0 })), Math.max(100, Number(timeoutMs || 10000)));
      if (signal?.aborted) return onAbort();
      signal?.addEventListener?.('abort', onAbort, { once: true });
      child.on?.('message', onMessage);
      child.once?.('exit', onExit);
      child.once?.('error', onError);
      if (attempt.error) finish(attempt.error);
    });
  }

  async _startUnlocked(options = {}) {
    await this._refreshRestoredOwnerIdentityForMutation();
    if ((this.autoRecoverRejectedOwner || options.autoRecoverRejectedOwner === true) && (this.rejectedOwner || this.ownerRegistryFailure)) {
      await this._recoverRejectedOwnerForStartUnlocked(options);
    }
    if (this.ownerRegistryFailure) throw startupFailure(this.ownerRegistryFailure.reasonCode || 'WP4_DESKTOP_BACKEND_OWNER_REGISTRY_INVALID', 'Backend owner registry is unavailable; refusing to create a new credential owner', { registryFailure: this.ownerRegistryFailure });
    if (this.rejectedOwner) throw startupFailure(this.rejectedOwner.childStillLive ? 'WP4_DESKTOP_REJECTED_OWNER_STILL_LIVE' : 'WP4_DESKTOP_REJECTED_OWNER_RECOVERY_REQUIRED', 'A rejected or orphaned backend owner must be recovered before replacement', { rejectedOwner: this.rejectedOwner });
    if (this.child && !processExited(this.child)) throw startupFailure('DESKTOP_BACKEND_ALREADY_RUNNING', 'A backend process is already owned by DesktopHost');

    this._transition(PROCESS_STATES.STARTING, 'start-requested', {
      backendEntryPath: options.entry || '',
      appRoot: options.cwd || '',
      nodeRuntimeExecutablePath: options.nodeRuntimeExecutablePath || options.execPath || '',
      nodeModulesPath: options.nodeModulesPath || options.env?.NODE_PATH || ''
    });
    const apiSessionToken = createApiSessionToken(this.randomBytes);
    const startupAttemptId = this.randomUUID();
    const startupNonce = this.randomUUID();
    const backendSessionId = this.randomUUID();
    const fd6PipeInstanceId = this.randomUUID();
    const credentialOneTimeToken = createCredentialOneTimeToken(this.randomBytes);
    const defaultOwnerExitRecovery = options.credentialVaultHost && typeof options.credentialVaultHost.handleBackendOwnerExit === 'function'
      ? ownerContext => options.credentialVaultHost.handleBackendOwnerExit(ownerContext)
      : null;
    const attempt = {
      startupAttemptId,
      startupNonce,
      backendSessionId,
      fd6PipeInstanceId,
      cancelled: false,
      error: null,
      exit: null,
      listeners: null,
      ownerContext: null,
      startupAdmission: null,
      ownerClaimRegistered: false,
      abortController: new AbortController(),
      handleBackendOwnerExit: options.handleBackendOwnerExit || defaultOwnerExitRecovery
    };
    this.startAttempt = attempt;
    const stdio = ['ignore', 'pipe', 'pipe', 'ipc', 'pipe', 'pipe', 'pipe'];
    let child;
    let childOutputTail = null;
    let launchContract = null;
    try {
      launchContract = await validateBackendLaunchContract(options, options.fs || fs);
      const sanitizedEnv = sanitizedEnvironment(options.env);
      delete sanitizedEnv.ELECTRON_RUN_AS_NODE;
      this.log('backend-process-launch-contract', {
        nodeRuntimeExecutablePath: launchContract.nodeRuntimeExecutablePath,
        backendEntryPath: launchContract.backendEntryPath,
        appRoot: launchContract.appRoot,
        nodeModulesPath: launchContract.nodeModulesPath || '',
        dataDir: sanitizedEnv.YANCE_DATA_DIR || '',
        port: sanitizedEnv.YANCE_PORT || '',
        electronRunAsNode: Object.prototype.hasOwnProperty.call(sanitizedEnv, 'ELECTRON_RUN_AS_NODE') ? 'present' : 'absent'
      });
      // Credential custody transport: use an explicit net pipe instead of the
      // inherited stdio fd. On Windows the child->parent stdio fd never reaches
      // the parent under child_process fork/spawn, so custody frames would be
      // lost. The parent opens a net.Server on a name derived from
      // fd6PipeInstanceId; the child connects to the same name. The host is
      // created lazily when the child actually connects to the pipe.
      const custodyPipeName = deriveCustodyPipeName(fd6PipeInstanceId);
      if (this.credentialCustodyServer) { try { this.credentialCustodyServer.close(); } catch (_) {} this.credentialCustodyServer = null; }
      this.credentialCustodyHost = null;
      let resolveCustodyConnection = null;
      let rejectCustodyConnection = null;
      const custodyConnectionPromise = new Promise((resolve, reject) => {
        resolveCustodyConnection = resolve;
        rejectCustodyConnection = reject;
      });
      // A rejected startup can complete before the child connects. Attach a
      // handler immediately so a later server/socket error never becomes an
      // unhandled rejection while the normal startup catch path tears down.
      custodyConnectionPromise.catch(() => {});
      if (Boolean(options.credentialVaultHost)) {
        const custodyServer = this.createCredentialCustodyServer();
        if (!custodyServer || typeof custodyServer.listen !== 'function' || typeof custodyServer.on !== 'function') {
          throw startupFailure('DESKTOP_CREDENTIAL_CUSTODY_PIPE_UNAVAILABLE', 'Credential custody server factory returned an invalid server');
        }
        this.credentialCustodyServer = custodyServer;
        custodyServer.once('error', error => rejectCustodyConnection(error));
        custodyServer.on('connection', socket => {
          if (this.credentialCustodyHost) {
            try { socket.destroy(); } catch (_) {}
            return;
          }
          try {
            this.credentialCustodyHost = new CredentialCustodyHost({
              stream: socket,
              vaultHost: options.credentialVaultHost,
              context: {
                backendPid: child.pid,
                startupNonce,
                backendSessionId,
                fd6PipeInstanceId,
                manifestSha256: options.releaseStartupConfig.manifestSha256,
                vaultEpoch: credentialFrame.vaultEpoch,
                generation: credentialFrame.generation,
                hydrationGeneration: credentialFrame.generation
              }
            });
            resolveCustodyConnection(this.credentialCustodyHost);
          } catch (error) {
            try { socket.destroy(); } catch (_) {}
            rejectCustodyConnection(error);
          }
        });
        await new Promise((resolve, reject) => {
          const onListenError = error => reject(error);
          custodyServer.once('error', onListenError);
          custodyServer.listen(custodyPipeName, () => { custodyServer.removeListener('error', onListenError); resolve(); });
        }).catch(error => { throw startupFailure('DESKTOP_CREDENTIAL_CUSTODY_PIPE_UNAVAILABLE', 'Failed to open credential custody pipe', { cause: error }); });
        // The listening socket must NOT keep the host process alive on its own.
        // It is closed explicitly on stop/teardown; unref() guarantees the event loop
        // can drain (e.g. in tests, or if a stop path is missed) once every other
        // handle is released. The server still accepts connections normally.
        custodyServer.unref();
      }
      const runtimeProbe = await this.probeNodeRuntime(launchContract.nodeRuntimeExecutablePath, {
        cwd: options.cwd,
        env: sanitizedEnv,
        timeoutMs: options.nodeRuntimeProbeTimeoutMs || 5000
      });
      this.log('backend-node-runtime-preflight-pass', {
        nodeRuntimeExecutablePath: launchContract.nodeRuntimeExecutablePath,
        nodeRuntimeVersion: runtimeProbe.version
      });
      attempt.startupAdmission = await this.ownerRegistry.acquireStartupAdmission();
      this.log('backend-process-fork-dispatch', {
        nodeRuntimeExecutablePath: launchContract.nodeRuntimeExecutablePath,
        backendEntryPath: options.entry,
        appRoot: options.cwd,
        inheritedElectronExecArgvCount: Array.isArray(process.execArgv) ? process.execArgv.length : 0,
        backendExecArgvCount: 0
      });
      child = this.fork(options.entry, [], {
        execPath: launchContract.nodeRuntimeExecutablePath,
        execArgv: [],
        cwd: options.cwd,
        env: sanitizedEnv,
        stdio,
        windowsHide: options.windowsHide !== false,
        windowsVerbatimArguments: false,
        serialization: 'json'
      });
      this.log('backend-process-fork-returned', {
        backendPid: Number(child?.pid || 0),
        nodeRuntimeExecutablePath: launchContract.nodeRuntimeExecutablePath,
        backendEntryPath: options.entry
      });
      if (!child || typeof child.on !== 'function') throw startupFailure('DESKTOP_BACKEND_CHILD_INVALID', 'fork did not return a ChildProcess-compatible object');

      // Ownership and critical listeners must be installed before PID inspection,
      // pipe access, or any other initialization that can throw. Node may return
      // a ChildProcess with no PID and emit ENOENT asynchronously.
      this.child = child;
      this._bindChildLifecycle(child, attempt);
      childOutputTail = createChildOutputTail(options.childOutputTailBytes || 8192);
      childOutputTail.attach(child);
      attempt.childOutputTail = childOutputTail;
      for (const stream of child.stdio || []) stream?.on?.('error', () => {});
      await this._awaitSpawnIdentity(child, attempt, options.spawnIdentityTimeoutMs);
      this._assertStartStillValid(child, attempt, 'after-lifecycle-bind');
      const processIdentity = await this.ownerRegistry.captureIdentityAsync(child.pid);
      await attempt.startupAdmission.register({
        state: 'SPAWNED',
        ownershipActive: true,
        trusted: false,
        backendPid: child.pid,
        startupNonce,
        backendSessionId,
        fd6PipeInstanceId,
        processIdentity,
        reasonCode: 'BACKEND_SPAWNED'
      });
      attempt.ownerClaimRegistered = true;
      this.orphanOwnerRecord = this.ownerRegistry.snapshot();
      await attempt.startupAdmission.release();
      attempt.startupAdmission = null;

      const controlPipe = child.stdio?.[CONTROL_PIPE_FD];
      const credentialPipe = child.stdio?.[CREDENTIAL_PIPE_FD];
      if (!controlPipe || typeof controlPipe.end !== 'function') throw startupFailure('DESKTOP_STARTUP_PIPE_UNAVAILABLE', 'Dedicated backend startup pipe is unavailable');

      let prepared;
      if (typeof options.createCredentialSnapshot === 'function') {
        prepared = await options.createCredentialSnapshot({
          startupNonce,
          oneTimeToken: credentialOneTimeToken,
          backendPid: child.pid,
          manifestSha256: options.releaseStartupConfig.manifestSha256,
          backendSessionId,
          fd6PipeInstanceId
        });
      } else {
        this.defaultCredentialGeneration += 1;
        prepared = { frame: makeCredentialFrame({ startupNonce, oneTimeToken: credentialOneTimeToken, backendPid: child.pid, manifestSha256: options.releaseStartupConfig.manifestSha256, vaultEpoch: this.defaultCredentialVaultEpoch, generation: this.defaultCredentialGeneration, authorityEventId: `default:${startupNonce}`, authorityHeadDigest: crypto.createHash('sha256').update(`default:${startupNonce}:${this.defaultCredentialGeneration}`).digest('hex'), vaultReferenceCount: 0, decryptedEntryCount: 0, entries: [] }), resetAuthorization: null };
      }
      const credentialFrame = prepared?.frame || prepared;
      const resetAuthorization = prepared?.resetAuthorization || null;
      const ownerContext = Object.freeze(prepared?.ownerSession || {
        backendPid: child.pid, startupNonce, backendSessionId, manifestSha256: options.releaseStartupConfig.manifestSha256,
        vaultEpoch: credentialFrame.vaultEpoch, hydrationGeneration: credentialFrame.generation, fd6PipeInstanceId
      });
      attempt.ownerContext = ownerContext;
      await this.ownerRegistry.updateAsync({ state: 'STARTING', ownerSession: ownerContext, reasonCode: 'CREDENTIAL_OWNER_SESSION_CREATED' });
      this.orphanOwnerRecord = this.ownerRegistry.snapshot();
      const requireHandshake = options.credentialHandshakeRequired === true;
      const shouldDeliverCredentialSnapshot = requireHandshake || options.credentialSnapshotRequired === true || options.credentialFrameRequired === true;
      const custodyVaultAvailable = Boolean(options.credentialVaultHost);
      // The custody pipe is now an explicit net pipe (this.credentialCustodyServer,
      // opened above) rather than the inherited stdio fd. The host is created
      // lazily when the child connects to that pipe.
      if (requireHandshake && !custodyVaultAvailable) {
        throw startupFailure('CREDENTIAL_VAULT_UNAVAILABLE', 'CredentialVaultHost is required for the custody channel');
      }
      if (requireHandshake && !this.credentialCustodyServer) {
        throw startupFailure('DESKTOP_CREDENTIAL_CUSTODY_PIPE_UNAVAILABLE', 'Dedicated credential custody pipe is unavailable');
      }
      const hydrationPromise = requireHandshake ? this._waitForChildMessage(child, attempt, message => message?.type === 'backend:credential-hydrated', options.credentialTimeoutMs || CREDENTIAL_HYDRATION_TIMEOUT_MS + 3000, 'DESKTOP_CREDENTIAL_HYDRATION_TIMEOUT') : null;
      const readyPromise = requireHandshake ? this._waitForChildMessage(child, attempt, message => message?.type === 'backend:ready', options.readyTimeoutMs || 30000, 'DESKTOP_BACKEND_READY_TIMEOUT') : null;
      hydrationPromise?.catch?.(() => {});
      readyPromise?.catch?.(() => {});
      const handshakePromise = requireHandshake ? Promise.all([hydrationPromise, readyPromise]) : null;
      handshakePromise?.catch?.(() => {});
      const releaseContract = launchContract.releaseStartupConfig;
      const backendPort = launchContract.backendPort;
      const readyTimeoutMs = launchContract.readyTimeoutMs;
      const logRoot = String(options.logRoot || sanitizedEnv.YANCE_LOG_DIR || path.dirname(String(options.logPath || path.join(launchContract.appRoot, 'logs', 'backend.jsonl'))));
      const backendLogPath = String(options.backendLogPath || options.logPath || path.join(logRoot, 'backend.jsonl'));
      const desktopLogPath = String(options.desktopLogPath || path.join(logRoot, 'desktop.jsonl'));
      const encoded = this.encodeStartupFrame({
        protocolVersion: STARTUP_PROTOCOL_VERSION,
        startupFrameProtocolVersion: STARTUP_FRAME_PROTOCOL_VERSION,
        m1StartupContractVersion: M1_STARTUP_CONTRACT_VERSION,
        readyProtocolVersion: READY_PROTOCOL_VERSION,
        startupAttemptId,
        startupNonce,
        apiSessionToken,
        backendPid: child.pid,
        resourcesPath: releaseContract.resourcesPath,
        expectedBuildId: releaseContract.expectedBuildId,
        manifestSha256: releaseContract.manifestSha256,
        releaseManifestPath: releaseContract.releaseManifestPath || releaseContract.manifestPath || path.join(releaseContract.resourcesPath, 'release-manifest.json'),
        releaseManifestSha256Path: releaseContract.releaseManifestSha256Path || releaseContract.detachedHashPath || path.join(releaseContract.resourcesPath, 'release-manifest.sha256'),
        appRoot: launchContract.appRoot,
        backendEntryPath: launchContract.backendEntryPath,
        nodeRuntimeExecutablePath: launchContract.nodeRuntimeExecutablePath,
        nodeModulesPath: launchContract.nodeModulesPath || '',
        runtimeMode: RUNTIME_MODE_DESKTOP_HOSTED,
        backendSessionId,
        fd6PipeInstanceId,
        backendPort,
        apiBaseUrl: `http://127.0.0.1:${backendPort}`,
        readyTimeoutMs,
        launchTimeoutMs: Number(options.launchTimeoutMs || readyTimeoutMs),
        stopTimeoutMs: Number(options.stopTimeoutMs || options.timeoutMs || 7000),
        dataDir: String(sanitizedEnv.YANCE_DATA_DIR || ''),
        logPath: backendLogPath,
        logRoot,
        desktopLogPath,
        backendLogPath,
        credentialProtocolVersion: CREDENTIAL_PROTOCOL_VERSION,
        credentialOneTimeToken,
        credentialVaultEpoch: credentialFrame.vaultEpoch,
        credentialGeneration: credentialFrame.generation,
        credentialBackendSessionId: backendSessionId,
        credentialFd6PipeInstanceId: fd6PipeInstanceId,
        credentialAuthorityEventId: credentialFrame.authorityEventId,
        credentialAuthorityHeadDigest: credentialFrame.authorityHeadDigest,
        credentialVaultReferenceCount: credentialFrame.vaultReferenceCount,
        credentialDecryptedEntryCount: credentialFrame.decryptedEntryCount,
        credentialFrameEntryCount: credentialFrame.frameEntryCount,
        credentialResetAuthorization: resetAuthorization
      });
      this._assertStartStillValid(child, attempt, 'before-frame-write');
      await this._writeStartupFrame(controlPipe, encoded, options.controlPipeTimeoutMs, attempt.abortController.signal);
      await Promise.resolve();
      this._assertStartStillValid(child, attempt, 'after-frame-write');

      if (shouldDeliverCredentialSnapshot) {
        if (!credentialPipe) throw startupFailure('DESKTOP_CREDENTIAL_PIPE_UNAVAILABLE', 'Dedicated credential pipe is unavailable');
        this.credentialIpcHost.attach(credentialPipe);
        await this.credentialIpcHost.sendSnapshot(credentialFrame, {
          timeoutMs: options.credentialWriteTimeoutMs,
          signal: attempt.abortController.signal
        });
        this._assertStartStillValid(child, attempt, 'after-credential-frame-write');
      } else {
        this.log('backend-credential-frame-delivery-skipped', { backendPid: child.pid, reasonCode: 'M1_CREDENTIAL_HANDSHAKE_NOT_REQUIRED' });
        this._assertStartStillValid(child, attempt, 'after-credential-frame-skip');
      }

      let hydration = null;
      let readiness = null;
      if (requireHandshake) {
        [hydration, readiness] = await handshakePromise;
        const expectedCredentialMetadata = {
          pid: child.pid,
          startupNonce,
          vaultEpoch: credentialFrame.vaultEpoch,
          generation: credentialFrame.generation,
          authorityEventId: credentialFrame.authorityEventId,
          vaultReferenceCount: credentialFrame.vaultReferenceCount,
          decryptedEntryCount: credentialFrame.decryptedEntryCount,
          frameEntryCount: credentialFrame.frameEntryCount,
          entryCount: credentialFrame.payload.entries.length,
          payloadBytes: credentialFrame.payloadBytes,
          restoredReferenceCount: credentialFrame.payload.entries.length
        };
        assertCredentialHandshakeBinding(hydration, expectedCredentialMetadata, 'hydration acknowledgement');
        const accepted = await options.credentialVaultHost?.markHydrationAccepted?.(hydration);
        if (accepted !== true) throw startupFailure('DESKTOP_CREDENTIAL_HYDRATION_ACK_MISMATCH', 'CredentialVaultHost rejected the hydration acknowledgement');
        const readyRuntimeContract = readiness && typeof readiness.runtimeContract === 'object' && !Array.isArray(readiness.runtimeContract) ? readiness.runtimeContract : {};
        const actualReadyProtocolVersion = readiness.readyProtocolVersion ?? readyRuntimeContract.readyProtocolVersion;
        const actualReadyStartupAttemptId = readiness.startupAttemptId ?? readyRuntimeContract.startupAttemptId;
        const actualReadyBackendSessionId = readiness.backendSessionId ?? readyRuntimeContract.backendSessionId;
        if (actualReadyProtocolVersion !== READY_PROTOCOL_VERSION) throw startupFailure('M1_READY_PROTOCOL_VERSION_MISMATCH', 'Backend ready protocol version does not match M1 contract', { expected: READY_PROTOCOL_VERSION, actual: actualReadyProtocolVersion });
        if (String(actualReadyStartupAttemptId || '') !== startupAttemptId) throw startupFailure('M1_READY_STARTUP_ATTEMPT_MISMATCH', 'Backend ready startupAttemptId does not match active attempt', { expected: startupAttemptId, actual: actualReadyStartupAttemptId || '' });
        if (String(actualReadyBackendSessionId || '') !== backendSessionId) throw startupFailure('M1_READY_BACKEND_SESSION_MISMATCH', 'Backend ready backendSessionId does not match active attempt', { expected: backendSessionId, actual: actualReadyBackendSessionId || '' });
        assertCredentialHandshakeBinding({ pid: readiness.pid, startupNonce: readiness.startupNonce, ...(readiness.credentialMetadata || {}) }, expectedCredentialMetadata, 'ready acknowledgement');
        if (options.readyHealthCheckPath || options.readyHealthCheck === true) {
          const readyHealth = await probeBackendHttpReady({
            port: readiness.port,
            token: apiSessionToken,
            path: options.readyHealthCheckPath || '/api/health',
            timeoutMs: options.readyHealthCheckTimeoutMs || Math.min(5000, readyTimeoutMs),
            retries: options.readyHealthCheckRetries ?? 20,
            retryDelayMs: options.readyHealthCheckRetryDelayMs || 100
          });
          this.log('backend-ready-health-check', { backendPid: child.pid, ...readyHealth });
        }
        options.onCredentialHydrated?.(hydration);
        const custodyConnectTimeoutMs = Math.max(100, Number(options.credentialCustodyConnectTimeoutMs || options.credentialTimeoutMs || CREDENTIAL_HYDRATION_TIMEOUT_MS + 3000));
        let custodyTimer = null;
        try {
          await Promise.race([
            custodyConnectionPromise,
            new Promise((_, reject) => {
              custodyTimer = setTimeout(() => reject(startupFailure('DESKTOP_CREDENTIAL_CUSTODY_PIPE_UNAVAILABLE', 'Backend did not connect the dedicated credential custody pipe before READY', { backendPid: child.pid, timeoutMs: custodyConnectTimeoutMs })), custodyConnectTimeoutMs);
              custodyTimer.unref?.();
            })
          ]);
        } catch (error) {
          if (error?.reasonCode === 'DESKTOP_CREDENTIAL_CUSTODY_PIPE_UNAVAILABLE') throw error;
          throw startupFailure('DESKTOP_CREDENTIAL_CUSTODY_PIPE_UNAVAILABLE', 'Backend credential custody pipe connection failed before READY', { backendPid: child.pid, cause: error });
        } finally {
          if (custodyTimer) clearTimeout(custodyTimer);
        }
        if (!this.credentialCustodyHost?.snapshot?.().dedicatedPipeActive) {
          throw startupFailure('DESKTOP_CREDENTIAL_CUSTODY_PIPE_UNAVAILABLE', 'Dedicated credential custody pipe is not active at the READY boundary', { backendPid: child.pid });
        }
      }
      if (typeof options.beforeRunningTransition === 'function') await options.beforeRunningTransition({ child, host: this, hydration, readiness });
      await Promise.resolve();
      this._assertStartStillValid(child, attempt, 'before-running-transition');

      this.session = Object.freeze({
        startupAttemptId,
        startupNonce,
        backendSessionId,
        fd6PipeInstanceId,
        apiSessionToken,
        backendPid: child.pid,
        readyProtocolVersion: readiness?.readyProtocolVersion || READY_PROTOCOL_VERSION,
        runtimeContract: Object.freeze({
          startupAttemptId,
          m1StartupContractVersion: M1_STARTUP_CONTRACT_VERSION,
          startupFrameProtocolVersion: STARTUP_FRAME_PROTOCOL_VERSION,
          readyProtocolVersion: READY_PROTOCOL_VERSION,
          runtimeMode: RUNTIME_MODE_DESKTOP_HOSTED,
          appRoot: launchContract.appRoot,
          backendEntryPath: launchContract.backendEntryPath,
          nodeRuntimeExecutablePath: launchContract.nodeRuntimeExecutablePath,
          nodeModulesPath: launchContract.nodeModulesPath || '',
          backendPort,
          apiBaseUrl: `http://127.0.0.1:${backendPort}`,
          readyTimeoutMs,
          releaseManifestPath: releaseContract.releaseManifestPath || releaseContract.manifestPath || path.join(releaseContract.resourcesPath, 'release-manifest.json'),
          releaseManifestSha256Path: releaseContract.releaseManifestSha256Path || releaseContract.detachedHashPath || path.join(releaseContract.resourcesPath, 'release-manifest.sha256'),
          logRoot,
          desktopLogPath,
          backendLogPath
        }),
        credentialFrameDelivered: shouldDeliverCredentialSnapshot,
        credentialHydrated: Boolean(hydration),
        credentialVaultEpoch: credentialFrame.vaultEpoch,
        credentialGeneration: credentialFrame.generation,
        credentialAuthorityEventId: credentialFrame.authorityEventId,
        credentialAuthorityHeadDigest: credentialFrame.authorityHeadDigest,
        credentialVaultReferenceCount: credentialFrame.vaultReferenceCount,
        credentialDecryptedEntryCount: credentialFrame.decryptedEntryCount,
        credentialFrameEntryCount: credentialFrame.frameEntryCount,
        ownerContext,
        readyCredentialMetadata: readiness?.credentialMetadata ? Object.freeze({ ...readiness.credentialMetadata }) : null
      });
      this._assertStartStillValid(child, attempt, 'after-session-create');
      await this.ownerRegistry.updateAsync({ state: 'RUNNING', ownershipActive: true, trusted: false, ownerSession: ownerContext, reasonCode: 'BACKEND_READY_AWAITING_APPLICATION_VALIDATION' });
      this.orphanOwnerRecord = this.ownerRegistry.snapshot();
      this.rejectedOwner = null;
      this._transition(PROCESS_STATES.RUNNING, requireHandshake ? 'credential-hydrated-and-backend-ready' : 'startup-and-credential-frames-delivered', { backendPid: child.pid });
      this.startAttempt = null;
      this.log('backend-process-started', { backendPid: child.pid, buildId: options.releaseStartupConfig.expectedBuildId, credentialHydrated: Boolean(hydration) });
      return Object.freeze({ child, startupAttemptId, startupNonce, backendSessionId, fd6PipeInstanceId, apiSessionToken, credentialIpcHost: this.credentialIpcHost, hydration, readiness });
    } catch (error) {
      const reasonCode = error.reasonCode || error.code || 'DESKTOP_BACKEND_START_FAILED';
      this._recordFailure(reasonCode, child);
      if (this.state !== PROCESS_STATES.CRASHED) this._transition(PROCESS_STATES.START_FAILED, reasonCode, { backendPid: child?.pid || 0 });
      attempt.cancelled = true;
      if (!attempt.abortController?.signal?.aborted) attempt.abortController?.abort?.(error);
      if (child && typeof child === 'object') error.backendChild = child;
      if (childOutputTail) error.backendOutputTail = childOutputTail.snapshot();
      error.backendStartDiagnostics = {
        backendPid: child?.pid || 0,
        state: this.state,
        childExited: processExited(child),
        childExitCode: child?.exitCode ?? null,
        childSignalCode: child?.signalCode || null
      };

      const liveOwnedChild = Boolean(child && Number.isInteger(child.pid) && child.pid > 0 && !processExited(child));
      if (liveOwnedChild) {
        const activeRecord = this.ownerRegistry.snapshot();
        const childHasDurableOwnerClaim = Boolean(activeRecord?.ownershipActive === true && Number(activeRecord.backendPid || 0) === Number(child.pid || 0));
        const childReceivedCredentialAuthority = Boolean(attempt.ownerContext || this.session || childHasDurableOwnerClaim);
        if (childReceivedCredentialAuthority) {
          // A child rejected after an owner claim or credential authority exists
          // must be contained. A child rejected before owner registration (for
          // example, Windows process identity could not be read) is only a failed
          // spawn and should not create a false FATAL_OWNER_CONTAINMENT cascade.
          try {
            error.rejectedOwnerContainment = this.containRejectedOwner({
              reasonCode,
              ownerSession: attempt.ownerContext || null,
              persistOwnerRecord: false
            });
          } catch (containmentError) {
            error.containmentReasonCode = containmentError.reasonCode || containmentError.code || 'WP4_DESKTOP_REJECTED_OWNER_CONTAINMENT_FAILED';
          }
        } else {
          error.rejectedOwnerContainmentSkipped = true;
          error.rejectedOwnerContainmentSkippedReason = 'CHILD_FAILED_BEFORE_OWNER_CLAIM';
        }

        try {
          error.startFailureTermination = await this._terminateAndWait(child, {
            gracefulMs: 100,
            forceMs: Number(options.forceExitTimeoutMs || 3000)
          });
        } catch (cleanupError) {
          error.cleanupReasonCode = cleanupError.reasonCode || cleanupError.code || 'DESKTOP_BACKEND_EXIT_NOT_CONFIRMED';
        }
      }

      if (attempt.startupAdmission) {
        const durableClaimNowBlocksReplacement = attempt.ownerClaimRegistered === true;
        const preClaimChildContained = !child || processExited(child) || !Number.isInteger(child.pid) || child.pid < 1;
        if (durableClaimNowBlocksReplacement || preClaimChildContained) {
          try { await attempt.startupAdmission.release(); }
          catch (releaseError) {
            error.ownerClaimReleaseFailure = {
              reasonCode: releaseError.reasonCode || releaseError.code || 'WP4_DESKTOP_BACKEND_OWNER_CLAIM_LOCK_FAILED',
              message: releaseError.message
            };
          }
          attempt.startupAdmission = null;
        } else {
          error.startupAdmissionRetained = true;
          error.startupAdmissionRetainedReason = 'PRECLAIM_CHILD_EXIT_NOT_CONFIRMED';
        }
      }

      this.session = null;
      this.credentialIpcHost.close();
      this.credentialCustodyHost?.close?.();
      this.credentialCustodyHost = null;
      if (this.credentialCustodyServer) { try { this.credentialCustodyServer.close(); } catch (_) {} this.credentialCustodyServer = null; }

      if (child && processExited(child)) {
        let recovery = null;
        try { recovery = await this.waitForOwnerExitRecovery(child); }
        catch (recoveryError) {
          error.ownerRecoveryReasonCode = recoveryError.reasonCode || recoveryError.code || 'WP4_CREDENTIAL_OWNER_EXIT_RECOVERY_FAILED';
        }
        if (recovery?.recovered === true && this.rejectedOwner) {
          try { await this.clearRejectedOwner({ force: false, observedExitedChild: child }); }
          catch (recoveryError) {
            error.ownerRecoveryReasonCode = recoveryError.reasonCode || recoveryError.code || 'WP4_CREDENTIAL_OWNER_EXIT_RECOVERY_FAILED';
          }
        } else if (recovery?.recovered !== true && !error.ownerRecoveryReasonCode) {
          error.ownerRecoveryReasonCode = 'WP4_CREDENTIAL_OWNER_EXIT_RECOVERY_PENDING';
        }
      }
      this._disposeChildHandles(child);
      if ((!child || processExited(child) || !Number.isInteger(child.pid) || child.pid < 1) && this.child === child) this.child = null;
      this.startAttempt = null;
      throw error;
    }
  }

  start(options = {}) { return this._enqueue(() => this._startUnlocked(options)); }

  async _recoverRejectedOwnerForStartUnlocked(options = {}) {
    await this._refreshRestoredOwnerIdentityForMutation();
    const mismatchFailure = this.ownerRegistryFailure?.reasonCode === 'WP4_DESKTOP_BACKEND_OWNER_IDENTITY_MISMATCH_RECOVERY_REQUIRED'
      && this.rejectedOwner?.pidIdentityMatch === false;
    if (mismatchFailure) {
      const backendPid = Number(this.rejectedOwner?.backendPid || this.ownerRegistry.snapshot()?.backendPid || 0);
      this.log('backend-owner-auto-recovery-pid-reused', { backendPid, reasonCode: this.ownerRegistryFailure.reasonCode });
      this.clearRejectedOwner({ force: true });
      return { recovered: true, backendPid, pidReused: true, forced: false };
    }
    if (this.ownerRegistryFailure) {
      throw startupFailure(this.ownerRegistryFailure.reasonCode || 'WP4_DESKTOP_BACKEND_OWNER_REGISTRY_INVALID', 'Automatic backend owner recovery is unsafe because the durable owner identity cannot be trusted', { registryFailure: this.ownerRegistryFailure, automaticRecoveryAttempted: true });
    }
    if (!this.rejectedOwner) return { recovered: false, notRequired: true };
    const backendPid = Number(this.rejectedOwner.backendPid || 0);
    this.log('backend-owner-auto-recovery-started', { backendPid, childStillLive: this.rejectedOwner.childStillLive === true });
    const stopped = await this._terminateOrphanOwner({
      gracefulMs: options.ownerRecoveryGracefulMs || options.gracefulMs || 1500,
      forceMs: options.ownerRecoveryForceMs || options.forceMs || 1500
    });
    if (stopped?.stopped !== true || stopped?.exitConfirmed !== true) {
      throw startupFailure(stopped?.reasonCode || 'WP4_DESKTOP_REJECTED_OWNER_AUTOMATIC_RECOVERY_FAILED', 'The previous Yance backend owner could not be safely recovered automatically', { backendPid, stopped, automaticRecoveryAttempted: true });
    }
    await this.clearRejectedOwner({ force: false });
    this.log('backend-owner-auto-recovery-complete', { backendPid, forced: stopped.forced === true, alreadyStopped: stopped.alreadyStopped === true });
    return { recovered: true, backendPid, forced: stopped.forced === true, alreadyStopped: stopped.alreadyStopped === true };
  }

  recoverRejectedOwnerForStart(options = {}) {
    return this._enqueue(() => this._recoverRejectedOwnerForStartUnlocked(options));
  }

  async _terminateOrphanOwner(options = {}) {
    await this._refreshRestoredOwnerIdentityForMutation();
    if (this.ownerRegistryFailure) {
      return {
        stopped: false,
        exitConfirmed: false,
        backendPid: Number(this.rejectedOwner?.backendPid || 0),
        reasonCode: this.ownerRegistryFailure.reasonCode || 'WP4_DESKTOP_BACKEND_OWNER_REGISTRY_INVALID',
        registryFailure: { ...this.ownerRegistryFailure },
        state: this.state
      };
    }
    const record = this.ownerRegistry.snapshot() || this.orphanOwnerRecord || this.rejectedOwner;
    const probe = await this.ownerRegistry.probeAsync(record);
    const backendPid = Number(record?.backendPid || 0);
    if (!probe.alive || probe.identityMatch === false) {
      await this.ownerRegistry.markExitedAsync({ reasonCode: probe.identityMatch === false ? 'OWNER_PID_REUSED' : 'OWNER_ALREADY_EXITED' });
      this.orphanOwnerRecord = this.ownerRegistry.snapshot();
      if (this.rejectedOwner) this.rejectedOwner = Object.freeze({ ...this.rejectedOwner, childStillLive: false, pidIdentityMatch: probe.identityMatch, exitedAtUtc: new Date().toISOString() });
      this._transition(PROCESS_STATES.STOPPED, probe.identityMatch === false ? 'orphan-owner-pid-reused' : 'orphan-owner-not-live', { backendPid });
      return { stopped: true, exitConfirmed: true, alreadyStopped: true, backendPid, pidReused: probe.identityMatch === false, state: this.state };
    }
    if (probe.identityMatch !== true) {
      return { stopped: false, exitConfirmed: false, backendPid, reasonCode: probe.reasonCode || 'WP4_DESKTOP_ORPHAN_OWNER_IDENTITY_UNVERIFIED', state: this.state };
    }
    const gracefulMs = Math.max(25, Number(options.gracefulMs || 1500));
    const forceMs = Math.max(25, Number(options.forceMs || 1500));
    const waitDead = async timeoutMs => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (!this.ownerRegistry.probe(record).alive) return true;
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      return !this.ownerRegistry.probe(record).alive;
    };
    let termAccepted = false;
    try { this.killProcess(backendPid, 'SIGTERM'); termAccepted = true; } catch (cause) {
      if (cause?.code === 'ESRCH') termAccepted = true;
      else return { stopped: false, exitConfirmed: false, backendPid, reasonCode: cause?.code === 'EPERM' ? 'WP4_DESKTOP_ORPHAN_OWNER_TERMINATION_EPERM' : 'WP4_DESKTOP_ORPHAN_OWNER_SIGTERM_FAILED', state: this.state };
    }
    let exited = await waitDead(gracefulMs);
    let forced = false;
    if (!exited) {
      forced = true;
      try { this.killProcess(backendPid, 'SIGKILL'); } catch (cause) {
        if (cause?.code !== 'ESRCH') return { stopped: false, exitConfirmed: false, backendPid, reasonCode: cause?.code === 'EPERM' ? 'WP4_DESKTOP_ORPHAN_OWNER_TERMINATION_EPERM' : 'WP4_DESKTOP_ORPHAN_OWNER_SIGKILL_FAILED', state: this.state };
      }
      exited = await waitDead(forceMs);
    }
    if (!exited) return { stopped: false, exitConfirmed: false, backendPid, reasonCode: 'WP4_DESKTOP_ORPHAN_OWNER_EXIT_NOT_CONFIRMED', state: this.state };
    await this.ownerRegistry.markExitedAsync({ reasonCode: 'ORPHAN_OWNER_EXIT_CONFIRMED', signalCode: forced ? 'SIGKILL' : 'SIGTERM' });
    this.orphanOwnerRecord = this.ownerRegistry.snapshot();
    if (this.rejectedOwner) this.rejectedOwner = Object.freeze({ ...this.rejectedOwner, childStillLive: false, exitedAtUtc: new Date().toISOString(), signalCode: forced ? 'SIGKILL' : 'SIGTERM' });
    this._transition(PROCESS_STATES.STOPPED, 'orphan-owner-exit-confirmed', { backendPid, forced });
    return { stopped: true, exitConfirmed: true, backendPid, forced, termAccepted, state: this.state };
  }

  async _stopUnlocked(options = {}) {
    const child = this.child;
    if (!child) {
      if (this.rejectedOwner || this.ownerRegistry.isPotentiallyLive()) return this._terminateOrphanOwner(options);
      this.session = null;
      this.startAttempt = null;
      try { this.credentialIpcHost.close(); } catch (_) {}
      const custody = this.credentialCustodyHost;
      this.credentialCustodyHost = null;
      try { custody?.close?.(); } catch (_) {}
      if (this.credentialCustodyServer) { try { this.credentialCustodyServer.close(); } catch (_) {} this.credentialCustodyServer = null; }
      if (this.state !== PROCESS_STATES.STOPPED) this._transition(PROCESS_STATES.STOPPED, 'stop-without-child');
      return { stopped: true, exitConfirmed: true, alreadyStopped: true, reason: 'not-running', state: this.state, backendPid: 0 };
    }
    this._transition(PROCESS_STATES.STOPPING, 'stop-requested', { backendPid: child.pid || 0 });
    try {
      const result = await this._terminateAndWait(child, options);
      if (!result.exited || !result.exitConfirmed || !processExited(child)) throw startupFailure('DESKTOP_BACKEND_EXIT_NOT_CONFIRMED', 'Backend process has not emitted a real exit event');
      const recovery = await this.waitForOwnerExitRecovery(child);
      if (recovery?.recovered !== true) {
        throw startupFailure('WP4_CREDENTIAL_OWNER_EXIT_RECOVERY_PENDING', 'Backend exit occurred but credential owner recovery is not complete', { recovery, backendPid: child.pid || 0 });
      }
      if (this.child === child) {
        this.child = null;
        this.session = null;
        this.credentialIpcHost.close();
        this.credentialCustodyHost?.close?.();
        this.credentialCustodyHost = null;
        if (this.credentialCustodyServer) { try { this.credentialCustodyServer.close(); } catch (_) {} this.credentialCustodyServer = null; }
        this._transition(PROCESS_STATES.STOPPED, 'stop-confirmed', { backendPid: child.pid || 0 });
      }
      this.log('backend-process-stopped', { backendPid: child.pid || 0, forced: result.forced === true });
      return { stopped: true, backendPid: child.pid || 0, ...result, state: this.state };
    } catch (error) {
      this._recordFailure(error.reasonCode || 'DESKTOP_BACKEND_STOP_FAILED', child);
      this._transition(PROCESS_STATES.STOPPING, this.lastFailure.reasonCode, { backendPid: child.pid || 0 });
      return { stopped: false, exitConfirmed: false, backendPid: child.pid || 0, reasonCode: this.lastFailure.reasonCode, state: this.state };
    }
  }

  stop(options = {}) {
    this._cancelStartAttempt('DESKTOP_BACKEND_START_CANCELLED', 'Backend startup was cancelled by a stop request');
    return this._enqueue(() => this._stopUnlocked(options));
  }

  restart(options = {}) {
    this._cancelStartAttempt('DESKTOP_BACKEND_START_CANCELLED', 'Backend startup was cancelled by a restart request');
    return this._enqueue(async () => {
      const stopResult = await this._stopUnlocked(options);
      if (stopResult.stopped !== true || this.child && !processExited(this.child)) throw startupFailure(stopResult.reasonCode || 'DESKTOP_BACKEND_RESTART_BLOCKED', 'Cannot restart while previous backend remains alive');
      return this._startUnlocked(options);
    });
  }

  async acceptBackendOwner(context = {}) {
    if (this.rejectedOwner || this.ownerRegistryFailure) {
      throw startupFailure('WP4_DESKTOP_BACKEND_OWNER_ACCEPTANCE_BLOCKED', 'Rejected or registry-invalid backend owner cannot be accepted', { rejectedOwner: this.rejectedOwner, registryFailure: this.ownerRegistryFailure });
    }
    const backendPid = Number(context.backendPid || this.child?.pid || this.session?.backendPid || 0);
    if (!this.child || processExited(this.child) || !this.session || backendPid !== Number(this.child.pid || 0)) {
      throw startupFailure('WP4_DESKTOP_BACKEND_OWNER_ACCEPTANCE_STALE', 'Backend owner acceptance no longer matches the live child', { backendPid });
    }
    try {
      const record = await this.ownerRegistry.updateAsync({ state: 'RUNNING', ownershipActive: true, trusted: true, reasonCode: 'APPLICATION_RUNTIME_PROJECTION_ACCEPTED', ownerSession: this.session.ownerContext || null });
      this.orphanOwnerRecord = record;
      this.ownerRegistryFailure = null;
      return record;
    } catch (cause) {
      this.ownerRegistryFailure = { reasonCode: 'WP4_DESKTOP_BACKEND_OWNER_REGISTRY_ACCEPT_WRITE_FAILED', message: cause.message, atUtc: new Date().toISOString() };
      throw startupFailure(this.ownerRegistryFailure.reasonCode, 'Backend owner acceptance could not be durably recorded', { cause });
    }
  }

  containRejectedOwner(context = {}) {
    const child = this.child;
    const session = this.session;
    const registry = this.ownerRegistry.snapshot();
    const backendPid = Number(context.backendPid || child?.pid || session?.backendPid || registry?.backendPid || 0);
    const probe = this.ownerRegistry.probe(registry || { backendPid });
    const childStillLive = Boolean((child && !processExited(child)) || (!child && probe.alive === true && probe.identityMatch !== false));
    const base = {
      backendPid,
      startupNonce: String(context.startupNonce || session?.startupNonce || registry?.startupNonce || ''),
      backendSessionId: String(context.backendSessionId || session?.backendSessionId || registry?.backendSessionId || ''),
      fd6PipeInstanceId: String(context.fd6PipeInstanceId || session?.fd6PipeInstanceId || registry?.fd6PipeInstanceId || ''),
      reasonCode: String(context.reasonCode || 'WP4_DESKTOP_CREDENTIAL_REJECTED_OWNER'),
      childStillLive,
      pidIdentityMatch: probe.identityMatch,
      markedAtUtc: new Date().toISOString()
    };

    // Revoke authority in memory before invoking any close or persistence operation.
    if (session) this.session = Object.freeze({ ...session, apiSessionToken: '', rejected: true });
    this.rejectedOwner = Object.freeze({ ...base, apiAuthorityRevoked: true, fd6Closed: false, ownerRecordDurable: false });

    const custody = this.credentialCustodyHost;
    this.credentialCustodyHost = null;
    if (this.credentialCustodyServer) { try { this.credentialCustodyServer.close(); } catch (_) {} this.credentialCustodyServer = null; }
    let genericPipeClosed = true;
    let fd6Closed = true;
    const closeFailures = [];
    try { this.credentialIpcHost.close(); } catch (cause) { genericPipeClosed = false; closeFailures.push({ channel: 'FD5', message: cause.message }); }
    try { custody?.close?.(); } catch (cause) { closeFailures.push({ channel: 'FD6', message: cause.message }); }
    fd6Closed = this.credentialCustodyHost === null;

    this.rejectedOwner = Object.freeze({
      ...base,
      apiAuthorityRevoked: !this.session?.apiSessionToken,
      genericPipeClosed,
      fd6Closed,
      ownerRecordDurable: false,
      closeFailures
    });
    this._recordFailure(this.rejectedOwner.reasonCode, child);
    if (childStillLive && [PROCESS_STATES.RUNNING, PROCESS_STATES.STARTING].includes(this.state)) {
      this._transition(PROCESS_STATES.STOPPING, 'rejected-owner-contained', { backendPid });
    }

    // The coordinator uses persistOwnerRecord:false so all synchronous authority
    // revocation, FD6 detachment and the independent CredentialVaultHost fence are
    // established before this fallible durable bookkeeping is attempted.
    if (context.persistOwnerRecord !== false) return this.persistRejectedOwnerMarker(context);
    return this.rejectedOwner;
  }

  async persistRejectedOwnerMarker(context = {}) {
    if (!this.rejectedOwner) {
      throw startupFailure('WP4_DESKTOP_REJECTED_OWNER_MARKER_MISSING', 'Rejected owner cannot be persisted before in-memory containment is established');
    }
    const closeFailures = [...(this.rejectedOwner.closeFailures || [])];
    let ownerRecordDurable = false;
    if (this.ownerRegistryFailure) {
      // Never overwrite or "repair" an unreadable owner record during containment.
      // Its unknown PID/identity is itself a fail-closed condition that requires
      // explicit recovery; in-memory authority and FD6 remain revoked.
      closeFailures.push({ channel: 'OWNER_REGISTRY', message: this.ownerRegistryFailure.message || this.ownerRegistryFailure.reasonCode });
    } else {
      try {
        await this.ownerRegistry.markRejectedAsync({
          reasonCode: String(context.reasonCode || this.rejectedOwner.reasonCode || 'WP4_DESKTOP_CREDENTIAL_REJECTED_OWNER'),
          ownerSession: context.ownerSession || this.session?.ownerContext || this.ownerRegistry.snapshot()?.ownerSession || null
        });
        this.orphanOwnerRecord = this.ownerRegistry.snapshot();
        this.ownerRegistryFailure = null;
        ownerRecordDurable = this.ownerRegistry.enabled();
      } catch (cause) {
        this.ownerRegistryFailure = { reasonCode: 'WP4_DESKTOP_BACKEND_OWNER_REGISTRY_REJECT_WRITE_FAILED', message: cause.message, atUtc: new Date().toISOString() };
        closeFailures.push({ channel: 'OWNER_REGISTRY', message: cause.message });
      }
    }
    this.rejectedOwner = Object.freeze({
      ...this.rejectedOwner,
      ownerRecordDurable,
      closeFailures,
      ownerRecordPersistedAtUtc: ownerRecordDurable ? new Date().toISOString() : ''
    });
    return this.rejectedOwner;
  }

  async clearRejectedOwner(options = {}) {
    if (!this.rejectedOwner) return false;
    if (this.ownerRegistryFailure && options.force !== true) {
      throw startupFailure('WP4_DESKTOP_BACKEND_OWNER_REGISTRY_RECOVERY_BLOCKED', 'Rejected owner marker cannot be cleared while the durable owner registry is invalid or unavailable', { registryFailure: this.ownerRegistryFailure });
    }
    const child = this.child;
    const record = this.ownerRegistry.snapshot();
    const backendPid = Number(this.rejectedOwner.backendPid || child?.pid || record?.backendPid || 0);
    const observedExitedChild = options.observedExitedChild || null;
    const observedExitMatchesOwner = Boolean(
      observedExitedChild
      && this.ownerExitRecoveryByChild.has(observedExitedChild)
      && observedExitedChild.__desktopHostExited === true
      && processExited(observedExitedChild)
      && Number(observedExitedChild.pid || 0) === backendPid
      && Number(this.lastExit?.backendPid || 0) === backendPid
      && record?.state === 'EXITED'
      && record?.ownershipActive === false
    );
    // A ChildProcess instance owned and lifecycle-bound by this host provides a
    // stronger proof than a later PID-only liveness probe once its real `exit`
    // event has been observed. This is especially important on Windows, where
    // process.kill(pid, 0) can report an ambiguous live result while CIM no
    // longer returns the just-exited process. Only the exact observed child/PID
    // and an EXITED durable record may use this path; restored/orphan owners
    // still require normal process-identity verification and remain fail-closed.
    const probe = observedExitMatchesOwner
      ? { alive: false, identityMatch: true, reasonCode: 'OWNER_EXIT_EVENT_CONFIRMED', backendPid }
      : this.ownerRegistry.probe(record || { backendPid });
    if (options.force !== true && ((child && !processExited(child)) || (probe.alive === true && probe.identityMatch !== false))) {
      throw startupFailure('WP4_DESKTOP_REJECTED_OWNER_STILL_LIVE', 'Rejected owner marker cannot be cleared while its child remains live', { backendPid, probe });
    }
    try {
      await this.ownerRegistry.updateAsync({ state: 'RECOVERED', ownershipActive: false, trusted: false, reasonCode: probe.identityMatch === false ? 'OWNER_PID_REUSED_RECOVERED' : (observedExitMatchesOwner ? 'OWNER_EXIT_EVENT_RECOVERED' : 'OWNER_RECOVERY_COMPLETED'), recoveredAtUtc: new Date().toISOString() });
      this.orphanOwnerRecord = this.ownerRegistry.snapshot();
      this.ownerRegistryFailure = null;
    } catch (cause) {
      this.ownerRegistryFailure = { reasonCode: 'WP4_DESKTOP_BACKEND_OWNER_REGISTRY_RECOVERY_WRITE_FAILED', message: cause.message, atUtc: new Date().toISOString() };
      throw startupFailure(this.ownerRegistryFailure.reasonCode, 'Rejected owner recovery could not be durably recorded', { cause, backendPid });
    }
    this.rejectedOwner = null;
    return true;
  }

  isRejectedOwnerLive() {
    if (!this.rejectedOwner) return false;
    if (this.child && !processExited(this.child)) return true;
    const probe = this.ownerRegistry.probe(this.ownerRegistry.snapshot() || this.rejectedOwner);
    return probe.alive === true && probe.identityMatch !== false;
  }

  waitForOwnerExitRecovery(child = null) {
    const target = child || this.child;
    if (!target) {
      if (this.rejectedOwner || this.ownerRegistry.isPotentiallyLive()) {
        return Promise.resolve({ recovered: false, ownerRecoveryRequired: true, pendingExitEvent: false });
      }
      return Promise.resolve(this.lastOwnerExitRecovery?.result || { recovered: true, notRequired: true });
    }
    const recovery = this.ownerExitRecoveryByChild.get(target);
    if (recovery) return recovery;
    if (processExited(target)) {
      return Promise.resolve({ recovered: false, pendingExitEvent: false, pendingOwnerRecovery: true, backendPid: target.pid || 0 });
    }
    return Promise.resolve({ recovered: false, pendingExitEvent: true, childStillLive: true, backendPid: target.pid || 0 });
  }

  getOwnedChild() { return this.child; }

  hasOwnership() {
    const liveChild = Boolean(this.child && !processExited(this.child));
    return Boolean(liveChild || this.startAttempt || this.ownerRegistry.isPotentiallyLive() || [PROCESS_STATES.STARTING, PROCESS_STATES.RUNNING, PROCESS_STATES.STOPPING].includes(this.state));
  }

  snapshot() {
    const ownerRegistry = this.ownerRegistry.snapshot();
    const liveChild = Boolean(this.child && !processExited(this.child));
    const ownershipClaimActive = Boolean(this.rejectedOwner || this.session || this.startAttempt || ownerRegistry?.ownershipActive === true);
    const ownerTrusted = Boolean(
      !this.rejectedOwner &&
      !this.ownerRegistryFailure &&
      (!ownershipClaimActive || (ownerRegistry?.state === 'RUNNING' && ownerRegistry?.ownershipActive === true && ownerRegistry?.trusted === true))
    );
    return Object.freeze({
      state: this.state,
      running: Boolean(this.child && !processExited(this.child) && this.state === PROCESS_STATES.RUNNING),
      backendPid: this.child?.pid || Number((this.rejectedOwner?.childStillLive ? this.rejectedOwner.backendPid : 0) || (this.ownerRegistry.snapshot()?.ownershipActive ? this.ownerRegistry.snapshot()?.backendPid : 0) || 0),
      startupNonce: this.session?.startupNonce || this.rejectedOwner?.startupNonce || this.ownerRegistry.snapshot()?.startupNonce || null,
      apiSessionEstablished: Boolean(this.session?.apiSessionToken),
      credentialFrameDelivered: Boolean(this.session?.credentialFrameDelivered),
      credentialHydrated: Boolean(this.session?.credentialHydrated),
      credentialVaultEpoch: this.session?.credentialVaultEpoch || null,
      credentialGeneration: this.session?.credentialGeneration || 0,
      credentialAuthorityEventId: this.session?.credentialAuthorityEventId || null,
      credentialAuthorityHeadDigest: this.session?.credentialAuthorityHeadDigest || null,
      credentialVaultReferenceCount: this.session?.credentialVaultReferenceCount ?? -1,
      credentialDecryptedEntryCount: this.session?.credentialDecryptedEntryCount ?? -1,
      credentialFrameEntryCount: this.session?.credentialFrameEntryCount ?? -1,
      startupAttemptId: this.session?.startupAttemptId || null,
      backendSessionId: this.session?.backendSessionId || null,
      runtimeContract: this.session?.runtimeContract || null,
      fd6PipeInstanceId: this.session?.fd6PipeInstanceId || null,
      readyCredentialMetadata: this.session?.readyCredentialMetadata || null,
      ownerContext: this.session?.ownerContext || null,
      lastOwnerExitRecovery: this.lastOwnerExitRecovery,
      credentialCustody: this.credentialCustodyHost?.snapshot?.() || null,
      ownerTrusted,
      rejectedOwner: this.rejectedOwner ? { ...this.rejectedOwner } : null,
      ownerRegistry,
      ownerRegistryFailure: this.ownerRegistryFailure ? { ...this.ownerRegistryFailure } : null,
      startupPending: Boolean(this.startAttempt),
      ownershipPresent: this.hasOwnership(),
      ownedChildPresent: Boolean(this.child),
      shutdownPending: this.state === PROCESS_STATES.STOPPING,
      lastExit: this.lastExit,
      lastFailure: this.lastFailure,
      lastStartCancellation: this.lastStartCancellation ? { ...this.lastStartCancellation } : null,
      stateHistory: this.stateHistory.map(item => ({ ...item }))
    });
  }
}

module.exports = { BackendProcessHost, PROCESS_STATES, sanitizedEnvironment, waitForExit, processExited, validateBackendLaunchContract, probeNodeRuntimeExecutable };