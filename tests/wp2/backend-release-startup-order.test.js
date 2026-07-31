'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { createInstalledResources } = require('./helpers');
const { BackendProcessHost } = require('../../electron/desktopHost/BackendProcessHost');
const ROOT = path.resolve(__dirname, '../..');

test('backend release identity fails closed before DesktopHost startup configuration', () => {
  const modulePath = require.resolve('../../backend/releaseIdentity');
  delete require.cache[modulePath];
  const { getBackendReleaseIdentity } = require('../../backend/releaseIdentity');
  assert.throws(() => getBackendReleaseIdentity({ reload: true }), error => error.reasonCode === 'BOOT_MANIFEST_LOCATION_INVALID');
});

test('DesktopHost frame configures backend release identity before server import', () => {
  const { resourcesPath, manifest, manifestSha256 } = createInstalledResources();
  const contextModule = require('../../backend/bootstrap/desktopStartupContext');
  contextModule.resetForTests();
  const releaseModulePath = require.resolve('../../backend/releaseIdentity');
  delete require.cache[releaseModulePath];
  const { configureBackendFromDesktopFrame } = require('../../backend/bootstrap/desktopStartupPipe');
  const context = configureBackendFromDesktopFrame({
    protocolVersion: 1,
    startupFrameProtocolVersion: 1,
    m1StartupContractVersion: 1,
    readyProtocolVersion: 1,
    startupAttemptId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    startupNonce: '33333333-3333-4333-8333-333333333333',
    apiSessionToken: 't'.repeat(43),
    backendPid: process.pid,
    resourcesPath,
    expectedBuildId: manifest.buildId,
    manifestSha256,
    releaseManifestPath: path.join(resourcesPath, 'release-manifest.json'),
    releaseManifestSha256Path: path.join(resourcesPath, 'release-manifest.sha256'),
    appRoot: ROOT,
    backendEntryPath: path.join(ROOT, 'backend', 'desktopHostedEntry.js'),
    nodeRuntimeExecutablePath: process.execPath,
    runtimeMode: 'desktop-hosted',
    apiBaseUrl: 'http://127.0.0.1:27632',
    logRoot: path.join(ROOT, 'logs'),
    backendLogPath: path.join(ROOT, 'logs', 'backend.jsonl'),
    desktopLogPath: path.join(ROOT, 'logs', 'desktop.jsonl'),
    nodeModulesPath: path.join(ROOT, 'node_modules'),
    backendSessionId: '44444444-4444-4444-8444-444444444444',
    fd6PipeInstanceId: '55555555-5555-4555-8555-555555555555',
    backendPort: 27632,
    readyTimeoutMs: 30000
  });
  assert.equal(context.buildId, manifest.buildId);
  assert.equal(context.releaseIdentity.manifestSha256, manifestSha256);
  assert.equal(context.appRoot, ROOT);
  assert.equal(context.backendEntryPath, path.join(ROOT, 'backend', 'desktopHostedEntry.js'));
  assert.equal(context.nodeRuntimeExecutablePath, process.execPath);
  assert.equal(context.startupAttemptId, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  assert.equal(context.runtimeMode, 'desktop-hosted');
  assert.equal(context.apiBaseUrl, 'http://127.0.0.1:27632');
  assert.equal(context.releaseManifestPath, path.join(resourcesPath, 'release-manifest.json'));
  assert.equal(context.backendSessionId, '44444444-4444-4444-8444-444444444444');
  assert.equal(context.backendPort, 27632);
  const entry = fs.readFileSync(path.join(ROOT, 'backend', 'desktopHostedEntry.js'), 'utf8');
  assert.ok(entry.indexOf('configureBackendFromDesktopFrame(frame)') < entry.indexOf("require(serverEntry)"));
});


test('production-style inherited pipe configures release identity before first server access', async () => {
  const { resourcesPath, manifest, manifestSha256 } = createInstalledResources({ gitCommit: 'e'.repeat(40), sourceTree: 'f'.repeat(40) });
  const host = new BackendProcessHost();
  const started = await host.start({
    entry: path.join(ROOT, 'tests', 'wp2', 'fixtures', 'desktop-hosted-entry-probe.js'),
    cwd: ROOT,
    execPath: process.execPath,
    env: process.env,
    releaseStartupConfig: { resourcesPath, expectedBuildId: manifest.buildId, manifestSha256 }
  });
  const message = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('desktop hosted entry probe timeout')), 5000);
    started.child.on('message', payload => { clearTimeout(timer); resolve(payload); });
    started.child.once('error', reject);
  });
  assert.equal(message.type, 'probe:server-identity');
  assert.equal(message.buildId, manifest.buildId);
  assert.equal(message.manifestSha256, manifestSha256);
  assert.equal(message.pidMatches, true);
  assert.equal(message.apiSessionEstablished, true);
  assert.equal(message.runtimeContract.appRoot, ROOT);
  assert.equal(message.runtimeContract.nodeRuntimeExecutablePath, process.execPath);
  assert.equal(message.runtimeContract.startupAttemptId, started.startupAttemptId);
  assert.equal(message.runtimeContract.runtimeMode, 'desktop-hosted');
  assert.equal(message.runtimeContract.readyProtocolVersion, 1);
  assert.equal(message.runtimeContract.releaseManifestPath, path.join(resourcesPath, 'release-manifest.json'));
  assert.equal(message.runtimeContract.backendSessionId, started.backendSessionId);
  await host.stop({ timeoutMs: 1000 });
});
