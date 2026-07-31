'use strict';

const SHA256_RE = /^[0-9a-f]{64}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const REQUIRED_IDENTITY_FIELDS = Object.freeze(['buildId','productVersion','stageVersion','sourceCommit','sourceTree','manifestSha256']);
const SAFE_MODE_SOURCES = Object.freeze(['legacy-file','environment','desktop-settings','renderer-storage','system-policy','combined-conflict']);
const { assertIndependentObservations, validateObservation } = require('../shared/release/identityObservation');

function fail(reasonCode, message, details = {}) {
  const error = new Error(message);
  error.reasonCode = reasonCode;
  error.details = details;
  throw error;
}
function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('WP7_INSTALLED_RUNTIME_PROBE_SEMANTIC_INVALID', `${label} must be an object`, { label });
  return value;
}
function nonEmptyObject(value, label) {
  object(value, label);
  if (!Object.keys(value).length) fail('WP7_INSTALLED_RUNTIME_PROBE_MEASUREMENT_MISSING', `${label} must not be empty`, { label });
  return value;
}
function boolean(value, label, expected) {
  if (typeof value !== 'boolean') fail('WP7_INSTALLED_RUNTIME_PROBE_SEMANTIC_INVALID', `${label} must be boolean`, { label, value });
  if (expected !== undefined && value !== expected) fail('WP7_INSTALLED_RUNTIME_PROBE_ORACLE_FAILED', `${label} did not satisfy the formal oracle`, { label, expected, actual: value });
  return value;
}
function integer(value, label, options = {}) {
  if (!Number.isInteger(value)) fail('WP7_INSTALLED_RUNTIME_PROBE_SEMANTIC_INVALID', `${label} must be an integer`, { label, value });
  if (options.min != null && value < options.min) fail('WP7_INSTALLED_RUNTIME_PROBE_ORACLE_FAILED', `${label} is below the allowed minimum`, { label, min: options.min, actual: value });
  if (options.max != null && value > options.max) fail('WP7_INSTALLED_RUNTIME_PROBE_ORACLE_FAILED', `${label} is above the allowed maximum`, { label, max: options.max, actual: value });
  return value;
}
function string(value, label, options = {}) {
  if (typeof value !== 'string' || (!options.allowEmpty && !value.trim())) fail('WP7_INSTALLED_RUNTIME_PROBE_SEMANTIC_INVALID', `${label} must be a non-empty string`, { label, value });
  if (options.pattern && !options.pattern.test(value)) fail('WP7_INSTALLED_RUNTIME_PROBE_SEMANTIC_INVALID', `${label} has invalid format`, { label, value });
  return value;
}
function iso(value, label) { return string(value, label, { pattern: ISO_RE }); }
function sha(value, label) { return string(value, label, { pattern: SHA256_RE }); }
function chronological(values, labels) {
  const times = values.map((value, index) => Date.parse(iso(value, labels[index])));
  for (let index = 1; index < times.length; index += 1) {
    if (times[index] < times[index - 1]) fail('WP7_INSTALLED_RUNTIME_PROBE_ORACLE_FAILED', `${labels[index]} predates ${labels[index - 1]}`, { labels, times });
  }
}

function validateIdentityConsumer(name, value) {
  return validateObservation(value, name);
}

function validateFirstStart(m) {
  boolean(m.freshInitialization, 'freshInitialization', true);
  boolean(m.freshConfigurationCreated, 'freshConfigurationCreated', true);
  boolean(m.freshDatabaseCreated, 'freshDatabaseCreated', true);
  boolean(m.legacyDataRootConsumed, 'legacyDataRootConsumed', false);
  boolean(m.localReady, 'localReady', true);
  boolean(m.hydrationCompletedBeforeReady, 'hydrationCompletedBeforeReady', true);
  boolean(m.trustedOwnerVerified, 'trustedOwnerVerified', true);
  boolean(m.projectionAgreementBeforeReady, 'projectionAgreementBeforeReady', true);
  integer(m.duplicateRuntimeEntrypointCount, 'duplicateRuntimeEntrypointCount', { min: 0, max: 0 });
  const consumers = nonEmptyObject(m.releaseIdentityConsumers, 'releaseIdentityConsumers');
  const names = ['electron','backend','installer','diagnostics'];
  for (const name of names) validateIdentityConsumer(name, consumers[name]);
  assertIndependentObservations(consumers);
}

function validateControlledStop(m) {
  boolean(m.ownerExitConfirmed, 'ownerExitConfirmed', true);
  boolean(m.runtimeStopConfirmed, 'runtimeStopConfirmed', true);
  string(m.stopResolutionStatus, 'stopResolutionStatus');
}
function validateRestart(m) {
  boolean(m.localReady, 'localReady', true);
  boolean(m.ownerChanged, 'ownerChanged', true);
  integer(m.maximumConcurrentAppRuntimeOwners, 'maximumConcurrentAppRuntimeOwners', { min: 1, max: 1 });
  const samples = Array.isArray(m.ownerSamples) ? m.ownerSamples : [];
  if (samples.length < 2) fail('WP7_RUNTIME_OWNER_CONCURRENCY_NOT_MEASURED', 'restart must include owner timeline samples');
}
function validateOfflineStart(m) {
  boolean(m.networkUnavailableBeforeApplicationStart, 'networkUnavailableBeforeApplicationStart', true);
  boolean(m.networkUnavailableBeforeBackendStart, 'networkUnavailableBeforeBackendStart', true);
  boolean(m.networkIsolationPreMainProof, 'networkIsolationPreMainProof', true);
  integer(m.networkIsolationProofPid, 'networkIsolationProofPid', { min: 1 });
  integer(m.networkIsolationProofParentPid, 'networkIsolationProofParentPid', { min: 1 });
  string(m.networkIsolationProofNonce, 'networkIsolationProofNonce');
  sha(m.networkIsolationProofSha256, 'networkIsolationProofSha256');
  sha(m.networkIsolationSourceSha256, 'networkIsolationSourceSha256');
  sha(m.networkIsolationLibrarySha256, 'networkIsolationLibrarySha256');
  string(m.networkIsolationProofClass, 'networkIsolationProofClass');
  boolean(m.nonLoopbackConnectDenied, 'nonLoopbackConnectDenied', true);
  boolean(m.loopbackConnectAllowed, 'loopbackConnectAllowed', true);
  boolean(m.backendStartedOffline, 'backendStartedOffline', true);
  boolean(m.credentialHydrationCompletedOffline, 'credentialHydrationCompletedOffline', true);
  boolean(m.localReadyFormedOffline, 'localReadyFormedOffline', true);
  boolean(m.localReady, 'localReady', true);
  boolean(m.capabilityStateExplicit, 'capabilityStateExplicit', true);
  integer(m.falseOnlineCapabilityCount, 'falseOnlineCapabilityCount', { min: 0, max: 0 });
  chronological(
    [m.applicationProcessStartedAtUtc,m.networkObservedAtUtc,m.backendLaunchStartedAtUtc,m.credentialHydrationCompletedAtUtc,m.localReadyAtUtc],
    ['applicationProcessStartedAtUtc','networkObservedAtUtc','backendLaunchStartedAtUtc','credentialHydrationCompletedAtUtc','localReadyAtUtc']
  );
}
function validateOwnerTimeline(m) {
  const samples = Array.isArray(m.ownerSamples) ? m.ownerSamples : [];
  if (samples.length < 3) fail('WP7_RUNTIME_OWNER_CONCURRENCY_NOT_MEASURED', 'owner concurrency requires at least three timeline samples');
  for (const [index, sample] of samples.entries()) {
    object(sample, `ownerSamples[${index}]`);
    iso(sample.observedAtUtc, `ownerSamples[${index}].observedAtUtc`);
    if (!Array.isArray(sample.aliveOwnerPids)) fail('WP7_RUNTIME_OWNER_CONCURRENCY_NOT_MEASURED', 'aliveOwnerPids must be an array', { index });
    for (const pid of sample.aliveOwnerPids) integer(pid, `ownerSamples[${index}].aliveOwnerPids`, { min: 1 });
    integer(sample.concurrentOwnerCount, `ownerSamples[${index}].concurrentOwnerCount`, { min: 0 });
    if (sample.concurrentOwnerCount !== new Set(sample.aliveOwnerPids).size) fail('WP7_RUNTIME_OWNER_CONCURRENCY_NOT_MEASURED', 'owner count does not equal sampled PIDs', { index });
  }
  integer(m.maximumConcurrentAppRuntimeOwners, 'maximumConcurrentAppRuntimeOwners', { min: 1, max: 1 });
  integer(m.overlapViolationCount, 'overlapViolationCount', { min: 0, max: 0 });
  boolean(m.trustedReplacementOwnerObserved, 'trustedReplacementOwnerObserved', true);
  boolean(m.backendCrashRecoveryVerified, 'backendCrashRecoveryVerified', true);
  boolean(m.ownerExitConfirmedBeforeRecovery, 'ownerExitConfirmedBeforeRecovery', true);
  boolean(m.ownerRecoveryCompletedBeforeReplacementStart, 'ownerRecoveryCompletedBeforeReplacementStart', true);
  const recoveryStateSequence = Array.isArray(m.recoveryStateSequence) ? m.recoveryStateSequence : [];
  if (recoveryStateSequence.length < 4 || recoveryStateSequence.some((state) => typeof state !== 'string' || !state)) {
    fail('WP7_BACKEND_CRASH_RECOVERY_STATE_SEQUENCE_MISSING', 'crash recovery must include the production coordinator state sequence', { recoveryStateSequence });
  }
  let cursor = -1;
  for (const state of ['OWNER_EXIT_CONFIRMED','OWNER_RECOVERING','IDLE','NEW_OWNER_STARTING']) {
    cursor = recoveryStateSequence.indexOf(state, cursor + 1);
    if (cursor < 0) fail('WP7_BACKEND_CRASH_RECOVERY_STATE_SEQUENCE_INVALID', 'crash recovery state sequence skipped or reordered a required state', { state, recoveryStateSequence });
  }
  iso(m.oldOwnerExitAtUtc, 'oldOwnerExitAtUtc');
  iso(m.newOwnerAuthorityAtUtc, 'newOwnerAuthorityAtUtc');
  if (Date.parse(m.newOwnerAuthorityAtUtc) < Date.parse(m.oldOwnerExitAtUtc)) fail('WP7_RUNTIME_OWNER_CONCURRENCY_NOT_MEASURED', 'new owner became authoritative before old owner exit', { oldOwnerExitAtUtc: m.oldOwnerExitAtUtc, newOwnerAuthorityAtUtc: m.newOwnerAuthorityAtUtc });
}
function validateSafeModeMatrix(m) {
  const rows = Array.isArray(m.sourceResults) ? m.sourceResults : [];
  const ids = rows.map((row) => row?.sourceId);
  if (rows.length !== SAFE_MODE_SOURCES.length || new Set(ids).size !== SAFE_MODE_SOURCES.length || SAFE_MODE_SOURCES.some((id) => !ids.includes(id))) {
    fail('WP7_SAFE_MODE_NEGATIVE_SOURCE_MATRIX_INCOMPLETE', 'safe-mode source matrix is incomplete', { expected: SAFE_MODE_SOURCES, actual: ids });
  }
  for (const row of rows) {
    object(row, `safeModeSource.${row?.sourceId}`);
    boolean(row.injected, `${row.sourceId}.injected`, true);
    boolean(row.sourcePresenceObserved, `${row.sourceId}.sourcePresenceObserved`, true);
    integer(row.authorityChanges, `${row.sourceId}.authorityChanges`, { min: 0, max: 0 });
    boolean(row.sqliteAuthorityRetained, `${row.sourceId}.sqliteAuthorityRetained`, true);
    string(row.authoritySource, `${row.sourceId}.authoritySource`);
    sha(row.injectionSha256, `${row.sourceId}.injectionSha256`);
  }
  integer(m.totalAuthorityChanges, 'totalAuthorityChanges', { min: 0, max: 0 });
}
function validateCredentialGate(m) {
  boolean(m.illegalTransitionAttempted, 'illegalTransitionAttempted', true);
  boolean(m.illegalTransitionRejected, 'illegalTransitionRejected', true);
  string(m.rejectionReasonCode, 'rejectionReasonCode');
  if (m.rejectionReasonCode !== 'LIFECYCLE_TRANSITION_INVALID') fail('WP7_CREDENTIAL_READY_GATE_NEGATIVE_NOT_INJECTED', 'early-ready rejection did not come from the lifecycle gate', { reasonCode: m.rejectionReasonCode });
  string(m.fromState, 'fromState');
  if (m.fromState !== 'runtime_state_ready') fail('WP7_CREDENTIAL_READY_GATE_NEGATIVE_NOT_INJECTED', 'early-ready injection occurred at the wrong lifecycle state', { fromState: m.fromState });
  if (m.toState !== 'local_ready') fail('WP7_CREDENTIAL_READY_GATE_NEGATIVE_NOT_INJECTED', 'early-ready injection target is incorrect', { toState: m.toState });
  boolean(m.localReadyAtAttempt, 'localReadyAtAttempt', false);
  boolean(m.hydrationCompleteAtAttempt, 'hydrationCompleteAtAttempt', false);
  boolean(m.finalHydrationCompleted, 'finalHydrationCompleted', true);
  boolean(m.finalLocalReady, 'finalLocalReady', true);
  chronological([m.attemptedAtUtc,m.hydrationCompletedAtUtc,m.localReadyAtUtc], ['attemptedAtUtc','hydrationCompletedAtUtc','localReadyAtUtc']);
}
function validateEventGap(m) {
  boolean(m.injectedThroughProductionEventStore, 'injectedThroughProductionEventStore', true);
  boolean(m.detectedByProductionPollPath, 'detectedByProductionPollPath', true);
  boolean(m.privateRecoveryMethodCalledDirectly, 'privateRecoveryMethodCalledDirectly', false);
  boolean(m.snapshotRefetchForced, 'snapshotRefetchForced', true);
  boolean(m.eventGapMetricIncremented, 'eventGapMetricIncremented', true);
  boolean(m.baselineRestored, 'baselineRestored', true);
  integer(m.expectedNextSequence, 'expectedNextSequence', { min: 1 });
  integer(m.oldestAvailableSequence, 'oldestAvailableSequence', { min: m.expectedNextSequence + 1 });
}
function validateBootFailure(m) {
  boolean(m.childProcessSpawned, 'childProcessSpawned', true);
  boolean(m.generatedByFailedApplicationProcess, 'generatedByFailedApplicationProcess', true);
  boolean(m.failureObserved, 'failureObserved', true);
  integer(m.childExitCode, 'childExitCode', { min: 1 });
  string(m.failedPhase, 'failedPhase');
  string(m.reasonCode, 'reasonCode');
  string(m.diagnosticBuildId, 'diagnosticBuildId');
  string(m.diagnosticPath, 'diagnosticPath');
  sha(m.diagnosticSha256, 'diagnosticSha256');
  integer(m.diagnosticProducerPid, 'diagnosticProducerPid', { min: 1 });
  integer(m.parentProbePid, 'parentProbePid', { min: 1 });
  if (m.diagnosticProducerPid === m.parentProbePid) fail('WP7_BOOT_FAILURE_PROBE_NOT_REAL_STARTUP_FAILURE', 'boot failure diagnostic was produced by the parent probe process');
}

function validateProbeSemantics(probeId, measurements) {
  const m = nonEmptyObject(measurements, `${probeId}.measurements`);
  const validators = {
    'first-start': validateFirstStart,
    'controlled-stop': validateControlledStop,
    restart: validateRestart,
    'offline-start': validateOfflineStart,
    'crash-recovery': validateOwnerTimeline,
    'safe-mode-negative': validateSafeModeMatrix,
    'credential-gate-negative': validateCredentialGate,
    'event-gap-recovery': validateEventGap,
    'boot-failure': validateBootFailure
  };
  const validate = validators[probeId];
  if (!validate) fail('WP7_INSTALLED_RUNTIME_PROBE_ID_UNKNOWN', 'no formal semantic validator exists', { probeId });
  validate(m);
  return m;
}

module.exports = {
  REQUIRED_IDENTITY_FIELDS,
  SAFE_MODE_SOURCES,
  validateProbeSemantics
};
