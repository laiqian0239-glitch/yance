'use strict';

const path = require('node:path');
const os = require('node:os');
const { canonicalizeRuntimePaths } = require('./RuntimePathIdentity');
const { BootCoordinator } = require('./BootCoordinator');
const { getRuntimeCoordinator } = require('./runtimeSingleton');

async function initializeAppRuntime(options = {}) {
  const context = options.context;
  if (!context) throw new TypeError('Desktop startup context is required');
  const defaultRoot = process.platform === 'win32' ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Yance') : path.join(os.homedir(), '.yance');
  const suppliedDataRoot = path.resolve(options.dataRoot || process.env.YANCE_DATA_DIR || process.env.WORKBUDDY_DATA_DIR || defaultRoot);
  const suppliedDbPath = path.resolve(options.dbPath || path.join(suppliedDataRoot, 'store', 'yance-r32.db'));
  const runtimePaths = canonicalizeRuntimePaths({ dataRoot: suppliedDataRoot, dbPath: suppliedDbPath, platform: options.platform });
  const { dataRoot, dbPath } = runtimePaths;
  const coordinator = new BootCoordinator({
    ...options,
    context,
    dataRoot,
    dbPath,
    runtimePaths,
    buildId: context.buildId,
    onStopRequested: options.onStopRequested || (() => process.emit('SIGTERM')),
    requireCredentialHydration: options.requireCredentialHydration,
    credentialFd: options.credentialFd,
    credentialStream: options.credentialStream,
    credentialTimeoutMs: options.credentialTimeoutMs,
    hydrateCredentials: options.hydrateCredentials,
    applyCredentialSnapshot: options.applyCredentialSnapshot,
    externalWorkerStarters: options.externalWorkerStarters,
    onCredentialHydrated: options.onCredentialHydrated,
    onLocalReady: options.onLocalReady,
    sqliteBroker: options.sqliteBroker
  });
  await coordinator.start();
  return coordinator;
}

async function shutdownAppRuntime(reason = 'shutdown') {
  let coordinator;
  try { coordinator = getRuntimeCoordinator(); } catch (_) { return; }
  await coordinator.stop(reason);
}

module.exports = { initializeAppRuntime, shutdownAppRuntime };
