'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { canonical, createIdentityObservation, identityTuple, sha256 } = require('../shared/release/identityObservation');

function sha256Buffer(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function sha256File(file) { return sha256Buffer(fs.readFileSync(file)); }
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
const BOOT_FAILURE_CHILD_ALLOWED_SWITCHES = new Set(['--no-sandbox', '--disable-gpu']);
function normalizeBootFailureChildArguments(args = []) {
  return [...new Set((Array.isArray(args) ? args : [])
    .map((value) => String(value || '').trim())
    .filter((value) => BOOT_FAILURE_CHILD_ALLOWED_SWITCHES.has(value)))];
}
function isPidAlive(pid) {
  const value = Number(pid || 0);
  if (!Number.isInteger(value) || value < 1) return false;
  try { process.kill(value, 0); return true; } catch (error) { return error?.code !== 'ESRCH'; }
}
function observationSha(value) { return sha256(value); }
function identityObservation(consumer, identity, provenance = {}, observedDocument = null) {
  return createIdentityObservation({
    consumer,
    identity,
    observedDocument: observedDocument || identity,
    rawDocumentConsumer: provenance.rawDocumentConsumer || observedDocument?.consumer || consumer,
    producerType: provenance.producerType,
    producerProcess: provenance.producerProcess,
    producerPid: provenance.producerPid,
    sourceKind: provenance.sourceKind,
    observationSource: provenance.observationSource,
    observedAtUtc: provenance.observedAtUtc
  });
}

function ownerSample(deps, extra = {}) {
  const current = deps.ownerSnapshot();
  const candidates = new Set((deps.knownOwnerPids?.() || []).map(Number).filter((pid) => isPidAlive(pid)));
  const currentPid = Number(current?.backend?.backendPid || current?.child?.pid || 0);
  if (isPidAlive(currentPid)) candidates.add(currentPid);
  const aliveOwnerPids = [...candidates].sort((a, b) => a - b);
  return {
    observedAtUtc: new Date().toISOString(),
    observedAtMonotonicMs: Number(process.hrtime.bigint() / 1_000_000n),
    aliveOwnerPids,
    concurrentOwnerCount: aliveOwnerPids.length,
    trustedOwnerPid: current?.ownerTrusted === true ? currentPid : 0,
    ownerInstanceId: String(current?.backend?.ownerInstanceId || ''),
    backendSessionId: String(current?.backend?.backendSessionId || ''),
    runtimeLeaseId: String(current?.backend?.ownerSessionId || current?.backend?.credentialAuthorityEventId || ''),
    ...extra
  };
}

async function measureOwnerAction(deps, action, options = {}) {
  const intervalMs = Math.max(5, Number(options.intervalMs || 20));
  const samples = [];
  let active = true;
  const collect = () => samples.push(ownerSample(deps));
  collect();
  const timer = setInterval(() => { if (active) collect(); }, intervalMs);
  timer.unref?.();
  try {
    const result = await action();
    collect();
    return { result, ownerSamples: samples };
  } finally {
    active = false;
    clearInterval(timer);
  }
}

function summarizeOwnerSamples(samples) {
  const maximumConcurrentAppRuntimeOwners = Math.max(...samples.map((row) => row.concurrentOwnerCount), 0);
  const overlapViolationCount = samples.filter((row) => row.concurrentOwnerCount > 1).length;
  const intervals = new Map();
  for (const sample of samples) {
    for (const pid of sample.aliveOwnerPids) {
      const row = intervals.get(pid) || { pid, firstObservedAtUtc: sample.observedAtUtc, lastObservedAtUtc: sample.observedAtUtc, samples: 0 };
      row.lastObservedAtUtc = sample.observedAtUtc;
      row.samples += 1;
      intervals.set(pid, row);
    }
  }
  return { maximumConcurrentAppRuntimeOwners, overlapViolationCount, ownerIntervals: [...intervals.values()].sort((a, b) => a.pid - b.pid) };
}

function credentialApplicationHistory(deps) {
  const snapshot = deps.credentialApplicationSnapshot?.();
  return Array.isArray(snapshot?.stateHistory) ? snapshot.stateHistory : [];
}

function orderedStateSequence(sequence, required) {
  let cursor = -1;
  for (const state of required) {
    cursor = sequence.indexOf(state, cursor + 1);
    if (cursor < 0) return false;
  }
  return true;
}

function createWp7InstalledRuntimeProbeMainAdapter(deps = {}) {
  const getBackendReady = deps.getBackendReady;
  const getReleaseIdentity = deps.getReleaseIdentity;
  if (typeof getBackendReady !== 'function' || typeof getReleaseIdentity !== 'function') throw new TypeError('WP7 probe adapter requires getBackendReady and getReleaseIdentity');

  return {
    async releaseIdentityConsumers() {
      const resourcesPath = deps.resourcesPath();
      const electronIdentity = deps.readElectronIdentity(resourcesPath);
      const observationRoot = path.resolve(deps.identityObservationRoot());
      fs.mkdirSync(observationRoot, { recursive: true });
      const electronDocument = {
        schemaVersion: 1,
        documentType: 'YANCE_ELECTRON_RELEASE_IDENTITY',
        consumer: 'electron',
        producerType: 'electron-main',
        producerProcess: 'electron/main.js',
        producerPid: process.pid,
        observedAtUtc: new Date().toISOString(),
        ...identityTuple(electronIdentity)
      };
      const electronPath = path.join(observationRoot, 'electron-release-identity.json');
      fs.writeFileSync(electronPath, canonical(electronDocument), { mode: 0o600 });
      const electronObserved = JSON.parse(fs.readFileSync(electronPath, 'utf8'));

      const backendReady = await getBackendReady();
      const backendDocument = backendReady?.releaseIdentityObservation || backendReady;
      const installerReceipt = deps.readInstallerIdentityReceipt(resourcesPath, electronIdentity.buildId);
      const diagnosticsDocument = await deps.getDiagnosticsIdentity();

      return {
        electron: identityObservation('electron', electronObserved, {
          producerType: electronObserved.producerType,
          producerProcess: electronObserved.producerProcess,
          producerPid: electronObserved.producerPid,
          sourceKind: 'electron-runtime-observation',
          observationSource: electronPath,
          observedAtUtc: electronObserved.observedAtUtc
        }, electronObserved),
        backend: identityObservation('backend', backendDocument, {
          producerType: backendDocument.producerType,
          producerProcess: backendDocument.producerProcess,
          producerPid: backendDocument.producerPid,
          sourceKind: 'http-endpoint',
          observationSource: '/api/ready',
          observedAtUtc: backendDocument.observedAtUtc || backendReady.at || new Date().toISOString()
        }, backendDocument),
        installer: identityObservation('installer', installerReceipt.document, {
          producerType: installerReceipt.document.producerType,
          producerProcess: installerReceipt.document.producerProcess,
          producerPid: installerReceipt.document.producerPid,
          sourceKind: 'installer-embedded-document',
          observationSource: installerReceipt.filePath,
          observedAtUtc: installerReceipt.document.generatedAtUtc
        }, installerReceipt.document),
        diagnostics: identityObservation('diagnostics', diagnosticsDocument, {
          producerType: diagnosticsDocument.producerType,
          producerProcess: diagnosticsDocument.producerProcess,
          producerPid: diagnosticsDocument.producerPid,
          sourceKind: 'http-endpoint',
          observationSource: '/api/r32/system/release-identity',
          observedAtUtc: diagnosticsDocument.observedAtUtc
        }, diagnosticsDocument)
      };
    },

    currentOwnerObservation() {
      const sample = ownerSample(deps);
      return { maximumConcurrentAppRuntimeOwners: sample.concurrentOwnerCount, ownerSamples: [sample] };
    },

    async restartWithOwnerTimeline() {
      const before = deps.ownerSnapshot();
      const beforePid = Number(before?.backend?.backendPid || before?.child?.pid || 0);
      const measured = await measureOwnerAction(deps, () => deps.restartBackend({ reason: 'wp7-installed-probe-restart' }));
      const after = deps.ownerSnapshot();
      const afterPid = Number(after?.backend?.backendPid || after?.child?.pid || 0);
      const summary = summarizeOwnerSamples(measured.ownerSamples);
      return {
        ...summary,
        ownerSamples: measured.ownerSamples,
        ownerChanged: beforePid > 0 && afterPid > 0 && beforePid !== afterPid,
        restartSource: measured.result?.source || 'controlled-restart'
      };
    },

    async crashBackendAndRecover() {
      const oldChild = deps.ownedBackendChild();
      const oldPid = Number(oldChild?.pid || 0);
      if (!oldChild || !oldPid) {
        const error = new Error('No trusted backend owner is available for crash recovery probe');
        error.reasonCode = 'WP7_INSTALLED_RUNTIME_PROBE_NOT_READY';
        throw error;
      }
      const known = new Set([oldPid]);
      deps.setKnownOwnerPids?.(known);
      const baselineStateHistoryLength = credentialApplicationHistory(deps).length;
      const measured = await measureOwnerAction(deps, async () => {
        oldChild.kill('SIGKILL');
        return deps.waitForReplacementOwner(oldPid, known);
      }, { intervalMs: 10 });
      const replacement = measured.result;
      known.add(Number(replacement.pid));
      measured.ownerSamples.push(ownerSample(deps));
      const summary = summarizeOwnerSamples(measured.ownerSamples);
      const lastOld = [...measured.ownerSamples].reverse().find((row) => row.aliveOwnerPids.includes(oldPid));
      const firstNewTrusted = measured.ownerSamples.find((row) => row.trustedOwnerPid === Number(replacement.pid));
      const oldOwnerExitAtUtc = deps.lastOwnerExitAtUtc?.(oldPid) || lastOld?.observedAtUtc || new Date().toISOString();
      const newOwnerAuthorityAtUtc = firstNewTrusted?.observedAtUtc || new Date().toISOString();
      const recoveryStateSequence = credentialApplicationHistory(deps)
        .slice(baselineStateHistoryLength)
        .map((entry) => String(entry?.state || ''))
        .filter(Boolean);
      const ownerExitConfirmedBeforeRecovery = orderedStateSequence(recoveryStateSequence, ['OWNER_EXIT_CONFIRMED', 'OWNER_RECOVERING']);
      const ownerRecoveryCompletedBeforeReplacementStart = orderedStateSequence(recoveryStateSequence, ['OWNER_RECOVERING', 'IDLE', 'NEW_OWNER_STARTING']);
      return {
        ...summary,
        ownerSamples: measured.ownerSamples,
        trustedReplacementOwnerObserved: replacement.ownerTrusted === true,
        backendCrashRecoveryVerified: replacement.localReady === true,
        replacementOwnerPid: Number(replacement.pid),
        oldOwnerExitAtUtc,
        newOwnerAuthorityAtUtc,
        recoveryStateSequence,
        ownerExitConfirmedBeforeRecovery,
        ownerRecoveryCompletedBeforeReplacementStart
      };
    },

    async offlineStartupObservation() {
      const startup = deps.getStartupObservation();
      const ready = await getBackendReady();
      const boot = ready.probeObservations || {};
      const offline = boot.offlineStartup || {};
      return {
        applicationProcessStartedAtUtc: startup.applicationProcessStartedAtUtc,
        networkObservedAtUtc: startup.networkObservedAtUtc,
        backendLaunchStartedAtUtc: startup.backendLaunchStartedAtUtc,
        credentialHydrationCompletedAtUtc: boot.credentialHydratedAtUtc,
        localReadyAtUtc: boot.localReadyAtUtc,
        networkUnavailableBeforeApplicationStart: startup.networkUnavailableBeforeApplicationStart === true,
        networkUnavailableBeforeBackendStart: startup.networkUnavailableBeforeBackendStart === true,
        networkIsolationPreMainProof: startup.networkIsolationPreMainProof === true,
        networkIsolationProofPid: Number(startup.networkIsolationProofPid || 0),
        networkIsolationProofParentPid: Number(startup.networkIsolationProofParentPid || 0),
        networkIsolationProofNonce: String(startup.networkIsolationProofNonce || ''),
        networkIsolationProofSha256: String(startup.networkIsolationProofSha256 || ''),
        networkIsolationSourceSha256: String(startup.networkIsolationSourceSha256 || ''),
        networkIsolationLibrarySha256: String(startup.networkIsolationLibrarySha256 || ''),
        networkIsolationProofClass: String(startup.networkIsolationProofClass || ''),
        nonLoopbackConnectDenied: startup.nonLoopbackConnectDenied === true,
        loopbackConnectAllowed: startup.loopbackConnectAllowed === true,
        backendStartedOffline: offline.backendStartedOffline === true,
        credentialHydrationCompletedOffline: Boolean(boot.credentialHydratedAtUtc) && offline.networkCommandAppliedBeforeLocalReady === true,
        localReadyFormedOffline: Boolean(boot.localReadyAtUtc) && offline.networkCommandAppliedBeforeLocalReady === true
      };
    },

    async exerciseSafeModeSourceMatrix() {
      const scenarios = [
        ['legacy-file'], ['environment'], ['desktop-settings'], ['renderer-storage'], ['system-policy'],
        ['legacy-file','environment','desktop-settings','renderer-storage','system-policy']
      ];
      const sourceResults = [];
      for (const sources of scenarios) sourceResults.push(await deps.runSafeModeScenario(sources));
      return { sourceResults, totalAuthorityChanges: sourceResults.reduce((sum, row) => sum + Number(row.authorityChanges || 0), 0) };
    },

    async credentialReadyGateObservation() {
      const ready = await getBackendReady();
      const probe = ready.probeObservations?.credentialReadyGate || {};
      return {
        ...probe,
        finalHydrationCompleted: Boolean(ready.credentialMetadata),
        finalLocalReady: ready.ready === true,
        hydrationCompletedAtUtc: ready.probeObservations?.credentialHydratedAtUtc || '',
        localReadyAtUtc: ready.probeObservations?.localReadyAtUtc || ''
      };
    },

    async triggerProductionEventGap() {
      const coordinator = deps.runtimeProjectionCoordinator();
      const before = coordinator.snapshot();
      const expectedNextSequence = Number(before.runtime?.lastEventSequence || before.authorityTriple?.lastEventSequence || 0) + 1;
      const injected = await deps.runtimeApiClient().injectWp7ProbeEventGap(expectedNextSequence - 1, { timeoutMs: 10_000 });
      const beforeGap = Number(before.metrics?.eventGaps || 0);
      const beforeRefetch = Number(before.metrics?.snapshotRefetches || 0);
      await coordinator.pollOnce();
      const after = coordinator.snapshot();
      return {
        injectedThroughProductionEventStore: injected.injectedThroughProductionEventStore === true,
        detectedByProductionPollPath: Number(after.metrics?.eventGaps || 0) > beforeGap,
        privateRecoveryMethodCalledDirectly: false,
        snapshotRefetchForced: Number(after.metrics?.snapshotRefetches || 0) > beforeRefetch,
        eventGapMetricIncremented: Number(after.metrics?.eventGaps || 0) > beforeGap,
        baselineRestored: after.trustedOwnerBound === true && after.runtime?.localReady === true,
        expectedNextSequence,
        oldestAvailableSequence: Number(injected.oldestAvailableSequence || 0),
        lastAvailableSequence: Number(injected.lastAvailableSequence || 0)
      };
    },

    async runBootFailureProcess() {
      const identity = getReleaseIdentity();
      const outputPath = deps.bootFailureOutputPath();
      fs.rmSync(outputPath, { force: true });
      const env = { ...process.env };
      for (const key of Object.keys(env)) if (key.startsWith('WP7_PROBE_')) delete env[key];
      const childRoot = path.join(path.dirname(outputPath), 'boot-failure-child-data');
      const missingResources = path.join(path.dirname(outputPath), 'boot-failure-missing-resources');
      fs.rmSync(childRoot, { recursive: true, force: true });
      fs.rmSync(missingResources, { recursive: true, force: true });
      Object.assign(env, {
        WP7_BOOT_FAILURE_CHILD: '1',
        WP7_BOOT_FAILURE_OUTPUT_PATH: outputPath,
        WP7_BOOT_FAILURE_EXPECTED_BUILD_ID: identity.buildId,
        WP7_BOOT_FAILURE_EXPECTED_SOURCE_COMMIT: identity.sourceCommit,
        WP7_BOOT_FAILURE_EXPECTED_SOURCE_TREE: identity.sourceTree,
        WP7_BOOT_FAILURE_INJECTION: 'MISSING_RELEASE_MANIFEST',
        WP7_BOOT_FAILURE_RESOURCES_PATH: missingResources,
        YANCE_DATA_DIR: childRoot
      });
      const startedAtUtc = new Date().toISOString();
      const childArguments = normalizeBootFailureChildArguments(deps.bootFailureChildArguments?.() || []);
      const child = spawn(process.execPath, childArguments, { env, cwd: process.cwd(), windowsHide: true, stdio: ['ignore','pipe','pipe'] });
      let stdout = '';
      let stderr = '';
      child.stdout?.on('data', (chunk) => { stdout += String(chunk); });
      child.stderr?.on('data', (chunk) => { stderr += String(chunk); });
      const outcome = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch (_) {} reject(Object.assign(new Error('boot failure child timed out'), { reasonCode: 'WP7_BOOT_FAILURE_PROBE_NOT_REAL_STARTUP_FAILURE' })); }, 60_000);
        child.once('error', reject);
        child.once('exit', (code, signal) => { clearTimeout(timer); resolve({ code: Number(code ?? 0), signal: signal || null }); });
      });
      if (!fs.existsSync(outputPath)) {
        const error = new Error('failed installed application process did not emit formal boot diagnostics');
        error.reasonCode = 'WP7_BOOT_FAILURE_PROBE_NOT_REAL_STARTUP_FAILURE';
        error.details = { outcome, stdout, stderr };
        throw error;
      }
      const diagnostic = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
      return {
        childProcessSpawned: true,
        generatedByFailedApplicationProcess: diagnostic.producerPid === child.pid,
        failureObserved: outcome.code !== 0,
        childExitCode: outcome.code,
        childSignal: outcome.signal,
        failedPhase: String(diagnostic.failedPhase || ''),
        reasonCode: String(diagnostic.reasonCode || ''),
        diagnosticBuildId: String(diagnostic.buildId || ''),
        diagnosticPath: outputPath,
        diagnosticSha256: sha256File(outputPath),
        diagnosticProducerPid: Number(diagnostic.producerPid || 0),
        parentProbePid: process.pid,
        startedAtUtc,
        completedAtUtc: new Date().toISOString(),
        stdoutSha256: sha256Buffer(Buffer.from(stdout)),
        stderrSha256: sha256Buffer(Buffer.from(stderr))
      };
    }
  };
}

module.exports = {
  createWp7InstalledRuntimeProbeMainAdapter,
  normalizeBootFailureChildArguments,
  identityObservation,
  identityTuple,
  isPidAlive,
  measureOwnerAction,
  observationSha,
  sha256File,
  summarizeOwnerSamples
};
