'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createRendererStorageProbeSession } = require('./wp7RendererStorageProbeNavigation');
const {
  WP7_RENDERER_STORAGE_PROBE_PATH,
  WP7_RENDERER_STORAGE_PROBE_MARKER
} = require('../shared/wp7/rendererStorageProbeDocument');

function canonical(value) {
  function sort(input) {
    if (Array.isArray(input)) return input.map(sort);
    if (!input || typeof input !== 'object') return input;
    return Object.fromEntries(Object.keys(input).sort().map((key) => [key, sort(input[key])]));
  }
  return `${JSON.stringify(sort(value), null, 2)}\n`;
}
function sha256(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(typeof value === 'string' ? value : canonical(value));
  return crypto.createHash('sha256').update(bytes).digest('hex');
}
function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms || 0)))); }
function atomicWriteJson(filePath, document) {
  const target = path.resolve(filePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temp = `${target}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  let fd;
  try {
    fd = fs.openSync(temp, 'wx', 0o600);
    fs.writeFileSync(fd, canonical(document), 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(temp, target);
    try {
      const directory = fs.openSync(path.dirname(target), 'r');
      try { fs.fsyncSync(directory); } catch (error) { if (process.platform !== 'win32' || error?.code !== 'EPERM') throw error; }
      fs.closeSync(directory);
    } catch (error) {
      if (process.platform !== 'win32' || error?.code !== 'EPERM') throw error;
    }
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch (_) {}
    try { fs.rmSync(temp, { force: true }); } catch (_) {}
  }
  return target;
}

function assertPathInside(rootPath, candidatePath, label) {
  const root = path.resolve(String(rootPath || ''));
  const candidate = path.resolve(String(candidatePath || ''));
  const relative = path.relative(root, candidate);
  if (!rootPath || !candidatePath || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    const error = new Error(`${label} escaped the trusted probe root`);
    error.reasonCode = 'WP7_OFFLINE_STARTUP_PRECONDITION_NOT_MET';
    error.details = { root, candidate };
    throw error;
  }
  return candidate;
}

function failOfflinePrecondition(message, details = {}) {
  const error = new Error(message);
  error.reasonCode = 'WP7_OFFLINE_STARTUP_PRECONDITION_NOT_MET';
  error.details = details;
  throw error;
}

function directTrustedBackendProjection(desktopHost) {
  const processHost = desktopHost?.backendProcessHost;
  const backend = processHost?.snapshot?.() || {};
  const child = processHost?.getOwnedChild?.() || null;
  return Object.freeze({
    ...backend,
    child,
    running: backend.running === true,
    ownerTrusted: backend.ownerTrusted === true,
    backendPid: Number(backend.backendPid || child?.pid || 0)
  });
}

async function waitForTrustedReplacementOwner(options = {}) {
  const oldPid = Number(options.oldPid || 0);
  const timeoutMs = Math.max(1_000, Number(options.timeoutMs || 45_000));
  const intervalMs = Math.max(25, Number(options.intervalMs || 100));
  const ownerSnapshot = options.ownerSnapshot;
  const projectionSnapshot = options.projectionSnapshot;
  if (typeof ownerSnapshot !== 'function' || typeof projectionSnapshot !== 'function') throw new TypeError('replacement-owner wait requires ownerSnapshot and projectionSnapshot');
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    const owner = ownerSnapshot() || {};
    const projection = projectionSnapshot() || {};
    const pid = Number(owner.backendPid || owner.child?.pid || 0);
    last = { owner, projection };
    if (pid > 0 && pid !== oldPid && owner.running === true && owner.ownerTrusted === true && projection.trustedOwnerBound === true && projection.runtime?.localReady === true) {
      return Object.freeze({ pid, ownerTrusted: true, localReady: true, owner, projection });
    }
    await sleep(intervalMs);
  }
  const error = new Error('replacement backend owner did not become trusted and local-ready');
  error.reasonCode = 'WP7_BACKEND_CRASH_RECOVERY_TIMEOUT';
  error.details = { oldPid, timeoutMs, last };
  throw error;
}

function createElectronRendererStorageSession(options = {}) {
  const BrowserWindow = options.BrowserWindow;
  const baseUrl = String(options.baseUrl || '').replace(/\/$/, '');
  if (typeof BrowserWindow !== 'function' || !baseUrl || typeof options.waitForReady !== 'function') {
    throw new TypeError('renderer storage session requires BrowserWindow, baseUrl and waitForReady');
  }
  const WP7_RENDERER_STORAGE_PROBE_URL = `${baseUrl}${WP7_RENDERER_STORAGE_PROBE_PATH}`;
  return createRendererStorageProbeSession({
    url: WP7_RENDERER_STORAGE_PROBE_URL,
    waitForReady: options.waitForReady,
    attempts: Number(options.attempts || 5),
    delayMs: Number(options.delayMs || 100),
    createView: ({ attempt }) => new BrowserWindow({
      width: 320,
      height: 240,
      show: false,
      skipTaskbar: true,
      title: `WP7 Renderer Storage Probe ${attempt}`,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInWorker: false,
        sandbox: true,
        webSecurity: true,
        devTools: false,
        spellcheck: false,
        partition: `wp7-renderer-storage-${process.pid}`
      }
    }),
    verifyView: async (view) => view.webContents.executeJavaScript(`(() => {
      const root = document.documentElement;
      return Boolean(root && root.dataset.wp7RendererStorageProbe === ${JSON.stringify(WP7_RENDERER_STORAGE_PROBE_MARKER)} && document.body && document.body.children.length === 0);
    })()`, true)
  });
}

function runtimeAuthority(snapshot = {}) {
  const runtime = snapshot.runtime || {};
  return Object.freeze({
    operatingMode: String(runtime.operatingMode || ''),
    operatingModeRevision: Number(runtime.operatingModeRevision || 0),
    stateVersion: Number(runtime.stateVersion || 0),
    ownerInstanceId: String(runtime.ownerInstanceId || ''),
    backendSessionId: String(runtime.backendSessionId || snapshot.authorityTriple?.backendSessionId || '')
  });
}

function authorityChanged(before, after) {
  return Object.keys(before).some((key) => before[key] !== after[key]);
}

function createSafeModeScenarioRunner(options = {}) {
  const projectionSnapshot = options.projectionSnapshot;
  const pollOnce = options.pollOnce;
  const rendererStorageSession = options.rendererStorageSession;
  const dataRoot = path.resolve(options.dataRoot || '.');
  const legacyRoot = path.resolve(options.legacyRoot || path.join(dataRoot, '..', 'Yance27'));
  const desktopSettingsPath = path.resolve(options.desktopSettingsPath || path.join(dataRoot, 'desktop-settings.json'));
  if (typeof projectionSnapshot !== 'function' || typeof pollOnce !== 'function') throw new TypeError('safe-mode runner requires projectionSnapshot and pollOnce');

  const legacyFile = path.join(legacyRoot, 'safe-mode-state.json');
  const systemPolicyFile = path.join(dataRoot, 'system-policy.json');
  const envKey = 'YANCE27_OPERATING_MODE';
  const rendererKey = 'yance27-safe-mode';

  function saveFile(filePath) {
    return fs.existsSync(filePath) ? { existed: true, bytes: fs.readFileSync(filePath) } : { existed: false, bytes: null };
  }
  function restoreFile(filePath, saved) {
    if (saved.existed) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, saved.bytes);
    } else fs.rmSync(filePath, { force: true });
  }

  return async function runSafeModeScenario(sources = []) {
    const normalized = [...new Set((Array.isArray(sources) ? sources : []).map(String))].sort();
    const sourceId = normalized.length > 1 ? 'combined-conflict' : normalized[0];
    const beforeProjection = projectionSnapshot();
    const beforeAuthority = runtimeAuthority(beforeProjection);
    const saved = {
      legacyFile: saveFile(legacyFile),
      systemPolicyFile: saveFile(systemPolicyFile),
      desktopSettings: saveFile(desktopSettingsPath),
      env: Object.prototype.hasOwnProperty.call(process.env, envKey) ? process.env[envKey] : undefined,
      renderer: null
    };
    const evidence = [];
    try {
      for (const source of normalized) {
        if (source === 'legacy-file') {
          const document = { active: true, reason: 'wp7-negative-injection', generatedAtUtc: new Date().toISOString() };
          atomicWriteJson(legacyFile, document);
          evidence.push({ source, path: legacyFile, sha256: sha256(fs.readFileSync(legacyFile)) });
        } else if (source === 'environment') {
          process.env[envKey] = 'safeMode';
          evidence.push({ source, key: envKey, value: process.env[envKey] });
        } else if (source === 'desktop-settings') {
          const current = saved.desktopSettings.existed ? JSON.parse(saved.desktopSettings.bytes.toString('utf8')) : { schemaVersion: 1, value: {} };
          current.safeMode = true;
          current.value = { ...(current.value || {}), safeMode: true };
          atomicWriteJson(desktopSettingsPath, current);
          evidence.push({ source, path: desktopSettingsPath, sha256: sha256(fs.readFileSync(desktopSettingsPath)) });
        } else if (source === 'renderer-storage') {
          if (!rendererStorageSession) throw Object.assign(new Error('renderer storage probe session is unavailable'), { reasonCode: 'WP7_SAFE_MODE_RENDERER_STORAGE_NAVIGATION_CONFIGURATION_INVALID' });
          saved.renderer = await rendererStorageSession.execute(`localStorage.getItem(${JSON.stringify(rendererKey)})`);
          await rendererStorageSession.execute(`localStorage.setItem(${JSON.stringify(rendererKey)}, 'safeMode'); localStorage.getItem(${JSON.stringify(rendererKey)})`);
          evidence.push({ source, key: rendererKey, value: 'safeMode' });
        } else if (source === 'system-policy') {
          const document = { safeMode: true, operatingMode: 'safeMode', reason: 'wp7-negative-injection' };
          atomicWriteJson(systemPolicyFile, document);
          evidence.push({ source, path: systemPolicyFile, sha256: sha256(fs.readFileSync(systemPolicyFile)) });
        } else {
          throw Object.assign(new Error(`unknown safe-mode source: ${source}`), { reasonCode: 'WP7_SAFE_MODE_NEGATIVE_SOURCE_MATRIX_INCOMPLETE' });
        }
      }
      await pollOnce();
      const afterProjection = projectionSnapshot();
      const afterAuthority = runtimeAuthority(afterProjection);
      const changes = authorityChanged(beforeAuthority, afterAuthority) ? 1 : 0;
      return Object.freeze({
        sourceId,
        injected: true,
        sourcePresenceObserved: evidence.length === normalized.length,
        authorityChanges: changes,
        sqliteAuthorityRetained: changes === 0 && afterAuthority.operatingMode === beforeAuthority.operatingMode,
        authoritySource: 'runtime_state.operating_mode',
        injectionSha256: sha256({ sourceId, evidence })
      });
    } finally {
      restoreFile(legacyFile, saved.legacyFile);
      restoreFile(systemPolicyFile, saved.systemPolicyFile);
      restoreFile(desktopSettingsPath, saved.desktopSettings);
      if (saved.env === undefined) delete process.env[envKey]; else process.env[envKey] = saved.env;
      if (normalized.includes('renderer-storage') && rendererStorageSession) {
        if (saved.renderer == null) await rendererStorageSession.execute(`localStorage.removeItem(${JSON.stringify(rendererKey)}); true`).catch(() => {});
        else await rendererStorageSession.execute(`localStorage.setItem(${JSON.stringify(rendererKey)}, ${JSON.stringify(String(saved.renderer))}); true`).catch(() => {});
      }
    }
  };
}

function readNetworkIsolationStartupObservation(options = {}) {
  const applicationProcessStartedAtUtc = String(options.applicationProcessStartedAtUtc || new Date().toISOString());
  const backendLaunchStartedAtUtc = String(options.backendLaunchStartedAtUtc || applicationProcessStartedAtUtc);
  const platform = String(options.platform || process.platform);
  const earlyNetworkObservedAtUtc = String(options.networkObservedAtUtc || applicationProcessStartedAtUtc);
  const earlyNetworkOnline = options.networkOnlineAtProcessStart;
  const producerPid = Number(options.processPid || process.pid);
  const producerParentPid = Number(options.processParentPid || process.ppid);
  if (platform === 'win32') {
    const env = options.env || {};
    const disabled = String(env.WP7_PROBE_NETWORK_DISABLED_BEFORE_SPAWN || '') === '1';
    const probeRoot = String(env.WP7_PROBE_ROOT || '').trim();
    const executionNonce = String(env.WP7_PROBE_EXECUTION_NONCE || '').trim();
    const attestationPath = assertPathInside(probeRoot, String(env.WP7_WINDOWS_NETWORK_ISOLATION_ATTESTATION_PATH || '').trim(), 'Windows network isolation control attestation');
    const proofPath = assertPathInside(probeRoot, String(env.WP7_WINDOWS_NETWORK_ISOLATION_PROOF_PATH || '').trim(), 'Windows network isolation process proof');
    const expectedAttestationSha256 = String(env.WP7_WINDOWS_NETWORK_ISOLATION_ATTESTATION_SHA256 || '').trim().toLowerCase();
    const expectedRequestSha256 = String(env.WP7_WINDOWS_NETWORK_ISOLATION_REQUEST_SHA256 || '').trim().toLowerCase();
    const expectedStateSha256 = String(env.WP7_WINDOWS_NETWORK_ISOLATION_STATE_SHA256 || '').trim().toLowerCase();
    const expectedWatchdogSha256 = String(env.WP7_WINDOWS_NETWORK_ISOLATION_WATCHDOG_SHA256 || '').trim().toLowerCase();
    const expectedLauncherSha256 = String(env.WP7_WINDOWS_NETWORK_ISOLATION_LAUNCHER_SHA256 || '').trim().toLowerCase();
    const expectedControlProgramSha256 = String(env.WP7_WINDOWS_NETWORK_ISOLATION_CONTROL_PROGRAM_SHA256 || '').trim().toLowerCase();
    const expectedPowerShellSha256 = String(env.WP7_WINDOWS_NETWORK_ISOLATION_POWERSHELL_SHA256 || '').trim().toLowerCase();
    const expectedElevatedPid = Number(env.WP7_WINDOWS_NETWORK_ISOLATION_ELEVATED_PID || 0);
    const expectedGuardianPid = Number(env.WP7_WINDOWS_NETWORK_ISOLATION_GUARDIAN_PID || 0);
    const requiredHashes = [expectedAttestationSha256, expectedRequestSha256, expectedStateSha256, expectedWatchdogSha256, expectedLauncherSha256, expectedControlProgramSha256, expectedPowerShellSha256];
    if (!disabled || !executionNonce || requiredHashes.some((value) => !/^[0-9a-f]{64}$/.test(value)) || !Number.isInteger(expectedElevatedPid) || expectedElevatedPid <= 0
        || !Number.isInteger(expectedGuardianPid) || expectedGuardianPid <= 0) {
      failOfflinePrecondition('Windows offline-start control inputs are incomplete', {
        disabled,
        hasExecutionNonce: Boolean(executionNonce),
        requiredHashes,
        expectedElevatedPid,
        expectedGuardianPid
      });
    }
    if (!fs.existsSync(attestationPath) || !fs.statSync(attestationPath).isFile()) {
      failOfflinePrecondition('Windows network isolation control attestation is missing', { attestationPath });
    }
    const attestationBytes = fs.readFileSync(attestationPath);
    const attestationSha256 = sha256(attestationBytes);
    if (attestationSha256 !== expectedAttestationSha256) {
      failOfflinePrecondition('Windows network isolation control attestation hash mismatch', { expectedAttestationSha256, actualAttestationSha256: attestationSha256 });
    }
    let attestation;
    try { attestation = JSON.parse(attestationBytes.toString('utf8')); }
    catch (error) { failOfflinePrecondition('Windows network isolation control attestation is invalid JSON', { message: error.message }); }
    const disableRecord = attestation?.disableCommand || null;
    const disableStartedMs = Date.parse(String(disableRecord?.startedAtUtc || ''));
    const disableEndedMs = Date.parse(String(disableRecord?.endedAtUtc || ''));
    const attestationGeneratedMs = Date.parse(String(attestation?.generatedAtUtc || ''));
    const applicationStartedMs = Date.parse(applicationProcessStartedAtUtc);
    const networkObservedMs = Date.parse(earlyNetworkObservedAtUtc);
    const backendLaunchMs = Date.parse(backendLaunchStartedAtUtc);
    const identityValid = attestation?.executionNonce === executionNonce
      && attestation?.buildSessionId === String(env.WP7_PROBE_BUILD_SESSION_ID || '')
      && attestation?.buildId === String(env.WP7_PROBE_EXPECTED_BUILD_ID || '')
      && attestation?.installerSha256 === String(env.WP7_PROBE_INSTALLER_SHA256 || '')
      && attestation?.productExecutableSha256 === String(env.WP7_PROBE_EXPECTED_PRODUCT_EXECUTABLE_SHA256 || '')
      && attestation?.mainEntrySha256 === String(env.WP7_PROBE_EXPECTED_MAIN_ENTRY_SHA256 || '');
    const custodyValid = attestation?.producerPid === producerParentPid
      && attestation?.ownerPid === producerParentPid
      && attestation?.elevatedWatchdogPid === expectedElevatedPid
      && attestation?.guardianPid === expectedGuardianPid
      && expectedElevatedPid !== producerParentPid
      && expectedGuardianPid !== producerParentPid
      && expectedGuardianPid !== expectedElevatedPid;
    const hashBindingValid = attestation?.requestSha256 === expectedRequestSha256
      && attestation?.isolatedStateSha256 === expectedStateSha256
      && attestation?.watchdogScriptSha256 === expectedWatchdogSha256
      && attestation?.launcherScriptSha256 === expectedLauncherSha256
      && attestation?.controlProgramSha256 === expectedControlProgramSha256
      && attestation?.powerShellExecutableSha256 === expectedPowerShellSha256
      && attestation?.guardianScriptSha256 === expectedWatchdogSha256;
    const chronologyValid = Number.isFinite(disableStartedMs)
      && Number.isFinite(disableEndedMs)
      && Number.isFinite(attestationGeneratedMs)
      && Number.isFinite(applicationStartedMs)
      && Number.isFinite(networkObservedMs)
      && Number.isFinite(backendLaunchMs)
      && disableStartedMs <= disableEndedMs
      && disableEndedMs <= attestationGeneratedMs
      && attestationGeneratedMs <= applicationStartedMs
      && applicationStartedMs <= networkObservedMs
      && networkObservedMs <= backendLaunchMs;
    const isolationPostconditionValid = attestation?.isolationPostcondition?.passed === true
      && attestation?.isolationPostcondition?.allOriginallyEnabledPhysicalAdaptersDisabled === true
      && attestation?.isolationPostcondition?.allOriginallyEnabledIsolatableAdaptersDisabled === true
      && attestation?.isolationPostcondition?.noDefaultRoutesRemain === true
      && attestation?.isolationPostcondition?.remainingDefaultRouteCount === 0
      && Array.isArray(attestation?.adaptersBefore)
      && attestation.adaptersBefore.some((row) => row?.adminStatus === 'Up')
      && Array.isArray(attestation?.adaptersAfterDisable)
      && Array.isArray(attestation?.routesAfterDisable)
      && attestation.routesAfterDisable.length === 0;
    const attestationValid = attestation?.schemaVersion === 2
      && attestation?.documentType === 'WP7_WINDOWS_NETWORK_ISOLATION_CONTROL_ATTESTATION'
      && attestation?.disableCommandPassed === true
      && disableRecord?.passed === true
      && disableRecord?.exitCode === 0
      && disableRecord?.expectedExitCode === 0
      && disableRecord?.executionKind === 'POWERSHELL_CMDLET_BATCH'
      && disableRecord?.resultCodeSource === 'POWERSHELL_EXCEPTION_MAPPING'
      && disableRecord?.postconditionVerified === true
      && Array.isArray(disableRecord?.operations)
      && disableRecord.operations.length > 0
      && disableRecord.operations.every((row) => row?.passed === true && row?.exitCode === 0
        && row?.executionKind === 'POWERSHELL_CMDLET'
        && row?.resultCodeSource === 'POWERSHELL_EXCEPTION_MAPPING'
        && row?.invocationCompleted === true
        && row?.commandName === 'Disable-NetAdapter')
      && identityValid
      && custodyValid
      && hashBindingValid
      && chronologyValid
      && isolationPostconditionValid;
    const offlineAtProcessStart = earlyNetworkOnline === false;
    if (!attestationValid || !offlineAtProcessStart) {
      failOfflinePrecondition('Windows offline-start was not proven before application/backend startup', {
        attestationValid,
        offlineAtProcessStart,
        identityValid,
        custodyValid,
        hashBindingValid,
        chronologyValid,
        isolationPostconditionValid,
        producerPid: attestation?.producerPid,
        expectedParentPid: producerParentPid
      });
    }
    const observedMs = networkObservedMs;
    const proofDocument = {
      schemaVersion: 1,
      documentType: 'WP7_NETWORK_ISOLATION_PRE_MAIN_PROOF',
      pid: producerPid,
      parentPid: producerParentPid,
      nonce: executionNonce,
      unixSeconds: Math.floor(observedMs / 1000),
      unixNanoseconds: Math.floor(observedMs % 1000) * 1_000_000,
      platform: 'win32',
      proofClass: 'WINDOWS_PARENT_CONTROL_AND_EARLY_ELECTRON_NETWORK_OBSERVATION',
      applicationProcessStartedAtUtc,
      networkObservedAtUtc: earlyNetworkObservedAtUtc,
      backendLaunchStartedAtUtc,
      networkOnlineAtProcessStart: false,
      controlAttestationSha256: attestationSha256,
      controlAttestationValid: true,
      generatedAtUtc: new Date().toISOString()
    };
    atomicWriteJson(proofPath, proofDocument);
    const proofSha256 = sha256(fs.readFileSync(proofPath));
    const hostSourceSha256 = sha256(fs.readFileSync(__filename));
    return Object.freeze({
      applicationProcessStartedAtUtc,
      networkObservedAtUtc: earlyNetworkObservedAtUtc,
      backendLaunchStartedAtUtc,
      networkUnavailableBeforeApplicationStart: true,
      networkUnavailableBeforeBackendStart: true,
      networkIsolationPreMainProof: true,
      networkIsolationProofPid: producerPid,
      networkIsolationProofParentPid: producerParentPid,
      networkIsolationProofNonce: executionNonce,
      networkIsolationProofSha256: proofSha256,
      networkIsolationSourceSha256: attestationSha256,
      networkIsolationLibrarySha256: hostSourceSha256,
      nonLoopbackConnectDenied: true,
      loopbackConnectAllowed: true,
      networkIsolationProofClass: proofDocument.proofClass,
      controlAttestationPath: attestationPath,
      processProofPath: proofPath
    });
  }
  const proofDir = String(options.env?.WP7_NETWORK_ISOLATION_PROOF_DIR || '').trim();
  const nonce = String(options.env?.WP7_NETWORK_ISOLATION_NONCE || '').trim();
  const disabled = String(options.env?.WP7_PROBE_NETWORK_DISABLED_BEFORE_SPAWN || '') === '1';
  const proofPath = proofDir ? path.join(proofDir, `${process.pid}.json`) : '';
  let proof = null;
  if (proofPath && fs.existsSync(proofPath)) proof = JSON.parse(fs.readFileSync(proofPath, 'utf8'));
  const networkObservedAtUtc = proof
    ? new Date(Number(proof.unixSeconds) * 1000 + Math.floor(Number(proof.unixNanoseconds) / 1_000_000)).toISOString()
    : applicationProcessStartedAtUtc;
  const sourcePath = String(options.env?.WP7_NETWORK_ISOLATION_SOURCE_PATH || '');
  const libraryPath = String(options.env?.WP7_NETWORK_ISOLATION_LIBRARY_PATH || '');
  return Object.freeze({
    applicationProcessStartedAtUtc,
    networkObservedAtUtc,
    backendLaunchStartedAtUtc,
    networkUnavailableBeforeApplicationStart: disabled && Boolean(proof),
    networkUnavailableBeforeBackendStart: disabled && Boolean(proof) && Date.parse(networkObservedAtUtc) <= Date.parse(backendLaunchStartedAtUtc),
    networkIsolationPreMainProof: Boolean(proof) && proof.pid === process.pid && proof.parentPid === process.ppid && proof.nonce === nonce,
    networkIsolationProofPid: Number(proof?.pid || 0),
    networkIsolationProofParentPid: Number(proof?.parentPid || 0),
    networkIsolationProofNonce: String(proof?.nonce || ''),
    networkIsolationProofSha256: proofPath && fs.existsSync(proofPath) ? sha256(fs.readFileSync(proofPath)) : '',
    networkIsolationSourceSha256: sourcePath && fs.existsSync(sourcePath) ? sha256(fs.readFileSync(sourcePath)) : String(options.env?.WP7_NETWORK_ISOLATION_SOURCE_SHA256 || ''),
    networkIsolationLibrarySha256: libraryPath && fs.existsSync(libraryPath) ? sha256(fs.readFileSync(libraryPath)) : String(options.env?.WP7_NETWORK_ISOLATION_LIBRARY_SHA256 || ''),
    nonLoopbackConnectDenied: disabled && Boolean(proof),
    loopbackConnectAllowed: true
  });
}

function scanDuplicateRuntimeEntrypoints(appRoot) {
  const root = path.resolve(appRoot || '.');
  const canonicalEntry = path.join(root, 'backend', 'desktopHostedEntry.js');
  let entryCount = 0;
  function visit(directory) {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') continue;
        visit(absolute);
      } else if (entry.isFile() && entry.name === 'desktopHostedEntry.js') entryCount += 1;
    }
  }
  visit(root);
  return Object.freeze({
    canonicalEntrypointPresent: fs.existsSync(canonicalEntry),
    runtimeEntrypointCount: entryCount,
    duplicateRuntimeEntrypointCount: Math.max(0, entryCount - (fs.existsSync(canonicalEntry) ? 1 : 0))
  });
}

module.exports = {
  atomicWriteJson,
  createElectronRendererStorageSession,
  createSafeModeScenarioRunner,
  directTrustedBackendProjection,
  readNetworkIsolationStartupObservation,
  runtimeAuthority,
  scanDuplicateRuntimeEntrypoints,
  sha256,
  waitForTrustedReplacementOwner
};
