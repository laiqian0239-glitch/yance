'use strict';

const EXPECTED_ROUND11_PRELAUNCH_TESTS = 136;

const ROUND11_PRELAUNCH_TEST_FILES = Object.freeze([
  'tests/uat/round11ConversationCenterUi.test.js',
  'tests/uat/fix6dWindowsUiPublicContract.test.js',
  'tests/uat/fix6dWorkspaceEmptyStateContract.test.js',
  'tests/uat/fix6dScreenshotMatrixGate.test.js',
  'tests/uat/fix6dRouteScrollStateAuthority.test.js',
  'tests/uat/layoutDiagnosticsRouteAuthority.test.js',
  'tests/desktop-fixes/machine-uat-closure.test.js',
  'backend/tests/f25WindowsUatRepairBatch15.test.js',
  'tests/runtime-delivery/identity-bound-source-archive.test.js',
  'tests/runtime-delivery/create-identity-bound-source-candidate.test.js',
  'tests/runtime-delivery/round11-windows-ui-uat-package.test.js',
  'backend/tests/personaBrain/candidateBinding.test.js',
  'backend/tests/platformProductionReadinessAuthority.test.js',
  'backend/tests/facebookBusinessSuiteReconciliationRegression.test.js',
  'backend/tests/facebookProductionReadinessRegression.test.js',
  'backend/tests/telegramHistorySyncRegression.test.js',
  'tests/uat/exportPlatformProductionEvidence.test.js'
]);

module.exports = {
  EXPECTED_ROUND11_PRELAUNCH_TESTS,
  ROUND11_PRELAUNCH_TEST_FILES
};
