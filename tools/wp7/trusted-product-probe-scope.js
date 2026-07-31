'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { FORMAL_PROBE_IDS, assertFormalProbeIdSet } = require('../../shared/wp7/formalProbeIds');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SCOPE_RELATIVE_PATH = 'governance/wp7/formal-trusted-product-probe-scope.json';

function readFormalProbeScope(repoRoot = REPO_ROOT) {
  const scopePath = path.join(path.resolve(repoRoot), ...SCOPE_RELATIVE_PATH.split('/'));
  const document = JSON.parse(fs.readFileSync(scopePath, 'utf8'));
  if (document.schemaVersion !== 1 || document.documentType !== 'WP7_FORMAL_TRUSTED_PRODUCT_PROBE_SCOPE' || document.requiredProbeCount !== FORMAL_PROBE_IDS.length || document.authorityModule !== 'shared/wp7/formalProbeIds.js') {
    const error = new Error('formal trusted-product probe scope governance document is invalid');
    error.reasonCode = 'WP7_TRUSTED_PRODUCT_PROBE_ID_SET_INCONSISTENT';
    error.details = { scopePath };
    throw error;
  }
  assertFormalProbeIdSet(document.formalProbeIds);
  return Object.freeze({ scopePath, document, formalProbeIds: FORMAL_PROBE_IDS });
}

function createTrustedProductProbeBlocker(options = {}) {
  const scope = readFormalProbeScope(options.repoRoot || REPO_ROOT);
  const blockingReasonCodes = Array.isArray(options.blockingReasonCodes) ? options.blockingReasonCodes.map(String) : [];
  return {
    schemaVersion: 2,
    documentType: 'WP7_REAL_TRUSTED_PRODUCT_NINE_PROBE_EXECUTION_BLOCKER',
    generatedAtUtc: String(options.generatedAtUtc || new Date().toISOString()),
    stage: '6.4.5.9',
    workPackage: 'WP7',
    phase: 'CONVERGENCE_PRE_REVIEW_REVISION',
    sourceCommit: String(options.sourceCommit || ''),
    sourceTree: String(options.sourceTree || ''),
    status: 'NOT_EXECUTED',
    completed: 0,
    required: FORMAL_PROBE_IDS.length,
    formalProbeAuthority: scope.document.authorityModule,
    formalProbeScopePath: SCOPE_RELATIVE_PATH,
    formalProbeIds: [...FORMAL_PROBE_IDS],
    blockingReasonCodes,
    requiredElectronArchive: options.requiredElectronArchive || null,
    networkAcquisitionAttempt: options.networkAcquisitionAttempt || null,
    inputAvailability: {
      electronArchive: options.electronArchiveAvailable === true,
      packagedProductExecutable: options.packagedProductExecutableAvailable === true,
      packagedPayloadRoot: options.packagedPayloadRootAvailable === true,
      packagedResourcesRoot: options.packagedResourcesRootAvailable === true
    },
    governanceConsequences: {
      revisionCandidateStatus: 'NOT_FORMED',
      preAcceptanceIssued: false,
      finalPackagingAuthorized: false,
      finalInstallerGenerated: false,
      formalWindowsCleanInstallPerformed: false,
      finalWindowsTestsExecuted: false,
      finalAcceptanceStatus: 'NOT_ACCEPTED'
    },
    prohibitionsPreserved: [
      'WP7_PREACCEPTED_FOR_FINAL_PACKAGING_NOT_ISSUED',
      'WP7_ACCEPTED_NOT_ISSUED',
      'FINAL_PACKAGING_NOT_GENERATED',
      'FORMAL_WINDOWS_CLEAN_INSTALL_NOT_PERFORMED'
    ]
  };
}

module.exports = { SCOPE_RELATIVE_PATH, createTrustedProductProbeBlocker, readFormalProbeScope };
