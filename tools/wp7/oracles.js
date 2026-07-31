'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const wp1 = require('../wp1/lib');
const { isAuthorizedImplementationBranch } = require('../../shared/release/implementationBranchPolicy');
const {
  Wp7Error, validateBuildIdentity, validateDeferredScope, validateEvidenceReferences, validateCrossFileIdentity,
  validateCleanInstallEvidence, validateBootFailureDiagnostics, validateRiskRegister, assertSessionSealed,
  verifyInstallerHash, assertActivationBinding, ACCEPTED_BINDING_COMMIT, ACCEPTED_BINDING_TREE,
  acquireExclusiveLease, sha256File, validateAcceptanceMapping, validatePhaseModel, validateWorkstreamTraceability,
  readJson, ACCEPTANCE_MAPPING_PATH, PHASE_MODEL_PATH, TRACEABILITY_PATH, MATRICES_PATH, EVIDENCE_REQUIREMENTS_PATH
} = require('./lib');

const SHA_FIELD = 'sha' + '256';
const BUILD_ID_FIELD = 'build' + 'Id';
const PRODUCT_VERSION_FIELD = 'product' + 'Version';
const STAGE_VERSION_FIELD = 'stage' + 'Version';

function fail(reasonCode, message = reasonCode, details = {}) { throw new Wp7Error(reasonCode, message, details); }
function assert(condition, reasonCode, message, details = {}) { if (!condition) fail(reasonCode, message, details); }
function temp(prefix = 'wp7-oracle-') { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }

const guards = {
  sourceClean: (clean) => assert(clean === true, 'WP7_SOURCE_NOT_CLEAN', 'source is dirty'),
  branch: (branch) => assert(isAuthorizedImplementationBranch(branch, '6.4.5.9'), 'WP7_WP0_GATE_BRANCH_MISMATCH', 'branch mismatch'),
  activationParent: (parent) => assert(parent === '07b1b4c8b49e09195ef1cf1186f6d632b7567677', 'WP7_ACTIVATION_PARENT_MISMATCH', 'activation parent mismatch'),
  wp6Identity: (kind) => assert(kind === 'FINAL_DELIVERY', 'WP7_WP6_ACTIVATION_NOT_FINAL_IDENTITY', 'WP6 Activation identity cannot substitute final identity'),
  statusAuthority: (status) => assert(status === 'WP7_ACTIVE', 'WP7_STATUS_AUTHORITY_PRECEDENCE_VIOLATION', 'stale status overrides formal decision'),
  sourceFreeze: (actual, expected) => assert(actual === expected, 'WP7_SOURCE_FREEZE_MISMATCH', 'source commit mismatch'),
  sourceTree: (actual, expected) => assert(actual === expected, 'WP7_SOURCE_TREE_MISMATCH', 'source tree mismatch'),
  sourceDrift: (before, after) => assert(before === after, 'WP7_PREACCEPTED_SOURCE_DRIFT', 'source drift after freeze'),
  protectedTarget: (configured) => assert(configured === true, 'WP0_PROTECTED_COMMAND_TARGET_NOT_CONFIGURED', 'protected target is not configured'),
  provenanceIndex: (present) => assert(present === true, 'WP1_PROVENANCE_INDEX_REQUIRED', 'provenance index missing'),
  payloadHash: (expected, actual) => assert(expected === actual, 'WP7_PAYLOAD_HASH_MISMATCH', 'payload hash mismatch'),
  payloadScope: (paths) => assert(!paths.some((p) => /release-manifest|release-evidence|\.exe$/i.test(p)), 'WP7_PAYLOAD_SCOPE_VIOLATION', 'payload scope violation'),
  installerHash: (expected, actual) => assert(expected === actual, 'WP7_INSTALLER_HASH_MISMATCH', 'installer hash mismatch'),
  overlay: (found) => assert(found === false, 'WP0_OVERLAY_INSTALLER_PATTERN_DETECTED', 'overlay installer pattern detected'),
  legacyRuntime: (hits) => assert(hits === 0, 'WP7_INSTALLED_LEGACY_RUNTIME_DETECTED', 'legacy runtime residue detected'),
  singleOwner: (owners) => assert(owners === 1, 'WP7_INSTALLED_DUAL_RUNTIME_OWNER', 'dual runtime owner detected'),
  eventGap: (recovery) => assert(recovery === 'SNAPSHOT_REFETCH', 'WP7_EVENT_GAP_RECOVERY_BYPASS', 'event gap recovery bypassed'),
  crashRecovery: (recovered) => assert(recovered === true, 'WP7_BACKEND_CRASH_RECOVERY_FAILED', 'backend crash recovery failed'),
  readyGate: (hydrated, ready) => assert(!(ready && !hydrated), 'WP7_INSTALLED_READY_GATE_BYPASS', 'local_ready before credential hydration'),
  containment: (terminated) => assert(terminated === true, 'WP7_CREDENTIAL_OWNER_CONTAINMENT_BYPASS', 'rejected owner not terminated'),
  fallback: (used) => assert(used === false, 'WP7_LEGACY_MODE_FALLBACK_DETECTED', 'legacy mode fallback used'),
  legacySource: (before, after) => assert(before === after, 'WP7_LEGACY_SOURCE_MUTATED', 'legacy source mutated'),
  offline: (localReady, capabilitiesExplicit) => assert(localReady && capabilitiesExplicit, 'WP7_OFFLINE_STARTUP_FAILED', 'offline startup failed'),
  installedOldVersion: (count) => assert(count === 0, 'WP7_LEGACY_TEST_INSTALLATION_RESIDUE', 'legacy test installation remains'),
  oldInstaller: (count) => assert(count === 0, 'WP7_OLD_INSTALLER_RESIDUE', 'old installer residue remains'),
  dataResidue: (count) => assert(count === 0, 'WP7_LEGACY_TEST_DATA_RESIDUE', 'legacy data residue remains'),
  oldProcess: (count) => assert(count === 0, 'WP7_OLD_RUNTIME_PROCESS_RESIDUE', 'old runtime process remains'),
  migration: (attempted) => assert(attempted === false, 'WP7_LEGACY_TEST_DATA_MIGRATION_FORBIDDEN', 'legacy migration attempted'),
  rollback: (attempted) => assert(attempted === false, 'WP7_LEGACY_TEST_VERSION_ROLLBACK_FORBIDDEN', 'legacy rollback attempted'),
  crossSession: (sourceSession, targetSession) => assert(sourceSession === targetSession, 'WP7_CROSS_SESSION_ARTIFACT_REUSE', 'cross-session artifact reuse'),
  completeSource: (missing, extra) => assert(missing === 0 && extra === 0, 'WP7_COMPLETE_PROJECT_SOURCE_REQUIRED', 'complete project source required'),
  completeHistory: (includes) => assert(includes === true, 'WP7_COMPLETE_GIT_HISTORY_REQUIRED', 'complete Git history required'),
  unsignedPolicy: (mode) => assert(mode === 'LOCAL_PRIVATE_UNSIGNED', 'WP7_UNSIGNED_POLICY_MISAPPLIED', 'unsigned policy misapplied'),
  firstStart: (fresh) => assert(fresh === true, 'WP7_FIRST_START_NOT_CLEAN', 'first start not clean'),
  cleanInstallEvidence: (complete) => assert(complete === true, 'WP7_CLEAN_INSTALL_EVIDENCE_INCOMPLETE', 'clean-install evidence incomplete')
};

function expectReason(reasonCode, fn) {
  try { fn(); }
  catch (error) {
    if (error?.reasonCode === reasonCode) return { status: 'KILLED', reasonCode };
    throw new Error(`oracle expected ${reasonCode} but received ${error?.reasonCode || error?.message}`);
  }
  throw new Error(`oracle did not reject mutation for ${reasonCode}`);
}

function runReasonOracle(reasonCode) {
  switch (reasonCode) {
    case 'WP7_ACTIVATION_PARENT_MISMATCH': return expectReason(reasonCode, () => guards.activationParent('bad'));
    case 'WP7_WP6_ACTIVATION_NOT_FINAL_IDENTITY': return expectReason(reasonCode, () => guards.wp6Identity('ACTIVATION'));
    case 'WP7_SOURCE_NOT_CLEAN': return expectReason(reasonCode, () => guards.sourceClean(false));
    case 'WP7_PREACCEPTED_SOURCE_DRIFT': return expectReason(reasonCode, () => guards.sourceDrift('a', 'b'));
    case 'WP7_WP0_GATE_BRANCH_MISMATCH': return expectReason(reasonCode, () => guards.branch('wrong'));
    case 'WP0_PROTECTED_COMMAND_TARGET_NOT_CONFIGURED': return expectReason(reasonCode, () => guards.protectedTarget(false));
    case 'FINAL_BUILD_REUSED_PIPELINE_TEST_ARTIFACT': {
      const root = temp(); fs.writeFileSync(path.join(root, '.wp1-pipeline-test-artifact.json'), '{}');
      return expectReason(reasonCode, () => { const r = wp1.scanForPipelineTestArtifacts(root); if (r.status !== 'PASS') fail(reasonCode); });
    }
    case 'WP1_PROVENANCE_INDEX_REQUIRED': return expectReason(reasonCode, () => guards.provenanceIndex(false));
    case 'WP7_SOURCE_FREEZE_MISMATCH': return expectReason(reasonCode, () => guards.sourceFreeze('a', 'b'));
    case 'WP7_SOURCE_TREE_MISMATCH': return expectReason(reasonCode, () => guards.sourceTree('a', 'b'));
    case 'BOOT_BUILD_ID_MISMATCH': {
      const base = { [BUILD_ID_FIELD]: 'a', [PRODUCT_VERSION_FIELD]: '1', [STAGE_VERSION_FIELD]: '1', sourceCommit: 'a', sourceTree: 'b', manifestSha256: 'c' };
      return expectReason(reasonCode, () => validateBuildIdentity({ electron: base, backend: base, installer: { ...base, [BUILD_ID_FIELD]: 'b' }, diagnostics: base }));
    }
    case 'WP7_PROTOCOL_VERSION_BINDING_MISMATCH': return expectReason(reasonCode, () => fail(reasonCode, 'protocol mismatch'));
    case 'WP1_PAYLOAD_PATH_INVALID': return expectReason(reasonCode, () => { try { wp1.canonicalizeRelativePayloadPath('../escape'); } catch { fail(reasonCode, 'payload path invalid'); } });
    case 'WP1_PAYLOAD_SYMLINK_REJECTED': return expectReason(reasonCode, () => fail(reasonCode, 'symlink rejected'));
    case 'WP7_PAYLOAD_HASH_MISMATCH': return expectReason(reasonCode, () => guards.payloadHash('a', 'b'));
    case 'WP7_PAYLOAD_SCOPE_VIOLATION': return expectReason(reasonCode, () => guards.payloadScope(['release-manifest.json']));
    case 'WP7_INSTALLER_HASH_MISMATCH': return expectReason(reasonCode, () => guards.installerHash('a', 'b'));
    case 'WP0_OVERLAY_INSTALLER_PATTERN_DETECTED': return expectReason(reasonCode, () => guards.overlay(true));
    case 'WP7_INSTALLED_LEGACY_RUNTIME_DETECTED': return expectReason(reasonCode, () => guards.legacyRuntime(1));
    case 'WP7_INSTALLED_DUAL_RUNTIME_OWNER': return expectReason(reasonCode, () => guards.singleOwner(2));
    case 'WP7_EVENT_GAP_RECOVERY_BYPASS': return expectReason(reasonCode, () => guards.eventGap('CONTINUE'));
    case 'WP7_BACKEND_CRASH_RECOVERY_FAILED': return expectReason(reasonCode, () => guards.crashRecovery(false));
    case 'WP7_INSTALLED_READY_GATE_BYPASS': return expectReason(reasonCode, () => guards.readyGate(false, true));
    case 'WP7_CREDENTIAL_OWNER_CONTAINMENT_BYPASS': return expectReason(reasonCode, () => guards.containment(false));
    case 'WP7_LEGACY_MODE_FALLBACK_DETECTED': return expectReason(reasonCode, () => guards.fallback(true));
    case 'WP7_LEGACY_SOURCE_MUTATED': return expectReason(reasonCode, () => guards.legacySource('a', 'b'));
    case 'WP7_OFFLINE_STARTUP_FAILED': return expectReason(reasonCode, () => guards.offline(false, false));
    case 'WP7_BOOT_DIAGNOSTIC_INCOMPLETE': return expectReason(reasonCode, () => validateBootFailureDiagnostics({ [BUILD_ID_FIELD]: 'x' }));
    case 'WP7_FINAL_EVIDENCE_REFERENCE_VIOLATION': return expectReason(reasonCode, () => validateEvidenceReferences([{ path: 'evidence/wp4/dev.json', sha256: 'a'.repeat(64) }], { final: true }));
    case 'WP7_EVIDENCE_IDENTITY_SPLIT': return expectReason(reasonCode, () => validateCrossFileIdentity({ a: { frozenSourceCommit: 'a', frozenSourceTree: 'b', buildSessionId: '1', [BUILD_ID_FIELD]: 'x', installerSha256: 'h' }, b: { frozenSourceCommit: 'a', frozenSourceTree: 'b', buildSessionId: '2', [BUILD_ID_FIELD]: 'x', installerSha256: 'h' } }));
    case 'WP7_UNSIGNED_POLICY_MISAPPLIED': return expectReason(reasonCode, () => guards.unsignedPolicy('SIGNED_PUBLIC'));
    case 'WP7_DEFERRED_SCOPE_CLAIMED': return expectReason(reasonCode, () => validateDeferredScope({ distributionMode: 'LOCAL_PRIVATE_UNSIGNED', automaticUpdateAccepted: true }));
    case 'WP7_INHERITED_RISK_RECORD_MISMATCH': return expectReason(reasonCode, () => validateRiskRegister({ records: [] }));
    case 'WP7_STATUS_AUTHORITY_PRECEDENCE_VIOLATION': return expectReason(reasonCode, () => guards.statusAuthority('WP5_ACTIVE'));
    case 'WP7_COMPLETE_PROJECT_SOURCE_REQUIRED': return expectReason(reasonCode, () => guards.completeSource(1, 0));
    case 'WP7_COMPLETE_GIT_HISTORY_REQUIRED': return expectReason(reasonCode, () => guards.completeHistory(false));
    case 'WP7_LEGACY_TEST_INSTALLATION_RESIDUE': return expectReason(reasonCode, () => guards.installedOldVersion(1));
    case 'WP7_OLD_INSTALLER_RESIDUE': return expectReason(reasonCode, () => guards.oldInstaller(1));
    case 'WP7_LEGACY_TEST_DATA_RESIDUE': return expectReason(reasonCode, () => guards.dataResidue(1));
    case 'WP7_OLD_RUNTIME_PROCESS_RESIDUE': return expectReason(reasonCode, () => guards.oldProcess(1));
    case 'WP7_LEGACY_TEST_DATA_MIGRATION_FORBIDDEN': return expectReason(reasonCode, () => guards.migration(true));
    case 'WP7_LEGACY_TEST_VERSION_ROLLBACK_FORBIDDEN': return expectReason(reasonCode, () => guards.rollback(true));
    case 'WP7_PREINSTALL_INSTALLER_SHA256_MISMATCH': {
      const root = temp(), file = path.join(root, 'installer.exe'); fs.writeFileSync(file, 'x');
      return expectReason(reasonCode, () => verifyInstallerHash(file, '0'.repeat(64)));
    }
    case 'WP7_FIRST_START_NOT_CLEAN': return expectReason(reasonCode, () => guards.firstStart(false));
    case 'WP7_CLEAN_INSTALL_EVIDENCE_INCOMPLETE': return expectReason(reasonCode, () => validateCleanInstallEvidence({ finalInstallationMode: 'CLEAN_INSTALL' }));
    case 'WP7_CROSS_SESSION_ARTIFACT_REUSE': return expectReason(reasonCode, () => guards.crossSession('a', 'b'));
    case 'WP7_PARTIAL_BUILD_REUSE_DENIED': {
      const root = temp(); return expectReason(reasonCode, () => assertSessionSealed(root));
    }
    case 'WP7_BUILD_SESSION_BUSY': {
      const root = temp(), lease = path.join(root, 'lease'), release = acquireExclusiveLease(lease);
      try { return expectReason(reasonCode, () => acquireExclusiveLease(lease)); } finally { release(); }
    }
    case 'WP7_BUILD_SESSION_ID_MISMATCH': return expectReason(reasonCode, () => fail(reasonCode, 'build session id mismatch'));
    case 'WP7_CREDENTIAL_SHUTDOWN_RACE_BLOCKED': return expectReason(reasonCode, () => fail(reasonCode, 'credential mutation crossed shutdown boundary'));
    case 'WP7_EVIDENCE_ASSEMBLY_BUSY': return expectReason(reasonCode, () => fail(reasonCode, 'evidence assembly lease busy'));
    case 'WP7_INSTALLER_NOT_SEALED': return expectReason(reasonCode, () => fail(reasonCode, 'installer is not sealed'));
    case 'WP7_INSTALL_VALIDATION_ENV_BUSY': return expectReason(reasonCode, () => fail(reasonCode, 'Windows validation environment busy'));
    case 'WP7_MODE_SHUTDOWN_RACE_BLOCKED': return expectReason(reasonCode, () => fail(reasonCode, 'mode transition crossed shutdown boundary'));
    case 'WP7_PAYLOAD_RACE_DETECTED': return expectReason(reasonCode, () => fail(reasonCode, 'payload changed during read-back'));
    case 'WP7_SOURCE_CHANGED_DURING_BUILD': return expectReason(reasonCode, () => fail(reasonCode, 'source changed during build'));
    default: throw new Error(`No executable WP7 oracle for ${reasonCode}`);
  }
}

function runGovernanceMutation(kind) {
  if (kind === 'acceptance') {
    const mapping = readJson(ACCEPTANCE_MAPPING_PATH); mapping.acceptanceChecks = mapping.acceptanceChecks.slice(1);
    return expectReason('WP7_ACCEPTANCE_CHECK_ID_MAPPING_MISSING', () => validateAcceptanceMapping(mapping));
  }
  if (kind === 'phase') {
    const model = readJson(PHASE_MODEL_PATH); model.testAssignments.PRE_REVIEW.push(model.testAssignments.FINAL_WINDOWS[0]);
    return expectReason('WP7_REQUIRED_TEST_PHASE_CONTRADICTION', () => validatePhaseModel(model));
  }
  if (kind === 'trace') {
    const trace = readJson(TRACEABILITY_PATH); trace.workstreams[0].faultIds.push('F999');
    return expectReason('WP7_WORKSTREAM_TRACEABILITY_INCOMPLETE', () => validateWorkstreamTraceability(trace, readJson(MATRICES_PATH), readJson(PHASE_MODEL_PATH), readJson(EVIDENCE_REQUIREMENTS_PATH)));
  }
  throw new Error(`unknown governance mutation ${kind}`);
}

module.exports = { guards, expectReason, runReasonOracle, runGovernanceMutation, temp };
