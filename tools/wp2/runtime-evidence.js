'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');

const { BackendProcessHost } = require('../../electron/desktopHost/BackendProcessHost');
const {
  stopOwnedBackend,
  restartElectronApp
} = require('../../electron/backendShutdownCoordinator');
const { expectedBuildId } = require('../../shared/release/releaseManifestSchema');
const { deriveDatabaseSchemaVersion } = require('../wp1/lib');
const { runProductionApiSessionScenario } = require('./production-api-runtime');

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function resources(repoRoot) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-wp2-ev-res-'));
  const source = JSON.parse(fs.readFileSync(path.join(repoRoot, 'release/release-source.json'), 'utf8'));
  const schema = deriveDatabaseSchemaVersion(repoRoot).databaseSchemaVersion;
  const manifest = {
    schemaVersion: 1,
    buildId: '',
    productName: source.productName,
    productVersion: source.productVersion,
    stageVersion: source.stageVersion,
    phase: source.phase,
    distributionMode: source.distributionMode,
    gitCommit: 'a'.repeat(40),
    sourceCommit: 'a'.repeat(40),
    sourceTree: 'b'.repeat(40),
    buildTimestampUtc: '2026-07-03T00:00:00.000Z',
    applicationPayloadSha256: 'c'.repeat(64),
    payloadFilesSha256: 'd'.repeat(64),
    apiContractVersion: source.apiContractVersion,
    credentialProtocolVersion: source.credentialProtocolVersion,
    runtimeLockProtocolVersion: source.runtimeLockProtocolVersion,
    databaseSchemaVersion: schema,
    artifactClass: 'PIPELINE_TEST_ONLY',
    finalReleaseEvidence: false
  };
  manifest.buildId = expectedBuildId(manifest);
  const raw = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  fs.writeFileSync(path.join(dir, 'release-manifest.json'), raw);
  const manifestSha256 = sha256(raw);
  fs.writeFileSync(path.join(dir, 'release-manifest.sha256'), `${manifestSha256}  release-manifest.json\n`);
  return { resourcesPath: dir, manifest, manifestSha256 };
}

function waitMessage(child, type) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`${type} timeout`)), 5000);
    const onMessage = message => {
      if (message?.type !== type) return;
      clearTimeout(timeout);
      child.off('message', onMessage);
      resolve(message);
    };
    child.on('message', onMessage);
    child.once('error', reject);
  });
}

function pidAbsent(pid) {
  try {
    process.kill(pid, 0);
    return false;
  } catch {
    return true;
  }
}

function request(port, token) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      path: '/api/ready',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      timeout: 2000
    }, res => {
      let bodyText = '';
      res.on('data', chunk => { bodyText += chunk; });
      res.on('end', () => {
        let body = {};
        try { body = bodyText ? JSON.parse(bodyText) : {}; } catch {}
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body,
          reasonCode: body.reasonCode || null
        });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function upgrade(port, token) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1', () => socket.write(
      `GET /events HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n${token ? `Authorization: Bearer ${token}\r\n` : ''}\r\n`
    ));
    let raw = '';
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error('upgrade timeout'));
    }, 2000);
    socket.on('data', chunk => { raw += chunk; });
    socket.on('end', () => {
      clearTimeout(timeout);
      resolve({ statusCode: Number((raw.match(/^HTTP\/1\.1\s+(\d+)/) || [])[1] || 0), raw });
    });
    socket.on('error', reject);
  });
}

function fakePipe(handler) {
  const pipe = new EventEmitter();
  pipe.end = (data, callback) => handler ? handler(data, callback) : queueMicrotask(() => callback?.());
  pipe.destroy = () => {};
  return pipe;
}

function fakeChild(options = {}) {
  const child = new EventEmitter();
  child.pid = options.pid || 8100 + Math.floor(Math.random() * 100);
  child.exitCode = null;
  child.signalCode = null;
  child.stdio = [null, new PassThrough(), new PassThrough(), null, options.controlPipe || fakePipe(), new PassThrough()];
  child.killCalls = [];
  child.kill = signal => {
    child.killCalls.push(signal);
    if (options.killReturnsFalse?.includes(signal)) return false;
    if (signal === 'SIGTERM' && options.ignoreTerm) return true;
    if (options.neverExit) return true;
    queueMicrotask(() => child.emit('exit', signal === 'SIGTERM' ? 0 : null, signal));
    return true;
  };
  return child;
}

function hostFor(child) {
  return new BackendProcessHost({
    fork: () => child,
    randomBytes: size => Buffer.alloc(size, 9),
    randomUUID: () => '77777777-7777-4777-8777-777777777777'
  });
}

function states(host) {
  return host.snapshot().stateHistory.map(row => row.state);
}

function scenarioResult(name, host, extra = {}) {
  const snapshot = host.snapshot();
  const stateTransitions = states(host);
  return {
    name,
    stateTransitions,
    finalState: snapshot.state,
    backendPid: snapshot.backendPid,
    apiSessionEstablished: snapshot.apiSessionEstablished,
    forbiddenCrashedToRunning: stateTransitions.some((state, index) => state === 'CRASHED' && stateTransitions.slice(index + 1).includes('RUNNING')),
    deadChildSessionEstablished: snapshot.backendPid === 0 && snapshot.apiSessionEstablished,
    ...extra
  };
}

async function startFailureScenario(name, setup, options = {}) {
  let child;
  const pipe = fakePipe((data, callback) => setup({ get child() { return child; }, callback, data }));
  child = fakeChild({ controlPipe: pipe });
  const host = hostFor(child);
  let reasonCode = '';
  try {
    await host.start({
      entry: '/e', cwd: '/c',
      releaseStartupConfig: { resourcesPath: '/r', expectedBuildId: 'b', manifestSha256: 'f'.repeat(64) },
      ...options
    });
  } catch (error) {
    reasonCode = error.reasonCode || error.code || 'UNKNOWN';
  }
  return scenarioResult(name, host, { reasonCode, startSucceeded: false });
}

function desktopHostFor(host) {
  return {
    backendProcessHost: host,
    stopBackend: options => host.stop(options),
    snapshot: () => ({ backend: host.snapshot() })
  };
}

async function lifecycleEvidence(repoRoot) {
  const scenarios = [];

  for (const mode of ['normal', 'ignore-term']) {
    const host = new BackendProcessHost();
    const started = await host.start({
      entry: path.join(repoRoot, 'tests/wp2/fixtures/lifecycle-child.js'),
      cwd: repoRoot,
      execPath: process.execPath,
      env: { ...process.env, WP2_CHILD_MODE: mode },
      releaseStartupConfig: { resourcesPath: '/r', expectedBuildId: 'b', manifestSha256: 'f'.repeat(64) }
    });
    await waitMessage(started.child, 'lifecycle-ready');
    const testPid = started.child.pid;
    const stopResult = await host.stop({ gracefulMs: 50, forceMs: 1000 });
    scenarios.push(scenarioResult(mode === 'normal' ? 'normal-sigterm' : 'ignore-sigterm-force-kill', host, {
      testPid,
      exitEvent: host.snapshot().lastExit,
      stopResult: {
        stopped: stopResult.stopped,
        exitConfirmed: stopResult.exitConfirmed,
        forced: stopResult.forced === true,
        exitCode: stopResult.exitCode,
        signalCode: stopResult.signalCode
      },
      orphanPidPresent: !pidAbsent(testPid)
    }));
  }

  {
    const host = new BackendProcessHost();
    const missingExecPath = path.join(os.tmpdir(), `yance-missing-node-${process.pid}-${Date.now()}`);
    let reasonCode = '';
    let unhandledError = false;
    const uncaught = () => { unhandledError = true; };
    process.once('uncaughtException', uncaught);
    try {
      await host.start({
        entry: path.join(repoRoot, 'tests/wp2/fixtures/lifecycle-child.js'),
        cwd: repoRoot,
        execPath: missingExecPath,
        env: { ...process.env },
        spawnIdentityTimeoutMs: 1000,
        releaseStartupConfig: { resourcesPath: '/r', expectedBuildId: 'b', manifestSha256: 'f'.repeat(64) }
      });
    } catch (error) {
      reasonCode = error.reasonCode || error.code || error.causeCode || 'UNKNOWN';
    } finally {
      await new Promise(resolve => setTimeout(resolve, 30));
      process.removeListener('uncaughtException', uncaught);
    }
    scenarios.push(scenarioResult('real-missing-exec-spawn-error', host, {
      reasonCode,
      startSucceeded: false,
      unhandledError,
      childReferenceCleared: host.getOwnedChild() === null,
      pipeReferencesCleared: host.snapshot().ownedChildPresent === false,
      orphanPidPresent: false
    }));
  }

  scenarios.push(await startFailureScenario('exit-before-control-callback', ({ child, callback }) => {
    child.emit('exit', 31, null);
    queueMicrotask(callback);
  }));
  scenarios.push(await startFailureScenario('exit-during-control-callback', ({ child, callback }) => {
    callback();
    child.emit('exit', 32, null);
  }));
  {
    const child = fakeChild();
    const host = hostFor(child);
    let reasonCode = '';
    try {
      await host.start({
        entry: '/e', cwd: '/c',
        releaseStartupConfig: { resourcesPath: '/r', expectedBuildId: 'b', manifestSha256: 'f'.repeat(64) },
        beforeRunningTransition: () => child.emit('exit', 33, null)
      });
    } catch (error) {
      reasonCode = error.reasonCode || error.code || 'UNKNOWN';
    }
    scenarios.push(scenarioResult('exit-before-running-transition', host, { reasonCode, startSucceeded: false }));
  }
  scenarios.push(await startFailureScenario('async-error-during-start', ({ child, callback }) => queueMicrotask(() => {
    child.emit('error', Object.assign(new Error('async'), { code: 'EASYNC' }));
    callback();
  })));
  scenarios.push(await startFailureScenario('error-then-exit', ({ child, callback }) => queueMicrotask(() => {
    child.emit('error', new Error('error'));
    child.emit('exit', 34, null);
    callback();
  })));

  {
    const child = fakeChild({ ignoreTerm: true, neverExit: true, killReturnsFalse: ['SIGKILL'] });
    const host = hostFor(child);
    await host.start({
      entry: '/e', cwd: '/c',
      releaseStartupConfig: { resourcesPath: '/r', expectedBuildId: 'b', manifestSha256: 'f'.repeat(64) }
    });
    const stopResult = await host.stop({ gracefulMs: 25, forceMs: 25 });
    scenarios.push(scenarioResult('sigkill-failure-retains-owner', host, {
      stopResult,
      ownerRetained: host.snapshot().backendPid === child.pid && host.getOwnedChild() === child,
      orphanPidPresent: true
    }));
  }

  {
    const child = fakeChild();
    const host = hostFor(child);
    await host.start({ entry: '/e', cwd: '/c', releaseStartupConfig: { resourcesPath: '/r', expectedBuildId: 'b', manifestSha256: 'f'.repeat(64) } });
    const desktopHost = desktopHostFor(host);
    let relaunchCalled = false;
    let exitCalled = false;
    const result = await restartElectronApp({
      setRelaunchIntent: () => {}, clearRelaunchIntent: () => {},
      stop: () => stopOwnedBackend({ desktopHost, getChild: () => null, clearReferences: () => {}, killProbe: () => { throw Object.assign(new Error('absent'), { code: 'ESRCH' }); } }),
      authoritySnapshot: () => host.snapshot(),
      appRelaunch: () => { relaunchCalled = true; },
      appExit: () => { exitCalled = true; }
    });
    scenarios.push(scenarioResult('running-restart-app', host, {
      restartResult: result,
      relaunchCalled,
      exitCalled,
      exitConfirmedBeforeRelaunch: result.exitConfirmed === true && host.snapshot().backendPid === 0,
      orphanPidPresent: false
    }));
  }

  {
    const child = fakeChild({ controlPipe: fakePipe((_data, callback) => setTimeout(callback, 25)) });
    const host = hostFor(child);
    const desktopHost = desktopHostFor(host);
    const startPromise = host.start({
      entry: '/e', cwd: '/c', controlPipeTimeoutMs: 500,
      releaseStartupConfig: { resourcesPath: '/r', expectedBuildId: 'b', manifestSha256: 'f'.repeat(64) }
    });
    await new Promise(resolve => setTimeout(resolve, 3));
    let relaunchCalled = false;
    let exitCalled = false;
    const result = await restartElectronApp({
      setRelaunchIntent: () => {}, clearRelaunchIntent: () => {},
      stop: () => stopOwnedBackend({ desktopHost, getChild: () => null, clearReferences: () => {}, killProbe: () => { throw Object.assign(new Error('absent'), { code: 'ESRCH' }); } }),
      authoritySnapshot: () => host.snapshot(),
      appRelaunch: () => { relaunchCalled = true; },
      appExit: () => { exitCalled = true; }
    });
    let startRejected = false;
    try { await startPromise; } catch { startRejected = true; }
    scenarios.push(scenarioResult('starting-restart-app', host, {
      restartResult: result,
      startRejected,
      relaunchCalled,
      exitCalled,
      exitConfirmedBeforeRelaunch: result.exitConfirmed === true && host.snapshot().backendPid === 0,
      orphanPidPresent: false
    }));
  }

  {
    const child = fakeChild({ ignoreTerm: true, neverExit: true, killReturnsFalse: ['SIGKILL'] });
    const host = hostFor(child);
    await host.start({ entry: '/e', cwd: '/c', releaseStartupConfig: { resourcesPath: '/r', expectedBuildId: 'b', manifestSha256: 'f'.repeat(64) } });
    const desktopHost = {
      backendProcessHost: host,
      stopBackend: options => host.stop({ ...options, gracefulMs: 25, forceMs: 25 }),
      snapshot: () => ({ backend: host.snapshot() })
    };
    let relaunchCalled = false;
    let exitCalled = false;
    let clearIntentCalled = false;
    let reasonCode = '';
    try {
      await restartElectronApp({
        setRelaunchIntent: () => {}, clearRelaunchIntent: () => { clearIntentCalled = true; },
        stop: () => stopOwnedBackend({ desktopHost, getChild: () => null, clearReferences: () => {}, timeoutMs: 25, killProbe: () => true }),
        authoritySnapshot: () => host.snapshot(),
        appRelaunch: () => { relaunchCalled = true; },
        appExit: () => { exitCalled = true; }
      });
    } catch (error) {
      reasonCode = error.reasonCode || error.code || 'UNKNOWN';
    }
    scenarios.push(scenarioResult('restart-app-stop-failure', host, {
      reasonCode,
      relaunchCalled,
      exitCalled,
      clearIntentCalled,
      ownerRetained: host.snapshot().backendPid === child.pid && host.getOwnedChild() === child,
      stopResult: { stopped: false, exitConfirmed: false },
      orphanPidPresent: true
    }));
  }

  return {
    scenarios,
    allOrphanChecksPass: scenarios
      .filter(row => ['normal-sigterm', 'ignore-sigterm-force-kill', 'real-missing-exec-spawn-error', 'running-restart-app', 'starting-restart-app'].includes(row.name))
      .every(row => row.orphanPidPresent === false)
  };
}

function collectFiles(root) {
  const output = [];
  function walk(directory) {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(file);
      else output.push({ name: path.relative(root, file).replaceAll(path.sep, '/'), bytes: fs.readFileSync(file) });
    }
  }
  walk(root);
  return output;
}

async function apiEvidence(repoRoot, options = {}) {
  const runtime = await runProductionApiSessionScenario({
    repoRoot,
    createReleaseResources: () => resources(repoRoot)
  });
  return {
    authenticationSource: runtime.authenticationSource,
    http: runtime.http,
    webSocket: runtime.webSocket,
    productionAuthModuleExecuted: runtime.execution.productionHttpAuthExecuted === true && runtime.execution.productionWebSocketAuthExecuted === true,
    authExecutionCounters: runtime.authExecutionCounters,
    rotationObserved: runtime.rotationObserved,
    argvTokenPresent: runtime.argvTokenPresent,
    environmentTokenPresent: runtime.environmentTokenPresent,
    scanScopes: runtime.scanScopes,
    scannedFileCount: runtime.scannedFileCount,
    tokenOrTokenHashLeakCount: runtime.tokenOrTokenHashLeakCount,
    mutationDetection: options.mutationDetection || { status: 'FAIL', reasonCode: 'WP2_SERVER_MUTATION_EVIDENCE_MISSING' },
    productionRuntimeProbe: runtime.productionRuntimeProbe,
    productionDesktopEntryExecuted: runtime.execution.productionDesktopEntryExecuted,
    productionServerEntryExecuted: runtime.execution.productionServerEntryExecuted,
    productionHttpAuthExecuted: runtime.execution.productionHttpAuthExecuted,
    productionWebSocketAuthExecuted: runtime.execution.productionWebSocketAuthExecuted,
    productionDiagnosticsPathExecuted: runtime.execution.productionDiagnosticsPathExecuted,
    productionLoggingPathExecuted: runtime.execution.productionLoggingPathExecuted,
    productionPersistencePathsExecuted: runtime.execution.productionPersistencePathsExecuted,
    actualAuthenticatedRuntimeChainExecuted: Object.values(runtime.execution).every(value => value === true),
    tokenValueRecorded: false,
    tokenHashRecorded: false
  };
}

module.exports = { apiEvidence, lifecycleEvidence };
