'use strict';

const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { BackendProcessHost } = require('../../electron/desktopHost/BackendProcessHost');
const { createInstalledResources } = require('../../tests/wp2/helpers');

function waitMessage(child, type, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, value) => {
      if (settled) return; settled = true; clearTimeout(timer);
      child.off('message', onMessage); child.off('exit', onExit); child.off('error', onError);
      if (error) reject(error); else resolve(value);
    };
    const onMessage = message => {
      if (message?.type === 'backend:startup-failed') return finish(Object.assign(new Error(message.message || message.reasonCode), { reasonCode: message.reasonCode }));
      if (message?.type === type) finish(null, message);
    };
    const onExit = (code, signal) => finish(new Error(`backend exited before ${type}: ${code}/${signal || ''}`));
    const onError = error => finish(error);
    const timer = setTimeout(() => finish(new Error(`${type} timeout`)), timeoutMs);
    child.on('message', onMessage); child.once('exit', onExit); child.once('error', onError);
  });
}

function request(port, options = {}) {
  return new Promise((resolve, reject) => {
    const bodyText = options.body == null ? null : JSON.stringify(options.body);
    const headers = { ...(options.headers || {}) };
    if (options.token) headers.Authorization = `Bearer ${options.token}`;
    if (options.contract !== false) headers['X-Yance-Contract-Version'] = String(options.contractVersion || 2);
    if (bodyText != null) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(bodyText); }
    const req = http.request({ host: '127.0.0.1', port, path: options.path || '/api/app/v2/snapshot', method: options.method || 'GET', headers, timeout: 10000 }, res => {
      let text = ''; res.setEncoding('utf8'); res.on('data', chunk => { text += chunk; });
      res.on('end', () => { let body = null; try { body = text ? JSON.parse(text) : null; } catch (_) {} resolve({ statusCode: res.statusCode, headers: res.headers, body, text }); });
    });
    req.once('timeout', () => req.destroy(new Error('request timeout'))); req.once('error', reject);
    if (bodyText != null) req.write(bodyText); req.end();
  });
}

function command(snapshot, overrides = {}) {
  return {
    contractVersion: 2,
    commandId: overrides.commandId || '77777777-7777-4777-8777-777777777777',
    commandType: overrides.commandType || 'runtime.ping',
    expectedStateVersion: overrides.expectedStateVersion ?? snapshot.stateVersion,
    issuedAtUtc: new Date().toISOString(),
    payload: overrides.payload || {}
  };
}

async function runProductionApiV2Scenario(options = {}) {
  const repoRoot = path.resolve(options.repoRoot || path.resolve(__dirname, '../..'));
  const dataRoot = path.resolve(options.dataRoot || fs.mkdtempSync(path.join(os.tmpdir(), 'yance-wp3-production-')));
  const release = createInstalledResources({ gitCommit: '3'.repeat(40), sourceTree: '4'.repeat(40) });
  const host = new BackendProcessHost();
  const startOptions = {
    entry: path.join(repoRoot, 'backend', 'desktopHostedEntry.js'), cwd: repoRoot, execPath: process.execPath,
    env: { ...process.env, YANCE_DATA_DIR: dataRoot, YANCE_PORT: '0', YANCE_HOST: '127.0.0.1', YANCE_MODEL_TIMEOUT_MS: '5000', YANCE_APP_ROOT: repoRoot, YANCE_WP2_PRODUCTION_RUNTIME_PROBE: '1' },
    releaseStartupConfig: { resourcesPath: release.resourcesPath, expectedBuildId: release.manifest.buildId, manifestSha256: release.manifestSha256 },
    // desktopHostedEntry always initializes the production runtime with
    // credential hydration required. This direct BackendProcessHost probe does
    // not use DesktopHost/CredentialVaultHost, so it must explicitly deliver
    // the empty default FD5 frame before waiting for READY.
    credentialFrameRequired: true
  };
  try {
    const first = await host.start(startOptions); const ready1 = await waitMessage(first.child, 'backend:ready');
    const missing = await request(ready1.port, { contract: true });
    const wrong = await request(ready1.port, { token: 'wrong-token' });
    const snapshot1 = await request(ready1.port, { token: first.apiSessionToken });
    const health1 = await request(ready1.port, { token: first.apiSessionToken, contract: false, path: '/api/health' });
    const before = snapshot1.body;
    const mismatch = await request(ready1.port, { token: first.apiSessionToken, contractVersion: 1, method: 'POST', path: '/api/app/v2/commands', body: command(before) });
    const afterMismatch = await request(ready1.port, { token: first.apiSessionToken });
    const envelope = command(afterMismatch.body);
    const accepted = await request(ready1.port, { token: first.apiSessionToken, method: 'POST', path: '/api/app/v2/commands', body: envelope });
    const duplicate = await request(ready1.port, { token: first.apiSessionToken, method: 'POST', path: '/api/app/v2/commands', body: envelope });
    const reuseMismatch = await request(ready1.port, { token: first.apiSessionToken, method: 'POST', path: '/api/app/v2/commands', body: { ...envelope, payload: { changed: true } } });
    const stateConflict = await request(ready1.port, { token: first.apiSessionToken, method: 'POST', path: '/api/app/v2/commands', body: command(accepted.body, { commandId: '88888888-8888-4888-8888-888888888888', expectedStateVersion: 1 }) });
    const events1 = await request(ready1.port, { token: first.apiSessionToken, path: '/api/app/v2/events?afterSequence=0&limit=500' });
    const firstToken = first.apiSessionToken;

    const second = await host.restart({ ...startOptions, gracefulMs: 8000, forceMs: 8000 }); const ready2 = await waitMessage(second.child, 'backend:ready');
    const stale = await request(ready2.port, { token: firstToken });
    const snapshot2 = await request(ready2.port, { token: second.apiSessionToken });
    const events2 = await request(ready2.port, { token: second.apiSessionToken, path: '/api/app/v2/events?afterSequence=0&limit=500' });

    const checks = {
      productionDesktopEntryExecuted: path.resolve(startOptions.entry) === path.join(repoRoot, 'backend', 'desktopHostedEntry.js'),
      productionServerEntryExecuted: ready1.productionRuntimeProbe?.executed === true && ready2.productionRuntimeProbe?.executed === true,
      allThreeEndpointsAuthenticated: missing.statusCode === 401 && wrong.statusCode === 401 && snapshot1.statusCode === 200 && events1.statusCode === 200,
      contractMismatchFailedBeforeSideEffect: mismatch.statusCode === 426 && mismatch.body?.reasonCode === 'API_CONTRACT_MISMATCH' && afterMismatch.body?.stateVersion === before.stateVersion,
      commandIdempotencyPersisted: accepted.statusCode === 200 && duplicate.body?.duplicate === true && duplicate.body?.resultingEventSequence === accepted.body?.resultingEventSequence,
      commandReuseMismatchRejected: reuseMismatch.statusCode === 409 && reuseMismatch.body?.reasonCode === 'COMMAND_ID_REUSE_MISMATCH',
      stateVersionConflictRejected: stateConflict.statusCode === 409 && stateConflict.body?.reasonCode === 'STATE_VERSION_CONFLICT',
      eventSequenceMonotonic: Array.isArray(events2.body?.events) && events2.body.events.every((event, index, rows) => index === 0 || event.eventSequence > rows[index - 1].eventSequence),
      eventSequencePersistedAcrossRestart: Number(events2.body?.lastAvailableSequence || 0) > Number(events1.body?.lastAvailableSequence || 0),
      tokenRotated: firstToken !== second.apiSessionToken,
      oldTokenRejectedAfterRestart: stale.statusCode === 401 && stale.body?.reasonCode === 'API_SESSION_UNAUTHORIZED',
      newTokenAcceptedAfterRestart: snapshot2.statusCode === 200,
      exactlyOneRuntimeInstance: health1.body?.productionServices?.constructionCounts?.AppRuntime === 1,
      exactlyOneLifecycleInstance: health1.body?.productionServices?.constructionCounts?.LifecycleStateMachine === 1,
      legacyCoreRuntimeConstructionCountZero: health1.body?.productionServices?.constructionCounts?.CoreRuntime === 0,
      legacyLifecycleManagerConstructionCountZero: health1.body?.productionServices?.constructionCounts?.LegacyLifecycleManager === 0,
      factoryCurrentMatchesServerRuntime: health1.body?.runtimeAuthorityDiagnostics?.currentMatchesServerRuntime === true,
      factoryCreatedExactlyOneRuntime: health1.body?.runtimeAuthorityDiagnostics?.factory?.createCount === 1
    };
    const failed = Object.entries(checks).filter(([, pass]) => pass !== true).map(([name]) => name);
    if (failed.length) {
      let reasonCode = 'WP3_PRODUCTION_API_V2_SCENARIO_FAILED';
      if (failed.some(name => ['exactlyOneRuntimeInstance','legacyCoreRuntimeConstructionCountZero','factoryCurrentMatchesServerRuntime','factoryCreatedExactlyOneRuntime'].includes(name))) reasonCode = 'WP3_DUPLICATE_PRODUCTION_RUNTIME';
      else if (failed.some(name => ['exactlyOneLifecycleInstance','legacyLifecycleManagerConstructionCountZero'].includes(name))) reasonCode = 'WP3_DUPLICATE_LIFECYCLE';
      throw Object.assign(new Error(`WP3 production API v2 scenario failed: ${failed.join(', ')}`), { reasonCode, checks });
    }
    return {
      status: 'PASS', dataRoot, buildId: before.buildId, checks,
      first: { ownerInstanceId: before.runtime?.ownerInstanceId, fencingToken: before.runtime?.fencingToken, stateVersion: before.stateVersion, lastEventSequence: events1.body?.lastAvailableSequence },
      second: { ownerInstanceId: snapshot2.body?.runtime?.ownerInstanceId, fencingToken: snapshot2.body?.runtime?.fencingToken, stateVersion: snapshot2.body?.stateVersion, lastEventSequence: events2.body?.lastAvailableSequence },
      endpoints: ['GET /api/app/v2/snapshot', 'POST /api/app/v2/commands', 'GET /api/app/v2/events'],
      runtimeAuthority: health1.body?.runtimeAuthorityDiagnostics || null,
      constructionCounts: health1.body?.productionServices?.constructionCounts || null
    };
  } finally {
    await host.stop({ gracefulMs: 8000, forceMs: 8000 }).catch(() => {});
    if (options.keepDataRoot !== true) fs.rmSync(dataRoot, { recursive: true, force: true });
  }
}

module.exports = { runProductionApiV2Scenario };
if (require.main === module) runProductionApiV2Scenario().then(result => process.stdout.write(`${JSON.stringify(result)}\n`)).catch(error => {
  process.stderr.write(`${JSON.stringify({
    status: 'FAIL',
    reasonCode: error.reasonCode || error.code || 'WP3_SCENARIO_FAILED',
    message: error.message || String(error),
    phase: error.phase || error.details?.phase || '',
    stackHash: error.stackHash || error.details?.stackHash || '',
    backendStartDiagnostics: error.backendStartDiagnostics || null
  }, null, 2)}\n`);
  process.exit(1);
});
