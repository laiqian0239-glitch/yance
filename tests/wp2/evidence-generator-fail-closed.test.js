'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { validateLifecycle, validateBoundary, validateCommands, validateApi } = require('../../tools/wp2/evidence-validation');
const { buildCommandPathInventory } = require('../../tools/wp2/command-path-inventory');

const ROOT = path.resolve(__dirname, '../..');
const lifecycleNames = [
  'normal-sigterm', 'ignore-sigterm-force-kill', 'real-missing-exec-spawn-error',
  'exit-before-control-callback', 'exit-during-control-callback', 'exit-before-running-transition',
  'async-error-during-start', 'error-then-exit', 'sigkill-failure-retains-owner',
  'starting-restart-app', 'running-restart-app', 'restart-app-stop-failure'
];

function validApiEvidence() {
  return {
    http: {
      currentTokenStatus: 200,
      wrongTokenStatus: 401,
      newTokenStatus: 200,
      oldTokenAfterRestartStatus: 401
    },
    webSocket: {
      currentTokenStatus: 101,
      wrongTokenStatus: 401,
      newTokenStatus: 101,
      oldTokenAfterRestartStatus: 401
    },
    rotationObserved: true,
    environmentTokenPresent: false,
    argvTokenPresent: false,
    tokenOrTokenHashLeakCount: 0,
    productionAuthModuleExecuted: true,
    actualAuthenticatedRuntimeChainExecuted: true,
    productionDesktopEntryExecuted: true,
    productionServerEntryExecuted: true,
    productionHttpAuthExecuted: true,
    productionWebSocketAuthExecuted: true,
    productionDiagnosticsPathExecuted: true,
    productionLoggingPathExecuted: true,
    productionPersistencePathsExecuted: true,
    mutationDetection: {
      status: 'PASS',
      reasonCode: 'WP2_API_SESSION_SECRET_LEAK_DETECTED',
      requiredTest: { exitCode: 1, reasonCodeObserved: true },
      evidenceGenerator: { exitCode: 1, reasonCodeObserved: true }
    }
  };
}

test('evidence validation fails nonzero-equivalent on STARTING race or dead-child session', () => {
  const scenarios = lifecycleNames.map(name => ({
    name,
    stopResult: name === 'sigkill-failure-retains-owner' ? { stopped: false } : undefined,
    ownerRetained: name === 'sigkill-failure-retains-owner' || name === 'restart-app-stop-failure',
    relaunchCalled: false,
    exitCalled: false
  }));
  scenarios.find(row => row.name === 'exit-before-control-callback').forbiddenCrashedToRunning = true;
  assert.throws(
    () => validateLifecycle({ allOrphanChecksPass: true, scenarios }),
    error => error.reasonCode === 'WP2_STARTING_RACE_REGRESSION'
  );
});

test('evidence validation fails on business settings writable or an unregistered IPC authority path', () => {
  assert.throws(
    () => validateBoundary({
      violationCount: 0,
      legacyElectronBusinessRuntimePresent: false,
      desktopWritableSettings: ['windowX', 'windowY', 'windowWidth', 'windowHeight', 'safeMode'],
      forbiddenBusinessWritableSettings: ['safeMode'],
      frontendSettingsMigration: { status: 'PASS' }
    }),
    error => error.reasonCode === 'WP2_BUSINESS_SETTING_WRITABLE'
  );
  const rows = buildCommandPathInventory(ROOT);
  const store = rows.find(row => row.entryKind === 'ELECTRON_IPC' && row.channelOrCommandName.startsWith('store:'));
  store.forwardingOnly = false;
  assert.throws(() => validateCommands(rows), error => error.reasonCode === 'WP2_DUAL_COMMAND_AUTHORITY');
});

test('evidence validation fails closed when any production runtime chain field is missing', () => {
  const api = validApiEvidence();
  api.productionServerEntryExecuted = false;
  assert.throws(() => validateApi(api), error => error.reasonCode === 'WP2_PRODUCTION_RUNTIME_CHAIN_INCOMPLETE');
});

test('evidence validation reports the leak reason code when production surfaces contain session material', () => {
  const api = validApiEvidence();
  api.tokenOrTokenHashLeakCount = 1;
  assert.throws(() => validateApi(api), error => error.reasonCode === 'WP2_API_SESSION_SECRET_LEAK_DETECTED');
});

test('evidence validation rejects fixture-only or incomplete mutation claims', () => {
  const api = validApiEvidence();
  api.mutationDetection.evidenceGenerator.exitCode = 0;
  assert.throws(() => validateApi(api), error => error.reasonCode === 'WP2_SERVER_MUTATION_GATE_FAILED');
});
