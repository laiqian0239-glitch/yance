'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const properLockfile = require('proper-lockfile');
const { atomicWriteJsonAsync, mkdirAsync, readFileTextAsync } = require('./asyncDurability');

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
function promiseLike(value) { return Boolean(value && typeof value.then === 'function'); }
function asyncDelay(ms) { return new Promise(resolve => setTimeout(resolve, Math.max(0, Number(ms || 0)))); }

function registryValidationError(message, details = {}) {
  const error = new Error(message);
  error.reasonCode = 'WP4_DESKTOP_BACKEND_OWNER_REGISTRY_SEMANTIC_INVALID';
  error.details = details;
  return error;
}

function ownerClaimError(cause, phase = 'acquire') {
  const locked = cause?.code === 'ELOCKED';
  const error = new Error(locked
    ? 'Another DesktopHost process is currently claiming the backend owner registry'
    : `Backend owner claim lock ${phase} failed`);
  error.reasonCode = locked
    ? 'WP4_DESKTOP_BACKEND_OWNER_CLAIM_LOCK_HELD'
    : 'WP4_DESKTOP_BACKEND_OWNER_CLAIM_LOCK_FAILED';
  error.code = cause?.code || '';
  error.retryable = locked;
  error.phase = phase;
  error.causeMessage = cause?.message || String(cause || '');
  return error;
}

function registryLoadFailureError(failure = {}) {
  const error = new Error(failure.message || 'Backend owner registry cannot be trusted during owner claim');
  error.reasonCode = failure.reasonCode || 'WP4_DESKTOP_BACKEND_OWNER_REGISTRY_INVALID';
  error.registryFailure = clone(failure);
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
    const startTicks = fields[19];
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

function windowsProcessIdentity(pid, execFileImpl = null, platform = process.platform) {
  const debugLog = (msg, data) => {
    try {
      const logDir = path.join(process.env.APPDATA || process.env.HOME || '.', 'Yance', 'debug');
      const logPath = path.join(logDir, 'windowsProcessIdentity_debug.jsonl');
      const entry = `${JSON.stringify({ timestamp: new Date().toISOString(), msg, data })}\n`;
      fs.promises.mkdir(logDir, { recursive: true })
        .then(() => fs.promises.appendFile(logPath, entry, 'utf8'))
        .catch(() => {});
    } catch (_) {}
  };

  debugLog('windowsProcessIdentity called', { pid, platform, expectedPlatform: 'win32', execFileType: typeof execFileImpl });
  if (platform !== 'win32') {
    debugLog('platform is not win32', { platform });
    return null;
  }
  const value = Number(pid || 0);
  if (!Number.isInteger(value) || value < 1) {
    debugLog('invalid pid', { value, pid });
    return null;
  }

  const cimScript = [
    `$p = Get-CimInstance Win32_Process -Filter "ProcessId = ${value}" -ErrorAction Stop`,
    'if ($null -eq $p) { exit 3 }',
    '$o = [ordered]@{ ProcessId = [int]$p.ProcessId; CreationDate = $p.CreationDate.ToUniversalTime().ToString("o"); ExecutablePath = [string]$p.ExecutablePath; CommandLine = [string]$p.CommandLine }',
    '$o | ConvertTo-Json -Compress'
  ].join('; ');
  const managementScript = [
    'Add-Type -AssemblyName System.Management -ErrorAction Stop',
    `$searcher = [System.Management.ManagementObjectSearcher]::new("SELECT ProcessId, CreationDate, ExecutablePath, CommandLine FROM Win32_Process WHERE ProcessId = ${value}")`,
    '$results = $null',
    'try { $results = $searcher.Get(); $p = $results | Select-Object -First 1; if ($null -eq $p) { exit 3 }; $creation = [System.Management.ManagementDateTimeConverter]::ToDateTime([string]$p.CreationDate).ToUniversalTime().ToString("o"); $o = [ordered]@{ ProcessId = [int]$p.ProcessId; CreationDate = $creation; ExecutablePath = [string]$p.ExecutablePath; CommandLine = [string]$p.CommandLine }; $o | ConvertTo-Json -Compress } finally { if ($null -ne $results) { $results.Dispose() }; if ($null -ne $searcher) { $searcher.Dispose() } }'
  ].join('; ');
  const powershellPath = process.env.SystemRoot
    ? path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    : 'powershell.exe';
  const commandArgs = script => ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script];
  const cimExecOptions = { encoding: 'utf8', windowsHide: true, timeout: 5000, maxBuffer: 1024 * 1024 };
  const managementExecOptions = { encoding: 'utf8', windowsHide: true, timeout: 2500, maxBuffer: 1024 * 1024 };

  const configuredAttempts = Number(process.env.YANCE_WIN_PROCESS_IDENTITY_ATTEMPTS || 3);
  const configuredDelay = Number(process.env.YANCE_WIN_PROCESS_IDENTITY_RETRY_MS || 125);
  const maxAttempts = Math.min(4, Math.max(1, Number.isFinite(configuredAttempts) ? Math.trunc(configuredAttempts) : 3));
  const delayMs = Math.min(1000, Math.max(0, Number.isFinite(configuredDelay) ? Math.trunc(configuredDelay) : 125));
  const collectors = [
    { authority: 'cim', args: commandArgs(cimScript), options: cimExecOptions },
    ...Array.from({ length: Math.max(0, maxAttempts - 1) }, () => ({
      authority: 'system-management',
      args: commandArgs(managementScript),
      options: managementExecOptions
    }))
  ];

  const parseRaw = (raw, attempt, authority) => {
    const text = String(raw || '').trim();
    debugLog('PowerShell output', { attempt, authority, raw: text.slice(0, 500) });
    const row = JSON.parse(text);
    if (Number(row.ProcessId) !== value || !nonEmptyString(row.CreationDate) || !nonEmptyString(row.ExecutablePath) || !nonEmptyString(row.CommandLine)) {
      const error = new Error('Windows process identity row is incomplete or mismatched');
      error.identityRow = row;
      throw error;
    }
    const result = {
      platform: 'win32',
      creationTimeUtc: String(row.CreationDate),
      executablePathDigest: sha256(String(row.ExecutablePath).toLowerCase()),
      commandDigest: sha256(row.CommandLine)
    };
    debugLog('returning result', { attempt, authority, result });
    return result;
  };

  const logFailure = (attempt, authority, error) => {
    debugLog('PowerShell execution failed', {
      attempt,
      authority,
      name: error?.name || '',
      message: error?.message || '',
      code: error?.code || '',
      status: error?.status ?? null,
      signal: error?.signal || '',
      stdout: String(error?.stdout || '').slice(0, 500),
      stderr: String(error?.stderr || '').slice(0, 500)
    });
  };

  if (typeof execFileImpl === 'function') {
    let lastError = null;
    let lastRaw = '';
    for (let index = 0; index < collectors.length; index += 1) {
      const attempt = index + 1;
      const collector = collectors[index];
      try {
        debugLog('executing injected Windows identity collector', { attempt, maxAttempts, authority: collector.authority, powershellPath });
        const raw = execFileImpl(powershellPath, collector.args, collector.options);
        lastRaw = String(raw || '');
        return parseRaw(lastRaw, attempt, collector.authority);
      } catch (error) {
        lastError = error;
        logFailure(attempt, collector.authority, error);
      }
    }
    debugLog('returning null after injected collector attempts', {
      pid: value,
      attempts: collectors.length,
      lastError: lastError ? { message: lastError.message || '', code: lastError.code || '', status: lastError.status ?? null } : null,
      lastRaw: lastRaw.slice(0, 500)
    });
    return null;
  }

  return (async () => {
    let lastError = null;
    let lastRaw = '';
    for (let index = 0; index < collectors.length; index += 1) {
      const attempt = index + 1;
      const collector = collectors[index];
      try {
        debugLog('executing PowerShell asynchronously', { attempt, maxAttempts, authority: collector.authority, powershellPath });
        const raw = await new Promise((resolve, reject) => {
          execFile(powershellPath, collector.args, collector.options, (error, stdout, stderr) => {
            if (error) {
              error.stdout = stdout;
              error.stderr = stderr;
              reject(error);
              return;
            }
            resolve(stdout);
          });
        });
        lastRaw = String(raw || '');
        return parseRaw(lastRaw, attempt, collector.authority);
      } catch (error) {
        lastError = error;
        logFailure(attempt, collector.authority, error);
      }
      if (index + 1 < collectors.length && delayMs > 0) await asyncDelay(delayMs);
    }
    debugLog('returning null after async collector attempts', {
      pid: value,
      attempts: collectors.length,
      lastError: lastError ? { message: lastError.message || '', code: lastError.code || '', status: lastError.status ?? null } : null,
      lastRaw: lastRaw.slice(0, 500)
    });
    return null;
  })();
}

function platformProcessIdentity(pid, options = {}) {
  const platform = options.platform || process.platform;
  if (platform === 'linux') return linuxProcessIdentity(pid, options.fs || fs);
  if (platform === 'win32') return windowsProcessIdentity(pid, options.execFile || null, platform);
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

async function processAliveAsync(pid, options = {}) {
  const value = Number(pid || 0);
  if (!Number.isInteger(value) || value < 1) return false;
  const platform = options.platform || process.platform;
  const fsApi = options.fsApi || fs;
  if (platform === 'linux' && fsApi?.promises?.access) {
    try { await fsApi.promises.access(`/proc/${value}`); return true; }
    catch (cause) { return cause?.code !== 'ENOENT' && cause?.code !== 'ESRCH'; }
  }

  const executable = platform === 'win32'
    ? (process.env.SystemRoot ? path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe') : 'powershell.exe')
    : '/bin/kill';
  const args = platform === 'win32'
    ? ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', `Get-Process -Id ${value} -ErrorAction Stop | Out-Null`]
    : ['-0', String(value)];
  return new Promise(resolve => {
    execFile(executable, args, { windowsHide: true, timeout: 3000 }, error => {
      if (!error) { resolve(true); return; }
      const diagnostic = `${error?.message || ''}\n${error?.stderr || ''}`;
      if (/operation not permitted|access is denied|permission denied/i.test(diagnostic)) { resolve(true); return; }
      resolve(false);
    });
  });
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
    this.isProcessAliveAsync = options.isProcessAliveAsync
      || (options.isProcessAlive
        ? (async pid => options.isProcessAlive(pid) === true)
        : (pid => processAliveAsync(pid, { fsApi: this.fs })));
    this.captureIdentity = options.captureIdentity || (pid => platformProcessIdentity(pid, { fs: this.fs }));
    this.captureIdentityIsAsync = options.captureIdentityIsAsync === true
      || (!options.captureIdentity && process.platform === 'win32')
      || options.captureIdentity?.constructor?.name === 'AsyncFunction';
    this.processIdentityPlatform = options.processIdentityPlatform || (options.captureIdentity ? '' : process.platform);
    this.lockfile = options.lockfile || properLockfile;
    this.claimLockStaleMs = Math.max(5000, Number(options.claimLockStaleMs || 30000));
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

  refresh() {
    this.record = null;
    this.loadFailure = null;
    this._load();
    return this.snapshot();
  }

  async _loadAsync() {
    if (!this.enabled()) return;
    const text = await readFileTextAsync(this.file, this.fs);
    if (text === null) return;
    let parsed = null;
    try {
      parsed = JSON.parse(text);
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

  async refreshAsync() {
    this.record = null;
    this.loadFailure = null;
    await this._loadAsync();
    return this.snapshot();
  }

  snapshot() { return this.record ? Object.freeze(clone(this.record)) : null; }

  async captureIdentityAsync(pid) {
    const captured = this.captureIdentity(pid);
    if (promiseLike(captured)) this.captureIdentityIsAsync = true;
    return Promise.resolve(captured);
  }

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
    if (this.captureIdentityIsAsync) {
      return { alive: true, identityMatch: null, reasonCode: 'OWNER_IDENTITY_ASYNC_REQUIRED', backendPid: pid, expected, actual: null };
    }
    const actual = this.captureIdentity(pid);
    if (promiseLike(actual)) {
      this.captureIdentityIsAsync = true;
      actual.catch?.(() => {});
      return { alive: true, identityMatch: null, reasonCode: 'OWNER_IDENTITY_ASYNC_REQUIRED', backendPid: pid, expected, actual: null };
    }
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

  async probeAsync(record = this.record) {
    if (!record) return { alive: false, identityMatch: null, reasonCode: 'NO_OWNER_RECORD' };
    const pid = Number(record.backendPid || 0);
    if (!Number.isInteger(pid) || pid < 1) return { alive: false, identityMatch: null, reasonCode: 'OWNER_PID_INVALID', backendPid: pid };
    let alive = false;
    try { alive = await this.isProcessAliveAsync(pid) === true; }
    catch (cause) {
      return { alive: true, identityMatch: null, reasonCode: cause?.code === 'EPERM' ? 'OWNER_LIVENESS_EPERM' : 'OWNER_LIVENESS_UNKNOWN', backendPid: pid };
    }
    if (!alive) return { alive: false, identityMatch: true, reasonCode: 'OWNER_NOT_LIVE', backendPid: pid };
    const expected = record.processIdentity || null;
    const actual = await this.captureIdentityAsync(pid);
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
    const candidate = { schemaVersion: SCHEMA_VERSION, ...clone(record), updatedAtUtc: this.clock() };
    validateOwnerRecord(candidate, {
      requireProcessIdentity: this.enabled(),
      expectedPlatform: this.enabled() ? (this.processIdentityPlatform || undefined) : undefined
    });
    if (this.enabled()) atomicWriteJson(this.file, candidate, this.fs);
    this.record = candidate;
    return this.snapshot();
  }

  async _writeAsync(record) {
    const candidate = { schemaVersion: SCHEMA_VERSION, ...clone(record), updatedAtUtc: this.clock() };
    validateOwnerRecord(candidate, {
      requireProcessIdentity: this.enabled(),
      expectedPlatform: this.enabled() ? (this.processIdentityPlatform || undefined) : undefined
    });
    if (this.enabled()) await atomicWriteJsonAsync(this.file, candidate, { fsApi: this.fs });
    this.record = candidate;
    return this.snapshot();
  }

  _withOwnerClaimLock(operation) {
    if (!this.enabled()) return operation();
    this.fs.mkdirSync(path.dirname(this.file), { recursive: true });
    let release = null;
    let operationError = null;
    try {
      release = this.lockfile.lockSync(this.file, { realpath: false, stale: this.claimLockStaleMs, retries: 0, fs: this.fs });
    } catch (cause) {
      throw ownerClaimError(cause, 'acquire');
    }
    try {
      return operation();
    } catch (error) {
      operationError = error;
      throw error;
    } finally {
      try { release?.(); }
      catch (cause) {
        const releaseError = ownerClaimError(cause, 'release');
        if (operationError) operationError.ownerClaimReleaseFailure = {
          reasonCode: releaseError.reasonCode,
          code: releaseError.code,
          message: releaseError.message
        };
        else throw releaseError;
      }
    }
  }

  _registrationRecord(context = {}) {
    const backendPid = context.backendPid;
    const capturedIdentity = Object.prototype.hasOwnProperty.call(context, 'processIdentity')
      ? context.processIdentity
      : this.captureIdentity(backendPid);
    if (promiseLike(capturedIdentity)) {
      const error = new Error('Async backend owner identity must be resolved before synchronous owner registration');
      error.reasonCode = 'WP4_DESKTOP_BACKEND_OWNER_IDENTITY_ASYNC_REQUIRED';
      throw error;
    }
    try {
      const logDir = path.join(process.env.APPDATA || process.env.HOME || '.', 'Yance', 'debug');
      const logPath = path.join(logDir, 'register_debug.jsonl');
      const entry = JSON.stringify({
        timestamp: new Date().toISOString(), backendPid, capturedIdentity,
        captureIdentityType: typeof this.captureIdentity, processIdentityPlatform: this.processIdentityPlatform
      }) + '\n';
      fs.promises.mkdir(logDir, { recursive: true })
        .then(() => fs.promises.appendFile(logPath, entry, 'utf8'))
        .catch(e => console.error('[register debug log failed]', e.message));
    } catch (e) {
      console.error('[register debug log failed]', e.message);
    }
    return {
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
  }

  _assertClaimAvailable() {
    if (this.loadFailure) throw registryLoadFailureError(this.loadFailure);
    if (this.record?.ownershipActive === true) {
      const error = new Error('A backend owner claim already exists; refusing to overwrite it');
      error.reasonCode = 'WP4_DESKTOP_BACKEND_OWNER_CLAIM_CONFLICT';
      error.retryable = true;
      error.existingOwner = this.snapshot();
      throw error;
    }
  }

  async acquireStartupAdmission() {
    if (!this.enabled()) {
      let active = true;
      let registered = false;
      return Object.freeze({
        register: async context => {
          if (!active) {
            const error = new Error('Backend startup admission is no longer active');
            error.reasonCode = 'WP4_DESKTOP_BACKEND_STARTUP_ADMISSION_CLOSED';
            throw error;
          }
          if (registered) {
            const error = new Error('Backend startup admission may register exactly one owner');
            error.reasonCode = 'WP4_DESKTOP_BACKEND_STARTUP_ADMISSION_ALREADY_REGISTERED';
            throw error;
          }
          const result = await this._writeAsync(this._registrationRecord(context));
          registered = true;
          return result;
        },
        release: async () => { active = false; }
      });
    }

    if (typeof this.lockfile.lock !== 'function') {
      const error = new Error('Backend owner claim lock does not provide the required asynchronous admission API');
      error.reasonCode = 'WP4_DESKTOP_BACKEND_OWNER_ASYNC_CLAIM_UNAVAILABLE';
      throw error;
    }

    await mkdirAsync(path.dirname(this.file), this.fs);
    let releaseImpl = null;
    try {
      releaseImpl = await this.lockfile.lock(this.file, { realpath: false, stale: this.claimLockStaleMs, retries: 0, fs: this.fs });
    } catch (cause) {
      throw ownerClaimError(cause, 'acquire');
    }

    let active = true;
    let registered = false;
    let released = false;
    const release = async () => {
      if (released) return;
      released = true;
      active = false;
      try { await releaseImpl?.(); }
      catch (cause) { throw ownerClaimError(cause, 'release'); }
    };

    try {
      await this.refreshAsync();
      this._assertClaimAvailable();
    } catch (error) {
      try { await release(); }
      catch (releaseError) {
        error.ownerClaimReleaseFailure = {
          reasonCode: releaseError.reasonCode,
          code: releaseError.code,
          message: releaseError.message
        };
      }
      throw error;
    }

    return Object.freeze({
      register: async context => {
        if (!active) {
          const error = new Error('Backend startup admission is no longer active');
          error.reasonCode = 'WP4_DESKTOP_BACKEND_STARTUP_ADMISSION_CLOSED';
          throw error;
        }
        if (registered) {
          const error = new Error('Backend startup admission may register exactly one owner');
          error.reasonCode = 'WP4_DESKTOP_BACKEND_STARTUP_ADMISSION_ALREADY_REGISTERED';
          throw error;
        }
        const result = await this._writeAsync(this._registrationRecord(context));
        registered = true;
        return result;
      },
      release
    });
  }

  register(context = {}) {
    const record = this._registrationRecord(context);
    if (!this.enabled()) return this._write(record);
    return this._withOwnerClaimLock(() => {
      this.refresh();
      this._assertClaimAvailable();
      return this._write(record);
    });
  }

  async registerAsync(context = {}) {
    const admission = await this.acquireStartupAdmission();
    let operationError = null;
    try {
      const processIdentity = Object.prototype.hasOwnProperty.call(context, 'processIdentity')
        ? context.processIdentity
        : await this.captureIdentityAsync(context.backendPid);
      return await admission.register({ ...context, processIdentity });
    } catch (error) {
      operationError = error;
      throw error;
    } finally {
      try { await admission.release(); }
      catch (releaseError) {
        if (operationError) operationError.ownerClaimReleaseFailure = {
          reasonCode: releaseError.reasonCode || 'WP4_DESKTOP_BACKEND_OWNER_CLAIM_LOCK_FAILED',
          code: releaseError.code || '',
          message: releaseError.message
        };
        else throw releaseError;
      }
    }
  }

  update(context = {}) {
    if (!this.record) return this.register(context);
    return this._write({ ...this.record, ...clone(context), schemaVersion: SCHEMA_VERSION });
  }

  async updateAsync(context = {}) {
    if (!this.record) return this.registerAsync(context);
    return this._writeAsync({ ...this.record, ...clone(context), schemaVersion: SCHEMA_VERSION });
  }

  markRejected(context = {}) {
    return this.update({
      state: 'REJECTED', ownershipActive: true, trusted: false,
      reasonCode: String(context.reasonCode || this.record?.reasonCode || 'WP4_DESKTOP_CREDENTIAL_REJECTED_OWNER'),
      ownerSession: clone(context.ownerSession || this.record?.ownerSession || null), rejectedAtUtc: this.clock()
    });
  }

  async markRejectedAsync(context = {}) {
    return this.updateAsync({
      state: 'REJECTED', ownershipActive: true, trusted: false,
      reasonCode: String(context.reasonCode || this.record?.reasonCode || 'WP4_DESKTOP_CREDENTIAL_REJECTED_OWNER'),
      ownerSession: clone(context.ownerSession || this.record?.ownerSession || null), rejectedAtUtc: this.clock()
    });
  }

  markExited(context = {}) {
    return this.update({
      state: 'EXITED', ownershipActive: false, trusted: false,
      reasonCode: String(context.reasonCode || this.record?.reasonCode || ''),
      exitCode: context.exitCode ?? null, signalCode: context.signalCode || null, exitedAtUtc: this.clock()
    });
  }

  async markExitedAsync(context = {}) {
    return this.updateAsync({
      state: 'EXITED', ownershipActive: false, trusted: false,
      reasonCode: String(context.reasonCode || this.record?.reasonCode || ''),
      exitCode: context.exitCode ?? null, signalCode: context.signalCode || null, exitedAtUtc: this.clock()
    });
  }

  isPotentiallyLive() {
    if (!this.record || this.record.ownershipActive !== true || !LIVE_STATES.has(String(this.record.state || ''))) return false;
    const probe = this.probe();
    return probe.alive === true && probe.identityMatch !== false;
  }

  async isPotentiallyLiveAsync() {
    if (!this.record || this.record.ownershipActive !== true || !LIVE_STATES.has(String(this.record.state || ''))) return false;
    const probe = await this.probeAsync();
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
  processAliveAsync,
  validateProcessIdentity,
  validateOwnerRecord
};