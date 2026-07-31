'use strict';

// M5 — SQLite Ownership governance (pure, zero runtime dependency).
//
// Risk closed: `R32SqliteStore` opens the app-data SQLite (`yance-r32.db`)
// with `new DatabaseSync(dbPath)` and NO cross-instance ownership guard. A
// second backend instance (Electron relaunch, or two app copies) opening the
// same file can cause lock contention / `database is locked` / silent
// corruption. We add a sidecar ownership lockfile with a heartbeat + staleness
// check so a second live owner fails FAST with a structured, actionable error
// instead of corrupting or hanging.
//
// The module is intentionally pure: the low-level filesystem surface and the
// clock are injectable, so the decision logic is unit-testable without a real
// SQLite file or a real process.

const realFs = require('fs');
const crypto = require('crypto');
const resilientLeaseClock = require('./resilientLeaseClock');
const { spawnSync } = require('child_process');

const PROCESS_STARTED_AT_MS = Date.now() - Math.round(process.uptime() * 1000);

// Ownership is process-scoped, but every SQLite handle must keep a real
// reference to the shared sidecar lease. Without a reference count, closing
// the first same-process store can unlink the lock while another store is
// still writing, allowing a second process to enter.
const FS_PROVIDER_IDS = new WeakMap();
const ACTIVE_OWNERS = new Map();
let nextFsProviderId = 1;

function fsProviderId(fs) {
  if ((typeof fs !== 'object' && typeof fs !== 'function') || fs === null) return `primitive:${String(fs)}`;
  if (!FS_PROVIDER_IDS.has(fs)) FS_PROVIDER_IDS.set(fs, nextFsProviderId++);
  return FS_PROVIDER_IDS.get(fs);
}

function activeOwnerKey(fs, lockPath, pid, processIdentity) {
  return `${fsProviderId(fs)}\u001f${lockPath}\u001f${pid}\u001f${processIdentity}`;
}

function digest(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

const WINDOWS_PROCESS_START_TOLERANCE_MS = 2000;
const WINDOWS_V3_IDENTITY = /^v3:win32:(\d+):([a-f0-9]{64})$/;
const WINDOWS_V2_IDENTITY = /^v2:win32:(.+Z):([a-f0-9]{64}):([a-f0-9]{64})$/;

function normalizeWindowsExecutable(value) {
  return String(value || '').trim().replace(/\//g, '\\').toLowerCase();
}

function buildWindowsProcessIdentity(startedAtMs, executablePath) {
  const started = Math.round(Number(startedAtMs));
  const executable = normalizeWindowsExecutable(executablePath);
  if (!Number.isFinite(started) || started <= 0 || !executable) return '';
  return `v3:win32:${started}:${digest(executable)}`;
}

function parseWindowsProcessIdentity(value) {
  const text = String(value || '');
  const current = WINDOWS_V3_IDENTITY.exec(text);
  if (current) return { startedAtMs: Number(current[1]), executableDigest: current[2] };
  const legacy = WINDOWS_V2_IDENTITY.exec(text);
  if (!legacy) return null;
  const startedAtMs = Date.parse(legacy[1]);
  if (!Number.isFinite(startedAtMs)) return null;
  return { startedAtMs, executableDigest: legacy[2] };
}

function processIdentityComparison(expected, actual) {
  const left = String(expected || '');
  const right = String(actual || '');
  if (!left || !right) return null;
  if (left === right) return true;
  const leftWindows = parseWindowsProcessIdentity(left);
  const rightWindows = parseWindowsProcessIdentity(right);
  if (leftWindows && rightWindows) {
    return leftWindows.executableDigest === rightWindows.executableDigest &&
      Math.abs(leftWindows.startedAtMs - rightWindows.startedAtMs) <= WINDOWS_PROCESS_START_TOLERANCE_MS;
  }
  if (left.startsWith('v2:') && right.startsWith('v2:')) return false;
  return null;
}

function processIdentityMatches(expected, actual) {
  return processIdentityComparison(expected, actual) === true;
}

function linuxPidIdentity(pid, fs = realFs) {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const close = stat.lastIndexOf(')');
    if (close < 0) return '';
    const fields = stat.slice(close + 2).trim().split(/\s+/);
    const startTicks = fields[19]; // field 22 overall after pid + comm
    if (!startTicks) return '';
    let command = '';
    try { command = fs.readFileSync(`/proc/${pid}/cmdline`).toString('utf8').replace(/\0/g, ' '); } catch (_) {}
    return `v2:linux:${startTicks}:${digest(command)}`;
  } catch (_) {
    return '';
  }
}

function windowsPidIdentity(pid) {
  try {
    const script = [
      `$p=Get-CimInstance Win32_Process -Filter \"ProcessId=${Number(pid)}\"`,
      'if($null -eq $p){exit 3}',
      '$o=[ordered]@{CreationDate=$p.CreationDate.ToUniversalTime().ToString("o");ExecutablePath=[string]$p.ExecutablePath}',
      '$o|ConvertTo-Json -Compress'
    ].join(';');
    const result = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8', windowsHide: true, timeout: 5000
    });
    if (result.status !== 0 || !String(result.stdout || '').trim()) return '';
    const value = JSON.parse(String(result.stdout).trim());
    const startedAtMs = Date.parse(String(value.CreationDate || ''));
    return buildWindowsProcessIdentity(startedAtMs, value.ExecutablePath);
  } catch (_) {
    return '';
  }
}

function unixPsPidIdentity(pid) {
  try {
    const result = spawnSync('ps', ['-p', String(pid), '-o', 'lstart=', '-o', 'command='], { encoding: 'utf8', timeout: 3000 });
    if (result.status !== 0 || !String(result.stdout || '').trim()) return '';
    const body = String(result.stdout).trim();
    return `v2:${process.platform}:${digest(body)}`;
  } catch (_) {
    return '';
  }
}

function defaultCapturePidIdentity(pid, fs = realFs, runtime = {}) {
  const value = Number(pid);
  if (!Number.isInteger(value) || value <= 0) return '';
  const platform = String(runtime.platform || process.platform);
  const currentPid = Number.isInteger(runtime.currentPid) ? runtime.currentPid : process.pid;
  const processStartedAtMs = Number.isFinite(Number(runtime.processStartedAtMs))
    ? Number(runtime.processStartedAtMs)
    : PROCESS_STARTED_AT_MS;
  const execPath = String(runtime.execPath || process.execPath || '');
  if (platform === 'win32') {
    if (value === currentPid) return buildWindowsProcessIdentity(processStartedAtMs, execPath);
    const probe = typeof runtime.windowsProbe === 'function' ? runtime.windowsProbe : windowsPidIdentity;
    return String(probe(value) || '');
  }
  if (platform === 'linux') return linuxPidIdentity(value, fs);
  if (platform === 'darwin') return unixPsPidIdentity(value);
  if (value === currentPid) return `v2:${platform}:${processStartedAtMs}:${digest(process.argv.join('\u001f'))}`;
  return '';
}

const PROCESS_IDENTITY = defaultCapturePidIdentity(process.pid) || `legacy:${process.pid}:${PROCESS_STARTED_AT_MS}`;

class SqliteOwnershipError extends Error {
  constructor(reasonCode, message, detail = {}) {
    super(message);
    this.reasonCode = reasonCode;
    this.code = reasonCode;
    this.isSqliteOwnershipError = true;
    Object.assign(this, detail);
  }
}

function defaultInstanceId() {
  // crypto.randomUUID is available in Node >= 14.17; fall back to a random hex.
  try {
    // eslint-disable-next-line node/no-unsupported-features/node-builtins
    return require('crypto').randomUUID();
  } catch (_) {
    return `owner-${Math.random().toString(16).slice(2)}-${Date.now().toString(16)}`;
  }
}

function readLock(fs, lockPath) {
  let raw;
  try {
    raw = fs.readFileSync(lockPath, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw new SqliteOwnershipError(
      'SQLITE_OWNERSHIP_LOCK_UNREADABLE',
      'SQLite ownership lock exists but cannot be read safely',
      { lockPath, causeCode: String(error?.code || ''), causeMessage: String(error?.message || error || '') }
    );
  }

  try {
    const parsed = JSON.parse(String(raw));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch (error) {
    throw new SqliteOwnershipError(
      'SQLITE_OWNERSHIP_LOCK_CORRUPT',
      'SQLite ownership lock is malformed and cannot be treated as unowned',
      { lockPath, causeMessage: String(error?.message || error || '') }
    );
  }
  throw new SqliteOwnershipError(
    'SQLITE_OWNERSHIP_LOCK_CORRUPT',
    'SQLite ownership lock has an invalid record shape and cannot be treated as unowned',
    { lockPath }
  );
}

function writeLock(fs, lockPath, record, options = {}) {
  const body = JSON.stringify(record);
  if (options.exclusive === true) {
    if (typeof fs.openSync !== 'function') {
      if (readLock(fs, lockPath)) {
        const error = new Error('EEXIST'); error.code = 'EEXIST'; throw error;
      }
      fs.writeFileSync(lockPath, body, 'utf8');
      return;
    }
    const fd = fs.openSync(lockPath, 'wx', 0o600);
    try {
      fs.writeFileSync(fd, body, 'utf8');
      try { fs.fsyncSync(fd); } catch (_) {}
    } finally { fs.closeSync(fd); }
    return;
  }
  const tmp = `${lockPath}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  let fd = null;
  try {
    if (typeof fs.openSync === 'function') {
      fd = fs.openSync(tmp, 'w', 0o600);
      fs.writeFileSync(fd, body, 'utf8');
      try { fs.fsyncSync(fd); } catch (_) {}
      fs.closeSync(fd);
      fd = null;
    } else {
      fs.writeFileSync(tmp, body, 'utf8');
    }
    fs.renameSync(tmp, lockPath);
  } finally {
    if (fd !== null) { try { fs.closeSync(fd); } catch (_) {} }
    try {
      if (typeof fs.rmSync === 'function') fs.rmSync(tmp, { force: true });
      else fs.unlinkSync(tmp);
    } catch (_) {}
  }
}

function sleepSync(ms) {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch (_) {}
}

function withClaimMutex(fs, lockPath, options, work) {
  // Deterministic in-memory test providers have no cross-process surface. Keep
  // the pure decision tests compatible while production fs uses the atomic
  // directory mutex below.
  if (typeof fs.mkdirSync !== 'function' || typeof fs.rmSync !== 'function') return work();
  const mutexPath = `${lockPath}.claim`;
  const ownerFile = `${mutexPath}/owner.json`;
  const pidAlive = options.pidAlive;
  const staleMs = Math.max(1000, Number(options.staleMs || 30000));
  const clock = options.clock;

  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      fs.mkdirSync(mutexPath);
      try {
        fs.writeFileSync(ownerFile, JSON.stringify({
          pid: process.pid,
          processIdentity: PROCESS_IDENTITY,
          createdAtMs: clock()
        }), 'utf8');
      } catch (_) {}
      try { return work(); }
      finally { try { fs.rmSync(mutexPath, { recursive: true, force: true }); } catch (_) {} }
    } catch (error) {
      if (!error || error.code !== 'EEXIST') throw error;
      let owner = null;
      try { owner = JSON.parse(fs.readFileSync(ownerFile, 'utf8')); } catch (_) {}
      const createdAtMs = Number(owner?.createdAtMs || 0);
      const active = owner && Number(owner.pid) > 0 &&
        clock() - createdAtMs < staleMs && pidAlive(Number(owner.pid));
      if (!active) {
        const quarantine = `${mutexPath}.stale.${process.pid}.${Date.now()}.${crypto.randomBytes(3).toString('hex')}`;
        try {
          fs.renameSync(mutexPath, quarantine);
          fs.rmSync(quarantine, { recursive: true, force: true });
          continue;
        } catch (_) {
          sleepSync(5);
          continue;
        }
      }
      sleepSync(5);
    }
  }
  throw new SqliteOwnershipError('SQLITE_OWNERSHIP_CLAIM_BUSY', 'SQLite ownership claim mutex remained busy', { lockPath });
}

function isLive(record, nowMs, staleMs) {
  const last = Number(record && record.lastHeartbeatMs);
  if (!Number.isFinite(last)) return false;
  return nowMs - last < staleMs;
}

// Cross-platform owner-PID liveness probe. Signal 0 checks existence without
// signaling. ESRCH => no such process (dead). EPERM/other => cannot confirm
// death, so we treat the owner as ALIVE (conservative: never steal a live owner).
function defaultPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    if (e && e.code === 'ESRCH') return false;
    return true;
  }
}

// Combines heartbeat-staleness with owner-PID liveness. A lock whose heartbeat
// is still fresh but whose recorded owner PID is DEAD (e.g. a SIGKILLed backend
// that never ran release()) must be treated as stale so a new owner can reclaim
// it instead of failing with a spurious SQLITE_OWNERSHIP_CONFLICT. This is the
// fix for the CI-flaky "orphan lock" failure mode.
function isOwnerActive(record, nowMs, staleMs, pidAlive, capturePidIdentity = defaultCapturePidIdentity) {
  const last = Number(record && record.lastHeartbeatMs);
  if (!Number.isFinite(last)) return false;
  const heartbeatFresh = isLive(record, nowMs, staleMs);
  const pid = Number(record && record.pid);
  if (Number.isInteger(pid) && pid > 0) {
    try {
      if (!pidAlive(pid)) return false;
      // A fresh heartbeat from a demonstrably live PID is authoritative. Do
      // not synchronously query WMI/CIM on every normal claim: that query can
      // block Windows process startup and multiply under migration races.
      if (heartbeatFresh) return true;
      // Only a stale heartbeat with a still-live PID needs the expensive
      // process-creation identity check to distinguish clock jumps from PID
      // reuse. If the formats are not comparable or capture is unavailable,
      // remain conservative and keep the owner active.
      const expected = String(record?.processIdentity || '');
      const actual = String(capturePidIdentity(pid) || '');
      if (processIdentityComparison(expected, actual) === false) return false;
      return true;
    } catch (_) {
      // Cannot determine liveness: conservative — keep as active.
      return true;
    }
  }
  // No pid recorded: preserve the legacy conservative ownership rule.
  return true;
}

function claimOwnership(options = {}) {
  const dbPath = String(options.dbPath || '');
  if (!dbPath) throw new SqliteOwnershipError('SQLITE_OWNERSHIP_PATH_REQUIRED', 'dbPath is required to claim SQLite ownership');
  const fs = options.fsProvider || realFs;
  const clock = options.clock || (() => resilientLeaseClock.now());
  const pidAlive = typeof options.pidAlive === 'function' ? options.pidAlive : defaultPidAlive;
  const capturePidIdentity = typeof options.capturePidIdentity === 'function'
    ? options.capturePidIdentity
    : pid => defaultCapturePidIdentity(pid, fs);
  const staleMs = Math.max(1000, Number(options.staleMs || 30000));
  const requestedInstanceId = String(options.instanceId || defaultInstanceId());
  const pid = Number.isInteger(options.pid) ? options.pid : process.pid;
  const lockPath = String(options.lockPath || `${dbPath}.ownership.json`);
  const nowMs = clock();
  const processIdentity = String(options.processIdentity || capturePidIdentity(pid) || PROCESS_IDENTITY);
  const ownerKey = activeOwnerKey(fs, lockPath, pid, processIdentity);
  let shared = null;
  let reentrant = false;

  withClaimMutex(fs, lockPath, { pidAlive, staleMs, clock }, () => {
    const existing = readLock(fs, lockPath);
    if (existing) {
      if (Number(existing.pid) === pid && String(existing.processIdentity || '') === processIdentity) {
        const tracked = ACTIVE_OWNERS.get(ownerKey);
        if (!tracked || tracked.released || tracked.instanceId !== String(existing.instanceId || '')) {
          // A lock owned by this PID but not tracked by this module may belong
          // to another loaded copy/version. Treat it as a live conflict rather
          // than returning an inert handle that can outlive the real owner.
          throw new SqliteOwnershipError(
            'SQLITE_OWNERSHIP_REENTRANT_UNTRACKED',
            'SQLite is owned by this process but the shared ownership lease is not tracked',
            { dbPath, lockPath, owner: { instanceId: existing.instanceId, pid: existing.pid, processIdentity: existing.processIdentity || '' } }
          );
        }
        tracked.refs += 1;
        shared = tracked;
        reentrant = true;
        return;
      }
      if (isOwnerActive(existing, nowMs, staleMs, pidAlive, capturePidIdentity)) {
        throw new SqliteOwnershipError('SQLITE_OWNERSHIP_CONFLICT', 'Another live process already owns this SQLite database', {
          dbPath,
          owner: {
            instanceId: existing.instanceId,
            pid: existing.pid,
            processIdentity: existing.processIdentity || '',
            startedAtUtc: existing.startedAtUtc,
            lastHeartbeatAtUtc: existing.lastHeartbeatUtc
          }
        });
      }
      try { fs.unlinkSync(lockPath); } catch (error) {
        if (!error || error.code !== 'ENOENT') throw error;
      }
    }

    const record = {
      instanceId: requestedInstanceId,
      pid,
      processIdentity,
      startedAtMs: nowMs,
      startedAtUtc: new Date(nowMs).toISOString(),
      lastHeartbeatMs: nowMs,
      lastHeartbeatUtc: new Date(nowMs).toISOString(),
      schemaVersion: Number(options.schemaVersion || 0) || 0
    };
    try {
      writeLock(fs, lockPath, record, { exclusive: true });
    } catch (error) {
      if (error?.code === 'EEXIST') {
        throw new SqliteOwnershipError('SQLITE_OWNERSHIP_CONFLICT', 'SQLite ownership changed during atomic claim', { dbPath, lockPath });
      }
      throw error;
    }
    shared = {
      ownerKey,
      dbPath,
      lockPath,
      instanceId: requestedInstanceId,
      pid,
      processIdentity,
      record,
      refs: 1,
      released: false,
      heartbeat() {
        if (this.released || this.refs <= 0) return false;
        const t = clock();
        this.record.lastHeartbeatMs = t;
        this.record.lastHeartbeatUtc = new Date(t).toISOString();
        try {
          return withClaimMutex(fs, lockPath, { pidAlive, staleMs, clock }, () => {
            const current = readLock(fs, lockPath);
            if (!current || current.instanceId !== this.instanceId || String(current.processIdentity || '') !== this.processIdentity) return false;
            writeLock(fs, lockPath, this.record);
            return true;
          });
        } catch (_) { return false; }
      },
      releaseReference() {
        if (this.refs > 0) this.refs -= 1;
        if (this.refs > 0 || this.released) return;
        this.released = true;
        ACTIVE_OWNERS.delete(this.ownerKey);
        try {
          withClaimMutex(fs, lockPath, { pidAlive, staleMs, clock }, () => {
            const current = readLock(fs, lockPath);
            if (current && current.instanceId === this.instanceId && String(current.processIdentity || '') === this.processIdentity) fs.unlinkSync(lockPath);
          });
        } catch (_) {}
      }
    };
    ACTIVE_OWNERS.set(ownerKey, shared);
  });

  let handleReleased = false;
  return {
    dbPath,
    lockPath,
    instanceId: shared.instanceId,
    pid,
    processIdentity,
    ...(reentrant ? { isReentrant: true } : {}),
    isReleased() { return handleReleased; },
    heartbeat() { return !handleReleased && shared.heartbeat(); },
    release() {
      if (handleReleased) return;
      handleReleased = true;
      shared.releaseReference();
    }
  };
}

module.exports = {
  SqliteOwnershipError,
  claimOwnership,
  isLive,
  isOwnerActive,
  defaultCapturePidIdentity,
  processIdentityMatches,
  buildWindowsProcessIdentity,
  defaultInstanceId
};
