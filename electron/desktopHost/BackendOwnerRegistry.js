'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const SCHEMA_VERSION = 1;
const LIVE_STATES = new Set(['SPAWNED', 'STARTING', 'RUNNING', 'REJECTED', 'STOPPING']);
const TERMINAL_STATES = new Set(['EXITED', 'RECOVERED']);
const ALLOWED_STATES = new Set([...LIVE_STATES, ...TERMINAL_STATES]);
const LEGACY_OR_AMBIGUOUS_FIELDS = Object.freeze([
  'pid', 'processId', 'active', 'isActive', 'isTrusted', 'sessionId', 'pipeInstanceId',
  'startup_token', 'backend_session_id', 'fd6_pipe_instance_id'
]);

function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function nonEmptyString(value) { return typeof value === 'string' && value.trim().length > 0; }
function plainObject(value) { return Boolean(value && typeof value === 'object' && !Array.isArray(value)); }
function sha256(value) { return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex'); }

function registryValidationError(message, details = {}) {
  const error = new Error(message);
  error.reasonCode = 'WP4_DESKTOP_BACKEND_OWNER_REGISTRY_SEMANTIC_INVALID';
  error.details = details;
  return error;
}

function validateProcessIdentity(identity) {
  if (!plainObject(identity)) throw registryValidationError('Active backend owner processIdentity must be an object', { field: 'processIdentity' });
  if (!nonEmptyString(identity.platform)) throw registryValidationError('Active backend owner processIdentity.platform is required', { field: 'processIdentity.platform' });

  const platform = identity.platform.trim();
  if (platform === 'linux') {
    if (!nonEmptyString(identity.startTicks) || !/^\d+$/.test(identity.startTicks) || BigInt(identity.startTicks) < 1n) {
      throw registryValidationError('Linux backend owner processIdentity.startTicks must be a positive integer string', { field: 'processIdentity.startTicks' });
    }
    if (!nonEmptyString(identity.commandDigest) || !/^[a-f0-9]{64}$/i.test(identity.commandDigest)) {
      throw registryValidationError('Linux backend owner processIdentity.commandDigest must be a SHA-256 digest', { field: 'processIdentity.commandDigest' });
    }
  } else if (platform === 'win32') {
    if (!nonEmptyString(identity.creationTimeUtc)) {
      throw registryValidationError('Windows backend owner processIdentity.creationTimeUtc is required', { field: 'processIdentity.creationTimeUtc' });
    }
    if (!nonEmptyString(identity.executablePathDigest) || !/^[a-f0-9]{64}$/i.test(identity.executablePathDigest)) {
      throw registryValidationError('Windows backend owner processIdentity.executablePathDigest must be a SHA-256 digest', { field: 'processIdentity.executablePathDigest' });
    }
    if (!nonEmptyString(identity.commandDigest) || !/^[a-f0-9]{64}$/i.test(identity.commandDigest)) {
      throw registryValidationError('Windows backend owner processIdentity.commandDigest must be a SHA-256 digest', { field: 'processIdentity.commandDigest' });
    }
  } else if (platform === 'darwin') {
    if (!nonEmptyString(identity.startTimeUtc)) {
      throw registryValidationError('macOS backend owner processIdentity.startTimeUtc is required', { field: 'processIdentity.startTimeUtc' });
    }
    if (!nonEmptyString(identity.commandDigest) || !/^[a-f0-9]{64}$/i.test(identity.commandDigest)) {
      throw registryValidationError('macOS backend owner processIdentity.commandDigest must be a SHA-256 digest', { field: 'processIdentity.commandDigest' });
    }
  } else if (platform === 'test') {
    if (!nonEmptyString(identity.startTicks) || !nonEmptyString(identity.commandDigest)) {
      throw registryValidationError('Test backend owner process identity is incomplete', { field: 'processIdentity' });
    }
  } else {
    throw registryValidationError('Backend owner processIdentity.platform is not supported', { field: 'processIdentity.platform', platform });
  }
  return true;
}

function validateOwnerRecord(record, options = {}) {
  if (!plainObject(record)) throw registryValidationError('Backend owner registry record must be an object');
  if (record.schemaVersion !== SCHEMA_VERSION) {
    throw registryValidationError('Backend owner registry schemaVersion must be the exact supported numeric version', { field: 'schemaVersion', expected: SCHEMA_VERSION });
  }
  for (const field of LEGACY_OR_AMBIGUOUS_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(record, field)) {
      throw registryValidationError('Backend owner registry contains legacy or ambiguous fields', { field });
    }
  }
  if (typeof record.state !== 'string' || !ALLOWED_STATES.has(record.state)) {
    throw registryValidationError('Backend owner registry state is not recognized', { field: 'state', value: record.state });
  }
  if (typeof record.ownershipActive !== 'boolean') {
    throw registryValidationError('Backend owner registry ownershipActive must be a boolean', { field: 'ownershipActive' });
  }
  if (typeof record.trusted !== 'boolean') {
    throw registryValidationError('Backend owner registry trusted must be a boolean', { field: 'trusted' });
  }
  if (typeof record.backendPid !== 'number' || !Number.isInteger(record.backendPid)) {
    throw registryValidationError('Backend owner registry backendPid must be an integer number', { field: 'backendPid', value: record.backendPid });
  }

  const liveState = LIVE_STATES.has(record.state);
  const terminalState = TERMINAL_STATES.has(record.state);
  if (liveState !== record.ownershipActive) {
    throw registryValidationError('Backend owner registry state and ownershipActive contradict each other', { state: record.state, ownershipActive: record.ownershipActive });
  }
  if (terminalState && (record.ownershipActive !== false || record.trusted !== false)) {
    throw registryValidationError('Terminal backend owner records must be inactive and untrusted', { state: record.state, ownershipActive: record.ownershipActive, trusted: record.trusted });
  }
  if (record.trusted === true && (record.state !== 'RUNNING' || record.ownershipActive !== true)) {
    throw registryValidationError('Only an active RUNNING backend owner may be trusted', { state: record.state, ownershipActive: record.ownershipActive, trusted: record.trusted });
  }
  if (record.state === 'RUNNING' && record.trusted === false && record.reasonCode !== 'BACKEND_READY_AWAITING_APPLICATION_VALIDATION') {
    throw registryValidationError('An untrusted RUNNING owner is valid only while awaiting application runtime projection validation', { state: record.state, trusted: record.trusted, reasonCode: record.reasonCode });
  }

  if (record.ownershipActive) {
    if (options.expectedPlatform && record.processIdentity?.platform !== options.expectedPlatform) {
      throw registryValidationError('Active backend owner processIdentity platform does not match the current platform policy', { field: 'processIdentity.platform', expectedPlatform: options.expectedPlatform, actualPlatform: record.processIdentity?.platform || null });
    }
    if (record.backendPid < 1) {
      throw registryValidationError('Active backend owner backendPid must be greater than zero', { field: 'backendPid', value: record.backendPid });
    }
    for (const field of ['startupNonce', 'backendSessionId', 'fd6PipeInstanceId']) {
      if (!nonEmptyString(record[field])) {
        throw registryValidationError(`Active backend owner ${field} is required`, { field });
      }
    }
    if (options.requireProcessIdentity !== false) validateProcessIdentity(record.processIdentity);
  } else if (record.backendPid < 0) {
    throw registryValidationError('Inactive backend owner backendPid cannot be negative', { field: 'backendPid', value: record.backendPid });
  }

  return record;
}

function fsyncSyncIfSupported(fsApi, handle, context) {
  if (typeof fsApi.fsyncSync !== 'function') return;
  try { fsApi.fsyncSync(handle); }
  catch (error) {
    // Windows does not consistently support directory fsync on NTFS / temp
    // locations. Treat only that platform limitation as non-fatal; file fsync
    // failures and non-Windows directory failures still fail closed.
    if (context === 'directory' && process.platform === 'win32' && error?.code === 'EPERM') return;
    throw error;
  }
}

function atomicWriteJson(file, value, fsApi = fs) {
  fsApi.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  let handle = null;
  let directory = null;
  try {
    handle = fsApi.openSync(temp, 'w', 0o600);
    fsApi.writeFileSync(handle, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    fsyncSyncIfSupported(fsApi, handle, 'file');
    fsApi.closeSync(handle);
    handle = null;
    fsApi.renameSync(temp, file);
    directory = fsApi.openSync(path.dirname(file), 'r');
    fsyncSyncIfSupported(fsApi, directory, 'directory');
    fsApi.closeSync(directory);
    directory = null;
  } catch (error) {
    if (handle !== null) try { fsApi.closeSync(handle); } catch (_) {}
    if (directory !== null) try { fsApi.closeSync(directory); } catch (_) {}
    try { fsApi.rmSync(temp, { force: true }); } catch (_) {}
    throw error;
  }
}

function linuxProcessIdentity(pid, fsApi = fs) {
  if (process.platform !== 'linux') return null;
  try {
    const stat = fsApi.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const close = stat.lastIndexOf(')');
    if (close < 0) return null;
    const fields = stat.slice(close + 2).trim().split(/\s+/);
    const startTicks = fields[19]; // field 22 overall, after pid and comm
    const cmdline = fsApi.readFileSync(`/proc/${pid}/cmdline`);
    if (!startTicks || !cmdline.length) return null;
    return {
      platform: 'linux',
      startTicks: String(startTicks),
      commandDigest: crypto.createHash('sha256').update(cmdline).digest('hex')
    };
  } catch (_) {
    return null;
  }
}

function windowsProcessIdentity(pid, execFile = execFileSync, platform = process.platform) {
  const debugLog = (msg, data) => {
    try {
      const logDir = path.join(process.env.APPDATA || process.env.HOME || '.', 'Yance', 'debug');
      const logPath = path.join(logDir, 'windowsProcessIdentity_debug.jsonl');
      fs.mkdirSync(logDir, { recursive: true });
      fs.appendFileSync(logPath, `${JSON.stringify({ timestamp: new Date().toISOString(), msg, data })}\n`, 'utf8');
    } catch (_) {}
  };
  const sleepSync = ms => {
    const value = Math.max(0, Number(ms || 0));
    if (!value) return;
    // Synchronous because BackendOwnerRegistry is intentionally synchronous and
    // writes an atomic owner record before startup continues.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, value);
  };

  debugLog('windowsProcessIdentity called', { pid, platform, expectedPlatform: 'win32', execFileType: typeof execFile });
  if (platform !== 'win32') {
    debugLog('platform is not win32', { platform });
    return null;
  }
  const value = Number(pid || 0);
  if (!Number.isInteger(value) || value < 1) {
    debugLog('invalid pid', { value, pid });
    return null;
  }

  const script = [
    `$p = Get-CimInstance Win32_Process -Filter \"ProcessId = ${value}\" -ErrorAction Stop`,
    'if ($null -eq $p) { exit 3 }',
    '$o = [ordered]@{ ProcessId = [int]$p.ProcessId; CreationDate = $p.CreationDate.ToUniversalTime().ToString("o"); ExecutablePath = [string]$p.ExecutablePath; CommandLine = [string]$p.CommandLine }',
    '$o | ConvertTo-Json -Compress'
  ].join('; ');
  const powershellPath = process.env.SystemRoot
    ? path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    : 'powershell.exe';

  const maxAttempts = Math.max(1, Number(process.env.YANCE_WIN_PROCESS_IDENTITY_ATTEMPTS || 8));
  const delayMs = Math.max(0, Number(process.env.YANCE_WIN_PROCESS_IDENTITY_RETRY_MS || 125));
  let lastError = null;
  let lastRaw = '';

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      debugLog('executing PowerShell', { attempt, maxAttempts, powershellPath });
      const raw = execFile(powershellPath, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
        encoding: 'utf8',
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 5000
      }).trim();
      lastRaw = raw;
      debugLog('PowerShell output', { attempt, raw: raw.slice(0, 500) });
      const row = JSON.parse(raw);
      if (Number(row.ProcessId) !== value || !nonEmptyString(row.CreationDate) || !nonEmptyString(row.ExecutablePath) || !nonEmptyString(row.CommandLine)) {
        lastError = new Error('Windows process identity CIM row is incomplete or mismatched');
        debugLog('validation failed', { attempt, row });
      } else {
        const result = {
          platform: 'win32',
          creationTimeUtc: String(row.CreationDate),
          executablePathDigest: sha256(String(row.ExecutablePath).toLowerCase()),
          commandDigest: sha256(row.CommandLine)
        };
        debugLog('returning result', { attempt, result });
        return result;
      }
    } catch (error) {
      lastError = error;
      debugLog('PowerShell execution failed', {
        attempt,
        name: error.name || '',
        message: error.message || '',
        code: error.code || '',
        status: error.status ?? null,
        signal: error.signal || '',
        stdout: String(error.stdout || '').slice(0, 500),
        stderr: String(error.stderr || '').slice(0, 500)
      });
    }
    if (attempt < maxAttempts) sleepSync(delayMs);
  }

  debugLog('returning null after retries', {
    pid: value,
    attempts: maxAttempts,
    lastError: lastError ? { message: lastError.message || '', code: lastError.code || '', status: lastError.status ?? null } : null,
    lastRaw: lastRaw.slice(0, 500)
  });
  return null;
}

function platformProcessIdentity(pid, options = {}) {
  const platform = options.platform || process.platform;
  if (platform === 'linux') return linuxProcessIdentity(pid, options.fs || fs);
  if (platform === 'win32') return windowsProcessIdentity(pid, options.execFile || execFileSync, platform);
  return null;
}

function processIdentityMatches(expected, actual) {
  if (!plainObject(expected) || !plainObject(actual) || expected.platform !== actual.platform) return false;
  if (expected.platform === 'linux' || expected.platform === 'test') {
    return expected.startTicks === actual.startTicks && expected.commandDigest === actual.commandDigest;
  }
  if (expected.platform === 'win32') {
    return expected.creationTimeUtc === actual.creationTimeUtc && expected.executablePathDigest === actual.executablePathDigest && expected.commandDigest === actual.commandDigest;
  }
  if (expected.platform === 'darwin') {
    return expected.startTimeUtc === actual.startTimeUtc && expected.commandDigest === actual.commandDigest;
  }
  return false;
}

class BackendOwnerRegistry {
  constructor(options = {}) {
    this.file = options.file ? path.resolve(options.file) : '';
    this.fs = options.fs || fs;
    this.clock = options.clock || (() => new Date().toISOString());
    this.isProcessAlive = options.isProcessAlive || (pid => {
      const value = Number(pid || 0);
      if (!Number.isInteger(value) || value < 1) return false;
      try { process.kill(value, 0); return true; }
      catch (cause) { return cause?.code !== 'ESRCH'; }
    });
    this.captureIdentity = options.captureIdentity || (pid => platformProcessIdentity(pid, { fs: this.fs }));
    this.processIdentityPlatform = options.processIdentityPlatform || (options.captureIdentity ? '' : process.platform);
    this.record = null;
    this.loadFailure = null;
    this._load();
  }

  enabled() { return Boolean(this.file); }

  _load() {
    if (!this.enabled() || !this.fs.existsSync(this.file)) return;
    let parsed = null;
    try {
      parsed = JSON.parse(this.fs.readFileSync(this.file, 'utf8'));
      validateOwnerRecord(parsed, { requireProcessIdentity: true, expectedPlatform: this.processIdentityPlatform || undefined });
      this.record = parsed;
    } catch (cause) {
      this.record = null;
      this.loadFailure = {
        reasonCode: cause?.reasonCode || 'WP4_DESKTOP_BACKEND_OWNER_REGISTRY_INVALID',
        message: cause.message,
        details: clone(cause?.details || null),
        claimedState: typeof parsed?.state === 'string' ? parsed.state : null,
        claimedOwnershipActive: typeof parsed?.ownershipActive === 'boolean' ? parsed.ownershipActive : null,
        claimedTrusted: typeof parsed?.trusted === 'boolean' ? parsed.trusted : null,
        claimedBackendPid: typeof parsed?.backendPid === 'number' ? parsed.backendPid : null,
        recoveryRequired: true,
        atUtc: this.clock()
      };
    }
  }

  snapshot() { return this.record ? Object.freeze(clone(this.record)) : null; }

  probe(record = this.record) {
    if (!record) return { alive: false, identityMatch: null, reasonCode: 'NO_OWNER_RECORD' };
    const pid = Number(record.backendPid || 0);
    if (!Number.isInteger(pid) || pid < 1) return { alive: false, identityMatch: null, reasonCode: 'OWNER_PID_INVALID', backendPid: pid };
    let alive = false;
    try { alive = this.isProcessAlive(pid) === true; }
    catch (cause) {
      return { alive: true, identityMatch: null, reasonCode: cause?.code === 'EPERM' ? 'OWNER_LIVENESS_EPERM' : 'OWNER_LIVENESS_UNKNOWN', backendPid: pid };
    }
    if (!alive) return { alive: false, identityMatch: true, reasonCode: 'OWNER_NOT_LIVE', backendPid: pid };
    const expected = record.processIdentity || null;
    const actual = this.captureIdentity(pid);
    if (!expected || !actual) return { alive: true, identityMatch: null, reasonCode: 'OWNER_IDENTITY_UNVERIFIED', backendPid: pid, expected, actual };
    const identityMatch = processIdentityMatches(expected, actual);
    return {
      alive: true,
      identityMatch,
      reasonCode: identityMatch ? 'OWNER_IDENTITY_MATCH' : 'OWNER_PID_REUSED',
      backendPid: pid,
      expected,
      actual
    };
  }

  _write(record) {
    const candidate = {
      schemaVersion: SCHEMA_VERSION,
      ...clone(record),
      updatedAtUtc: this.clock()
    };
    validateOwnerRecord(candidate, {
      requireProcessIdentity: this.enabled(),
      expectedPlatform: this.enabled() ? (this.processIdentityPlatform || undefined) : undefined
    });
    if (this.enabled()) atomicWriteJson(this.file, candidate, this.fs);
    this.record = candidate;
    return this.snapshot();
  }

  register(context = {}) {
    const backendPid = context.backendPid;
    const capturedIdentity = this.captureIdentity(backendPid);
    // Debug logging
    try {
      const logDir = path.join(process.env.APPDATA || process.env.HOME || '.', 'Yance', 'debug');
      const logPath = path.join(logDir, 'register_debug.jsonl');
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }
      const entry = JSON.stringify({
        timestamp: new Date().toISOString(),
        backendPid,
        capturedIdentity,
        captureIdentityType: typeof this.captureIdentity,
        processIdentityPlatform: this.processIdentityPlatform
      }) + '\n';
      fs.appendFileSync(logPath, entry, 'utf8');
    } catch (e) {
      console.error('[register debug log failed]', e.message);
    }
    const record = {
      schemaVersion: SCHEMA_VERSION,
      state: context.state === undefined ? 'SPAWNED' : context.state,
      ownershipActive: true,
      trusted: context.trusted === true,
      backendPid,
      startupNonce: context.startupNonce,
      backendSessionId: context.backendSessionId,
      fd6PipeInstanceId: context.fd6PipeInstanceId,
      processIdentity: clone(context.processIdentity || capturedIdentity),
      ownerSession: clone(context.ownerSession || null),
      reasonCode: typeof context.reasonCode === 'string' ? context.reasonCode : '',
      spawnedAtUtc: typeof context.spawnedAtUtc === 'string' ? context.spawnedAtUtc : this.clock(),
      updatedAtUtc: this.clock()
    };
    return this._write(record);
  }

  update(context = {}) {
    if (!this.record) return this.register(context);
    return this._write({ ...this.record, ...clone(context), schemaVersion: SCHEMA_VERSION });
  }

  markRejected(context = {}) {
    return this.update({
      state: 'REJECTED',
      ownershipActive: true,
      trusted: false,
      reasonCode: String(context.reasonCode || this.record?.reasonCode || 'WP4_DESKTOP_CREDENTIAL_REJECTED_OWNER'),
      ownerSession: clone(context.ownerSession || this.record?.ownerSession || null),
      rejectedAtUtc: this.clock()
    });
  }

  markExited(context = {}) {
    return this.update({
      state: 'EXITED',
      ownershipActive: false,
      trusted: false,
      reasonCode: String(context.reasonCode || this.record?.reasonCode || ''),
      exitCode: context.exitCode ?? null,
      signalCode: context.signalCode || null,
      exitedAtUtc: this.clock()
    });
  }

  isPotentiallyLive() {
    if (!this.record || this.record.ownershipActive !== true || !LIVE_STATES.has(String(this.record.state || ''))) return false;
    const probe = this.probe();
    return probe.alive === true && probe.identityMatch !== false;
  }
}

module.exports = {
  BackendOwnerRegistry,
  LIVE_STATES,
  TERMINAL_STATES,
  ALLOWED_STATES,
  SCHEMA_VERSION,
  atomicWriteJson,
  linuxProcessIdentity,
  windowsProcessIdentity,
  platformProcessIdentity,
  processIdentityMatches,
  validateProcessIdentity,
  validateOwnerRecord
};
