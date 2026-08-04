'use strict';

const core = require('./lib-core');
const {
  isAuthorizedOpenSourceImplementationBranch,
  authorizedOpenSourceImplementationBranchDescription
} = require('../../shared/release/openSourceWorkPackagePolicy');

function isThirdPartyProvenanceMetadataPath(relativePath) {
  const normalized = String(relativePath || '').trim().replace(/\\/gu, '/').replace(/^\.\//u, '');
  if (normalized === 'third_party/provenance.json') return true;
  return /^third_party\/licenses\/(?:[^/]+\.(?:txt|md|license)|LICENSE(?:\.[^/]+)?)$/iu.test(normalized);
}

function classifyScanPath(relativePath, scopePolicy) {
  if (isThirdPartyProvenanceMetadataPath(relativePath)) return 'THIRD_PARTY_PROVENANCE_METADATA';
  return core.classifyScanPath(relativePath, scopePolicy);
}

function scanRepositoryReleaseSurfaces(rootDir = core.REPO_ROOT) {
  const result = core.scanRepositoryReleaseSurfaces(rootDir);
  const scannedFiles = result.scannedFiles.map(item => isThirdPartyProvenanceMetadataPath(item.path)
    ? { ...item, classification: 'THIRD_PARTY_PROVENANCE_METADATA' }
    : item);
  const violations = result.violations.filter(item => !isThirdPartyProvenanceMetadataPath(item.file));
  const metadataCount = scannedFiles.filter(item => item.classification === 'THIRD_PARTY_PROVENANCE_METADATA').length;
  return {
    ...result,
    scannedFiles,
    activeSurfaceCount: scannedFiles.filter(item => item.classification === 'ACTIVE_SOURCE_OR_AUTOMATION').length,
    referenceOnlyCount: scannedFiles.filter(item => item.classification !== 'ACTIVE_SOURCE_OR_AUTOMATION').length,
    metadataCount,
    violationCount: violations.length,
    violations
  };
}

function checkRuntimeTargetGate(options = {}) {
  const legacy = core.checkRuntimeTargetGate(options);
  if (legacy.pass) return legacy;

  const branch = Object.prototype.hasOwnProperty.call(options, 'branch')
    ? options.branch
    : core.currentBranch();
  const targetStage = options.targetStage || process.env.YANCE_TARGET_STAGE || core.CURRENT_STAGE;
  if (targetStage !== core.CURRENT_STAGE || !isAuthorizedOpenSourceImplementationBranch(branch)) return legacy;

  return {
    ...legacy,
    pass: true,
    reasonCode: null,
    errors: [],
    branch,
    targetStage,
    detachedEvidenceAllowed: false,
    authorizationMode: 'SEALED_OPEN_SOURCE_WORK_PACKAGE',
    authorizationDescription: authorizedOpenSourceImplementationBranchDescription()
  };
}

function checkFreezePolicy(options = {}) {
  const branch = Object.prototype.hasOwnProperty.call(options, 'branch')
    ? options.branch
    : core.currentBranch();
  if (!isAuthorizedOpenSourceImplementationBranch(branch)) return core.checkFreezePolicy(options);

  const historical = core.checkFreezePolicy({
    ...options,
    branch: core.ALLOWED_BRANCH
  });
  const runtimeTargetGate = checkRuntimeTargetGate({
    ...options,
    branch
  });
  const errors = [...historical.errors, ...runtimeTargetGate.errors];
  return {
    ...historical,
    pass: historical.pass && runtimeTargetGate.pass,
    reasonCode: historical.pass
      ? runtimeTargetGate.reasonCode
      : historical.reasonCode,
    errors,
    details: {
      ...historical.details,
      runtimeTargetGate,
      historicalFreezeBranch: core.ALLOWED_BRANCH,
      implementationAuthorizationSeparated: true
    }
  };
}

function checkOverlayInstallerPatterns(rootDir = core.REPO_ROOT) {
  const scan = scanRepositoryReleaseSurfaces(rootDir);
  const violations = scan.violations.filter(item => item.reasonCode === 'WP0_OVERLAY_INSTALLER_PATTERN_DETECTED');
  return {
    id: 'overlay-installer-pattern-scan.test',
    pass: violations.length === 0,
    reasonCode: violations.length ? 'WP0_OVERLAY_INSTALLER_PATTERN_DETECTED' : null,
    errors: violations,
    details: { ...scan, violationCount: violations.length, violations }
  };
}

function checkForbiddenHotfixEntrypoints(rootDir = core.REPO_ROOT) {
  const scan = scanRepositoryReleaseSurfaces(rootDir);
  const violations = scan.violations.filter(item => item.reasonCode !== 'WP0_OVERLAY_INSTALLER_PATTERN_DETECTED');
  const commandGate = require('node:path').resolve(rootDir) === core.REPO_ROOT
    ? core.checkProtectedCommandPolicy()
    : { pass: true, errors: [], reasonCode: null };
  const repositoryScope = require('node:path').resolve(rootDir) === core.REPO_ROOT
    ? core.checkRepositoryScope()
    : { pass: true, errors: [], reasonCode: null };
  const errors = [...violations, ...commandGate.errors, ...repositoryScope.errors];
  return {
    id: 'forbidden-hotfix-entrypoints.test',
    pass: errors.length === 0,
    reasonCode: errors.length
      ? (violations.length ? 'WP0_FORBIDDEN_HOTFIX_ENTRYPOINT' : commandGate.reasonCode || repositoryScope.reasonCode)
      : null,
    errors,
    details: {
      enumerationMethod: scan.enumerationMethod,
      trackedFileCount: scan.trackedFileCount,
      scannedFileCount: scan.scannedFileCount,
      activeSurfaceCount: scan.activeSurfaceCount,
      referenceOnlyCount: scan.referenceOnlyCount,
      metadataCount: scan.metadataCount,
      scannedFiles: scan.scannedFiles,
      violationCount: violations.length,
      violations,
      commandGate,
      repositoryScope
    }
  };
}

function runAllChecks(options = {}) {
  const rootDir = options.rootDir || core.REPO_ROOT;
  return [
    checkFreezePolicy({
      targetStage: options.targetStage || core.CURRENT_STAGE,
      branch: Object.prototype.hasOwnProperty.call(options, 'branch') ? options.branch : core.currentBranch(),
      evidenceMode: options.evidenceMode === true,
      evidenceSourceCommit: options.evidenceSourceCommit || null,
      baselineAnchorOptions: options.baselineAnchorOptions || null
    }),
    checkOverlayInstallerPatterns(rootDir),
    core.checkUnsignedModePolicy(),
    checkForbiddenHotfixEntrypoints(rootDir)
  ];
}

function verifyWp0Gate(options = {}) {
  const checks = runAllChecks({
    targetStage: options.targetStage || core.CURRENT_STAGE,
    ...(Object.prototype.hasOwnProperty.call(options, 'branch') ? { branch: options.branch } : {}),
    evidenceMode: options.evidenceMode === true,
    evidenceSourceCommit: options.evidenceSourceCommit || null,
    baselineAnchorOptions: options.baselineAnchorOptions || null
  });
  const failed = checks.filter(item => !item.pass);
  return {
    schemaVersion: 2,
    gateId: `YANCE-S${core.CURRENT_STAGE}-WP0-LOCAL-GATE`,
    status: failed.length ? 'FAIL' : 'PASS',
    reasonCode: failed.length ? failed[0].reasonCode : null,
    targetStage: options.targetStage || core.CURRENT_STAGE,
    sourceCommit: core.currentCommit(),
    branch: Object.prototype.hasOwnProperty.call(options, 'branch') ? options.branch : core.currentBranch(),
    requiredCheckCount: checks.length,
    passedCheckCount: checks.filter(item => item.pass).length,
    failedCheckCount: failed.length,
    failedReasonCodes: failed.map(item => item.reasonCode).filter(Boolean),
    checks
  };
}

module.exports = {
  ...core,
  isThirdPartyProvenanceMetadataPath,
  classifyScanPath,
  scanRepositoryReleaseSurfaces,
  checkRuntimeTargetGate,
  checkFreezePolicy,
  checkOverlayInstallerPatterns,
  checkForbiddenHotfixEntrypoints,
  runAllChecks,
  verifyWp0Gate
};
