'use strict';

const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const childProcess = require('node:child_process');

const { BackendProcessHost } = require('../../electron/desktopHost/BackendProcessHost');
const { assertNoTokenLeaks } = require('./token-leak-scanner');

function appendJsonLine(file, row) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(row)}\n`, 'utf8');
}

function waitMessage(child, type, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off('message', onMessage);
      child.off('error', onError);
      child.off('exit', onExit);
      if (error) reject(error); else resolve(value);
    };
    const onMessage = message => {
      if (message?.type === 'backend:startup-failed') {
        const error = new Error(message.message || message.code || 'production backend startup failed');
        error.reasonCode = message.reasonCode || message.code || 'WP2_PRODUCTION_SERVER_STARTUP_FAILED';
        error.details = message;
        finish(error);
        return;
      }
      if (message?.type === type) finish(null, message);
    };
    const onError = error => finish(error);
    const onExit = (code, signal) => {
      const error = new Error(`production backend exited before ${type}: code=${code} signal=${signal || ''}`);
      error.reasonCode = 'WP2_PRODUCTION_SERVER_EXITED_EARLY';
      finish(error);
    };
    const timer = setTimeout(() => {
      const error = new Error(`${type} timeout`);
      error.reasonCode = 'WP2_PRODUCTION_SERVER_READY_TIMEOUT';
      finish(error);
    }, Math.max(1000, Number(timeoutMs || 30000)));
    child.on('message', onMessage);
    child.once('error', onError);
    child.once('exit', onExit);
  });
}

function request(port, secret) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      path: '/api/ready',
      headers: secret ? { Authorization: `Bearer ${secret}` } : {},
      timeout: 5000
    }, res => {
      let bodyText = '';
      res.on('data', chunk => { bodyText += chunk; });
      res.on('end', () => {
        let body = {};
        try { body = bodyText ? JSON.parse(bodyText) : {}; } catch (_) {}
        resolve({
          statusCode: Number(res.statusCode || 0),
          headers: res.headers,
          body,
          reasonCode: body.reasonCode || body.code || null
        });
      });
    });
    req.once('timeout', () => req.destroy(new Error('HTTP request timeout')));
    req.once('error', reject);
    req.end();
  });
}

function upgrade(port, secret) {
  return new Promise((resolve, reject) => {
    const websocketKey = crypto.randomBytes(16).toString('base64');
    const socket = net.connect(port, '127.0.0.1');
    let raw = '';
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error); else resolve(value);
    };
    const timer = setTimeout(() => finish(new Error('WebSocket upgrade timeout')), 5000);
    socket.once('connect', () => socket.write([
      'GET /events HTTP/1.1',
      `Host: 127.0.0.1:${port}`,
      'Connection: Upgrade',
      'Upgrade: websocket',
      `Sec-WebSocket-Key: ${websocketKey}`,
      'Sec-WebSocket-Version: 13',
      ...(secret ? [`Authorization: Bearer ${secret}`] : []),
      '',
      ''
    ].join('\r\n')));
    socket.on('data', chunk => {
      raw += chunk.toString('latin1');
      if (!raw.includes('\r\n\r\n')) return;
      finish(null, {
        statusCode: Number((raw.match(/^HTTP\/1\.1\s+(\d+)/) || [])[1] || 0),
        raw
      });
    });
    socket.once('error', error => finish(error));
    socket.once('end', () => {
      if (!settled) finish(null, { statusCode: Number((raw.match(/^HTTP\/1\.1\s+(\d+)/) || [])[1] || 0), raw });
    });
  });
}

function collectFiles(root) {
  const output = [];
  function walk(directory) {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(file);
      else {
        try { output.push({ name: path.relative(root, file).replaceAll(path.sep, '/'), bytes: fs.readFileSync(file) }); }
        catch (error) { output.push({ name: path.relative(root, file).replaceAll(path.sep, '/'), bytes: Buffer.from(`UNREADABLE:${error.code || error.message}`) }); }
      }
    }
  }
  walk(root);
  return output;
}

function verifyProbe(ready, dataRoot) {
  const probe = ready?.productionRuntimeProbe || {};
  const requiredTopLevel = [
    'productionDiagnosticsPathExecuted',
    'productionLoggingPathExecuted',
    'productionPersistencePathsExecuted'
  ];
  for (const key of requiredTopLevel) {
    if (probe[key] !== true) {
      const error = new Error(`Production runtime probe did not execute ${key}`);
      error.reasonCode = 'WP2_PRODUCTION_PATH_PROBE_INCOMPLETE';
      error.details = probe;
      throw error;
    }
  }
  const requiredChecks = [
    'sqlitePathExecuted', 'sqliteWalPathExecuted', 'sqliteShmPathExecuted',
    'electronSettingsStorePathExecuted', 'localStoragePathExecuted',
    'indexedDbPathExecuted', 'crashOutputPathExecuted'
  ];
  for (const key of requiredChecks) {
    if (probe.checks?.[key] !== true) {
      const error = new Error(`Production runtime probe did not execute ${key}`);
      error.reasonCode = 'WP2_PRODUCTION_PATH_PROBE_INCOMPLETE';
      error.details = probe;
      throw error;
    }
  }
  const requiredFiles = [
    'logs/desktop.jsonl',
    'logs/server.jsonl',
    'logs/production-diagnostics.jsonl',
    'store/yance-r32.db',
    'store/yance-r32.db-wal',
    'store/yance-r32.db-shm',
    'Local Storage/leveldb/.wp2-production-path-access.json',
    'IndexedDB/.wp2-production-path-access.json',
    'Crashpad/.wp2-production-path-access.json'
  ];
  const missingFiles = requiredFiles.filter(relative => !fs.existsSync(path.join(dataRoot, relative)));
  if (missingFiles.length) {
    const error = new Error(`Required production runtime surfaces are missing: ${missingFiles.join(', ')}`);
    error.reasonCode = 'WP2_PRODUCTION_PATH_SURFACE_MISSING';
    error.details = { missingFiles, probe };
    throw error;
  }
  return { probe, requiredFiles };
}

function ensureNoSecretInSpawn(secret, started, spawnOptions) {
  const argvText = JSON.stringify(started.child.spawnargs || []);
  const envText = JSON.stringify(spawnOptions?.env || {});
  const scan = assertNoTokenLeaks(secret, [
    { name: 'child-spawnargs', bytes: argvText },
    { name: 'child-environment', bytes: envText }
  ]);
  const forbiddenKey = Object.keys(spawnOptions?.env || {}).find(key => /YANCE_API_TOKEN|API_SESSION_TOKEN/i.test(key));
  if (forbiddenKey) {
    const error = new Error(`Legacy API session environment key reached production child: ${forbiddenKey}`);
    error.reasonCode = 'WP2_API_SESSION_ENVIRONMENT_LEAK_DETECTED';
    throw error;
  }
  return scan;
}

async function runProductionApiSessionScenario(options = {}) {
  const repoRoot = path.resolve(options.repoRoot || path.resolve(__dirname, '../..'));
  const dataRoot = path.resolve(options.dataRoot || fs.mkdtempSync(path.join(os.tmpdir(), 'yance-wp2-production-runtime-')));
  const release = options.createReleaseResources();
  const desktopLog = path.join(dataRoot, 'logs', 'desktop.jsonl');
  const spawnOptions = [];
  const realFork = childProcess.fork;
  const host = new BackendProcessHost({
    log: (event, detail = {}) => appendJsonLine(desktopLog, {
      at: new Date().toISOString(),
      source: 'electron/desktopHost/BackendProcessHost.js',
      event,
      backendPid: Number(detail.backendPid || 0)
    }),
    fork: (entry, args, childOptions) => {
      spawnOptions.push(childOptions);
      return realFork(entry, args, childOptions);
    }
  });

  const startOptions = {
    entry: path.join(repoRoot, 'backend', 'desktopHostedEntry.js'),
    cwd: repoRoot,
    execPath: process.execPath,
    env: {
      ...process.env,
      YANCE_DATA_DIR: dataRoot,
      YANCE_PORT: '0',
      YANCE_HOST: '127.0.0.1',
      YANCE_SAFE_MODE: '1',
      YANCE_MODEL_TIMEOUT_MS: '5000',
      YANCE_APP_ROOT: repoRoot,
      YANCE_WP2_PRODUCTION_RUNTIME_PROBE: '1',
      YANCE_API_TOKEN: 'legacy-environment-source-must-be-removed'
    },
    releaseStartupConfig: {
      resourcesPath: release.resourcesPath,
      expectedBuildId: release.manifest.buildId,
      manifestSha256: release.manifestSha256
    },
    credentialFrameRequired: true
  };

  function captureOutput(started, label) {
    started.child.stdout?.on('data', bytes => appendJsonLine(desktopLog, {
      at: new Date().toISOString(), source: 'backend-stdout', label, text: String(bytes).slice(-16000)
    }));
    started.child.stderr?.on('data', bytes => appendJsonLine(desktopLog, {
      at: new Date().toISOString(), source: 'backend-stderr', label, text: String(bytes).slice(-16000)
    }));
  }

  let first;
  let second;
  try {
    const firstStarted = await host.start(startOptions);
    captureOutput(firstStarted, 'first');
    const firstReady = await waitMessage(firstStarted.child, 'backend:ready');
    verifyProbe(firstReady, dataRoot);
    ensureNoSecretInSpawn(firstStarted.apiSessionToken, firstStarted, spawnOptions[0]);

    const firstHttp = await request(firstReady.port, firstStarted.apiSessionToken);
    const wrongHttp = await request(firstReady.port, 'wrong-token');
    const firstWs = await upgrade(firstReady.port, firstStarted.apiSessionToken);
    const wrongWs = await upgrade(firstReady.port, 'wrong-token');
    const firstAuthProbe = await request(firstReady.port, firstStarted.apiSessionToken);
    const firstSurfaces = [
      { name: 'child-spawnargs-first', bytes: JSON.stringify(firstStarted.child.spawnargs || []) },
      { name: 'child-environment-first', bytes: JSON.stringify(spawnOptions[0]?.env || {}) },
      ...collectFiles(dataRoot)
    ];
    const firstScan = assertNoTokenLeaks(firstStarted.apiSessionToken, firstSurfaces);
    first = { started: firstStarted, ready: firstReady, http: firstHttp, wrongHttp, ws: firstWs, wrongWs, authProbe: firstAuthProbe, surfaces: firstSurfaces, scan: firstScan };

    const secondStarted = await host.restart({ ...startOptions, gracefulMs: 5000, forceMs: 5000 });
    captureOutput(secondStarted, 'second');
    const secondReady = await waitMessage(secondStarted.child, 'backend:ready');
    verifyProbe(secondReady, dataRoot);
    ensureNoSecretInSpawn(secondStarted.apiSessionToken, secondStarted, spawnOptions[1]);

    const oldHttp = await request(secondReady.port, firstStarted.apiSessionToken);
    const newHttp = await request(secondReady.port, secondStarted.apiSessionToken);
    const oldWs = await upgrade(secondReady.port, firstStarted.apiSessionToken);
    const newWs = await upgrade(secondReady.port, secondStarted.apiSessionToken);
    const secondAuthProbe = await request(secondReady.port, secondStarted.apiSessionToken);
    const secondSurfaces = [
      { name: 'child-spawnargs-second', bytes: JSON.stringify(secondStarted.child.spawnargs || []) },
      { name: 'child-environment-second', bytes: JSON.stringify(spawnOptions[1]?.env || {}) },
      ...collectFiles(dataRoot)
    ];
    const oldTokenScan = assertNoTokenLeaks(firstStarted.apiSessionToken, secondSurfaces);
    const secondScan = assertNoTokenLeaks(secondStarted.apiSessionToken, secondSurfaces);
    second = { started: secondStarted, ready: secondReady, oldHttp, newHttp, oldWs, newWs, authProbe: secondAuthProbe, surfaces: secondSurfaces, oldTokenScan, scan: secondScan };

    const firstAuthStats = firstAuthProbe.body?.apiSessionAuth || {};
    const secondAuthStats = secondAuthProbe.body?.apiSessionAuth || {};
    const productionDesktopEntryExecuted = path.resolve(startOptions.entry) === path.join(repoRoot, 'backend', 'desktopHostedEntry.js');
    const productionServerEntryExecuted = firstReady.productionRuntimeProbe?.executed === true && secondReady.productionRuntimeProbe?.executed === true;
    const productionHttpAuthExecuted =
      firstHttp.statusCode === 200 && wrongHttp.statusCode === 401 &&
      newHttp.statusCode === 200 && oldHttp.statusCode === 401 &&
      firstHttp.headers['x-yance-api-session-auth'] === 'apiSessionAuth' &&
      Number(firstAuthStats.headerChecks || 0) >= 1 && Number(secondAuthStats.headerChecks || 0) >= 1;
    const productionWebSocketAuthExecuted =
      firstWs.statusCode === 101 && wrongWs.statusCode === 401 &&
      newWs.statusCode === 101 && oldWs.statusCode === 401 &&
      Number(firstAuthStats.webSocketChecks || 0) >= 2 &&
      Number(secondAuthStats.webSocketChecks || 0) >= 2;
    const productionDiagnosticsPathExecuted = firstReady.productionRuntimeProbe?.productionDiagnosticsPathExecuted === true && secondReady.productionRuntimeProbe?.productionDiagnosticsPathExecuted === true;
    const productionLoggingPathExecuted = firstReady.productionRuntimeProbe?.productionLoggingPathExecuted === true && secondReady.productionRuntimeProbe?.productionLoggingPathExecuted === true;
    const productionPersistencePathsExecuted = firstReady.productionRuntimeProbe?.productionPersistencePathsExecuted === true && secondReady.productionRuntimeProbe?.productionPersistencePathsExecuted === true;

    const execution = {
      productionDesktopEntryExecuted,
      productionServerEntryExecuted,
      productionHttpAuthExecuted,
      productionWebSocketAuthExecuted,
      productionDiagnosticsPathExecuted,
      productionLoggingPathExecuted,
      productionPersistencePathsExecuted
    };
    const missingExecution = Object.entries(execution).filter(([, value]) => value !== true).map(([name]) => name);
    if (missingExecution.length) {
      const error = new Error(`Production runtime chain incomplete: ${missingExecution.join(', ')}`);
      error.reasonCode = 'WP2_PRODUCTION_RUNTIME_CHAIN_INCOMPLETE';
      error.details = { execution, firstHttp, wrongHttp, firstWsStatus: firstWs.statusCode, wrongWsStatus: wrongWs.statusCode };
      throw error;
    }

    return {
      dataRoot,
      entry: path.relative(repoRoot, startOptions.entry).replaceAll(path.sep, '/'),
      execution,
      authenticationSource: 'DesktopHost inherited startup pipe -> backend/desktopHostedEntry.js -> backend/server.js -> backend/security/apiSessionAuth.js',
      http: {
        currentTokenStatus: firstHttp.statusCode,
        wrongTokenStatus: wrongHttp.statusCode,
        wrongTokenReasonCode: wrongHttp.reasonCode,
        newTokenStatus: newHttp.statusCode,
        oldTokenAfterRestartStatus: oldHttp.statusCode,
        oldTokenReasonCode: oldHttp.reasonCode,
        authenticationMarkerObserved: firstHttp.headers['x-yance-api-session-auth'] === 'apiSessionAuth'
      },
      webSocket: {
        currentTokenStatus: firstWs.statusCode,
        wrongTokenStatus: wrongWs.statusCode,
        newTokenStatus: newWs.statusCode,
        oldTokenAfterRestartStatus: oldWs.statusCode,
        authenticationMarkerObserved: Number(firstAuthStats.webSocketChecks || 0) >= 2
      },
      authExecutionCounters: {
        first: firstAuthStats,
        second: secondAuthStats
      },
      rotationObserved: firstStarted.apiSessionToken !== secondStarted.apiSessionToken,
      argvTokenPresent: false,
      environmentTokenPresent: false,
      scanScopes: [
        'production child spawn options', 'production child argv', 'production child environment',
        'DesktopHost log path', 'backend production logger path', 'production diagnostics path',
        'production SQLite/WAL/SHM', 'Electron desktop settings SQLite namespace',
        'Electron Local Storage path adapter', 'Electron IndexedDB path adapter',
        'Electron Crashpad path adapter', 'controlled YANCE_DATA_DIR'
      ],
      scannedFileCount: new Set([...first.surfaces, ...second.surfaces].map(row => row.name)).size,
      tokenOrTokenHashLeakCount: first.scan.findingCount + second.oldTokenScan.findingCount + second.scan.findingCount,
      productionRuntimeProbe: secondReady.productionRuntimeProbe,
      childSpawnCount: spawnOptions.length
    };
  } finally {
    const stop = await host.stop({ gracefulMs: 5000, forceMs: 5000 }).catch(() => ({ stopped: false }));
    if (stop.stopped !== true && host.getOwnedChild()) {
      try { host.getOwnedChild().kill('SIGKILL'); } catch (_) {}
    }
  }
}

module.exports = {
  collectFiles,
  request,
  runProductionApiSessionScenario,
  upgrade,
  verifyProbe,
  waitMessage
};
