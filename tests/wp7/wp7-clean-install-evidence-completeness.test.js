'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateCleanInstallEvidence } = require('../../tools/wp7/lib');
const { isFinalExecution, load } = require('./final-phase-helpers');

test('wp7-clean-install-evidence-completeness.test', () => {
  if (isFinalExecution()) {
    const document = load('evidence/wp7/clean-install.json');
    assert.equal(validateCleanInstallEvidence(document).status, 'PASS');
    return;
  }
  const document = { finalInstallationMode: 'CLEAN_INSTALL', legacyInstallationsDetected: 1, legacyInstallationsUninstalled: 1, oldProcessesDetected: 0, oldProcessesTerminated: 0, remainingResidueCount: 0, legacyTestDataMigrationAttempted: false, legacyTestVersionRollbackAttempted: false, installerSha256VerifiedImmediatelyBeforeInstall: true, firstStartFreshInitialization: true, status: 'PASS', reasonCodes: [] };
  assert.equal(validateCleanInstallEvidence(document).status, 'PASS');
});
