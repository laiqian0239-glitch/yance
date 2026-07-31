'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const REQUEST_DOCUMENT_TYPE = 'WP7_WINDOWS_NETWORK_ISOLATION_WATCHDOG_REQUEST';
const STATE_DOCUMENT_TYPE = 'WP7_WINDOWS_NETWORK_ISOLATION_WATCHDOG_STATE';
const LAUNCH_DOCUMENT_TYPE = 'WP7_WINDOWS_NETWORK_ISOLATION_WATCHDOG_LAUNCH';
const RELEASE_DOCUMENT_TYPE = 'WP7_WINDOWS_NETWORK_ISOLATION_RELEASE_SIGNAL';
const SHA256_RE = /^[0-9a-f]{64}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function fail(reasonCode, message, details = {}) {
  const error = new Error(message);
  error.reasonCode = reasonCode;
  error.details = details;
  throw error;
}

function canonical(value) {
  function sort(input) {
    if (Array.isArray(input)) return input.map(sort);
    if (!input || typeof input !== 'object') return input;
    return Object.fromEntries(Object.keys(input).sort().map((key) => [key, sort(input[key])]));
  }
  return `${JSON.stringify(sort(value), null, 2)}\n`;
}

function sha256Bytes(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function sha256File(filePath) {
  return sha256Bytes(fs.readFileSync(filePath));
}

function atomicWrite(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, canonical(value), { mode: 0o600 });
  fs.renameSync(temporary, filePath);
  return filePath;
}

function overwriteExistingFile(filePath, value) {
  const descriptor = fs.openSync(filePath, 'r+');
  try {
    fs.ftruncateSync(descriptor, 0);
    fs.writeFileSync(descriptor, canonical(value), { encoding: 'utf8' });
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  return filePath;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function processExists(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    if (error?.code === 'EPERM') return true;
    return false;
  }
}

async function waitForProcessExit(pids, timeoutMs, exists = processExists) {
  const unique = [...new Set(pids.filter((pid) => Number.isInteger(pid) && pid > 0))];
  const deadline = Date.now() + timeoutMs;
  let remaining = unique.filter((pid) => exists(pid));
  while (remaining.length && Date.now() < deadline) {
    await delay(50);
    remaining = unique.filter((pid) => exists(pid));
  }
  return remaining;
}

function assertInside(rootPath, candidatePath, label) {
  const root = path.resolve(rootPath);
  const candidate = path.resolve(candidatePath);
  const relative = path.relative(root, candidate);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    fail('WP7_WINDOWS_NETWORK_ISOLATION_PATH_INVALID', `${label} escaped its trusted root`, { root, candidate });
  }
  return candidate;
}

function readState(statePath) {
  if (!fs.existsSync(statePath)) return null;
  let state;
  try {
    state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  } catch (error) {
    fail('WP7_WINDOWS_NETWORK_ISOLATION_WATCHDOG_STATE_INVALID', 'watchdog state is invalid JSON', {
      statePath,
      message: error.message
    });
  }
  return state;
}

function validateState(state, expected, acceptedStates = null) {
  if (!state || state.schemaVersion !== 2 || state.documentType !== STATE_DOCUMENT_TYPE) {
    fail('WP7_WINDOWS_NETWORK_ISOLATION_WATCHDOG_STATE_INVALID', 'watchdog state schema is invalid', { state });
  }
  const mismatches = [];
  const fields = [
    ['executionNonce', expected.executionNonce],
    ['requestSha256', expected.requestSha256],
    ['watchdogScriptSha256', expected.watchdogScriptSha256],
    ['launcherScriptSha256', expected.launcherScriptSha256],
    ['powerShellExecutableSha256', expected.powerShellExecutableSha256],
    ['ownerPid', expected.ownerPid],
    ['elevatedWatchdogPid', expected.elevatedWatchdogPid]
  ];
  for (const [field, value] of fields) {
    if (state[field] !== value) mismatches.push({ field, expected: value, actual: state[field] });
  }
  if (mismatches.length) {
    fail('WP7_WINDOWS_NETWORK_ISOLATION_WATCHDOG_STATE_INVALID', 'watchdog state is not bound to its launch request', { mismatches });
  }
  if (acceptedStates && !acceptedStates.includes(state.state)) {
    fail('WP7_WINDOWS_NETWORK_ISOLATION_WATCHDOG_STATE_INVALID', 'watchdog reached an unexpected state', {
      acceptedStates,
      actual: state.state
    });
  }
  if (!Array.isArray(state.adaptersBefore) || !Array.isArray(state.routesBefore)) {
    fail('WP7_WINDOWS_NETWORK_ISOLATION_WATCHDOG_STATE_INVALID', 'watchdog state is missing durable original-state journal data');
  }
  if (!Number.isInteger(state.guardianPid) || state.guardianPid <= 0
      || state.guardianPid === state.elevatedWatchdogPid
      || state.guardianPid === state.ownerPid
      || state.guardianScriptSha256 !== state.watchdogScriptSha256) {
    fail('WP7_WINDOWS_NETWORK_ISOLATION_WATCHDOG_STATE_INVALID', 'watchdog state is not protected by a distinct hash-bound recovery guardian', {
      guardianPid: state.guardianPid,
      guardianScriptSha256: state.guardianScriptSha256,
      elevatedWatchdogPid: state.elevatedWatchdogPid,
      ownerPid: state.ownerPid
    });
  }
  return state;
}

async function waitState(statePath, expected, acceptedStates, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastState = null;
  while (Date.now() < deadline) {
    const state = readState(statePath);
    if (state) {
      lastState = state;
      if (state.executionNonce === expected.executionNonce && acceptedStates.includes(state.state)) {
        return validateState(state, expected, acceptedStates);
      }
    }
    await delay(50);
  }
  fail('WP7_WINDOWS_NETWORK_ISOLATION_WATCHDOG_TIMEOUT', 'watchdog did not reach a required state', {
    statePath,
    acceptedStates,
    timeoutMs,
    lastState
  });
}

function defaultProtectedRoot() {
  if (process.platform !== 'win32') return path.resolve('.wp7-windows-network-isolation-protected');
  const programData = String(process.env.ProgramData || process.env.PROGRAMDATA || 'C:\\ProgramData');
  return path.win32.join(programData, 'Yance', 'WP7NetworkIsolation');
}

function normalizeLaunchReceipt(receipt, expected) {
  if (!receipt || receipt.schemaVersion !== 2 || receipt.documentType !== LAUNCH_DOCUMENT_TYPE) {
    fail('WP7_WINDOWS_NETWORK_ISOLATION_WATCHDOG_LAUNCH_FAILED', 'watchdog launcher returned an invalid receipt', { receipt });
  }
  if (!Number.isInteger(receipt.elevatedProcessId) || receipt.elevatedProcessId <= 0) {
    fail('WP7_WINDOWS_NETWORK_ISOLATION_WATCHDOG_LAUNCH_FAILED', 'watchdog launcher did not return an elevated process id', { receipt });
  }
  const mismatches = [];
  for (const [field, value] of [
    ['executionNonce', expected.executionNonce],
    ['requestSha256', expected.requestSha256]
  ]) {
    if (receipt[field] !== value) mismatches.push({ field, expected: value, actual: receipt[field] });
  }
  if (!SHA256_RE.test(String(receipt.watchdogScriptSha256 || ''))) mismatches.push({ field: 'watchdogScriptSha256', actual: receipt.watchdogScriptSha256 });
  if (!SHA256_RE.test(String(receipt.launcherScriptSha256 || ''))) mismatches.push({ field: 'launcherScriptSha256', actual: receipt.launcherScriptSha256 });
  if (!SHA256_RE.test(String(receipt.powerShellExecutableSha256 || ''))) mismatches.push({ field: 'powerShellExecutableSha256', actual: receipt.powerShellExecutableSha256 });
  if (typeof receipt.powerShellExecutablePath !== 'string' || !path.win32.isAbsolute(receipt.powerShellExecutablePath)) mismatches.push({ field: 'powerShellExecutablePath', actual: receipt.powerShellExecutablePath });
  if (mismatches.length) {
    fail('WP7_WINDOWS_NETWORK_ISOLATION_WATCHDOG_LAUNCH_FAILED', 'watchdog launcher receipt is not bound to the request and scripts', { mismatches });
  }
  return receipt;
}

class WindowsIsolationWatchdogController {
  constructor(options = {}) {
    this.root = path.resolve(options.root || '.');
    this.protectedRoot = options.protectedRoot || defaultProtectedRoot();
    this.launch = options.launch;
    this.now = options.now || (() => new Date());
    this.acquireTimeoutMs = Number(options.acquireTimeoutMs || 45_000);
    this.releaseTimeoutMs = Number(options.releaseTimeoutMs || 90_000);
    this.processExitTimeoutMs = Number(options.processExitTimeoutMs || 15_000);
    this.processExists = options.processExists || processExists;
    if (typeof this.launch !== 'function') {
      fail('WP7_WINDOWS_NETWORK_ISOLATION_PROVIDER_INVALID', 'watchdog controller requires an elevated launcher');
    }
  }

  async acquire(options = {}) {
    const watchdogMs = Math.max(30_000, Math.min(Number(options.watchdogMs || 120_000), 600_000));
    const executionNonce = String(options.executionNonce || crypto.randomUUID());
    if (!UUID_RE.test(executionNonce)) {
      fail('WP7_WINDOWS_NETWORK_ISOLATION_REQUEST_INVALID', 'watchdog execution nonce must be a UUID', { executionNonce });
    }
    const requestDir = path.join(this.root, executionNonce);
    fs.mkdirSync(requestDir, { recursive: true });
    const requestPath = assertInside(this.root, path.join(requestDir, 'request.json'), 'watchdog request');
    const createdAt = this.now();
    const ownerPid = Number(options.ownerPid || process.pid);
    if (!Number.isInteger(ownerPid) || ownerPid <= 0) {
      fail('WP7_WINDOWS_NETWORK_ISOLATION_REQUEST_INVALID', 'watchdog owner PID must be a positive integer', { ownerPid });
    }
    const request = {
      schemaVersion: 2,
      documentType: REQUEST_DOCUMENT_TYPE,
      action: 'ISOLATE_ALL_ENABLED_VISIBLE_WITH_WATCHDOG',
      executionNonce,
      ownerPid,
      requestCreatedAtUtc: createdAt.toISOString(),
      restoreDeadlineUtc: new Date(createdAt.getTime() + watchdogMs).toISOString()
    };
    atomicWrite(requestPath, request);
    const requestSha256 = sha256File(requestPath);
    const launchReceipt = normalizeLaunchReceipt(await this.launch({
      requestPath,
      requestSha256,
      request,
      protectedRoot: this.protectedRoot
    }), { executionNonce, requestSha256 });

    const statePath = path.join(this.protectedRoot, executionNonce, 'state.json');
    const isolatedStatePath = path.join(this.protectedRoot, executionNonce, 'isolated-state.json');
    const releasePath = path.join(this.protectedRoot, executionNonce, 'release.signal');
    const expected = {
      executionNonce,
      requestSha256,
      watchdogScriptSha256: launchReceipt.watchdogScriptSha256,
      launcherScriptSha256: launchReceipt.launcherScriptSha256,
      powerShellExecutableSha256: launchReceipt.powerShellExecutableSha256,
      ownerPid,
      elevatedWatchdogPid: launchReceipt.elevatedProcessId
    };
    const state = await waitState(
      statePath,
      expected,
      ['ISOLATED', 'RESTORED', 'RESTORE_FAILED', 'ISOLATION_FAILED'],
      this.acquireTimeoutMs
    );
    if (state.state === 'RESTORED') {
      fail('WP7_WINDOWS_NETWORK_ISOLATION_WINDOW_ELAPSED', 'watchdog restored the network before isolation custody was acquired', { state });
    }
    if (state.state !== 'ISOLATED' || state.isolationPostcondition?.passed !== true) {
      fail('WP7_WINDOWS_NETWORK_ISOLATION_ACQUIRE_FAILED', 'watchdog did not establish verified network isolation', { state });
    }
    const missingCustodyProcesses = [state.elevatedWatchdogPid, state.guardianPid]
      .filter((pid) => !this.processExists(pid));
    if (missingCustodyProcesses.length) {
      fail('WP7_WINDOWS_NETWORK_ISOLATION_PROCESS_CUSTODY_MISSING', 'network isolation was established without live elevated watchdog and guardian custody', {
        missingCustodyProcesses,
        elevatedWatchdogPid: state.elevatedWatchdogPid,
        guardianPid: state.guardianPid
      });
    }
    if (!fs.existsSync(isolatedStatePath)) {
      fail('WP7_WINDOWS_NETWORK_ISOLATION_WATCHDOG_STATE_INVALID', 'watchdog did not persist an immutable isolated-state journal', { isolatedStatePath });
    }
    const isolatedState = validateState(JSON.parse(fs.readFileSync(isolatedStatePath, 'utf8')), expected, ['ISOLATED']);
    const isolatedStateSha256 = sha256File(isolatedStatePath);
    return Object.freeze({
      executionNonce,
      ownerPid,
      requestPath,
      requestSha256,
      statePath,
      isolatedStatePath,
      releasePath,
      protectedSessionRoot: path.dirname(statePath),
      launchReceipt,
      isolatedState,
      isolatedStateSha256,
      expected
    });
  }

  async release(handle) {
    if (!handle || !UUID_RE.test(String(handle.executionNonce || '')) || !SHA256_RE.test(String(handle.requestSha256 || ''))) {
      fail('WP7_WINDOWS_NETWORK_ISOLATION_HANDLE_INVALID', 'network isolation handle is invalid');
    }
    const expectedSessionRoot = path.join(this.protectedRoot, handle.executionNonce);
    const expectedStatePath = path.join(expectedSessionRoot, 'state.json');
    const expectedReleasePath = path.join(expectedSessionRoot, 'release.signal');
    if (path.resolve(handle.statePath || '') !== path.resolve(expectedStatePath)
        || path.resolve(handle.releasePath || '') !== path.resolve(expectedReleasePath)
        || path.resolve(handle.protectedSessionRoot || '') !== path.resolve(expectedSessionRoot)) {
      fail('WP7_WINDOWS_NETWORK_ISOLATION_HANDLE_INVALID', 'network isolation handle paths are outside the protected session root', {
        expectedSessionRoot,
        statePath: handle.statePath,
        releasePath: handle.releasePath,
        protectedSessionRoot: handle.protectedSessionRoot
      });
    }
    const releaseDocument = {
      schemaVersion: 2,
      documentType: RELEASE_DOCUMENT_TYPE,
      executionNonce: handle.executionNonce,
      requestSha256: handle.requestSha256,
      ownerPid: Number(handle.expected?.ownerPid || handle.ownerPid || process.pid),
      generatedAtUtc: this.now().toISOString()
    };
    const deadline = Date.now() + this.acquireTimeoutMs;
    while (!fs.existsSync(handle.releasePath) && Date.now() < deadline) await delay(50);
    if (!fs.existsSync(handle.releasePath)) {
      fail('WP7_WINDOWS_NETWORK_ISOLATION_RELEASE_SIGNAL_MISSING', 'elevated watchdog did not create the protected release slot', {
        releasePath: handle.releasePath
      });
    }
    overwriteExistingFile(handle.releasePath, releaseDocument);
    const state = await waitState(
      handle.statePath,
      handle.expected,
      ['RESTORED', 'RESTORE_FAILED'],
      this.releaseTimeoutMs
    );
    if (state.state !== 'RESTORED' || state.restorePostcondition?.passed !== true) {
      fail('WP7_WINDOWS_NETWORK_ISOLATION_RESTORE_FAILED', 'watchdog could not restore the original network state', { state });
    }
    const remainingIsolationProcesses = await waitForProcessExit(
      [state.elevatedWatchdogPid, state.guardianPid],
      this.processExitTimeoutMs,
      this.processExists
    );
    if (remainingIsolationProcesses.length) {
      fail('WP7_WINDOWS_NETWORK_ISOLATION_PROCESS_RESIDUE', 'elevated isolation custody processes did not exit after verified restore', {
        remainingIsolationProcesses,
        state
      });
    }
    return Object.freeze({ ...state, stateSha256: sha256File(handle.statePath), remainingIsolationProcesses: [] });
  }
}

function createWindowsWatchdogLauncher(options = {}) {
  const watchdogPath = path.resolve(options.watchdogPath || path.join(__dirname, 'windows-network-isolation-watchdog.ps1'));
  const launcherPath = path.resolve(options.launcherPath || path.join(__dirname, 'windows-network-isolation-watchdog-uac-launcher.ps1'));
  const windowsRoot = String(process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows');
  const powerShellPath = path.win32.resolve(options.powerShellPath || path.win32.join(windowsRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'));
  const watchdogScriptSha256 = sha256File(watchdogPath);
  const launcherScriptSha256 = sha256File(launcherPath);
  return ({ requestPath, requestSha256, request, protectedRoot }) => new Promise((resolve, reject) => {
    if (process.platform === 'win32' && (!fs.existsSync(powerShellPath) || !fs.statSync(powerShellPath).isFile())) {
      reject(Object.assign(new Error('trusted Windows PowerShell executable is missing'), {
        reasonCode: 'WP7_WINDOWS_NETWORK_ISOLATION_WATCHDOG_LAUNCH_FAILED',
        details: { powerShellPath }
      }));
      return;
    }
    const powerShellExecutableSha256 = process.platform === 'win32' ? sha256File(powerShellPath) : '0'.repeat(64);
    const child = spawn(powerShellPath, [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', launcherPath,
      '-WatchdogPath', watchdogPath,
      '-RequestPath', requestPath,
      '-ExpectedRequestSha256', requestSha256,
      '-ExpectedWatchdogSha256', watchdogScriptSha256,
      '-ExpectedLauncherSha256', launcherScriptSha256,
      '-ExpectedPowerShellSha256', powerShellExecutableSha256,
      '-ProtectedRoot', protectedRoot,
      '-ExecutionNonce', request.executionNonce
    ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', (error) => {
      reject(Object.assign(error, {
        reasonCode: 'WP7_WINDOWS_NETWORK_ISOLATION_WATCHDOG_LAUNCH_FAILED',
        details: { launcherPath, watchdogPath }
      }));
    });
    child.once('close', (exitCode) => {
      if (exitCode !== 0) {
        reject(Object.assign(new Error('watchdog UAC launcher failed or elevation was cancelled'), {
          reasonCode: 'WP7_WINDOWS_NETWORK_ISOLATION_WATCHDOG_LAUNCH_FAILED',
          details: { exitCode, stdout, stderr, launcherPath, watchdogPath }
        }));
        return;
      }
      try {
        const receipt = JSON.parse(stdout.trim());
        resolve({ ...receipt, watchdogScriptSha256, launcherScriptSha256, powerShellExecutablePath: powerShellPath, powerShellExecutableSha256 });
      } catch (error) {
        reject(Object.assign(error, {
          reasonCode: 'WP7_WINDOWS_NETWORK_ISOLATION_WATCHDOG_LAUNCH_FAILED',
          details: { exitCode, stdout, stderr }
        }));
      }
    });
  });
}

async function withWindowsNetworkIsolation(provider, operation, options = {}) {
  const handle = await provider.acquire(options);
  let operationError = null;
  try {
    return await operation(handle);
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    try {
      await provider.release(handle);
    } catch (restoreError) {
      if (operationError) {
        restoreError.details = {
          ...(restoreError.details || {}),
          operationError: {
            message: operationError.message,
            reasonCode: operationError.reasonCode || null,
            stack: operationError.stack || null
          }
        };
        restoreError.cause = operationError;
      }
      throw restoreError;
    }
  }
}

module.exports = {
  REQUEST_DOCUMENT_TYPE,
  STATE_DOCUMENT_TYPE,
  LAUNCH_DOCUMENT_TYPE,
  RELEASE_DOCUMENT_TYPE,
  WindowsIsolationWatchdogController,
  createWindowsWatchdogLauncher,
  readState,
  validateState,
  waitState,
  withWindowsNetworkIsolation,
  sha256File,
  canonical,
  overwriteExistingFile,
  processExists,
  waitForProcessExit
};
