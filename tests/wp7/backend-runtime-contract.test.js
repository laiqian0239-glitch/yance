'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {
  M1_STARTUP_CONTRACT_VERSION,
  STARTUP_PROTOCOL_VERSION,
  STARTUP_FRAME_PROTOCOL_VERSION,
  READY_PROTOCOL_VERSION,
  validateStartupFrame
} = require('../../electron/desktopHost/startupProtocol');

function validFrame(overrides = {}) {
  return {
    protocolVersion: STARTUP_PROTOCOL_VERSION,
    startupFrameProtocolVersion: STARTUP_FRAME_PROTOCOL_VERSION,
    m1StartupContractVersion: M1_STARTUP_CONTRACT_VERSION,
    readyProtocolVersion: READY_PROTOCOL_VERSION,
    startupAttemptId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    startupNonce: '11111111-1111-4111-8111-111111111111',
    apiSessionToken: 't'.repeat(43),
    backendPid: process.pid,
    resourcesPath: path.join(__dirname, '..', '..', 'resources'),
    expectedBuildId: 'YANCE-test',
    manifestSha256: 'a'.repeat(64),
    appRoot: path.resolve(__dirname, '..', '..'),
    backendEntryPath: path.resolve(__dirname, '..', '..', 'backend', 'desktopHostedEntry.js'),
    nodeRuntimeExecutablePath: process.execPath,
    runtimeMode: 'desktop-hosted',
    apiBaseUrl: 'http://127.0.0.1:27632',
    releaseManifestPath: path.resolve(__dirname, '..', '..', 'resources', 'release-manifest.json'),
    releaseManifestSha256Path: path.resolve(__dirname, '..', '..', 'resources', 'release-manifest.sha256'),
    logRoot: path.resolve(__dirname, '..', '..', 'logs'),
    backendLogPath: path.resolve(__dirname, '..', '..', 'logs', 'backend.jsonl'),
    desktopLogPath: path.resolve(__dirname, '..', '..', 'logs', 'desktop.jsonl'),
    nodeModulesPath: path.resolve(__dirname, '..', '..', 'node_modules'),
    backendSessionId: '22222222-2222-4222-8222-222222222222',
    fd6PipeInstanceId: '33333333-3333-4333-8333-333333333333',
    backendPort: 27632,
    readyTimeoutMs: 30000,
    ...overrides
  };
}

test('M1 runtime contract fields are mandatory in DesktopHost startup frame', () => {
  for (const field of ['startupAttemptId', 'appRoot', 'backendEntryPath', 'nodeRuntimeExecutablePath', 'runtimeMode', 'apiBaseUrl', 'releaseManifestPath', 'releaseManifestSha256Path', 'logRoot', 'backendLogPath', 'backendSessionId', 'fd6PipeInstanceId']) {
    assert.throws(() => validateStartupFrame(validFrame({ [field]: '' })), error => {
      assert.equal(error.reasonCode, 'M1_RUNTIME_CONTRACT_INVALID');
      assert.equal(error.details.field, field);
      return true;
    });
  }
});

test('M1 runtime contract rejects unsupported contract version and invalid port or timeout', () => {
  assert.throws(() => validateStartupFrame(validFrame({ m1StartupContractVersion: 999 })), error => error.reasonCode === 'M1_RUNTIME_CONTRACT_VERSION_MISMATCH');
  assert.throws(() => validateStartupFrame(validFrame({ backendPort: 70000 })), error => error.reasonCode === 'M1_RUNTIME_CONTRACT_INVALID' && error.details.field === 'backendPort');
  assert.throws(() => validateStartupFrame(validFrame({ readyTimeoutMs: 1 })), error => error.reasonCode === 'M1_RUNTIME_CONTRACT_INVALID' && error.details.field === 'readyTimeoutMs');
});

test('M1 runtime contract is preserved by backend startup frame validation', () => {
  const frame = validateStartupFrame(validFrame());
  assert.equal(frame.m1StartupContractVersion, M1_STARTUP_CONTRACT_VERSION);
  assert.equal(frame.readyProtocolVersion, READY_PROTOCOL_VERSION);
  assert.equal(frame.runtimeMode, 'desktop-hosted');
  assert.equal(frame.startupAttemptId, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  assert.equal(frame.appRoot, path.resolve(__dirname, '..', '..'));
  assert.equal(frame.nodeRuntimeExecutablePath, process.execPath);
  assert.equal(frame.backendPort, 27632);
  assert.equal(frame.readyTimeoutMs, 30000);
});
